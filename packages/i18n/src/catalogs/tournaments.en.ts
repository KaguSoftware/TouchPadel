import { tournamentsCommonEn } from './tournaments.common.en';
import { tournamentsGuestEn } from './tournaments.guest.en';
import { tournamentsWebEn } from './tournaments.web.en';

/**
 * `tournaments.*`: the tournaments milestone's words for the phone and the website
 * (docs/design/tournaments/build-contracts-2026-10-03.md §1.11). Mirror every key in
 * tournaments.ar.ts.
 *
 * Each area lives in its own fragment pair so parallel lanes never edit one file (the coaching.*
 * pattern), spread in here: tournaments.common.* (formats, states, units), tournaments.guest.*
 * (the phone's screens and pushes) and tournaments.web.* (the landing cards and the public page).
 * Lanes never edit this file, en.ts, ar.ts or ws/index.ts.
 */
export const tournamentsEn = {
  ...tournamentsCommonEn,
  ...tournamentsGuestEn,
  ...tournamentsWebEn,
};
