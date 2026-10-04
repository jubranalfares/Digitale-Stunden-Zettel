// Gemeinsame Eingaberegeln für Browser und Server, ohne Build-Schritt.
export class InputError extends Error {}

export function parseClock(value, label = 'Uhrzeit') {
  const s = String(value ?? '').trim();
  if (!s) return null;
  const m = /^(\d{1,2})(?:[:.,]?(\d{2}))?$/.exec(s);
  if (!m || Number(m[1]) > 23 || Number(m[2] ?? 0) > 59) {
    throw new InputError(`${label} „${s}“ ist ungültig (z. B. 12 oder 12:30).`);
  }
  return Number(m[1]) * 60 + Number(m[2] ?? 0);
}

export function parseDuration(value) {
  const s = String(value ?? '').trim();
  if (!s) return 0;
  let m = /^(\d{1,2})[:.](\d{2})$/.exec(s);
  if (m) {
    if (Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
    throw new InputError('Die Minuten der Pause müssen zwischen 00 und 59 liegen.');
  }
  if (/^\d$/.test(s)) return Number(s) * 60;
  if (/^\d{2}$/.test(s)) return Number(s);
  m = /^(\d{1,2})(\d{2})$/.exec(s);
  if (m && Number(m[2]) < 60) return Number(m[1]) * 60 + Number(m[2]);
  m = /^(\d{1,2}),(\d{1,2})$/.exec(s);
  if (m) return Math.round(Number(`${m[1]}.${m[2]}`) * 60);
  throw new InputError(`Pause „${s}“ ist ungültig (z. B. 30 oder 1:30).`);
}

export function parseRosterInput(value) {
  const s = String(value ?? '').trim();
  if (!s) return { beginn: '', ende: '', pause: '', kuerzel: '', bemerkung: '' };
  if (/^(K|U|UU|F|SA|SU)$/i.test(s)) return { beginn: '', ende: '', pause: '', kuerzel: s.toUpperCase() };
  const m = /^(\d{1,2}(?:[:.,]?\d{2})?)\s*(?:-|–|—|bis)\s*(\d{1,2}(?:[:.,]?\d{2})?)$/i.exec(s);
  if (!m) throw new InputError('Bitte z. B. 12-16 eintragen (oder U, K, F …).');
  parseClock(m[1], 'Beginn');
  parseClock(m[2], 'Ende');
  // Pause und Bemerkung bleiben erhalten, da sie nicht Teil der Eingabe sind.
  return { beginn: m[1], ende: m[2], kuerzel: '' };
}
