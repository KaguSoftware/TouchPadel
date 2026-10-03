import type { DeepMessages } from './ws/types';
import type { tournamentsEn } from './tournaments.en';
import { tournamentsCommonAr } from './tournaments.common.ar';
import { tournamentsGuestAr } from './tournaments.guest.ar';
import { tournamentsWebAr } from './tournaments.web.ar';

/**
 * `tournaments.*` بالعربية — البطولات في التطبيق والموقع. Mirrors tournaments.en.ts key-for-key
 * (a missing key fails typecheck); the lanes' fragments are spread in from their own file pairs.
 *
 * DRAFT-AR: every line is on the client's review list (build contracts §1.11).
 */
export const tournamentsAr: DeepMessages<typeof tournamentsEn> = {
  ...tournamentsCommonAr,
  ...tournamentsGuestAr,
  ...tournamentsWebAr,
};
