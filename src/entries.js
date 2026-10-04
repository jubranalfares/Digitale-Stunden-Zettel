// Speichern von Tageseinträgen inkl. Berechtigung und automatischer Unterschrift.
import {
  CODES, InputError, computeWorkMinutes, formatClock, formatDuration, isValidISODate, monthKey, parseClock,
  parseDuration, shiftMonth,
} from './time.js';

// Frühestes Datum, das ein Mitarbeiter noch bearbeiten darf (Anfang des Vormonats). Der Chef darf alles.
export function earliestEditableDate(actor, today) {
  if (actor.role === 'admin') return '';
  const [y, m] = today.split('-').map(Number);
  return `${monthKey(shiftMonth({ year: y, month: m }, -1))}-01`;
}

export function canEdit(actor, date, today) {
  return isValidISODate(date) && date <= today && date >= earliestEditableDate(actor, today);
}

const sameEntry = (a, b) => ['start_time', 'end_time', 'break_minutes', 'code', 'remarks', 'recorded_by', 'signature_id']
  .every((k) => (a[k] ?? null) === (b[k] ?? null));

// Speichert einen Tag. Felder, die nicht mitgeschickt werden, behalten ihren bisherigen Wert
// (z. B. bleibt die Pause erhalten, wenn auf der Einsatzliste nur "12-16" eingetragen wird).
// Sind alle Felder leer, wird der Tag gelöscht.
export async function saveEntry(store, { actor, employee, input, today }) {
  const date = String(input.datum ?? '').trim();
  if (!isValidISODate(date)) throw new InputError('Ungültiges Datum.');
  if (date > today) throw new InputError('Dieser Tag liegt in der Zukunft.');
  if (!canEdit(actor, date, today)) throw new InputError('Ältere Monate kann nur der Chef ändern.');

  const previous = await store.getEntry(employee.id, date);
  const field = (key, fallback) => (input[key] === undefined ? fallback : String(input[key]));

  const code = field('kuerzel', previous?.code ?? '').trim().toUpperCase();
  if (code && !CODES[code]) throw new InputError('Unbekanntes Kürzel.');
  const remarks = field('bemerkung', previous?.remarks ?? '').trim().slice(0, 200);
  const start = parseClock(field('beginn', formatClock(previous?.start_time)), 'Beginn');
  const end = parseClock(field('ende', formatClock(previous?.end_time)), 'Ende');
  let breakMinutes = parseDuration(field('pause', previous?.break_minutes ? formatDuration(previous.break_minutes) : ''));

  if (start == null && end == null && !code && !remarks) {
    if (previous) await store.deleteEntry(employee.id, date);
    return { deleted: !!previous };
  }
  if ((start == null) !== (end == null)) throw new InputError(start == null ? 'Beginn fehlt.' : 'Ende fehlt.');

  const selfService = actor.id === employee.id;
  if (selfService && !employee.signature_id) {
    throw new InputError('Bitte unterschreiben Sie zuerst unter „Einstellungen“. Danach wird Ihre Unterschrift automatisch gesetzt.');
  }

  let workMinutes = 0;
  if (start != null) workMinutes = computeWorkMinutes(start, end, breakMinutes);
  else breakMinutes = 0;

  const entry = {
    user_id: employee.id,
    work_date: date,
    start_time: start,
    end_time: end,
    break_minutes: breakMinutes,
    work_minutes: workMinutes,
    code: code || null,
    remarks,
    recorded_on: today,
    recorded_by: actor.id,
    // Die hinterlegte Unterschrift wird nur gesetzt, wenn der Mitarbeiter selbst einträgt.
    signature_id: selfService ? employee.signature_id : null,
  };
  if (!previous || !sameEntry(previous, entry)) await store.saveEntry(entry);
  return { entry };
}
