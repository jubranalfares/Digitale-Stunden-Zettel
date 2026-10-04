// Baut die Daten für die beiden Formulare auf, die sowohl im Browser als auch im PDF dargestellt werden.
import {
  daysInMonth, formatClock, formatDateDE, formatDecimalHours, formatDuration, isoDate, monthKey, monthLabel, weekday,
} from './time.js';

const lastEntry = (entries) => entries.reduce((a, e) => !a ||
  `${e.recorded_on}|${e.updated_at}|${e.work_date}|${String(e.id).padStart(12, '0')}` >
  `${a.recorded_on}|${a.updated_at}|${a.work_date}|${String(a.id).padStart(12, '0')}` ? e : a, null);

function signatureBlock(signature, date) {
  if (!signature || !date) return null;
  return { id: signature.id, image: signature.image, date, dateLabel: formatDateDE(date) };
}

// Ein Monats-Snapshot benötigt nur vier Datenbankabfragen. Die PDF-Erzeugung
// findet danach außerhalb der Turso-Transaktion statt, auch bei vielen Mitarbeitern.
export async function loadMonthSnapshot(store, month) {
  return store.atomic(async (tx) => {
    const settings = await tx.getSettings();
    const entries = await tx.listMonthEntries(month);
    const employees = await tx.employeesForMonth(month);
    const images = await tx.getSignatureImages(entries.flatMap((e) => [e.signature_id, e.employer_signature_id]));
    return {
      getSettings: () => settings,
      listEntries: (id) => entries.filter((e) => e.user_id === id),
      listMonthEntries: () => entries,
      employeesForMonth: () => employees,
      getSignatureImages: () => images,
      getSignature: (id) => images.has(Number(id)) ? { id: Number(id), image: images.get(Number(id)) } : null,
    };
  }, 'read');
}

// Eine Zeile des Stundenzettels.
export function rowFromEntry(entry, employeeId) {
  const timed = entry.start_time != null;
  return {
    entry,
    start: formatClock(entry.start_time),
    breakTime: timed && entry.break_minutes ? formatDuration(entry.break_minutes) : '',
    end: formatClock(entry.end_time),
    duration: timed ? formatDuration(entry.work_minutes) : '',
    code: entry.code ?? '',
    recordedOn: formatDateDE(entry.recorded_on),
    // Vom Chef erfasste oder korrigierte Zeilen werden markiert.
    recordedByEmployer: entry.recorded_by !== employeeId,
    remarks: entry.remarks,
  };
}

// Eine Tageszelle der Einsatzliste: Stunden + Unterschrift; "raw" ist der Text zum Bearbeiten ("12:00-16:00").
export function rosterCell(entry, employeeId, signatureImage = null) {
  const timed = entry.start_time != null;
  const ownEntry = entry.recorded_by === employeeId;
  return {
    duration: timed ? formatDuration(entry.work_minutes) : '',
    raw: timed ? `${formatClock(entry.start_time)}-${formatClock(entry.end_time)}` : (entry.code ?? ''),
    code: entry.code ?? '',
    signatureId: ownEntry ? entry.signature_id : null,
    signature: ownEntry ? signatureImage : null,
    recordedByEmployer: !ownEntry,
  };
}

