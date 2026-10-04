// Einstellungen: Unterschrift hinterlegen, Passwort ändern, Betriebsdaten (nur Chef).
import express from 'express';
import { hashPassword, passwordProblem, requireAdmin, requireLogin, verifyPassword } from '../auth.js';
import { validImageDataUrl } from '../http.js';

export default function settingsRoutes({ store }) {
  const router = express.Router();

  router.get('/einstellungen', requireLogin, async (req, res) => {
    const isAdmin = req.user.role === 'admin';
    res.render('settings', {
      title: 'Einstellungen',
      isAdmin,
      welcome: !!req.query.willkommen,
      signature: await store.getSignature(isAdmin ? res.locals.settings.employer_signature_id : req.user.signature_id),
    });
  });

  router.post('/einstellungen/unterschrift', requireLogin, async (req, res) => {
    const image = validImageDataUrl(req.body.unterschrift);
    if (!image) {
      await req.flash('error', 'Bitte unterschreiben Sie im Feld, bevor Sie speichern.');
      return res.redirect('/einstellungen#unterschrift');
    }
    if (req.user.role === 'admin') {
      await store.setEmployerSignature(req.user.id, image);
      await req.flash('success', 'Unterschrift des Arbeitgebers gespeichert. Sie erscheint jetzt automatisch auf allen Stundenzetteln und der Einsatzliste.');
    } else {
      await store.setUserSignature(req.user.id, image);
      await req.flash('success', 'Unterschrift gespeichert. Sie wird ab jetzt bei jedem Eintrag automatisch gesetzt.');
    }
    res.redirect('/einstellungen#unterschrift');
  });

  router.post('/einstellungen/passwort', requireLogin, async (req, res) => {
    const current = String(req.body.aktuell ?? '');
    const password = String(req.body.passwort ?? '');
    let error = null;
    if (!await verifyPassword(current, req.user.password_hash)) error = 'Das aktuelle Passwort ist falsch.';
    else if (password !== String(req.body.passwort2 ?? '')) error = 'Die neuen Passwörter stimmen nicht überein.';
    else error = passwordProblem(password);
    if (error) {
      await req.flash('error', error);
    } else {
      await store.updateUser(req.user.id, { password_hash: await hashPassword(password) });
      await store.deleteUserSessions(req.user.id, req.session.id_hash);
      await req.flash('success', 'Passwort geändert.');
    }
    res.redirect('/einstellungen#passwort');
  });

  router.post('/einstellungen/betrieb', requireLogin, requireAdmin, async (req, res) => {
    const company = String(req.body.firma ?? '').trim().slice(0, 80);
    const rosterTitle = String(req.body.titel ?? '').trim().slice(0, 80);
    if (!company) {
      await req.flash('error', 'Bitte den Namen des Betriebs angeben.');
      return res.redirect('/einstellungen#betrieb');
    }
    let logo = null;
    if (req.body.logo && !req.body.logo_entfernen) {
      logo = validImageDataUrl(req.body.logo, { types: ['png', 'jpeg'], maxBytes: 1.5 * 1024 * 1024 });
      if (!logo) {
        await req.flash('error', 'Das Logo muss ein PNG- oder JPEG-Bild (max. 1,5 MB) sein.');
        return res.redirect('/einstellungen#betrieb');
      }
    }
    await store.setSetting('company_name', company);
    await store.setSetting('roster_title', rosterTitle || 'Einsatzliste für Minijobber');
    if (req.body.logo_entfernen) await store.setSetting('logo', '');
    else if (logo) await store.setSetting('logo', logo);
    await req.flash('success', 'Betriebsdaten gespeichert.');
    res.redirect('/einstellungen#betrieb');
  });

  return router;
}
