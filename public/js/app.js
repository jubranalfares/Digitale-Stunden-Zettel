// Browser-Logik: Unterschriftenfeld, Eingabefenster im Heft, Logo-Upload, Sicherheitsabfragen, Hell/Dunkel.
(() => {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const parseClock = (v) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

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

    // ---- PDF für den Steuerberater
    // Auf dem Handy öffnet sich das Teilen-Menü (Mail, WhatsApp, Dateien …), am Computer wird es heruntergeladen.
    // Wichtig für die App auf dem Home-Bildschirm: Dort hätte ein einfach geöffnetes PDF keinen Teilen-Knopf.
    const pdfLink = document.querySelector('[data-pdf]');
    const pdfDialog = document.querySelector('[data-pdf-dialog]');
    if (pdfLink && pdfDialog) {
      const q = (sel) => pdfDialog.querySelector(sel);
      const status = q('[data-pdf-status]');
      const shareBtn = q('[data-pdf-share]');
      const downloadLink = q('[data-pdf-download]');
      const pdfError = q('[data-pdf-error]');
      let file = null;
      let blobUrl = null;

      const closePdf = () => { if (pdfDialog.close) pdfDialog.close(); else pdfDialog.removeAttribute('open'); };
      const showPdfError = (message) => {
        pdfError.textContent = message;
        pdfError.hidden = false;
        status.textContent = '';
      };

      const share = async () => {
        try {
          await navigator.share({ files: [file], title: pdfLink.dataset.pdfTitle });
          closePdf();
          toast('Erledigt.');
        } catch (err) {
          // Abgebrochen: Fenster bleibt offen. Nicht erlaubt (z. B. weil das Erstellen zu lange dauerte):
          // dann einfach noch einmal auf den Knopf tippen.
          if (err.name === 'AbortError') return;
          if (err.name === 'NotAllowedError') {
            status.textContent = 'Fertig. Tippen Sie auf „Senden oder sichern“.';
            return;
          }
          showPdfError('Teilen hat nicht geklappt. Laden Sie das PDF stattdessen herunter.');
          downloadLink.hidden = false;
        }
      };

      pdfLink.addEventListener('click', async (e) => {
        e.preventDefault();
        status.textContent = 'Wird erstellt …';
        pdfError.hidden = true;
        shareBtn.disabled = true;
        shareBtn.hidden = false;
        downloadLink.hidden = true;
        if (pdfDialog.showModal) pdfDialog.showModal(); else pdfDialog.setAttribute('open', '');
        q('#pdf-title').focus();
        try {
          const res = await fetch(pdfLink.href, { headers: { Accept: 'application/pdf' } });
          if (!res.ok || !(res.headers.get('content-type') || '').includes('pdf')) throw new Error();
          const blob = await res.blob();
          file = new File([blob], pdfLink.dataset.pdfFile, { type: 'application/pdf' });
          if (blobUrl) URL.revokeObjectURL(blobUrl);
          blobUrl = URL.createObjectURL(blob);
          downloadLink.href = blobUrl;
          downloadLink.download = pdfLink.dataset.pdfFile;
        } catch {
          showPdfError('Das PDF konnte nicht erstellt werden. Bitte versuchen Sie es noch einmal.');
          return;
        }
        const size = `${Math.max(1, Math.round(file.size / 1024))} KB`;
        if (navigator.canShare?.({ files: [file] })) {
          status.textContent = `Fertig, ${size}.`;
          shareBtn.disabled = false;
          await share();
        } else {
          // Computer ohne Teilen-Funktion: direkt herunterladen.
          shareBtn.hidden = true;
          downloadLink.hidden = false;
          downloadLink.click();
          status.textContent = `Fertig, ${size}. Das PDF wurde heruntergeladen.`;
        }
      });
      shareBtn.addEventListener('click', share);
      q('[data-pdf-close]').addEventListener('click', closePdf);
      pdfDialog.addEventListener('click', (e) => { if (e.target === pdfDialog) closePdf(); });
    }

    // ---- Eingabefenster
    const $ = (sel) => dialog.querySelector(sel);
    const form = $('[data-entry-form]');
    const saveBtn = $('[data-entry-save]');
    const deleteBtn = $('[data-entry-delete]');
    const errorEl = $('[data-entry-error]');
    const minutesRow = $('[data-minutes]');
    const QUESTIONS = { start: 'Wann ging es los?', end: 'Wann war Schluss?' };
    let target = null; // Zeile bzw. Zelle, die gerade bearbeitet wird
    let state = null;
    let busy = false;

    const timeOf = (t) => (t ? `${pad(t.h)}:${pad(t.m)}` : '');
    const toTime = (s) => {
      const min = parseClock(s);
      return min == null ? null : { h: Math.floor(min / 60), m: min % 60 };
    };
    const minutesOf = (t) => t.h * 60 + t.m;

    // Arbeitszeit wie auf dem Server: Ende vor Beginn heißt über Mitternacht.
    function work() {
      if (!state.start || !state.end) return null;
      let gross = minutesOf(state.end) - minutesOf(state.start);
      if (gross === 0) return { error: 'Beginn und Ende sind gleich.' };
      const overnight = gross < 0;
      if (overnight) gross += 24 * 60;
      if (gross > MAX_WORK) return { error: 'Das wären mehr als 16 Stunden. Stimmen Beginn und Ende?' };
      return { net: gross, overnight };
    }

    function render() {
      for (const field of ['start', 'end']) {
        $(`[data-tile-value="${field}"]`).textContent = timeOf(state[field]) || '--:--';
        $(`[data-tile="${field}"]`).classList.toggle('active', state.field === field);
        $(`[data-tile="${field}"]`).classList.toggle('filled', !!state[field]);
      }

      $('[data-picker]').hidden = !state.field;
      if (state.field) {
        const current = state[state.field];
        $('[data-picker-head]').textContent = state.minutePending ? 'Und die Minuten?' : QUESTIONS[state.field];
        minutesRow.classList.toggle('pending', !!state.minutePending);
        dialog.querySelectorAll('[data-hour]').forEach((b) => {
          b.classList.toggle('selected', current?.h === Number(b.dataset.hour));
        });
        // Alte Einträge mit krummen Minuten (z. B. 12:10) bekommen einen eigenen Knopf.
        minutesRow.querySelector('[data-extra]')?.remove();
        if (current && current.m % 15) {
          const extra = Object.assign(document.createElement('button'), { type: 'button', textContent: `:${pad(current.m)}` });
          extra.dataset.minute = current.m;
          extra.dataset.extra = '';
          minutesRow.append(extra);
        }
        minutesRow.querySelectorAll('[data-minute]').forEach((b) => {
          b.classList.toggle('selected', !!current && !state.minutePending && current.m === Number(b.dataset.minute));
          b.disabled = !current;
        });
      }

      const total = $('[data-entry-total]');
      const w = work();
      total.className = 'entry-total';
      total.replaceChildren();
      if (w?.error) {
        total.textContent = w.error;
        total.classList.add('bad');
      } else if (w) {
        total.append(
          Object.assign(document.createElement('span'), { textContent: 'Arbeitszeit' }),
          Object.assign(document.createElement('strong'), { textContent: hoursText(w.net) }),
          Object.assign(document.createElement('small'), { textContent: `${hoursWords(w.net)}${w.overnight ? ', über Mitternacht' : ''}` }),
        );
        total.classList.add('good');
      } else {
        total.textContent = state.minutePending ? 'Jetzt die Minuten antippen.'
          : state.start ? 'Jetzt noch das Ende.' : 'Erst die Stunde, dann die Minuten.';
      }
      saveBtn.disabled = !(w && !w.error) || busy;
      deleteBtn.hidden = !state.exists;
    }

    function open(el) {
      target = el;
      const d = el.dataset;
      state = {
        exists: !!(d.start || d.code || d.remarks),
        start: toTime(d.start),
        end: toTime(d.end),
        field: null,
        minutePending: false,
      };
      // Leerer Tag: gleich mit dem Beginn anfangen. Bestehender Tag: erst einmal nur anzeigen.
      if (!state.start) state.field = 'start';
      errorEl.hidden = true;
      $('[data-entry-title]').textContent = dayLabel(d.date);
      $('[data-entry-name]').textContent = d.name || '';
      render();
      if (dialog.showModal) dialog.showModal(); else dialog.setAttribute('open', '');
      $('[data-entry-title]').focus();
    }

    const close = () => {
      if (dialog.close) dialog.close(); else dialog.removeAttribute('open');
    };

    dialog.addEventListener('click', (e) => {
      if (e.target === dialog) return close(); // neben das Fenster getippt
      const btn = e.target.closest('button');
      if (!btn || !state) return;
      if (btn.matches('[data-entry-close]')) return close();
      if (btn.dataset.tile) {
        state.field = btn.dataset.tile;
        state.minutePending = false;
      } else if (btn.dataset.hour) {
        state[state.field] = { h: Number(btn.dataset.hour), m: state[state.field]?.m ?? 0 };
        state.minutePending = true;
      } else if (btn.dataset.minute) {
        const { field } = state;
        state.minutePending = false;
        state[field] = { h: state[field].h, m: Number(btn.dataset.minute) };
        // Nach dem Beginn geht es mit dem Ende weiter, danach ist die Auswahl fertig.
        state.field = field === 'start' && !state.end ? 'end' : null;
      } else if (btn.matches('[data-entry-delete]')) {
        if (window.confirm(`Eintrag vom ${dayLabel(target.dataset.date)} löschen?`)) {
          save({ beginn: '', ende: '', pause: '', kuerzel: '', bemerkung: '' });
        }
        return;
      } else {
        return;
      }
      render();
    });

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (saveBtn.disabled) return;
      // Pause, Kürzel und Bemerkung werden nicht mehr genutzt und beim Speichern geleert.
      save({ beginn: timeOf(state.start), ende: timeOf(state.end), pause: '', kuerzel: '', bemerkung: '' });
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
