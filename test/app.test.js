import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { signaturePng } from '../src/demo.js';
import { Store } from '../src/store.js';
import { monthOf, todayISO } from '../src/time.js';

const config = { timeZone: 'Europe/Berlin', trustProxy: false };
const today = todayISO(config.timeZone);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stundenzettel-test-'));
let server;
let base;
let store;
let db;

async function startApp(name) {
  const database = await openDatabase({ dbUrl: `file:${path.join(tmp, `${name}.db`)}` });
  const srv = createApp({ db: database, config }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  return { database, srv, url: `http://127.0.0.1:${srv.address().port}` };
}

before(async () => {
  ({ database: db, srv: server, url: base } = await startApp('main'));
  store = new Store(db);
});

after(() => {
  server.close();
  db.close();
  fs.rmSync(tmp, { recursive: true, force: true });
});

// Minimaler Browser: merkt sich das Sitzungs-Cookie und das CSRF-Token.
class Client {
  cookie = '';
  csrf = '';

  constructor(url) {
    this.url = url;
  }

  async request(path, { method = 'GET', form } = {}) {
    const headers = { cookie: this.cookie };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: this.csrf, ...form }).toString();
    }
    const res = await fetch((this.url ?? base) + path, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const type = res.headers.get('content-type') ?? '';
    const data = type.startsWith('text/html') ? await res.text() : Buffer.from(await res.arrayBuffer());
    if (typeof data === 'string') {
      const m = /name="_csrf" value="([^"]+)"/.exec(data);
      if (m) this.csrf = m[1];
    }
    return { status: res.status, location: res.headers.get('location'), type, data };
  }

  get(path) { return this.request(path); }
  post(path, form) { return this.request(path, { method: 'POST', form }); }

  async follow(path, form) {
    const res = await this.post(path, form);
    return res.location ? this.get(res.location) : res;
  }
}

const chef = new Client();
const anna = new Client();
const sig = signaturePng('Test');

test('Ersteinrichtung legt den Chef an', async () => {
  assert.equal((await chef.get('/')).location, '/setup');
  const res = await chef.post('/setup', {
    firma: 'Eiscafé Taormina', name: 'Chef', benutzername: 'chef', passwort: 'geheim123', passwort2: 'geheim123',
  });
  assert.equal(res.status, 302);
  assert.ok(chef.cookie);
  assert.equal((await chef.get('/setup')).location, '/login');
  const page = await chef.get('/einstellungen');
  assert.match(page.data, /Unterschrift des Arbeitgebers/);
});

test('Arbeitgeber-Unterschrift und Mitarbeiter anlegen', async () => {
  const saved = await chef.follow('/einstellungen/unterschrift', { unterschrift: sig });
  assert.match(saved.data, /Unterschrift des Arbeitgebers gespeichert/);
  assert.ok((await store.getSettings()).employer_signature_id);

  const created = await chef.follow('/admin/mitarbeiter', {
    name: 'Anna Müller', benutzername: 'anna', passwort: 'start1234', rolle: 'employee', einsatzliste: '1',
  });
  assert.match(created.data, /Anna Müller wurde angelegt/);
  assert.match(created.data, /start1234/);
});

test('Erste Anmeldung: eigenes Passwort und Unterschrift', async () => {
  const login = await anna.post('/login', { benutzername: 'anna', passwort: 'start1234' });
  assert.equal(login.location, '/');
  assert.equal((await anna.get('/zettel')).location, '/willkommen');
  await anna.get('/willkommen');

  const missing = await anna.post('/willkommen', { passwort: 'anna12345', passwort2: 'anna12345', unterschrift: '' });
  assert.equal(missing.status, 400);

  const ok = await anna.post('/willkommen', { passwort: 'anna12345', passwort2: 'anna12345', unterschrift: sig });
  assert.equal(ok.location, '/');
  const user = await store.getUserByUsername('anna');
  assert.equal(user.must_change_password, 0);
  assert.ok(user.signature_id);
});

test('Eintrag wird gespeichert und automatisch unterschrieben', async () => {
  await anna.get('/zettel');
  const res = await anna.follow('/zettel/eintrag', {
    datum: today, beginn: '11:00', ende: '18:15', pause: '0:30', kuerzel: '', bemerkung: '',
  });
  assert.match(res.data, /unterschrieben ✓/);
  assert.match(res.data, /11:00–18:15 = 6:45 Std\. – unterschrieben ✓\. Monatssumme jetzt/);
  const user = await store.getUserByUsername('anna');
  const entry = await store.getEntry(user.id, today);
  assert.equal(entry.work_minutes, 405);
  assert.equal(entry.recorded_on, today);
  assert.equal(entry.signature_id, user.signature_id);
  assert.match(res.data, /\/signatur\/\d+\.png/);
});

