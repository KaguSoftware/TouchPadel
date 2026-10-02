import { describe, expect, it } from 'vitest';
import { coachingGlossary } from '../catalogs/coaching.glossary';
import { coachingGlossary as fromIndex } from '../index';

/**
 * The one coaching glossary (C-30, R55, R72). «حصة» means "lesson", so the court share and the
 * coach's share can never be «حصة …», and «درس» is never the lesson word.
 */

/** Arabic text without its marks (shadda, harakat, tanwin, superscript alef), so «المدرب» and «المدرّب» compare equal. */
const bare = (s: string): string => s.replace(/[ً-ْٰ]/g, '');

const FORBIDDEN = ['درس', 'حصة الملعب', 'حصة المدرّب'].map(bare);

describe('coachingGlossary', () => {
  it('is exported from the package index', () => {
    expect(fromIndex).toBe(coachingGlossary);
  });

  it('has the same terms in English and Arabic, none empty', () => {
    const en = Object.keys(coachingGlossary.en).sort();
    expect(Object.keys(coachingGlossary.ar).sort()).toEqual(en);
    for (const value of [
      ...Object.values(coachingGlossary.en),
      ...Object.values(coachingGlossary.ar),
    ]) {
      expect(value.trim()).toBe(value);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  it('carries the three binding words of R55 and C-30', () => {
    expect(coachingGlossary.ar.lesson).toBe('حصة');
    expect(coachingGlossary.ar.courtShare).toBe('أجرة الملعب');
    expect(coachingGlossary.ar.coachShare).toBe('نصيب المدرّب');
    expect(coachingGlossary.en.courtShare).toBe('court share');
    expect(coachingGlossary.en.coachShare).toBe("coach's share");
  });

  it('never uses «درس», «حصة الملعب» or «حصة المدرّب», with or without marks', () => {
    for (const [term, value] of Object.entries(coachingGlossary.ar)) {
      for (const word of FORBIDDEN) {
        expect(bare(value), `${term}: ${value}`).not.toContain(word);
      }
    }
  });

  it('the forbidden check would catch them (the guard is not vacuous)', () => {
    for (const bad of ['درس خاص', 'حصة الملعب', 'حصة المدرب', 'حصّة المدرّب']) {
      expect(FORBIDDEN.some((w) => bare(bad).includes(w))).toBe(true);
    }
  });

  it('uses Arabic script for every Arabic word and Latin for every English one', () => {
    for (const value of Object.values(coachingGlossary.ar)) expect(value).toMatch(/^[؀-ۿ ]+$/);
    for (const value of Object.values(coachingGlossary.en)) expect(value).toMatch(/^[A-Za-z' -]+$/);
  });
});
