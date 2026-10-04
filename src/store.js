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
                       recorded_on, recorded_by, signature_id)
  VALUES (@user_id, @work_date, @start_time, @end_time, @break_minutes, @work_minutes, @code, @remarks,
          @recorded_on, @recorded_by, @signature_id)
  ON CONFLICT (user_id, work_date) DO UPDATE SET
    start_time = excluded.start_time, end_time = excluded.end_time,
    break_minutes = excluded.break_minutes, work_minutes = excluded.work_minutes,
    code = excluded.code, remarks = excluded.remarks,
    recorded_on = excluded.recorded_on, recorded_by = excluded.recorded_by,
    signature_id = excluded.signature_id, updated_at = CURRENT_TIMESTAMP`;


export class Store {
  constructor(db) {
    this.db = db;
  }

  // ---- Einstellungen --------------------------------------------------------

  async getSettings() {
    const settings = { ...DEFAULT_SETTINGS };
    for (const { key, value } of await this.db.all('SELECT key, value FROM settings')) settings[key] = value ?? '';
    return settings;
  }

  async setSetting(key, value) {
    await this.db.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      [key, value == null ? '' : String(value)],
    );
  }

  // ---- Benutzer -------------------------------------------------------------

  async counts() {
    const row = await this.db.get(`
      SELECT (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM entries) AS entries,
             (SELECT MAX(work_date) FROM entries) AS last_entry
    `);
    return { users: Number(row.users), entries: Number(row.entries), lastEntry: row.last_entry ?? null };
  }

  async countUsers() {
    return Number((await this.db.get('SELECT COUNT(*) AS n FROM users')).n);
  }

  async createUser({ username, passwordHash, role, name, personnelNo = '', onRoster = true, mustChangePassword = false, isOwner = false }) {
    const { lastId } = await this.db.run(`
      INSERT INTO users (username, password_hash, role, name, personnel_no, on_roster, must_change_password, is_owner)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `, [username, passwordHash, role, name, personnelNo, onRoster ? 1 : 0, mustChangePassword ? 1 : 0, isOwner ? 1 : 0]);
    return lastId;
  }

  getUser(id) {
    return this.db.get('SELECT * FROM users WHERE id = ?', [id]);
  }

  getUserByUsername(username) {
    return this.db.get('SELECT * FROM users WHERE username = ?', [username]);
  }

  async updateUser(id, fields) {
    const allowed = ['username', 'name', 'personnel_no', 'on_roster', 'active', 'role', 'password_hash', 'must_change_password', 'signature_id', 'is_owner'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return;
    const args = Object.fromEntries(keys.map((k) => [k, fields[k]]));
    await this.db.run(`UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`, { ...args, id });
  }

  // Einen Zugang vollständig entfernen – nur ohne eigene Zeiteinträge (sonst deaktivieren).
  // Nur für Zugänge ohne eigene Daten (siehe userHasRecords); Arbeitgeber-Unterschriften bleiben ohnehin erhalten.
  async deleteUser(id) {
    await this.db.batch([
      ["DELETE FROM signatures WHERE user_id = ? AND kind = 'employee'", [id]],
      ['DELETE FROM sessions WHERE user_id = ?', [id]],
      ['DELETE FROM users WHERE id = ?', [id]],
    ]);
  }

  // Hat der Zugang Spuren in den Stundenzetteln hinterlassen (eigene oder für andere erfasste Einträge,
  // Arbeitgeber-Unterschrift)? Dann darf er wegen der Aufbewahrungspflicht nur deaktiviert werden.
  async userHasRecords(id) {
    const row = await this.db.get(`
      SELECT EXISTS (SELECT 1 FROM entries WHERE user_id = ? OR recorded_by = ?)
          OR EXISTS (SELECT 1 FROM signatures WHERE user_id = ? AND kind = 'employer') AS used
    `, [id, id, id]);
    return Boolean(Number(row.used));
  }

  countActiveOwners() {
    return this.db.get('SELECT COUNT(*) AS n FROM users WHERE is_owner = 1 AND active = 1').then((r) => Number(r.n));
  }

  listUsers() {
    return this.db.all(`
      SELECT * FROM users ORDER BY is_owner DESC, role = 'admin' DESC, active DESC, name COLLATE NOCASE
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
    const id = await this.addSignature('employee', userId, image);
    await this.updateUser(userId, { signature_id: id });
    return id;
  }

  async setEmployerSignature(userId, image) {
    const id = await this.addSignature('employer', userId, image);
    await this.setSetting('employer_signature_id', id);
    return id;
  }

  // Arbeitgeber-Unterschrift, die an einem Datum gültig war (sonst die älteste vorhandene).
  async employerSignatureAt(isoDate) {
    return await this.db.get(`
      SELECT * FROM signatures WHERE kind = 'employer' AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1
    `, [`${isoDate} 23:59:59`])
      ?? this.db.get(`SELECT * FROM signatures WHERE kind = 'employer' ORDER BY created_at, id LIMIT 1`);
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
      SELECT s.id_hash AS s_id_hash, s.csrf_token AS s_csrf_token, s.flash AS s_flash, s.expires_at AS s_expires_at, u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
      WHERE s.id_hash = ? AND s.expires_at > ?
    `, [idHash, Date.now()]);
    if (!row) return null;
    const { s_id_hash: id_hash, s_csrf_token: csrf_token, s_flash: flash, s_expires_at: expires_at, ...user } = row;
    return { session: { id_hash, csrf_token, flash, expires_at: Number(expires_at), user_id: user.id }, user };
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
    const quote = (v) => {
      if (v == null) return 'NULL';
      if (typeof v === 'number' || typeof v === 'bigint') return String(v);
      return `'${String(v).replace(/'/g, "''")}'`;
    };
    const lines = ['-- Datensicherung Digitale Stundenzettel', 'BEGIN TRANSACTION;'];
    const schema = await this.db.all(`
      SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name != 'sessions'
      ORDER BY type = 'index', name
    `);
    for (const { sql } of schema) lines.push(`${sql.replace(/^CREATE (TABLE|INDEX) (?!IF NOT EXISTS)/, 'CREATE $1 IF NOT EXISTS ')};`);
    for (const table of [...TABLES, 'schema_version']) {
      for (const row of await this.db.all(`SELECT * FROM ${table}`)) {
        const cols = Object.keys(row);
        lines.push(`INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map((c) => quote(row[c])).join(', ')});`);
      }
    }
    lines.push('COMMIT;', '');
    return lines.join('\n');
  }
}
