import type { DeepMessages } from './ws/types';
import type { tournamentsWebEn } from './tournaments.web.en';

/**
 * `tournaments.web` بالعربية. Mirrors tournaments.web.en.ts key-for-key.
 *
 * DRAFT-AR: on the client's review list (build contracts §1.11).
 */
export const tournamentsWebAr: DeepMessages<typeof tournamentsWebEn> = {
  web: {
    fee: 'رسوم المشاركة {amount}',
    when: '{weekday} {date} · من {from} إلى {to}',
    eventsCards: {
      title: 'البطولات القادمة',
      placesLeft: 'الأماكن المتبقية: {count}',
      full: 'مكتملة: قائمة الانتظار مفتوحة',
      fullNoWaitlist: 'مكتملة',
      registerInApp: 'التسجيل من التطبيق',
      details: 'التفاصيل',
    },
    page: {
      title: 'البطولة',
      metaDescription: 'بطولة بادل في تتش بادل: الجدول والنتائج والترتيب.',
      schedule: 'الجدول',
      standings: 'الترتيب',
      cancelled: 'أُلغيت هذه البطولة.',
      missing: 'هذه البطولة غير متاحة.',
      error: 'تعذّر تحميل هذه الصفحة. يُرجى المحاولة بعد قليل.',
      court: 'الملعب {court}',
      team: '{one} و{two}',
      vs: 'ضد',
      notPlayed: 'لم تُلعب بعد',
      scoring: 'احتساب النقاط',
      places: 'الأماكن',
      sitOut: 'خارج هذه الجولة: {players}',
      noSchedule: 'يظهر الجدول هنا عند بدء اللعب.',
      entries: 'اللاعبون المسجّلون: {count}',
      live: 'تُحدَّث كل 30 ثانية أثناء اللعب.',
      registerInApp: 'التسجيل من التطبيق',
      openInApp: 'فتح في التطبيق',
      noApp: 'ليس لديك التطبيق؟',
      allEvents: 'كل البطولات',
      withdrawn: '{player} (انسحب)',
      col: {
        rank: 'المركز',
        player: 'اللاعب',
        points: 'النقاط',
        diff: 'الفارق',
        played: 'المباريات',
      },
    },
  },
};
