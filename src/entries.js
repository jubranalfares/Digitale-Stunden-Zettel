// Speichern und Löschen von Tageseinträgen inkl. Berechtigungsprüfung und automatischer Unterschrift.
import {
  CODES, InputError, computeWorkMinutes, daysBetween, isValidISODate, monthKey, monthOf, parseClock, parseDuration,
  shiftMonth, workTimeWarnings,
} from './time.js';

// Frühestes Datum, das ein Mitarbeiter noch bearbeiten darf (Anfang des Vormonats). Der Chef darf alles.
export function earliestEditableDate(actor, today) {
  if (actor.role === 'admin') return '';
  const [y, m] = today.split('-').map(Number);
  return `${monthKey(shiftMonth({ year: y, month: m }, -1))}-01`;
}

// Gibt zurück, warum ein Tag nicht (mehr) bearbeitet werden darf – oder null.
export async function editBlockReason(store, actor, date, today) {
  if (!isValidISODate(date)) return 'Ungültiges Datum.';
  if (date > today) return 'Arbeitszeiten können erst am Arbeitstag selbst oder danach eingetragen werden.';
  if (await store.isLocked(monthOf(date))) return 'Dieser Monat ist abgeschlossen. Änderungen sind nur nach Freigabe durch den Chef möglich.';
  if (date < earliestEditableDate(actor, today)) return 'Einträge älterer Monate kann nur der Chef ändern.';
  return null;
}

const sameEntry = (a, b) => ['start_time', 'end_time', 'break_minutes', 'code', 'remarks']
  .every((k) => (a[k] ?? null) === (b[k] ?? null));

export async function saveEntry(store, { actor, employee, input, today }) {
  const date = String(input.datum ?? '').trim();
  const blocked = await editBlockReason(store, actor, date, today);
  if (blocked) throw new InputError(blocked);

  const selfService = actor.id === employee.id;
  if (selfService && !employee.signature_id) {
    throw new InputError('Bitte hinterlegen Sie zuerst Ihre Unterschrift unter „Einstellungen“. Sie wird dann automatisch eingesetzt.');
  }

  const code = String(input.kuerzel ?? '').trim().toUpperCase();
  if (code && !CODES[code]) throw new InputError('Unbekanntes Kürzel.');
  const remarks = String(input.bemerkung ?? '').trim().slice(0, 200);
  const start = parseClock(input.beginn, 'Beginn');
  const end = parseClock(input.ende, 'Ende');
  let breakMinutes = parseDuration(input.pause);

  if ((start == null) !== (end == null)) throw new InputError('Bitte Beginn und Ende angeben.');
  if (start == null && !code) throw new InputError('Bitte Arbeitszeit (von–bis) oder ein Kürzel eintragen.');

  let workMinutes = 0;
  if (start != null) {
    workMinutes = computeWorkMinutes(start, end, breakMinutes);
  } else {
    breakMinutes = 0;
  }

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

  const previous = await store.getEntry(employee.id, date);
  const unchanged = previous && sameEntry(previous, entry)
    && previous.recorded_by === entry.recorded_by && previous.signature_id === entry.signature_id;

  if (!unchanged) {
    await store.saveEntry(entry, {
      actorId: actor.id, action: previous ? 'update' : 'create', data: { before: previous ?? null, after: entry },
    });
  }

  const warnings = start != null ? workTimeWarnings(workMinutes, breakMinutes) : [];
  if (daysBetween(date, today) > 7) {
    warnings.push('Hinweis: Arbeitszeiten sollen spätestens 7 Tage nach dem Arbeitstag aufgezeichnet werden (§ 17 MiLoG).');
  }
  return { entry, warnings, unchanged };
}

export async function deleteEntry(store, { actor, employee, date, today }) {
  const blocked = await editBlockReason(store, actor, date, today);
  if (blocked) throw new InputError(blocked);
  const previous = await store.getEntry(employee.id, date);
  if (!previous) return false;
  await store.deleteEntry(employee.id, date, { actorId: actor.id, data: { before: previous } });
  return true;
}
