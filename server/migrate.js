"use strict";

// Creates all tables if they don't exist yet. Safe to call on every server
// start (IF NOT EXISTS everywhere). Two separate paths because the two
// engines need different DDL (SERIAL vs AUTOINCREMENT, ADD COLUMN IF NOT
// EXISTS vs the manual node:sqlite column check).

const { query, isPostgres } = require("./db");

// Postgres supports "ADD COLUMN IF NOT EXISTS" natively, so a column added
// after the table already existed on a live database (e.g. Neon) just needs
// one of these - no manual existence check needed like the SQLite path below.
async function ensurePostgresColumn(table, columnDdl) {
  await query(`ALTER TABLE ${table} ADD COLUMN IF NOT EXISTS ${columnDdl}`);
}

async function migratePostgres() {
  // CREATE TABLE IF NOT EXISTS only helps brand-new databases - once a table
  // already exists (e.g. a live Neon database from an earlier deploy), it's
  // a no-op and any column added here later never reaches it. Every column
  // added after the initial patients table shipped MUST also get an
  // ensurePostgresColumn() call below, or existing deployments will start
  // throwing "column ... does not exist" the moment code reads/writes it.
  await query(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      companion_name TEXT NOT NULL DEFAULT 'Незабудка',
      pairing_code TEXT UNIQUE NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      virtual_offset INTEGER NOT NULL DEFAULT 0,
      theme TEXT NOT NULL DEFAULT 'light',
      sound_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      recovery_code TEXT,
      pairing_code_generated_at TEXT,
      mood_diary_shared INTEGER NOT NULL DEFAULT 0,
      best_streak_ever INTEGER NOT NULL DEFAULT 0,
      mood_diary_ever_shared INTEGER NOT NULL DEFAULT 0,
      time_machine_used INTEGER NOT NULL DEFAULT 0,
      active_species_id TEXT NOT NULL DEFAULT 'default',
      active_scene_id TEXT NOT NULL DEFAULT 'windowsill',
      last_seen_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      password_hash TEXT,
      session_token TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctor_notices (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctor_patient_links (
      doctor_id TEXT NOT NULL,
      patient_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (doctor_id, patient_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS obligations (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      weekdays TEXT NOT NULL DEFAULT '[]',
      course_total INTEGER,
      course_completed_notified INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL,
      paused_ranges TEXT NOT NULL DEFAULT '[]',
      assigned_by_doctor_id TEXT,
      assigned_by_doctor_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS completions (
      id SERIAL PRIMARY KEY,
      obligation_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      date TEXT NOT NULL,
      UNIQUE(obligation_id, date)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS mood_journal (
      id SERIAL PRIMARY KEY,
      patient_id TEXT NOT NULL,
      date TEXT NOT NULL,
      mood TEXT,
      note TEXT,
      UNIQUE(patient_id, date)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rewards_log (
      id SERIAL PRIMARY KEY,
      patient_id TEXT NOT NULL,
      reward_id TEXT,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL,
      date TEXT NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctor_messages (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS schedule_notices (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_achievements (
      patient_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (patient_id, achievement_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_species (
      patient_id TEXT NOT NULL,
      species_id TEXT NOT NULL,
      source TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      PRIMARY KEY (patient_id, species_id)
    )
  `);

  // These six columns were added to the patients table after it had already
  // shipped to a live Neon database - CREATE TABLE IF NOT EXISTS above never
  // reaches an existing table, so each one needs an explicit backfill here.
  await ensurePostgresColumn("patients", "best_streak_ever INTEGER NOT NULL DEFAULT 0");
  await ensurePostgresColumn("patients", "mood_diary_ever_shared INTEGER NOT NULL DEFAULT 0");
  await ensurePostgresColumn("patients", "time_machine_used INTEGER NOT NULL DEFAULT 0");
  await ensurePostgresColumn("patients", "active_species_id TEXT NOT NULL DEFAULT 'default'");
  await ensurePostgresColumn("patients", "active_scene_id TEXT NOT NULL DEFAULT 'windowsill'");
  await ensurePostgresColumn("patients", "last_seen_at TEXT");
}

async function ensureSqliteColumn(table, column, ddl) {
  const { rows } = await query(`PRAGMA table_info(${table})`);
  const exists = rows.some((c) => c.name === column);
  if (!exists) {
    await query(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

async function migrateSqlite() {
  await query(`
    CREATE TABLE IF NOT EXISTS patients (
      id TEXT PRIMARY KEY,
      companion_name TEXT NOT NULL DEFAULT 'Незабудка',
      pairing_code TEXT UNIQUE NOT NULL,
      points INTEGER NOT NULL DEFAULT 0,
      virtual_offset INTEGER NOT NULL DEFAULT 0,
      theme TEXT NOT NULL DEFAULT 'light',
      sound_enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctors (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctor_notices (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctor_patient_links (
      doctor_id TEXT NOT NULL,
      patient_id TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL,
      PRIMARY KEY (doctor_id, patient_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS obligations (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      time TEXT NOT NULL DEFAULT '',
      weekdays TEXT NOT NULL DEFAULT '[]',
      course_total INTEGER,
      course_completed_notified INTEGER NOT NULL DEFAULT 0,
      created_date TEXT NOT NULL,
      paused_ranges TEXT NOT NULL DEFAULT '[]',
      assigned_by_doctor_id TEXT,
      assigned_by_doctor_name TEXT,
      created_at TEXT NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS completions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      obligation_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      date TEXT NOT NULL,
      UNIQUE(obligation_id, date)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS mood_journal (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      date TEXT NOT NULL,
      mood TEXT,
      note TEXT,
      UNIQUE(patient_id, date)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS rewards_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      patient_id TEXT NOT NULL,
      reward_id TEXT,
      name TEXT NOT NULL,
      cost INTEGER NOT NULL,
      date TEXT NOT NULL
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS doctor_messages (
      id TEXT PRIMARY KEY,
      doctor_id TEXT NOT NULL,
      patient_id TEXT NOT NULL,
      text TEXT NOT NULL,
      created_at TEXT NOT NULL,
      read_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS schedule_notices (
      id TEXT PRIMARY KEY,
      patient_id TEXT NOT NULL,
      doctor_id TEXT NOT NULL,
      doctor_name TEXT NOT NULL,
      summary TEXT NOT NULL,
      created_at TEXT NOT NULL,
      seen_at TEXT
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_achievements (
      patient_id TEXT NOT NULL,
      achievement_id TEXT NOT NULL,
      unlocked_at TEXT NOT NULL,
      PRIMARY KEY (patient_id, achievement_id)
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS patient_species (
      patient_id TEXT NOT NULL,
      species_id TEXT NOT NULL,
      source TEXT NOT NULL,
      acquired_at TEXT NOT NULL,
      PRIMARY KEY (patient_id, species_id)
    )
  `);

  // node:sqlite has no "ADD COLUMN IF NOT EXISTS", so check existing
  // columns first. These cover databases created before these columns
  // existed; a fresh file already gets them from the CREATE TABLE above... except
  // the CREATE TABLE above intentionally omits them so this path is also
  // exercised on a brand new file.
  await ensureSqliteColumn("doctors", "password_hash", "password_hash TEXT");
  await ensureSqliteColumn("doctors", "session_token", "session_token TEXT");

  await ensureSqliteColumn("patients", "recovery_code", "recovery_code TEXT");
  await ensureSqliteColumn(
    "patients",
    "pairing_code_generated_at",
    "pairing_code_generated_at TEXT"
  );
  await ensureSqliteColumn(
    "patients",
    "mood_diary_shared",
    "mood_diary_shared INTEGER NOT NULL DEFAULT 0"
  );
  await ensureSqliteColumn(
    "patients",
    "best_streak_ever",
    "best_streak_ever INTEGER NOT NULL DEFAULT 0"
  );
  await ensureSqliteColumn(
    "patients",
    "mood_diary_ever_shared",
    "mood_diary_ever_shared INTEGER NOT NULL DEFAULT 0"
  );
  await ensureSqliteColumn(
    "patients",
    "time_machine_used",
    "time_machine_used INTEGER NOT NULL DEFAULT 0"
  );
  await ensureSqliteColumn(
    "patients",
    "active_species_id",
    "active_species_id TEXT NOT NULL DEFAULT 'default'"
  );
  await ensureSqliteColumn(
    "patients",
    "active_scene_id",
    "active_scene_id TEXT NOT NULL DEFAULT 'windowsill'"
  );
  await ensureSqliteColumn("patients", "last_seen_at", "last_seen_at TEXT");
}

async function migrate() {
  if (isPostgres) {
    await migratePostgres();
  } else {
    await migrateSqlite();
  }
}

module.exports = { migrate };
