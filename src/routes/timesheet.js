// Stundenzettel ansehen und Zeiten erfassen – für Mitarbeiter (eigener Zettel) und Chef (alle Zettel).
import express from 'express';
import { requireAdmin, requireEmployee, requireLogin } from '../auth.js';
import { currentMonthOf, sendPdf } from '../http.js';
import { createPdf, drawEmployeeSheet, pdfToBuffer } from '../pdf.js';
import { buildEmployeeSheet } from '../sheets.js';
import {
  WEEKDAYS_SHORT, formatClock, formatDateDE, formatDuration, isoDate, monthKey, monthOf, parseMonth, weekday,
} from '../time.js';
import { dialogData, handleDelete, handleSave } from './entry-actions.js';

export default function timesheetRoutes({ store, config }) {
  const router = express.Router();

  const sheetUrl = (base, date) => `${base}?monat=${monthOf(date)}`;

  // Eigener Zettel des Mitarbeiters
  router.get('/zettel', requireLogin, requireEmployee, async (req, res) => {
    await renderSheet(req, res, req.user, '/zettel');
  });
  router.post('/zettel/eintrag', requireLogin, requireEmployee, async (req, res) => {
    await handleSave(store, req, res, req.user, sheetUrl('/zettel', String(req.body.datum ?? req.today)));
  });
  router.post('/zettel/loeschen', requireLogin, requireEmployee, async (req, res) => {
    await handleDelete(store, req, res, req.user, sheetUrl('/zettel', String(req.body.datum ?? req.today)));
  });
  router.get('/zettel/pdf', requireLogin, requireEmployee, async (req, res) => {
    await handlePdf(req, res, req.user);
  });

  // Zettel eines Mitarbeiters aus Sicht des Chefs
  const loadEmployee = async (req, res, next) => {
    const employee = await store.getUser(Number(req.params.id));
    if (!employee || employee.role !== 'employee') {
      return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Mitarbeiter nicht gefunden.' });
    }
    req.employee = employee;
    next();
  };
  const adminBase = (req) => `/admin/zettel/${req.employee.id}`;
  router.get('/admin/zettel/:id', requireLogin, requireAdmin, loadEmployee, async (req, res) => {
    await renderSheet(req, res, req.employee, adminBase(req));
  });
  router.post('/admin/zettel/:id/eintrag', requireLogin, requireAdmin, loadEmployee, async (req, res) => {
    await handleSave(store, req, res, req.employee, sheetUrl(adminBase(req), String(req.body.datum ?? req.today)));
  });
  router.post('/admin/zettel/:id/loeschen', requireLogin, requireAdmin, loadEmployee, async (req, res) => {
    await handleDelete(store, req, res, req.employee, sheetUrl(adminBase(req), String(req.body.datum ?? req.today)));
  });
  router.get('/admin/zettel/:id/pdf', requireLogin, requireAdmin, loadEmployee, async (req, res) => {
    await handlePdf(req, res, req.employee);
  });

  // ---------------------------------------------------------------------------

  async function renderSheet(req, res, employee, base) {
    const today = req.today;
    const current = currentMonthOf(today);
    let ym = parseMonth(req.query.monat, today);
    if (monthKey(ym) > monthKey(current)) ym = current;
    const sheet = await buildEmployeeSheet(store, employee, ym);
    const isCurrentMonth = monthKey(ym) === monthKey(current);

    res.render('sheet', {
      title: req.user.role === 'admin' ? `Stundenzettel ${employee.name}` : 'Mein Stundenzettel',
      sheet,
      employee,
      base,
      ym,
      isCurrentMonth,
      // „Heute erfassen“ bzw. in früheren Monaten der letzte Tag des Monats
      quickDate: isCurrentMonth ? today : isoDate(ym, sheet.rows.filter((r) => r.exists).length),
      returnTo: `${base}?monat=${sheet.month}`,
      dialog: await dialogData(store, {
        viewer: req.user, today, month: sheet.month, employees: [employee], entries: sheet.entries, locked: sheet.locked,
      }),
      signature: await store.getSignature(employee.signature_id),
      employerSignatureSet: !!res.locals.settings.employer_signature_id,
      auditRows: req.user.role === 'admin' ? await auditRows(employee, sheet.month) : [],
    });
  }

  async function auditRows(employee, month) {
    const describe = (e) => {
      if (!e) return '–';
      const time = e.start_time == null ? '' : `${formatClock(e.start_time)}–${formatClock(e.end_time)} (Pause ${formatDuration(e.break_minutes)})`;
      return [time, e.code, e.remarks].filter(Boolean).join(' · ') || '–';
    };
    const actions = { create: 'angelegt', update: 'geändert', delete: 'gelöscht' };
    return (await store.listAudit(employee.id, month)).map((a) => {
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

  async function handlePdf(req, res, employee) {
    const sheet = await buildEmployeeSheet(store, employee, parseMonth(req.query.monat, req.today));
    const doc = createPdf(`Stundenzettel ${employee.name} ${sheet.monthLabel}`);
    drawEmployeeSheet(doc, sheet);
    const prefix = employee.personnel_no ? `${employee.personnel_no}_` : '';
    sendPdf(res, await pdfToBuffer(doc), `Stundenzettel_${sheet.month}_${prefix}${employee.name}.pdf`);
  }

  return router;
}
