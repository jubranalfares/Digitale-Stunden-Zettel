// DATEV-Importdatei für LODAS: pro Mitarbeiter die Summe der Arbeitsstunden im Monat.
// Aufbau nach der ASCII-Schnittstelle von LODAS: Kopf [Allgemein], [Satzbeschreibung], [Bewegungsdaten].
// Die Nummern (Berater, Mandant, Lohnart, Bearbeitungsschlüssel, Personalnummern) kommen von der Kanzlei.
// Ob die Datei passt, zeigt erst ein Probeimport in LODAS, siehe docs/DATEV.md.
import { formatDecimalHours, monthKey } from './time.js';

export const DATEV_SETTINGS = {
  datev_berater_nr: { label: 'Beraternummer', pattern: /^\d{4,7}$/, rule: '4 bis 7 Ziffern' },
  datev_mandanten_nr: { label: 'Mandantennummer', pattern: /^\d{1,5}$/, rule: '1 bis 5 Ziffern' },
  datev_lohnart: { label: 'Lohnart für Arbeitsstunden', pattern: /^\d{1,4}$/, rule: '1 bis 4 Ziffern' },
  datev_bs_nr: { label: 'Bearbeitungsschlüssel', pattern: /^\d{1,2}$/, rule: '1 oder 2 Ziffern' },
};

// Personalnummer wie in DATEV: 1 bis 99999.
export const PERSONNEL_NO = /^(?!0+$)\d{1,5}$/;

const SATZ_ID = 10;
const TABLE = 'u_lod_bwd_buchung_standard';
const FIELDS = ['pnr#bwd', 'abrechnung_zeitraum#bwd', 'bs_wert_butab#bwd', 'bs_nr#bwd', 'la_eigene#bwd'];

// Alle Angaben der Kanzlei eingetragen?
export const datevReady = (settings) => Object.keys(DATEV_SETTINGS).every((key) => settings[key]);

// Prüft eine Eingabe aus dem Formular. Leer ist erlaubt (dann gibt es keine DATEV-Datei).
export function datevSettingProblem(key, value) {
  const field = DATEV_SETTINGS[key];
  if (!value || field.pattern.test(value)) return null;
  return `${field.label}: bitte nur ${field.rule}.`;
}

// Arbeitsminuten je Mitarbeiter im Monat; nur wer Stunden hat, kommt in die Datei.
export function datevRows(employees, entries) {
  const minutes = new Map();
  for (const e of entries) minutes.set(e.user_id, (minutes.get(e.user_id) ?? 0) + (e.work_minutes || 0));
  return employees
    .map((u) => ({ name: u.name, personnelNo: u.personnel_no, minutes: minutes.get(u.id) ?? 0 }))
    .filter((r) => r.minutes > 0);
}

// Was fehlt noch, bevor die Datei erstellt werden kann? Liefert verständliche Sätze für den Chef.
export function datevProblems(settings, rows) {
  const missing = Object.entries(DATEV_SETTINGS).filter(([key]) => !settings[key]).map(([, f]) => f.label);
  if (missing.length) return [`In den Einstellungen fehlt noch: ${missing.join(', ')}.`];
  if (!rows.length) return ['In diesem Monat sind noch keine Stunden eingetragen.'];

  const problems = [];
  const withoutNo = rows.filter((r) => !PERSONNEL_NO.test(r.personnelNo ?? '')).map((r) => r.name);
  if (withoutNo.length) {
    problems.push(`Personalnummer fehlt bei ${withoutNo.join(', ')}. Bitte unter Mitarbeiter eintragen.`);
  }
  // 101 und 00101 sind für DATEV dieselbe Nummer.
  const byNo = new Map();
  for (const r of rows.filter((x) => PERSONNEL_NO.test(x.personnelNo ?? ''))) {
    const no = Number(r.personnelNo);
    byNo.set(no, [...(byNo.get(no) ?? []), r.name]);
  }
  for (const [no, names] of byNo) {
    if (names.length > 1) problems.push(`Die Personalnummer ${no} ist doppelt vergeben (${names.join(', ')}).`);
  }
  return problems;
}

// Die Datei selbst. Nur Ziffern und Satzzeichen, damit Zeichensatz keine Rolle spielt; Zeilenende CR LF.
export function lodasFile({ settings, ym, rows }) {
  const [year, month] = monthKey(ym).split('-');
  const period = `01.${month}.${year}`;
  const sorted = [...rows].sort((a, b) => Number(a.personnelNo) - Number(b.personnelNo));
  const lines = [
    '[Allgemein]',
    'Ziel=LODAS',
    'Version_SST=1.0',
    `BeraterNr=${settings.datev_berater_nr}`,
    `MandantenNr=${settings.datev_mandanten_nr}`,
    'Datumsformat=TT.MM.JJJJ',
    'Feldtrennzeichen=;',
    'Zahlenkomma=,',
    '',
    '[Satzbeschreibung]',
    `${SATZ_ID};${TABLE};${FIELDS.join(';')};`,
    '',
    '[Bewegungsdaten]',
    ...sorted.map((r) => [
      SATZ_ID, r.personnelNo, period, formatDecimalHours(r.minutes), settings.datev_bs_nr, settings.datev_lohnart,
    ].join(';') + ';'),
  ];
  return `${lines.join('\r\n')}\r\n`;
}