test('Zukünftige Tage und ungültige Zeiten werden abgelehnt', async () => {
  const user = await store.getUserByUsername('anna');
  const res = await anna.follow('/zettel/eintrag', { datum: '2999-01-01', beginn: '10:00', ende: '12:00', pause: '0:00' });
  assert.match(res.data, /erst am Arbeitstag/);
  assert.equal(await store.getEntry(user.id, '2999-01-01'), null);

  const bad = await anna.follow('/zettel/eintrag', { datum: today, beginn: '10:00', ende: '', pause: '0:00' });
  assert.match(bad.data, /Beginn und Ende/);
});

test('Mitarbeiter sieht nur den eigenen Bereich', async () => {
  assert.equal((await anna.get('/admin')).status, 403);
  const chefSig = (await store.getSettings()).employer_signature_id;
  assert.equal((await anna.get(`/signatur/${chefSig}.png`)).status, 200);

  await chef.follow('/admin/mitarbeiter', { name: 'Ben', benutzername: 'ben', passwort: 'start1234', rolle: 'employee' });
  const ben = await store.getUserByUsername('ben');
  const benSig = await store.setUserSignature(ben.id, sig);
  assert.equal((await anna.get(`/signatur/${benSig}.png`)).status, 404);
  assert.equal((await chef.get(`/signatur/${benSig}.png`)).status, 200);
});

test('Ohne CSRF-Token keine Änderungen', async () => {
  const saved = anna.csrf;
  anna.csrf = 'falsch';
  const res = await anna.post('/zettel/eintrag', { datum: today, beginn: '09:00', ende: '10:00' });
  anna.csrf = saved;
  assert.equal(res.status, 403);
});

test('PDFs und ZIP-Export', async () => {
  const month = monthOf(today);
  const own = await anna.get(`/zettel/pdf?monat=${month}`);
  assert.equal(own.type, 'application/pdf');
  assert.equal(own.data.subarray(0, 4).toString(), '%PDF');

  const roster = await chef.get(`/admin/einsatzliste/pdf?monat=${month}`);
  assert.equal(roster.data.subarray(0, 4).toString(), '%PDF');

  const all = await chef.get(`/admin/export.pdf?monat=${month}`);
  assert.equal(all.data.subarray(0, 4).toString(), '%PDF');

  const zip = await chef.get(`/admin/export.zip?monat=${month}`);
  assert.equal(zip.type, 'application/zip');
  assert.equal(zip.data.subarray(0, 2).toString(), 'PK');
  assert.ok(zip.data.includes(Buffer.from(`Einsatzliste_${month}.pdf`)));
  assert.ok(zip.data.includes(Buffer.from('Stundenzettel_' + month + '_Anna_Mueller.pdf')));
});

test('Abgeschlossener Monat ist für Mitarbeiter gesperrt', async () => {
  const month = monthOf(today);
  await chef.get(`/admin?monat=${month}`);
  await chef.post('/admin/monat/abschliessen', { monat: month });
  assert.ok(await store.isLocked(month));

  await anna.get('/zettel');
  const res = await anna.follow('/zettel/eintrag', { datum: today, beginn: '08:00', ende: '12:00', pause: '0:00' });
  assert.match(res.data, /abgeschlossen/);

  await chef.post('/admin/monat/oeffnen', { monat: month });
  assert.ok(!await store.isLocked(month));
});

test('Korrektur durch den Chef wird als AG markiert', async () => {
  const user = await store.getUserByUsername('anna');
  await chef.get(`/admin/zettel/${user.id}`);
  const res = await chef.follow(`/admin/zettel/${user.id}/eintrag`, {
    datum: today, beginn: '11:00', ende: '19:00', pause: '0:30', bemerkung: 'korrigiert',
  });
  assert.match(res.data, /gespeichert/);
  const entry = await store.getEntry(user.id, today);
  assert.equal(entry.signature_id, null);
  assert.notEqual(entry.recorded_by, user.id);
  assert.match(res.data, /Änderungsprotokoll/);
});

test('Falsches Passwort wird abgelehnt', async () => {
  const c = new Client();
  const res = await c.post('/login', { benutzername: 'anna', passwort: 'falsch' });
  assert.equal(res.status, 401);
});

