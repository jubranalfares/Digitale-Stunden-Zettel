// Datenzugriff. Alle SQL-Abfragen der Anwendung liegen hier.

export const DEFAULT_SETTINGS = {
  company_name: '',
  roster_title: 'Einsatzliste für Minijobber',
  logo: '',
  employer_signature_id: '',
};

const TABLES = ['settings', 'users', 'signatures', 'entries'];

const SAVE_ENTRY_SQL = `
  INSERT INTO entries (user_id, work_date, start_time, end_time, break_minutes, work_minutes, code, remarks,
                       recorded_on, recorded_by, signature_id, employer_signature_id, updated_at)
  VALUES (@user_id, @work_date, @start_time, @end_time, @break_minutes, @work_minutes, @code, @remarks,
          @recorded_on, @recorded_by, @signature_id, @employer_signature_id, strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  ON CONFLICT (user_id, work_date) DO UPDATE SET
    start_time = excluded.start_time, end_time = excluded.end_time,
    break_minutes = excluded.break_minutes, work_minutes = excluded.work_minutes,
    code = excluded.code, remarks = excluded.remarks,
    recorded_on = excluded.recorded_on, recorded_by = excluded.recorded_by,
    signature_id = excluded.signature_id, employer_signature_id = excluded.employer_signature_id,
    updated_at = excluded.updated_at`;


export class Store {
  constructor(db, inTransaction = false) {
    this.db = db;
    this.inTransaction = inTransaction;
  }

  atomic(fn, mode = 'write') {
    if (this.inTransaction) return fn(this);
    return this.db.transaction((db) => fn(new Store(db, true)), mode);
  }

  // ---- Einstellungen --------------------------------------------------------

  async getSettings() {
    const settings = { ...DEFAULT_SETTINGS };
    for (const { key, value } of await this.db.all("SELECT key, value FROM settings WHERE key NOT LIKE 'login:%'")) settings[key] = value ?? '';
    return settings;
  }

