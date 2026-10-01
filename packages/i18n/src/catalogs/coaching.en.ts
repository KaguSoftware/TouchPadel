import { coachingCoachEn } from './coaching.coach.en';

/**
 * `coaching.*`: lessons with a coach on the phone and the website
 * (docs/design/coaching/guest.md §4.15; build contracts §1.11). Mirror every
 * key in coaching.ar.ts.
 *
 * One fragment pair per area, so parallel lanes never edit the same file (the
 * matches.*.ts pattern): `coaching.common` (kinds, states, counts, the guest's
 * error lines), `coaching.guest` (the guest screens), `coaching.coach` (coach
 * mode, coaching.coach.*.ts) and `coaching.web` (the website). Each lane adds
 * its fragment here as it lands.
 */
export const coachingEn = {
  coach: coachingCoachEn,
};
