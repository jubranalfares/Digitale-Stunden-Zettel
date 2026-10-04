import assert from 'node:assert/strict';
import { test } from 'node:test';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { hashPassword } from '../src/auth.js';
import { openDatabase } from '../src/db.js';
import { saveEntry } from '../src/entries.js';
import { createPdf, drawEmployeeSheet, drawRoster, pdfToBuffer } from '../src/pdf.js';
import { buildEmployeeSheet, buildRoster } from '../src/sheets.js';
import { Store } from '../src/store.js';
import { signaturePng } from './helpers/signature.js';

test('PDF: zwei Einsatzblätter, neun Zettel, A4, eingebettete Schriften/Signaturen, türkische Namen', async (t) => {
  const db = await openDatabase({ dbUrl: ':memory:' });
  t.after(() => db.close());
  const store = new Store(db);
  const passwordHash = await hashPassword('test-password-123');
  const adminId = await store.createInitialAdmin('Eiscafé Taormina', { name: 'Chef', username: 'chef', role: 'admin', passwordHash });
  await store.setEmployerSignature(adminId, signaturePng('Chef'));
  const ym = { year: 2026, month: 10 };
  const employees = [];
  for (let i=0;i<10;i++) {
    const id = await store.createUser({ name: i === 0 ? 'Ayşe Yılmaz' : `Mitarbeiter ${i}`, username: `user${i}`, role: 'employee', passwordHash });
    await store.setUserSignature(id, signaturePng(`Test ${i}`));
    const user = await store.getUser(id);
    if (i === 9) continue; // Kein Eintrag: im Export weder Spalte noch Zettel.
    await saveEntry(store, { actor: user, employee: user, today: '2026-10-04', input: { datum: '2026-10-01', einsatz: i === 1 ? 'U' : '12-16' } });
    employees.push(user);
  }
  const roster = await buildRoster(store, ym, { onlyWithEntries: true });
  assert.equal(roster.employees.length, 9);
  assert.equal(roster.pages.length, 2);
  assert.equal(roster.pages[0].length, 8);
  const doc = createPdf('PDF-Test');
  drawRoster(doc, roster);
  for (const user of employees) drawEmployeeSheet(doc, await buildEmployeeSheet(store, user, ym));
  const bytes = await pdfToBuffer(doc);
  assert.match(bytes.toString('latin1'), /\/FontFile2/);
  assert.match(bytes.toString('latin1'), /\/Subtype \/Image/);
  const loading = getDocument({ data: new Uint8Array(bytes), useSystemFonts: false });
  const pdf = await loading.promise;
  t.after(() => loading.destroy());
  assert.equal(pdf.numPages, 11);
  let text = '';
  for (let i=1;i<=pdf.numPages;i++) {
    const page = await pdf.getPage(i);
    assert.ok(Math.abs(page.view[2] - 595.28) < .1);
    assert.ok(Math.abs(page.view[3] - 841.89) < .1);
    const content = await page.getTextContent();
    text += content.items.map((item) => item.str).join(' ') + '\n';
  }
  assert.match(text, /Ayşe Yılmaz/);
  assert.match(text, /Dokumentation der täglichen Arbeitszeit/);
  assert.match(text, /Einsatzliste für Minijobber/);
  assert.match(text, /0:00/); // Urlaub ohne Stunden hat dieselbe Summe wie auf dem Bildschirm.
  assert.doesNotMatch(text, /Mitarbeiter 9/);
});
