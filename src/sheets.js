// Baut die Daten für die beiden Formulare auf, die sowohl im Browser als auch im PDF dargestellt werden.
import {
  daysInMonth, formatClock, formatDateDE, formatDecimalHours, formatDuration, isoDate, monthKey, monthLabel, weekday,
} from './time.js';

const maxDate = (dates) => dates.filter(Boolean).sort().at(-1) ?? null;

function signatureBlock(signature, date) {
  if (!signature || !date) return null;
  return { id: signature.id, image: signature.image, date, dateLabel: formatDateDE(date) };
}

function rowFromEntry(entry, employeeId) {
  return {
    entry,
    start: formatClock(entry.start_time),
    breakTime: entry.start_time == null ? '' : formatDuration(entry.break_minutes),
    end: formatClock(entry.end_time),
    duration: entry.start_time == null ? '' : formatDuration(entry.work_minutes),
    code: entry.code ?? '',
    recordedOn: formatDateDE(entry.recorded_on),
    // Vom Chef erfasste oder korrigierte Zeilen werden markiert.
    recordedByEmployer: entry.recorded_by !== employeeId,
    remarks: entry.remarks,
  };
}

// Stundenzettel eines Mitarbeiters ("Vorlage zur Dokumentation der täglichen Arbeitszeit").
export function buildEmployeeSheet(store, employee, ym) {
  const month = monthKey(ym);
  const settings = store.getSettings();
  const entries = store.listEntries(employee.id, month);
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
  const lastSigned = signed.reduce((a, e) => (!a || e.recorded_on >= a.recorded_on ? e : a), null);
  const employeeSignature = lastSigned
    ? signatureBlock(store.getSignature(lastSigned.signature_id), lastSigned.recorded_on)
    : null;

  // Arbeitgeber-Unterschrift: datiert auf den letzten Eintrag des Monats (inkl. Korrekturen durch den Chef).
  const lastRecorded = maxDate(entries.map((e) => e.recorded_on));
  const employerSignature = lastRecorded
    ? signatureBlock(store.employerSignatureAt(lastRecorded), lastRecorded)
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
    total: formatDuration(totalMinutes),
    totalDecimal: formatDecimalHours(totalMinutes),
    employeeSignature,
    employerSignature,
    locked: store.isLocked(month),
  };
}

// Großes Blatt mit allen Mitarbeitern ("Einsatzliste"). 8 Mitarbeiter pro Seite wie auf dem Papierformular.
export const ROSTER_COLUMNS = 8;

export function buildRoster(store, ym) {
  const month = monthKey(ym);
  const settings = store.getSettings();
  const entries = store.listMonthEntries(month);
  const signatureCache = new Map();
  const signatureImage = (id) => {
    if (!id) return null;
    if (!signatureCache.has(id)) signatureCache.set(id, store.getSignature(id)?.image ?? null);
    return signatureCache.get(id);
  };

  const employees = store.employeesForMonth(month)
    .filter((u) => u.on_roster)
    .map((u) => {
      const own = entries.filter((e) => e.user_id === u.id);
      const days = {};
      for (const e of own) {
        const day = Number(e.work_date.slice(8, 10));
        days[day] = {
          duration: e.start_time == null ? '' : formatDuration(e.work_minutes),
          timeRange: e.start_time == null ? '' : `${formatClock(e.start_time)}–${formatClock(e.end_time)}`,
          code: e.code ?? '',
          signatureId: e.recorded_by === u.id ? e.signature_id : null,
          signature: e.recorded_by === u.id ? signatureImage(e.signature_id) : null,
          recordedByEmployer: e.recorded_by !== u.id,
        };
      }
      const totalMinutes = own.reduce((sum, e) => sum + e.work_minutes, 0);
      return {
        id: u.id,
        name: u.name,
        personnelNo: u.personnel_no,
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

  const rosterIds = new Set(employees.map((e) => e.id));
  const lastRecorded = maxDate(entries.filter((e) => rosterIds.has(e.user_id)).map((e) => e.recorded_on));

  return {
    ym,
    month,
    monthLabel: monthLabel(ym),
    company: settings.company_name,
    title: settings.roster_title,
    daysInMonth: daysInMonth(ym.year, ym.month),
    employees,
    pages,
    employerSignature: lastRecorded ? signatureBlock(store.employerSignatureAt(lastRecorded), lastRecorded) : null,
    locked: store.isLocked(month),
  };
}
