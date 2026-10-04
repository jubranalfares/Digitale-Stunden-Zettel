// Datenbank-Aktualisierung bestehender Installationen.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { openDatabase } from '../src/db.js';
import { Store } from '../src/store.js';

// Zustand vor der Inhaber-Rolle herstellen: Spalte entfernen, Version zurückdrehen.
async function oldInstallation(file) {
  const db = await openDatabase({ dbUrl: `file:${file}` });
  const store = new Store(db);
  await store.createUser({ username: 'chef', passwordHash: 'x', role: 'admin', name: 'Chef' });
  await store.createUser({ username: 'anna', passwordHash: 'x', role: 'employee', name: 'Anna' });
  await db.run('ALTER TABLE users DROP COLUMN is_owner');
  await db.run('UPDATE schema_version SET version = 1');
  db.close();
}

test('Bestehende Installation: der erste Zugang wird Inhaber', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stundenzettel-db-'));
  try {
    const file = path.join(tmp, 'alt.db');
    await oldInstallation(file);
    const db = await openDatabase({ dbUrl: `file:${file}` });
    const store = new Store(db);
    assert.equal((await store.getUserByUsername('chef')).is_owner, 1);
    assert.equal((await store.getUserByUsername('anna')).is_owner, 0);
    db.close();
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('Zwei gleichzeitig startende Server aktualisieren ohne Fehler', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stundenzettel-db-'));
  try {
    const file = path.join(tmp, 'alt.db');
    await oldInstallation(file);
    const dbs = await Promise.all([openDatabase({ dbUrl: `file:${file}` }), openDatabase({ dbUrl: `file:${file}` })]);
    assert.equal(Number((await dbs[0].get('SELECT COUNT(*) AS n FROM users WHERE is_owner = 1')).n), 1);
    dbs.forEach((db) => db.close());
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

for (const variant of ['inhaber', 'signaturen']) {
  test(`Migration übernimmt Version 2 (${variant}) ohne Datenverlust`, async (t) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'stundenzettel-v2-'));
    const file = path.join(tmp, 'v2.db');
    let db = await openDatabase({ dbUrl: `file:${file}` });
    t.after(() => { db.close(); fs.rmSync(tmp, { recursive: true, force: true }); });
    const store = new Store(db);
    const admin = await store.createUser({ username: 'chef', passwordHash: 'x', role: 'admin', name: 'Chef', isOwner: true });
    const employee = await store.createUser({ username: 'anna', passwordHash: 'x', role: 'employee', name: 'Anna' });
    const sig = await store.setEmployerSignature(admin, 'existing-png');
    await store.saveEntry({ user_id: employee, work_date: '2026-10-01', start_time: 720, end_time: 960,
      break_minutes: 0, work_minutes: 240, remarks: 'bestehend', recorded_on: '2026-10-04', recorded_by: admin,
      employer_signature_id: sig });
    if (variant === 'inhaber') await db.run('ALTER TABLE entries DROP COLUMN employer_signature_id');
    else await db.run('ALTER TABLE users DROP COLUMN is_owner');
    await db.run('UPDATE schema_version SET version = 2');
    db.close();
    db = await openDatabase({ dbUrl: `file:${file}` });
    const restored = new Store(db);
    const entry = await restored.getEntry(employee, '2026-10-01');
    assert.equal(entry.work_minutes, 240);
    assert.equal(entry.remarks, 'bestehend');
    assert.equal(entry.employer_signature_id, sig);
    assert.equal((await restored.getUser(admin)).is_owner, 1);
    assert.equal((await db.get('SELECT version FROM schema_version')).version, 3);
  });
}
