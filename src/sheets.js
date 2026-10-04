// Baut die Daten für die beiden Formulare auf, die sowohl im Browser als auch im PDF dargestellt werden.
import {
  daysInMonth, formatClock, formatDateDE, formatHours, formatPause, isoDate, monthEndISO, monthKey, monthLabel, weekday,
} from './time.js';

// Unterschriften tragen immer das Datum des letzten Monatstags.
function signatureBlock(signature, date) {
  if (!signature || !date) return null;
  return { id: signature.id, image: signature.image, date, dateLabel: formatDateDE(date) };
}

// Rohwerte eines Tages für das Eingabefenster.
const entryData = (entry) => ({
  start: formatClock(entry.start_time),
  end: formatClock(entry.end_time),
  breakMinutes: entry.start_time != null ? entry.break_minutes || 0 : 0,
  code: entry.code ?? '',
  remarks: entry.remarks ?? '',
});

// Eine Zeile des Stundenzettels.
export function rowFromEntry(entry, employeeId) {
  const timed = entry.start_time != null;
  return {
    entry,
    ...entryData(entry),
    breakTime: timed ? formatPause(entry.break_minutes) : '',
    duration: timed ? formatHours(entry.work_minutes) : '',
    // „aufgezeichnet am“ zeigt den Kalendertag des Eintrags.
    recordedOn: formatDateDE(entry.work_date),
    // Vom Chef erfasste oder korrigierte Zeilen werden markiert.
    recordedByEmployer: entry.recorded_by !== employeeId,
  };
}

// Eine Tageszelle der Einsatzliste: Stunden + Unterschrift.
export function rosterCell(entry, employeeId, signatureImage = null) {
  const timed = entry.start_time != null;
  const ownEntry = entry.recorded_by === employeeId;
  return {
    ...entryData(entry),
    duration: timed ? formatHours(entry.work_minutes) : '',
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
  const monthEnd = monthEndISO(month);

  // Mitarbeiter-Unterschrift: die Unterschrift des zuletzt selbst erfassten Eintrags.
  const signed = entries.filter((e) => e.signature_id && e.recorded_by === employee.id);
  const lastSigned = signed.reduce((a, e) => (!a || e.recorded_on >= a.recorded_on ? e : a), null);
  const employeeSignature = lastSigned
    ? signatureBlock(await store.getSignature(lastSigned.signature_id), monthEnd)
    : null;

  // Arbeitgeber-Unterschrift: sobald der Monat Einträge hat.
  const employerSignature = entries.length
    ? signatureBlock(await store.employerSignatureAt(monthEnd), monthEnd)
    : null;

  return {
    ym,
    month,
    monthLabel: monthLabel(ym),
    company: settings.company_name,
    logo: settings.logo,
    employee: { id: employee.id, name: employee.name, personnelNo: employee.personnel_no },
    rows,
    entries,
    totalMinutes,
    total: formatHours(totalMinutes),
    employeeSignature,
    employerSignature,
  };
}

// Großes Blatt mit allen Mitarbeitern ("Einsatzliste"). 8 Mitarbeiter pro Seite wie auf dem Papierformular.
export const ROSTER_COLUMNS = 8;

async function rosterEmployees(store, month) {
  return (await store.employeesForMonth(month)).filter((u) => u.on_roster);
}

// Unterschrift des Arbeitgebers unten auf der Einsatzliste, sobald jemand im Monat eingetragen ist.
export async function rosterEmployerSignature(store, month, entries, users) {
  const ids = new Set((users ?? await rosterEmployees(store, month)).map((u) => u.id));
  const all = entries ?? await store.listMonthEntries(month);
  if (!all.some((e) => ids.has(e.user_id))) return null;
  const monthEnd = monthEndISO(month);
  return signatureBlock(await store.employerSignatureAt(monthEnd), monthEnd);
}

export async function buildRoster(store, ym) {
  const month = monthKey(ym);
  const settings = await store.getSettings();
  const entries = await store.listMonthEntries(month);
  const users = await rosterEmployees(store, month);

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
      total: own.length ? formatHours(totalMinutes) : '',
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