  async setSetting(key, value) {
    await this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value == null ? '' : String(value)],
    );
  }

  // ---- Benutzer -------------------------------------------------------------

  async countUsers() {
    return Number((await this.db.get('SELECT COUNT(*) AS n FROM users')).n);
  }

  async createUser({ username, passwordHash, role, name, onRoster = true, mustChangePassword = false }) {
    const { lastId } = await this.db.run(`
      INSERT INTO users (username, password_hash, role, name, on_roster, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?)
    `, [username, passwordHash, role, name, onRoster ? 1 : 0, mustChangePassword ? 1 : 0]);
    return lastId;
  }

  createInitialAdmin(company, user) {
    return this.atomic(async (store) => {
      if (await store.countUsers()) return null;
      const id = await store.createUser(user);
      await store.setSetting('company_name', company);
      return id;
    });
  }

  getUser(id) {
    return this.db.get('SELECT * FROM users WHERE id = ?', [id]);
  }

  getUserByUsername(username) {
    return this.db.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  async updateUser(id, fields) {
    const allowed = ['username', 'name', 'on_roster', 'active', 'password_hash', 'must_change_password', 'signature_id'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return;
    const args = Object.fromEntries(keys.map((k) => [k, fields[k]]));
    await this.db.run(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`, { ...args, id });
  }

  listUsers() {
    return this.db.all(`
      SELECT * FROM users ORDER BY role = 'admin' DESC, active DESC, name COLLATE NOCASE
    `);
  }

  // Mitarbeiter, die für einen Monat relevant sind: aktiv (und da schon angelegt) oder mit Einträgen im Monat.
  employeesForMonth(month) {
    return this.db.all(`
      SELECT u.*,
             (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND substr(e.work_date, 1, 7) = @month) AS entry_count
      FROM users u
      WHERE u.role = 'employee'
        AND ((u.active = 1 AND substr(u.created_at, 1, 7) <= @month) OR EXISTS (
          SELECT 1 FROM entries e WHERE e.user_id = u.id AND substr(e.work_date, 1, 7) = @month))
      ORDER BY u.name COLLATE NOCASE
    `, { month });
  }

  // ---- Unterschriften -------------------------------------------------------

  async addSignature(kind, userId, image) {
    return (await this.db.run('INSERT INTO signatures (kind, user_id, image) VALUES (?, ?, ?)', [kind, userId, image])).lastId;
  }

  async getSignature(id) {
    if (!id) return null;
    return this.db.get('SELECT * FROM signatures WHERE id = ?', [Number(id)]);
  }

  async getSignatureImages(ids) {
    const unique = [...new Set(ids.filter(Boolean).map(Number))];
    if (!unique.length) return new Map();
    const rows = await this.db.all(`SELECT id, image FROM signatures WHERE id IN (${unique.map(() => '?').join(', ')})`, unique);
    return new Map(rows.map((r) => [r.id, r.image]));
  }

  async setUserSignature(userId, image) {
    if (!this.inTransaction) return this.atomic((store) => store.setUserSignature(userId, image));
    const id = await this.addSignature('employee', userId, image);
    await this.updateUser(userId, { signature_id: id });
    return id;
  }

  async setEmployerSignature(userId, image) {
    if (!this.inTransaction) return this.atomic((store) => store.setEmployerSignature(userId, image));
    const id = await this.addSignature('employer', userId, image);
    await this.setSetting('employer_signature_id', id);
    return id;
  }

  // ---- Einträge -------------------------------------------------------------

  getEntry(userId, workDate) {
    return this.db.get('SELECT * FROM entries WHERE user_id = ? AND work_date = ?', [userId, workDate]);
  }

  listEntries(userId, month) {
    return this.db.all(`
      SELECT * FROM entries WHERE user_id = ? AND substr(work_date, 1, 7) = ? ORDER BY work_date
    `, [userId, month]);
  }

  listMonthEntries(month) {
    return this.db.all('SELECT * FROM entries WHERE substr(work_date, 1, 7) = ? ORDER BY work_date', [month]);
  }

  async saveEntry(entry) {
    await this.db.run(SAVE_ENTRY_SQL, entry);
  }

  async saveEntries(entries) {
    if (entries.length) await this.db.batch(entries.map((e) => [SAVE_ENTRY_SQL, e]));
  }

  async deleteEntry(userId, workDate) {
    await this.db.run('DELETE FROM entries WHERE user_id = ? AND work_date = ?', [userId, workDate]);
  }

  // ---- Sitzungen ------------------------------------------------------------

  async createSession(idHash, userId, csrfToken, expiresAt) {
    await this.db.batch([
      ['DELETE FROM sessions WHERE expires_at < ?', [Date.now()]],
      ['INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)', [idHash, userId, csrfToken, expiresAt]],
    ]);
  }

  // Sitzung samt Benutzer in einer Abfrage (spart online einen Datenbank-Aufruf pro Seite).
  async getSessionWithUser(idHash) {
    const row = await this.db.get(`
      SELECT s.id_hash AS s_id_hash, s.user_id AS s_user_id, s.csrf_token AS s_csrf_token, s.flash AS s_flash, s.expires_at AS s_expires_at, u.*
      FROM sessions s LEFT JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ?
    `, [idHash, Date.now()]);
    if (!row) return null;
    const { s_id_hash: id_hash, s_user_id: user_id, s_csrf_token: csrf_token, s_flash: flash, s_expires_at: expires_at, ...user } = row;
    return { session: { id_hash, csrf_token, flash, expires_at: Number(expires_at), user_id }, user: user.id ? user : null };
  }

  async touchSession(idHash, expiresAt) {
    await this.db.run('UPDATE sessions SET expires_at = ? WHERE id_hash = ?', [expiresAt, idHash]);
  }

  async setFlash(idHash, flash) {
    await this.db.run('UPDATE sessions SET flash = ? WHERE id_hash = ?', [flash ? JSON.stringify(flash) : null, idHash]);
  }

  async deleteSession(idHash) {
    await this.db.run('DELETE FROM sessions WHERE id_hash = ?', [idHash]);
  }

  async deleteUserSessions(userId, exceptIdHash = '') {
    await this.db.run('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?', [userId, exceptIdHash]);
  }

  // ---- Sicherung ------------------------------------------------------------

  // SQL-Datei mit allen Daten; einspielbar mit `sqlite3 neu.db < datei.sql` bzw. `turso db shell … < datei.sql`.
  async dumpSql() {
    if (!this.inTransaction) return this.atomic((store) => store.dumpSql(), 'read');
    const quote = (v) => {
      if (v == null) return 'NULL';
      if (typeof v === 'number' || typeof v === 'bigint') return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    };
    const lines = ['-- Datensicherung Digitale Stundenzettel', 'BEGIN TRANSACTION;'];
    const schema = await this.db.all(`
      SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
        AND (name IN ('settings','users','signatures','entries','sessions','schema_version') OR tbl_name = 'entries')
      ORDER BY type = 'index', name
    `);
    for (const { sql } of schema) lines.push(`${sql.replace(/^CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/, 'CREATE $1 IF NOT EXISTS ')};`);
    for (const table of [...TABLES, 'schema_version']) {
      for (const row of await this.db.all(`SELECT * FROM ${table}${table === 'settings' ? " WHERE key NOT LIKE 'login:%'" : ''}`)) {
        const cols = Object.keys(row);
        lines.push(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => quote(row[c])).join(', ')});`);
      }
    }
    lines.push('COMMIT;', '');
    return lines.join('\n');
  }
}
