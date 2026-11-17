import type { DeepMessages } from './ws/types';
import type { tournamentsCommonEn } from './tournaments.common.en';

/**
 * `tournaments.common` بالعربية. Spread into tournaments.ar.ts; mirrors
 * tournaments.common.en.ts key-for-key (a missing key fails typecheck).
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/tournaments/build-contracts-2026-10-03.md §1.11). «بطولة» is the tournament,
 * «جولة» a round, «اشتراك» an entry. Text addressed to the reader reads the same for a woman or a
 * man.
 */
export const tournamentsCommonAr: DeepMessages<typeof tournamentsCommonEn> = {
  common: {
    tournament: 'بطولة',
    format: {
      americano: 'أمريكانو',
      mexicano: 'مكسيكانو',
    },
    status: {
      open: 'التسجيل مفتوح',
      closed: 'التسجيل مغلق',
      running: 'جارية',
      finished: 'منتهية',
      cancelled: 'ملغاة',
    },
    entryStatus: {
      registered: 'سُجّلت',
      waitlisted: 'في قائمة الانتظار',
      withdrawn: 'انسحبت',
      no_show: 'سُجّل غيابك',
    },
    round: 'الجولة {round}',
    points: 'النقاط: {points}',
    pointsTarget: 'المباراة حتى النقطة {points}',
    entryFee: 'رسوم الاشتراك',
    free: 'الاشتراك مجاني',
    prize: 'الجائزة',
    player: 'اللاعب {no}',
    formerPlayer: 'لاعب سابق',
  },
};
