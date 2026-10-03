// Chef-Bereich: Übersicht aller Zettel, Einsatzliste, PDF-Export, Monatsabschluss, Mitarbeiterverwaltung.
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ZipArchive } from 'archiver';
import express from 'express';
import { generatePassword, hashPassword, passwordProblem, requireAdmin, requireLogin } from '../auth.js';
import { asciiFileName, currentMonthOf, sendPdf } from '../http.js';
import { createPdf, drawEmployeeSheet, drawRoster, pdfToBuffer } from '../pdf.js';
import { buildEmployeeSheet, buildRoster } from '../sheets.js';
import { monthKey, monthLabel, parseMonth } from '../time.js';

export default function adminRoutes({ store }) {
  const router = express.Router();
  router.use(requireLogin, requireAdmin);

  const monthFrom = (req) => {
    const ym = parseMonth(req.query.monat ?? req.body?.monat, req.today);
    const current = currentMonthOf(req.today);
    return monthKey(ym) > monthKey(current) ? current : ym;
  };

  // ---- Übersicht ------------------------------------------------------------

  router.get('/', (req, res) => {
    const ym = monthFrom(req);
    const month = monthKey(ym);
    const entries = store.listMonthEntries(month);
    const rows = store.employeesForMonth(month).map((u) => {
      const own = entries.filter((e) => e.user_id === u.id);
      const lastRecorded = own.map((e) => e.recorded_on).sort().at(-1) ?? null;
      return {
        user: u,
        days: own.length,
        workDays: own.filter((e) => e.work_minutes > 0).length,
        minutes: own.reduce((s, e) => s + e.work_minutes, 0),
        lastRecorded,
        hasSignature: !!u.signature_id,
        unsignedByEmployee: own.filter((e) => !e.signature_id).length,
      };
    });
    const settings = store.getSettings();
    res.render('admin/dashboard', {
      title: 'Übersicht',
      ym,
      month,
      rows,
      totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
      lock: store.getLock(month),
      isCurrentMonth: month === monthKey(currentMonthOf(req.today)),
      employerSignatureSet: !!settings.employer_signature_id,
      exportable: rows.filter((r) => r.days > 0).length,
    });
  });

  // ---- Einsatzliste ---------------------------------------------------------

  router.get('/einsatzliste', (req, res) => {
    const ym = monthFrom(req);
    res.render('admin/roster', {
      title: 'Einsatzliste',
      ym,
      roster: buildRoster(store, ym),
      isCurrentMonth: monthKey(ym) === monthKey(currentMonthOf(req.today)),
    });
  });

  router.get('/einsatzliste/pdf', async (req, res) => {
    const ym = monthFrom(req);
    const roster = buildRoster(store, ym);
    const doc = createPdf(`${roster.title} ${roster.monthLabel}`);
    drawRoster(doc, roster);
    sendPdf(res, await pdfToBuffer(doc), `Einsatzliste_${roster.month}.pdf`);
  });

  // ---- Export für den Steuerberater -----------------------------------------

  const exportSheets = (ym) => store.employeesForMonth(monthKey(ym))
    .filter((u) => u.entry_count > 0)
    .map((u) => ({ user: u, sheet: buildEmployeeSheet(store, u, ym) }));

  const sheetFileName = ({ user, sheet }) => asciiFileName(
    `Stundenzettel_${sheet.month}_${user.personnel_no ? `${user.personnel_no}_` : ''}${user.name}.pdf`,
  );

  // Alles in einer PDF: zuerst die Einsatzliste, dann alle Stundenzettel.
  router.get('/export.pdf', async (req, res) => {
    const ym = monthFrom(req);
    const doc = createPdf(`Stundenzettel ${monthLabel(ym)}`);
    drawRoster(doc, buildRoster(store, ym));
    for (const { sheet } of exportSheets(ym)) drawEmployeeSheet(doc, sheet);
    sendPdf(res, await pdfToBuffer(doc), `Stundenzettel_komplett_${monthKey(ym)}.pdf`, 'attachment');
  });

  // ZIP mit einer PDF pro Mitarbeiter plus Einsatzliste.
  router.get('/export.zip', async (req, res) => {
    const ym = monthFrom(req);
    const month = monthKey(ym);
    const folder = `Stundenzettel_${month}`;
    const files = [];
    const rosterDoc = createPdf(`Einsatzliste ${monthLabel(ym)}`);
    drawRoster(rosterDoc, buildRoster(store, ym));
    files.push([`${folder}/Einsatzliste_${month}.pdf`, await pdfToBuffer(rosterDoc)]);
    for (const item of exportSheets(ym)) {
      const doc = createPdf(`Stundenzettel ${item.user.name} ${monthLabel(ym)}`);
      drawEmployeeSheet(doc, item.sheet);
      files.push([`${folder}/${sheetFileName(item)}`, await pdfToBuffer(doc)]);
    }

    res.set({
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${folder}.zip"`,
      'Cache-Control': 'private, no-store',
    });
    const zip = new ZipArchive({ zlib: { level: 6 } });
    zip.on('error', (err) => res.destroy(err));
    zip.pipe(res);
    for (const [name, buffer] of files) zip.append(buffer, { name });
    await zip.finalize();
  });

  // ---- Datensicherung -------------------------------------------------------

  router.get('/sicherung', async (req, res, next) => {
    const file = path.join(os.tmpdir(), `stundenzettel-${crypto.randomUUID()}.db`);
    try {
      await store.db.backup(file);
      res.download(file, `Stundenzettel_Sicherung_${req.today}.db`, () => fs.rm(file, { force: true }, () => {}));
    } catch (err) {
      fs.rm(file, { force: true }, () => {});
      next(err);
    }
  });

  // ---- Monatsabschluss ------------------------------------------------------

  router.post('/monat/abschliessen', (req, res) => {
    const ym = monthFrom(req);
    store.lockMonth(monthKey(ym), req.user.id);
    req.flash('success', `${monthLabel(ym)} ist abgeschlossen. Mitarbeiter können diesen Monat nicht mehr ändern.`);
    res.redirect(`/admin?monat=${monthKey(ym)}`);
  });

  router.post('/monat/oeffnen', (req, res) => {
    const ym = monthFrom(req);
    store.unlockMonth(monthKey(ym));
    req.flash('info', `${monthLabel(ym)} ist wieder zur Bearbeitung freigegeben.`);
    res.redirect(`/admin?monat=${monthKey(ym)}`);
  });

  // ---- Mitarbeiterverwaltung -----------------------------------------------

  const readUserForm = (body) => ({
    name: String(body.name ?? '').trim(),
    username: String(body.benutzername ?? '').trim(),
    personnel_no: String(body.persnr ?? '').trim(),
    role: body.rolle === 'admin' ? 'admin' : 'employee',
    on_roster: body.einsatzliste ? 1 : 0,
  });

  const userFormProblem = (values, excludeId = null) => {
    if (!values.name) return 'Bitte einen Namen angeben.';
    if (!/^[\w.@-]{3,40}$/.test(values.username)) return 'Der Benutzername darf nur Buchstaben, Zahlen sowie . _ - @ enthalten (3–40 Zeichen).';
    const existing = store.getUserByUsername(values.username);
    if (existing && existing.id !== excludeId) return 'Dieser Benutzername ist bereits vergeben.';
    return null;
  };

  router.get('/mitarbeiter', (req, res) => {
    res.render('admin/employees', {
      title: 'Mitarbeiter',
      users: store.listUsers(),
      values: { on_roster: 1, role: 'employee' },
      suggestedPassword: generatePassword(),
      error: null,
    });
  });

  router.post('/mitarbeiter', async (req, res) => {
    const values = readUserForm(req.body);
    const password = String(req.body.passwort ?? '');
    const error = userFormProblem(values) ?? passwordProblem(password);
    if (error) {
      return res.status(400).render('admin/employees', {
        title: 'Mitarbeiter', users: store.listUsers(), values, suggestedPassword: password || generatePassword(), error,
      });
    }
    store.createUser({
      username: values.username,
      passwordHash: await hashPassword(password),
      role: values.role,
      name: values.name,
      personnelNo: values.personnel_no,
      onRoster: values.on_roster,
      mustChangePassword: true,
    });
    req.flash('success', `${values.name} wurde angelegt.`, [
      `Zugangsdaten für die erste Anmeldung – Benutzername: ${values.username} · Passwort: ${password}`,
      'Bei der ersten Anmeldung wird ein eigenes Passwort vergeben und die Unterschrift hinterlegt.',
    ]);
    res.redirect('/admin/mitarbeiter');
  });

  const loadUser = (req, res, next) => {
    req.target = store.getUser(Number(req.params.id));
    if (!req.target) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Benutzer nicht gefunden.' });
    next();
  };

  const activeAdminCount = () => store.listUsers().filter((u) => u.role === 'admin' && u.active).length;

  router.get('/mitarbeiter/:id', loadUser, (req, res) => {
    res.render('admin/employee-edit', {
      title: req.target.name,
      target: req.target,
      values: req.target,
      signature: store.getSignature(req.target.signature_id),
      suggestedPassword: generatePassword(),
      error: null,
    });
  });

  router.post('/mitarbeiter/:id', loadUser, (req, res) => {
    const values = { ...readUserForm(req.body), active: req.body.aktiv ? 1 : 0 };
    let error = userFormProblem(values, req.target.id);
    const losesAdmin = req.target.role === 'admin' && req.target.active && (values.role !== 'admin' || !values.active);
    if (!error && losesAdmin && activeAdminCount() <= 1) error = 'Es muss mindestens ein aktiver Chef/Administrator bestehen bleiben.';
    if (!error && req.target.id === req.user.id && !values.active) error = 'Sie können sich nicht selbst deaktivieren.';
    if (error) {
      return res.status(400).render('admin/employee-edit', {
        title: req.target.name, target: req.target, values: { ...req.target, ...values },
        signature: store.getSignature(req.target.signature_id), suggestedPassword: generatePassword(), error,
      });
    }
    store.updateUser(req.target.id, values);
    if (!values.active) store.deleteUserSessions(req.target.id);
    req.flash('success', 'Änderungen gespeichert.');
    res.redirect(`/admin/mitarbeiter/${req.target.id}`);
  });

  router.post('/mitarbeiter/:id/passwort', loadUser, async (req, res) => {
    const password = String(req.body.passwort ?? '');
    const problem = passwordProblem(password);
    if (problem) {
      req.flash('error', problem);
      return res.redirect(`/admin/mitarbeiter/${req.target.id}`);
    }
    store.updateUser(req.target.id, { password_hash: await hashPassword(password), must_change_password: 1 });
    store.deleteUserSessions(req.target.id, req.target.id === req.user.id ? req.session.id_hash : '');
    req.flash('success', 'Neues Startpasswort gesetzt.', [
      `Benutzername: ${req.target.username} · Passwort: ${password}`,
      'Bei der nächsten Anmeldung muss ein eigenes Passwort vergeben werden.',
    ]);
    res.redirect(`/admin/mitarbeiter/${req.target.id}`);
  });

  return router;
}
