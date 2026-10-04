import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { hashPassword, LoginThrottle } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { saveEntry, canEdit } from '../src/entries.js';
import { validImageDataUrl } from '../src/http.js';
import { buildEmployeeSheet, buildRoster } from '../src/sheets.js';
import { Store } from '../src/store.js';
import { parseClock, parseDuration, parseRosterInput } from '../src/time.js';
import { signaturePng } from './helpers/signature.js';

const passwordHash = await hashPassword('test-password-123');
const signature = signaturePng('Test employee');
const today = '2026-10-04';
const ym = { year: 2026, month: 10 };
async function fixture(t) {
  const db = await openDatabase({ dbUrl: ':memory:' });
  t.after(() => db.close());
  const store = new Store(db);
  const adminId = await store.createInitialAdmin('Test-Eiscafé', { name: 'Chef', username: 'chef', role: 'admin', passwordHash });
  await store.setEmployerSignature(adminId, signaturePng('Chef'));
  const employeeId = await store.createUser({ name: 'Ayşe Yılmaz', username: 'ayse', role: 'employee', passwordHash });
  await store.setUserSignature(employeeId, signature);
  const admin = await store.getUser(adminId);
  const employee = await store.getUser(employeeId);
  const save = (input, actor = employee) => saveEntry(store, { actor, employee, today, input: { datum: '2026-10-01', ...input } });
  return { store, db, admin, employee, save };
}

test('Papierformate und ungültige Minuten werden einheitlich gelesen', () => {
  for (const [raw, minutes] of [['12',720],['930',570],['12.30',750],['00',0],['2359',1439]]) assert.equal(parseClock(raw), minutes);
  for (const [raw, minutes] of [['30',30],['1',60],['130',90],['',0],['1:30',90]]) assert.equal(parseDuration(raw), minutes);
  for (const raw of ['1:70','1.70','160','-30','abc']) assert.throws(() => parseDuration(raw));
  for (const raw of ['24','2360','12:3','-1']) assert.throws(() => parseClock(raw));
});

test('Einsatzliste wird auch serverseitig gelesen, mit Pause, Kürzeln und Löschung', async (t) => {
  const { save, store, employee } = await fixture(t);
  await save({ beginn: '12', ende: '16', pause: '30', bemerkung: 'Terrasse' });
  await save({ einsatz: '12-17' });
  let entry = await store.getEntry(employee.id, '2026-10-01');
  assert.equal(entry.work_minutes, 270);
  assert.equal(entry.break_minutes, 30);
  assert.equal(entry.remarks, 'Terrasse');
  await assert.rejects(save({ einsatz: '2360-16' }));
  assert.equal((await store.getEntry(employee.id, '2026-10-01')).work_minutes, 270);
  for (const code of ['K','U','UU','F','SA','SU']) {
    assert.equal(parseRosterInput(code.toLowerCase()).kuerzel, code);
    await save({ einsatz: code });
    entry = await store.getEntry(employee.id, '2026-10-01');
    assert.equal(entry.code, code);
    assert.equal(entry.work_minutes, 0);
    assert.ok(entry.signature_id);
  }
  await save({ einsatz: '' });
  assert.equal(await store.getEntry(employee.id, '2026-10-01'), null);
});

test('Unvollständige Zeilen ändern weder vorhandene Daten noch deren Signatur', async (t) => {
  const { save, store, employee } = await fixture(t);
  await save({ beginn: '12', ende: '16' });
  const before = await store.getEntry(employee.id, '2026-10-01');
  await assert.rejects(save({ beginn: '9', ende: '' }), /Ende fehlt/);
  await assert.rejects(save({ beginn: '', ende: '', pause: '30' }), /fehlen/);
  await assert.rejects(save({ beginn: '12', ende: '13', pause: '130' }), /Pause/);
  assert.deepEqual(await store.getEntry(employee.id, '2026-10-01'), before);
});

test('Unterschriften bleiben bei Neuzeichnung und späterer Korrektur versioniert', async (t) => {
  const { save, store, employee, admin } = await fixture(t);
  await save({ einsatz: '12-16' });
  const first = await store.getEntry(employee.id, '2026-10-01');
  const oldSheet = await buildEmployeeSheet(store, employee, ym);
  const newEmployeeSig = await store.setUserSignature(employee.id, signaturePng('Version 2'));
  const newEmployerSig = await store.setEmployerSignature(admin.id, signaturePng('Chef Version 2'));
  const stillOld = await buildEmployeeSheet(store, employee, ym);
  assert.equal(stillOld.employeeSignature.id, oldSheet.employeeSignature.id);
  assert.equal(stillOld.employerSignature.id, oldSheet.employerSignature.id);
  await save({ einsatz: '12-17' });
  const corrected = await store.getEntry(employee.id, '2026-10-01');
  assert.equal(corrected.signature_id, first.signature_id);
  assert.equal(corrected.employer_signature_id, first.employer_signature_id);
  await save({ datum: '2026-10-02', einsatz: '12-16' });
  const second = await store.getEntry(employee.id, '2026-10-02');
  assert.equal(second.signature_id, newEmployeeSig);
  assert.equal(second.employer_signature_id, newEmployerSig);
  const sheet = await buildEmployeeSheet(store, employee, ym);
  assert.equal(sheet.employeeSignature.date, today);
  assert.equal(sheet.employerSignature.date, today);
  assert.equal(sheet.total, '9:00');
});

