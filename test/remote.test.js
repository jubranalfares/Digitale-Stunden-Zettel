// Prüft den Online-Betrieb (Vercel + Turso) über den echten HTTP-Client gegen einen Protokoll-Nachbau.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
import { signaturePng } from './helpers/signature.js';
import { loadConfig } from '../src/config.js';
import { startHranaMock } from './helpers/hrana-mock.js';

let mock;
let server;
let base;
let skip = false;

before(async () => {
  try {
    mock = await startHranaMock();
  } catch {
    skip = true; // node:sqlite fehlt (Node < 22)
    return;
  }
  const config = loadConfig({ VERCEL: '1', TURSO_DATABASE_URL: mock.url, TURSO_AUTH_TOKEN: 'test' });
  assert.equal(config.dbMissing, false);
  server = createApp({ config }).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server?.close();
  mock?.close();
});

let cookie = '';
let csrf = '';
async function call(path, form) {
  const res = await fetch(base + path, {
    method: form ? 'POST' : 'GET',
    headers: { cookie, ...(form ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) },
    body: form ? new URLSearchParams({ _csrf: csrf, ...form }).toString() : undefined,
    redirect: 'manual',
  });
  for (const c of res.headers.getSetCookie()) cookie = c.split(';')[0];
  const isHtml = (res.headers.get('content-type') ?? '').startsWith('text/html');
  const data = isHtml ? await res.text() : Buffer.from(await res.arrayBuffer());
  if (isHtml) csrf = /name="_csrf" value="([^"]+)"/.exec(data)?.[1] ?? csrf;
  return { status: res.status, location: res.headers.get('location'), data };
}

test('Online-Datenbank: Einrichten, ins Heft schreiben, PDF', async (t) => {
  if (skip) return t.skip('node:sqlite nicht verfügbar');
  assert.equal((await call('/')).location, '/setup');
  await call('/setup');
  const setup = await call('/setup', {
    firma: 'Eiscafé Taormina', name: 'Chef', benutzername: 'chef', passwort: 'geheim123', passwort2: 'geheim123',
  });
  assert.equal(setup.status, 302);
  await call('/einstellungen');
  await call('/einstellungen/unterschrift', { unterschrift: signaturePng('Chef') });
  await call('/admin/mitarbeiter');
  const created = await call('/admin/mitarbeiter', { name: 'Giulia Romano', benutzername: 'giulia', passwort: 'start1234' });
  assert.equal(created.location, '/admin/mitarbeiter');

  const roster = await call('/einsatzliste');
  assert.match(roster.data, /Einsatzliste für Minijobber/);
  const userId = /data-cell data-user="(\d+)"/.exec(roster.data)[1];
  const today = /data-cell data-user="\d+" data-date="([\d-]+)"/g;
  let last;
  for (const m of roster.data.matchAll(today)) last = m[1];

  const saved = await call('/eintrag', { user: userId, datum: last, beginn: '12', ende: '16', kuerzel: '' });
  assert.equal(saved.status, 200);
  const data = JSON.parse(saved.data);
  assert.equal(data.cell.duration, '4:00');
  assert.equal(data.total, '4:00');
  assert.match((await call('/einsatzliste')).data, /4:00/);

  const pdf = await call('/pdf');
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const backup = await call('/admin/sicherung');
  assert.match(backup.data.toString(), /INSERT OR REPLACE INTO entries/);
  assert.ok(mock.requests > 10);
});
