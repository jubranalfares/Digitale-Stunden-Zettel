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
  if (String(password).length > 256) return 'Das Passwort darf höchstens 256 Zeichen lang sein.';
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
    if (key) {
      try { out[key] = decodeURIComponent(part.slice(i + 1).trim()); } catch { /* ungültiges Cookie ignorieren */ }
    }
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

export async function startSession(req, res, store, config, userId = 0) {
  const token = crypto.randomBytes(32).toString('base64url');
  const maxAge = userId ? SESSION_DAYS * DAY_MS : 20 * 60 * 1000;
  const expiresAt = Date.now() + maxAge;
  const session = { id_hash: sha256(token), user_id: userId, csrf_token: crypto.randomBytes(24).toString('base64url'), expires_at: expiresAt };
  await store.createSession(session.id_hash, userId, session.csrf_token, expiresAt);
  if (req.session) await store.deleteSession(req.session.id_hash);
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req, config), maxAge });
  return session;
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
    if (found && (found.user?.active || found.session.user_id === 0)) {
      req.session = found.session;
      req.user = found.user;
      // Gleitende Verlängerung, damit Mitarbeiter auf dem Handy angemeldet bleiben.
      if (found.user && found.session.expires_at - Date.now() < (SESSION_DAYS - 1) * DAY_MS) {
        await store.touchSession(found.session.id_hash, Date.now() + SESSION_DAYS * DAY_MS);
        res.cookie(SESSION_COOKIE, token, { ...cookieOptions(req, config), maxAge: SESSION_DAYS * DAY_MS });
      }
    }
    if (!req.session && req.method === 'GET' && ['/login', '/setup'].includes(req.path)) {
      req.session = await startSession(req, res, store, config);
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
    res.locals.csrfToken = req.session?.csrf_token ?? '';
    next();
  };
}

export function csrfProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const sent = Buffer.from(String(req.body?._csrf ?? ''));
  const expected = Buffer.from(req.session?.csrf_token ?? '');
  if (expected.length > 0 && sent.length === expected.length && crypto.timingSafeEqual(sent, expected)) return next();
  if (req.get('Accept')?.includes('application/json')) return res.status(403).json({ error: 'Sitzung abgelaufen – bitte neu anmelden.' });
  res.status(403).render('error', { title: 'Sitzung abgelaufen', message: 'Bitte laden Sie die Seite neu und versuchen Sie es noch einmal.' });
}

export function requireLogin(req, res, next) {
  if (!req.user) return req.get('Accept')?.includes('application/json')
    ? res.status(401).json({ error: 'Bitte erneut anmelden.' }) : res.redirect('/login');
  if (req.user.must_change_password && !req.path.startsWith('/willkommen')) return res.redirect('/willkommen');
  if (req.user.role === 'admin' && !res.locals.settings.employer_signature_id
      && !req.path.startsWith('/einstellungen')) return res.redirect('/einstellungen?willkommen=1#unterschrift');
  next();
}

export function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).render('error', { title: 'Kein Zugriff', message: 'Dieser Bereich ist nur für den Chef bzw. Administratoren.' });
  }
  next();
}

export function requireEmployee(req, res, next) {
  if (req.user?.role !== 'employee') return res.redirect('/admin');
  next();
}

// ---- Schutz gegen Passwort-Raten -------------------------------------------

export class LoginThrottle {
  constructor({ store, maxAttempts = 5, lockMs = 5 * 60 * 1000 } = {}) {
    this.store = store;
    this.maxAttempts = maxAttempts;
    this.lockMs = lockMs;
  }

  key(value) { return `login:${sha256(value)}`; }

  async isBlocked(keys) {
    for (const key of keys) {
      const row = await this.store.db.get('SELECT value FROM settings WHERE key = ?', [this.key(key)]);
      if (row && JSON.parse(row.value).until > Date.now()) return true;
    }
    return false;
  }

  fail(keys) {
    return this.store.atomic(async (store) => {
      const now = Date.now();
      await store.db.run("DELETE FROM settings WHERE key LIKE 'login:%' AND json_extract(value, '$.expiresAt') <= ?", [now]);
      for (const key of keys) {
        const row = await store.db.get('SELECT value FROM settings WHERE key = ?', [this.key(key)]);
        const a = row ? JSON.parse(row.value) : { count: 0, until: 0, expiresAt: now + this.lockMs };
        a.count += 1;
        if (a.count >= this.maxAttempts) a.until = a.expiresAt = now + this.lockMs;
        await store.setSetting(this.key(key), JSON.stringify(a));
      }
    });
  }

  async reset(key) {
    await this.store.db.run('DELETE FROM settings WHERE key = ?', [this.key(key)]);
  }
}
