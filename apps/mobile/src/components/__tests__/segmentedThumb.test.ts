import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { insetStart, isFrame } from '../segmentedThumb';

const read = (p: string) => readFileSync(join(__dirname, '..', '..', '..', p), 'utf8');
const UI = read('src/components/ui.tsx');

/**
 * A three-option track 300 wide with 3 pt padding: segments of 98 at 3, 101
 * and 199. Under RTL the SAME layout comes back — Yoga mirrors the row, so
 * option 0 is the rightmost box and reports the largest x.
 */
const LTR: { x: number; width: number }[] = [
  { x: 3, width: 98 },
  { x: 101, width: 98 },
  { x: 199, width: 98 },
];
const RTL = [...LTR].reverse().map((f, i) => ({ x: f.x, width: LTR[i]!.width }));

describe('segmented thumb geometry', () => {
  it('is the physical x under LTR', () => {
    expect(LTR.map((f) => insetStart(f, 300, false))).toEqual([3, 101, 199]);
  });

  it('measures back from the track width under RTL', () => {
    // Option 0 sits at physical x 199 and is 98 wide, so its start edge is
    // 300 - 199 - 98 = 3 from the right — the mirror of the LTR offset.
    expect(RTL.map((f) => insetStart(f, 300, true))).toEqual([3, 101, 199]);
  });

  it('is symmetric: the same option lands the same distance from start', () => {
    for (let i = 0; i < LTR.length; i += 1) {
      expect(insetStart(RTL[i]!, 300, true)).toBe(insetStart(LTR[i]!, 300, false));
    }
  });

  it('rejects unmeasured segments so a hole never reaches an interpolation', () => {
    expect(isFrame(null)).toBe(false);
    expect(isFrame({ x: 0, width: 0 })).toBe(false);
    expect(isFrame({ x: 0, width: 1 })).toBe(true);
  });
});

/**
 * The thumb is anchored to `start` and walked with `translateX`, which has no
 * logical form: under RTL the sign must flip or the thumb slides off the track.
 */
describe('segmented control wiring', () => {
  it('anchors the thumb logically and negates the translate under RTL', () => {
    expect(UI).toMatch(/start:\s*0,/);
    expect(UI).toMatch(/translateX:\s*rtl\s*\?\s*Animated\.multiply\(thumb\.x,\s*-1\)\s*:\s*thumb\.x/);
  });

  it('holds still under Reduce Motion', () => {
    expect(UI).toMatch(/useReduceMotion\(\)/);
    expect(UI).toMatch(/reduceMotion\) \{\s*\n?\s*progress\.setValue/);
  });
});
