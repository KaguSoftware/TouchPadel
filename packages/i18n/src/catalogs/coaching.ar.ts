import type { DeepMessages } from './ws/types';
import type { coachingEn } from './coaching.en';
import { coachingCoachAr } from './coaching.coach.ar';

/**
 * `coaching.*` بالعربية — الحصص مع المدرّبين في التطبيق والموقع. Mirrors
 * coaching.en.ts key-for-key (a missing key fails typecheck); the fragments are
 * spread in from their own file pairs, as in coaching.en.ts.
 *
 * DRAFT-AR: every line is on the client's review list
 * (docs/design/coaching/guest.md §4.15).
 */
export const coachingAr: DeepMessages<typeof coachingEn> = {
  coach: coachingCoachAr,
};
