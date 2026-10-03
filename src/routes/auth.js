import express from 'express';
import {
  LoginThrottle, endSession, hashPassword, passwordProblem, requireLogin, startSession, verifyPassword,
} from '../auth.js';
import { validImageDataUrl } from '../http.js';

export default function authRoutes({ store, config }) {
  const router = express.Router();
  const throttle = new LoginThrottle();

  router.get('/', (req, res) => {
    if (!store.countUsers()) return res.redirect('/setup');
    if (!req.user) return res.redirect('/login');
    res.redirect(req.user.role === 'admin' ? '/admin' : '/zettel');
  });

  // ---- Ersteinrichtung (nur solange es noch keinen Benutzer gibt) -----------

  router.get('/setup', (req, res) => {
    if (store.countUsers()) return res.redirect('/login');
    res.render('setup', { title: 'Ersteinrichtung', values: {}, error: null });
  });

  router.post('/setup', async (req, res) => {
    if (store.countUsers()) return res.redirect('/login');
    const values = {
      company: String(req.body.firma ?? '').trim(),
      name: String(req.body.name ?? '').trim(),
      username: String(req.body.benutzername ?? '').trim(),
    };
    const password = String(req.body.passwort ?? '');
    let error = null;
    if (!values.company || !values.name || !values.username) error = 'Bitte alle Felder ausfüllen.';
    else if (!/^[\w.@-]{3,40}$/.test(values.username)) error = 'Der Benutzername darf nur Buchstaben, Zahlen sowie . _ - @ enthalten (3–40 Zeichen).';
    else if (password !== String(req.body.passwort2 ?? '')) error = 'Die Passwörter stimmen nicht überein.';
    else error = passwordProblem(password);
    if (error) return res.status(400).render('setup', { title: 'Ersteinrichtung', values, error });

    store.setSetting('company_name', values.company);
    const id = store.createUser({
      username: values.username, passwordHash: await hashPassword(password), role: 'admin', name: values.name,
    });
    startSession(req, res, store, config, id);
    res.redirect('/einstellungen?willkommen=1#unterschrift');
  });

  // ---- Anmeldung ------------------------------------------------------------

  router.get('/login', (req, res) => {
    if (!store.countUsers()) return res.redirect('/setup');
    if (req.user) return res.redirect('/');
    res.render('login', { title: 'Anmelden', username: '', error: null });
  });

  router.post('/login', async (req, res) => {
    const username = String(req.body.benutzername ?? '').trim();
    const password = String(req.body.passwort ?? '');
    const key = `${req.ip}|${username.toLowerCase()}`;
    const fail = (message, status = 401) => res.status(status).render('login', { title: 'Anmelden', username, error: message });

    if (throttle.isBlocked(key)) return fail('Zu viele Fehlversuche. Bitte warten Sie 5 Minuten.', 429);
    const user = store.getUserByUsername(username);
    const ok = user && user.active && await verifyPassword(password, user.password_hash);
    if (!ok) {
      throttle.fail(key);
      return fail('Benutzername oder Passwort ist falsch.');
    }
    throttle.reset(key);
    startSession(req, res, store, config, user.id);
    res.redirect('/');
  });

  router.post('/logout', (req, res) => {
    endSession(req, res, store, config);
    res.redirect('/login');
  });

  // ---- Erste Anmeldung: eigenes Passwort + Unterschrift ---------------------

  router.get('/willkommen', requireLogin, (req, res) => {
    if (!req.user.must_change_password) return res.redirect('/');
    res.render('welcome', { title: 'Willkommen', error: null });
  });

  router.post('/willkommen', requireLogin, async (req, res) => {
    if (!req.user.must_change_password) return res.redirect('/');
    const password = String(req.body.passwort ?? '');
    const isEmployee = req.user.role === 'employee';
    const signature = validImageDataUrl(req.body.unterschrift);
    let error = null;
    if (password !== String(req.body.passwort2 ?? '')) error = 'Die Passwörter stimmen nicht überein.';
    else error = passwordProblem(password);
    if (!error && isEmployee && !signature) error = 'Bitte unterschreiben Sie im Feld „Unterschrift“.';
    if (error) return res.status(400).render('welcome', { title: 'Willkommen', error });

    const passwordHash = await hashPassword(password);
    store.db.transaction(() => {
      store.updateUser(req.user.id, { password_hash: passwordHash, must_change_password: 0 });
      if (signature) store.setUserSignature(req.user.id, signature);
    })();
    store.deleteUserSessions(req.user.id, req.session.id_hash);
    req.flash('success', 'Alles eingerichtet! Ihre Unterschrift wird ab jetzt automatisch bei jedem Eintrag gesetzt.');
    res.redirect('/');
  });

  return router;
}