// Stundenzettel eines Mitarbeiters ("Vorlage zur Dokumentation der täglichen Arbeitszeit").
export async function buildEmployeeSheet(store, employee, ym) {
  const month = monthKey(ym);
  const settings = await store.getSettings();
  const entries = await store.listEntries(employee.id, month);
  const byDate = new Map(entries.map((e) => [e.work_date, e]));

  const rows = [];
  for (let day = 1; day <= 31; day++) {
    const exists = day <= daysInMonth(ym.year, ym.month);
    const date = exists ? isoDate(ym, day) : null;
    const entry = date ? byDate.get(date) : null;
    rows.push({
      day,
      date,
      exists,
      weekday: date ? weekday(date) : null,
      ...(entry ? rowFromEntry(entry, employee.id) : {}),
    });
  }

  const totalMinutes = entries.reduce((sum, e) => sum + e.work_minutes, 0);

  // Mitarbeiter-Unterschrift: die Unterschrift des zuletzt selbst erfassten Eintrags, datiert auf diesen Tag.
  const signed = entries.filter((e) => e.signature_id && e.recorded_by === employee.id);
  const lastSigned = lastEntry(signed);
  const employeeSignature = lastSigned
    ? signatureBlock(await store.getSignature(lastSigned.signature_id), lastSigned.recorded_on)
    : null;

  // Arbeitgeber-Unterschrift: datiert auf den letzten Eintrag des Monats (inkl. Korrekturen durch den Chef).
  const lastRecorded = lastEntry(entries);
  const employerSignature = lastRecorded
    ? signatureBlock(await store.getSignature(lastRecorded.employer_signature_id), lastRecorded.recorded_on)
    : null;

  return {
    ym,
    month,
    monthLabel: monthLabel(ym),
    company: settings.company_name,
    logo: settings.logo,
    employee: { id: employee.id, name: employee.name, personnelNo: '' },
    rows,
    entries,
    totalMinutes,
    total: formatDuration(totalMinutes),
    totalDecimal: formatDecimalHours(totalMinutes),
    employeeSignature,
    employerSignature,
  };
}

// Großes Blatt mit allen Mitarbeitern ("Einsatzliste"). 8 Mitarbeiter pro Seite wie auf dem Papierformular.
export const ROSTER_COLUMNS = 8;

async function rosterEmployees(store, month) {
  return store.employeesForMonth(month);
}

// Unterschrift des Arbeitgebers unten auf der Einsatzliste: datiert auf den letzten Eintrag aller Mitarbeiter.
export async function rosterEmployerSignature(store, month, entries, users) {
  const ids = new Set((users ?? await rosterEmployees(store, month)).map((u) => u.id));
  const all = entries ?? await store.listMonthEntries(month);
  const lastRecorded = lastEntry(all.filter((e) => ids.has(e.user_id)));
  return lastRecorded ? signatureBlock(await store.getSignature(lastRecorded.employer_signature_id), lastRecorded.recorded_on) : null;
}

export async function buildRoster(store, ym, { onlyWithEntries = false } = {}) {
  const month = monthKey(ym);
  const settings = await store.getSettings();
  const entries = await store.listMonthEntries(month);
  const users = (await rosterEmployees(store, month)).filter((u) => !onlyWithEntries || u.entry_count > 0);

  // Alle benötigten Unterschriften auf einmal laden
  const images = await store.getSignatureImages(entries.map((e) => e.signature_id));

  const employees = users.map((u) => {
    const own = entries.filter((e) => e.user_id === u.id);
    const days = {};
    for (const e of own) days[Number(e.work_date.slice(8, 10))] = rosterCell(e, u.id, images.get(e.signature_id) ?? null);
    const totalMinutes = own.reduce((sum, e) => sum + e.work_minutes, 0);
    return {
      id: u.id,
      name: u.name,
      signature_id: u.signature_id,
      days,
      totalMinutes,
      total: own.length ? formatDuration(totalMinutes) : '',
    };
  });

  const pages = [];
  for (let i = 0; i < Math.max(employees.length, 1); i += ROSTER_COLUMNS) {
    const columns = employees.slice(i, i + ROSTER_COLUMNS);
    while (columns.length < ROSTER_COLUMNS) columns.push(null);
    pages.push(columns);
  }

  return {
    ym,
    month,
    monthLabel: monthLabel(ym),
    company: settings.company_name,
    title: settings.roster_title,
    daysInMonth: daysInMonth(ym.year, ym.month),
    employees,
    pages,
    employerSignature: await rosterEmployerSignature(store, month, entries, users),
  };
}
