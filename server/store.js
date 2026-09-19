"use strict";

const bcrypt = require("bcryptjs");
const { query } = require("./db");
const calc = require("./calc");
const catalog = require("./catalog");
const { randomId, randomPairingCode, randomRecoveryCode, randomSessionToken } = require("./ids");

const PAIRING_CODE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const ATTENTION_THRESHOLD_PCT = 50;
const STALE_CONTACT_MS = 24 * 60 * 60 * 1000; // 24h since the patient device last reached the server

function nowIso() {
  return new Date().toISOString();
}

async function get(sql, params) {
  const { rows } = await query(sql, params);
  return rows[0] || null;
}
async function all(sql, params) {
  const { rows } = await query(sql, params);
  return rows;
}
async function run(sql, params) {
  return query(sql, params);
}

// ---------- row <-> object mapping ----------
function obligationRowToObject(row, completions) {
  return {
    id: row.id,
    patientId: row.patient_id,
    name: row.name,
    type: row.type,
    time: row.time || "",
    weekdays: JSON.parse(row.weekdays || "[]"),
    courseTotal: row.course_total === null ? undefined : row.course_total,
    courseCompletedNotified: !!row.course_completed_notified,
    createdDate: row.created_date,
    pausedRanges: JSON.parse(row.paused_ranges || "[]"),
    assignedByDoctorId: row.assigned_by_doctor_id || null,
    assignedByDoctorName: row.assigned_by_doctor_name || null,
    completions,
  };
}

async function getCompletionsFor(obligationId) {
  const rows = await all(
    "SELECT date FROM completions WHERE obligation_id = $1 ORDER BY date ASC",
    [obligationId]
  );
  return rows.map((r) => r.date);
}

async function listObligationObjects(patientId) {
  const rows = await all(
    "SELECT * FROM obligations WHERE patient_id = $1 ORDER BY created_at ASC",
    [patientId]
  );
  return Promise.all(
    rows.map(async (row) => obligationRowToObject(row, await getCompletionsFor(row.id)))
  );
}

async function getObligationObject(obligationId) {
  const row = await get("SELECT * FROM obligations WHERE id = $1", [obligationId]);
  if (!row) return null;
  return obligationRowToObject(row, await getCompletionsFor(row.id));
}

