// Zeit- und Datumsfunktionen. Uhrzeiten werden intern als Minuten seit Mitternacht geführt.

export const CODES = {
  K: 'Krank',
  U: 'Urlaub',
  UU: 'unbezahlter Urlaub',
  F: 'Feiertag',
  SA: 'Stundenweise abwesend',
  SU: 'Stundenweise Urlaub',
};

export const MONTH_NAMES = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

export const WEEKDAYS_SHORT = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

// Fehler mit einer Meldung, die direkt dem Benutzer angezeigt werden darf.
export class InputError extends Error {}

const pad = (n) => String(n).padStart(2, '0');

// Uhrzeit wie auf Papier: "12", "9", "930", "1230", "12:30", "12.30"
export function parseClock(value, label = 'Uhrzeit') {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:.,]?(\d{2}))?$/.exec(s);
  if (!m) throw new InputError(`${label} „${s}“ ist ungültig (Format HH:MM).`);
  const h = Number(m[1]);
  const min = Number(m[2] ?? 0);
  if (h > 23 || min > 59) throw new InputError(`${label} „${s}“ ist ungültig.`);
  return h * 60 + min;
}

// Pause: "0:30", "30" oder "45" (Minuten), "1" (Stunden), "130" (1:30), "0,5" (Stunden).
export function parseDuration(value) {
  const s = String(value ?? '').trim();
  if (!s) return 0;
  let m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  if (/^\d$/.test(s)) return Number(s) * 60;
  if (/^\d{2}$/.test(s)) return Number(s);
  m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2})[,.](\d{1,2})$/.exec(s);
  if (m) return Math.round(Number(`${m[1]}.${m[2]}`) * 60);
  throw new InputError(`Pause „${s}“ ist ungültig (z. B. 0:30).`);
}

export function formatClock(minutes) {
  if (minutes == null) return '';
  return `${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`;
}

export function formatDuration(minutes) {
  if (minutes == null) return '';
  const sign = minutes < 0 ? '-' : '';
  const abs = Math.abs(minutes);
  return `${sign}${Math.floor(abs / 60)}:${pad(abs % 60)}`;
}

export function formatDecimalHours(minutes) {
  return (minutes / 60).toFixed(2).replace('.', ',');
}

// Arbeitszeit = Ende − Beginn − Pause. Ende vor Beginn bedeutet Schicht über Mitternacht.
export function computeWorkMinutes(start, end, breakMinutes) {
  let gross = end - start;
  if (gross === 0) throw new InputError('Beginn und Ende dürfen nicht gleich sein.');
  if (gross < 0) gross += 24 * 60;
  const net = gross - breakMinutes;
  if (net <= 0) throw new InputError('Die Pause ist länger als die Anwesenheitszeit.');
  return net;
}

// ---- Datum ------------------------------------------------------------------

export function todayISO(timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());
}

export function isValidISODate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s ?? ''));
  if (!m) return false;
  const [y, mo, d] = m.slice(1).map(Number);
  return mo >= 1 && mo <= 12 && d >= 1 && d <= daysInMonth(y, mo);
}

export function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function weekday(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function formatDateDE(iso) {
  if (!iso) return '';
  const [y, m, d] = iso.split('-');
  return `${d}.${m}.${y}`;
}

// ---- Monat ("YYYY-MM") ------------------------------------------------------

export function parseMonth(value, fallbackISO) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(value ?? ''));
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) {
    return { year: Number(m[1]), month: Number(m[2]) };
  }
  const [y, mo] = fallbackISO.split('-').map(Number);
  return { year: y, month: mo };
}

export function monthKey({ year, month }) {
  return `${year}-${pad(month)}`;
}

export function monthOf(iso) {
  return iso.slice(0, 7);
}

export function shiftMonth({ year, month }, delta) {
  const idx = year * 12 + (month - 1) + delta;
  return { year: Math.floor(idx / 12), month: (idx % 12) + 1 };
}

export function monthLabel({ year, month }) {
  return `${MONTH_NAMES[month - 1]} ${year}`;
}

export function isoDate({ year, month }, day) {
  return `${year}-${pad(month)}-${pad(day)}`;
}
