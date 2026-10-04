// PDF-Erzeugung der beiden Formulare mit PDFKit (Vektorgrafik, druckfertig in A4).
import fs from 'node:fs';
import PDFDocument from 'pdfkit';
import { DATEV, PAGE, ROSTER } from './layout.js';
import { CODES } from './time.js';

// Eingebettete Schriften (Liberation, SIL OFL) decken auch Namen wie „Ayşe Yılmaz“ ab.
// Fehlen die Dateien, wird auf die PDF-Standardschriften zurückgegriffen.
const FONT_DIR = new URL('../assets/fonts/', import.meta.url);
const FONTS = {
  Sans: ['LiberationSans-Regular.ttf', 'Helvetica'],
  'Sans-Bold': ['LiberationSans-Bold.ttf', 'Helvetica-Bold'],
  Serif: ['LiberationSerif-Regular.ttf', 'Times-Roman'],
  'Serif-Bold': ['LiberationSerif-Bold.ttf', 'Times-Bold'],
};
const fontData = Object.fromEntries(Object.entries(FONTS).map(([name, [file, fallback]]) => {
  try {
    return [name, fs.readFileSync(new URL(file, FONT_DIR))];
  } catch {
    return [name, fallback];
  }
}));

export function createPdf(title) {
  const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: false,
    info: { Title: title, Creator: 'Digitale Stundenzettel' },
  });
  for (const [name, data] of Object.entries(fontData)) doc.registerFont(name, data);
  return doc;
}

export function pdfToBuffer(doc) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    doc.end();
  });
}

// ---- Hilfsfunktionen --------------------------------------------------------

function fitSize(doc, text, font, size, maxW, minSize = 5) {
  doc.font(font);
  let s = size;
  while (s > minSize && doc.fontSize(s).widthOfString(text) > maxW) s -= 0.25;
  return s;
}

// Text in einer Zelle vertikal zentrieren.
function cellText(doc, text, x, y, w, h, { font, size, align = 'center', color = '#000', pad = 2, shrink = true }) {
  if (text == null || text === '') return;
  const s = shrink ? fitSize(doc, String(text), font, size, w - 2 * pad) : size;
  doc.font(font).fontSize(s).fillColor(color);
  const lh = doc.currentLineHeight();
  doc.text(String(text), x + pad, y + (h - lh) / 2 + s * 0.06, {
    width: w - 2 * pad, align, lineBreak: false,
  });
}

function drawImage(doc, src, x, y, w, h, align = 'center') {
  if (!src) return;
  try {
    doc.image(src, x, y, { fit: [w, h], align, valign: 'bottom' });
  } catch {
    // Ein defektes Bild soll nie den Export verhindern.
  }
}

function hLine(doc, x1, x2, y, width = 0.6) {
  doc.lineWidth(width).moveTo(x1, y).lineTo(x2, y).stroke('#000');
}

function vLine(doc, x, y1, y2, width = 0.6) {
  doc.lineWidth(width).moveTo(x, y1).lineTo(x, y2).stroke('#000');
}

// ---- Stundenzettel (ein Mitarbeiter) ----------------------------------------

