// Gemeinsame Helfer für die Routen.
export function currentMonthOf(today) {
  const [year, month] = today.split('-').map(Number);
  return { year, month };
}

export function asciiFileName(s) {
  return String(s)
    .replace(/[äÄ]/g, (c) => (c === 'ä' ? 'ae' : 'Ae'))
    .replace(/[öÖ]/g, (c) => (c === 'ö' ? 'oe' : 'Oe'))
    .replace(/[üÜ]/g, (c) => (c === 'ü' ? 'ue' : 'Ue'))
    .replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'datei';
}

export function sendPdf(res, buffer, fileName, disposition = 'inline') {
  res.set({
    'Content-Type': 'application/pdf',
    'Content-Disposition': `${disposition}; filename="${asciiFileName(fileName)}"`,
    'Cache-Control': 'private, no-store',
  });
  res.send(buffer);
}

// Akzeptiert nur PNG/JPEG-Data-URLs bis zur angegebenen Größe.
export function validImageDataUrl(value, { types = ['png'], maxBytes = 512 * 1024 } = {}) {
  const m = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(String(value ?? ''));
  if (!m || !types.includes(m[1])) return null;
  const bytes = Buffer.from(m[2], 'base64');
  if (bytes.length < 60 || bytes.length > maxBytes) return null;
  const isPng = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  if ((m[1] === 'png' && !isPng) || (m[1] === 'jpeg' && !isJpeg)) return null;
  return `data:image/${m[1]};base64,${bytes.toString('base64')}`;
}

export function sendDataUrl(res, dataUrl, cacheControl) {
  const m = /^data:([\w/+.-]+);base64,(.*)$/.exec(dataUrl);
  if (!m) return res.status(404).end();
  res.set({ 'Content-Type': m[1], 'Cache-Control': cacheControl });
  res.send(Buffer.from(m[2], 'base64'));
}
