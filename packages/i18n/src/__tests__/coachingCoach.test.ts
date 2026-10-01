import { describe, expect, it } from 'vitest';
import { ar, en } from '../index';
import { coachingGlossary } from '../catalogs/coaching.glossary';

/**
 * `coaching.coach.*` (coach mode, docs/design/coaching/guest.md §4.15): the
 * glossary rule (C-30, R55) holds in every Arabic line — «حصة» is the lesson,
 * never «درس»; the court share and the coach's share are «أجرة الملعب» and
 * «نصيب المدرّب», never «حصة الملعب» / «حصة المدرّب» — and the money words
 * come from the glossary itself.
 */
const bare = (s: string): string => s.replace(/[ً-ْٰ]/g, '');
const FORBIDDEN = ['درس', 'حصة الملعب', 'حصة المدرب'].map(bare);

function leaves(obj: object, prefix = ''): [string, string][] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}${k}`, v] as [string, string]]
      : leaves(v as object, `${prefix}${k}.`),
  );
}

describe('coaching.coach', () => {
  it('is mounted under coaching in both catalogs', () => {
    expect(en.coaching.coach.home.title).toBe('Coach mode');
    expect(ar.coaching.coach.home.title).toBe(coachingGlossary.ar.coachMode);
  });

  it('never uses «درس», «حصة الملعب» or «حصة المدرّب» in Arabic', () => {
    for (const [key, value] of leaves(ar.coaching.coach)) {
      for (const word of FORBIDDEN) expect(bare(value), key).not.toContain(word);
    }
  });

  it('builds the statement money words from the glossary', () => {
    expect(ar.coaching.coach.statements.courtShare).toContain(coachingGlossary.ar.courtShare);
    expect(ar.coaching.coach.statements.coachShare).toContain(coachingGlossary.ar.coachShare);
    expect(en.coaching.coach.statements.courtShare.toLowerCase()).toContain(
      coachingGlossary.en.courtShare,
    );
    expect(en.coaching.coach.statements.coachShare.toLowerCase()).toContain(
      coachingGlossary.en.coachShare,
    );
  });

  it('gives every counted phrase its six forms in both languages', () => {
    for (const phrase of Object.values(en.coaching.coach.count)) {
      expect(Object.keys(phrase).sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
    }
    for (const phrase of Object.values(ar.coaching.coach.count)) {
      expect(Object.keys(phrase).sort()).toEqual(['few', 'many', 'one', 'other', 'two', 'zero']);
    }
  });
});
