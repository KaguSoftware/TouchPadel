import type { DeepMessages } from './types';
import type { coachingAdminEn } from './coachingAdmin.en';

/**
 * `ws.coaching.*` setup groups بالعربية. Mirrors coachingAdmin.en.ts.
 * DRAFT-AR (docs/design/coaching/operator.md §5.20); the lesson words are the
 * coaching glossary's (R55, R81).
 */
export const coachingAdminAr: DeepMessages<typeof coachingAdminEn> = {};
