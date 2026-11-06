import { describe, expect, it } from 'vitest';
import { revealOffset } from '../keyboardReveal';

const base = { below: 88, offset: 0, frame: 800, keyboard: 300 };

describe('revealOffset', () => {
  it('leaves a field with room to spare alone', () => {
    expect(revealOffset({ ...base, fieldBottom: 200 })).toBeNull();
  });
  it('scrolls down so the button under the field shows', () => {
    // visible = 500; field bottom 520 + 88 below = 608 > 500
    expect(revealOffset({ ...base, fieldBottom: 520 })).toBe(108);
  });
  it('never scrolls up', () => {
    expect(revealOffset({ ...base, fieldBottom: 520, offset: 400 })).toBeNull();
  });
  it('counts only the covered part of the frame (window resize = 0)', () => {
    expect(revealOffset({ ...base, keyboard: 0, fieldBottom: 760 })).toBe(48);
  });
  it('ignores a frame the keyboard fills', () => {
    expect(revealOffset({ ...base, frame: 300, fieldBottom: 100 })).toBeNull();
  });
});
