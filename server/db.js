"use strict";

const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const dbPath = path.join(__dirname, "..", "data.sqlite");
const db = new DatabaseSync(dbPath);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS patients (
    id TEXT PRIMARY KEY,
    companion_name TEXT NOT NULL DEFAULT 'Незабудка',
    pairing_code TEXT UNIQUE NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    virtual_offset INTEGER NOT NULL DEFAULT 0,
    theme TEXT NOT NULL DEFAULT 'light',
    sound_enabled INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS doctors (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS doctor_notices (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    seen_at TEXT
  );

  CREATE TABLE IF NOT EXISTS doctor_patient_links (
    doctor_id TEXT NOT NULL,
    patient_id TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    PRIMARY KEY (doctor_id, patient_id)
  );

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
  );

  CREATE TABLE IF NOT EXISTS completions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    obligation_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    date TEXT NOT NULL,
    UNIQUE(obligation_id, date)
  );

  CREATE TABLE IF NOT EXISTS mood_journal (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    date TEXT NOT NULL,
    mood TEXT,
    note TEXT,
    UNIQUE(patient_id, date)
  );

  CREATE TABLE IF NOT EXISTS rewards (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    name TEXT NOT NULL,
    cost INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS rewards_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    patient_id TEXT NOT NULL,
    reward_id TEXT,
    name TEXT NOT NULL,
    cost INTEGER NOT NULL,
    date TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS doctor_messages (
    id TEXT PRIMARY KEY,
    doctor_id TEXT NOT NULL,
    patient_id TEXT NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL,
    read_at TEXT
  );

  CREATE TABLE IF NOT EXISTS schedule_notices (
    id TEXT PRIMARY KEY,
    patient_id TEXT NOT NULL,
    doctor_id TEXT NOT NULL,
    doctor_name TEXT NOT NULL,
    summary TEXT NOT NULL,
    created_at TEXT NOT NULL,
    seen_at TEXT
  );
`);

// ---------- migrations for columns added after the initial release ----------
// node:sqlite has no "ADD COLUMN IF NOT EXISTS", so check existing columns first.
function ensureColumn(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  const exists = cols.some((c) => c.name === column);
  if (!exists) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn("doctors", "password_hash", "password_hash TEXT");
ensureColumn("doctors", "session_token", "session_token TEXT");

ensureColumn("patients", "recovery_code", "recovery_code TEXT");
ensureColumn("patients", "pairing_code_generated_at", "pairing_code_generated_at TEXT");
ensureColumn("patients", "mood_diary_shared", "mood_diary_shared INTEGER NOT NULL DEFAULT 0");

module.exports = db;
