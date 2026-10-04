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

  // ---- Erfassungsfenster ----------------------------------------------------

  const dialog = document.getElementById('entry-dialog');
  const dataEl = document.getElementById('entry-data');
  if (dialog && dataEl) {
    const data = JSON.parse(dataEl.textContent);
    const form = dialog.querySelector('[data-entry-form]');
    const input = (name) => form.querySelector(`[data-in="${name}"]`);
    const out = (name) => form.querySelector(`[data-out="${name}"]`);
    const saveBtn = form.querySelector('[data-save]');
    const deleteBtn = form.querySelector('[data-delete]');
    const pauseChips = form.querySelector('[data-chips="pause"]');
    const codeChips = form.querySelector('[data-chips="kuerzel"]');
    const morePause = form.querySelector('[data-more="pause"]');
    const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];

    const dayTitle = (iso) => {
      const [y, m, d] = iso.split('-').map(Number);
      return `${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}, ${pad(d)}.${pad(m)}.${y}`;
    };

    const setPause = (value) => {
      input('pause').value = value || '0:00';
      let matched = false;
      pauseChips.querySelectorAll('button').forEach((b) => {
        const on = b.dataset.value === input('pause').value;
        b.classList.toggle('on', on);
        matched ||= on;
      });
      morePause.value = matched ? '' : input('pause').value;
      if (!matched && morePause.value !== input('pause').value) {
        morePause.add(new Option(`${input('pause').value} Std`, input('pause').value));
        morePause.value = input('pause').value;
      }
      morePause.classList.toggle('on', !matched);
    };

    const setCode = (value) => {
      input('kuerzel').value = value || '';
      codeChips.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.value === input('kuerzel').value));
    };

    const update = () => {
      const start = parseClock(input('beginn').value);
      const end = parseClock(input('ende').value);
      const pause = parseClock(input('pause').value) ?? 0;
      let text = '–';
      let label = 'Stunden an diesem Tag';
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
          if (net > 9 * 60 && pause < 45) { label = 'Pause zu kurz – mind. 45 Min. (ArbZG)'; bad = true; }
          else if (net > 6 * 60 && pause < 30) { label = 'Pause zu kurz – mind. 30 Min. (ArbZG)'; bad = true; }
        }
      } else if (input('kuerzel').value) {
        const chip = codeChips.querySelector('button.on');
        text = chip ? chip.textContent.trim() : input('kuerzel').value;
      }
      out('duration').textContent = text;
      out('resultLabel').textContent = label;
      out('result').classList.toggle('invalid', bad);
    };

    const blockReason = (emp, date) => {
      if (date > data.today) return 'Dieser Tag liegt in der Zukunft.';
      if (data.locked) return 'Dieser Monat ist abgeschlossen.';
      if (data.minDate && date < data.minDate) return 'Einträge älterer Monate kann nur der Chef ändern.';
      if (emp.needsSignature) return 'Bitte zuerst unter „Einstellungen“ Ihre Unterschrift hinterlegen.';
      return '';
    };

    const open = (userId, date) => {
      const emp = data.employees[userId];
      if (!emp || !date) return;
      const entry = emp.entries[date];
      form.action = emp.save;
      deleteBtn.formAction = emp.remove;
      input('datum').value = date;
      out('name').textContent = emp.name;
      out('day').textContent = dayTitle(date);
      input('beginn').value = entry?.beginn ?? '';
      input('ende').value = entry?.ende ?? '';
      input('bemerkung').value = entry?.bemerkung ?? '';
      setPause(entry?.pause ?? '0:00');
      setCode(entry?.kuerzel ?? '');
      deleteBtn.classList.toggle('hidden', !entry);

      const recent = out('recent');
      recent.replaceChildren();
      for (const r of emp.recent) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = `${r.beginn}–${r.ende}${r.pause !== '0:00' ? ` · ${r.pause} P.` : ''}`;
        b.addEventListener('click', () => {
          input('beginn').value = r.beginn;
          input('ende').value = r.ende;
          setPause(r.pause);
          update();
        });
        recent.append(b);
      }
      out('recentWrap').classList.toggle('hidden', !emp.recent.length);

      const reason = blockReason(emp, date);
      out('block').textContent = reason;
      out('block').classList.toggle('hidden', !reason);
      form.querySelectorAll('.dlg-body input, .dlg-body button, .dlg-body select, .dlg-foot button')
        .forEach((el) => { el.disabled = !!reason; });

      update();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
    };

    const close = () => (typeof dialog.close === 'function' ? dialog.close() : dialog.removeAttribute('open'));

    pauseChips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => { setPause(b.dataset.value); update(); }));
    morePause.addEventListener('change', () => { if (morePause.value) { setPause(morePause.value); update(); } });
    codeChips.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      setCode(input('kuerzel').value === b.dataset.value ? '' : b.dataset.value);
      update();
    }));
    ['beginn', 'ende'].forEach((n) => ['input', 'change'].forEach((ev) => input(n).addEventListener(ev, update)));
    form.querySelector('[data-dialog-close]').addEventListener('click', close);
    dialog.addEventListener('click', (e) => { if (e.target === dialog) close(); });
    form.addEventListener('submit', (e) => {
      const deleting = e.submitter === deleteBtn;
      if (!deleting && !input('beginn').value && !input('ende').value && !input('kuerzel').value) {
        e.preventDefault();
        out('block').textContent = 'Bitte von–bis eintragen oder ein Kürzel wählen.';
        out('block').classList.remove('hidden');
        return;
      }
      saveBtn.disabled = true;
      deleteBtn.disabled = true;
      // Der gedrückte Knopf ist deaktiviert – formaction deshalb selbst übernehmen.
      if (deleting) form.action = deleteBtn.formAction;
    });

    document.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-open-entry]');
      if (!trigger || trigger.disabled) return;
      e.preventDefault();
      open(trigger.dataset.user, trigger.dataset.date);
    });

    // Auf dem Handy die eigene Spalte der Einsatzliste ins Bild scrollen.
    const own = document.querySelector('.roster-table td.name.own');
    if (own) {
      const scroller = own.closest('.paper-scroll');
      if (scroller && scroller.scrollWidth > scroller.clientWidth) {
        scroller.scrollLeft = own.offsetLeft - scroller.clientWidth / 2 + own.offsetWidth / 2 + own.closest('table').offsetLeft;
      }
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
