import { parseClock as readClock, parseDuration as readDuration, parseRosterInput as readRoster } from './time-input.js';

(() => {
  'use strict';

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

  // Direkt im Formular schreiben; Wechsel warten auf bestätigte Speichervorgänge.
  const heft = document.querySelector('[data-heft]');
  if (heft) {
    const csrf = heft.dataset.csrf;
    const toastEl = document.querySelector('[data-toast]');
    const editors = [];
    let toastTimer;
    let queue = Promise.resolve();
    let outstanding = 0;
    const fmt = (min, clock = false) => min == null ? '' :
      `${String(Math.floor(min / 60)).padStart(clock ? 2 : 1, '0')}:${String(min % 60).padStart(2, '0')}`;
    const toast = (message, kind = 'ok') => {
      toastEl.textContent = message;
      toastEl.className = `toast show toast-${kind}`;
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => toastEl.classList.remove('show'), kind === 'ok' ? 3000 : 7000);
    };
    const send = (payload) => {
      outstanding++;
      const run = async () => {
        let res;
        try {
          res = await fetch('/eintrag', {
            method: 'POST', body: new URLSearchParams({ ...payload, _csrf: csrf }),
            headers: { Accept: 'application/json' }, redirect: 'manual', keepalive: true,
          });
        } catch { throw new Error('Keine Verbindung. Ihre Eingabe bleibt hier stehen – erneut aus der Zeile tippen versucht es wieder.'); }
        let data;
        try { data = await res.json(); } catch { throw new Error('Bitte erneut anmelden. Die Eingabe wurde noch nicht gespeichert.'); }
        if (!res.ok) throw new Error(data.error || 'Speichern fehlgeschlagen.');
        return data;
      };
      const p = queue.then(run).finally(() => outstanding--);
      queue = p.catch(() => {});
      return p;
    };
    const setSignature = (key, sig) => {
      document.querySelectorAll(`[data-sig-img="${key}"]`).forEach((img) => {
        if (sig) img.src = `/signatur/${sig.id}.png`;
        else img.removeAttribute('src');
        img.hidden = !sig;
      });
      document.querySelectorAll(`[data-sig-date="${key}"]`).forEach((el) => { el.textContent = sig?.date ?? ''; });
    };
    const savedMessage = (data) => `✓ Gespeichert · Monatssumme ${data.total || '0:00'} Std.`;

    // Ein Editor repräsentiert eine Zeile bzw. eine Einsatzlistenzelle.
    // Antworten normalisieren nur genau die Eingabe, die tatsächlich gesendet wurde.
    const editor = ({ root, snapshot, parse, apply, errorClass, savingClass }) => {
      let saved = snapshot();
      const pending = new Map();
      const markError = (message) => {
        root.classList.toggle(errorClass, !!message);
        root.querySelectorAll('input,select').forEach((f) => f.setAttribute('aria-invalid', String(!!message)));
        if (message) toast(message, 'error');
      };
      const commit = () => {
        const value = snapshot();
        if (pending.has(value)) return pending.get(value);
        if (value === saved && pending.size === 0) { markError(''); return Promise.resolve(true); }
        let payload;
        try { payload = parse(); } catch (err) { markError(err.message); return Promise.resolve(false); }
        markError('');
        root.classList.add(savingClass);
        const p = send(payload).then((data) => {
          const stillSame = snapshot() === value;
          const canonical = apply(data, stillSame);
          saved = stillSame ? snapshot() : canonical;
          toast(savedMessage(data));
          return true;
        }).catch((err) => { markError(err.message); return false; }).finally(() => {
          pending.delete(value);
          if (!pending.size) root.classList.remove(savingClass);
        });
        pending.set(value, p);
        return p;
      };
      root.addEventListener('input', () => markError(''));
      const item = { commit, dirty: () => snapshot() !== saved || pending.size > 0, root };
      editors.push(item);
      return item;
    };

    const FIELDS = ['beginn', 'pause', 'ende', 'kuerzel', 'bemerkung'];
    const rows = [...document.querySelectorAll('tr[data-row]')];
    rows.forEach((tr, index) => {
      const fields = Object.fromEntries(FIELDS.map((n) => [n, tr.querySelector(`[name="${n}"]`)]));
      const item = editor({
        root: tr, errorClass: 'row-error', savingClass: 'row-saving',
        snapshot: () => JSON.stringify(FIELDS.map((n) => fields[n].value)),
        parse: () => {
          const start = readClock(fields.beginn.value, 'Beginn');
          const end = readClock(fields.ende.value, 'Ende');
          const pause = readDuration(fields.pause.value);
          if ((start == null) !== (end == null)) throw new Error(start == null ? 'Beginn fehlt noch.' : 'Ende fehlt noch.');
          return { user: tr.dataset.user, datum: tr.dataset.date, beginn: fmt(start, true),
            ende: fmt(end, true), pause: pause ? fmt(pause) : '',
            kuerzel: fields.kuerzel.value, bemerkung: fields.bemerkung.value };
        },
        apply: (data, stillSame) => {
          if (stillSame) FIELDS.forEach((n) => { fields[n].value = data.row[n]; });
          tr.querySelector('[data-out="dauer"]').textContent = data.row.dauer;
          const rec = tr.querySelector('[data-out="aufgezeichnet"]');
          rec.textContent = data.row.aufgezeichnet;
          if (data.row.ag) rec.append(' ', Object.assign(document.createElement('small'), { textContent: 'AG' }));
          const agNote = document.querySelector('[data-ag-note]');
          if (agNote) agNote.hidden = !document.querySelector('[data-out="aufgezeichnet"] small');
          document.querySelectorAll('[data-out="total"]').forEach((el) => { el.textContent = data.total; });
          setSignature('employee', data.employeeSignature);
          setSignature('employer', data.employerSignature);
          return JSON.stringify(FIELDS.map((n) => data.row[n]));
        },
      });
      tr.addEventListener('focusout', (e) => { if (!tr.contains(e.relatedTarget)) item.commit(); });
      tr.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        item.commit();
        const next = rows[index + 1]?.querySelector(`[name="${e.target.name}"]`);
        if (next) next.focus();
        else e.target.blur();
      });
    });

    const renderCell = (view, cell) => {
      view.replaceChildren();
      if (!cell) return;
      const text = Object.assign(document.createElement('div'), { className: 'rc-text' });
      text.style.fontSize = `calc(var(--pt) * ${cell.duration ? 8.5 : 9})`;
      if (cell.duration) text.append(Object.assign(document.createElement('span'), { textContent: cell.duration }));
      if (cell.code) text.append(Object.assign(document.createElement('span'), {
        className: `rc-code ${cell.duration ? '' : 'only'}`, textContent: cell.code,
      }));
      view.append(text);
      if (cell.signatureId) view.append(Object.assign(document.createElement('img'), { src: `/signatur/${cell.signatureId}.png`, alt: 'Unterschrift' }));
      else if (cell.ag) view.append(Object.assign(document.createElement('span'), { className: 'rc-ag', textContent: 'AG' }));
    };
    const cells = [...document.querySelectorAll('input[data-cell]')];
    cells.forEach((input) => {
      const td = input.closest('td');
      const item = editor({
        root: td, errorClass: 'cell-error', savingClass: 'cell-saving', snapshot: () => input.value,
        parse: () => {
          readRoster(input.value); // Sofortiges Feedback, dieselbe Prüfung erfolgt serverseitig.
          return { user: input.dataset.user, datum: input.dataset.date, einsatz: input.value };
        },
        apply: (data, stillSame) => {
          const raw = data.cell?.raw ?? '';
          if (stillSame) input.value = raw;
          renderCell(td.querySelector('[data-cell-view]'), data.cell);
          document.querySelectorAll(`[data-sum-user="${input.dataset.user}"]`).forEach((el) => { el.textContent = data.total; });
          setSignature('roster-employer', data.rosterEmployerSignature);
          return raw;
        },
      });
      input.addEventListener('focus', () => input.select());
      input.addEventListener('blur', item.commit);
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        item.commit();
        const column = cells.filter((c) => c.dataset.user === input.dataset.user);
        const next = column[column.indexOf(input) + 1];
        if (next) next.focus(); else input.blur();
      });
    });

    const flush = async () => {
      const results = await Promise.all(editors.filter((e) => e.dirty()).map((e) => e.commit()));
      await queue;
      if (results.includes(false) || editors.some((e) => e.dirty())) {
        toast('Noch nicht gespeichert. Bitte die markierte Eingabe prüfen oder erneut versuchen.', 'error');
        return false;
      }
      return true;
    };
    document.addEventListener('click', async (event) => {
      const link = event.target.closest('a[href]');
      if (!link || event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || link.getAttribute('href').startsWith('#')) return;
      const pdf = link.hasAttribute('data-pdf');
      if (!pdf && !outstanding && !editors.some((e) => e.dirty())) return;
      event.preventDefault();
      if (link.dataset.busy) return;
      link.dataset.busy = '1';
      try {
        if (!await flush()) return;
        if (!pdf) { location.assign(url.href); return; }
        const res = await fetch(url.href, { headers: { Accept: 'application/pdf' } });
        if (!res.ok || !res.headers.get('content-type')?.startsWith('application/pdf')) throw new Error('PDF konnte nicht erstellt werden. Bitte erneut anmelden oder noch einmal versuchen.');
        const href = URL.createObjectURL(await res.blob());
        const download = Object.assign(document.createElement('a'), { href, download: `Stundenzettel_${url.searchParams.get('monat')}.pdf` });
        download.click();
        setTimeout(() => URL.revokeObjectURL(href), 60000);
      } catch (err) { toast(err.message, 'error'); }
      finally { delete link.dataset.busy; }
    });
    document.querySelectorAll('form[action="/logout"]').forEach((form) => {
      let ready = false;
      form.addEventListener('submit', async (event) => {
        if (ready) return;
        event.preventDefault();
        if (await flush()) { ready = true; form.requestSubmit(); }
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') editors.filter((e) => e.dirty()).forEach((e) => e.commit());
    });
    document.querySelectorAll('[data-scroll]').forEach((scroller) => {
      if (scroller.scrollWidth <= scroller.clientWidth) return;
      const target = scroller.querySelector('td.name.own') ?? scroller.querySelector('table');
      if (!target) return;
      const left = target.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
      scroller.scrollLeft = target.matches('td') ? left - (scroller.clientWidth - target.offsetWidth) / 2 : left - 8;
    });
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
