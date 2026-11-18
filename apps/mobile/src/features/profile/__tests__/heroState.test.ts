import { describe, expect, it } from 'vitest';
import { HERO_GAP, HERO_T, heroGeo, heroState, mixColor } from '../heroState';

const geo = (hasPhoto: boolean) => heroGeo({ W: 393, top: 59, frameInset: 4, hasPhoto });
const NAME = 150;
const LINE = 210;
const grid = (n: number) => Array.from({ length: n + 1 }, (_, i) => i / n);

describe('heroState', () => {
  for (const hasPhoto of [true, false]) {
    const g = geo(hasPhoto);
    const label = hasPhoto ? 'with a photo' : 'with the letter band';
    const at = (S: number, P: number) => heroState(S, P, g, NAME, LINE);

    it(`${label}: at rest the iris covers the whole band`, () => {
      const s = at(0, 0);
      expect(s.clipSize / 2).toBeGreaterThanOrEqual(Math.hypot(g.W / 2, g.H0 / 2));
      expect(s.boxH).toBe(g.H0);
      expect(s.heroH).toBe(g.H0 + HERO_GAP);
      expect(s.avatarOpacity).toBe(0);
      expect(s.tone).toBe(0);
    });

    it(`${label}: once landed the iris is the photo's circle, framed by the avatar`, () => {
      const s = at(0, 1);
      expect(s.clipSize / 2).toBeCloseTo(g.inner / 2, 5);
      expect(s.clipTop + s.clipSize / 2).toBeCloseTo(g.circleTop + g.circle / 2, 5);
      expect(s.clipStart + s.clipSize / 2).toBeCloseTo(g.W / 2, 5);
      expect(s.heroH).toBe(g.H1);
      expect(s.avatarOpacity).toBe(1);
      expect(s.tone).toBe(1);
    });

    it(`${label}: the iris only ever closes as the flight plays`, () => {
      let last = Infinity;
      for (const P of grid(100)) {
        const size = at(0, P).clipSize;
        expect(size).toBeLessThanOrEqual(last + 1e-9);
        last = size;
      }
    });

    it(`${label}: the phone line never touches the first row while the page is near the top`, () => {
      for (const P of grid(40)) {
        for (let S = 0; S <= HERO_T; S += 1) {
          const s = at(S, P);
          const rowsTop = s.heroH - S;
          expect(rowsTop - (s.lineTop + 16)).toBeGreaterThanOrEqual(0);
        }
      }
    });

    it(`${label}: once landed, the circle and the texts move 1:1 with the page`, () => {
      const a = at(HERO_T, 1);
      const b = at(HERO_T + 100, 1);
      expect(b.avatarTop - a.avatarTop).toBeCloseTo(-100, 5);
      expect(b.nameTop - a.nameTop).toBeCloseTo(-100, 5);
      expect(b.lineTop - a.lineTop).toBeCloseTo(-100, 5);
      expect(b.heroH).toBe(a.heroH);
      // ...and the first row keeps the same distance under the phone line.
      const gapA = a.heroH - HERO_T - (a.lineTop + 16);
      const gapB = b.heroH - (HERO_T + 100) - (b.lineTop + 16);
      expect(gapB).toBeCloseTo(gapA, 5);
      expect(gapB).toBeGreaterThanOrEqual(6 + HERO_GAP);
    });

    it(`${label}: a pull stretches the band and leaves the layout alone`, () => {
      const rest = at(0, 0);
      const pulled = at(-100, 0);
      expect(pulled.full - rest.full).toBe(100);
      expect(pulled.heroH).toBe(rest.heroH);
      expect(pulled.nameTop - rest.nameTop).toBe(100);
      // The rows ride down with the bounce, so the band ends exactly where they start.
      expect(pulled.boxH).toBe(pulled.full);
    });

    it(`${label}: no value is ever NaN`, () => {
      for (const P of grid(10)) {
        for (let S = -300; S <= 400; S += 7) {
          for (const v of Object.values(at(S, P))) expect(Number.isFinite(v)).toBe(true);
        }
      }
    });

    it(`${label}: the face (or the letter) lands at the middle of the window`, () => {
      const s = at(0, 1);
      const focalY = s.ty + s.scale * g.H0 * g.fyFrac;
      expect(focalY).toBeCloseTo(s.clipTop + s.clipSize / 2, 5);
    });

    it(`${label}: the content never zooms while the page scrolls: only a pull stretches it`, () => {
      for (const P of grid(10)) {
        for (let S = 0; S <= 300; S += 10) expect(at(S, P).scale).toBe(1);
      }
      expect(at(-90, 0).scale).toBeGreaterThan(1);
      expect(at(-90, 1).scale).toBe(1);
    });
  }
});

describe('the flight, frame by frame', () => {
  for (const hasPhoto of [true, false]) {
    const g = geo(hasPhoto);
    it(`${hasPhoto ? 'photo' : 'letter band'}: the corners are clear of the iris for the last of the opening`, () => {
      const corner = Math.hypot(g.W / 2, g.H0 / 2);
      expect(heroState(0, 0, g, NAME, LINE).clipSize / 2).toBeGreaterThan(corner);
      // 8% of the way in the band is still a plain rectangle.
      expect(heroState(0, 0.08, g, NAME, LINE).clipSize / 2).toBeGreaterThanOrEqual(corner);
    });

    it(`${hasPhoto ? 'photo' : 'letter band'}: the texts are white only while they sit inside the iris`, () => {
      for (const P of grid(100)) {
        const s = heroState(0, P, g, NAME, LINE);
        const cx = g.W / 2;
        const cy = s.clipTop + s.clipSize / 2;
        const r = s.clipSize / 2;
        const nameCentre = [s.nameStart + NAME / 2, s.nameTop + 14] as const;
        const inside = Math.hypot(nameCentre[0] - cx, nameCentre[1] - cy) < r - 10;
        if (s.tone === 0) expect(inside).toBe(true);
        if (!inside) expect(s.tone).toBeGreaterThan(0);
      }
    });
  }
});

describe('mixColor', () => {
  it('blends two hex colours and keeps one format', () => {
    expect(mixColor('#ffffff', '#000000', 0.5)).toBe('rgba(128,128,128,1)');
    expect(mixColor('#fff', '#172c4f', 1, 0.5)).toBe('rgba(23,44,79,0.5)');
  });
  it('falls back to the end colour when one is not a hex', () => {
    expect(mixColor('rgba(0,0,0,0.5)', '#102030', 0.3)).toBe('rgba(16,32,48,1)');
  });
});
