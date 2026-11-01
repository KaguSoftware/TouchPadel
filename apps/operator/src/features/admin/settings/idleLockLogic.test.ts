import { describe, expect, it } from 'vitest';
import { IDLE_LOCK_CHOICES, idleLockChoices, idleLockLabel, idleLockValid } from './idleLockLogic';

describe('idle-lock timeout choices (F-48)', () => {
  it('offers Never and one minute to an hour, all inside what the server takes (0..3600 s)', () => {
    expect(IDLE_LOCK_CHOICES[0]).toBe(0);
    expect(Math.max(...IDLE_LOCK_CHOICES)).toBe(3600);
    expect(IDLE_LOCK_CHOICES.every(idleLockValid)).toBe(true);
    expect(IDLE_LOCK_CHOICES).toContain(900);
  });

  it('keeps a stored value that is off the list, in order', () => {
    expect(idleLockChoices(900)).toEqual([...IDLE_LOCK_CHOICES]);
    expect(idleLockChoices(90)).toEqual([0, 60, 90, 120, 300, 600, 900, 1200, 1800, 2700, 3600]);
    // Nothing the server would refuse is ever offered.
    expect(idleLockChoices(9999)).toEqual([...IDLE_LOCK_CHOICES]);
    expect(idleLockChoices(-5)).toEqual([...IDLE_LOCK_CHOICES]);
  });

  it('reads a choice as never, minutes, or seconds for an odd one', () => {
    expect(idleLockLabel(0)).toEqual({ kind: 'never' });
    expect(idleLockLabel(900)).toEqual({ kind: 'minutes', minutes: 15 });
    expect(idleLockLabel(90)).toEqual({ kind: 'seconds', seconds: 90 });
  });

  it('refuses what app.set_cafe_setting would', () => {
    expect(idleLockValid(3601)).toBe(false);
    expect(idleLockValid(-1)).toBe(false);
    expect(idleLockValid(1.5)).toBe(false);
  });
});
