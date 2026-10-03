// Geometrie der beiden Papierformulare in PDF-Punkten (A4 = 595,28 × 841,89 pt).
// PDF-Erzeugung und Browser-Ansicht nutzen dieselben Werte, damit beide identisch aussehen.

export const PAGE = { w: 595.28, h: 841.89 };

const sum = (a) => a.reduce((s, x) => s + x, 0);
const offsets = (widths, start) => widths.reduce((acc, w) => [...acc, acc.at(-1) + w], [start]);

// ---- "Vorlage zur Dokumentation der täglichen Arbeitszeit" -------------------

const datevCols = [
  { key: 'day', label: ['Kalen-', 'dertag'], w: 33.4 },
  { key: 'start', label: ['Beginn', '(Uhrzeit)'], w: 46.8 },
  { key: 'breakTime', label: ['Pause', '(Dauer)'], w: 45.9 },
  { key: 'end', label: ['Ende', '(Uhrzeit)'], w: 41.0 },
  { key: 'duration', label: ['Dauer', '(Summe)'], w: 45.4 },
  { key: 'code', label: ['*'], w: 22.3 },
  { key: 'recordedOn', label: ['aufgezeichnet', 'am:'], w: 60.1 },
  { key: 'remarks', label: ['Bemerkungen'], w: 137.1 },
];

const datevLeft = 82;
const datevX = offsets(datevCols.map((c) => c.w), datevLeft);

export const DATEV = {
  font: 'Sans',
  fontBold: 'Sans-Bold',
  left: datevLeft,
  width: sum(datevCols.map((c) => c.w)),
  title: { y: 38, size: 11.5, text: 'Vorlage zur Dokumentation der täglichen Arbeitszeit' },
  labelSize: 9.5,
  valueSize: 9,
  fields: {
    firma: { label: 'Firma:', labelY: 62, box: { x: 210, y: 59, w: 213, h: 14 } },
    name: { label: 'Name des Mitarbeiters:', labelY: 81, box: { x: 210, y: 78, w: 213, h: 14 } },
    persNr: { label: 'Pers.-Nr.:', labelY: 100, box: { x: 210, y: 97, w: 42, h: 14 } },
    month: { label: 'Monat/Jahr:', labelX: 263, labelY: 101, box: { x: 316, y: 98, w: 107, h: 14 } },
  },
  logo: { x: 440, y: 52, w: 76, h: 60 },
  table: {
    top: 120,
    headerH: 23,
    rowH: 16.6,
    headerSize: 7.5,
    bodySize: 8.5,
    headerFill: '#bfbfbf',
    headerText: '#3a3a3a',
    cols: datevCols.map((c, i) => ({ ...c, x: datevX[i] })),
  },
  summe: { y: 681, size: 8.5 },
  signatures: {
    lineY: 728,
    labelSize: 8.5,
    employee: { x1: 114, x2: 295, dateX: 138, labelX: 228, label: 'Unterschrift des Arbeitnehmers' },
    employer: { x1: 317, x2: 502, dateX: 350, labelX: 442, label: 'Unterschrift des Arbeitgebers' },
  },
  note: { y: 747, size: 8.5, text: '* Tragen Sie in diese Spalte eines der folgenden Kürzel ein, wenn es für diesen Kalendertag zutrifft:' },
  key: { x: 207, y: 762, w: 88, rowH: 10.4, size: 8.5, codeX: 298, textX: 320, fill: '#bdbdbd' },
};
DATEV.table.bottom = DATEV.table.top + DATEV.table.headerH + 32 * DATEV.table.rowH;

// ---- "Einsatzliste" (alle Mitarbeiter) --------------------------------------

const rosterLeft = 40;
const rosterRight = 565;
const rosterFirstW = 57;
const rosterColW = (rosterRight - rosterLeft - rosterFirstW) / 8;

export const ROSTER = {
  font: 'Serif',
  fontBold: 'Serif-Bold',
  left: rosterLeft,
  right: rosterRight,
  firstW: rosterFirstW,
  colW: rosterColW,
  colX: Array.from({ length: 8 }, (_, i) => rosterLeft + rosterFirstW + i * rosterColW),
  heading: { x: 40, companyY: 40, titleY: 57, size: 13.5 },
  month: { x: 392, y: 26, size: 13.5, label: 'Monat/Jahr:' },
  table: {
    top: 84,
    nameRowH: 19.5,
    secondRowH: 19.5,
    rowH: 19.4,
    sumRowH: 19.5,
    daySize: 11,
    nameSize: 9.5,
  },
  employer: { lineY: 805, x1: 300, x2: 565, dateX: 330, labelX: 455, size: 9.5, label: 'Unterschrift des Arbeitgebers' },
};
ROSTER.table.daysTop = ROSTER.table.top + ROSTER.table.nameRowH + ROSTER.table.secondRowH;
ROSTER.table.sumTop = ROSTER.table.daysTop + 31 * ROSTER.table.rowH;
ROSTER.table.bottom = ROSTER.table.sumTop + ROSTER.table.sumRowH;
