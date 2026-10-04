import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { signaturePng } from '../scripts/demo.js';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { Store } from '../src/store.js';
import { monthKey, shiftMonth, todayISO } from '../src/time.js';

const config = { timeZone: 'Europe/Berlin', trustProxy: false };
const today = todayISO(config.timeZone);
const [y, m] = today.split('-').map(Number);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stundenzettel-test-'));
let server;
let base;
let store;
let db;

before(async () => {
  db = await openDatabase({ dbUrl: `file:${path.join(tmp, 'main.db')}` });
  store = new Store(db);
  server = createApp({ db, config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
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

  async request(url, { method = 'GET', form } = {}) {
    const headers = { cookie: this.cookie };
    let body;
    if (form) {
      headers['content-type'] = 'application/x-www-form-urlencoded';
      body = new URLSearchParams({ _csrf: this.csrf, ...form }).toString();
    }
    const res = await fetch(base + url, { method, headers, body, redirect: 'manual' });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      this.cookie = pair.endsWith('=') ? '' : pair;
    }
    const type = res.headers.get('content-type') ?? '';
    let data;
    if (type.startsWith('text/html')) {
      data = await res.text();
      const token = /name="_csrf" value="([^"]+)"/.exec(data) ?? /data-csrf="([^"]+)"/.exec(data);
      if (token) this.csrf = token[1];
    } else if (type.startsWith('application/json')) {
      data = await res.json();
    } else {
      data = Buffer.from(await res.arrayBuffer());
    }
    return { status: res.status, location: res.headers.get('location'), type, data };
  }

  get(url) { return this.request(url); }
  post(url, form) { return this.request(url, { method: 'POST', form }); }

  async follow(url, form) {
    const res = await this.post(url, form);
    return res.location ? this.get(res.location) : res;
  }
}

const chef = new Client();
const anna = new Client();
const sig = signaturePng('Test');
const day = (iso) => ({ datum: iso, beginn: '', pause: '', ende: '', kuerzel: '', bemerkung: '' });

test('Ersteinrichtung legt den Chef an', async () => {
  assert.equal((await chef.get('/')).location, '/setup');
  const res = await chef.post('/setup', {
    firma: 'Eiscafé Taormina', name: 'Chef', benutzername: 'chef', passwort: 'geheim123', passwort2: 'geheim123',
  });
  assert.equal(res.status, 302);
  assert.equal((await chef.get('/setup')).location, '/login');
  assert.match((await chef.get('/einstellungen')).data, /Unterschrift des Arbeitgebers/);
});

test('Chef unterschreibt einmal und legt eine Mitarbeiterin an', async () => {
  const saved = await chef.follow('/einstellungen/unterschrift', { unterschrift: sig });
  assert.match(saved.data, /Unterschrift des Arbeitgebers gespeichert/);

  await chef.get('/admin/mitarbeiter');
  const created = await chef.follow('/admin/mitarbeiter', { name: 'Anna Müller', benutzername: 'anna', passwort: 'start1234' });
  assert.match(created.data, /Anna Müller wurde angelegt/);
  assert.match(created.data, /start1234/);
  const user = await store.getUserByUsername('anna');
  assert.equal(user.on_roster, 1);
  assert.equal(user.must_change_password, 1);
});

test('Erste Anmeldung: eigenes Passwort und Unterschrift', async () => {
  assert.equal((await anna.post('/login', { benutzername: 'anna', passwort: 'start1234' })).location, '/');
  assert.equal((await anna.get('/zettel')).location, '/willkommen');
  await anna.get('/willkommen');
  assert.equal((await anna.post('/willkommen', { passwort: 'anna12345', passwort2: 'anna12345', unterschrift: '' })).status, 400);
  const ok = await anna.post('/willkommen', { passwort: 'anna12345', passwort2: 'anna12345', unterschrift: sig });
  assert.equal(ok.location, '/');
  assert.equal((await anna.get('/')).location, '/zettel');
});

test('Heft: Stundenzettel ist direkt beschreibbar', async () => {
  const page = await anna.get('/zettel');
  assert.equal(page.status, 200);
  assert.match(page.data, new RegExp(`data-row data-user="\\d+" data-date="${today}"`));
  assert.match(page.data, /name="beginn"/);
  assert.match(page.data, /Mein Stundenzettel/);
});

test('12 bis 16 Uhr eintragen ergibt 4:00 Std. – mit Summe und Unterschriften', async () => {
  const user = await store.getUserByUsername('anna');
  const res = await anna.post('/eintrag', { user: user.id, ...day(today), beginn: '12', ende: '16' });
  assert.equal(res.status, 200);
  assert.equal(res.data.row.beginn, '12:00');
  assert.equal(res.data.row.ende, '16:00');
  assert.equal(res.data.row.dauer, '4:00');
  assert.equal(res.data.total, '4:00');
  assert.equal(res.data.cell.duration, '4:00');
  assert.ok(res.data.employeeSignature, 'Mitarbeiter-Unterschrift gesetzt');
  assert.ok(res.data.employerSignature, 'Arbeitgeber-Unterschrift gesetzt');
  assert.ok(res.data.rosterEmployerSignature, 'Einsatzliste unterschrieben');
  const entry = await store.getEntry(user.id, today);
  assert.equal(entry.signature_id, user.signature_id);
  assert.equal(entry.recorded_on, today);
});

test('Einsatzliste: "12-19" behält die Pause aus dem Stundenzettel', async () => {
  const user = await store.getUserByUsername('anna');
  await anna.post('/eintrag', { user: user.id, ...day(today), beginn: '11:00', pause: '30', ende: '18:00' });
  const res = await anna.post('/eintrag', { user: user.id, datum: today, beginn: '12:00', ende: '19:00', kuerzel: '' });
  assert.equal(res.data.row.pause, '0:30');
  assert.equal(res.data.row.dauer, '6:30');
  assert.equal(res.data.cell.raw, '12:00-19:00');
});

test('Feld leeren löscht den Tag', async () => {
  const user = await store.getUserByUsername('anna');
  const res = await anna.post('/eintrag', { user: user.id, ...day(today) });
  assert.equal(res.status, 200);
  assert.equal(res.data.cell, null);
  assert.equal(res.data.row.dauer, '');
  assert.equal(await store.getEntry(user.id, today), null);
  await anna.post('/eintrag', { user: user.id, ...day(today), beginn: '12', ende: '16' });
});

test('Ungültige Eingaben werden abgelehnt', async () => {
  const user = await store.getUserByUsername('anna');
  const future = await anna.post('/eintrag', { user: user.id, ...day('2999-01-01'), beginn: '10', ende: '12' });
  assert.equal(future.status, 400);
  assert.match(future.data.error, /Zukunft/);

  const half = await anna.post('/eintrag', { user: user.id, ...day(today), beginn: '10' });
  assert.equal(half.status, 400);
  assert.match(half.data.error, /Ende fehlt/);

  const old = `${monthKey(shiftMonth({ year: y, month: m }, -2))}-10`;
  const tooOld = await anna.post('/eintrag', { user: user.id, ...day(old), beginn: '10', ende: '12' });
  assert.equal(tooOld.status, 400);
});

test('Mitarbeiter dürfen nur den eigenen Zettel beschreiben', async () => {
  await chef.follow('/admin/mitarbeiter', { name: 'Ben Bauer', benutzername: 'ben', passwort: 'start1234' });
  const ben = await store.getUserByUsername('ben');
  const res = await anna.post('/eintrag', { user: ben.id, ...day(today), beginn: '10', ende: '12' });
  assert.equal(res.status, 403);
  assert.equal((await anna.get(`/zettel/${ben.id}`)).status, 403);
  assert.equal((await anna.get('/admin/mitarbeiter')).status, 403);
  assert.equal((await anna.get('/pdf')).status, 403);

  const benSig = await store.setUserSignature(ben.id, sig);
  assert.equal((await anna.get(`/signatur/${benSig}.png`)).status, 404);
  assert.equal((await chef.get(`/signatur/${benSig}.png`)).status, 200);
  const chefSig = (await store.getSettings()).employer_signature_id;
  assert.equal((await anna.get(`/signatur/${chefSig}.png`)).status, 200);
});

test('Einsatzliste: Mitarbeiterin schreibt nur in die eigene Spalte', async () => {
  const user = await store.getUserByUsername('anna');
  const ben = await store.getUserByUsername('ben');
  const page = await anna.get('/einsatzliste');
  assert.equal(page.status, 200);
  assert.match(page.data, new RegExp(`data-cell data-user="${user.id}" data-date="${today}"`));
  assert.doesNotMatch(page.data, new RegExp(`data-cell data-user="${ben.id}"`));
  assert.match(page.data, /Ben Bauer/);
});

test('Chef schreibt für alle – als AG gekennzeichnet', async () => {
  const ben = await store.getUserByUsername('ben');
  const page = await chef.get('/einsatzliste');
  assert.match(page.data, new RegExp(`data-cell data-user="${ben.id}"`));
  const res = await chef.post('/eintrag', { user: ben.id, datum: today, beginn: '17', ende: '22', kuerzel: '' });
  assert.equal(res.status, 200);
  assert.equal(res.data.cell.duration, '5:00');
  assert.equal(res.data.cell.ag, true);
  assert.equal(res.data.cell.signatureId, null);
  assert.equal(res.data.row.ag, true);

  const sheet = await chef.get(`/zettel/${ben.id}`);
  assert.equal(sheet.status, 200);
  assert.match(sheet.data, /Ben Bauer/);
  assert.match(sheet.data, /17:00/);
});

test('Ohne CSRF-Token wird nichts gespeichert', async () => {
  const user = await store.getUserByUsername('anna');
  const saved = anna.csrf;
  anna.csrf = 'falsch';
  const res = await anna.post('/eintrag', { user: user.id, ...day(today), beginn: '9', ende: '10' });
  anna.csrf = saved;
  assert.equal(res.status, 403);
});

test('Ein PDF für den Steuerberater', async () => {
  const pdf = await chef.get('/pdf');
  assert.equal(pdf.type, 'application/pdf');
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
});

test('Datensicherung', async () => {
  const res = await chef.get('/admin/sicherung');
  assert.equal(res.status, 200);
  assert.match(res.data.toString(), /INSERT OR REPLACE INTO entries/);
  assert.equal((await anna.get('/admin/sicherung')).status, 403);
});

test('Der Einrichter ist Inhaber – nur er sieht den Inhaber-Bereich', async () => {
  const owner = await store.getUserByUsername('chef');
  assert.equal(owner.is_owner, 1);
  assert.match((await chef.get('/einsatzliste')).data, /href="\/inhaber"/);
  const panel = await chef.get('/inhaber');
  assert.equal(panel.status, 200);
  assert.match(panel.data, /Neuen Chef-Zugang anlegen/);

  const asEmployee = await anna.get('/inhaber');
  assert.equal(asEmployee.status, 404);
  assert.doesNotMatch((await anna.get('/zettel')).data, /\/inhaber/);
});

const marco = new Client();

test('Inhaber legt einen zweiten Chef an', async () => {
  await chef.get('/inhaber');
  const bad = await chef.post('/inhaber/chef', { name: 'Marco Rossi', benutzername: 'anna', passwort: 'chef23456' });
  assert.equal(bad.status, 400);
  assert.match(bad.data, /bereits vergeben/);

  const created = await chef.follow('/inhaber/chef', { name: 'Marco Rossi', benutzername: 'marco', passwort: 'chef23456' });
  assert.match(created.data, /Chef-Zugang für Marco Rossi angelegt/);
  const user = await store.getUserByUsername('marco');
  assert.equal(user.role, 'admin');
  assert.equal(user.is_owner, 0);
  assert.equal(user.on_roster, 0);
  assert.equal(user.must_change_password, 1);

  assert.equal((await marco.post('/login', { benutzername: 'marco', passwort: 'chef23456' })).location, '/');
  const welcome = await marco.get('/willkommen');
  assert.doesNotMatch(welcome.data, /data-sigpad/, 'Arbeitgeber-Unterschrift gibt es schon');
  assert.equal((await marco.post('/willkommen', { passwort: 'marco12345', passwort2: 'marco12345' })).location, '/');
  assert.equal((await marco.get('/einsatzliste')).status, 200);
});

test('Ein Chef ohne Inhaber-Recht sieht und erreicht den Inhaber-Bereich nicht', async () => {
  const owner = await store.getUserByUsername('chef');
  const page = await marco.get('/einsatzliste');
  assert.doesNotMatch(page.data, /href="\/inhaber"/);
  assert.equal((await marco.get('/inhaber')).status, 404);
  assert.equal((await marco.post(`/inhaber/benutzer/${owner.id}/aktiv`, { aktiv: '' })).status, 404);
  assert.equal((await marco.post(`/inhaber/benutzer/${owner.id}/passwort`, { passwort: 'uebernahme1' })).status, 404);
  assert.equal((await marco.post('/inhaber/chef', { name: 'X', benutzername: 'xchef', passwort: 'chef23456' })).status, 404);
  assert.equal(await store.getUserByUsername('xchef'), null);
  assert.equal((await store.getUser(owner.id)).active, 1);

  // Die Mitarbeiterverwaltung des Chefs zeigt und bearbeitet nur Mitarbeiter.
  const list = await marco.get('/admin/mitarbeiter');
  assert.match(list.data, /Anna Müller/);
  assert.doesNotMatch(list.data, new RegExp(`/admin/mitarbeiter/${owner.id}"`));
  assert.equal((await marco.get(`/admin/mitarbeiter/${owner.id}`)).status, 404);
  assert.equal((await marco.post(`/admin/mitarbeiter/${owner.id}/passwort`, { passwort: 'uebernahme1' })).status, 404);
  assert.equal((await marco.post(`/admin/mitarbeiter/${owner.id}`, { name: 'Chef', benutzername: 'chef', aktiv: '' })).status, 404);
  const created = await marco.follow('/admin/mitarbeiter', { name: 'Neu Chef', benutzername: 'neuchef', passwort: 'start1234', rolle: 'admin' });
  assert.equal(created.status, 200);
  assert.equal((await store.getUserByUsername('neuchef')).role, 'employee');
});

test('Inhaber verteilt Rechte – mit Schutz vor dem Aussperren', async () => {
  const owner = await store.getUserByUsername('chef');
  const m = await store.getUserByUsername('marco');
  await chef.get('/inhaber');

  let page = await chef.follow(`/inhaber/benutzer/${owner.id}/aktiv`, { aktiv: '' });
  assert.match(page.data, /nicht selbst deaktivieren/);
  page = await chef.follow(`/inhaber/benutzer/${owner.id}/inhaber`, {});
  assert.match(page.data, /eigenes Inhaber-Recht/);
  page = await chef.follow(`/inhaber/benutzer/${owner.id}/loeschen`, {});
  assert.match(page.data, /nicht selbst entfernen/);
  assert.equal((await store.getUser(owner.id)).is_owner, 1);

  page = await chef.follow(`/inhaber/benutzer/${m.id}/rolle`, { rolle: 'employee' });
  assert.match(page.data, /Marco Rossi ist jetzt Mitarbeiter/);
  assert.equal((await store.getUser(m.id)).on_roster, 1);
  assert.equal((await marco.get('/admin/mitarbeiter')).status, 403);
  page = await chef.follow(`/inhaber/benutzer/${m.id}/inhaber`, {});
  assert.match(page.data, /Nur ein Chef kann Inhaber-Rechte erhalten/);

  await chef.follow(`/inhaber/benutzer/${m.id}/rolle`, { rolle: 'admin' });
  page = await chef.follow(`/inhaber/benutzer/${m.id}/inhaber`, {});
  assert.match(page.data, /Marco Rossi hat jetzt Inhaber-Rechte/);
  assert.equal((await marco.get('/inhaber')).status, 200);
  page = await chef.follow(`/inhaber/benutzer/${m.id}/rolle`, { rolle: 'employee' });
  assert.match(page.data, /zuerst das Inhaber-Recht entzogen/);

  page = await chef.follow(`/inhaber/benutzer/${m.id}/inhaber`, {});
  assert.match(page.data, /keine Inhaber-Rechte mehr/);
  assert.equal((await marco.get('/inhaber')).status, 404);
});

test('Inhaber setzt Passwörter zurück, deaktiviert und entfernt Zugänge', async () => {
  const m = await store.getUserByUsername('marco');
  await chef.get('/inhaber');
  let page = await chef.follow(`/inhaber/benutzer/${m.id}/passwort`, { passwort: 'neu-start1' });
  assert.match(page.data, /Neues Startpasswort für Marco Rossi/);
  assert.equal((await marco.get('/einsatzliste')).location, '/login', 'alte Sitzung beendet');
  assert.equal((await marco.post('/login', { benutzername: 'marco', passwort: 'neu-start1' })).location, '/');
  assert.equal((await marco.get('/einsatzliste')).location, '/willkommen');

  page = await chef.follow(`/inhaber/benutzer/${m.id}/aktiv`, { aktiv: '' });
  assert.match(page.data, /Marco Rossi ist jetzt deaktiviert/);
  assert.equal((await marco.get('/einsatzliste')).location, '/login');
  assert.equal((await marco.post('/login', { benutzername: 'marco', passwort: 'neu-start1' })).status, 401);

  // Ohne Einträge im Heft: wirklich weg. Mit Einträgen: nur deaktiviert (Aufbewahrungspflicht).
  page = await chef.follow(`/inhaber/benutzer/${m.id}/loeschen`, {});
  assert.match(page.data, /Marco Rossi wurde entfernt/);
  assert.equal(await store.getUserByUsername('marco'), null);

  const a = await store.getUserByUsername('anna');
  const signatures = (await db.all('SELECT COUNT(*) AS n FROM signatures')).at(0).n;
  page = await chef.follow(`/inhaber/benutzer/${a.id}/loeschen`, {});
  assert.match(page.data, /nur deaktiviert/);
  assert.equal((await store.getUser(a.id)).active, 0);
  assert.equal((await db.all('SELECT COUNT(*) AS n FROM signatures')).at(0).n, signatures);
  await chef.follow(`/inhaber/benutzer/${a.id}/aktiv`, { aktiv: '1' });
  assert.equal((await store.getUser(a.id)).active, 1);
});

test('Der letzte Inhaber und der letzte Chef bleiben bestehen', async () => {
  const owner = await store.getUserByUsername('chef');
  // Direkt in der Datenbank einen zweiten Inhaber anlegen und wieder aussperren wollen.
  const id = await store.createUser({ username: 'zweit', passwordHash: 'x', role: 'admin', name: 'Zweit', isOwner: true });
  await chef.get('/inhaber');
  let page = await chef.follow(`/inhaber/benutzer/${id}/inhaber`, {});
  assert.match(page.data, /keine Inhaber-Rechte mehr/);
  assert.equal(await store.countActiveOwners(), 1);
  page = await chef.follow(`/inhaber/benutzer/${id}/loeschen`, {});
  assert.match(page.data, /Zweit wurde entfernt/);
  assert.equal((await store.getUser(owner.id)).is_owner, 1);
  assert.equal((await store.getUser(owner.id)).active, 1);
});

test('Updates kommen sofort an: Seiten nicht zwischengespeichert, Stil mit Versionskennung', async () => {
  const page = await fetch(`${base}/login`);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  const html = await page.text();
  const css = /href="(\/static\/css\/app\.css\?v=[0-9a-f]{10})"/.exec(html);
  assert.ok(css, 'Stil mit ?v=');
  assert.match(html, /src="\/static\/js\/app\.js\?v=[0-9a-f]{10}"/);
  assert.match(html, /src="\/static\/js\/theme\.js\?v=[0-9a-f]{10}"/);
  const asset = await fetch(base + css[1]);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /max-age=\d+/);
});

test('Falsches Passwort wird abgelehnt', async () => {
  const res = await new Client().post('/login', { benutzername: 'anna', passwort: 'falsch' });
  assert.equal(res.status, 401);
});

test('Auf Vercel ohne Datenbank erscheint eine Anleitung', async () => {
  const srv = createApp({ config: { ...config, dbMissing: true } }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /Datenbank verbinden/);
  } finally {
    srv.close();
  }
});

