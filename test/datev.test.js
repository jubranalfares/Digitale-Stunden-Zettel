import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { datevProblems, datevReady, datevRows, datevSettingProblem, lodasFile, PERSONNEL_NO } from '../src/datev.js';

const settings = { datev_berater_nr: '1234567', datev_mandanten_nr: '12345', datev_lohnart: '101', datev_bs_nr: '1' };
const october = { year: 2026, month: 10 };

// Beispieldaten, aus denen auch docs/DATEV_LODAS_Beispiel.txt entsteht.
const exampleRows = [
  { name: 'Ben Beispiel', personnelNo: '102', minutes: 1530 },
  { name: 'Anna Muster', personnelNo: '101', minutes: 2280 },
  { name: 'Carla Probe', personnelNo: '103', minutes: 620 },
];

test('LODAS-Datei: Kopf, Satzbeschreibung und eine Zeile je Mitarbeiter', () => {
  const file = lodasFile({ settings, ym: october, rows: exampleRows });
  assert.equal(file, [
    '[Allgemein]',
    'Ziel=LODAS',
    'Version_SST=1.0',
    'BeraterNr=1234567',
    'MandantenNr=12345',
    'Datumsformat=TT.MM.JJJJ',
    'Feldtrennzeichen=;',
    'Zahlenkomma=,',
    '',
    '[Satzbeschreibung]',
    '10;u_lod_bwd_buchung_standard;pnr#bwd;abrechnung_zeitraum#bwd;bs_wert_butab#bwd;bs_nr#bwd;la_eigene#bwd;',
    '',
    '[Bewegungsdaten]',
    '10;101;01.10.2026;38,00;1;101;',
    '10;102;01.10.2026;25,50;1;101;',
    '10;103;01.10.2026;10,33;1;101;',
    '',
  ].join('\r\n'));
});

test('LODAS-Datei: Zeilenende CR LF, nur ASCII, Monat mit führender Null', () => {
  const file = lodasFile({ settings, ym: { year: 2027, month: 3 }, rows: [{ personnelNo: '7', minutes: 30 }] });
  assert.match(file, /10;7;01\.03\.2027;0,50;1;101;\r\n$/);
  assert.equal(file.split('\r\n').length, 15);
  assert.ok(!/\r(?!\n)|(?<!\r)\n/.test(file), 'jede Zeile endet mit CR LF');
  assert.ok(/^[\x20-\x7e\r\n]*$/.test(file), 'nur einfache Zeichen');
});

test('Minuten werden auf zwei Stellen gerundet, wie auf dem Stundenzettel', () => {
  const value = (minutes) => lodasFile({ settings, ym: october, rows: [{ personnelNo: '1', minutes }] })
    .trim().split('\r\n').at(-1).split(';')[3];
  assert.equal(value(20), '0,33');
  assert.equal(value(40), '0,67');
  assert.equal(value(270), '4,50');
  assert.equal(value(9999), '166,65');
});

test('Stunden werden je Mitarbeiter summiert, Mitarbeiter ohne Stunden fehlen', () => {
  const employees = [
    { id: 1, name: 'Anna', personnel_no: '101' },
    { id: 2, name: 'Ben', personnel_no: '102' },
  ];
  const entries = [
    { user_id: 1, work_minutes: 240 },
    { user_id: 1, work_minutes: 90 },
    { user_id: 2, work_minutes: 0 },
    { user_id: 9, work_minutes: 60 },
  ];
  assert.deepEqual(datevRows(employees, entries), [{ name: 'Anna', personnelNo: '101', minutes: 330 }]);
});

test('Fehlende Angaben werden verständlich gemeldet', () => {
  assert.deepEqual(datevProblems({ ...settings, datev_lohnart: '', datev_bs_nr: '' }, exampleRows),
    ['In den Einstellungen fehlt noch: Lohnart für Arbeitsstunden, Bearbeitungsschlüssel.']);
  assert.deepEqual(datevProblems(settings, []), ['In diesem Monat sind noch keine Stunden eingetragen.']);
  assert.deepEqual(datevProblems(settings, [
    { name: 'Anna', personnelNo: '', minutes: 60 },
    { name: 'Ben', personnelNo: '0102', minutes: 60 },
    { name: 'Carla', personnelNo: '102', minutes: 60 },
  ]), [
    'Personalnummer fehlt bei Anna. Bitte unter Mitarbeiter eintragen.',
    'Die Personalnummer 102 ist doppelt vergeben (Ben, Carla).',
  ]);
  assert.deepEqual(datevProblems(settings, exampleRows), []);
});

test('Eingaben für DATEV werden geprüft', () => {
  assert.equal(datevReady(settings), true);
  assert.equal(datevReady({ ...settings, datev_mandanten_nr: '' }), false);
  assert.equal(datevSettingProblem('datev_berater_nr', ''), null);
  assert.equal(datevSettingProblem('datev_berater_nr', '1234567'), null);
  assert.equal(datevSettingProblem('datev_berater_nr', '123'), 'Beraternummer: bitte nur 4 bis 7 Ziffern.');
  assert.equal(datevSettingProblem('datev_lohnart', '10a'), 'Lohnart für Arbeitsstunden: bitte nur 1 bis 4 Ziffern.');
  assert.equal(datevSettingProblem('datev_bs_nr', '123'), 'Bearbeitungsschlüssel: bitte nur 1 oder 2 Ziffern.');
  for (const ok of ['1', '101', '99999', '00101']) assert.ok(PERSONNEL_NO.test(ok), ok);
  for (const bad of ['', '0', '000', '123456', 'A12', '1 2']) assert.ok(!PERSONNEL_NO.test(bad), bad);
});

test('Die Beispieldatei in docs/ entspricht genau dem, was die App erzeugt', () => {
  const example = fs.readFileSync(new URL('../docs/DATEV_LODAS_Beispiel.txt', import.meta.url), 'latin1');
  assert.equal(example, lodasFile({ settings, ym: october, rows: exampleRows }));
});
