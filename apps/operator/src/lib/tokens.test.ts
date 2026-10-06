import { describe, expect, it } from 'vitest';
import { operatorBlueVars, operatorVars } from '@touch/ui';

// apps/operator/CLAUDE.md "i18n and styling": every new colour token needs a
// blue-mode value in operatorBlue.ts. The coaching lesson family
// (docs/design/coaching/operator.md §5.8, §1.11) is pinned here so a later
// edit cannot leave lesson tiles painted in paper colours on the blue page.

const paper = operatorVars as Record<string, string>;
const blue = operatorBlueVars as Record<string, string>;

describe('lesson tokens (coaching operator.md §5.8)', () => {
  const lessonNames = Object.keys(paper).filter((name) => name.startsWith('--tp-lesson'));

  it('declares the two lesson tokens on paper', () => {
    expect(lessonNames.sort()).toEqual(['--tp-lesson', '--tp-lesson-soft']);
  });

  it('gives every --tp-lesson* token a blue-mode value', () => {
    for (const name of lessonNames) {
      expect(blue[name], name).toBeTruthy();
      expect(blue[name], name).not.toBe(paper[name]);
    }
  });

  it('keeps the lesson hue (318) on paper, clear of the accent, green, warn and danger hues', () => {
    expect(paper['--tp-lesson']).toMatch(/ 318\)$/);
    expect(paper['--tp-lesson-soft']).toMatch(/ 318\)$/);
  });
});

describe('tournament tokens (tournaments build contracts §1.11)', () => {
  const names = Object.keys(paper).filter((name) => name.startsWith('--tp-tournament'));

  it('declares the two tournament tokens on paper, each with a blue-mode value', () => {
    expect(names.sort()).toEqual(['--tp-tournament', '--tp-tournament-soft']);
    for (const name of names) {
      expect(blue[name], name).toBeTruthy();
      expect(blue[name], name).not.toBe(paper[name]);
    }
  });

  it('keeps the tournament hue (195) on paper, clear of the lesson violet', () => {
    expect(paper['--tp-tournament']).toMatch(/ 195\)$/);
    expect(paper['--tp-tournament-soft']).toMatch(/ 195\)$/);
  });
});
