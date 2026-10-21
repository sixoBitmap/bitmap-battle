// Draws the app icon (a little bitmap district of orange blocks) as PNG files, with no image library.
import { mkdirSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const out = new URL('../apps/web/public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });

const BG = [11, 11, 20];
const COLORS = { o: [247, 147, 26], g: [255, 204, 51], w: [255, 241, 193], d: [184, 101, 10] };
// 16 x 16 cells; each letter a block colour, '.' background.
const ART = [
  '................',
  '................',
  '..oooooo.gggg...',
  '..oooooo.gggg...',
  '..oooooo.gggg...',
  '..oooooo.ww.dd..',
  '..oooooo.ww.dd..',
  '..oooooo........',
  '.........oooooo.',
  '..gggg.w.oooooo.',
  '..gggg...oooooo.',
  '..gggg.dd.oooo..',
  '..gggg.dd.oooo..',
  '...........oo...',
  '................',
  '................',
];

const table = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = table[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(body));
  return Buffer.concat([len, body, sum]);
};

function png(size) {
  const cell = size / 16;
  const radius = size * 0.2;
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const ch = ART[Math.floor(y / cell)][Math.floor(x / cell)];
      const inset = (x % cell) < cell * 0.08 || (y % cell) < cell * 0.08;
      let [r, g, b] = ch !== '.' && !inset ? COLORS[ch] : BG;
      const dx = Math.max(radius - x, x - (size - 1 - radius), 0);
      const dy = Math.max(radius - y, y - (size - 1 - radius), 0);
      const a = dx * dx + dy * dy > radius * radius ? 0 : 255;
      row.set([r, g, b, a], 1 + x * 4);
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(Buffer.concat(rows))),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

for (const size of [32, 96, 180, 192, 512]) writeFileSync(new URL(`icon-${size}.png`, out), png(size));
console.log('icons written');