export function drawEmployeeSheet(doc, sheet) {
  doc.addPage({ size: [PAGE.w, PAGE.h], margin: 0 });
  const L = DATEV;
  const T = L.table;
  const right = L.left + L.width;

  // Kopf
  doc.font(L.font).fontSize(L.title.size).fillColor('#000')
    .text(L.title.text, L.left, L.title.y, { lineBreak: false });

  const field = (f, value) => {
    doc.font(L.font).fontSize(L.labelSize).fillColor('#000')
      .text(f.label, f.labelX ?? L.left, f.labelY, { lineBreak: false });
    doc.lineWidth(0.8).rect(f.box.x, f.box.y, f.box.w, f.box.h).stroke('#000');
    cellText(doc, value, f.box.x, f.box.y, f.box.w, f.box.h, { font: L.font, size: L.valueSize, align: 'left', pad: 3 });
  };
  field(L.fields.firma, sheet.company);
  field(L.fields.name, sheet.employee.name);
  field(L.fields.persNr, sheet.employee.personnelNo);
  field(L.fields.month, sheet.monthLabel);
  drawImage(doc, sheet.logo, L.logo.x, L.logo.y, L.logo.w, L.logo.h);

  // Tabellenkopf
  const headerBottom = T.top + T.headerH;
  doc.rect(L.left, T.top, L.width, T.headerH).fill(T.headerFill);
  for (const col of T.cols) {
    doc.font(L.font).fontSize(T.headerSize).fillColor(T.headerText);
    const lh = doc.currentLineHeight();
    const blockH = col.label.length * lh;
    col.label.forEach((line, i) => {
      doc.text(line, col.x, T.top + (T.headerH - blockH) / 2 + i * lh + 0.5, { width: col.w, align: 'center', lineBreak: false });
    });
  }

  // Zeilen: eine leere Zeile unter dem Kopf, dann Tag 1–31
  const rowTop = (i) => headerBottom + i * T.rowH;
  sheet.rows.forEach((row, i) => {
    const y = rowTop(i + 1);
    const h = T.rowH;
    const c = Object.fromEntries(T.cols.map((col) => [col.key, col]));
    const body = { font: L.font, size: T.bodySize };
    cellText(doc, String(row.day), c.day.x, y, c.day.w, h, body);
    if (!row.entry) return;
    cellText(doc, row.start, c.start.x, y, c.start.w, h, body);
    cellText(doc, row.breakTime, c.breakTime.x, y, c.breakTime.w, h, body);
    cellText(doc, row.end, c.end.x, y, c.end.w, h, body);
    cellText(doc, row.duration, c.duration.x, y, c.duration.w, h, body);
    cellText(doc, row.code, c.code.x, y, c.code.w, h, { font: L.fontBold, size: T.bodySize, pad: 1 });
    cellText(doc, row.recordedByEmployer ? `${row.recordedOn} AG` : row.recordedOn, c.recordedOn.x, y, c.recordedOn.w, h, { font: L.font, size: 8 });
    if (row.remarks) {
      const pad = 3;
      const w = c.remarks.w - 2 * pad;
      const one = fitSize(doc, row.remarks, L.font, 8, w, 6.5);
      doc.font(L.font).fontSize(one).fillColor('#000');
      if (doc.widthOfString(row.remarks) <= w) {
        cellText(doc, row.remarks, c.remarks.x, y, c.remarks.w, h, { font: L.font, size: one, align: 'left', pad, shrink: false });
      } else {
        doc.fontSize(6.2).text(row.remarks, c.remarks.x + pad, y + 1.2, { width: w, height: h - 1.5, lineGap: -0.6, ellipsis: true });
      }
    }
  });

  // Gitterlinien
  const bottom = T.bottom;
  doc.lineWidth(0.6).strokeColor('#000');
  for (let i = 0; i <= 32; i++) hLine(doc, L.left, right, headerBottom + i * T.rowH, i === 0 ? 0.9 : 0.6);
  for (const col of T.cols.slice(1)) vLine(doc, col.x, T.top, bottom, 0.8);
  doc.lineWidth(1.3).rect(L.left, T.top, L.width, bottom - T.top).stroke('#000');

  // Summe
  const cEnd = T.cols.find((c) => c.key === 'end');
  const cDur = T.cols.find((c) => c.key === 'duration');
  doc.font(L.fontBold).fontSize(L.summe.size).fillColor('#000')
    .text('Summe:', cEnd.x - 30, L.summe.y, { width: cEnd.w + 22, align: 'right', lineBreak: false });
  doc.font(L.fontBold).fontSize(9).text(sheet.totalMinutes ? sheet.total : '', cDur.x, L.summe.y - 1, { width: cDur.w, align: 'center', lineBreak: false });
  hLine(doc, cDur.x + 2, cDur.x + cDur.w - 2, L.summe.y + 10.5, 0.8);
  hLine(doc, cDur.x + 2, cDur.x + cDur.w - 2, L.summe.y + 12.6, 0.8);

  // Unterschriften
  const S = L.signatures;
  for (const [key, sig] of [['employee', sheet.employeeSignature], ['employer', sheet.employerSignature]]) {
    const p = S[key];
    hLine(doc, p.x1, p.x2, S.lineY, 0.8);
    doc.font(L.font).fontSize(S.labelSize).fillColor('#000');
    doc.text('Datum', p.dateX - 30, S.lineY + 3, { width: 60, align: 'center', lineBreak: false });
    doc.text(p.label, p.labelX - 70, S.lineY + 3, { width: 140, align: 'center', lineBreak: false });
    if (sig) {
      doc.font(L.font).fontSize(9).text(sig.dateLabel, p.dateX - 30, S.lineY - 12, { width: 60, align: 'center', lineBreak: false });
      drawImage(doc, sig.image, p.dateX + 32, S.lineY - 34, p.x2 - p.dateX - 34, 33);
    }
  }

  // Fußnote und Schlüssel
  doc.font(L.fontBold).fontSize(L.note.size).fillColor('#000')
    .text(L.note.text, L.left - 3, L.note.y, { lineBreak: false });
  const K = L.key;
  const codes = Object.entries(CODES);
  const keyH = codes.length * K.rowH;
  doc.rect(K.x, K.y, K.w, keyH).fill(K.fill);
  doc.lineWidth(0.8).rect(K.x, K.y, K.w, keyH).stroke('#000');
  cellText(doc, 'Schlüssel', K.x, K.y, K.w, keyH, { font: L.font, size: K.size, color: '#333' });
  codes.forEach(([code, text], i) => {
    const y = K.y + i * K.rowH + 1.2;
    doc.font(L.font).fontSize(K.size).fillColor('#000');
    doc.text(code, K.codeX, y, { lineBreak: false });
    doc.text(text, K.textX, y, { lineBreak: false });
  });

  if (sheet.rows.some((r) => r.recordedByEmployer)) {
    doc.font(L.font).fontSize(7).fillColor('#444')
      .text('AG = vom Arbeitgeber erfasst bzw. korrigiert', L.left, K.y + keyH + 8, { lineBreak: false });
  }
}

