import { describe, expect, it } from 'vitest';
import { PATTERN_LINES, PATTERN_OPEN_CROP } from './brandPattern';

describe('PATTERN_OPEN_CROP', () => {
  it('leaves no band ending inside the window: every one runs off an edge', () => {
    const [x, y, w, h] = PATTERN_OPEN_CROP;
    for (const [x1, y1, x2, y2] of PATTERN_LINES) {
      for (const [px, py] of [
        [x1, y1],
        [x2, y2],
      ] as const) {
        const inside = px > x && px < x + w && py > y && py < y + h;
        expect(inside, `band end (${px}, ${py})`).toBe(false);
      }
    }
  });
});
