import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { csrfProtection, requireLogin, sessionMiddleware } from './auth.js';
import { databaseVariableNames, isDeploymentDatabase } from './config.js';
import { LazyDatabase } from './db.js';
import { sendDataUrl } from './http.js';
import { DATEV, ROSTER } from './layout.js';
import { DEFAULT_SETTINGS, Store } from './store.js';
import {
  CODES, WEEKDAYS_SHORT, formatDateDE, formatDecimalHours, formatDuration, monthKey, monthLabel, shiftMonth, todayISO,
} from './time.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import heftRoutes from './routes/heft.js';
import ownerRoutes from './routes/owner.js';
import settingsRoutes from './routes/settings.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Versionskennung für Stil und Skripte: ändert sich mit jedem Update, damit Handys nie eine alte Fassung
// aus dem Zwischenspeicher nehmen.
const ASSET_VERSION = (() => {
  const hash = crypto.createHash('sha256');
  for (const file of ['css/app.css', 'js/app.js', 'js/theme.js', 'manifest.webmanifest']) hash.update(fs.readFileSync(path.join(ROOT, 'public', file)));
  return hash.digest('hex').slice(0, 10);
})();

// Hilfsfunktionen für die Papieransicht: Punkte (pt) werden über --pt in Bildschirmgröße umgerechnet.
const pt = (n) => `calc(var(--pt) * ${Number(n.toFixed(3))})`;

export function createApp({ config, db = new LazyDatabase(config) }) {
  const store = new Store(db);
  const app = express();

  app.set('views', path.join(ROOT, 'views'));
  app.set('view engine', 'ejs');
  app.set('trust proxy', config.trustProxy);
  app.disable('x-powered-by');

  Object.assign(app.locals, {
    CODES, DATEV, ROSTER, WEEKDAYS_SHORT,
    formatDateDE, formatDuration, formatDecimalHours, monthKey, monthLabel, shiftMonth,
    pt,
    asset: (file) => `/static/${file}?v=${ASSET_VERSION}`,
    at: (x, y) => `left:${pt(x)};top:${pt(y)}`,
    rect: ({ x, y, w, h }) => `left:${pt(x)};top:${pt(y)};width:${pt(w)};height:${pt(h)}`,
    json: (value) => JSON.stringify(value).replace(/</g, '\\u003c'),
  });

  // Alte bzw. update-eigene Vercel-Adressen auf die feste Hauptadresse umleiten – nur dort bleibt man angemeldet.
  if (config.productionHost) {
    app.use((req, res, next) => {
      const host = String(req.hostname ?? '').toLowerCase();
      const otherVercelHost = host.endsWith('.vercel.app') && host !== config.productionHost;
      if (!otherVercelHost || !['GET', 'HEAD'].includes(req.method) || req.path === '/healthz') return next();
      res.redirect(302, `https://${config.productionHost}${req.originalUrl}`);
    });
  }

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use('/static', express.static(path.join(ROOT, 'public'), { maxAge: '1d' }));
  // Startbildschirm (start.html) und App-Symbole auch direkt unter / – so wie Vercel sie ausliefert.
  app.use(express.static(path.join(ROOT, 'public'), { index: false, maxAge: '1h' }));
  app.use('/fonts', express.static(path.join(ROOT, 'assets', 'fonts'), { maxAge: '30d' }));
  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // Standardwerte für alle Seiten (auch Fehlerseiten, die vor der Sitzungsprüfung entstehen).
  app.use((req, res, next) => {
    // Seiten enthalten persönliche Daten und sollen nach jedem Update sofort aktuell sein.
    res.set('Cache-Control', 'no-store');
    req.today = todayISO(config.timeZone);
    Object.assign(res.locals, {
      today: req.today, settings: { ...DEFAULT_SETTINGS }, currentPath: req.path, title: '',
      user: null, flash: null, csrfToken: '',
      dbIsTemporary: isDeploymentDatabase(config.dbUrl ?? ''),
    });
    next();
  });

  // Auf Vercel ohne verbundene Datenbank: Anleitung statt Fehlermeldung.
  if (config.dbMissing) {
    app.use((req, res) => res.status(503).render('db-missing', {
      title: 'Datenbank verbinden', found: databaseVariableNames(), problem: null,
    }));
    return app;
  }

  app.use(async (req, res, next) => {
    res.locals.settings = await store.getSettings();
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '4mb' }));
  app.use(sessionMiddleware(store, config));
  app.use(csrfProtection);

  const ctx = { store, config };
  app.use(authRoutes(ctx));
  app.use(settingsRoutes(ctx));
  app.use(heftRoutes(ctx));
  app.use(ownerRoutes(ctx));
  app.use('/admin', adminRoutes(ctx));

  // Unterschriften als Bild: eigene, die des Arbeitgebers – der Chef darf alle sehen.
  app.get('/signatur/:id.png', requireLogin, async (req, res) => {
    const signature = await store.getSignature(Number(req.params.id));
    const allowed = signature && (req.user.role === 'admin' || signature.kind === 'employer' || signature.user_id === req.user.id);
    if (!allowed) return res.status(404).end();
    sendDataUrl(res, signature.image, 'private, max-age=31536000, immutable');
  });

  app.get('/logo', requireLogin, (req, res) => {
    const { logo } = res.locals.settings;
    if (!logo) return res.status(404).end();
    sendDataUrl(res, logo, 'private, no-cache');
  });

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    if (err.databaseUnavailable) {
      return res.status(503).render('db-missing', {
        title: 'Datenbank nicht erreichbar', found: databaseVariableNames(), problem: String(err.message).slice(0, 300),
        address: String(config.dbUrl ?? '').replace(/\?.*$/, ''), variable: config.dbVariable,
      });
    }
    const tooLarge = err.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 500).render('error', {
      title: tooLarge ? 'Datei zu groß' : 'Fehler',
      message: tooLarge ? 'Die hochgeladene Datei ist zu groß.' : 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es erneut.',
    });
  });

  return app;
}