// ---- Einsatzliste (alle Mitarbeiter) ----------------------------------------

export function drawRoster(doc, roster) {
  roster.pages.forEach((columns, pageIndex) => drawRosterPage(doc, roster, columns, pageIndex));
}

function drawRosterPage(doc, roster, columns, pageIndex) {
  doc.addPage({ size: [PAGE.w, PAGE.h], margin: 0 });
  const R = ROSTER;
  const T = R.table;

  doc.font(R.font).fontSize(R.heading.size).fillColor('#000');
  doc.text(roster.company, R.heading.x, R.heading.companyY, { lineBreak: false });
  doc.text(roster.title, R.heading.x, R.heading.titleY, { lineBreak: false });
  doc.text(R.month.label, R.month.x, R.month.y, { lineBreak: false });
  const labelW = doc.widthOfString(R.month.label);
  doc.text(roster.monthLabel, R.month.x + labelW + 6, R.month.y, { lineBreak: false });
  if (roster.pages.length > 1) {
    doc.fontSize(9).text(`Blatt ${pageIndex + 1} von ${roster.pages.length}`, R.month.x, R.month.y + 18, { lineBreak: false });
  }

  // Erste Spalte
  cellText(doc, 'Name', R.left, T.top, R.firstW, T.nameRowH, { font: R.font, size: T.daySize });
  for (let d = 1; d <= 31; d++) {
    cellText(doc, String(d), R.left, T.daysTop + (d - 1) * T.rowH, R.firstW, T.rowH, { font: R.font, size: T.daySize });
  }
  cellText(doc, 'Summe', R.left, T.sumTop, R.firstW, T.sumRowH, { font: R.fontBold, size: 10 });

  // Mitarbeiterspalten
  columns.forEach((emp, i) => {
    if (!emp) return;
    const x = R.colX[i];
    const w = R.colW;
    drawName(doc, emp.name, x, T.top, w, T.nameRowH);
    for (let d = 1; d <= 31; d++) {
      const cell = emp.days[d];
      if (cell) drawRosterCell(doc, cell, x, T.daysTop + (d - 1) * T.rowH, w, T.rowH);
    }
    cellText(doc, emp.total, x, T.sumTop, w, T.sumRowH, { font: R.fontBold, size: 9.5 });
  });

  // Gitter wie auf dem Papier: waagerechte Linien über die volle Breite, senkrechte nur innen
  const ys = [T.top, T.top + T.nameRowH, T.daysTop];
  for (let d = 1; d <= 31; d++) ys.push(T.daysTop + d * T.rowH);
  ys.push(T.bottom);
  for (const y of ys) hLine(doc, R.left, R.right, y, y === T.sumTop ? 1 : 0.6);
  for (const x of R.colX) vLine(doc, x, T.top, T.bottom, 0.6);

  // Unterschrift des Arbeitgebers
  const E = R.employer;
  hLine(doc, E.x1, E.x2, E.lineY, 0.6);
  doc.font(R.font).fontSize(E.size).fillColor('#000');
  doc.text('Datum', E.dateX - 30, E.lineY + 3, { width: 60, align: 'center', lineBreak: false });
  doc.text(E.label, E.labelX - 80, E.lineY + 3, { width: 160, align: 'center', lineBreak: false });
  if (roster.employerSignature) {
    doc.fontSize(10).text(roster.employerSignature.dateLabel, E.dateX - 30, E.lineY - 13, { width: 60, align: 'center', lineBreak: false });
    drawImage(doc, roster.employerSignature.image, E.dateX + 40, E.lineY - 36, E.x2 - E.dateX - 42, 35);
  }
}

