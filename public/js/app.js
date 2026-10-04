// Browser-Logik: Unterschriftenfeld, Erfassungsformular, Logo-Upload, Sicherheitsabfragen.
(() => {
  'use strict';

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (min) => `${Math.floor(min / 60)}:${pad(min % 60)}`;
  const parseClock = (v) => {
    const m = /^(\d{1,2}):(\d{2})/.exec(v || '');
    return m ? Number(m[1]) * 60 + Number(m[2]) : null;
  };

  // ---- Sicherheitsabfragen --------------------------------------------------

  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-confirm]');
    if (el && !window.confirm(el.dataset.confirm)) e.preventDefault();
  });

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

  // ---- Heft: direkt ins Formular schreiben ----------------------------------

  const CODES = ['K', 'U', 'UU', 'F', 'SA', 'SU'];

  // "12" → "12:00", "930" → "09:30", "12.30" → "12:30"; '' bleibt leer, null = nicht erkannt.
  const normClock = (value) => {
    const s = String(value).trim();
    if (!s) return '';
    const m = /^(\d{1,2})(?:[:.,]?(\d{2}))?$/.exec(s);
    if (!m || Number(m[1]) > 23 || Number(m[2] ?? 0) > 59) return null;
    return `${pad(Number(m[1]))}:${pad(Number(m[2] ?? 0))}`;
  };

  // Pause: "30" → 0:30, "1" → 1:00, "130" → 1:30, "0,5" → 0:30.
  const normPause = (value) => {
    const s = String(value).trim();
    if (!s) return '';
    let m;
    let min = null;
    if ((m = /^(\d{1,2})[:.](\d{2})$/.exec(s))) min = Number(m[1]) * 60 + Number(m[2]);
    else if (/^\d$/.test(s)) min = Number(s) * 60;
    else if (/^\d{2}$/.test(s)) min = Number(s);
    else if ((m = /^(\d{1,2})(\d{2})$/.exec(s)) && Number(m[2]) < 60) min = Number(m[1]) * 60 + Number(m[2]);
    else if ((m = /^(\d{1,2}),(\d{1,2})$/.exec(s))) min = Math.round(Number(`${m[1]}.${m[2]}`) * 60);
    if (min == null) return null;
    return min ? fmt(min) : '';
  };

  const heft = document.querySelector('[data-heft]');
  if (heft) {
    const csrf = heft.dataset.csrf;
    const toastEl = document.querySelector('[data-toast]');
    let toastTimer;
    const toast = (message, kind = 'ok') => {
      toastEl.textContent = message;
      toastEl.className = `toast show toast-${kind}`;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), kind === 'ok' ? 2500 : 5000);
    };

    // Speichervorgänge nacheinander abarbeiten, damit sich nichts überholt.
    let queue = Promise.resolve();
    const send = (payload) => {
      const run = async () => {
        let res;
        try {
          res = await fetch('/eintrag', {
            method: 'POST',
            body: new URLSearchParams({ ...payload, _csrf: csrf }),
            headers: { Accept: 'application/json' },
            redirect: 'manual',
            keepalive: true,
          });
        } catch {
          throw new Error('Keine Verbindung – bitte gleich noch einmal versuchen.');
        }
        let data = null;
        try { data = await res.json(); } catch { /* keine JSON-Antwort */ }
        if (!data) throw new Error('Sitzung abgelaufen – bitte die Seite neu laden.');
        if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen.');
        return data;
      };
      const p = queue.then(run, run);
      queue = p.catch(() => {});
      return p;
    };

    const setSignature = (key, sig) => {
      document.querySelectorAll(`[data-sig-img="${key}"]`).forEach((img) => {
        if (sig) img.src = `/signatur/${sig.id}.png`;
        else img.removeAttribute('src');
        img.hidden = !sig;
      });
      document.querySelectorAll(`[data-sig-date="${key}"]`).forEach((el) => { el.textContent = sig ? sig.date : ''; });
    };

    const savedMessage = (data) => (data.total ? `✓ Gespeichert · Monatssumme ${data.total} Std.` : '✓ Gespeichert');

    // ---- Stundenzettel: eine Zeile = ein Tag
    const FIELDS = ['beginn', 'pause', 'ende', 'kuerzel', 'bemerkung'];
    const rows = [...document.querySelectorAll('tr[data-row]')];
    rows.forEach((tr, index) => {
      const f = Object.fromEntries(FIELDS.map((n) => [n, tr.querySelector(`[name="${n}"]`)]));
      const snapshot = () => FIELDS.map((n) => f[n].value).join('|');
      let saved = snapshot();

      const commit = async () => {
        const start = normClock(f.beginn.value);
        const end = normClock(f.ende.value);
        const pause = normPause(f.pause.value);
        if (start === null || end === null || pause === null) {
          tr.classList.add('row-error');
          toast('Uhrzeit nicht erkannt – z. B. 12 oder 12:30 eingeben.', 'error');
          return;
        }
        f.beginn.value = start;
        f.ende.value = end;
        f.pause.value = pause;
        if (snapshot() === saved) {
          tr.classList.remove('row-error', 'row-pending');
          return;
        }
        if (!start !== !end) {
          tr.classList.add('row-pending');
          toast(start ? 'Ende fehlt noch.' : 'Beginn fehlt noch.', 'warn');
          return;
        }
        tr.classList.remove('row-error', 'row-pending');
        tr.classList.add('row-saving');
        const sent = snapshot();
        const payload = { user: tr.dataset.user, datum: tr.dataset.date };
        FIELDS.forEach((n) => { payload[n] = f[n].value; });
        try {
          const data = await send(payload);
          if (snapshot() === sent) FIELDS.forEach((n) => { f[n].value = data.row[n]; });
          saved = snapshot() === sent ? snapshot() : sent;
          tr.querySelector('[data-out="dauer"]').textContent = data.row.dauer;
          const rec = tr.querySelector('[data-out="aufgezeichnet"]');
          rec.textContent = data.row.aufgezeichnet;
          if (data.row.ag) {
            const small = document.createElement('small');
            small.textContent = 'AG';
            rec.append(' ', small);
            document.querySelector('[data-ag-note]')?.removeAttribute('hidden');
          }
          document.querySelectorAll('[data-out="total"]').forEach((el) => { el.textContent = data.total; });
          setSignature('employee', data.employeeSignature);
          setSignature('employer', data.employerSignature);
          toast(savedMessage(data));
        } catch (err) {
          tr.classList.add('row-error');
          toast(err.message, 'error');
        } finally {
          tr.classList.remove('row-saving');
        }
      };

      // Gespeichert wird, sobald man die Zeile verlässt.
      tr.addEventListener('focusout', (e) => {
        if (!tr.contains(e.relatedTarget)) commit();
      });
      tr.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' || e.target.tagName === 'SELECT') return;
        e.preventDefault();
        const next = rows[index + 1]?.querySelector(`[name="${e.target.name}"]`);
        if (next) next.focus();
        else e.target.blur();
      });
    });

    // ---- Einsatzliste: "12-16" direkt in die Zelle
    const parseCell = (text) => {
      const s = text.trim();
      if (!s) return { beginn: '', ende: '', pause: '', kuerzel: '', bemerkung: '' };
      if (CODES.includes(s.toUpperCase())) return { beginn: '', ende: '', kuerzel: s.toUpperCase() };
      const m = /^(\d{1,2}(?:[:.,]?\d{2})?)\s*(?:-|–|—|bis|\s)\s*(\d{1,2}(?:[:.,]?\d{2})?)$/i.exec(s);
      if (!m) return null;
      const beginn = normClock(m[1]);
      const ende = normClock(m[2]);
      if (!beginn || !ende) return null;
      return { beginn, ende, kuerzel: '' };
    };

    const renderCell = (view, cell) => {
      view.replaceChildren();
      if (!cell) return;
      const text = document.createElement('div');
      text.className = 'rc-text';
      text.style.fontSize = `calc(var(--pt) * ${cell.duration ? 8.5 : 9})`;
      if (cell.duration) text.append(Object.assign(document.createElement('span'), { textContent: cell.duration }));
      if (cell.code) {
        text.append(Object.assign(document.createElement('span'), {
          className: `rc-code ${cell.duration ? '' : 'only'}`, textContent: cell.code,
        }));
      }
      view.append(text);
      if (cell.signatureId) {
        view.append(Object.assign(document.createElement('img'), { src: `/signatur/${cell.signatureId}.png`, alt: 'Unterschrift' }));
      } else if (cell.ag) {
        view.append(Object.assign(document.createElement('span'), { className: 'rc-ag', textContent: 'AG' }));
      }
    };

    const cells = [...document.querySelectorAll('input[data-cell]')];
    cells.forEach((input) => {
      let saved = input.value;
      const td = input.closest('td');
      input.addEventListener('focus', () => input.select());
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const sameColumn = cells.filter((c) => c.dataset.user === input.dataset.user);
        const next = sameColumn[sameColumn.indexOf(input) + 1];
        if (next) next.focus();
        else input.blur();
      });
      input.addEventListener('blur', async () => {
        if (input.value.trim() === saved.trim()) return;
        const parsed = parseCell(input.value);
        if (!parsed) {
          td.classList.add('cell-error');
          toast('Bitte z. B. 12-16 eintragen (oder U, K, F …).', 'error');
          return;
        }
        td.classList.remove('cell-error');
        td.classList.add('cell-saving');
        try {
          const data = await send({ user: input.dataset.user, datum: input.dataset.date, ...parsed });
          input.value = data.cell ? data.cell.raw : '';
          saved = input.value;
          renderCell(td.querySelector('[data-cell-view]'), data.cell);
          document.querySelectorAll(`[data-sum-user="${input.dataset.user}"]`).forEach((el) => { el.textContent = data.total; });
          setSignature('roster-employer', data.rosterEmployerSignature);
          toast(data.cell?.duration ? `✓ ${data.cell.duration} Std. · Monatssumme ${data.total} Std.` : savedMessage(data));
        } catch (err) {
          td.classList.add('cell-error');
          toast(err.message, 'error');
        } finally {
          td.classList.remove('cell-saving');
        }
      });
    });

    // Beim Verlassen der Seite das gerade bearbeitete Feld noch speichern.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden' && document.activeElement?.matches('.cell-in, .rc-in')) {
        document.activeElement.blur();
      }
    });

    // Auf dem Handy: Formular so verschieben, dass die Tabelle bzw. die eigene Spalte sichtbar ist.
    document.querySelectorAll('[data-scroll]').forEach((scroller) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      const target = scroller.querySelector('td.name.own') ?? scroller.querySelector('table');
      if (!target) return;
      const left = target.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
      scroller.scrollLeft = target.matches('td') ? left - (scroller.clientWidth - target.offsetWidth) / 2 : left - 8;
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
