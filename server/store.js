"use strict";

const bcrypt = require("bcryptjs");
const db = require("./db");
const calc = require("./calc");
const { randomId, randomPairingCode, randomRecoveryCode, randomSessionToken } = require("./ids");

const PAIRING_CODE_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const ATTENTION_THRESHOLD_PCT = 50;

function nowIso() {
  return new Date().toISOString();
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

function getCompletionsFor(obligationId) {
  const rows = db
    .prepare("SELECT date FROM completions WHERE obligation_id = ? ORDER BY date ASC")
    .all(obligationId);
  return rows.map((r) => r.date);
}

function listObligationObjects(patientId) {
  const rows = db
    .prepare("SELECT * FROM obligations WHERE patient_id = ? ORDER BY created_at ASC")
    .all(patientId);
  return rows.map((row) => obligationRowToObject(row, getCompletionsFor(row.id)));
}

function getObligationObject(obligationId) {
  const row = db.prepare("SELECT * FROM obligations WHERE id = ?").get(obligationId);
  if (!row) return null;
  return obligationRowToObject(row, getCompletionsFor(row.id));
}

// ---------- patients ----------
function generateUniquePairingCode() {
  for (let i = 0; i < 20; i++) {
    const code = randomPairingCode();
    const existing = db.prepare("SELECT id FROM patients WHERE pairing_code = ?").get(code);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique pairing code");
}

function generateUniqueRecoveryCode() {
  for (let i = 0; i < 20; i++) {
    const code = randomRecoveryCode();
    const existing = db.prepare("SELECT id FROM patients WHERE recovery_code = ?").get(code);
    if (!existing) return code;
  }
  throw new Error("Could not generate a unique recovery code");
}

function seedDemoObligations(patientId) {
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
  const insertObligation = db.prepare(`
    INSERT INTO obligations (id, patient_id, name, type, time, weekdays, course_total, course_completed_notified, created_date, paused_ranges, assigned_by_doctor_id, assigned_by_doctor_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, '[]', NULL, NULL, ?)
  `);
  const insertCompletion = db.prepare(
    "INSERT INTO completions (obligation_id, patient_id, date) VALUES (?, ?, ?)"
  );
  seeds.forEach((s) => {
    insertObligation.run(
      s.id,
      patientId,
      s.name,
      s.type,
      s.time,
      JSON.stringify(s.weekdays),
      s.courseTotal,
      s.createdDate,
      nowIso()
    );
    s.completions.forEach((d) => insertCompletion.run(s.id, patientId, d));
  });

  db.prepare(
    "INSERT INTO rewards (id, patient_id, name, cost) VALUES (?, ?, ?, ?)"
  ).run(randomId("r"), patientId, "Чашка любимого чая", 20);
  db.prepare(
    "INSERT INTO rewards (id, patient_id, name, cost) VALUES (?, ?, ?, ?)"
  ).run(randomId("r"), patientId, "Серия сериала без чувства вины", 35);
  db.prepare(
    "INSERT INTO rewards (id, patient_id, name, cost) VALUES (?, ?, ?, ?)"
  ).run(randomId("r"), patientId, "Долгая прогулка без дел в голове", 50);

  db.prepare(
    "INSERT INTO mood_journal (patient_id, date, mood, note) VALUES (?, ?, ?, ?)"
  ).run(patientId, calc.addDays(today, -1), "calm", "Спокойный день, ничего особенного, но дела сделаны.");
}

function createPatient() {
  const id = randomId("p");
  const pairingCode = generateUniquePairingCode();
  const recoveryCode = generateUniqueRecoveryCode();
  const now = nowIso();
  db.prepare(`
    INSERT INTO patients (id, companion_name, pairing_code, points, virtual_offset, theme, sound_enabled, created_at, recovery_code, pairing_code_generated_at, mood_diary_shared)
    VALUES (?, 'Незабудка', ?, 40, 0, 'light', 1, ?, ?, ?, 0)
  `).run(id, pairingCode, now, recoveryCode, now);
  seedDemoObligations(id);
  return id;
}

// Patients created before recovery codes / pairing-code expiry existed have
// NULL in these columns; backfill lazily on first read so old demo data
// keeps working instead of erroring out.
function ensurePatientMigratedFields(patientRow) {
  if (!patientRow) return patientRow;
  let changed = false;
  let recoveryCode = patientRow.recovery_code;
  let generatedAt = patientRow.pairing_code_generated_at;
  if (!recoveryCode) {
    recoveryCode = generateUniqueRecoveryCode();
    changed = true;
  }
  if (!generatedAt) {
    generatedAt = nowIso();
    changed = true;
  }
  if (changed) {
    db.prepare(
      "UPDATE patients SET recovery_code = ?, pairing_code_generated_at = ? WHERE id = ?"
    ).run(recoveryCode, generatedAt, patientRow.id);
    return getPatientRowRaw(patientRow.id);
  }
  return patientRow;
}

function getPatientRowRaw(patientId) {
  return db.prepare("SELECT * FROM patients WHERE id = ?").get(patientId);
}

function getPatientRow(patientId) {
  return ensurePatientMigratedFields(getPatientRowRaw(patientId));
}

function isPairingCodeExpired(patientRow) {
  if (!patientRow.pairing_code_generated_at) return false;
  const generated = new Date(patientRow.pairing_code_generated_at).getTime();
  return Date.now() - generated > PAIRING_CODE_TTL_MS;
}

function regeneratePairingCode(patientId) {
  const patient = getPatientRow(patientId);
  if (!patient) return null;
  const code = generateUniquePairingCode();
  const now = nowIso();
  db.prepare("UPDATE patients SET pairing_code = ?, pairing_code_generated_at = ? WHERE id = ?").run(
    code,
    now,
    patientId
  );
  return getPatientRow(patientId);
}

function getPatientByRecoveryCode(recoveryCode) {
  const code = (recoveryCode || "").trim().toUpperCase();
  if (!code) return null;
  const row = db.prepare("SELECT id FROM patients WHERE recovery_code = ?").get(code);
  return row ? row.id : null;
}

function patientVirtualToday(patientRow) {
  return calc.addDays(calc.realTodayStr(), patientRow.virtual_offset || 0);
}

function getLinkedDoctorForPatient(patientId) {
  const link = db
    .prepare("SELECT doctor_id FROM doctor_patient_links WHERE patient_id = ?")
    .get(patientId);
  if (!link) return null;
  const doctor = db.prepare("SELECT * FROM doctors WHERE id = ?").get(link.doctor_id);
  if (!doctor) return null;
  return { id: doctor.id, name: doctor.name };
}

function getFullPatientState(patientId) {
  const patientRow = getPatientRow(patientId);
  if (!patientRow) return null;

  const obligations = listObligationObjects(patientId);
  const journalRows = db
    .prepare("SELECT date, mood, note FROM mood_journal WHERE patient_id = ?")
    .all(patientId);
  const journal = {};
  journalRows.forEach((r) => {
    journal[r.date] = { mood: r.mood, note: r.note || "" };
  });

  const rewards = db
    .prepare("SELECT id, name, cost FROM rewards WHERE patient_id = ?")
    .all(patientId);
  const rewardsLog = db
    .prepare("SELECT id, reward_id as rewardId, name, cost, date FROM rewards_log WHERE patient_id = ? ORDER BY id ASC")
    .all(patientId);

  const doctor = getLinkedDoctorForPatient(patientId);

  const unreadMessageCount = db
    .prepare("SELECT COUNT(*) as c FROM doctor_messages WHERE patient_id = ? AND read_at IS NULL")
    .get(patientId).c;

  const notices = db
    .prepare(
      "SELECT id, doctor_name as doctorName, summary, created_at as createdAt FROM schedule_notices WHERE patient_id = ? AND seen_at IS NULL ORDER BY created_at ASC"
    )
    .all(patientId);

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
    tasks: obligations,
    journal,
    rewards,
    rewardsLog,
    doctor,
    unreadMessageCount,
    notices,
  };
}

function updatePatientSettings(patientId, { companionName, theme, soundEnabled, moodDiaryShared }) {
  const patient = getPatientRow(patientId);
  if (!patient) return null;
  const nextName = typeof companionName === "string" && companionName.trim() ? companionName.trim() : patient.companion_name;
  const nextTheme = theme === "dark" ? "dark" : theme === "light" ? "light" : patient.theme;
  const nextSound = typeof soundEnabled === "boolean" ? (soundEnabled ? 1 : 0) : patient.sound_enabled;
  const nextMoodShared = typeof moodDiaryShared === "boolean" ? (moodDiaryShared ? 1 : 0) : patient.mood_diary_shared;
  db.prepare(
    "UPDATE patients SET companion_name = ?, theme = ?, sound_enabled = ?, mood_diary_shared = ? WHERE id = ?"
  ).run(nextName, nextTheme, nextSound, nextMoodShared, patientId);

  if (typeof moodDiaryShared === "boolean" && !!patient.mood_diary_shared !== moodDiaryShared) {
    const doctor = getLinkedDoctorForPatient(patientId);
    if (doctor) {
      db.prepare(`
        INSERT INTO doctor_notices (id, doctor_id, patient_id, summary, created_at, seen_at)
        VALUES (?, ?, ?, ?, ?, NULL)
      `).run(
        randomId("dn"),
        doctor.id,
        patientId,
        "Пациент «" + patient.companion_name + "» " + (moodDiaryShared ? "включил(а)" : "выключил(а)") + " доступ к дневнику настроения",
        nowIso()
      );
    }
  }

  return getPatientRow(patientId);
}

function setVirtualOffset(patientId, delta) {
  const patient = getPatientRow(patientId);
  if (!patient) return null;
  const next = delta === 0 ? 0 : (patient.virtual_offset || 0) + delta;
  db.prepare("UPDATE patients SET virtual_offset = ? WHERE id = ?").run(next, patientId);
  return next;
}

function disconnectDoctor(patientId) {
  db.prepare("DELETE FROM doctor_patient_links WHERE patient_id = ?").run(patientId);
}

function markNoticesSeen(patientId) {
  db.prepare(
    "UPDATE schedule_notices SET seen_at = ? WHERE patient_id = ? AND seen_at IS NULL"
  ).run(nowIso(), patientId);
}

// ---------- obligations ----------
function createObligation(patientId, payload, doctorMeta) {
  const patient = getPatientRow(patientId);
  if (!patient) return null;
  const id = randomId("t");
  const createdDate = patientVirtualToday(patient);
  db.prepare(`
    INSERT INTO obligations (id, patient_id, name, type, time, weekdays, course_total, course_completed_notified, created_date, paused_ranges, assigned_by_doctor_id, assigned_by_doctor_name, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, '[]', ?, ?, ?)
  `).run(
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
    nowIso()
  );

  if (doctorMeta) {
    db.prepare(`
      INSERT INTO schedule_notices (id, patient_id, doctor_id, doctor_name, summary, created_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      randomId("n"),
      patientId,
      doctorMeta.id,
      doctorMeta.name,
      "Врач " + doctorMeta.name + " добавил(а) новую задачу: «" + payload.name + "»",
      nowIso()
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

function updateObligation(obligationId, patientId, payload, doctorMeta) {
  const row = db.prepare("SELECT * FROM obligations WHERE id = ? AND patient_id = ?").get(obligationId, patientId);
  if (!row) return null;

  const type = payload.type;
  const courseTotal = type === "course" ? payload.courseTotal || row.course_total || 7 : null;
  const weekdays = type === "weekday" ? payload.weekdays || [] : [];

  const changedParts = doctorMeta ? describeObligationChanges(row, payload, type, weekdays, courseTotal) : [];

  db.prepare(`
    UPDATE obligations
    SET name = ?, type = ?, time = ?, weekdays = ?, course_total = ?, paused_ranges = paused_ranges
    WHERE id = ?
  `).run(payload.name, type, payload.time || "", JSON.stringify(weekdays), courseTotal, obligationId);

  if (doctorMeta) {
    const changeText = changedParts.length ? changedParts.join(", ") : "детали";
    db.prepare(`
      INSERT INTO schedule_notices (id, patient_id, doctor_id, doctor_name, summary, created_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      randomId("n"),
      patientId,
      doctorMeta.id,
      doctorMeta.name,
      "Врач " + doctorMeta.name + " изменил(а) задачу «" + row.name + "»: " + changeText,
      nowIso()
    );
  }

  return getObligationObject(obligationId);
}

function deleteObligation(obligationId, patientId, doctorMeta) {
  const row = db.prepare("SELECT id, name FROM obligations WHERE id = ? AND patient_id = ?").get(obligationId, patientId);
  if (!row) return false;
  db.prepare("DELETE FROM completions WHERE obligation_id = ?").run(obligationId);
  db.prepare("DELETE FROM obligations WHERE id = ?").run(obligationId);

  if (doctorMeta) {
    db.prepare(`
      INSERT INTO schedule_notices (id, patient_id, doctor_id, doctor_name, summary, created_at, seen_at)
      VALUES (?, ?, ?, ?, ?, ?, NULL)
    `).run(
      randomId("n"),
      patientId,
      doctorMeta.id,
      doctorMeta.name,
      "Врач " + doctorMeta.name + " удалил(а) задачу: «" + row.name + "»",
      nowIso()
    );
  }

  return true;
}

const POINTS_PER_COMPLETION = 10;

function completeObligation(obligationId, patientId) {
  const patient = getPatientRow(patientId);
  const obligation = getObligationObject(obligationId);
  if (!patient || !obligation || obligation.patientId !== patientId) return null;

  const today = patientVirtualToday(patient);
  if (obligation.completions.indexOf(today) !== -1) {
    return { obligation, justFinished: false, alreadyDone: true };
  }

  db.prepare("INSERT INTO completions (obligation_id, patient_id, date) VALUES (?, ?, ?)").run(
    obligationId,
    patientId,
    today
  );
  db.prepare("UPDATE patients SET points = points + ? WHERE id = ?").run(POINTS_PER_COMPLETION, patientId);

  const updated = getObligationObject(obligationId);
  let justFinished = false;
  const progress = Math.min(updated.completions.length, updated.courseTotal || Infinity);
  const isFinished = updated.type === "course" && progress >= updated.courseTotal;
  if (isFinished && !updated.courseCompletedNotified) {
    db.prepare("UPDATE obligations SET course_completed_notified = 1 WHERE id = ?").run(obligationId);
    justFinished = true;
  }

  return { obligation: getObligationObject(obligationId), justFinished, alreadyDone: false };
}

function pauseObligation(obligationId, patientId) {
  const patient = getPatientRow(patientId);
  const obligation = getObligationObject(obligationId);
  if (!patient || !obligation || obligation.patientId !== patientId) return null;
  const today = patientVirtualToday(patient);
  if (calc.isPausedOn(obligation, today)) return obligation;
  const ranges = obligation.pausedRanges.concat([{ from: today, to: null }]);
  db.prepare("UPDATE obligations SET paused_ranges = ? WHERE id = ?").run(JSON.stringify(ranges), obligationId);
  return getObligationObject(obligationId);
}

function resumeObligation(obligationId, patientId) {
  const patient = getPatientRow(patientId);
  const obligation = getObligationObject(obligationId);
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
  db.prepare("UPDATE obligations SET paused_ranges = ? WHERE id = ?").run(JSON.stringify(ranges), obligationId);
  return getObligationObject(obligationId);
}

// ---------- journal ----------
function upsertJournalEntry(patientId, date, mood, note) {
  const hasMood = !!mood;
  const hasNote = !!(note && note.trim());
  if (!hasMood && !hasNote) {
    db.prepare("DELETE FROM mood_journal WHERE patient_id = ? AND date = ?").run(patientId, date);
    return null;
  }
  const existing = db.prepare("SELECT id FROM mood_journal WHERE patient_id = ? AND date = ?").get(patientId, date);
  if (existing) {
    db.prepare("UPDATE mood_journal SET mood = ?, note = ? WHERE id = ?").run(mood || null, note || "", existing.id);
  } else {
    db.prepare("INSERT INTO mood_journal (patient_id, date, mood, note) VALUES (?, ?, ?, ?)").run(
      patientId,
      date,
      mood || null,
      note || ""
    );
  }
  return { mood: mood || null, note: note || "" };
}

// ---------- rewards ----------
function addReward(patientId, name, cost) {
  const id = randomId("rw");
  db.prepare("INSERT INTO rewards (id, patient_id, name, cost) VALUES (?, ?, ?, ?)").run(id, patientId, name, cost);
  return { id, name, cost };
}

function redeemReward(patientId, rewardId) {
  const patient = getPatientRow(patientId);
  const reward = db.prepare("SELECT * FROM rewards WHERE id = ? AND patient_id = ?").get(rewardId, patientId);
  if (!patient || !reward) return null;
  if (patient.points < reward.cost) return { error: "not_enough_points" };
  db.prepare("UPDATE patients SET points = points - ? WHERE id = ?").run(reward.cost, patientId);
  const today = patientVirtualToday(getPatientRow(patientId));
  db.prepare(
    "INSERT INTO rewards_log (patient_id, reward_id, name, cost, date) VALUES (?, ?, ?, ?, ?)"
  ).run(patientId, reward.id, reward.name, reward.cost, today);
  return { ok: true };
}

// ---------- doctors ----------
const BCRYPT_ROUNDS = 10;

function getDoctorRow(doctorId) {
  return db.prepare("SELECT * FROM doctors WHERE id = ?").get(doctorId);
}

function getDoctorByName(name) {
  return db.prepare("SELECT * FROM doctors WHERE name = ?").get(name);
}

function issueDoctorSession(doctorId) {
  const token = randomSessionToken();
  db.prepare("UPDATE doctors SET session_token = ? WHERE id = ?").run(token, doctorId);
  return token;
}

// Single login endpoint covers both first-time registration and subsequent
// logins: if the name is new (or a legacy doctor row has no password yet),
// the given password becomes that doctor's password. Otherwise it must match.
function loginOrRegisterDoctor(name, password) {
  const existing = getDoctorByName(name);

  if (!existing) {
    const id = randomId("d");
    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    db.prepare(
      "INSERT INTO doctors (id, name, created_at, password_hash) VALUES (?, ?, ?, ?)"
    ).run(id, name, nowIso(), passwordHash);
    const token = issueDoctorSession(id);
    return { id, name, token };
  }

  if (!existing.password_hash) {
    // Legacy doctor created before passwords existed - set it now.
    const passwordHash = bcrypt.hashSync(password, BCRYPT_ROUNDS);
    db.prepare("UPDATE doctors SET password_hash = ? WHERE id = ?").run(passwordHash, existing.id);
    const token = issueDoctorSession(existing.id);
    return { id: existing.id, name: existing.name, token };
  }

  const ok = bcrypt.compareSync(password, existing.password_hash);
  if (!ok) return { error: "invalid_password" };
  const token = issueDoctorSession(existing.id);
  return { id: existing.id, name: existing.name, token };
}

function getDoctorBySessionToken(token) {
  if (!token) return null;
  return db.prepare("SELECT * FROM doctors WHERE session_token = ?").get(token);
}

function isDoctorLinkedToPatient(doctorId, patientId) {
  const link = db
    .prepare("SELECT 1 as x FROM doctor_patient_links WHERE doctor_id = ? AND patient_id = ?")
    .get(doctorId, patientId);
  return !!link;
}

function linkPatientByCode(doctorId, pairingCode) {
  const rawPatient = db
    .prepare("SELECT * FROM patients WHERE pairing_code = ?")
    .get((pairingCode || "").trim().toUpperCase());
  if (!rawPatient) return { error: "not_found" };
  const patient = ensurePatientMigratedFields(rawPatient);

  if (isPairingCodeExpired(patient)) return { error: "expired" };

  const existingLink = db
    .prepare("SELECT doctor_id FROM doctor_patient_links WHERE patient_id = ?")
    .get(patient.id);
  if (existingLink && existingLink.doctor_id !== doctorId) {
    return { error: "already_linked" };
  }
  if (existingLink && existingLink.doctor_id === doctorId) {
    return { patientId: patient.id };
  }

  db.prepare(
    "INSERT INTO doctor_patient_links (doctor_id, patient_id, created_at) VALUES (?, ?, ?)"
  ).run(doctorId, patient.id, nowIso());
  return { patientId: patient.id };
}

function getDoctorPatientsSummary(doctorId) {
  const links = db
    .prepare("SELECT patient_id FROM doctor_patient_links WHERE doctor_id = ?")
    .all(doctorId);
  const summaries = links.map(({ patient_id }) => {
    const patient = getPatientRow(patient_id);
    const obligations = listObligationObjects(patient_id);
    const today = calc.realTodayStr();
    const pct = calc.computeHealthPercent(obligations, today);
    const state = calc.healthState(pct);
    const week = calc.weeklyStats(obligations, today);
    return {
      id: patient.id,
      companionName: patient.companion_name,
      state,
      weekDue: week.due,
      weekDone: week.done,
      needsAttention: pct < ATTENTION_THRESHOLD_PCT,
      recentPct: pct,
    };
  });
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

function getPatientDetailForDoctor(doctorId, patientId) {
  if (!isDoctorLinkedToPatient(doctorId, patientId)) return { error: "not_linked" };
  const state = getFullPatientState(patientId);
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
function listDoctorNotices(doctorId) {
  return db
    .prepare(
      "SELECT id, patient_id as patientId, summary, created_at as createdAt FROM doctor_notices WHERE doctor_id = ? AND seen_at IS NULL ORDER BY created_at ASC"
    )
    .all(doctorId);
}

function markDoctorNoticesSeen(doctorId) {
  db.prepare("UPDATE doctor_notices SET seen_at = ? WHERE doctor_id = ? AND seen_at IS NULL").run(
    nowIso(),
    doctorId
  );
}

function sendDoctorMessage(doctorId, patientId, text) {
  if (!isDoctorLinkedToPatient(doctorId, patientId)) return { error: "not_linked" };
  const id = randomId("m");
  db.prepare(`
    INSERT INTO doctor_messages (id, doctor_id, patient_id, text, created_at, read_at)
    VALUES (?, ?, ?, ?, ?, NULL)
  `).run(id, doctorId, patientId, text, nowIso());
  return { id };
}

function listMessagesForPatient(patientId) {
  return db
    .prepare(
      `SELECT dm.id, dm.text, dm.created_at as createdAt, dm.read_at as readAt, d.name as doctorName
       FROM doctor_messages dm JOIN doctors d ON d.id = dm.doctor_id
       WHERE dm.patient_id = ? ORDER BY dm.created_at DESC`
    )
    .all(patientId);
}

function markMessageRead(messageId, patientId) {
  const row = db.prepare("SELECT id FROM doctor_messages WHERE id = ? AND patient_id = ?").get(messageId, patientId);
  if (!row) return false;
  db.prepare("UPDATE doctor_messages SET read_at = ? WHERE id = ?").run(nowIso(), messageId);
  return true;
}

function markAllMessagesRead(patientId) {
  db.prepare("UPDATE doctor_messages SET read_at = ? WHERE patient_id = ? AND read_at IS NULL").run(
    nowIso(),
    patientId
  );
}

module.exports = {
  patientVirtualToday,
  createPatient,
  getPatientRow,
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
};
