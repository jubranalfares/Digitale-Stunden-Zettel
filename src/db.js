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

  CREATE TABLE sessions (
    id_hash    TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL,
    csrf_token TEXT NOT NULL,
    flash      TEXT,
    expires_at INTEGER NOT NULL
  );

  `,
  ensureOwnerColumn,
  async (db) => {
    // Beide zwischenzeitlich ausgelieferten Version-2-Stände unterstützen:
    // Hauptbranch mit Inhaberrecht und Formularbranch mit Signaturversionen.
    await ensureOwnerColumn(db);
    const columns = await db.all('PRAGMA table_info(entries)');
    if (!columns.some((c) => c.name === 'employer_signature_id')) {
      await db.run('ALTER TABLE entries ADD COLUMN employer_signature_id INTEGER');
      await db.run(`UPDATE entries SET employer_signature_id = (
        SELECT id FROM signatures WHERE kind = 'employer' AND created_at <= entries.created_at
        ORDER BY created_at DESC, id DESC LIMIT 1
      )`);
    }
  },
];

async function ensureOwnerColumn(db) {
  const columns = await db.all('PRAGMA table_info(users)');
  if (!columns.some((c) => c.name === 'is_owner')) {
    await db.run('ALTER TABLE users ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0');
    await db.run("UPDATE users SET is_owner = 1 WHERE id = (SELECT MIN(id) FROM users WHERE role = 'admin')");
  }
}

export const isLocalUrl = (url) => url === ':memory:' || url.startsWith('file:');

// Lokales libSQL arbeitet synchron. Eine zweite Verbindung darf deshalb nicht
// auf eine Schreibtransaktion warten, deren Fortsetzung denselben Event-Loop braucht.
// Pro Datei wird die gesamte Transaktion eingereiht; Turso verwaltet seine Sperren selbst.
const localQueues = new Map();
async function serializeLocal(key, fn) {
  const previous = localQueues.get(key) ?? Promise.resolve();
  const result = previous.then(fn);
  const tail = result.catch(() => {});
  localQueues.set(key, tail);
  try { return await result; }
  finally { if (localQueues.get(key) === tail) localQueues.delete(key); }
}

// SQLite meldet bei parallelen Schreibzugriffen sicher "nicht ausgeführt".
// Nur diesen Fall wiederholen; Netzwerk-/Commit-Fehler niemals blind wiederholen.
async function retryBusy(fn) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); } catch (error) {
      if (attempt >= 5 || !['SQLITE_BUSY', 'SQLITE_LOCKED'].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 20 * (attempt + 1)));
    }
  }
}

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
  constructor(client, schedule = (fn) => fn()) {
    this.client = client;
    this.schedule = schedule;
  }

  async all(sql, args) {
    return this.schedule(async () => (await retryBusy(() => this.client.execute(statement(sql, args)))).rows);
  }

  async get(sql, args) {
    return (await this.all(sql, args))[0] ?? null;
  }

  async run(sql, args) {
    return this.schedule(async () => {
      const r = await retryBusy(() => this.client.execute(statement(sql, args)));
      return { changes: r.rowsAffected, lastId: r.lastInsertRowid == null ? null : Number(r.lastInsertRowid) };
    });
  }

  // Mehrere Anweisungen atomar (alle oder keine).
  async batch(statements) {
    return this.schedule(() => this.client.batch(statements.map(([sql, args]) => statement(sql, args)), 'write'));
  }

  async transaction(fn, mode = 'write') {
    return this.schedule(async () => {
      const tx = await retryBusy(() => this.client.transaction(mode));
      try {
        const result = await fn(new Database(tx));
        await tx.commit();
        return result;
      } catch (error) {
        if (!tx.closed) await tx.rollback();
        throw error;
      } finally {
        tx.close();
      }
    });
  }

  async migrate() {
    await this.run('CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)');
    // Die Versionsprüfung gehört in dieselbe Schreibtransaktion wie die Migration.
    // Das verhindert doppelte ALTER TABLE bei parallelen Serverless-Kaltstarts.
    await this.transaction(async (db) => {
      const row = await db.get('SELECT version FROM schema_version');
      const current = row ? Number(row.version) : 0;
      for (let v = current; v < MIGRATIONS.length; v++) {
        const migration = MIGRATIONS[v];
        if (typeof migration === 'function') await migration(db);
        else {
          const statements = migration.split(/;\s*\n/)
            .map((s) => s.replace(/--.*$/gm, '').trim()).filter(Boolean)
            .map((s) => s.replace(/^CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/, 'CREATE $1 IF NOT EXISTS '));
          for (const sql of statements) await db.run(sql);
        }
        await db.run('DELETE FROM schema_version');
        await db.run('INSERT INTO schema_version (version) VALUES (?)', [v + 1]);
      }
    });
  }

  close() {
    this.client.close();
  }
}

export async function openDatabase({ dbUrl, dbAuthToken }) {
  let client;
  let schedule;
  if (isLocalUrl(dbUrl)) {
    if (dbUrl.startsWith('file:')) fs.mkdirSync(path.dirname(dbUrl.slice(5)), { recursive: true });
    const { createClient } = await import('@libsql/client');
    client = createClient({ url: dbUrl, timeout: 100 });
    const key = dbUrl === ':memory:' ? Symbol('memory') : path.resolve(dbUrl.slice(5));
    schedule = (fn) => serializeLocal(key, fn);
  } else {
    // Reiner HTTP-Client ohne native Module – ideal für Vercel & Co.
    const { createClient } = await import('@libsql/client/web');
    client = createClient({ url: dbUrl, authToken: dbAuthToken });
  }
  const db = new Database(client, schedule);
  try {
    if (isLocalUrl(dbUrl)) await db.run('PRAGMA journal_mode = WAL');
    await db.migrate();
  } catch (error) { db.close(); throw error; }
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

  async transaction(...args) { return (await this.ready()).transaction(...args); }

  async close() {
    if (this.promise) (await this.promise).close();
  }
}
