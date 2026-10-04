// Inhaber-Bereich (nur Betreiber): Chef-Zugänge anlegen/entfernen und Rollen verteilen.
// Inhaber ist der erste angelegte Zugang; weitere Inhaber kann ein Inhaber ernennen.
// Für alle anderen existiert dieser Bereich nicht (404).
import express from 'express';
import { generatePassword, hashPassword, passwordProblem, requireLogin, requireOwner } from '../auth.js';

export default function ownerRoutes({ store }) {
  const router = express.Router();
  router.use('/inhaber', requireLogin, requireOwner);

  const activeAdmins = async () => (await store.listUsers()).filter((u) => u.role === 'admin' && u.active);
  const back = (res) => res.redirect('/inhaber');

  const renderPanel = async (res, { values = {}, error = null, status = 200 } = {}) => {
    res.status(status).render('owner', {
      title: 'Inhaber',
      users: await store.listUsers(),
      values,
      suggestedPassword: values.password || generatePassword(),
      error,
    });
  };

  router.get('/inhaber', async (req, res) => {
    await renderPanel(res);
  });

  // Neuen Chef-Zugang anlegen
  router.post('/inhaber/chef', async (req, res) => {
    const name = String(req.body.name ?? '').trim().slice(0, 80);
    const username = String(req.body.benutzername ?? '').trim();
    const password = String(req.body.passwort ?? '');
    let error = null;
    if (!name) error = 'Bitte einen Namen angeben.';
    else if (!/^[\w.@-]{3,40}$/.test(username)) error = 'Der Benutzername darf nur Buchstaben, Zahlen sowie . _ - @ enthalten (3–40 Zeichen).';
    else if (await store.getUserByUsername(username)) error = 'Dieser Benutzername ist bereits vergeben.';
    else error = passwordProblem(password);
    if (error) return renderPanel(res, { values: { name, username, password }, error, status: 400 });

    await store.createUser({
      username, passwordHash: await hashPassword(password), role: 'admin', name, onRoster: false, mustChangePassword: true,
    });
    await req.flash('success', `Chef-Zugang für ${name} angelegt.`, [
      `Zugangsdaten für die erste Anmeldung – Benutzername: ${username} · Passwort: ${password}`,
      'Beim ersten Login vergibt der neue Chef ein eigenes Passwort.',
    ]);
    back(res);
  });

  const loadTarget = async (req, res, next) => {
    req.target = await store.getUser(Number(req.params.id));
    if (!req.target) return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Benutzer nicht gefunden.' });
    next();
  };

  // Rolle wechseln (Chef <-> Mitarbeiter). Inhaber-Zugänge werden hier nicht herabgestuft.
  router.post('/inhaber/benutzer/:id/rolle', loadTarget, async (req, res) => {
    const role = req.body.rolle === 'admin' ? 'admin' : 'employee';
    if (req.target.is_owner) {
      await req.flash('error', 'Einem Inhaber muss zuerst das Inhaber-Recht entzogen werden.');
      return back(res);
    }
    if (role === req.target.role) return back(res);
    if (role === 'employee' && req.target.role === 'admin' && (await activeAdmins()).length <= 1) {
      await req.flash('error', 'Es muss mindestens ein aktiver Chef bestehen bleiben.');
      return back(res);
    }
    await store.updateUser(req.target.id, { role, on_roster: role === 'admin' ? 0 : 1 });
    await req.flash('success', `${req.target.name} ist jetzt ${role === 'admin' ? 'Chef' : 'Mitarbeiter'}.`);
    back(res);
  });

  // Aktiv/Inaktiv
  router.post('/inhaber/benutzer/:id/aktiv', loadTarget, async (req, res) => {
    const active = req.body.aktiv ? 1 : 0;
    if (!active && req.target.id === req.user.id) {
      await req.flash('error', 'Sie können sich nicht selbst deaktivieren.');
      return back(res);
    }
    if (!active && req.target.is_owner && await store.countActiveOwners() <= 1) {
      await req.flash('error', 'Es muss mindestens ein aktiver Inhaber bestehen bleiben.');
      return back(res);
    }
    if (!active && req.target.role === 'admin' && req.target.active && (await activeAdmins()).length <= 1) {
      await req.flash('error', 'Es muss mindestens ein aktiver Chef bestehen bleiben.');
      return back(res);
    }
    await store.updateUser(req.target.id, { active });
    if (!active) await store.deleteUserSessions(req.target.id);
    await req.flash('success', `${req.target.name} ist jetzt ${active ? 'aktiv' : 'deaktiviert'}.`);
    back(res);
  });

  // Inhaber-Recht vergeben/entziehen (nur für Chefs, nicht für sich selbst)
  router.post('/inhaber/benutzer/:id/inhaber', loadTarget, async (req, res) => {
    if (req.target.id === req.user.id) {
      await req.flash('error', 'Ihr eigenes Inhaber-Recht können Sie hier nicht ändern.');
      return back(res);
    }
    const makeOwner = !req.target.is_owner;
    if (makeOwner && req.target.role !== 'admin') {
      await req.flash('error', 'Nur ein Chef kann Inhaber-Rechte erhalten.');
      return back(res);
    }
    if (!makeOwner && await store.countActiveOwners() <= 1) {
      await req.flash('error', 'Es muss mindestens ein aktiver Inhaber bestehen bleiben.');
      return back(res);
    }
    await store.updateUser(req.target.id, { is_owner: makeOwner ? 1 : 0 });
    await req.flash('success', `${req.target.name} ${makeOwner ? 'hat jetzt Inhaber-Rechte' : 'hat keine Inhaber-Rechte mehr'}.`);
    back(res);
  });

  // Startpasswort neu setzen
  router.post('/inhaber/benutzer/:id/passwort', loadTarget, async (req, res) => {
    const password = String(req.body.passwort ?? '');
    const problem = passwordProblem(password);
    if (problem) {
      await req.flash('error', problem);
      return back(res);
    }
    await store.updateUser(req.target.id, { password_hash: await hashPassword(password), must_change_password: 1 });
    await store.deleteUserSessions(req.target.id, req.target.id === req.user.id ? req.session.id_hash : '');
    await req.flash('success', `Neues Startpasswort für ${req.target.name} gesetzt.`, [
      `Benutzername: ${req.target.username} · Passwort: ${password}`,
    ]);
    back(res);
  });

  // Zugang endgültig entfernen (nur ohne Spuren im Heft, sonst deaktivieren)
  router.post('/inhaber/benutzer/:id/loeschen', loadTarget, async (req, res) => {
    if (req.target.id === req.user.id) {
      await req.flash('error', 'Sie können sich nicht selbst entfernen.');
      return back(res);
    }
    if (req.target.is_owner && await store.countActiveOwners() <= 1) {
      await req.flash('error', 'Es muss mindestens ein aktiver Inhaber bestehen bleiben.');
      return back(res);
    }
    if (req.target.role === 'admin' && req.target.active && (await activeAdmins()).length <= 1) {
      await req.flash('error', 'Es muss mindestens ein aktiver Chef bestehen bleiben.');
      return back(res);
    }
    if (req.target.role === 'employee' || await store.userHasRecords(req.target.id)) {
      await store.updateUser(req.target.id, { active: 0 });
      await store.deleteUserSessions(req.target.id);
      await req.flash('info', `${req.target.name} wurde deaktiviert. Mitarbeiterdaten und vorhandene Aufzeichnungen bleiben erhalten (Aufbewahrungspflicht).`);
      return back(res);
    }
    await store.deleteUser(req.target.id);
    await req.flash('success', `${req.target.name} wurde entfernt.`);
    back(res);
  });

  return router;
}
