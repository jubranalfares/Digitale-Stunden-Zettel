// Datenbank: SQLite-kompatibel über libSQL.
// Lokal eine Datei (file:data/stundenzettel.db), online z. B. Turso (libsql://…).
import fs from 'node:fs';
import path from 'node:path';

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
    signature_id         INTEGER,
    created_at           TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  -- Unterschriften werden versioniert, damit alte Einträge ihre damalige Unterschrift behalten.
  CREATE TABLE signatures (
    id         INTEGER PRIMARY KEY,
    kind       TEXT NOT NULL CHECK (kind IN ('employee', 'employer')),
    user_id    INTEGER NOT NULL,
    image      TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE entries (
    id            INTEGER PRIMARY KEY,
    user_id       INTEGER NOT NULL,
    work_date     TEXT NOT NULL,
    start_time    INTEGER,
    end_time      INTEGER,
    break_minutes INTEGER NOT NULL DEFAULT 0,
    work_minutes  INTEGER NOT NULL DEFAULT 0,
    code          TEXT,
    remarks       TEXT NOT NULL DEFAULT '',
    recorded_on   TEXT NOT NULL,
    recorded_by   INTEGER NOT NULL,
    signature_id  INTEGER,
    created_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at    TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, work_date)
  );
  CREATE INDEX entries_by_date ON entries (work_date);

  CREATE TABLE month_locks (
    month     TEXT PRIMARY KEY,
    locked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    locked_by INTEGER
  );

  CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    csrf_token TEXT NOT NULL,
    flash      TEXT,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE audit_log (
    id         INTEGER PRIMARY KEY,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actor_id   INTEGER,
    user_id    INTEGER,
    work_date  TEXT,
    action     TEXT NOT NULL,
    data       TEXT
  );
  `,
];

export const isLocalUrl = (url) => url === ':memory:' || url.startsWith('file:');

// Benannte Parameter (@name) in einfache ?-Parameter umwandeln – funktioniert lokal und online gleich.
function statement(sql, args = []) {
  if (Array.isArray(args)) return { sql, args };
  const values = [];
  const text = sql.replace(/@(\w+)/g, (_, name) => {
    values.push(args[name] ?? null);
    return '?';
  });
  return { sql: text, args: values };
}

// Dünne Hülle um den libSQL-Client mit den Abfragen, die die App braucht.
export class Database {
  constructor(client) {
    this.client = client;
  }

  async all(sql, args) {
    return (await this.client.execute(statement(sql, args))).rows;
  }

  async get(sql, args) {
    return (await this.all(sql, args))[0] ?? null;
  }

  async run(sql, args) {
    const r = await this.client.execute(statement(sql, args));
    return { changes: r.rowsAffected, lastId: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
  }

  // Mehrere Anweisungen atomar (alle oder keine).
  async batch(statements) {
    return this.client.batch(statements.map(([sql, args]) => statement(sql, args)), 'write');
  }

  async migrate() {
    await this.client.execute('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    const row = await this.get('SELECT version FROM schema_version');
    const current = row ? Number(row.version) : 0;
    for (let v = current; v < MIGRATIONS.length; v++) {
      // "IF NOT EXISTS", damit zwei gleichzeitig startende Server (z. B. auf Vercel) sich nicht stören.
      const statements = MIGRATIONS[v].split(/;\s*\n/)
        .map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)
        .map((s) => s.replace(/^CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/, 'CREATE $1 IF NOT EXISTS '));
      await this.batch([
        ...statements.map((s) => [s]),
        ['DELETE FROM schema_version'],
        ['INSERT INTO schema_version (version) VALUES (?)', [v + 1]],
      ]);
    }
  }

  close() {
    this.client.close();
  }
}

export async function openDatabase({ dbUrl, dbAuthToken }) {
  let client;
  if (isLocalUrl(dbUrl)) {
    if (dbUrl.startsWith('file:')) fs.mkdirSync(path.dirname(dbUrl.slice(5)), { recursive: true });
    const { createClient } = await import('@libsql/client');
    client = createClient({ url: dbUrl });
    await client.execute('PRAGMA journal_mode = WAL').catch(() => {});
    await client.execute('PRAGMA busy_timeout = 5000').catch(() => {});
  } else {
    // Reiner HTTP-Client ohne native Module – ideal für Vercel & Co.
    const { createClient } = await import('@libsql/client/web');
    client = createClient({ url: dbUrl, authToken: dbAuthToken });
  }
  const db = new Database(client);
  await db.migrate();
  return db;
}

// Öffnet die Datenbank erst beim ersten Zugriff – so kann die App synchron erstellt werden (wichtig für Vercel).
export class LazyDatabase {
  constructor(config) {
    this.config = config;
    this.promise = null;
  }

  ready() {
    this.promise ??= openDatabase(this.config).catch((err) => {
      this.promise = null;
      // Markieren, damit die App eine verständliche Seite statt eines allgemeinen Fehlers zeigt.
      throw Object.assign(err, { databaseUnavailable: true });
    });
    return this.promise;
  }

  async all(...args) { return (await this.ready()).all(...args); }

  async get(...args) { return (await this.ready()).get(...args); }

  async run(...args) { return (await this.ready()).run(...args); }

  async batch(...args) { return (await this.ready()).batch(...args); }

  async close() {
    if (this.promise) (await this.promise).close();
  }
}