function drawName(doc, name, x, y, w, h) {
  const pad = 2;
  const one = fitSize(doc, name, ROSTER.font, ROSTER.table.nameSize, w - 2 * pad, 8.5);
  doc.font(ROSTER.font).fontSize(one);
  if (doc.widthOfString(name) <= w - 2 * pad || !name.includes(' ')) {
    cellText(doc, name, x, y, w, h, { font: ROSTER.font, size: ROSTER.table.nameSize });
    return;
  }
  // Vor- und Nachname auf zwei Zeilen
  const cut = name.lastIndexOf(' ');
  const lines = [name.slice(0, cut), name.slice(cut + 1)];
  const size = Math.min(...lines.map((l) => fitSize(doc, l, ROSTER.font, 8, w - 2 * pad, 5)));
  doc.font(ROSTER.font).fontSize(size).fillColor('#000');
  const lh = doc.currentLineHeight() * 0.92;
  lines.forEach((l, i) => {
    doc.text(l, x + pad, y + (h - 2 * lh) / 2 + i * lh + 0.4, { width: w - 2 * pad, align: 'center', lineBreak: false });
  });
}

function drawRosterCell(doc, cell, x, y, w, h) {
  const textW = 27;
  if (cell.duration) {
    cellText(doc, cell.duration, x + 0.5, cell.code ? y - 3.6 : y, textW, h, { font: ROSTER.font, size: 8.5, align: 'left' });
    if (cell.code) cellText(doc, cell.code, x + 0.5, y + 4.2, textW, h, { font: ROSTER.fontBold, size: 6.5, align: 'left' });
  } else if (cell.code) {
    cellText(doc, cell.code, x + 0.5, y, textW, h, { font: ROSTER.fontBold, size: 9, align: 'left' });
  }
  if (cell.signature) {
    drawImage(doc, cell.signature, x + textW, y + 1.2, w - textW - 1.5, h - 2.4, 'right');
  } else if (cell.recordedByEmployer) {
    cellText(doc, 'AG', x + textW, y, w - textW - 2, h, { font: ROSTER.font, size: 6.5, align: 'right', color: '#666' });
  }
}
