import type { DeepMessages } from './ws/types';
import type { coachingEn } from './coaching.en';
import { coachingCommonAr } from './coaching.common.ar';
import { coachingGuestAr } from './coaching.guest.ar';

/**
 * `coaching.*` بالعربية — الحصص في تطبيق الضيف. Mirrors coaching.en.ts
 * key-for-key (a missing key fails typecheck); the areas are spread in from
 * their own file pairs, as in coaching.en.ts.
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/coaching/guest.md §4.15).
 */
export const coachingAr: DeepMessages<typeof coachingEn> = {
  ...coachingCommonAr,
  ...coachingGuestAr,
};
