import { describe, expect, it } from 'vitest';
import {
  isUsernameShape,
  nextUsernameChange,
  normalizeUsername,
  stateFromCheck,
  usernameStateKey,
} from '../username';
import {
  badgeCentre,
  DEFAULT_FRAME,
  EARNED_FRAMES,
  FRAME_IDS,
  FREE_FRAMES,
  frameDrawing,
  frameNameKey,
  frameOf,
  frameRuleKey,
  step,
} from '../frames';

describe('usernames (0307)', () => {
  it('normalises like the server: trim, lower case, no leading @', () => {
    expect(normalizeUsername('  @Hassan.S ')).toBe('hassan.s');
    expect(normalizeUsername('   ')).toBe('');
  });

  it('holds the server grammar', () => {
    for (const ok of ['abc', 'hassan.s', 'h_2', 'a'.repeat(20), 'x9y']) expect(isUsernameShape(ok)).toBe(true);
    for (const bad of ['ab', 'a'.repeat(21), '.abc', 'abc.', '_abc', 'a..b', 'a__b', 'a._b', 'ab c', 'حسن', 'ABC'])
      expect(isUsernameShape(bad)).toBe(false);
  });

  it('reads the server check, telling the owner\'s own name apart', () => {
    expect(stateFromCheck(undefined, null)).toEqual({ kind: 'checking' });
    expect(stateFromCheck({ available: true, username: 'abc' }, 'xyz')).toEqual({ kind: 'available' });
    expect(stateFromCheck({ available: true, username: 'abc' }, 'abc')).toEqual({ kind: 'yours' });
    expect(stateFromCheck({ available: false, reason: 'taken' }, null)).toEqual({ kind: 'taken' });
    expect(stateFromCheck({ available: false, reason: 'reserved' }, null)).toEqual({ kind: 'reserved' });
    expect(stateFromCheck({ available: false, reason: 'invalid' }, null)).toEqual({ kind: 'invalid' });
    expect(usernameStateKey({ kind: 'empty' })).toBeNull();
    expect(usernameStateKey({ kind: 'taken' })).toBe('profile.usernameTaken');
  });

  it('allows the first username now, then once every 7 days', () => {
    const now = new Date('2026-10-06T12:00:00Z');
    expect(nextUsernameChange(null, null, now)).toBeNull();
    expect(nextUsernameChange('abc', '2026-10-04T12:00:00Z', now)?.toISOString()).toBe('2026-10-11T12:00:00.000Z');
    expect(nextUsernameChange('abc', '2026-09-28T12:00:00Z', now)).toBeNull();
  });
});

describe('frames (0307)', () => {
  it('is the server\'s closed list, six free then four earned', () => {
    expect(FRAME_IDS).toEqual([
      'brand-green', 'touch-blue', 'court-white', 'split-court', 'double-line',
      'court-lines', 'regular', 'silver-racket', 'gold-racket', 'champion',
    ]);
    expect(FREE_FRAMES).toHaveLength(6);
    expect(EARNED_FRAMES).toEqual(['regular', 'silver-racket', 'gold-racket', 'champion']);
  });

  it('draws an unknown id as the default', () => {
    expect(frameOf('night-match')).toBe(DEFAULT_FRAME);
    expect(frameOf(null)).toBe(DEFAULT_FRAME);
    expect(frameOf('gold-racket')).toBe('gold-racket');
  });

  it('names every frame and every earned rule', () => {
    expect(frameNameKey('brand-green')).toBe('profile.frameBrandGreen');
    expect(frameNameKey('silver-racket')).toBe('profile.frameSilverRacket');
    expect(frameRuleKey('gold-racket')).toBe('profile.frameRuleGoldRacket');
    expect(frameRuleKey('touch-blue')).toBeNull();
  });

  it('keeps today\'s ring for the default: 3 px at 84, 2.5 at 50 and 36', () => {
    expect(frameDrawing('brand-green', 84).inset).toBe(3);
    expect(frameDrawing('brand-green', 50).inset).toBe(2.5);
    expect(frameDrawing('brand-green', 36).inset).toBe(2.5);
  });

  it('interpolates widths between the fixed sizes, to half a pixel', () => {
    expect(step([3.5, 4, 5], 40)).toBe(3.5);
    expect(step([3.5, 4, 5], 67)).toBe(4.5);
  });

  it('gives earned frames a thicker ring and a badge; free frames none', () => {
    for (const id of FREE_FRAMES) expect(frameDrawing(id, 84).badge).toBeNull();
    for (const id of EARNED_FRAMES) {
      const d = frameDrawing(id, 84);
      expect(d.badge?.size).toBe(24);
      expect(d.inset).toBeGreaterThanOrEqual(5);
    }
    expect(frameDrawing('court-lines', 84).rings[0]!.dashes).toBe(12);
    expect(frameDrawing('court-lines', 36).rings[0]!.dashes).toBe(8);
  });

  it('puts the badge at the bottom end corner, mirrored in Arabic', () => {
    const ltr = badgeCentre(84, 5, 24, false);
    const rtl = badgeCentre(84, 5, 24, true);
    expect(ltr.y).toBe(rtl.y);
    expect(ltr.x).toBeGreaterThan(42);
    expect(rtl.x).toBeLessThan(42);
    expect(ltr.x + rtl.x).toBeCloseTo(84);
  });
});
