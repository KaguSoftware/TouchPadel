import { describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  QR_BOX,
  QR_INK,
  QR_PAPER,
  QR_X,
  QR_Y,
  QUIET_MODULES,
  DEFAULT_GUEST_SITE_URL,
  cardLayout,
  guestTableUrl,
  resolveGuestSiteUrl,
  numberSize,
  qrModules,
  qrPath,
} from './qrCardGeometry';

const URL = 'https://touchcafe.iq/t/abcdef0123456789.1.signature';
/**
 * Real token shapes at the production origin. 0014 encoded the uuid and the
 * signature as TEXT and came to 138 characters; 0071 encodes the same
 * information as bytes and comes to 35.
 */
const LEGACY_TOKEN =
  'ZTNmMWEyYjQtNWM2ZC00ZTdmLThhOWItMGMxZDJlM2Y0YTViLjMuOWYyYzdhMTBiNGU2ZDM4MDUyZmExY2JlNzdkMDQ5YTMzMTZlZDhiNWMwMmY0OTE3YWU2YjNkODEwMmNmNTRlNw';
const COMPACT_TOKEN = '4_GitFxtTn-KmwwdLj9KW6QffAK-WdMUCGc';
const legacyUrl = `https://touch-padel.com/t/${LEGACY_TOKEN}`;
const compactUrl = `https://touch-padel.com/t/${COMPACT_TOKEN}`;

/** Rebuild the module grid from the path, so runs are checked against truth. */
function gridFromPath(d: string, size: number): Uint8Array {
  const grid = new Uint8Array(size * size);
  for (const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
    const [x, y, run, back] = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])];
    expect(back).toBe(run); // the rect must close on itself
    for (let i = 0; i < run; i++) grid[y * size + x + i] = 1;
  }
  return grid;
}

describe('qrPath', () => {
  it('covers exactly the dark modules, as horizontal runs', () => {
    const modules = qrModules(URL);
    const { d, size } = qrPath(modules);
    expect(size).toBe(modules.size);
    // Nothing but run rects in the path.
    expect((d.match(/M\d+ \d+h\d+v1h-\d+z/g) ?? []).join('')).toBe(d);
    const grid = gridFromPath(d, size);
    let dark = 0;
    for (let i = 0; i < size * size; i++) {
      expect(grid[i]).toBe(modules.data[i] ? 1 : 0);
      if (modules.data[i]) dark++;
    }
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(size * size);
  });

  it('merges runs instead of emitting a square per module', () => {
    const modules = qrModules(URL);
    const { d } = qrPath(modules);
    const rects = (d.match(/M\d+ \d+h\d+v1h-\d+z/g) ?? []).length;
    let dark = 0;
    for (let i = 0; i < modules.size * modules.size; i++) if (modules.data[i]) dark++;
    // A real QR is full of finder patterns and timing runs; per-module squares
    // is the thing being fixed, so the path must be materially shorter.
    expect(rects).toBeLessThan(dark * 0.7);
  });

  it('0071 compact tokens land on a far coarser grid than 0014 text ones', () => {
    // The whole point of the compact token: fewer, bigger modules in the same
    // 56 mm box. If this ever inverts, the QR got harder to scan again.
    const legacy = qrModules(legacyUrl).size;
    const compact = qrModules(compactUrl).size;
    expect(legacy).toBe(53);
    expect(compact).toBe(33);
    // 1.06 mm -> 1.70 mm per module inside the card's 56 mm QR box.
    expect(QR_BOX / compact).toBeGreaterThan((QR_BOX / legacy) * 1.5);
  });

  it('prints the code in black on white, never a brand colour', () => {
    // cafePalette['--tp-accent-2'] was the cafe brown when this card was
    // written and is now #A5D06F, the brand green: 1.77:1 on white. The ink is
    // pinned here so a palette edit can never silently reach the QR again.
    expect(QR_INK).toBe('#000000');
    expect(QR_PAPER).toBe('#FFFFFF');
  });

  it('module count is size²', () => {
    const modules = qrModules(URL);
    expect(modules.data.length).toBe(modules.size * modules.size);
  });

  it('is deterministic for a fixed URL', () => {
    expect(qrPath(qrModules(URL))).toEqual(qrPath(qrModules(URL)));
    expect(qrPath(qrModules(URL)).d).not.toBe(qrPath(qrModules(`${URL}x`)).d);
  });
});

