import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

// Jede Migration wird genau einmal ausgeführt (PRAGMA user_version zählt mit).
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE users (
    id                   INTEGER PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash        TEXT NOT NULL,
    role                 TEXT NOT NULL CHECK (role IN ('admin', 'employee')),
    name                 TEXT NOT NULL,
    personnel_no         TEXT NOT NULL DEFAULT '',
    on_roster            INTEGER NOT NULL DEFAULT 1,
    active               INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 0,
    signature_id         INTEGER REFERENCES signatures(id),
    created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Unterschriften werden versioniert, damit alte Einträge ihre damalige Unterschrift behalten.
  CREATE TABLE signatures (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('employee', 'employer')),
    user_id    INTEGER NOT NULL REFERENCES users(id),
    image      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE entries (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL REFERENCES users(id),
    work_date     TEXT NOT NULL,
    start_time    INTEGER,
    end_time      INTEGER,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    work_minutes  INTEGER NOT NULL DEFAULT 0,
    code          TEXT,
    remarks       TEXT NOT NULL DEFAULT '',
    recorded_on   TEXT NOT NULL,
    recorded_by   INTEGER NOT NULL REFERENCES users(id),
    signature_id  INTEGER REFERENCES signatures(id),
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, work_date)
  );
  CREATE INDEX entries_by_date ON entries (work_date);

  CREATE TABLE month_locks (
    month     TEXT PRIMARY KEY,
    locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_by INTEGER REFERENCES users(id)
  );

  CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    flash      TEXT,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id   INTEGER REFERENCES users(id),
    user_id    INTEGER REFERENCES users(id),
    work_date  TEXT,
    action     TEXT NOT NULL,
    data       TEXT
  );
  `,
];

export function openDatabase(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db);
  return db;
}

function migrate(db) {
  const current = db.pragma('user_version', { simple: true });
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v]);
      db.pragma(`user_version = ${v + 1}`);
    })();
  }
}
