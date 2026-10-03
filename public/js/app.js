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

  // ---- Erfassungsformular ---------------------------------------------------

  const form = document.querySelector('[data-entry-form]');
  const dataEl = document.getElementById('entry-data');
  if (form && dataEl) {
    const data = JSON.parse(dataEl.textContent);
    const dateInput = form.querySelector('[data-date-input]');
    const field = (name) => form.querySelector(`[data-field="${name}"]`);
    const modeEl = document.querySelector('[data-entry-mode]');
    const saveBtn = form.querySelector('[data-save]');
    const deleteBtn = form.querySelector('[data-delete]');
    const blockEl = form.querySelector('[data-block-reason]');
    const preview = form.querySelector('[data-duration-preview]');
    const durationEl = form.querySelector('[data-duration]');
    const labelEl = form.querySelector('[data-duration-label]');

    const setPause = (value) => {
      const select = field('pause');
      if (![...select.options].some((o) => o.value === value)) select.add(new Option(`${value} Std.`, value));
      select.value = value;
    };

    const blockReason = (date) => {
      if (!date) return 'Bitte ein Datum wählen.';
      if (date > data.today) return 'Arbeitszeiten können erst am Arbeitstag selbst oder danach eingetragen werden.';
      if (data.locked) return 'Dieser Monat ist abgeschlossen.';
      if (data.minDate && date < data.minDate) return 'Einträge älterer Monate kann nur der Chef ändern.';
      return '';
    };

    const update = () => {
      const start = parseClock(field('beginn').value);
      const end = parseClock(field('ende').value);
      const pause = parseClock(field('pause').value) ?? 0;
      let text = '–';
      let label = 'Dauer';
      let bad = false;
      if (start != null && end != null) {
        let gross = end - start;
        if (gross < 0) gross += 24 * 60;
        const net = gross - pause;
        if (gross === 0 || net <= 0) {
          text = 'ungültig';
          bad = true;
        } else {
          text = `${fmt(net)} Std.`;
          if (net > 9 * 60 && pause < 45) { label = 'Pause zu kurz (mind. 45 Min.)'; bad = true; }
          else if (net > 6 * 60 && pause < 30) { label = 'Pause zu kurz (mind. 30 Min.)'; bad = true; }
        }
      } else if (field('kuerzel').value) {
        text = field('kuerzel').selectedOptions[0].textContent;
      }
      durationEl.textContent = text;
      labelEl.textContent = label;
      preview.classList.toggle('invalid', bad);
    };

    const load = (date) => {
      if (date && date.slice(0, 7) !== data.month) {
        window.location.href = `${data.base}?monat=${date.slice(0, 7)}&tag=${Number(date.slice(8))}#erfassen`;
        return;
      }
      const entry = data.entries[date];
      field('beginn').value = entry?.beginn ?? '';
      field('ende').value = entry?.ende ?? '';
      setPause(entry?.pause || '0:00');
      field('kuerzel').value = entry?.kuerzel ?? '';
      field('bemerkung').value = entry?.bemerkung ?? '';
      modeEl.textContent = entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag';
      modeEl.classList.toggle('chip-warn', !!entry);
      deleteBtn.classList.toggle('hidden', !entry);
      document.querySelectorAll('tr[data-date]').forEach((tr) => tr.classList.toggle('is-selected', tr.dataset.date === date));

      const reason = blockReason(date);
      blockEl.textContent = reason;
      blockEl.classList.toggle('hidden', !reason);
      form.querySelectorAll('[data-field]').forEach((el) => { el.disabled = !!reason; });
      saveBtn.disabled = !!reason;
      deleteBtn.disabled = !!reason;
      update();
    };

    dateInput.addEventListener('change', () => load(dateInput.value));
    ['beginn', 'ende', 'pause', 'kuerzel'].forEach((name) => {
      field(name).addEventListener('input', update);
      field(name).addEventListener('change', update);
    });
    document.querySelectorAll('tr[data-date]').forEach((tr) => {
      tr.addEventListener('click', () => {
        dateInput.value = tr.dataset.date;
        load(tr.dataset.date);
        document.getElementById('erfassen').scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    load(dateInput.value);
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
