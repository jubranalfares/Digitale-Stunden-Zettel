// Gemeinsame Logik für das Erfassungsfenster (Stundenzettel und Einsatzliste).
import { deleteEntry, earliestEditableDate, saveEntry } from '../entries.js';
import {
  InputError, WEEKDAYS_SHORT, formatClock, formatDateDE, formatDuration, isValidISODate, monthOf, weekday,
} from '../time.js';

const dayLabel = (iso) => (isValidISODate(iso) ? `${WEEKDAYS_SHORT[weekday(iso)]}, ${formatDateDE(iso)}` : '');

// Nur Pfade innerhalb der App als Rücksprungziel zulassen.
export function safeReturnTo(value, fallback) {
  const s = String(value ?? '');
  return s.startsWith('/') && !s.startsWith('//') && !/[\\\x00-\x1f]/.test(s) ? s : fallback;
}

function entryForm(e) {
  return {
    beginn: formatClock(e.start_time),
    ende: formatClock(e.end_time),
    pause: e.start_time == null ? '0:00' : formatDuration(e.break_minutes),
    kuerzel: e.code ?? '',
    bemerkung: e.remarks,
  };
}

// Daten, die das Erfassungsfenster im Browser braucht.
export async function dialogData(store, { viewer, today, month, employees, entries, locked }) {
  const since = new Date(Date.parse(`${today}T00:00:00Z`) - 60 * 86400000).toISOString().slice(0, 10);
  const recent = await store.recentShifts(since);
  const isAdmin = viewer.role === 'admin';
  return {
    today,
    month,
    locked,
    minDate: earliestEditableDate(viewer, today),
    employees: Object.fromEntries(employees.map((u) => [u.id, {
      name: u.name,
      save: isAdmin ? `/admin/zettel/${u.id}/eintrag` : '/zettel/eintrag',
      remove: isAdmin ? `/admin/zettel/${u.id}/loeschen` : '/zettel/loeschen',
      needsSignature: !isAdmin && !u.signature_id,
      entries: Object.fromEntries(entries.filter((e) => e.user_id === u.id).map((e) => [e.work_date, entryForm(e)])),
      recent: (recent[u.id] ?? []).map((r) => ({
        beginn: formatClock(r.start_time), ende: formatClock(r.end_time), pause: formatDuration(r.break_minutes),
      })),
    }])),
  };
}

export async function handleSave(store, req, res, employee, fallback) {
  const date = String(req.body.datum ?? '');
  const back = safeReturnTo(req.body.zurueck, fallback);
  try {
    const { entry, warnings, unchanged } = await saveEntry(store, {
      actor: req.user, employee, input: req.body, today: req.today,
    });
    if (unchanged) {
      await req.flash('info', `Keine Änderungen für ${dayLabel(date)}.`);
    } else {
      const total = await store.monthTotalMinutes(employee.id, monthOf(date));
      const what = entry.start_time == null
        ? entry.code
        : `${formatClock(entry.start_time)}–${formatClock(entry.end_time)} = ${formatDuration(entry.work_minutes)} Std.`;
      const who = req.user.id === employee.id ? '' : `${employee.name}: `;
      const signed = req.user.id === employee.id ? ' – unterschrieben ✓' : '';
      await req.flash(
        warnings.length ? 'warning' : 'success',
        `${who}${dayLabel(date)} gespeichert: ${what}${signed}. Monatssumme jetzt ${formatDuration(total)} Std.`,
        warnings,
      );
    }
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    await req.flash('error', `${dayLabel(date) || 'Eintrag'}: ${err.message}`);
  }
  res.redirect(back);
}

export async function handleDelete(store, req, res, employee, fallback) {
  const date = String(req.body.datum ?? '');
  const back = safeReturnTo(req.body.zurueck, fallback);
  try {
    const deleted = await deleteEntry(store, { actor: req.user, employee, date, today: req.today });
    if (deleted) {
      const total = await store.monthTotalMinutes(employee.id, monthOf(date));
      await req.flash('success', `Eintrag vom ${formatDateDE(date)} gelöscht. Monatssumme jetzt ${formatDuration(total)} Std.`);
    } else {
      await req.flash('info', 'Für diesen Tag gibt es keinen Eintrag.');
    }
  } catch (err) {
    if (!(err instanceof InputError)) throw err;
    await req.flash('error', err.message);
  }
  res.redirect(back);
}
