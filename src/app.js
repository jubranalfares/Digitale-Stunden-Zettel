import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { csrfProtection, requireLogin, sessionMiddleware } from './auth.js';
import { sendDataUrl } from './http.js';
import { DATEV, ROSTER } from './layout.js';
import { Store } from './store.js';
import {
  CODES, WEEKDAYS_SHORT, formatDateDE, formatDecimalHours, formatDuration, monthKey, monthLabel, shiftMonth, todayISO,
} from './time.js';
import adminRoutes from './routes/admin.js';
import authRoutes from './routes/auth.js';
import settingsRoutes from './routes/settings.js';
import timesheetRoutes from './routes/timesheet.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Hilfsfunktionen für die Papieransicht: Punkte (pt) werden über --pt in Bildschirmgröße umgerechnet.
const pt = (n) => `calc(var(--pt) * ${Number(n.toFixed(3))})`;

export function createApp({ db, config }) {
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
    at: (x, y) => `left:${pt(x)};top:${pt(y)}`,
    rect: ({ x, y, w, h }) => `left:${pt(x)};top:${pt(y)};width:${pt(w)};height:${pt(h)}`,
    json: (value) => JSON.stringify(value).replace(/</g, '\\u003c'),
  });

  app.use((req, res, next) => {
    res.set({
      'Content-Security-Policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; frame-ancestors 'none'; form-action 'self'; base-uri 'none'",
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    next();
  });
  app.use('/static', express.static(path.join(ROOT, 'public'), { maxAge: '1d' }));
  app.use('/fonts', express.static(path.join(ROOT, 'assets', 'fonts'), { maxAge: '30d' }));
  // Standardwerte für alle Seiten (auch Fehlerseiten, die vor der Sitzungsprüfung entstehen).
  app.use((req, res, next) => {
    req.today = todayISO(config.timeZone);
    Object.assign(res.locals, {
      today: req.today, settings: store.getSettings(), currentPath: req.path, title: '',
      user: null, flash: null, csrfToken: '',
    });
    next();
  });
  app.use(express.urlencoded({ extended: false, limit: '4mb' }));
  app.use(sessionMiddleware(store, config));
  app.use(csrfProtection);

  const ctx = { store, config };
  app.use(authRoutes(ctx));
  app.use(settingsRoutes(ctx));
  app.use(timesheetRoutes(ctx));
  app.use('/admin', adminRoutes(ctx));

  app.get('/healthz', (req, res) => res.type('text').send('ok'));

  // Unterschriften als Bild: eigene, die des Arbeitgebers – der Chef darf alle sehen.
  app.get('/signatur/:id.png', requireLogin, (req, res) => {
    const signature = store.getSignature(Number(req.params.id));
    const allowed = signature && (req.user.role === 'admin' || signature.kind === 'employer' || signature.user_id === req.user.id);
    if (!allowed) return res.status(404).end();
    sendDataUrl(res, signature.image, 'private, max-age=31536000, immutable');
  });

  app.get('/logo', requireLogin, (req, res) => {
    const { logo } = store.getSettings();
    if (!logo) return res.status(404).end();
    sendDataUrl(res, logo, 'private, no-cache');
  });

  app.use((req, res) => {
    res.status(404).render('error', { title: 'Nicht gefunden', message: 'Diese Seite gibt es nicht.' });
  });

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    console.error(err);
    const tooLarge = err.type === 'entity.too.large';
    res.status(tooLarge ? 413 : 500).render('error', {
      title: tooLarge ? 'Datei zu groß' : 'Fehler',
      message: tooLarge ? 'Die hochgeladene Datei ist zu groß.' : 'Es ist ein unerwarteter Fehler aufgetreten. Bitte versuchen Sie es erneut.',
    });
  });

  return app;
}
