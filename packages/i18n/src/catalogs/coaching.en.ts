import { coachingCommonEn } from './coaching.common.en';
import { coachingGuestEn } from './coaching.guest.en';
import { coachingCoachEn } from './coaching.coach.en';
import { coachingWebEn } from './coaching.web.en';

/**
 * `coaching.*`: the coaching milestone's words for the phone and the website
 * (docs/design/coaching/guest.md §4.15, build contracts §1.11). Mirror every key in
 * coaching.ar.ts.
 *
 * Each area lives in its own fragment pair so parallel lanes never edit one file (the
 * matches.*.ts pattern), spread in here: coaching.common.* (kinds, states, money lines, counted
 * phrases, the codes' lines), coaching.guest.* (the guest screens), coaching.coach.* (coach
 * mode, coaching.coach.*.ts) and coaching.web.* (the website's /coaching and /c/<id> pages and
 * the landing strip).
 *
 * Every Arabic word comes from the one glossary (coaching.glossary.ts, R55, R72): «حصة» is the
 * lesson (C-30).
 */
export const coachingEn = {
  ...coachingCommonEn,
  ...coachingGuestEn,
  coach: coachingCoachEn,
  ...coachingWebEn,
};