// ---------- patients ----------
async function generateUniquePairingCode() {
  for (let i = 0; i < 20; i++) {
    const code = randomPairingCode();
    const existing = await get("SELECT id FROM patients WHERE pairing_code = $1", [code]);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique pairing code");
}

async function generateUniqueRecoveryCode() {
  for (let i = 0; i < 20; i++) {
    const code = randomRecoveryCode();
    const existing = await get("SELECT id FROM patients WHERE recovery_code = $1", [code]);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique recovery code");
}

async function seedDemoObligations(patientId) {
  const today = calc.realTodayStr();
  const seeds = [
    {
      id: randomId("t"),
      name: "Витамин D",
      type: "ongoing",
      time: "09:00",
      weekdays: [],
      courseTotal: null,
      createdDate: calc.addDays(today, -10),
      completions: [calc.addDays(today, -1), calc.addDays(today, -2)],
    },
    {
      id: randomId("t"),
      name: "Антибиотик",
      type: "course",
      time: "",
      weekdays: [],
      courseTotal: 10,
      createdDate: calc.addDays(today, -7),
      completions: [-7, -6, -5, -4, -3, -2, -1].map((n) => calc.addDays(today, n)),
    },
    {
      id: randomId("t"),
      name: "Прогулка 30 минут",
      type: "ongoing",
      time: "",
      weekdays: [],
      courseTotal: null,
      createdDate: calc.addDays(today, -10),
      completions: [calc.addDays(today, -1), calc.addDays(today, -2)],
    },
  ];

  for (const s of seeds) {
    await run(
      `
      INSERT INTO obligations (id, patient_id, name, type, time, weekdays, course_total, course_completed_notified, created_date, paused_ranges, assigned_by_doctor_id, assigned_by_doctor_name, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, '[]', NULL, NULL, $9)
    `,
      [
        s.id,
        patientId,
        s.name,
        s.type,
        s.time,
        JSON.stringify(s.weekdays),
        s.courseTotal,
        s.createdDate,
        nowIso(),
      ]
    );
    for (const d of s.completions) {
      await run("INSERT INTO completions (obligation_id, patient_id, date) VALUES ($1, $2, $3)", [
        s.id,
        patientId,
        d,
      ]);
    }
  }

  await run("INSERT INTO rewards (id, patient_id, name, cost) VALUES ($1, $2, $3, $4)", [
    randomId("r"),
    patientId,
    "Чашка любимого чая",
    20,
  ]);
  await run("INSERT INTO rewards (id, patient_id, name, cost) VALUES ($1, $2, $3, $4)", [
    randomId("r"),
    patientId,
    "Серия сериала без чувства вины",
    35,
  ]);
  await run("INSERT INTO rewards (id, patient_id, name, cost) VALUES ($1, $2, $3, $4)", [
    randomId("r"),
    patientId,
    "Долгая прогулка без дел в голове",
    50,
  ]);

  await run("INSERT INTO mood_journal (patient_id, date, mood, note) VALUES ($1, $2, $3, $4)", [
    patientId,
    calc.addDays(today, -1),
    "calm",
    "Спокойный день, ничего особенного, но дела сделаны.",
  ]);
}

async function createPatient() {
  const id = randomId("p");
  const pairingCode = await generateUniquePairingCode();
  const recoveryCode = await generateUniqueRecoveryCode();
  const now = nowIso();
  await run(
    `
    INSERT INTO patients (id, companion_name, pairing_code, points, virtual_offset, theme, sound_enabled, created_at, recovery_code, pairing_code_generated_at, mood_diary_shared)
    VALUES ($1, 'Незабудка', $2, 40, 0, 'light', 1, $3, $4, $5, 0)
  `,
    [id, pairingCode, now, recoveryCode, now]
  );
  await seedDemoObligations(id);
  return id;
}

// Patients created before recovery codes / pairing-code expiry existed have
// NULL in these columns; backfill lazily on first read so old demo data
// keeps working instead of erroring out.
async function ensurePatientMigratedFields(patientRow) {
  if (!patientRow) return patientRow;
  let changed = false;
  let recoveryCode = patientRow.recovery_code;
  let generatedAt = patientRow.pairing_code_generated_at;
  if (!recoveryCode) {
    recoveryCode = await generateUniqueRecoveryCode();
    changed = true;
  }
  if (!generatedAt) {
    generatedAt = nowIso();
    changed = true;
  }
  if (changed) {
    await run("UPDATE patients SET recovery_code = $1, pairing_code_generated_at = $2 WHERE id = $3", [
      recoveryCode,
      generatedAt,
      patientRow.id,
    ]);
    return getPatientRowRaw(patientRow.id);
  }
  return patientRow;
}

async function getPatientRowRaw(patientId) {
  return get("SELECT * FROM patients WHERE id = $1", [patientId]);
}

async function getPatientRow(patientId) {
  return ensurePatientMigratedFields(await getPatientRowRaw(patientId));
}

// Records that the patient's own device (not a doctor viewing their data)
// successfully reached the server just now - the doctor dashboard uses this
// to flag patients whose shown state may be out of date, separately from
// whether they've actually completed their tasks.
async function touchPatientLastSeen(patientId) {
  await run("UPDATE patients SET last_seen_at = $1 WHERE id = $2", [nowIso(), patientId]);
}

function isPairingCodeExpired(patientRow) {
  if (!patientRow.pairing_code_generated_at) return false;
  const generated = new Date(patientRow.pairing_code_generated_at).getTime();
  return Date.now() - generated > PAIRING_CODE_TTL_MS;
}

async function regeneratePairingCode(patientId) {
  const patient = await getPatientRow(patientId);
  if (!patient) return null;
  const code = await generateUniquePairingCode();
  const now = nowIso();
  await run("UPDATE patients SET pairing_code = $1, pairing_code_generated_at = $2 WHERE id = $3", [
    code,
    now,
    patientId,
  ]);
  return getPatientRow(patientId);
}

async function getPatientByRecoveryCode(recoveryCode) {
  const code = (recoveryCode || "").trim().toUpperCase();
  if (!code) return null;
  const row = await get("SELECT id FROM patients WHERE recovery_code = $1", [code]);
  return row ? row.id : null;
}

function patientVirtualToday(patientRow) {
  return calc.addDays(calc.realTodayStr(), patientRow.virtual_offset || 0);
}

async function getLinkedDoctorForPatient(patientId) {
  const link = await get("SELECT doctor_id FROM doctor_patient_links WHERE patient_id = $1", [
    patientId,
  ]);
  if (!link) return null;
  const doctor = await get("SELECT * FROM doctors WHERE id = $1", [link.doctor_id]);
  if (!doctor) return null;
  return { id: doctor.id, name: doctor.name };
}

// ---------- collection: species, scenes, achievements ----------
async function getOwnedSpeciesIds(patientId) {
  const rows = await all("SELECT species_id FROM patient_species WHERE patient_id = $1", [patientId]);
  const owned = rows.map((r) => r.species_id);
  catalog.STARTER_SPECIES_IDS.forEach((id) => {
    if (owned.indexOf(id) === -1) owned.push(id);
  });
  return owned;
}

async function getUnlockedAchievements(patientId) {
  const rows = await all(
    "SELECT achievement_id as \"id\", unlocked_at as \"unlockedAt\" FROM patient_achievements WHERE patient_id = $1",
    [patientId]
  );
  return rows;
}

async function unlockAchievement(patientId, achievementId) {
  const existing = await get(
    "SELECT 1 as x FROM patient_achievements WHERE patient_id = $1 AND achievement_id = $2",
    [patientId, achievementId]
  );
  if (existing) return false;
  await run(
    "INSERT INTO patient_achievements (patient_id, achievement_id, unlocked_at) VALUES ($1, $2, $3)",
    [patientId, achievementId, nowIso()]
  );
  return true;
}

async function grantSpecies(patientId, speciesId, source) {
  const existing = await get("SELECT 1 as x FROM patient_species WHERE patient_id = $1 AND species_id = $2", [
    patientId,
    speciesId,
  ]);
  if (existing) return false;
  await run("INSERT INTO patient_species (patient_id, species_id, source, acquired_at) VALUES ($1, $2, $3, $4)", [
    patientId,
    speciesId,
    source,
    nowIso(),
  ]);
  return true;
}

// Recomputes the patient's best-ever streak, grants any rare species their
// streak just crossed, and unlocks any achievement whose condition is now
// met. Side-effect only - called from getFullPatientState so every sync
// payload is self-healing regardless of which action caused the change.
async function evaluateProgress(patientId) {
  const patientRow = await getPatientRowRaw(patientId);
  if (!patientRow) return;

  const obligations = await listObligationObjects(patientId);
  const today = patientVirtualToday(patientRow);
  const currentStreak = calc.computeStreak(obligations, today);
  const bestStreak = Math.max(patientRow.best_streak_ever || 0, currentStreak);
  if (bestStreak !== patientRow.best_streak_ever) {
    await run("UPDATE patients SET best_streak_ever = $1 WHERE id = $2", [bestStreak, patientId]);
  }

  for (const species of catalog.RARE_SPECIES) {
    if (bestStreak >= species.streakThreshold) {
      await grantSpecies(patientId, species.id, "streak_reward");
    }
  }

  for (const achievement of catalog.STREAK_ACHIEVEMENTS) {
    if (bestStreak >= achievement.streakAtLeast) {
      await unlockAchievement(patientId, achievement.id);
    }
  }

  const courseCompleted = obligations.some((o) => o.courseCompletedNotified);
  if (courseCompleted) await unlockAchievement(patientId, "first_course");

  const doctor = await getLinkedDoctorForPatient(patientId);
  if (doctor) await unlockAchievement(patientId, "doctor_connected");

  if (patientRow.mood_diary_ever_shared) await unlockAchievement(patientId, "mood_diary_shared");

  if (patientRow.time_machine_used) await unlockAchievement(patientId, "time_traveler");

  const owned = await getOwnedSpeciesIds(patientId);
  const allPurchasableOwned = catalog.PURCHASABLE_SPECIES_IDS.every((id) => owned.indexOf(id) !== -1);
  if (allPurchasableOwned) await unlockAchievement(patientId, "species_collector");
}

async function buyPlantSpecies(patientId, speciesId) {
  const species = catalog.findSpecies(speciesId);
  if (!species || species.rare || catalog.STARTER_SPECIES_IDS.indexOf(species.id) !== -1) {
    return { error: "not_purchasable" };
  }
  const patient = await getPatientRow(patientId);
  if (!patient) return null;
  const owned = await getOwnedSpeciesIds(patientId);
  if (owned.indexOf(speciesId) !== -1) return { error: "already_owned" };
  if (patient.points < species.cost) return { error: "not_enough_points" };
  await run("UPDATE patients SET points = points - $1 WHERE id = $2", [species.cost, patientId]);
  await grantSpecies(patientId, speciesId, "purchased");
  return { ok: true };
}

async function selectActiveSpecies(patientId, speciesId) {
  const species = catalog.findSpecies(speciesId);
  if (!species) return { error: "not_found" };
  const owned = await getOwnedSpeciesIds(patientId);
  if (owned.indexOf(speciesId) === -1) return { error: "not_owned" };
  await run("UPDATE patients SET active_species_id = $1 WHERE id = $2", [speciesId, patientId]);
  return { ok: true };
}

async function selectActiveScene(patientId, sceneId) {
  if (catalog.SCENE_IDS.indexOf(sceneId) === -1) return { error: "not_found" };
  await run("UPDATE patients SET active_scene_id = $1 WHERE id = $2", [sceneId, patientId]);
  return { ok: true };
}

async function getFullPatientState(patientId) {
  await evaluateProgress(patientId);

  const patientRow = await getPatientRow(patientId);
  if (!patientRow) return null;

  const obligations = await listObligationObjects(patientId);
  const journalRows = await all("SELECT date, mood, note FROM mood_journal WHERE patient_id = $1", [
    patientId,
  ]);
  const journal = {};
  journalRows.forEach((r) => {
    journal[r.date] = { mood: r.mood, note: r.note || "" };
  });

  const rewards = await all("SELECT id, name, cost FROM rewards WHERE patient_id = $1", [patientId]);
  const rewardsLog = await all(
    "SELECT id, reward_id as \"rewardId\", name, cost, date FROM rewards_log WHERE patient_id = $1 ORDER BY id ASC",
    [patientId]
  );

  const doctor = await getLinkedDoctorForPatient(patientId);

  const unreadMessageCountRow = await get(
    "SELECT COUNT(*) as c FROM doctor_messages WHERE patient_id = $1 AND read_at IS NULL",
    [patientId]
  );
  const unreadMessageCount = Number(unreadMessageCountRow.c);

  const notices = await all(
    "SELECT id, doctor_name as \"doctorName\", summary, created_at as \"createdAt\" FROM schedule_notices WHERE patient_id = $1 AND seen_at IS NULL ORDER BY created_at ASC",
    [patientId]
  );

  const ownedSpeciesIds = await getOwnedSpeciesIds(patientId);
  const achievements = await getUnlockedAchievements(patientId);

  return {
    id: patientRow.id,
    companionName: patientRow.companion_name,
    pairingCode: patientRow.pairing_code,
    pairingCodeExpired: isPairingCodeExpired(patientRow),
    recoveryCode: patientRow.recovery_code,
    points: patientRow.points,
    virtualOffset: patientRow.virtual_offset,
    theme: patientRow.theme,
    soundEnabled: !!patientRow.sound_enabled,
    moodDiaryShared: !!patientRow.mood_diary_shared,
    bestStreakEver: patientRow.best_streak_ever,
    activeSpeciesId: patientRow.active_species_id,
    activeSceneId: patientRow.active_scene_id,
    ownedSpeciesIds,
    achievements,
    tasks: obligations,
    journal,
    rewards,
    rewardsLog,
    doctor,
    unreadMessageCount,
    notices,
  };
}

async function updatePatientSettings(patientId, { companionName, theme, soundEnabled, moodDiaryShared }) {
  const patient = await getPatientRow(patientId);
  if (!patient) return null;
  const nextName =
    typeof companionName === "string" && companionName.trim() ? companionName.trim() : patient.companion_name;
  const nextTheme = theme === "dark" ? "dark" : theme === "light" ? "light" : patient.theme;
  const nextSound = typeof soundEnabled === "boolean" ? (soundEnabled ? 1 : 0) : patient.sound_enabled;
  const nextMoodShared =
    typeof moodDiaryShared === "boolean" ? (moodDiaryShared ? 1 : 0) : patient.mood_diary_shared;
  await run(
    "UPDATE patients SET companion_name = $1, theme = $2, sound_enabled = $3, mood_diary_shared = $4 WHERE id = $5",
    [nextName, nextTheme, nextSound, nextMoodShared, patientId]
  );
  if (moodDiaryShared === true && !patient.mood_diary_ever_shared) {
    await run("UPDATE patients SET mood_diary_ever_shared = 1 WHERE id = $1", [patientId]);
  }

  if (typeof moodDiaryShared === "boolean" && !!patient.mood_diary_shared !== moodDiaryShared) {
    const doctor = await getLinkedDoctorForPatient(patientId);
    if (doctor) {
      await run(
        `
        INSERT INTO doctor_notices (id, doctor_id, patient_id, summary, created_at, seen_at)
        VALUES ($1, $2, $3, $4, $5, NULL)
      `,
        [
          randomId("dn"),
          doctor.id,
          patientId,
          "Пациент «" +
            patient.companion_name +
            "» " +
            (moodDiaryShared ? "включил(а)" : "выключил(а)") +
            " доступ к дневнику настроения",
          nowIso(),
        ]
      );
    }
  }

  return getPatientRow(patientId);
}

async function setVirtualOffset(patientId, delta) {
  const patient = await getPatientRow(patientId);
  if (!patient) return null;
  const next = delta === 0 ? 0 : (patient.virtual_offset || 0) + delta;
  await run("UPDATE patients SET virtual_offset = $1 WHERE id = $2", [next, patientId]);
  if (delta !== 0 && !patient.time_machine_used) {
    await run("UPDATE patients SET time_machine_used = 1 WHERE id = $1", [patientId]);
  }
  return next;
}

async function disconnectDoctor(patientId) {
  await run("DELETE FROM doctor_patient_links WHERE patient_id = $1", [patientId]);
}

async function markNoticesSeen(patientId) {
  await run("UPDATE schedule_notices SET seen_at = $1 WHERE patient_id = $2 AND seen_at IS NULL", [
    nowIso(),
    patientId,
  ]);
}

// ---------- obligations ----------
async function createObligation(patientId, payload, doctorMeta) {
  const patient = await getPatientRow(patientId);
  if (!patient) return null;
  const id = randomId("t");
  const createdDate = patientVirtualToday(patient);
  await run(
    `
    INSERT INTO obligations (id, patient_id, name, type, time, weekdays, course_total, course_completed_notified, created_date, paused_ranges, assigned_by_doctor_id, assigned_by_doctor_name, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, '[]', $9, $10, $11)
  `,
    [
      id,
      patientId,
      payload.name,
      payload.type,
      payload.time || "",
      JSON.stringify(payload.type === "weekday" ? payload.weekdays || [] : []),
      payload.type === "course" ? payload.courseTotal || 7 : null,
      createdDate,
      doctorMeta ? doctorMeta.id : null,
      doctorMeta ? doctorMeta.name : null,
      nowIso(),
    ]
  );

  if (doctorMeta) {
    await run(
      `
      INSERT INTO schedule_notices (id, patient_id, doctor_id, doctor_name, summary, created_at, seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, NULL)
    `,
      [
        randomId("n"),
        patientId,
        doctorMeta.id,
        doctorMeta.name,
        "Врач " + doctorMeta.name + " добавил(а) новую задачу: «" + payload.name + "»",
        nowIso(),
      ]
    );
  }

  return getObligationObject(id);
}

function describeObligationChanges(oldRow, payload, type, weekdays, courseTotal) {
  const parts = [];
  if (oldRow.name !== payload.name) {
    parts.push("название на «" + payload.name + "»");
  }
  const newTime = payload.time || "";
  if ((oldRow.time || "") !== newTime) {
    parts.push(newTime ? "время на " + newTime : "время (убрано)");
  }
  if (oldRow.type !== type) {
    parts.push("периодичность");
  } else if (type === "weekday") {
    const oldWeekdays = JSON.parse(oldRow.weekdays || "[]");
    if (JSON.stringify(oldWeekdays.slice().sort()) !== JSON.stringify(weekdays.slice().sort())) {
      parts.push("дни недели");
    }
  } else if (type === "course" && oldRow.course_total !== courseTotal) {
    parts.push("длительность курса на " + courseTotal + " дн.");
  }
  return parts;
}

async function updateObligation(obligationId, patientId, payload, doctorMeta) {
  const row = await get("SELECT * FROM obligations WHERE id = $1 AND patient_id = $2", [
    obligationId,
    patientId,
  ]);
  if (!row) return null;

  const type = payload.type;
  const courseTotal = type === "course" ? payload.courseTotal || row.course_total || 7 : null;
  const weekdays = type === "weekday" ? payload.weekdays || [] : [];

  const changedParts = doctorMeta ? describeObligationChanges(row, payload, type, weekdays, courseTotal) : [];

  await run(
    `
    UPDATE obligations
    SET name = $1, type = $2, time = $3, weekdays = $4, course_total = $5
    WHERE id = $6
  `,
    [payload.name, type, payload.time || "", JSON.stringify(weekdays), courseTotal, obligationId]
  );

  if (doctorMeta) {
    const changeText = changedParts.length ? changedParts.join(", ") : "детали";
    await run(
      `
      INSERT INTO schedule_notices (id, patient_id, doctor_id, doctor_name, summary, created_at, seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, NULL)
    `,
      [
        randomId("n"),
        patientId,
        doctorMeta.id,
        doctorMeta.name,
        "Врач " + doctorMeta.name + " изменил(а) задачу «" + row.name + "»: " + changeText,
        nowIso(),
      ]
    );
  }

  return getObligationObject(obligationId);
}

async function deleteObligation(obligationId, patientId, doctorMeta) {
  const row = await get("SELECT id, name FROM obligations WHERE id = $1 AND patient_id = $2", [
    obligationId,
    patientId,
  ]);
  if (!row) return false;
  await run("DELETE FROM completions WHERE obligation_id = $1", [obligationId]);
  await run("DELETE FROM obligations WHERE id = $1", [obligationId]);

  if (doctorMeta) {
    await run(
      `
      INSERT INTO schedule_notices (id, patient_id, doctor_id, doctor_name, summary, created_at, seen_at)
      VALUES ($1, $2, $3, $4, $5, $6, NULL)
    `,
      [
        randomId("n"),
        patientId,
        doctorMeta.id,
        doctorMeta.name,
        "Врач " + doctorMeta.name + " удалил(а) задачу: «" + row.name + "»",
        nowIso(),
      ]
    );
  }

  return true;
}

const POINTS_PER_COMPLETION = 10;

async function completeObligation(obligationId, patientId) {
  const patient = await getPatientRow(patientId);
  const obligation = await getObligationObject(obligationId);
  if (!patient || !obligation || obligation.patientId !== patientId) return null;

  const today = patientVirtualToday(patient);
  if (obligation.completions.indexOf(today) !== -1) {
    return { obligation, justFinished: false, alreadyDone: true };
  }

  await run("INSERT INTO completions (obligation_id, patient_id, date) VALUES ($1, $2, $3)", [
    obligationId,
    patientId,
    today,
  ]);
  await run("UPDATE patients SET points = points + $1 WHERE id = $2", [POINTS_PER_COMPLETION, patientId]);

  const updated = await getObligationObject(obligationId);
  let justFinished = false;
  const progress = Math.min(updated.completions.length, updated.courseTotal || Infinity);
  const isFinished = updated.type === "course" && progress >= updated.courseTotal;
  if (isFinished && !updated.courseCompletedNotified) {
    await run("UPDATE obligations SET course_completed_notified = 1 WHERE id = $1", [obligationId]);
    justFinished = true;
  }

  // Intermediate "still going" reactions for courses too long to feel like
  // progress one day at a time - see calc.courseMilestoneForProgress for the
  // length-based rules (none under 15 days, %-marks 15-30, weekly beyond
  // that). Derived fresh from the completion count every call instead of a
  // persisted "already notified" flag, since progress only ever increases by
  // one completion per day, so a given milestone count can only be reached
  // once - nothing to double-fire or need to remember across requests.
  const courseMilestone =
    !justFinished && updated.type === "course" ? calc.courseMilestoneForProgress(progress, updated.courseTotal) : null;

  return { obligation: await getObligationObject(obligationId), justFinished, courseMilestone, alreadyDone: false };
}

async function pauseObligation(obligationId, patientId) {
  const patient = await getPatientRow(patientId);
  const obligation = await getObligationObject(obligationId);
  if (!patient || !obligation || obligation.patientId !== patientId) return null;
  const today = patientVirtualToday(patient);
  if (calc.isPausedOn(obligation, today)) return obligation;
  const ranges = obligation.pausedRanges.concat([{ from: today, to: null }]);
  await run("UPDATE obligations SET paused_ranges = $1 WHERE id = $2", [JSON.stringify(ranges), obligationId]);
  return getObligationObject(obligationId);
}

async function resumeObligation(obligationId, patientId) {
  const patient = await getPatientRow(patientId);
  const obligation = await getObligationObject(obligationId);
  if (!patient || !obligation || obligation.patientId !== patientId) return null;
  const today = patientVirtualToday(patient);
  const openIdx = obligation.pausedRanges.findIndex((r) => r.to === null || r.to === undefined);
  if (openIdx === -1) return obligation;
  let ranges = obligation.pausedRanges.slice();
  if (ranges[openIdx].from === today) {
    ranges.splice(openIdx, 1);
  } else {
    ranges[openIdx] = { from: ranges[openIdx].from, to: calc.addDays(today, -1) };
  }
  await run("UPDATE obligations SET paused_ranges = $1 WHERE id = $2", [JSON.stringify(ranges), obligationId]);
  return getObligationObject(obligationId);
}

// ---------- journal ----------
async function upsertJournalEntry(patientId, date, mood, note) {
  const hasMood = !!mood;
  const hasNote = !!(note && note.trim());
  if (!hasMood && !hasNote) {
    await run("DELETE FROM mood_journal WHERE patient_id = $1 AND date = $2", [patientId, date]);
    return null;
  }
  const existing = await get("SELECT id FROM mood_journal WHERE patient_id = $1 AND date = $2", [
    patientId,
    date,
  ]);
  if (existing) {
    await run("UPDATE mood_journal SET mood = $1, note = $2 WHERE id = $3", [
      mood || null,
      note || "",
      existing.id,
    ]);
  } else {
    await run("INSERT INTO mood_journal (patient_id, date, mood, note) VALUES ($1, $2, $3, $4)", [
      patientId,
      date,
      mood || null,
      note || "",
    ]);
  }
  return { mood: mood || null, note: note || "" };
}

// ---------- rewards ----------
async function addReward(patientId, name, cost) {
  const id = randomId("rw");
  await run("INSERT INTO rewards (id, patient_id, name, cost) VALUES ($1, $2, $3, $4)", [
    id,
    patientId,
    name,
    cost,
  ]);
  return { id, name, cost };
}

async function redeemReward(patientId, rewardId) {
  const patient = await getPatientRow(patientId);
  const reward = await get("SELECT * FROM rewards WHERE id = $1 AND patient_id = $2", [rewardId, patientId]);
  if (!patient || !reward) return null;
  if (patient.points < reward.cost) return { error: "not_enough_points" };
  await run("UPDATE patients SET points = points - $1 WHERE id = $2", [reward.cost, patientId]);
  const refreshedPatient = await getPatientRow(patientId);
  const today = patientVirtualToday(refreshedPatient);
  await run(
    "INSERT INTO rewards_log (patient_id, reward_id, name, cost, date) VALUES ($1, $2, $3, $4, $5)",
    [patientId, reward.id, reward.name, reward.cost, today]
  );
  return { ok: true };
}

// ---------- doctors ----------
const BCRYPT_ROUNDS = 10;

async function getDoctorRow(doctorId) {
  return get("SELECT * FROM doctors WHERE id = $1", [doctorId]);
}

async function getDoctorByName(name) {
  return get("SELECT * FROM doctors WHERE name = $1", [name]);
}

async function issueDoctorSession(doctorId) {
  const token = randomSessionToken();
  await run("UPDATE doctors SET session_token = $1 WHERE id = $2", [token, doctorId]);
  return token;
}

// Single login endpoint covers both first-time registration and subsequent
// logins: if the name is new (or a legacy doctor row has no password yet),
// the given password becomes that doctor's password. Otherwise it must match.
async function loginOrRegisterDoctor(name, password) {
  const existing = await getDoctorByName(name);

  if (!existing) {
    const id = randomId("d");
    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    await run("INSERT INTO doctors (id, name, created_at, password_hash) VALUES ($1, $2, $3, $4)", [
      id,
      name,
      nowIso(),
      passwordHash,
    ]);
    const token = await issueDoctorSession(id);
    return { id, name, token };
  }

  if (!existing.password_hash) {
    // Legacy doctor created before passwords existed - set it now.
    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    await run("UPDATE doctors SET password_hash = $1 WHERE id = $2", [passwordHash, existing.id]);
    const token = await issueDoctorSession(existing.id);
    return { id: existing.id, name: existing.name, token };
  }

  const ok = bcrypt.compareSync(password, existing.password_hash);
  if (!ok) return { error: "invalid_password" };
  const token = await issueDoctorSession(existing.id);
  return { id: existing.id, name: existing.name, token };
}

async function getDoctorBySessionToken(token) {
  if (!token) return null;
  return get("SELECT * FROM doctors WHERE session_token = $1", [token]);
}

async function isDoctorLinkedToPatient(doctorId, patientId) {
  const link = await get(
    "SELECT 1 as x FROM doctor_patient_links WHERE doctor_id = $1 AND patient_id = $2",
    [doctorId, patientId]
  );
  return !!link;
}

async function linkPatientByCode(doctorId, pairingCode) {
  const rawPatient = await get("SELECT * FROM patients WHERE pairing_code = $1", [
    (pairingCode || "").trim().toUpperCase(),
  ]);
  if (!rawPatient) return { error: "not_found" };
  const patient = await ensurePatientMigratedFields(rawPatient);

  if (isPairingCodeExpired(patient)) return { error: "expired" };

  const existingLink = await get("SELECT doctor_id FROM doctor_patient_links WHERE patient_id = $1", [
    patient.id,
  ]);
  if (existingLink && existingLink.doctor_id !== doctorId) {
    return { error: "already_linked" };
  }
  if (existingLink && existingLink.doctor_id === doctorId) {
    return { patientId: patient.id };
  }

  await run("INSERT INTO doctor_patient_links (doctor_id, patient_id, created_at) VALUES ($1, $2, $3)", [
    doctorId,
    patient.id,
    nowIso(),
  ]);
  return { patientId: patient.id };
}

async function getDoctorPatientsSummary(doctorId) {
  const links = await all("SELECT patient_id FROM doctor_patient_links WHERE doctor_id = $1", [doctorId]);
  const summaries = await Promise.all(
    links.map(async ({ patient_id }) => {
      const patient = await getPatientRow(patient_id);
      const obligations = await listObligationObjects(patient_id);
      const today = calc.realTodayStr();
      const pct = calc.computeHealthPercent(obligations, today);
      const state = calc.healthState(pct);
      const week = calc.weeklyStats(obligations, today);
      const lastSeenAt = patient.last_seen_at || null;
      const stale = !lastSeenAt || Date.now() - new Date(lastSeenAt).getTime() > STALE_CONTACT_MS;
      return {
        id: patient.id,
        companionName: patient.companion_name,
        state,
        weekDue: week.due,
        weekDone: week.done,
        needsAttention: pct < ATTENTION_THRESHOLD_PCT,
        recentPct: pct,
        lastSeenAt,
        stale,
      };
    })
  );
  // Patients needing attention first (worst completion first among them),
  // everyone else after, in their original order.
  return summaries
    .map((s, idx) => ({ s, idx }))
    .sort((a, b) => {
      if (a.s.needsAttention !== b.s.needsAttention) return a.s.needsAttention ? -1 : 1;
      if (a.s.needsAttention && b.s.needsAttention) return a.s.recentPct - b.s.recentPct;
      return a.idx - b.idx;
    })
    .map(({ s }) => s);
}

async function getPatientDetailForDoctor(doctorId, patientId) {
  if (!(await isDoctorLinkedToPatient(doctorId, patientId))) return { error: "not_linked" };
  const state = await getFullPatientState(patientId);
  if (!state) return { error: "not_found" };
  const today = calc.realTodayStr();
  const pct = calc.computeHealthPercent(state.tasks, today);
  const needsAttention = pct < ATTENTION_THRESHOLD_PCT;
  const detail = {
    ...state,
    healthState: calc.healthState(pct),
    streak: calc.computeStreak(state.tasks, today),
    needsAttention,
    attentionSummary: needsAttention ? "3 дня подряд низкое выполнение" : "Всё стабильно",
  };
  if (!state.moodDiaryShared) {
    delete detail.journal;
  }
  return detail;
}

// ---------- doctor notices (e.g. patient toggled mood-diary sharing) ----------
async function listDoctorNotices(doctorId) {
  return all(
    "SELECT id, patient_id as \"patientId\", summary, created_at as \"createdAt\" FROM doctor_notices WHERE doctor_id = $1 AND seen_at IS NULL ORDER BY created_at ASC",
    [doctorId]
  );
}

async function markDoctorNoticesSeen(doctorId) {
  await run("UPDATE doctor_notices SET seen_at = $1 WHERE doctor_id = $2 AND seen_at IS NULL", [
    nowIso(),
    doctorId,
  ]);
}

async function sendDoctorMessage(doctorId, patientId, text) {
  if (!(await isDoctorLinkedToPatient(doctorId, patientId))) return { error: "not_linked" };
  const id = randomId("m");
  await run(
    `
    INSERT INTO doctor_messages (id, doctor_id, patient_id, text, created_at, read_at)
    VALUES ($1, $2, $3, $4, $5, NULL)
  `,
    [id, doctorId, patientId, text, nowIso()]
  );
  return { id };
}

async function listMessagesForPatient(patientId) {
  return all(
    `SELECT dm.id, dm.text, dm.created_at as "createdAt", dm.read_at as "readAt", d.name as "doctorName"
     FROM doctor_messages dm JOIN doctors d ON d.id = dm.doctor_id
     WHERE dm.patient_id = $1 ORDER BY dm.created_at DESC`,
    [patientId]
  );
}

async function markMessageRead(messageId, patientId) {
  const row = await get("SELECT id FROM doctor_messages WHERE id = $1 AND patient_id = $2", [
    messageId,
    patientId,
  ]);
  if (!row) return false;
  await run("UPDATE doctor_messages SET read_at = $1 WHERE id = $2", [nowIso(), messageId]);
  return true;
}

async function markAllMessagesRead(patientId) {
  await run("UPDATE doctor_messages SET read_at = $1 WHERE patient_id = $2 AND read_at IS NULL", [
    nowIso(),
    patientId,
  ]);
}

// ---------- admin: delete a (test) patient and everything tied to them ----------
async function deletePatient(patientId) {
  const patient = await get("SELECT id FROM patients WHERE id = $1", [patientId]);
  if (!patient) return false;

  await run("DELETE FROM completions WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM obligations WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM doctor_patient_links WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM mood_journal WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM doctor_messages WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM rewards_log WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM rewards WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM schedule_notices WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM doctor_notices WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM patient_achievements WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM patient_species WHERE patient_id = $1", [patientId]);
  await run("DELETE FROM patients WHERE id = $1", [patientId]);

  return true;
}

module.exports = {
  patientVirtualToday,
  createPatient,
  getPatientRow,
  touchPatientLastSeen,
  getPatientByRecoveryCode,
  regeneratePairingCode,
  getFullPatientState,
  updatePatientSettings,
  setVirtualOffset,
  disconnectDoctor,
  markNoticesSeen,
  createObligation,
  updateObligation,
  deleteObligation,
  completeObligation,
  pauseObligation,
  resumeObligation,
  upsertJournalEntry,
  addReward,
  redeemReward,
  loginOrRegisterDoctor,
  getDoctorRow,
  getDoctorBySessionToken,
  isDoctorLinkedToPatient,
  linkPatientByCode,
  getDoctorPatientsSummary,
  getPatientDetailForDoctor,
  sendDoctorMessage,
  listMessagesForPatient,
  markMessageRead,
  markAllMessagesRead,
  getLinkedDoctorForPatient,
  listDoctorNotices,
  markDoctorNoticesSeen,
  deletePatient,
  buyPlantSpecies,
  selectActiveSpecies,
  selectActiveScene,
};
