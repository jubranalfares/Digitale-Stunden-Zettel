import express from 'express';
import {
  LoginThrottle, endSession, hashPassword, passwordProblem, requireLogin, startSession, verifyPassword,
} from '../auth.js';
import { validImageDataUrl } from '../http.js';

export default function authRoutes({ store, config }) {
  const router = express.Router();
  const throttle = new LoginThrottle({ store });
  const dummyHash = hashPassword('unused-login-timing-value');

  router.get('/', async (req, res) => {
    if (!await store.countUsers()) return res.redirect('/setup');
    if (!req.user) return res.redirect('/login');
    res.redirect(req.user.role === 'admin' ? '/einsatzliste' : '/zettel');
  });

  // ---- Ersteinrichtung (nur solange es noch keinen Benutzer gibt) -----------

  router.get('/setup', async (req, res) => {
    if (await store.countUsers()) return res.redirect('/login');
    res.render('setup', { title: 'Ersteinrichtung', values: {}, error: null });
  });

  router.post('/setup', async (req, res) => {
    if (await store.countUsers()) return res.redirect('/login');
    const values = {
      company: String(req.body.firma ?? '').trim().slice(0, 80),
      name: String(req.body.name ?? '').trim().slice(0, 80),
      username: String(req.body.benutzername ?? '').trim(),
    };
    const password = String(req.body.passwort ?? '');
    let error = null;
    if (!values.company || !values.name || !values.username) error = 'Bitte alle Felder ausfüllen.';
    else if (!/^[\w.@-]{3,40}$/.test(values.username)) error = 'Der Benutzername darf nur Buchstaben, Zahlen sowie . _ - @ enthalten (3–40 Zeichen).';
    else if (password !== String(req.body.passwort2 ?? '')) error = 'Die Passwörter stimmen nicht überein.';
    else error = passwordProblem(password);
    if (error) return res.status(400).render('setup', { title: 'Ersteinrichtung', values, error });

    const id = await store.createInitialAdmin(values.company, {
      username: values.username, passwordHash: await hashPassword(password), role: 'admin', name: values.name,
    });
    if (!id) return res.status(409).render('error', { title: 'Bereits eingerichtet', message: 'Der Betrieb wurde bereits eingerichtet. Bitte anmelden.' });
    await startSession(req, res, store, config, id);
    res.redirect('/einstellungen?willkommen=1#unterschrift');
  });

  // ---- Anmeldung ------------------------------------------------------------

  const renderLogin = (res, { username = '', error = null, status = 200 } = {}) => res.status(status).render('login', {
    title: 'Anmelden', username, error,
  });

  router.get('/login', async (req, res) => {
    if (!await store.countUsers()) return res.redirect('/setup');
    if (req.user) return res.redirect('/');
    renderLogin(res);
  });

  router.post('/login', async (req, res) => {
    const username = String(req.body.benutzername ?? '').trim();
    const password = String(req.body.passwort ?? '');
    const key = `user:${username.toLowerCase()}`;
    const keys = [key, `ip:${req.ip}`];

    if (await throttle.isBlocked(keys)) return renderLogin(res, { username, error: 'Zu viele Fehlversuche. Bitte warten Sie 5 Minuten.', status: 429 });
    const user = await store.getUserByUsername(username);
    const valid = password.length <= 256 && await verifyPassword(password, user?.password_hash ?? await dummyHash);
    const ok = user && user.active && valid;
    if (!ok) {
      await throttle.fail(keys);
      return renderLogin(res, { username, error: 'Benutzername oder Passwort ist falsch.', status: 401 });
    }
    await throttle.reset(key);
    await startSession(req, res, store, config, user.id);
    res.redirect('/');
  });

  router.post('/logout', async (req, res) => {
    await endSession(req, res, store, config);
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

    if (await verifyPassword(password, req.user.password_hash)) {
      return res.status(400).render('welcome', { title: 'Willkommen', error: 'Bitte ein anderes Passwort als das Startpasswort wählen.' });
    }
    const passwordHash = await hashPassword(password);
    await store.atomic(async (tx) => {
      if (signature) await tx.setUserSignature(req.user.id, signature);
      await tx.updateUser(req.user.id, { password_hash: passwordHash, must_change_password: 0 });
    });
    await store.deleteUserSessions(req.user.id, req.session.id_hash);
    await req.flash('success', 'Alles eingerichtet! Ihre Unterschrift wird ab jetzt automatisch bei jedem Eintrag gesetzt.');
    res.redirect('/');
  });

  return router;
}
