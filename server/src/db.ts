// SQLite storage (node:sqlite, built into Node 24). The server only ever stores ciphertext for
// journal contents and shared packages; see docs/tidecloak-findings.md.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type Db = DatabaseSync;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  username      TEXT NOT NULL UNIQUE,   -- TideCloak username: how a verified token maps to a user
  name          TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('patient', 'professional')),
  profession    TEXT,
  tide_user_key TEXT                    -- copied from the user's verified token when they sign in
);

CREATE TABLE IF NOT EXISTS entries (
  id         TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  type       TEXT NOT NULL CHECK (type IN ('habit', 'mood', 'symptom')),
  logged_at  TEXT NOT NULL,
  ciphertext TEXT NOT NULL,             -- encrypted in the patient's browser
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS shares (
  id                 TEXT PRIMARY KEY,
  patient_id         TEXT NOT NULL REFERENCES users(id),
  recipient_id       TEXT NOT NULL REFERENCES users(id),
  entry_ids          TEXT NOT NULL,     -- JSON array of entry ids
  range_from         TEXT,
  range_to           TEXT,
  expires_at         TEXT NOT NULL,
  status             TEXT NOT NULL CHECK (status IN ('active', 'withdrawn', 'expired')),
  created_at         TEXT NOT NULL,
  package_id         TEXT NOT NULL UNIQUE,
  package_ciphertext TEXT,              -- set to NULL when the share is withdrawn or expires
  recipient_policy   TEXT               -- set to NULL when the share is withdrawn or expires
);

CREATE TABLE IF NOT EXISTS audit_events (
  seq        INTEGER PRIMARY KEY AUTOINCREMENT,
  id         TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES users(id),
  share_id   TEXT REFERENCES shares(id),
  action     TEXT NOT NULL CHECK (action IN ('created', 'viewed', 'withdrawn', 'expired', 'denied')),
  actor_id   TEXT NOT NULL,
  at         TEXT NOT NULL
);
`;

// Children before parents, so foreign keys never block a reset.
const TABLES = ['audit_events', 'shares', 'entries', 'users'];

export function openDb(path: string): Db {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

/** Deletes all demo data. Keeps users' Tide keys unless `keepTideKeys` is false. */
export function clearDb(db: Db, { keepTideKeys = true } = {}): Map<string, string> {
  const keys = new Map<string, string>();
  if (keepTideKeys) {
    const rows = db.prepare('SELECT username, tide_user_key FROM users WHERE tide_user_key IS NOT NULL').all();
    for (const row of rows) keys.set(String(row.username), String(row.tide_user_key));
  }
  for (const table of TABLES) db.exec(`DELETE FROM ${table};`);
  db.exec("DELETE FROM sqlite_sequence WHERE name = 'audit_events';");
  return keys;
}

/** Runs `fn` in a transaction; inside an open one it just runs `fn`. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn();
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
