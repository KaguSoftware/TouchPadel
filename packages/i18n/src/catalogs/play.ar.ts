import type { DeepMessages } from './ws/types';
import type { playEn } from './play.en';

/**
 * `play.*` (Play tab (open matches + tournaments together), Play lane; Majed, 2026-10-11). Mirror every key in play.en.ts.
 *
 * As the rest of the guest catalog: verbal nouns on buttons, no gendered
 * imperative to the reader, counts through `countPhrase` (the six Arabic forms,
 * digits LTR-isolated).
 */
export const playAr: DeepMessages<typeof playEn> = {
  start: 'بدء مباراة',
  kindMatches: 'المباريات',
  off: 'لا تُقام مباريات مفتوحة ولا بطولات في هذا الفرع حاليًا.',
  emptyBody: 'لا مباريات مفتوحة ولا بطولات في الأيام القادمة. يمكن بدء مباراة من أي وقت متاح.',
  matchesError: 'تعذّر تحميل المباريات المفتوحة.',
  loadError: 'تعذّر تحميل المباريات المفتوحة والبطولات.',
  count: {
    tournaments: {
      zero: 'لا بطولات',
      one: 'بطولة واحدة',
      two: 'بطولتان',
      few: '{count} بطولات',
      many: '{count} بطولة',
      other: '{count} بطولة',
    },
  },
};
