import { coachingDeskCalEn } from './coachingDeskCal.en';

/**
 * `ws.coaching.*` desk groups (docs/design/coaching/operator.md §5.8–§5.11,
 * §5.20): the lesson screen (`lesson`, `roster`, `pay`, `attendance`, `add`,
 * `cancel`, `reschedule`, `move`, `refunds`) here, and the calendar side
 * (`calendar`, `today`, `create`, `start`) spread in from coachingDeskCal.*.
 * Mirror every key in coachingDesk.ar.ts.
 */
export const coachingDeskEn = {
  ...coachingDeskCalEn,
};
