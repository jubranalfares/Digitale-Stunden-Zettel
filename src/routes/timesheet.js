// Stundenzettel ansehen und Zeiten erfassen – für Mitarbeiter (eigener Zettel) und Chef (alle Zettel).
import express from 'express';
import { requireAdmin, requireEmployee, requireLogin } from '../auth.js';
import { deleteEntry, saveEntry } from '../entries.js';
import { currentMonthOf, sendPdf } from '../http.js';
import { createPdf, drawEmployeeSheet, pdfToBuffer } from '../pdf.js';
import { buildEmployeeSheet } from '../sheets.js';
import {
  InputError, WEEKDAYS_SHORT, daysInMonth, formatClock, formatDateDE, formatDuration, isValidISODate, isoDate, monthKey,
  monthOf, parseMonth, shiftMonth, weekday,
} from '../time.js';

export default function timesheetRoutes({ store, config }) {
  const router = express.Router();

  // Eigener Zettel des Mitarbeiters
  router.get('/zettel', requireLogin, requireEmployee, (req, res) => {
    renderSheet(req, res, req.user, '/zettel');
  });
  router.post('/zettel/eintrag', requireLogin, requireEmployee, (req, res) => {
    handleSave(req, res, req.user, '/zettel');
  });
  router.post('/zettel/loeschen', requireLogin, requireEmployee, (req, res) => {
    handleDelete(req, res, req.user, '/zettel');
  });
  router.get('/zettel/pdf', requireLogin, requireEmployee, async (req, res) => {
    await handlePdf(req, res, req.user);
  });

  // Zettel eines Mitarbeiters aus Sicht des Chefs
  const loadEmployee = (req, res, next) => {
    const employee = store.getUser(Number(req.params.id));
    if (!employee || employee.role !== 'employee') {
      return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Mitarbeiter nicht gefunden.' });
    }
    req.employee = employee;
    next();
  };
  const adminBase = (req) => `/admin/zettel/${req.employee.id}`;
  router.get('/admin/zettel/:id', requireLogin, requireAdmin, loadEmployee, (req, res) => {
    renderSheet(req, res, req.employee, adminBase(req));
  });
  router.post('/admin/zettel/:id/eintrag', requireLogin, requireAdmin, loadEmployee, (req, res) => {
    handleSave(req, res, req.employee, adminBase(req));
  });
  router.post('/admin/zettel/:id/loeschen', requireLogin, requireAdmin, loadEmployee, (req, res) => {
    handleDelete(req, res, req.employee, adminBase(req));
  });
  router.get('/admin/zettel/:id/pdf', requireLogin, requireAdmin, loadEmployee, async (req, res) => {
    await handlePdf(req, res, req.employee);
  });

  // ---------------------------------------------------------------------------

  function renderSheet(req, res, employee, base) {
    const today = req.today;
    const current = currentMonthOf(today);
    let ym = parseMonth(req.query.monat, today);
    if (monthKey(ym) > monthKey(current)) ym = current;
    const sheet = buildEmployeeSheet(store, employee, ym);

    // Vorausgewähltes Datum im Erfassungsformular
    const lastDay = daysInMonth(ym.year, ym.month);
    const requestedDay = Number(req.query.tag);
    let selectedDate = monthKey(ym) === monthOf(today) ? today : isoDate(ym, lastDay);
    if (requestedDay >= 1 && requestedDay <= lastDay) selectedDate = isoDate(ym, requestedDay);
    if (selectedDate > today) selectedDate = today;

    const entriesByDate = Object.fromEntries(sheet.entries.map((e) => [e.work_date, {
      beginn: formatClock(e.start_time),
      ende: formatClock(e.end_time),
      pause: e.start_time == null ? '' : formatDuration(e.break_minutes),
      kuerzel: e.code ?? '',
      bemerkung: e.remarks,
    }]));

    // Mitarbeiter dürfen den laufenden und den Vormonat bearbeiten, der Chef alles.
    const minDate = req.user.role === 'admin' ? '' : `${monthKey(shiftMonth(current, -1))}-01`;

    res.render('sheet', {
      title: req.user.role === 'admin' ? `Stundenzettel ${employee.name}` : 'Mein Stundenzettel',
      sheet,
      employee,
      base,
      ym,
      isCurrentMonth: monthKey(ym) === monthKey(current),
      selectedDate,
      minDate,
      entriesByDate,
      signature: store.getSignature(employee.signature_id),
      employerSignatureSet: !!store.getSettings().employer_signature_id,
      auditRows: req.user.role === 'admin' ? auditRows(employee, sheet.month) : [],
    });
  }

  function auditRows(employee, month) {
    const describe = (e) => {
      if (!e) return '–';
      const time = e.start_time == null ? '' : `${formatClock(e.start_time)}–${formatClock(e.end_time)} (Pause ${formatDuration(e.break_minutes)})`;
      return [time, e.code, e.remarks].filter(Boolean).join(' · ') || '–';
    };
    const actions = { create: 'angelegt', update: 'geändert', delete: 'gelöscht' };
    return store.listAudit(employee.id, month).map((a) => {
      const data = JSON.parse(a.data ?? '{}');
      return {
        when: new Date(`${a.created_at.replace(' ', 'T')}Z`).toLocaleString('de-DE', {
          timeZone: config.timeZone, dateStyle: 'short', timeStyle: 'short',
        }),
        day: `${WEEKDAYS_SHORT[weekday(a.work_date)]}, ${formatDateDE(a.work_date)}`,
        action: actions[a.action] ?? a.action,
        actor: a.actor_id === employee.id ? 'Mitarbeiter' : `${a.actor_name ?? 'Chef'} (AG)`,
        details: a.action === 'update' ? `${describe(data.before)} → ${describe(data.after)}` : describe(data.after ?? data.before),
      };
    });
  }

  function redirectToDay(res, base, date) {
    if (!isValidISODate(date)) return res.redirect(base);
    res.redirect(`${base}?monat=${monthOf(date)}&tag=${Number(date.slice(8))}`);
  }

  function handleSave(req, res, employee, base) {
    const date = String(req.body.datum ?? '');
    try {
      const { warnings, unchanged } = saveEntry(store, {
        actor: req.user, employee, input: req.body, today: req.today,
      });
      const label = `${WEEKDAYS_SHORT[weekday(date)]}, ${formatDateDE(date)}`;
      const signed = req.user.id === employee.id ? ' – automatisch unterschrieben ✓' : '';
      if (unchanged) req.flash('info', `Keine Änderungen für ${label}.`);
      else req.flash(warnings.length ? 'warning' : 'success', `Eintrag für ${label} gespeichert${signed}`, warnings);
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      req.flash('error', err.message);
    }
    redirectToDay(res, base, date);
  }

  function handleDelete(req, res, employee, base) {
    const date = String(req.body.datum ?? '');
    try {
      const deleted = deleteEntry(store, { actor: req.user, employee, date, today: req.today });
      req.flash(deleted ? 'success' : 'info', deleted ? `Eintrag vom ${formatDateDE(date)} gelöscht.` : 'Für diesen Tag gibt es keinen Eintrag.');
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      req.flash('error', err.message);
    }
    redirectToDay(res, base, date);
  }

  async function handlePdf(req, res, employee) {
    const ym = parseMonth(req.query.monat, req.today);
    const sheet = buildEmployeeSheet(store, employee, ym);
    const doc = createPdf(`Stundenzettel ${employee.name} ${sheet.monthLabel}`);
    drawEmployeeSheet(doc, sheet);
    const prefix = employee.personnel_no ? `${employee.personnel_no}_` : '';
    sendPdf(res, await pdfToBuffer(doc), `Stundenzettel_${sheet.month}_${prefix}${employee.name}.pdf`);
  }

  return router;
}
