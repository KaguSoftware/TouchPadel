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
  start: 'حجز ودعوة',
  kindMatches: 'المباريات',
  off: 'لا تُقام مباريات مفتوحة ولا بطولات في هذا الفرع حاليًا.',
  emptyBody: 'لا مباريات مفتوحة ولا بطولات في الأيام القادمة. يمكنك بدء مباراة في أي وقت متاح.',
  matchesError: 'تعذّر تحميل المباريات.',
  fitAsk: 'يمكنك تحديد مستواك لعرض البطولات المناسبة لك.',
  filter: {
    label: 'تصفية',
  },
  signIn: {
    matches: 'تسجيل الدخول لعرض المباريات المفتوحة',
    tournaments: 'تسجيل الدخول لعرض البطولات',
    both: 'تسجيل الدخول لعرض المباريات المفتوحة والبطولات',
    body: 'يمكنك إنشاء حساب أو تسجيل الدخول لتصفّحها والانضمام إليها ومتابعتها.',
    cta: 'تسجيل الدخول',
  },
  loadError: 'تعذّر تحميل المباريات والبطولات.',
  court: {
    none: 'لا مقاعد متاحة حاليًا',
    hint: 'يعرض هذه المباراة في القائمة',
  },
};
