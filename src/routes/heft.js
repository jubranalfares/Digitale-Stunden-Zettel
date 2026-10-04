// Das digitale Heft: Einsatzliste und Stundenzettel, direkt im Formular ausfüllen.
// Jede Änderung wird sofort gespeichert; Dauer, Summen und Unterschriften rechnet das System.
import express from 'express';
import { requireAdmin, requireLogin } from '../auth.js';
import { canEdit, earliestEditableDate, saveEntry } from '../entries.js';
import { currentMonthOf, sendPdf } from '../http.js';
import { createPdf, drawEmployeeSheet, drawRoster, pdfToBuffer } from '../pdf.js';
import { buildEmployeeSheet, buildRoster, loadMonthSnapshot, rosterCell, rosterEmployerSignature } from '../sheets.js';
import { InputError, isValidISODate, monthKey, monthLabel, monthOf, parseMonth } from '../time.js';

export default function heftRoutes({ store }) {
  const router = express.Router();

  const monthFrom = (req) => {
    const current = currentMonthOf(req.today);
    const ym = parseMonth(req.query.monat, req.today);
    return monthKey(ym) > monthKey(current) ? current : ym;
  };

  // Register des Hefts: Mitarbeiter sehen ihren Zettel und die Einsatzliste, der Chef alle Zettel.
  async function tabs(req, month) {
    if (req.user.role !== 'admin') {
      return [
        { key: 'zettel', label: 'Mein Stundenzettel', href: `/zettel?monat=${month}` },
        { key: 'einsatzliste', label: 'Einsatzliste', href: `/einsatzliste?monat=${month}` },
      ];
    }
    const employees = await store.employeesForMonth(month);
    return [
      { key: 'einsatzliste', label: 'Einsatzliste', href: `/einsatzliste?monat=${month}` },
      ...employees.map((u) => ({ key: `zettel-${u.id}`, label: u.name, href: `/zettel/${u.id}?monat=${month}` })),
    ];
  }

  async function render(req, res, { ym, tab, navBase, ...rest }) {
    const isAdmin = req.user.role === 'admin';
    res.render('heft', {
      ym,
      tab,
      navBase,
      isAdmin,
      isCurrentMonth: monthKey(ym) === monthKey(currentMonthOf(req.today)),
      tabs: await tabs(req, monthKey(ym)),
      minDate: earliestEditableDate(req.user, req.today),
      editable: (date) => !!date && canEdit(req.user, date, req.today),
      employerSignatureMissing: isAdmin && !res.locals.settings.employer_signature_id,
      ...rest,
    });
  }

  async function renderSheet(req, res, employee, navBase, tab) {
    const ym = monthFrom(req);
    await render(req, res, {
      title: `Stundenzettel ${employee.name}`,
      kind: 'sheet',
      ym,
      tab,
      navBase,
      sheet: await buildEmployeeSheet(store, employee, ym),
      signatureMissing: req.user.id === employee.id && !employee.signature_id,
    });
  }

  router.get('/zettel', requireLogin, async (req, res) => {
    if (req.user.role === 'admin') return res.redirect('/einsatzliste');
    await renderSheet(req, res, req.user, '/zettel', 'zettel');
  });

  router.get('/zettel/:id', requireLogin, requireAdmin, async (req, res) => {
    const employee = await store.getUser(Number(req.params.id));
    if (!employee || employee.role !== 'employee') {
      return res.status(404).render('error', { title: 'Nicht gefunden', message: 'Mitarbeiter nicht gefunden.' });
    }
    await renderSheet(req, res, employee, `/zettel/${employee.id}`, `zettel-${employee.id}`);
  });

  router.get('/einsatzliste', requireLogin, async (req, res) => {
    const ym = monthFrom(req);
    const isAdmin = req.user.role === 'admin';
    await render(req, res, {
      title: 'Einsatzliste',
      kind: 'roster',
      ym,
      tab: 'einsatzliste',
      navBase: '/einsatzliste',
      roster: await buildRoster(store, ym),
      canEditColumn: (emp) => !!emp && (isAdmin || emp.id === req.user.id),
      signatureMissing: !isAdmin && !req.user.signature_id,
    });
  });

  // Ein Tag wurde im Heft geändert: speichern und die neu berechneten Werte zurückgeben.
  router.post('/eintrag', requireLogin, async (req, res) => {
    const employee = await store.getUser(Number(req.body.user));
    if (!employee || employee.role !== 'employee') return res.status(404).json({ error: 'Mitarbeiter nicht gefunden.' });
    if (req.user.role !== 'admin' && employee.id !== req.user.id) return res.status(403).json({ error: 'Keine Berechtigung.' });

    const date = String(req.body.datum ?? '');
    try {
      await saveEntry(store, { actor: req.user, employee, input: req.body, today: req.today });
    } catch (err) {
      if (!(err instanceof InputError)) throw err;
      return res.status(400).json({ error: err.message });
    }

    const sheet = await buildEmployeeSheet(store, employee, parseMonth(monthOf(date), req.today));
    const row = sheet.rows.find((r) => r.date === date && isValidISODate(date));
    const cell = row?.entry ? rosterCell(row.entry, employee.id) : null;
    const sig = (s) => (s ? { id: s.id, date: s.dateLabel } : null);
    res.json({
      row: {
        beginn: row?.start ?? '',
        pause: row?.breakTime ?? '',
        ende: row?.end ?? '',
        kuerzel: row?.code ?? '',
        bemerkung: row?.remarks ?? '',
        dauer: row?.duration ?? '',
        aufgezeichnet: row?.recordedOn ?? '',
        ag: !!row?.recordedByEmployer,
      },
      cell: cell && {
        duration: cell.duration, raw: cell.raw, code: cell.code, signatureId: cell.signatureId, ag: cell.recordedByEmployer,
      },
      total: sheet.entries.length ? sheet.total : '',
      employeeSignature: sig(sheet.employeeSignature),
      employerSignature: sig(sheet.employerSignature),
      rosterEmployerSignature: sig(await rosterEmployerSignature(store, sheet.month)),
    });
  });

  // Für den Steuerberater: Einsatzliste + alle Stundenzettel des Monats in einer PDF.
  router.get('/pdf', requireLogin, requireAdmin, async (req, res) => {
    const ym = monthFrom(req);
    const doc = createPdf(`Stundenzettel ${monthLabel(ym)}`);
    const snapshot = await loadMonthSnapshot(store, monthKey(ym));
    drawRoster(doc, await buildRoster(snapshot, ym, { onlyWithEntries: true }));
    for (const u of await snapshot.employeesForMonth(monthKey(ym))) {
      if (u.entry_count > 0) drawEmployeeSheet(doc, await buildEmployeeSheet(snapshot, u, ym));
    }
    sendPdf(res, await pdfToBuffer(doc), `Stundenzettel_${monthKey(ym)}.pdf`);
  });

  return router;
}