describe('cardLayout', () => {
  it('matches the qr-artwork.mjs A6 geometry', () => {
    expect(CARD_WIDTH).toBe(420);
    expect(CARD_HEIGHT).toBe(592);
    expect(QR_BOX).toBe(224);
    expect(QR_X).toBe(98);
    expect(QR_Y).toBe(258);
    expect(QUIET_MODULES).toBe(4);
    const l = cardLayout('12');
    expect(l.viewBox).toBe('0 0 420 592');
    expect(l.qrX).toBe(98);
    expect(l.scaleFor(25)).toBeCloseTo(224 / 33);
  });

  it('scales the number by digit count', () => {
    expect(numberSize('7')).toBe(96);
    expect(numberSize('12')).toBe(96);
    expect(numberSize('123')).toBe(72);
    expect(numberSize('T-10')).toBe(72);
    expect(numberSize('VIP-1')).toBe(52);
    expect(cardLayout('VIP-1').numSize).toBe(52);
  });
});

describe('guestTableUrl', () => {
  it('joins origin and token, trimming trailing slashes', () => {
    expect(guestTableUrl('https://touchcafe.iq/', 'tok')).toBe('https://touchcafe.iq/t/tok');
    expect(guestTableUrl('https://touchcafe.iq', 'tok')).toBe('https://touchcafe.iq/t/tok');
  });
  it('is null when the site URL is unset (never print localhost by accident)', () => {
    expect(guestTableUrl(undefined, 'tok')).toBeNull();
    expect(guestTableUrl('  ', 'tok')).toBeNull();
  });
});

describe('resolveGuestSiteUrl — a printed card never opens localhost', () => {
  const LIVE = 'https://touch-padel-web.vercel.app';

  it('the default is the live guest site', () => {
    expect(DEFAULT_GUEST_SITE_URL).toBe(LIVE);
  });

  it.each([undefined, '', '   ', 'not a url at all ::'])('unset or unparseable (%j) falls back to the live site', (raw) => {
    expect(resolveGuestSiteUrl(raw, true)).toBe(LIVE);
    expect(resolveGuestSiteUrl(raw, false)).toBe(LIVE);
  });

  it.each([
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://0.0.0.0:3000',
    'http://[::1]:3000',
    'http://192.168.1.20:3000',
    'http://10.0.0.5',
    'http://172.20.1.1',
    'http://touch-desk.local',
  ])('a production build replaces %s with the live site', (raw) => {
    expect(resolveGuestSiteUrl(raw, true)).toBe(LIVE);
  });

  it('dev and e2e keep an explicit localhost (the local web app is the guest site there)', () => {
    expect(resolveGuestSiteUrl('http://localhost:3000', false)).toBe('http://localhost:3000');
  });

  it('keeps a real origin, upgrades http, drops the locale path and trailing slashes', () => {
    expect(resolveGuestSiteUrl('http://touch-padel-web.vercel.app/en/', true)).toBe(LIVE);
    expect(resolveGuestSiteUrl('touch-padel-web.vercel.app', true)).toBe(LIVE);
    expect(resolveGuestSiteUrl('https://touch-padel.com/', true)).toBe('https://touch-padel.com');
  });

  it('the card URL built from it is the live table link', () => {
    expect(guestTableUrl(resolveGuestSiteUrl('http://localhost:3000', true), COMPACT_TOKEN)).toBe(`${LIVE}/t/${COMPACT_TOKEN}`);
  });
});
