// Browser-Logik: Unterschriftenfeld, Eingabefenster im Heft, Logo-Upload, Sicherheitsabfragen, Hell/Dunkel.
(() => {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');

  // ---- Startbildschirm (siehe theme.js): mindestens 2 Sekunden sichtbar und bis die Seite ganz
  // geladen ist. Dann läuft der Ladebalken voll und alles blendet weich aus.
  const root = document.documentElement;
  if (root.classList.contains('launching')) {
    const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, Math.max(0, ms)); });
    const loaded = new Promise((resolve) => {
      if (document.readyState === 'complete') resolve();
      else window.addEventListener('load', resolve, { once: true });
    });
    const shownAt = window.launchShownAt ?? 0;
    Promise.race([Promise.all([loaded, wait(2000 - (performance.now() - shownAt))]), wait(6000)])
      .then(() => {
        root.classList.add('launch-ready');
        return wait(450);
      })
      .then(() => {
        root.classList.add('launch-done');
        return wait(600);
      })
      .then(() => root.classList.remove('launching', 'launch-ready', 'launch-done'));
  }

  // ---- Sicherheitsabfragen --------------------------------------------------

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.dataset.confirm)) e.preventDefault();
  });

  // ---- Hell/Dunkel ----------------------------------------------------------
  // „auto“ folgt dem Handy/Computer; „light“/„dark“ werden pro Gerät gemerkt.

  const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
  const THEME_LABEL = { auto: 'Automatisch', light: 'Hell', dark: 'Dunkel' };

  const storedTheme = () => {
    try {
      const t = localStorage.getItem('theme');
      return t === 'light' || t === 'dark' ? t : 'auto';
    } catch {
      return 'auto';
    }
  };
  const effectiveTheme = (t) => (t === 'auto' ? (systemDark.matches ? 'dark' : 'light') : t);

  function showTheme() {
    const theme = storedTheme();
    const dark = effectiveTheme(theme) === 'dark';
    document.querySelectorAll('[data-theme-toggle]').forEach((btn) => {
      const label = dark ? 'Hellen Modus einschalten' : 'Dunklen Modus einschalten';
      btn.setAttribute('aria-label', label);
      btn.title = label;
      btn.querySelector('[data-theme-icon]').textContent = dark ? '☀' : '☾';
    });
    document.querySelectorAll('[data-theme-set]').forEach((btn) => {
      btn.setAttribute('aria-pressed', String(btn.dataset.themeSet === theme));
    });
    const current = document.querySelector('[data-theme-current]');
    if (current) current.textContent = THEME_LABEL[theme];
  }

  function setTheme(theme) {
    if (theme === 'auto') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme;
    try {
      if (theme === 'auto') localStorage.removeItem('theme');
      else localStorage.setItem('theme', theme);
    } catch { /* nur für diese Seite */ }
    showTheme();
  }

  document.addEventListener('click', (e) => {
    const set = e.target.closest('[data-theme-set]');
    if (set) return setTheme(set.dataset.themeSet);
    if (!e.target.closest('[data-theme-toggle]')) return;
    // Umschalter: immer sichtbar wechseln; entspricht das Ziel der Systemeinstellung, wieder „automatisch“.
    const next = effectiveTheme(storedTheme()) === 'dark' ? 'light' : 'dark';
    setTheme(next === effectiveTheme('auto') ? 'auto' : next);
  });
  systemDark.addEventListener?.('change', showTheme);
  showTheme();

  // ---- Unterschriftenfeld ---------------------------------------------------

  const INK = '#14206e';
  const LINE = 2.6;

  function drawStrokes(ctx, strokes, scale, offsetX = 0, offsetY = 0) {
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.fillStyle = INK;
    ctx.lineWidth = LINE * scale;
    const P = (p) => [(p.x - offsetX) * scale, (p.y - offsetY) * scale];
    for (const pts of strokes) {
      if (pts.length === 1) {
        const [x, y] = P(pts[0]);
        ctx.beginPath();
        ctx.arc(x, y, (LINE * scale) / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(...P(pts[0]));
      for (let i = 1; i < pts.length - 1; i++) {
        const mid = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
        ctx.quadraticCurveTo(...P(pts[i]), ...P(mid));
      }
      ctx.lineTo(...P(pts[pts.length - 1]));
      ctx.stroke();
    }
  }

  function initSignaturePad(root) {
    const area = root.querySelector('.sigpad-area');
    const canvas = root.querySelector('canvas');
    const input = root.querySelector('[data-sigpad-input]');
    const errorEl = root.querySelector('[data-sigpad-error]');
    const ctx = canvas.getContext('2d');
    const strokes = [];
    let current = null;
    let dpr = 1;

    const redraw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      drawStrokes(ctx, strokes, dpr);
      root.classList.toggle('has-ink', strokes.length > 0);
    };
    const resize = () => {
      const r = area.getBoundingClientRect();
      dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      redraw();
    };
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    canvas.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      canvas.setPointerCapture(e.pointerId);
      current = [pos(e)];
      strokes.push(current);
      errorEl.textContent = '';
      redraw();
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!current) return;
      e.preventDefault();
      const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
      for (const ev of events.length ? events : [e]) current.push(pos(ev));
      redraw();
    });
    const end = () => { current = null; };
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    root.querySelector('[data-sigpad-clear]').addEventListener('click', () => {
      strokes.length = 0;
      input.value = '';
      redraw();
    });
    window.addEventListener('resize', resize);
    resize();

    // Zugeschnittenes PNG mit transparentem Hintergrund – passt so in jede Formularzelle.
    root.exportSignature = () => {
      const points = strokes.flat();
      if (points.length < 2) return '';
      const xs = points.map((p) => p.x);
      const ys = points.map((p) => p.y);
      const margin = LINE * 2;
      const minX = Math.min(...xs) - margin;
      const minY = Math.min(...ys) - margin;
      const w = Math.max(...xs) + margin - minX;
      const h = Math.max(...ys) + margin - minY;
      if (w < 20 && h < 20) return '';
      const scale = Math.min(3, 900 / w);
      const out = document.createElement('canvas');
      out.width = Math.ceil(w * scale);
      out.height = Math.ceil(h * scale);
      drawStrokes(out.getContext('2d'), strokes, scale, minX, minY);
      return out.toDataURL('image/png');
    };
    root.showError = (msg) => { errorEl.textContent = msg; };
  }

  document.querySelectorAll('[data-sigpad]').forEach(initSignaturePad);
  document.querySelectorAll('form[data-signature-form]').forEach((form) => {
    form.addEventListener('submit', (e) => {
      for (const sigpad of form.querySelectorAll('[data-sigpad]')) {
        const value = sigpad.exportSignature();
        sigpad.querySelector('[data-sigpad-input]').value = value;
        if (!value && sigpad.hasAttribute('data-required')) {
          e.preventDefault();
          sigpad.showError('Bitte zuerst im Feld unterschreiben.');
          sigpad.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
      }
    });
  });

  // ---- Heft: Tag antippen, Beginn und Ende wählen ------------------------------

  // 270 Minuten → "4,50 h" (Stunden als Menge, nicht als Uhrzeit)
  const hoursText = (min) => `${(min / 60).toFixed(2).replace('.', ',')} h`;
  const hoursWords = (min) => `${Math.floor(min / 60)} Std.${min % 60 ? ` ${min % 60} Min.` : ''}`;
  const MAX_WORK = 16 * 60;
  const dayLabel = (iso) => new Date(`${iso}T12:00:00`).toLocaleDateString('de-DE', {
    weekday: 'long', day: 'numeric', month: 'long',
  });

  const heft = document.querySelector('[data-heft]');
  const dialog = document.querySelector('[data-entry-dialog]');
  if (heft && dialog) {
    const csrf = heft.dataset.csrf;
    const toastEl = document.querySelector('[data-toast]');
    let toastTimer;
    const toast = (message, kind = 'ok') => {
      toastEl.textContent = message;
      toastEl.className = `toast show toast-${kind}`;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), kind === 'ok' ? 3000 : 5000);
    };

    const send = async (payload) => {
      let res;
      try {
        res = await fetch('/eintrag', {
          method: 'POST',
          body: new URLSearchParams({ ...payload, _csrf: csrf }),
          headers: { Accept: 'application/json' },
          redirect: 'manual',
        });
      } catch {
        throw new Error('Keine Verbindung. Bitte versuchen Sie es gleich noch einmal.');
      }
      let data = null;
      try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
      if (!data) throw new Error('Sie wurden abgemeldet. Bitte laden Sie die Seite neu.');
      if (!res.ok) throw new Error(data.error || 'Das hat leider nicht geklappt.');
      return data;
    };

    const setSignature = (key, sig) => {
      document.querySelectorAll(`[data-sig-img="${key}"]`).forEach((img) => {
        if (sig) img.src = `/signatur/${sig.id}.png`;
        else img.removeAttribute('src');
        img.hidden = !sig;
      });
      document.querySelectorAll(`[data-sig-date="${key}"]`).forEach((el) => { el.textContent = sig ? sig.date : ''; });
    };

    // Fenster immer mittig im sichtbaren Bereich halten, auch wenn die Tastatur aufgeht.
    const vv = window.visualViewport;
    const fitDialogs = () => {
      if (!vv) return;
      document.querySelectorAll('dialog.entry-dialog').forEach((d) => {
        d.style.setProperty('--vv-top', `${Math.round(vv.offsetTop)}px`);
        d.style.setProperty('--vv-height', `${Math.round(vv.height)}px`);
      });
    };
    vv?.addEventListener('resize', fitDialogs);
    vv?.addEventListener('scroll', fitDialogs);
    fitDialogs();

    // ---- Für den Steuerberater: PDF und, falls eingerichtet, die DATEV-Datei
    // Auf dem Handy öffnet sich das Teilen-Menü (Mail, WhatsApp, Dateien …) mit beiden Dateien, am Computer
    // werden sie heruntergeladen. Wichtig für die App auf dem Home-Bildschirm: Dort hätte eine einfach
    // geöffnete Datei keinen Teilen-Knopf.
    const pdfLink = document.querySelector('[data-pdf]');
    const pdfDialog = document.querySelector('[data-pdf-dialog]');
    if (pdfLink && pdfDialog) {
      const q = (sel) => pdfDialog.querySelector(sel);
      const shareBtn = q('[data-pdf-share]');
      const pdfError = q('[data-pdf-error]');
      const rows = [...pdfDialog.querySelectorAll('[data-file]')].map((el) => ({
        el,
        status: el.querySelector('[data-file-status]'),
        link: el.querySelector('[data-file-download]'),
        file: null,
      }));
      let ready = [];

      const closePdf = () => { if (pdfDialog.close) pdfDialog.close(); else pdfDialog.removeAttribute('open'); };
      const showDownloads = () => ready.forEach((r) => { r.link.hidden = false; });

      // Eine Datei erstellen lassen. Bei der DATEV-Datei sagt der Server genau, was noch fehlt.
      const load = async (row) => {
        const { url, name, type } = row.el.dataset;
        row.file = null;
        row.link.hidden = true;
        row.status.textContent = 'Wird erstellt …';
        row.status.classList.remove('is-error');
        try {
          const res = await fetch(url, { headers: { Accept: `${type}, application/json;q=0.9` } });
          if (res.status === 422) throw new Error((await res.json()).problems.join(' '));
          if (!res.ok || (res.headers.get('content-type') || '').includes('html')) throw new Error();
          const blob = await res.blob();
          row.file = new File([blob], name, { type });
          if (row.link.href.startsWith('blob:')) URL.revokeObjectURL(row.link.href);
          row.link.href = URL.createObjectURL(blob);
          row.link.download = name;
          row.status.textContent = `Fertig, ${Math.max(1, Math.round(blob.size / 1024))} KB.`;
        } catch (err) {
          row.status.textContent = err.message || 'Hat nicht geklappt. Bitte noch einmal versuchen.';
          row.status.classList.add('is-error');
        }
      };

      const share = async () => {
        try {
          await navigator.share({ files: ready.map((r) => r.file), title: pdfLink.dataset.pdfTitle });
          closePdf();
          toast('Erledigt.');
        } catch (err) {
          // Abgebrochen: Fenster bleibt offen. Nicht erlaubt (z. B. weil das Erstellen zu lange dauerte):
          // dann einfach noch einmal auf den Knopf tippen.
          if (err.name === 'AbortError') return;
          if (err.name === 'NotAllowedError') {
            toast('Fertig. Tippen Sie auf „Senden oder sichern“.');
            return;
          }
          pdfError.textContent = 'Teilen hat nicht geklappt. Laden Sie die Dateien stattdessen herunter.';
          pdfError.hidden = false;
          showDownloads();
        }
      };

      pdfLink.addEventListener('click', async (e) => {
        e.preventDefault();
        pdfError.hidden = true;
        shareBtn.disabled = true;
        shareBtn.hidden = false;
        shareBtn.textContent = 'Senden oder sichern';
        fitDialogs();
        if (pdfDialog.showModal) pdfDialog.showModal(); else pdfDialog.setAttribute('open', '');
        q('#pdf-title').focus();

        await Promise.all(rows.map(load));
        ready = rows.filter((r) => r.file);
        if (!ready.length) return;
        // Fehlt etwas (z. B. eine Personalnummer), steht es bei der Datei. Senden geht dann nur bewusst.
        const complete = ready.length === rows.length;
        if (!complete) shareBtn.textContent = 'Trotzdem senden';

        if (navigator.canShare?.({ files: ready.map((r) => r.file) })) {
          shareBtn.disabled = false;
          if (complete) await share();
        } else {
          // Computer ohne Teilen-Funktion: herunterladen.
          shareBtn.hidden = true;
          showDownloads();
          if (complete) ready.forEach((r) => r.link.click());
        }
      });
      shareBtn.addEventListener('click', share);
      q('[data-pdf-close]').addEventListener('click', closePdf);
      pdfDialog.addEventListener('click', (e) => { if (e.target === pdfDialog) closePdf(); });
    }

    // ---- Eingabefenster: Uhrzeit direkt eintippen
    const $ = (sel) => dialog.querySelector(sel);
    const form = $('[data-entry-form]');
    const saveBtn = $('[data-entry-save]');
    const deleteBtn = $('[data-entry-delete]');
    const errorEl = $('[data-entry-error]');
    const ORDER = ['start-h', 'start-m', 'end-h', 'end-m'];
    const inputs = Object.fromEntries(ORDER.map((k) => [k, $(`[data-in="${k}"]`)]));
    let target = null; // Zeile bzw. Zelle, die gerade bearbeitet wird
    let exists = false;
    let busy = false;

    const timeOf = (t) => (t ? `${pad(t.h)}:${pad(t.m)}` : '');
    const minutesOf = (t) => t.h * 60 + t.m;
    const isHour = (key) => key.endsWith('-h');

    // Uhrzeit aus den beiden Feldern; ohne Minuten gilt :00. null = leer, false = ungültig.
    function readTime(field) {
      const h = inputs[`${field}-h`].value;
      const m = inputs[`${field}-m`].value;
      if (h === '' && m === '') return null;
      if (h === '') return false;
      const t = { h: Number(h), m: m === '' ? 0 : Number(m) };
      return t.h <= 23 && t.m <= 59 ? t : false;
    }

    // Arbeitszeit wie auf dem Server: Ende vor Beginn heißt über Mitternacht.
    function work(start, end) {
      let gross = minutesOf(end) - minutesOf(start);
      if (gross === 0) return { error: 'Beginn und Ende sind gleich.' };
      const overnight = gross < 0;
      if (overnight) gross += 24 * 60;
      if (gross > MAX_WORK) return { error: 'Das wären mehr als 16 Stunden. Stimmen Beginn und Ende?' };
      return { net: gross, overnight };
    }

    function render() {
      const start = readTime('start');
      const end = readTime('end');
      for (const key of ORDER) {
        const v = inputs[key].value;
        inputs[key].classList.toggle('bad', v !== '' && Number(v) > (isHour(key) ? 23 : 59));
      }
      const total = $('[data-entry-total]');
      total.className = 'entry-total';
      total.replaceChildren();
      let ok = false;
      if (start === false || end === false) {
        total.textContent = 'Die Uhrzeit gibt es nicht. Stunden gehen bis 23, Minuten bis 59.';
        total.classList.add('bad');
      } else if (start && end) {
        const w = work(start, end);
        if (w.error) {
          total.textContent = w.error;
          total.classList.add('bad');
        } else {
          total.append(
            Object.assign(document.createElement('span'), { textContent: 'Arbeitszeit' }),
            Object.assign(document.createElement('strong'), { textContent: hoursText(w.net) }),
            Object.assign(document.createElement('small'), { textContent: `${hoursWords(w.net)}${w.overnight ? ', über Mitternacht' : ''}` }),
          );
          total.classList.add('good');
          ok = true;
        }
      } else {
        total.textContent = start ? 'Jetzt noch das Ende eintippen.' : 'Tippen Sie die Uhrzeit ein, zum Beispiel 12 und 30.';
      }
      saveBtn.disabled = !ok || busy;
      deleteBtn.hidden = !exists;
    }

    const focusField = (key) => { inputs[key].focus(); inputs[key].select(); };
    const next = (key) => ORDER[ORDER.indexOf(key) + 1];
    const prev = (key) => ORDER[ORDER.indexOf(key) - 1];

    for (const key of ORDER) {
      const input = inputs[key];
      // Wer in ein Feld kommt, überschreibt den alten Wert (auch wenn das Handy nichts markiert).
      input.addEventListener('focus', () => {
        input.dataset.fresh = '1';
        input.select();
      });
      input.addEventListener('input', (e) => {
        let digits = input.value.replace(/\D/g, '');
        if (input.dataset.fresh && e.data != null) digits = String(e.data).replace(/\D/g, '');
        input.dataset.fresh = '';
        input.value = digits.slice(0, 2);
        const v = input.value;
        // Fertig ist ein Feld nach zwei Ziffern, oder nach einer, wenn keine zweite mehr passt (z. B. 8 Uhr).
        const done = v.length === 2 || (v.length === 1 && Number(v) > (isHour(key) ? 2 : 5));
        if (done) {
          if (v.length === 1) input.value = `0${v}`;
          if (next(key)) focusField(next(key));
          else input.blur();
        }
        render();
      });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Backspace' && input.value === '' && prev(key)) {
          e.preventDefault();
          focusField(prev(key));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (!saveBtn.disabled) form.requestSubmit();
          else if (next(key)) focusField(next(key));
        }
      });
      input.addEventListener('blur', (e) => {
        if (input.value.length === 1) input.value = `0${input.value}`;
        // Stunde ohne Minuten: :00 eintragen, damit klar ist, was gespeichert wird.
        const minute = isHour(key) ? inputs[next(key)] : input;
        const hour = isHour(key) ? input : inputs[prev(key)];
        if (hour.value && !minute.value && e.relatedTarget !== minute) minute.value = '00';
        render();
      });
    }

    function open(el) {
      target = el;
      const d = el.dataset;
      exists = !!(d.start || d.code || d.remarks);
      for (const [field, value] of [['start', d.start], ['end', d.end]]) {
        const [h = '', m = ''] = value ? value.split(':') : [];
        inputs[`${field}-h`].value = h;
        inputs[`${field}-m`].value = m;
      }
      errorEl.hidden = true;
      $('[data-entry-title]').textContent = dayLabel(d.date);
      $('[data-entry-name]').textContent = d.name || '';
      render();
      fitDialogs();
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      // Leerer Tag: gleich die Stunde des Beginns eintippen (Zahlentastatur geht auf).
      if (!d.start) focusField('start-h');
      else $('[data-entry-title]').focus();
    }

    const close = () => {
      if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    };

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) return close(); // neben das Fenster getippt
      const btn = e.target.closest('button');
      if (btn?.matches('[data-entry-close]')) return close();
      if (btn?.matches('[data-entry-delete]') && window.confirm(`Eintrag vom ${dayLabel(target.dataset.date)} löschen?`)) {
        save({ beginn: '', ende: '', pause: '', kuerzel: '', bemerkung: '' });
      }
      // Tipp auf ein Zeitfeld-Kästchen (nicht genau ins Feld): das passende Feld wählen.
      const box = e.target.closest('[data-box]');
      if (box && !e.target.matches('input')) focusField(`${box.dataset.box}-h`);
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      render();
      if (saveBtn.disabled) return;
      document.activeElement?.blur();
      // Pause, Kürzel und Bemerkung werden nicht mehr genutzt und beim Speichern geleert.
      save({ beginn: timeOf(readTime('start')), ende: timeOf(readTime('end')), pause: '', kuerzel: '', bemerkung: '' });
    });

    // Gespeicherten Tag im Formular anzeigen.
    function showSaved(el, data) {
      const entry = data.entry;
      Object.assign(el.dataset, {
        start: entry?.start ?? '',
        end: entry?.end ?? '',
        code: entry?.code ?? '',
        remarks: entry?.remarks ?? '',
      });
      if (el.matches('tr')) {
        for (const [key, value] of Object.entries(data.row)) {
          const out = el.querySelector(`[data-out="${key}"]`);
          if (out) out.textContent = value;
        }
        el.querySelector('[data-out="bemerkung"]').title = data.row.bemerkung;
        if (data.row.ag && data.row.aufgezeichnet) {
          el.querySelector('[data-out="aufgezeichnet"]').append(' ', Object.assign(document.createElement('small'), { textContent: 'AG' }));
          document.querySelector('[data-ag-note]')?.removeAttribute('hidden');
        }
        document.querySelectorAll('[data-out="total"]').forEach((out) => { out.textContent = data.total; });
        setSignature('employee', data.employeeSignature);
        setSignature('employer', data.employerSignature);
      } else {
        renderCell(el.querySelector('[data-cell-view]'), data.cell);
        document.querySelectorAll(`[data-sum-user="${el.dataset.user}"]`).forEach((out) => { out.textContent = data.total; });
        setSignature('roster-employer', data.rosterEmployerSignature);
      }
      el.classList.remove('just-saved');
      void el.offsetWidth; // Animation neu starten
      el.classList.add('just-saved');
    }

    async function save(fields) {
      busy = true;
      saveBtn.textContent = 'Speichert …';
      render();
      errorEl.hidden = true;
      try {
        const data = await send({ user: target.dataset.user, datum: target.dataset.date, ...fields });
        showSaved(target, data);
        close();
        toast(data.entry
          ? `Gespeichert: ${data.day}. Diesen Monat ${data.total || '0,00 h'}.`
          : 'Eintrag gelöscht.');
      } catch (err) {
        errorEl.textContent = err.message;
        errorEl.hidden = false;
      } finally {
        busy = false;
        saveBtn.textContent = 'Speichern';
        if (dialog.open) render();
      }
    }

    // Tag antippen: die ganze Zeile bzw. Zelle ist die Fläche.
    heft.addEventListener('click', (e) => {
      const el = e.target.closest('[data-entry]');
      if (el && !e.target.closest('a')) open(el);
    });

    // ---- Einsatzliste: Tageszelle neu zeichnen (nur Unterschrift, keine Stunden)
    function renderCell(view, cell) {
      view.replaceChildren();
      if (!cell) return;
      if (cell.code && !cell.duration) {
        view.append(Object.assign(document.createElement('span'), { className: 'rc-code', textContent: cell.code }));
      }
      if (cell.signatureId) {
        view.append(Object.assign(document.createElement('img'), { src: `/signatur/${cell.signatureId}.png`, alt: 'Unterschrift' }));
      } else if (cell.ag) {
        view.append(Object.assign(document.createElement('span'), { className: 'rc-ag', textContent: 'AG' }));
      }
    }

    // Auf dem Handy: Formular so verschieben, dass die Tabelle bzw. die eigene Spalte sichtbar ist.
    document.querySelectorAll('[data-scroll]').forEach((scroller) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      const own = scroller.querySelector('td.name.own') ?? scroller.querySelector('table');
      if (!own) return;
      const left = own.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
      scroller.scrollLeft = own.matches('td') ? left - (scroller.clientWidth - own.offsetWidth) / 2 : left - 8;
    });
    const todayRow = document.querySelector('tr.today');
    if (todayRow && todayRow.getBoundingClientRect().bottom > window.innerHeight) {
      todayRow.scrollIntoView({ block: 'center' });
    }
  }

  // ---- Logo-Upload ----------------------------------------------------------

  const logoFile = document.querySelector('[data-logo-file]');
  if (logoFile) {
    const logoInput = document.querySelector('[data-logo-input]');
    const preview = document.querySelector('[data-logo-preview]');
    const wrap = document.querySelector('[data-logo-preview-wrap]');
    logoFile.addEventListener('change', () => {
      const file = logoFile.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          // Auf max. 600 px verkleinern, damit Seite und PDF schlank bleiben.
          const scale = Math.min(1, 600 / Math.max(img.width, img.height));
          const c = document.createElement('canvas');
          c.width = Math.round(img.width * scale);
          c.height = Math.round(img.height * scale);
          c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
          const url = file.type === 'image/jpeg' ? c.toDataURL('image/jpeg', 0.9) : c.toDataURL('image/png');
          logoInput.value = url;
          preview.src = url;
          wrap.classList.remove('hidden');
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }
})();
