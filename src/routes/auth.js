import express from 'express';
import {
  LoginThrottle, endSession, hashPassword, passwordProblem, requireLogin, startSession, verifyPassword,
} from '../auth.js';
import { validImageDataUrl } from '../http.js';

export default function authRoutes({ store, config }) {
  const router = express.Router();
  const throttle = new LoginThrottle();

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

    await store.setSetting('company_name', values.company);
    // Der erste Zugang ist der Inhaber (Betreiber): darf später Chef-Zugänge anlegen und Rollen verteilen.
    const id = await store.createUser({
      username: values.username, passwordHash: await hashPassword(password), role: 'admin', name: values.name,
      onRoster: false, isOwner: true,
    });
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
    const key = `${req.ip}|${username.toLowerCase()}`;

    if (throttle.isBlocked(key)) return renderLogin(res, { username, error: 'Zu viele Fehlversuche. Bitte warten Sie 5 Minuten.', status: 429 });
    const user = await store.getUserByUsername(username);
    const ok = user && user.active && await verifyPassword(password, user.password_hash);
    if (!ok) {
      throttle.fail(key);
      return renderLogin(res, { username, error: 'Benutzername oder Passwort ist falsch.', status: 401 });
    }
    throttle.reset(key);
    await startSession(req, res, store, config, user.id);
    res.redirect('/');
  });

  router.post('/logout', async (req, res) => {
    await endSession(req, res, store, config);
    res.redirect('/login');
  });

  // ---- Erste Anmeldung: eigenes Passwort + Unterschrift ---------------------

  // Ein neuer Chef unterschreibt hier gleich als Arbeitgeber, solange noch keine Arbeitgeber-Unterschrift existiert.
  const asksEmployerSignature = (req, res) => req.user.role === 'admin' && !res.locals.settings.employer_signature_id;

  router.get('/willkommen', requireLogin, (req, res) => {
    if (!req.user.must_change_password) return res.redirect('/');
    res.render('welcome', { title: 'Willkommen', error: null, employerSignature: asksEmployerSignature(req, res) });
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
    const employerSignature = asksEmployerSignature(req, res);
    if (error) return res.status(400).render('welcome', { title: 'Willkommen', error, employerSignature });

    if (signature && isEmployee) await store.setUserSignature(req.user.id, signature);
    if (signature && employerSignature) await store.setEmployerSignature(req.user.id, signature);
    await store.updateUser(req.user.id, { password_hash: await hashPassword(password), must_change_password: 0 });
    await store.deleteUserSessions(req.user.id, req.session.id_hash);
    await req.flash('success', isEmployee || signature
      ? 'Alles eingerichtet! Ihre Unterschrift wird ab jetzt automatisch gesetzt.'
      : 'Alles eingerichtet!');
    res.redirect('/');
  });

  return router;
}
