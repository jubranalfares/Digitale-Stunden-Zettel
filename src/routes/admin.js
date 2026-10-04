// Chef-Bereich: Übersicht aller Zettel, Export, Monatsabschluss, Mitarbeiterverwaltung, Sicherung.
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

  router.get('/', async (req, res) => {
    const ym = monthFrom(req);
    const month = monthKey(ym);
    const entries = await store.listMonthEntries(month);
    const rows = (await store.employeesForMonth(month)).map((u) => {
      const own = entries.filter((e) => e.user_id === u.id);
      return {
        user: u,
        days: own.length,
        minutes: own.reduce((s, e) => s + e.work_minutes, 0),
        lastRecorded: own.map((e) => e.recorded_on).sort().at(-1) ?? null,
        hasSignature: !!u.signature_id,
        unsignedByEmployee: own.filter((e) => !e.signature_id).length,
      };
    });
    res.render('admin/dashboard', {
      title: 'Übersicht',
      ym,
      month,
      rows,
      totalMinutes: rows.reduce((s, r) => s + r.minutes, 0),
      lock: await store.getLock(month),
      isCurrentMonth: month === monthKey(currentMonthOf(req.today)),
      employerSignatureSet: !!res.locals.settings.employer_signature_id,
      exportable: rows.filter((r) => r.days > 0).length,
    });
  });

  // ---- Einsatzliste ---------------------------------------------------------

  router.get('/einsatzliste', (req, res) => {
    res.redirect(`/einsatzliste${req.query.monat ? `?monat=${monthKey(monthFrom(req))}` : ''}`);
  });

  router.get('/einsatzliste/pdf', async (req, res) => {
    const roster = await buildRoster(store, monthFrom(req));
    const doc = createPdf(`${roster.title} ${roster.monthLabel}`);
    drawRoster(doc, roster);
    sendPdf(res, await pdfToBuffer(doc), `Einsatzliste_${roster.month}.pdf`);
  });

  // ---- Export für den Steuerberater -----------------------------------------

  const exportSheets = async (ym) => {
    const users = (await store.employeesForMonth(monthKey(ym))).filter((u) => u.entry_count > 0);
    return Promise.all(users.map(async (u) => ({ user: u, sheet: await buildEmployeeSheet(store, u, ym) })));
  };

  const sheetFileName = ({ user, sheet }) => asciiFileName(
    `Stundenzettel_${sheet.month}_${user.personnel_no ? `${user.personnel_no}_` : ''}${user.name}.pdf`,
  );

  // Alles in einer PDF: zuerst die Einsatzliste, dann alle Stundenzettel.
  router.get('/export.pdf', async (req, res) => {
    const ym = monthFrom(req);
    const doc = createPdf(`Stundenzettel ${monthLabel(ym)}`);
    drawRoster(doc, await buildRoster(store, ym));
    for (const { sheet } of await exportSheets(ym)) drawEmployeeSheet(doc, sheet);
    sendPdf(res, await pdfToBuffer(doc), `Stundenzettel_komplett_${monthKey(ym)}.pdf`, 'attachment');
  });

  // ZIP mit einer PDF pro Mitarbeiter plus Einsatzliste.
  router.get('/export.zip', async (req, res) => {
    const ym = monthFrom(req);
    const month = monthKey(ym);
    const folder = `Stundenzettel_${month}`;
    const files = [];
    const rosterDoc = createPdf(`Einsatzliste ${monthLabel(ym)}`);
    drawRoster(rosterDoc, await buildRoster(store, ym));
    files.push([`${folder}/Einsatzliste_${month}.pdf`, await pdfToBuffer(rosterDoc)]);
    for (const item of await exportSheets(ym)) {
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

  router.get('/sicherung', async (req, res) => {
    res.set({
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="Stundenzettel_Sicherung_${req.today}.sql"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(await store.dumpSql());
  });

  // Nur im Demo-Modus: Beispieldaten löschen und echt einrichten.
  router.post('/demo-beenden', async (req, res) => {
    if (!res.locals.settings.demo) return res.redirect('/einstellungen');
    await store.wipeAll();
    res.redirect('/setup');
  });

  // ---- Monatsabschluss ------------------------------------------------------

  router.post('/monat/abschliessen', async (req, res) => {
    const ym = monthFrom(req);
    await store.lockMonth(monthKey(ym), req.user.id);
    await req.flash('success', `${monthLabel(ym)} ist abgeschlossen. Mitarbeiter können diesen Monat nicht mehr ändern.`);
    res.redirect(`/admin?monat=${monthKey(ym)}`);
  });

  router.post('/monat/oeffnen', async (req, res) => {
    const ym = monthFrom(req);
    await store.unlockMonth(monthKey(ym));
    await req.flash('info', `${monthLabel(ym)} ist wieder zur Bearbeitung freigegeben.`);
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

  const userFormProblem = async (values, excludeId = null) => {
    if (!values.name) return 'Bitte einen Namen angeben.';
    if (!/^[\w.@-]{3,40}$/.test(values.username)) return 'Der Benutzername darf nur Buchstaben, Zahlen sowie . _ - @ enthalten (3–40 Zeichen).';
    const existing = await store.getUserByUsername(values.username);
    if (existing && existing.id !== excludeId) return 'Dieser Benutzername ist bereits vergeben.';
    return null;
  };

  router.get('/mitarbeiter', async (req, res) => {
    res.render('admin/employees', {
      title: 'Mitarbeiter',
      users: await store.listUsers(),
      values: { on_roster: 1, role: 'employee' },
      suggestedPassword: generatePassword(),
      error: null,
    });
  });

  router.post('/mitarbeiter', async (req, res) => {
    const values = readUserForm(req.body);
    const password = String(req.body.passwort ?? '');
    const error = await userFormProblem(values) ?? passwordProblem(password);
    if (error) {
      return res.status(400).render('admin/employees', {
        title: 'Mitarbeiter', users: await store.listUsers(), values, suggestedPassword: password || generatePassword(), error,
      });
    }
    await store.createUser({
      username: values.username,
      passwordHash: await hashPassword(password),
      role: values.role,
      name: values.name,
      personnelNo: values.personnel_no,
      onRoster: values.on_roster,
      mustChangePassword: true,
    });
    await req.flash('success', `${values.name} wurde angelegt.`, [
      `Zugangsdaten für die erste Anmeldung – Benutzername: ${values.username} · Passwort: ${password}`,
      'Bei der ersten Anmeldung wird ein eigenes Passwort vergeben und die Unterschrift hinterlegt.',
    ]);
    res.redirect('/admin/mitarbeiter');
  });

  const loadUser = async (req, res, next) => {
    req.target = await store.getUser(Number(req.params.id));
    if (!req.target) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Benutzer nicht gefunden.' });
    next();
  };

  const activeAdminCount = async () => (await store.listUsers()).filter((u) => u.role === 'admin' && u.active).length;

  const renderEdit = async (res, target, values, error = null) => res.status(error ? 400 : 200).render('admin/employee-edit', {
    title: target.name,
    target,
    values,
    signature: await store.getSignature(target.signature_id),
    suggestedPassword: generatePassword(),
    error,
  });

  router.get('/mitarbeiter/:id', loadUser, async (req, res) => {
    await renderEdit(res, req.target, req.target);
  });

  router.post('/mitarbeiter/:id', loadUser, async (req, res) => {
    const values = { ...readUserForm(req.body), active: req.body.aktiv ? 1 : 0 };
    let error = await userFormProblem(values, req.target.id);
    const losesAdmin = req.target.role === 'admin' && req.target.active && (values.role !== 'admin' || !values.active);
    if (!error && losesAdmin && await activeAdminCount() <= 1) error = 'Es muss mindestens ein aktiver Chef/Administrator bestehen bleiben.';
    if (!error && req.target.id === req.user.id && !values.active) error = 'Sie können sich nicht selbst deaktivieren.';
    if (error) return renderEdit(res, req.target, { ...req.target, ...values }, error);

    await store.updateUser(req.target.id, values);
    if (!values.active) await store.deleteUserSessions(req.target.id);
    await req.flash('success', 'Änderungen gespeichert.');
    res.redirect(`/admin/mitarbeiter/${req.target.id}`);
  });

  router.post('/mitarbeiter/:id/passwort', loadUser, async (req, res) => {
    const password = String(req.body.passwort ?? '');
    const problem = passwordProblem(password);
    if (problem) {
      await req.flash('error', problem);
      return res.redirect(`/admin/mitarbeiter/${req.target.id}`);
    }
    await store.updateUser(req.target.id, { password_hash: await hashPassword(password), must_change_password: 1 });
    await store.deleteUserSessions(req.target.id, req.target.id === req.user.id ? req.session.id_hash : '');
    await req.flash('success', 'Neues Startpasswort gesetzt.', [
      `Benutzername: ${req.target.username} · Passwort: ${password}`,
      'Bei der nächsten Anmeldung muss ein eigenes Passwort vergeben werden.',
    ]);
    res.redirect(`/admin/mitarbeiter/${req.target.id}`);
  });

  return router;
}
