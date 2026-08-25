#!/usr/bin/env node
// Writes the LOCAL storage placeholders referenced by fixtures/menu.sql (photo_path) into
// packages/db/supabase/buckets/menu-media/ — the folder `objects_path` in supabase/config.toml
// seeds into the `menu-media` bucket on `supabase start` / `db reset`. Fixture-only: real
// photos are uploaded by the operator app (items/{id}/{ulid}.webp).
//
// Each file is a hand-encoded 256x256 8-bit RGB PNG (no deps): solid Touch Blue with a
// lighter centre square, ~1-3 KB after deflate. `--blur` prints the 4x4 data-URI pasted as
// `photo_blur` in menu.sql instead of writing files (keeps the literal reproducible).
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(root, 'supabase', 'buckets', 'menu-media');

// Touch Cafe palette — keep in sync with packages/ui/src/tokens/palette.ts (cafePalette).
const BLUE = [0x33, 0x60, 0xab];
const BLUE_LIGHT = [0x6c, 0x93, 0xd6];

// Must match fixtures/menu.sql photo_path values exactly.
const TARGETS = [
  'items/f1f70000-0000-4000-8000-00000000e002/fixture.png', // Cappuccino
  'items/f1f70000-0000-4000-8000-00000000e019/fixture.png', // Beef Burger
  'items/f1f70000-0000-4000-8000-00000000e023/fixture.png', // Kunafa
  'categories/f1f70000-0000-4000-8000-00000000ca01/fixture.png', // Hot Drinks
];

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
function png(size, pixel) {
  const stride = 1 + size * 3;
  const raw = Buffer.alloc(size * stride);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // filter type: none
    for (let x = 0; x < size; x++) raw.set(pixel(x, y), y * stride + 1 + x * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolour (RGB)
  // [10..12] compression / filter / interlace = 0
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
// Lighter square covering the middle half of the canvas.
const centreSquare = (size) => (x, y) => {
  const q = size / 4;
  return x >= q && x < size - q && y >= q && y < size - q ? BLUE_LIGHT : BLUE;
};

if (process.argv.includes('--blur')) {
  console.log(`data:image/png;base64,${png(4, centreSquare(4)).toString('base64')}`);
} else {
  for (const rel of TARGETS) {
    const file = join(OUT, ...rel.split('/'));
    mkdirSync(dirname(file), { recursive: true });
    const buf = png(256, centreSquare(256));
    writeFileSync(file, buf);
    console.log(`[make-placeholders] ${rel} (${buf.length} bytes)`);
  }
}
