// Einstellungen: Unterschrift hinterlegen, Passwort ändern, Betriebsdaten (nur Chef).
import express from 'express';
import { hashPassword, passwordProblem, requireAdmin, requireLogin, verifyPassword } from '../auth.js';
import { validImageDataUrl } from '../http.js';

export default function settingsRoutes({ store }) {
  const router = express.Router();

  router.get('/einstellungen', requireLogin, (req, res) => {
    const isAdmin = req.user.role === 'admin';
    const settings = store.getSettings();
    res.render('settings', {
      title: 'Einstellungen',
      isAdmin,
      welcome: !!req.query.willkommen,
      signature: isAdmin
        ? store.getSignature(Number(settings.employer_signature_id))
        : store.getSignature(req.user.signature_id),
    });
  });

  router.post('/einstellungen/unterschrift', requireLogin, (req, res) => {
    const image = validImageDataUrl(req.body.unterschrift);
    if (!image) {
      req.flash('error', 'Bitte unterschreiben Sie im Feld, bevor Sie speichern.');
      return res.redirect('/einstellungen#unterschrift');
    }
    if (req.user.role === 'admin') {
      store.setEmployerSignature(req.user.id, image);
      req.flash('success', 'Unterschrift des Arbeitgebers gespeichert. Sie erscheint jetzt automatisch auf allen Stundenzetteln und der Einsatzliste.');
    } else {
      store.setUserSignature(req.user.id, image);
      req.flash('success', 'Unterschrift gespeichert. Sie wird ab jetzt bei jedem Eintrag automatisch gesetzt.');
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
      req.flash('error', error);
    } else {
      store.updateUser(req.user.id, { password_hash: await hashPassword(password) });
      store.deleteUserSessions(req.user.id, req.session.id_hash);
      req.flash('success', 'Passwort geändert.');
    }
    res.redirect('/einstellungen#passwort');
  });

  router.post('/einstellungen/betrieb', requireLogin, requireAdmin, (req, res) => {
    const company = String(req.body.firma ?? '').trim().slice(0, 80);
    const rosterTitle = String(req.body.titel ?? '').trim().slice(0, 80);
    if (!company) {
      req.flash('error', 'Bitte den Namen des Betriebs angeben.');
      return res.redirect('/einstellungen#betrieb');
    }
    store.setSetting('company_name', company);
    store.setSetting('roster_title', rosterTitle || 'Einsatzliste für Minijobber');

    if (req.body.logo_entfernen) {
      store.setSetting('logo', '');
    } else if (req.body.logo) {
      const logo = validImageDataUrl(req.body.logo, { types: ['png', 'jpeg'], maxBytes: 1.5 * 1024 * 1024 });
      if (!logo) {
        req.flash('error', 'Das Logo muss ein PNG- oder JPEG-Bild (max. 1,5 MB) sein.');
        return res.redirect('/einstellungen#betrieb');
      }
      store.setSetting('logo', logo);
    }
    req.flash('success', 'Betriebsdaten gespeichert.');
    res.redirect('/einstellungen#betrieb');
  });

  return router;
}
