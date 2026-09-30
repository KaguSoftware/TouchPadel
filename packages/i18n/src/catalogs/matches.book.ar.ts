import type { DeepMessages } from './ws/types';
import type { matchesBookEn } from './matches.book.en';

/**
 * `matches.book` بالعربية. Owned by the mobile Book-tab lane; spread into
 * matches.ar.ts. Mirrors matches.book.en.ts key-for-key (a missing key fails
 * typecheck).
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/open-matches/guest.md §4.24, R38): Latin digits through the
 * formatters, verbal nouns on buttons, no gendered imperative to the reader,
 * counts through `isolateLtr`. The choice sheet's message is addressed to
 * nobody in particular, so its imperative stays (§4.11).
 */
export const matchesBookAr: DeepMessages<typeof matchesBookEn> = {
  book: {
    choiceTitle: '{time} · {day}',
    choiceMessage:
      'احجز الملعب كاملًا، أو ابدأ مباراة مفتوحة تنتظر اكتمال أربعة لاعبين ثم تحجز الملعب.',
    join: 'الانضمام إلى المباراة المفتوحة · {seats}',
    joinSeveral: 'الانضمام إلى مباراة مفتوحة · {matches}',
    viewMine: 'مباراتك المفتوحة',
    bookCourt: 'حجز الملعب',
    start: 'بدء مباراة مفتوحة',
    chipJoin: '{seats} · انضمام',
    chipWomen: 'للنساء · {seats}',
    chipMen: 'للرجال · {seats}',
    chipMine: 'مباراتك · {taken}',
    entryJoin: '{matches} · انضمام',
    entry: 'المباريات المفتوحة',
    entrySignIn: 'المباريات المفتوحة · تسجيل الدخول',
  },
};
