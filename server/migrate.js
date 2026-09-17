"use strict";

// Creates all tables if they don't exist yet. Safe to call on every server
// start (IF NOT EXISTS everywhere). Two separate paths because the two
// engines need different DDL (SERIAL vs AUTOINCREMENT, ADD COLUMN IF NOT
// EXISTS vs the manual node:sqlite column check).

const { query, isPostgres } = require("./db");

async function migratePostgres() {
  // A fresh Neon/Postgres database has no legacy rows, so every column that
  // SQLite only gained via a later ALTER TABLE is included directly here.
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
      mood_diary_shared INTEGER NOT NULL DEFAULT 0
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
}

async function migrate() {
  if (isPostgres) {
    await migratePostgres();
  } else {
    await migrateSqlite();
  }
}

module.exports = { migrate };
