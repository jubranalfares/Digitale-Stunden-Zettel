// Synthetische Unterschrift ausschließlich für automatisierte Tests.
import zlib from 'node:zlib';

// ---- kleine PNG-Unterschrift erzeugen (ohne Zusatzbibliotheken) -------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function signaturePng(seedText) {
  const W = 360;
  const H = 120;
  const px = new Float32Array(W * H);
  const rand = rng([...seedText].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7));
  const loops = 6 + Math.floor(rand() * 4);
  const phase = rand() * Math.PI * 2;
  const stamp = (cx, cy, r) => {
    for (let y = Math.floor(cy - r - 1); y <= cy + r + 1; y++) {
      for (let x = Math.floor(cx - r - 1); x <= cx + r + 1; x++) {
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        const a = Math.max(0, Math.min(1, r + 0.5 - d));
        px[y * W + x] = Math.max(px[y * W + x], a);
      }
    }
  };
  let prev = null;
  for (let t = 0; t <= 1; t += 0.0004) {
    const env = Math.sin(Math.PI * Math.min(1, t * 1.15));
    const x = 18 + t * 300 + 14 * Math.cos(2 * Math.PI * loops * t + phase);
    const y = 64 - 22 * env * Math.sin(2 * Math.PI * loops * t + phase) - 10 * Math.sin(Math.PI * 2 * t);
    if (prev) {
      const steps = Math.ceil(Math.hypot(x - prev[0], y - prev[1]) * 2);
      for (let i = 1; i <= steps; i++) {
        stamp(prev[0] + ((x - prev[0]) * i) / steps, prev[1] + ((y - prev[1]) * i) / steps, 1.5);
      }
    }
    prev = [x, y];
  }
  for (let x = 40; x < 330; x += 0.5) stamp(x, 96 + 4 * Math.sin(x / 40), 1.1);

  const raw = Buffer.alloc((W * 4 + 1) * H);
  for (let y = 0; y < H; y++) {
    raw[y * (W * 4 + 1)] = 0;
    for (let x = 0; x < W; x++) {
      const o = y * (W * 4 + 1) + 1 + x * 4;
      raw[o] = 20; raw[o + 1] = 32; raw[o + 2] = 110; raw[o + 3] = Math.round(px[y * W + x] * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return `data:image/png;base64,${png.toString('base64')}`;
}
