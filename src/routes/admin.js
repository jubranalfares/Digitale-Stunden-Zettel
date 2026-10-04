// Chef-Bereich: Mitarbeiter verwalten und Datensicherung.
import express from 'express';
import { generatePassword, hashPassword, passwordProblem, requireAdmin, requireLogin } from '../auth.js';

export default function adminRoutes({ store }) {
  const router = express.Router();
  router.use(requireLogin, requireAdmin);

  router.get('/', (req, res) => res.redirect('/einsatzliste'));

  // ---- Datensicherung -------------------------------------------------------

  router.get('/sicherung', async (req, res) => {
    res.set({
      'Content-Type': 'application/sql; charset=utf-8',
      'Content-Disposition': `attachment; filename="Stundenzettel_Sicherung_${req.today}.sql"`,
      'Cache-Control': 'private, no-store',
    });
    res.send(await store.dumpSql());
  });

  // ---- Mitarbeiterverwaltung (nur Mitarbeiter; Chef-Zugänge verwaltet der Inhaber) ----

  const readUserForm = (body) => ({
    name: String(body.name ?? '').trim(),
    username: String(body.benutzername ?? '').trim(),
    on_roster: body.einsatzliste ? 1 : 0,
  });

  const userFormProblem = async (values, excludeId = null) => {
    if (!values.name) return 'Bitte einen Namen angeben.';
    if (!/^[\w.@-]{3,40}$/.test(values.username)) return 'Der Benutzername darf nur Buchstaben, Zahlen sowie . _ - @ enthalten (3 bis 40 Zeichen).';
    const existing = await store.getUserByUsername(values.username);
    if (existing && existing.id !== excludeId) return 'Dieser Benutzername ist bereits vergeben.';
    return null;
  };

  const renderList = async (res, values = {}, error = null, status = 200) => res.status(status).render('admin/employees', {
    title: 'Mitarbeiter',
    users: (await store.listUsers()).filter((u) => u.role === 'employee'),
    values,
    suggestedPassword: values.password || generatePassword(),
    error,
  });

  router.get('/mitarbeiter', async (req, res) => {
    await renderList(res);
  });

  router.post('/mitarbeiter', async (req, res) => {
    const values = { ...readUserForm(req.body), on_roster: 1 };
    const password = String(req.body.passwort ?? '');
    const error = await userFormProblem(values) ?? passwordProblem(password);
    if (error) return renderList(res, { ...values, password }, error, 400);
    await store.createUser({
      username: values.username,
      passwordHash: await hashPassword(password),
      role: 'employee',
      name: values.name,
      mustChangePassword: true,
    });
    await req.flash('success', `${values.name} wurde angelegt.`, [
      `Benutzername: ${values.username}`,
      `Startpasswort: ${password}`,
      'Bei der ersten Anmeldung legt der Mitarbeiter ein eigenes Passwort fest und unterschreibt einmal.',
    ]);
    res.redirect('/admin/mitarbeiter');
  });

  // Chefs bearbeiten hier nur Mitarbeiter. Andere Chef-/Inhaber-Zugänge sind tabu.
  const loadUser = async (req, res, next) => {
    req.target = await store.getUser(Number(req.params.id));
    if (!req.target || req.target.role !== 'employee') {
      return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Mitarbeiter nicht gefunden.' });
    }
    next();
  };

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
    const error = await userFormProblem(values, req.target.id);
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
      `Benutzername: ${req.target.username}`,
      `Startpasswort: ${password}`,
      'Bei der nächsten Anmeldung wird ein eigenes Passwort festgelegt.',
    ]);
    res.redirect(`/admin/mitarbeiter/${req.target.id}`);
  });

  return router;
}
