import { describe, expect, it } from 'vitest';
import { ar } from '../catalogs/ar';
import { en } from '../catalogs/en';
import { coachingGlossary } from '../catalogs/coaching.glossary';
import { countPhrase, PLURAL_FORMS } from '../plural';
import { t } from '../t';

/**
 * `coaching.web` (docs/design/coaching/guest.md §4.14-§4.15): the website's coaching words. The
 * glossary rule (C-30, R55) holds here too, every counted key carries its six forms, and the
 * Arabic picks its plural by the count.
 */

/** Arabic text without its marks, so «المدرب» and «المدرّب» compare equal. */
const bare = (s: string): string => s.replace(/[ً-ْٰ]/g, '');
const FORBIDDEN = ['درس', 'دروس', 'حصة الملعب', 'حصة المدرّب'].map(bare);

const leaves = (obj: object, prefix = ''): [string, string][] =>
  Object.entries(obj).flatMap(([k, v]) =>
    typeof v === 'string'
      ? [[`${prefix}${k}`, v] as [string, string]]
      : leaves(v as object, `${prefix}${k}.`),
  );

describe('coaching.web', () => {
  it('mirrors English and Arabic key for key', () => {
    expect(
      leaves(ar.coaching.web)
        .map(([k]) => k)
        .sort(),
    ).toEqual(
      leaves(en.coaching.web)
        .map(([k]) => k)
        .sort(),
    );
  });

  it('never calls a lesson «درس», nor the court share or the coach’s share «حصة …»', () => {
    for (const [key, value] of leaves(ar.coaching.web)) {
      for (const word of FORBIDDEN) expect(bare(value), key).not.toContain(word);
    }
  });

  it('builds its lesson words from the glossary', () => {
    expect(ar.coaching.web.link.title).toContain(coachingGlossary.ar.lesson);
    expect(ar.coaching.web.kind.private).toContain(coachingGlossary.ar.lessons);
    expect(ar.coaching.web.priceCourse).toContain(coachingGlossary.ar.course);
  });

  it('carries the six plural forms on every counted key', () => {
    for (const key of Object.keys(
      en.coaching.web.count,
    ) as (keyof typeof en.coaching.web.count)[]) {
      expect(Object.keys(en.coaching.web.count[key]).sort(), key).toEqual([...PLURAL_FORMS].sort());
      expect(Object.keys(ar.coaching.web.count[key]).sort(), key).toEqual([...PLURAL_FORMS].sort());
    }
  });

  it('counts places, sessions and minutes in Arabic by the count', () => {
    const plain = (s: string) => s.replace(/[\u2066-\u2069]/g, '');
    expect(countPhrase('coaching.web.count.placesLeft', 0, 'ar')).toBe('لا أماكن متاحة');
    expect(countPhrase('coaching.web.count.placesLeft', 1, 'ar')).toBe('مكان واحد متاح');
    expect(countPhrase('coaching.web.count.placesLeft', 2, 'ar')).toBe('مكانان متاحان');
    expect(plain(countPhrase('coaching.web.count.placesLeft', 3, 'ar'))).toBe('3 أماكن متاحة');
    expect(plain(countPhrase('coaching.web.count.placesLeft', 11, 'ar'))).toBe('11 مكانًا متاحًا');
    expect(plain(countPhrase('coaching.web.count.sessions', 8, 'ar'))).toBe('8 حصص');
    expect(plain(countPhrase('coaching.web.count.minutes', 90, 'ar'))).toBe('90 دقيقة');
    expect(plain(countPhrase('coaching.web.count.minutes', 210, 'ar'))).toBe('210 دقائق');
    expect(plain(countPhrase('coaching.web.count.placesLeft', 3, 'en'))).toBe('3 places left');
    expect(countPhrase('coaching.web.count.placesLeft', 1, 'en')).toBe('1 place left');
  });

  it('names the footer link in both languages', () => {
    expect(t('en', 'site.footer.coaching')).toBe('Coaching');
    expect(t('ar', 'site.footer.coaching')).toBe('التدريب');
  });
});
