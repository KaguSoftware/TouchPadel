import { coachingCommonEn } from './coaching.common.en';
import { coachingGuestEn } from './coaching.guest.en';

/**
 * `coaching.*`: the phone's lesson words (docs/design/coaching/guest.md §4.15;
 * build contracts §1.11). Mirror every key in coaching.ar.ts.
 *
 * The sub-namespaces live in one file pair per area, so parallel lanes never
 * edit the same file (the matches.*.ts pattern), and are spread in here:
 * coaching.common.* (kinds, states, money lines, counted phrases, the codes'
 * lines), coaching.guest.* (the guest's screens). Coach mode's
 * coaching.coach.* and the website's coaching.web.* join them from their own
 * pairs. Every Arabic word comes from the one glossary
 * (coaching.glossary.ts, R55): «حصة» is the lesson (C-30).
 */
export const coachingEn = {
  ...coachingCommonEn,
  ...coachingGuestEn,
};
