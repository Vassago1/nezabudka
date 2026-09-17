"use strict";

// Unified async query layer used by store.js and migrate.js. Both engines
// are addressed the same way: `await query(sql, params)` returns
// `{ rows, rowCount }`, and SQL is always written with Postgres-style
// placeholders ($1, $2, ...).
//
// - If DATABASE_URL is set, queries go straight to Postgres via `pg` (this
//   is how the deployed server talks to Neon).
// - If it isn't, we fall back to the local data.sqlite file via node:sqlite
//   for offline local development, translating $1/$2/... to SQLite's `?`
//   placeholders under the hood.

const path = require("node:path");

const DATABASE_URL = process.env.DATABASE_URL;
const isPostgres = !!DATABASE_URL;

let query;

if (isPostgres) {
  const { Pool } = require("pg");
  const pool = new Pool({
    connectionString: DATABASE_URL,
    // Required for Neon/Render-style managed Postgres, which terminates TLS
    // with a certificate that isn't in Node's default trust chain.
    ssl: { rejectUnauthorized: false },
  });

  query = async (sql, params = []) => {
    const result = await pool.query(sql, params);
    return { rows: result.rows, rowCount: result.rowCount };
  };
} else {
  const { DatabaseSync } = require("node:sqlite");

  const dbPath = path.join(__dirname, "..", "data.sqlite");
  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec("PRAGMA journal_mode = WAL;");
  sqlite.exec("PRAGMA foreign_keys = ON;");

  // Every query in this project writes placeholders in ascending order
  // ($1, $2, $3, ...) with params supplied in the same order, so a plain
  // left-to-right replace keeps them aligned with SQLite's positional `?`.
  function toSqliteSql(sql) {
    return sql.replace(/\$\d+/g, "?");
  }

  query = async (sql, params = []) => {
    const stmt = sqlite.prepare(toSqliteSql(sql));
    const trimmed = sql.trim().toUpperCase();
    const returnsRows =
      trimmed.startsWith("SELECT") || trimmed.startsWith("PRAGMA") || trimmed.startsWith("WITH");
    if (returnsRows) {
      const rows = stmt.all(...params);
      return { rows, rowCount: rows.length };
    }
    const info = stmt.run(...params);
    return { rows: [], rowCount: info.changes };
  };
}

module.exports = { query, isPostgres };
