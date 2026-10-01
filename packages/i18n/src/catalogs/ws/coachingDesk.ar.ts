import type { DeepMessages } from './types';
import type { coachingDeskEn } from './coachingDesk.en';
import { coachingDeskCalAr } from './coachingDeskCal.ar';

/**
 * `ws.coaching.*` desk groups بالعربية. Mirrors coachingDesk.en.ts.
 *
 * DRAFT-AR: on the client's review list (docs/design/coaching/operator.md
 * §5.20). The lesson words are the coaching glossary's
 * (packages/i18n/src/catalogs/coaching.glossary.ts, R55, R81).
 */
export const coachingDeskAr: DeepMessages<typeof coachingDeskEn> = {
  ...coachingDeskCalAr,
};