test('Chef kann eine Datensicherung herunterladen', async () => {
  const res = await chef.get('/admin/sicherung');
  assert.equal(res.status, 200);
  assert.match(res.data.toString(), /INSERT OR REPLACE INTO users/);
  assert.equal((await anna.get('/admin/sicherung')).status, 403);
});

test('Alle Chef-Seiten lassen sich öffnen', async () => {
  const user = await store.getUserByUsername('anna');
  for (const page of ['/admin', '/einsatzliste', '/admin/mitarbeiter', `/admin/mitarbeiter/${user.id}`, '/einstellungen']) {
    const res = await chef.get(page);
    assert.equal(res.status, 200, page);
  }
  const roster = await chef.get('/einsatzliste');
  assert.match(roster.data, /Anna Müller/);
  assert.match(roster.data, /Einsatzliste für Minijobber/);
});

test('Einsatzliste: Mitarbeiter tippt eigenen Tag an und landet wieder auf der Liste', async () => {
  const month = monthOf(today);
  const page = await anna.get(`/einsatzliste?monat=${month}`);
  assert.equal(page.status, 200);
  assert.match(page.data, /id="entry-dialog"/);
  const user = await store.getUserByUsername('anna');
  assert.match(page.data, new RegExp(`data-open-entry data-user="${user.id}" data-date="${today}"`));
  // Fremde Spalten sind für Mitarbeiter nicht bearbeitbar
  const ben = await store.getUserByUsername('ben');
  assert.doesNotMatch(page.data, new RegExp(`data-user="${ben.id}"`));
  // Im eingebetteten JSON steht nur die eigene Spalte
  const json = JSON.parse(/<script type="application\/json" id="entry-data">(.*?)<\/script>/s.exec(page.data)[1]);
  assert.deepEqual(Object.keys(json.employees), [String(user.id)]);

  const res = await anna.post('/zettel/eintrag', {
    datum: today, beginn: '12:00', ende: '16:00', pause: '0:00', zurueck: `/einsatzliste?monat=${month}`,
  });
  assert.equal(res.location, `/einsatzliste?monat=${month}`);
  const after = await anna.get(res.location);
  assert.match(after.data, /12:00–16:00 = 4:00 Std\./);
  assert.match(after.data, /Monatssumme jetzt 4:00 Std\./);

  // Rücksprung nur innerhalb der App
  const evil = await anna.post('/zettel/eintrag', { datum: today, beginn: '12:00', ende: '16:00', zurueck: '//boese.example' });
  assert.equal(evil.location, `/zettel?monat=${month}`);
});

test('Einsatzliste: Chef kann alle Spalten bearbeiten', async () => {
  const page = await chef.get('/einsatzliste');
  const json = JSON.parse(/<script type="application\/json" id="entry-data">(.*?)<\/script>/s.exec(page.data)[1]);
  const anna = await store.getUserByUsername('anna');
  assert.equal(json.employees[anna.id].save, `/admin/zettel/${anna.id}/eintrag`);
  assert.match(page.data, new RegExp(`data-open-entry data-user="${anna.id}"`));
  // Ben steht nicht auf der Einsatzliste
  const ben = await store.getUserByUsername('ben');
  assert.equal(json.employees[ben.id], undefined);
});

test('Demo-Modus: Beispieldaten anlegen und wieder löschen', async () => {
  const demo = await startApp('demo');
  try {
    const c = new Client(demo.url);
    await c.get('/setup');
    const res = await c.post('/setup/demo', {});
    assert.equal(res.location, '/admin');
    const dash = await c.get('/admin');
    assert.match(dash.data, /Giulia Romano/);
    assert.match(dash.data, /Ayşe Yılmaz/);
    const roster = await c.get('/einsatzliste');
    assert.match(roster.data, /\/signatur\/\d+\.png/);
    const pdf = await c.get('/admin/export.pdf');
    assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');

    const login = await new Client(demo.url).get('/login');
    assert.match(login.data, /Demo-Zugänge/);

    await c.get('/einstellungen');
    const wiped = await c.post('/admin/demo-beenden', {});
    assert.equal(wiped.location, '/setup');
    assert.equal(await new Store(demo.database).countUsers(), 0);
  } finally {
    demo.srv.close();
    demo.database.close();
  }
});

test('Auf Vercel ohne Datenbank erscheint eine Anleitung', async () => {
  const app = createApp({ config: { ...config, dbMissing: true } });
  const srv = app.listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /Datenbank verbinden/);
  } finally {
    srv.close();
  }
});
