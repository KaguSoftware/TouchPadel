import { describe, expect, it } from 'vitest';
import {
  CARD_HEIGHT,
  CARD_WIDTH,
  QR_BOX,
  QR_X,
  QR_Y,
  QUIET_MODULES,
  cardLayout,
  guestTableUrl,
  numberSize,
  qrModules,
  qrPath,
} from './qrCardGeometry';

const URL = 'https://touchcafe.iq/t/abcdef0123456789.1.signature';

describe('qrPath', () => {
  it('emits only 1×1 squares and one per dark module', () => {
    const modules = qrModules(URL);
    const { d, size } = qrPath(modules);
    expect(size).toBe(modules.size);
    const squares = d.match(/M\d+ \d+h1v1h-1z/g) ?? [];
    expect(squares.join('')).toBe(d);
    let dark = 0;
    for (let i = 0; i < size * size; i++) if (modules.data[i]) dark++;
    expect(squares.length).toBe(dark);
    expect(dark).toBeGreaterThan(0);
    expect(dark).toBeLessThan(size * size);
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
