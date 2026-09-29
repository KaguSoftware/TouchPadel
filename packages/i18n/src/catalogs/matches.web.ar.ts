import type { DeepMessages } from './ws/types';
import type { matchesWebEn } from './matches.web.en';

/**
 * `matches.web` بالعربية. Owned by the web lane; spread into matches.ar.ts.
 * Mirrors matches.web.en.ts key-for-key (a missing key fails typecheck).
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/open-matches/guest.md §4.20, §4.24, R38): Latin digits through
 * the formatters, verbal nouns on buttons, no gendered imperative to the
 * reader, names through `isolate`.
 *
 * The organiser is a third person, so `approveF` is the feminine form for a
 * women-only match (guest.md §4.24 rule 1). The error line asks with «يُرجى»
 * rather than an imperative, and the button is a verbal noun.
 */
export const matchesWebAr: DeepMessages<typeof matchesWebEn> = {
  web: {
    metaTitle: 'دعوة إلى مباراة مفتوحة',
    metaDescription: 'مباراة بادل مفتوحة للانضمام في تتش بادل.',
    eyebrow: 'مباراة مفتوحة',
    when: '{weekday} {date} · {time}',
    category: {
      open: 'مفتوحة للجميع',
      women: 'للسيدات فقط',
      men: 'للرجال فقط',
    },
    approve: 'يوافق المنظّم على انضمام كل لاعب',
    approveF: 'توافق المنظّمة على انضمام كل لاعبة',
    full: 'هذه المباراة مكتملة',
    closed: 'لم تعد هذه المباراة مفتوحة',
    error: 'تعذّر تحميل هذه المباراة. يُرجى المحاولة بعد قليل.',
    open: 'فتح في التطبيق',
    noApp: 'ليس لديك التطبيق؟',
  },
};
