import type { DeepMessages } from './ws/types';
import type { coachingEn } from './coaching.en';
import { coachingCoachAr } from './coaching.coach.ar';
import { coachingWebAr } from './coaching.web.ar';

/**
 * `coaching.*` بالعربية — الحصص مع المدرّبين في التطبيق والموقع. Mirrors coaching.en.ts
 * key-for-key (a missing key fails typecheck); the lanes' fragments are spread in from their own
 * file pairs, as in coaching.en.ts.
 *
 * DRAFT-AR: every line is on the client's review list (docs/design/coaching/guest.md §4.15).
 * «حصة» is the lesson in every app (C-30), never «درس»; «أجرة الملعب» the court share and
 * «نصيب المدرّب» the coach's share (R55), from `coachingGlossary`.
 */
export const coachingAr: DeepMessages<typeof coachingEn> = {
  coach: coachingCoachAr,
  ...coachingWebAr,
};
