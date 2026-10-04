// Einsatzliste (großes Blatt mit allen Mitarbeitern) – Tag antippen und Zeit erfassen.
// Mitarbeiter bearbeiten ihre eigene Spalte, der Chef alle Spalten.
import express from 'express';
import { requireLogin } from '../auth.js';
import { currentMonthOf } from '../http.js';
import { buildRoster } from '../sheets.js';
import { monthKey, parseMonth } from '../time.js';
import { dialogData } from './entry-actions.js';

export default function rosterRoutes({ store }) {
  const router = express.Router();

  router.get('/einsatzliste', requireLogin, async (req, res) => {
    const current = currentMonthOf(req.today);
    let ym = parseMonth(req.query.monat, req.today);
    if (monthKey(ym) > monthKey(current)) ym = current;
    const roster = await buildRoster(store, ym);
    const isAdmin = req.user.role === 'admin';

    const editable = isAdmin ? roster.employees : roster.employees.filter((e) => e.id === req.user.id);

    res.render('roster', {
      title: 'Einsatzliste',
      ym,
      roster,
      isAdmin,
      isCurrentMonth: monthKey(ym) === monthKey(current),
      returnTo: `/einsatzliste?monat=${roster.month}`,
      dialog: await dialogData(store, {
        viewer: req.user,
        today: req.today,
        month: roster.month,
        employees: editable,
        entries: await store.listMonthEntries(roster.month),
        locked: roster.locked,
      }),
    });
  });

  return router;
}
