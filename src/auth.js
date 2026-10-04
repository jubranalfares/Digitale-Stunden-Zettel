import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

const SESSION_COOKIE = 'sz_sid';
const SESSION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---- Passwörter -------------------------------------------------------------

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  const [scheme, saltB64, hashB64] = String(stored).split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

export function passwordProblem(password) {
  if (String(password).length < 8) return 'Das Passwort muss mindestens 8 Zeichen lang sein.';
  return null;
}

// Gut lesbares Startpasswort (ohne 0/O, 1/l usw.).
export function generatePassword(length = 10) {
  const alphabet = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(length);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('');
}

// ---- Sitzungen --------------------------------------------------------------

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookieOptions(req, config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure ?? req.secure,
    path: '/',
  };
}

export async function startSession(req, res, store, config, userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expiresAt = Date.now() + SESSION_DAYS * DAY_MS;
  await store.createSession(sha256(token), userId, crypto.randomBytes(24).toString('base64url'), expiresAt);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req, config), maxAge: SESSION_DAYS * DAY_MS });
}

export async function endSession(req, res, store, config) {
  if (req.session) await store.deleteSession(req.session.id_hash);
  res.clearCookie(SESSION_COOKIE, cookieOptions(req, config));
}

export function sessionMiddleware(store, config) {
  return async (req, res, next) => {
    req.user = null;
    req.session = null;
    const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
    const found = token ? await store.getSessionWithUser(sha256(token)) : null;
    if (found?.user.active) {
      req.session = found.session;
      req.user = found.user;
      // Gleitende Verlängerung, damit Mitarbeiter auf dem Handy angemeldet bleiben.
      if (found.session.expires_at - Date.now() < (SESSION_DAYS - 1) * DAY_MS) {
        await store.touchSession(found.session.id_hash, Date.now() + SESSION_DAYS * DAY_MS);
        res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req, config), maxAge: SESSION_DAYS * DAY_MS });
      }
    }

    // Flash-Meldungen überleben genau eine Weiterleitung.
    res.locals.flash = null;
    if (req.session?.flash) {
      res.locals.flash = JSON.parse(req.session.flash);
      await store.setFlash(req.session.id_hash, null);
    }
    req.flash = async (type, message, details = []) => {
      if (req.session) await store.setFlash(req.session.id_hash, { type, message, details });
    };

    res.locals.user = req.user;
    res.locals.isOwner = isOwner(req.user);
    res.locals.csrfToken = req.session?.csrf_token ?? '';
    next();
  };
}

export function csrfProtection(req, res, next) {
  if (req.method !== 'POST' || !req.session) return next();
  const sent = Buffer.from(String(req.body?._csrf ?? ''));
  const expected = Buffer.from(req.session.csrf_token);
  if (sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) return next();
  res.status(403).render('error', { title: 'Sitzung abgelaufen', message: 'Bitte laden Sie die Seite neu und versuchen Sie es noch einmal.' });
}

export function requireLogin(req, res, next) {
  if (!req.user) return res.redirect('/login');
  if (req.user.must_change_password && !req.path.startsWith('/willkommen')) return res.redirect('/willkommen');
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Diesen Bereich kann nur der Chef öffnen.' });
  }
  next();
}

export function requireEmployee(req, res, next) {
  if (req.user?.role !== 'employee') return res.redirect('/einsatzliste');
  next();
}

// Inhaber-Bereich: nur für den Betreiber (den ersten angelegten Zugang bzw. von einem Inhaber ernannt).
// Für alle anderen existiert der Bereich schlicht nicht (404), statt eines sichtbaren „kein Zugriff“.
// Inhaber sind immer auch Chefs; das Recht gilt nur zusammen mit der Chef-Rolle.
export const isOwner = (user) => Boolean(user?.is_owner) && user.role === 'admin';

export function requireOwner(req, res, next) {
  if (!isOwner(req.user)) {
    return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
  }
  next();
}

// ---- Schutz gegen Passwort-Raten -------------------------------------------

export class LoginThrottle {
  constructor({ maxAttempts = 5, lockMs = 5 * 60 * 1000 } = {}) {
    this.maxAttempts = maxAttempts;
    this.lockMs = lockMs;
    this.attempts = new Map();
  }

  isBlocked(key) {
    const a = this.attempts.get(key);
    if (!a) return false;
    if (a.until && a.until > Date.now()) return true;
    if (a.until) this.attempts.delete(key);
    return false;
  }

  fail(key) {
    const a = this.attempts.get(key) ?? { count: 0, until: 0 };
    a.count += 1;
    if (a.count >= this.maxAttempts) a.until = Date.now() + this.lockMs;
    this.attempts.set(key, a);
  }

  reset(key) {
    this.attempts.delete(key);
  }
}
