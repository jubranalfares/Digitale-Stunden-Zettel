import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../src/app.js';
import { openDatabase } from '../src/db.js';
import { Store } from '../src/store.js';
import { todayISO } from '../src/time.js';

let db, store, server, base, dir;
const today = todayISO('Europe/Berlin');
const date = `${today.slice(0,7)}-01`;
test.beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stundenzettel-browser-'));
  db = await openDatabase({ dbUrl: `file:${path.join(dir,'test.db')}` });
  store = new Store(db);
  server = createApp({ db, config: { timeZone: 'Europe/Berlin', trustProxy: false } }).listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
async function draw(page) {
  const canvas = page.locator('canvas');
  await canvas.scrollIntoViewIfNeeded();
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x+25,box.y+90);
  await page.mouse.down();
  for (let i=0;i<12;i++) await page.mouse.move(box.x+25+i*17,box.y+80+Math.sin(i)*25);
  await page.mouse.up();
}
async function setup(page) {
  await page.goto(base);
  await page.getByLabel('Name des Betriebs').fill('Eiscafé Taormina');
  await page.getByLabel('Ihr Name').fill('Chef');
  await page.getByLabel('Benutzername').fill('chef');
  await page.getByLabel('Passwort (mind.').fill('Chef-Test-123!');
  await page.getByLabel('Passwort wiederholen').fill('Chef-Test-123!');
  await page.getByRole('button',{name:'Einrichten',exact:true}).click();
  await draw(page);
  await page.getByRole('button',{name:'Unterschrift speichern'}).click();
  await page.getByRole('link',{name:'Mitarbeiter',exact:true}).click();
  await page.getByLabel('Vor- und Nachname').fill('Ayşe Yılmaz');
  await page.getByLabel('Benutzername').fill('ayse');
  await page.getByLabel('Startpasswort').fill('Start-Test-123!');
  await page.getByRole('button',{name:'Anlegen',exact:true}).click();
}
async function employeeLogin(page) {
  await page.goto(`${base}/login`);
  await page.getByLabel('Benutzername').fill('ayse');
  await page.getByLabel('Passwort',{exact:true}).fill('Start-Test-123!');
  await page.getByRole('button',{name:'Anmelden',exact:true}).click();
  await page.getByLabel('Neues Passwort', { exact: false }).first().fill('Eigenes-Test-123!');
  await page.locator('input[name="passwort2"]').fill('Eigenes-Test-123!');
  await draw(page);
  await page.getByRole('button',{name:/Los|Speichern|einrichten|starten|Weiter/i}).click();
  await expect(page.locator('[data-heft]')).toBeVisible();
}

test('Abnahme: Einrichtung, Handy-Eingabe, Einsatzliste, Fehler, schneller Tabwechsel, AG und PDF', async ({ page, browser }, testInfo) => {
  const errors = [];
  page.on('pageerror',(error) => errors.push(error.message));
  await setup(page);
  const context = await browser.newContext(testInfo.project.use);
  const emp = await context.newPage();
  emp.on('pageerror',(error) => errors.push(error.message));
  try {
    await employeeLogin(emp);
    const user = await store.getUserByUsername('ayse');
    const row = emp.locator(`tr[data-date="${date}"]`);
    await row.locator('[name="beginn"]').fill('12');
    await row.locator('[name="ende"]').fill('16');
    await row.locator('[name="ende"]').press('Tab');
    // Tab bleibt zunächst innerhalb der Zeile; erst das Verlassen speichert.
    await emp.getByRole('navigation',{name:'Monat wählen'}).click();
    await expect(row.locator('[data-out="dauer"]')).toHaveText('4:00');
    await expect(emp.locator('[data-out="total"]')).toHaveText('4:00');
    await expect(emp.locator('[data-sig-img="employee"]')).toBeVisible();
    await expect(emp.locator('[data-toast]')).toContainText('✓ Gespeichert · Monatssumme 4:00 Std.');
    await expect.poll(async () => (await store.getEntry(user.id,date))?.work_minutes).toBe(240);
    await row.locator('[name="pause"]').fill('30');
    // Navigation erfolgt erst nach dem Speichern der Pause.
    await emp.getByRole('link',{name:'Einsatzliste',exact:true}).click();
    const cell = emp.locator(`[data-cell][data-date="${date}"]`);
    await cell.fill('12-17');
    await cell.press('Enter');
    await expect(cell.locator('..').locator('[data-cell-view]')).toContainText('4:30');
    await expect(emp.locator(`[data-sum-user="${user.id}"]`)).toHaveText('4:30');
    await expect(cell.locator('..').locator('img')).toBeVisible();
    await cell.fill('unvollständig');
    await cell.press('Enter');
    await expect(cell).toHaveAttribute('aria-invalid','true');
    expect((await store.getEntry(user.id,date)).work_minutes).toBe(270);
    await cell.fill('12-16');
    await cell.press('Enter');
    await expect(cell.locator('..').locator('[data-cell-view]')).toContainText('3:30');
    await emp.getByRole('link',{name:'Mein Stundenzettel'}).click();
    await expect(row.locator('[name="pause"]')).toHaveValue('0:30');
    await expect(row.locator('[data-out="dauer"]')).toHaveText('3:30');
    // Antwort kommt spät: neue Eingaben dürfen nicht von der alten Antwort überschrieben werden.
    await emp.route('**/eintrag', async (route) => {
      const response = await route.fetch();
      await new Promise((resolve) => setTimeout(resolve,200));
      await route.fulfill({ response });
    });
    await row.locator('[name="ende"]').fill('18');
    await emp.getByRole('link',{name:'Einsatzliste',exact:true}).click();
    await expect(emp.locator('.roster')).toBeVisible();
    await expect(cell.locator('..').locator('[data-cell-view]')).toContainText('5:30');
    await emp.unroute('**/eintrag');
    await emp.getByRole('link',{name:'Mein Stundenzettel'}).click();
    await emp.screenshot({ path: testInfo.outputPath('handy-erfassung.png'), fullPage: false });
    await emp.locator('.paper').screenshot({ path: testInfo.outputPath('stundenzettel.png') });

    await page.getByRole('link',{name:'Heft',exact:true}).click();
    const adminCell = page.locator(`[data-cell][data-user="${user.id}"][data-date="${date}"]`);
    await adminCell.fill('12-19');
    await adminCell.press('Enter');
    await expect(adminCell.locator('..').locator('.rc-ag')).toHaveText('AG');
    await expect(adminCell.locator('..').locator('img')).toHaveCount(0);
    await expect(page.locator(`[data-sum-user="${user.id}"]`)).toHaveText('6:30');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('link',{name:'PDF für Steuerberater'}).click();
    const download = await downloadPromise;
    await download.saveAs(testInfo.outputPath('abnahme.pdf'));
    expect(fs.readFileSync(await download.path()).subarray(0,4).toString()).toBe('%PDF');
    await page.locator('.paper').screenshot({ path: testInfo.outputPath('einsatzliste.png') });
    expect(errors).toEqual([]);
  } finally { await context.close(); }
});
