// Prüft den Online-Betrieb (Vercel + Turso) über den echten HTTP-Client gegen einen Protokoll-Nachbau.
import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createApp } from '../src/app.js';
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

test('Online-Datenbank: Demo, Einsatzliste, Erfassen und PDF', async (t) => {
  if (skip) return t.skip('node:sqlite nicht verfügbar');
  assert.equal((await call('/')).location, '/setup');
  const demo = await call('/setup/demo', {});
  assert.equal(demo.location, '/admin');

  const dash = await call('/admin');
  assert.match(dash.data, /Giulia Romano/);
  const roster = await call('/einsatzliste');
  assert.match(roster.data, /Einsatzliste für Minijobber/);

  const data = JSON.parse(/id="entry-data">(.*?)<\/script>/s.exec(roster.data)[1]);
  const [giuliaId] = Object.entries(data.employees).find(([, e]) => e.name === 'Giulia Romano');
  const saved = await call(`/admin/zettel/${giuliaId}/eintrag`, {
    datum: data.today, beginn: '12:00', ende: '16:00', pause: '0:00', zurueck: '/einsatzliste',
  });
  assert.equal(saved.location, '/einsatzliste');
  assert.match((await call('/einsatzliste')).data, /12:00–16:00 = 4:00 Std\./);

  const pdf = await call('/admin/export.pdf');
  assert.equal(pdf.data.subarray(0, 4).toString(), '%PDF');
  const backup = await call('/admin/sicherung');
  assert.match(backup.data.toString(), /INSERT OR REPLACE INTO entries/);
  assert.ok(mock.requests > 10);
});
