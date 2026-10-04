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
  await db.run('UPDATE schema_version SET version = version - 1');
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

test('Wegwerf-Datenbank pro Deployment wird erkannt', async () => {
  const { isDeploymentDatabase, databaseHost } = await import('../src/config.js');
  const temp = 'libsql://dpl-2uwk1ewvge5hppc2ppwwav-vercel-icfg-6stjapdoxqvwtdnjrhetivjw.aws-us-east-1.turso.io';
  assert.equal(isDeploymentDatabase(temp), true);
  assert.equal(isDeploymentDatabase('libsql://database-arbeitsstunden-vercel-icfg-6stjapdoxqvwtdnjrhetivjw.aws-us-east-1.turso.io'), false);
  assert.equal(isDeploymentDatabase('file:data/x.db'), false);
  assert.equal(databaseHost(temp), 'dpl-2uwk1ewvge5hppc2ppwwav-vercel-icfg-6stjapdoxqvwtdnjrhetivjw.aws-us-east-1.turso.io');
});
