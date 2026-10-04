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
      finished: 'انتهت',
      cancelled: 'أُلغيت',
    },
    entryStatus: {
      registered: 'مسجَّل',
      waitlisted: 'في قائمة الانتظار',
      withdrawn: 'منسحب',
      no_show: 'لم يحضر',
    },
    round: 'الجولة {round}',
    points: '{points} نقطة',
    pointsTarget: 'المباراة حتى {points} نقطة',
    entryFee: 'رسوم الاشتراك',
    free: 'الاشتراك مجاني',
    prize: 'الجائزة',
    player: 'اللاعب {no}',
    formerPlayer: 'لاعب سابق',
  },
};