test('Turso-Zugangsdaten werden auch mit Präfix erkannt', async () => {
  const { loadConfig, databaseVariableNames } = await import('../src/config.js');
  const prefixed = loadConfig({ VERCEL: '1', STORAGE_TURSO_DATABASE_URL: 'libsql://x.turso.io', STORAGE_TURSO_AUTH_TOKEN: 'abc' });
  assert.equal(prefixed.dbUrl, 'libsql://x.turso.io');
  assert.equal(prefixed.dbAuthToken, 'abc');
  assert.equal(prefixed.dbMissing, false);
  assert.equal(loadConfig({ VERCEL: '1' }).dbMissing, true);
  assert.deepEqual(databaseVariableNames({ TURSO_AUTH_TOKEN: 'geheim', PATH: '/bin' }), ['TURSO_AUTH_TOKEN']);
});

test('Nicht erreichbare Datenbank zeigt eine verständliche Seite', async () => {
  const srv = createApp({ config: { ...config, dbUrl: 'http://127.0.0.1:9', dbAuthToken: 'x' } }).listen(0);
  await new Promise((r) => srv.once('listening', r));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/login`);
    assert.equal(res.status, 503);
    assert.match(await res.text(), /Datenbank nicht erreichbar/);
  } finally {
    srv.close();
  }
});
