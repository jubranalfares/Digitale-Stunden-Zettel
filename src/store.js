// Datenzugriff. Alle SQL-Abfragen der Anwendung liegen hier.

export const DEFAULT_SETTINGS = {
  company_name: '',
  roster_title: 'Einsatzliste für Minijobber',
  logo: '',
  employer_signature_id: '',
};

export class Store {
  constructor(db) {
    this.db = db;
  }

  // ---- Einstellungen --------------------------------------------------------

  getSettings() {
    const rows = this.db.prepare('SELECT key, value FROM settings').all();
    const settings = { ...DEFAULT_SETTINGS };
    for (const { key, value } of rows) settings[key] = value ?? '';
    return settings;
  }

  setSetting(key, value) {
    this.db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    ).run(key, value == null ? '' : String(value));
  }

  // ---- Benutzer -------------------------------------------------------------

  countUsers() {
    return this.db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
  }

  createUser({ username, passwordHash, role, name, personnelNo = '', onRoster = true, mustChangePassword = false }) {
    const info = this.db.prepare(`
      INSERT INTO users (username, password_hash, role, name, personnel_no, on_roster, must_change_password)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(username, passwordHash, role, name, personnelNo, onRoster ? 1 : 0, mustChangePassword ? 1 : 0);
    return Number(info.lastInsertRowid);
  }

  getUser(id) {
    return this.db.prepare('SELECT * FROM users WHERE id = ?').get(id);
  }

  getUserByUsername(username) {
    return this.db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  }

  updateUser(id, fields) {
    const allowed = ['username', 'name', 'personnel_no', 'on_roster', 'active', 'role', 'password_hash', 'must_change_password', 'signature_id'];
    const keys = Object.keys(fields).filter((k) => allowed.includes(k));
    if (!keys.length) return;
    const sql = `UPDATE users SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`;
    this.db.prepare(sql).run({ ...fields, id });
  }

  listUsers() {
    return this.db.prepare(`
      SELECT * FROM users ORDER BY role = 'admin' DESC, active DESC, name COLLATE NOCASE
    `).all();
  }

  // Mitarbeiter, die für einen Monat relevant sind: aktiv (und da schon angelegt) oder mit Einträgen im Monat.
  employeesForMonth(month) {
    return this.db.prepare(`
      SELECT u.*,
             (SELECT COUNT(*) FROM entries e WHERE e.user_id = u.id AND substr(e.work_date, 1, 7) = @month) AS entry_count
      FROM users u
      WHERE u.role = 'employee'
        AND ((u.active = 1 AND substr(u.created_at, 1, 7) <= @month) OR EXISTS (
          SELECT 1 FROM entries e WHERE e.user_id = u.id AND substr(e.work_date, 1, 7) = @month))
      ORDER BY u.name COLLATE NOCASE
    `).all({ month });
  }

  // ---- Unterschriften -------------------------------------------------------

  addSignature(kind, userId, image) {
    const info = this.db.prepare('INSERT INTO signatures (kind, user_id, image) VALUES (?, ?, ?)').run(kind, userId, image);
    return Number(info.lastInsertRowid);
  }

  getSignature(id) {
    if (!id) return null;
    return this.db.prepare('SELECT * FROM signatures WHERE id = ?').get(id) ?? null;
  }

  setUserSignature(userId, image) {
    const id = this.addSignature('employee', userId, image);
    this.updateUser(userId, { signature_id: id });
    return id;
  }

  setEmployerSignature(userId, image) {
    const id = this.addSignature('employer', userId, image);
    this.setSetting('employer_signature_id', id);
    return id;
  }

  // Arbeitgeber-Unterschrift, die an einem Datum gültig war (sonst die älteste vorhandene).
  employerSignatureAt(isoDate) {
    if (!this.getSettings().employer_signature_id) return null;
    return this.db.prepare(`
      SELECT * FROM signatures WHERE kind = 'employer' AND created_at <= ? ORDER BY created_at DESC, id DESC LIMIT 1
    `).get(`${isoDate} 23:59:59`)
      ?? this.db.prepare(`SELECT * FROM signatures WHERE kind = 'employer' ORDER BY created_at, id LIMIT 1`).get()
      ?? null;
  }

  // ---- Einträge -------------------------------------------------------------

  getEntry(userId, workDate) {
    return this.db.prepare('SELECT * FROM entries WHERE user_id = ? AND work_date = ?').get(userId, workDate);
  }

  listEntries(userId, month) {
    return this.db.prepare(`
      SELECT * FROM entries WHERE user_id = ? AND substr(work_date, 1, 7) = ? ORDER BY work_date
    `).all(userId, month);
  }

  listMonthEntries(month) {
    return this.db.prepare(`
      SELECT * FROM entries WHERE substr(work_date, 1, 7) = ? ORDER BY work_date
    `).all(month);
  }

  saveEntry(entry) {
    this.db.prepare(`
      INSERT INTO entries (user_id, work_date, start_time, end_time, break_minutes, work_minutes, code, remarks,
                           recorded_on, recorded_by, signature_id)
      VALUES (@user_id, @work_date, @start_time, @end_time, @break_minutes, @work_minutes, @code, @remarks,
              @recorded_on, @recorded_by, @signature_id)
      ON CONFLICT (user_id, work_date) DO UPDATE SET
        start_time = excluded.start_time, end_time = excluded.end_time,
        break_minutes = excluded.break_minutes, work_minutes = excluded.work_minutes,
        code = excluded.code, remarks = excluded.remarks,
        recorded_on = excluded.recorded_on, recorded_by = excluded.recorded_by,
        signature_id = excluded.signature_id, updated_at = CURRENT_TIMESTAMP
    `).run(entry);
  }

  deleteEntry(userId, workDate) {
    this.db.prepare('DELETE FROM entries WHERE user_id = ? AND work_date = ?').run(userId, workDate);
  }

  // ---- Monatsabschluss ------------------------------------------------------

  isLocked(month) {
    return !!this.db.prepare('SELECT 1 FROM month_locks WHERE month = ?').get(month);
  }

  getLock(month) {
    return this.db.prepare('SELECT * FROM month_locks WHERE month = ?').get(month) ?? null;
  }

  lockMonth(month, userId) {
    this.db.prepare('INSERT OR IGNORE INTO month_locks (month, locked_by) VALUES (?, ?)').run(month, userId);
  }

  unlockMonth(month) {
    this.db.prepare('DELETE FROM month_locks WHERE month = ?').run(month);
  }

  // ---- Sitzungen ------------------------------------------------------------

  createSession(idHash, userId, csrfToken, expiresAt) {
    this.db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now());
    this.db.prepare('INSERT INTO sessions (id_hash, user_id, csrf_token, expires_at) VALUES (?, ?, ?, ?)')
      .run(idHash, userId, csrfToken, expiresAt);
  }

  getSession(idHash) {
    return this.db.prepare('SELECT * FROM sessions WHERE id_hash = ? AND expires_at > ?').get(idHash, Date.now());
  }

  touchSession(idHash, expiresAt) {
    this.db.prepare('UPDATE sessions SET expires_at = ? WHERE id_hash = ?').run(expiresAt, idHash);
  }

  setFlash(idHash, flash) {
    this.db.prepare('UPDATE sessions SET flash = ? WHERE id_hash = ?').run(flash ? JSON.stringify(flash) : null, idHash);
  }

  deleteSession(idHash) {
    this.db.prepare('DELETE FROM sessions WHERE id_hash = ?').run(idHash);
  }

  deleteUserSessions(userId, exceptIdHash = '') {
    this.db.prepare('DELETE FROM sessions WHERE user_id = ? AND id_hash != ?').run(userId, exceptIdHash);
  }

  // ---- Protokoll ------------------------------------------------------------

  audit(actorId, userId, workDate, action, data) {
    this.db.prepare('INSERT INTO audit_log (actor_id, user_id, work_date, action, data) VALUES (?, ?, ?, ?, ?)')
      .run(actorId, userId, workDate, action, data == null ? null : JSON.stringify(data));
  }

  listAudit(userId, month) {
    return this.db.prepare(`
      SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
      WHERE a.user_id = ? AND substr(a.work_date, 1, 7) = ? ORDER BY a.id DESC
    `).all(userId, month);
  }
}