test('Chef-Einträge entfernen die Mitarbeiter-Signatur und erscheinen als AG', async (t) => {
  const { save, employee, admin, store } = await fixture(t);
  await save({ einsatz: '12-16' });
  await save({ einsatz: '12-18' }, admin);
  const sheet = await buildEmployeeSheet(store, employee, ym);
  assert.equal(sheet.rows[0].recordedByEmployer, true);
  assert.equal(sheet.employeeSignature, null);
  const cell = (await buildRoster(store, ym)).employees.find((u) => u.id === employee.id).days[1];
  assert.equal(cell.signature, null);
  assert.equal(cell.signatureId, null);
  assert.equal(cell.recordedByEmployer, true);
});

test('Rechte, Zukunftstage und Jahreswechsel gelten im Service und nicht nur im UI', async (t) => {
  const { save, store, employee, admin } = await fixture(t);
  assert.equal(canEdit(employee, '2025-12-01', '2026-01-03'), true);
  assert.equal(canEdit(employee, '2025-11-30', '2026-01-03'), false);
  await assert.rejects(save({ datum: '2026-08-31', einsatz: '12-16' }), /Ältere/);
  await assert.rejects(save({ datum: '2026-10-05', einsatz: '12-16' }, admin), /Zukunft/);
  await save({ datum: '2025-01-01', einsatz: '12-16' }, admin);
  const otherId = await store.createUser({ name: 'Andere', username: 'andere', role: 'employee', passwordHash });
  await assert.rejects(save({ einsatz: '12-16' }, await store.getUser(otherId)), /Berechtigung/);
  await store.updateUser(employee.id, { active: 0 });
  await assert.rejects(save({ einsatz: '12-16' }), /Berechtigung/);
  assert.ok((await store.employeesForMonth('2025-01')).some((u) => u.id === employee.id));
});

test('Ohne Signatur ist auch das Leeren eines Tages nicht erlaubt', async (t) => {
  const { save, store, employee, admin } = await fixture(t);
  await save({ einsatz: '12-16' }, admin);
  await store.updateUser(employee.id, { signature_id: null });
  await assert.rejects(save({ einsatz: '' }), /unterschreiben/);
  assert.ok(await store.getEntry(employee.id, '2026-10-01'));
});

test('Login-Sperre bleibt über Instanzen erhalten und läuft nach fünf Minuten ab', async (t) => {
  const { store, db } = await fixture(t);
  const a = new LoginThrottle({ store });
  const b = new LoginThrottle({ store: new Store(db) });
  for (let i=0; i<5; i++) await a.fail(['user:ayse', 'ip:test']);
  assert.equal(await b.isBlocked(['user:ayse']), true);
  assert.equal(await b.isBlocked(['ip:test']), true);
  await store.db.run("UPDATE settings SET value = ? WHERE key LIKE 'login:%'", [JSON.stringify({ count: 5, until: 1, expiresAt: 1 })]);
  assert.equal(await b.isBlocked(['user:ayse']), false);
  await b.fail(['user:ayse']);
  assert.equal(await b.isBlocked(['user:ayse']), false);
  assert.equal(Object.keys(await store.getSettings()).some((k) => k.startsWith('login:')), false);
});

test('Parallele Kaltstarts und Ersteinrichtungen legen genau einen Chef an', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stundenzettel-race-'));
  const dbs = [];
  t.after(() => {
    for (const db of dbs) db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const config = { dbUrl: `file:${path.join(dir, 'race.db')}` };
  await Promise.all([0, 1].map(async () => dbs.push(await openDatabase(config))));
  const stores = dbs.map((db) => new Store(db));
  const ids = await Promise.all(stores.map((store, i) => store.createInitialAdmin(`Café ${i}`, {
    name: `Chef ${i}`, username: `chef${i}`, role: 'admin', passwordHash,
  })));
  assert.equal(ids.filter((id) => id !== null).length, 1);
  assert.equal(await stores[0].countUsers(), 1);
  assert.equal(Number((await dbs[0].get('SELECT version FROM schema_version')).version), 2);
});

test('SQL-Sicherung lässt sich vollständig in eine neue Datenbank zurückspielen', async (t) => {
  const { store, save } = await fixture(t);
  await save({ einsatz: '23-3' });
  const sql = await store.dumpSql();
  const restored = await openDatabase({ dbUrl: ':memory:' });
  t.after(() => restored.close());
  await restored.client.executeMultiple(sql);
  const newStore = new Store(restored);
  assert.deepEqual(await newStore.listMonthEntries('2026-10'), await store.listMonthEntries('2026-10'));
  assert.equal((await newStore.getSettings()).company_name, 'Test-Eiscafé');
  assert.equal((await restored.get('SELECT count(*) AS n FROM sessions')).n, 0);
  const tables = (await restored.all("SELECT name FROM sqlite_master WHERE type='table'")).map((r) => r.name);
  assert.equal(tables.includes('audit_log'), false);
  assert.equal(tables.includes('month_locks'), false);
});

test('Es werden echte Bilddateien akzeptiert, beschädigte Signaturen abgelehnt', () => {
  assert.equal(validImageDataUrl(signature), signature);
  const damaged = Buffer.from(signature.split(',')[1], 'base64');
  damaged[100] ^= 255;
  assert.equal(validImageDataUrl(`data:image/png;base64,${damaged.toString('base64')}`), null);
  assert.equal(validImageDataUrl('data:image/svg+xml;base64,PHN2Zz48L3N2Zz4='), null);
});
