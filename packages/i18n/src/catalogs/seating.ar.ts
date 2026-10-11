import type { DeepMessages } from './ws/types';
import type { seatingEn } from './seating.en';

/**
 * `seating.*` بالعربية (Tournament seating board + tournament rows in My reservations, Tournament
 * lane; Majed, 2026-10-11). Mirrors seating.en.ts key-for-key.
 *
 * Text addressed to the guest reads the same for a woman or a man (tournaments.guest's rule), so
 * no line uses a second-person imperative.
 */
export const seatingAr: DeepMessages<typeof seatingEn> = {
  title: 'المقاعد',
  drawTitle: 'ملاعب الجولة الأولى',
  caption: {
    americano: 'أمريكانو: يتبدّل الشريك في كل جولة.',
    mexicano: 'مكسيكانو: تتشكّل الثنائيات من جديد حسب النقاط بعد كل جولة.',
  },
  order: 'تمتلئ المقاعد بترتيب التسجيل.',
  tapHint: 'الضغط على مقعد متاح يحجز المكان التالي.',
  fullHint: 'كل المقاعد محجوزة، وما زال الانضمام إلى قائمة الانتظار ممكنًا.',
  legend: {
    taken: 'محجوز',
    mine: 'أنت',
    open: 'متاح',
  },
  chair: {
    taken: 'محجوز',
    mine: 'أنت',
    open: 'متاح',
  },
  chairA11y: '{court}، المقعد {chair}: {who}',
  registerHint: 'للتسجيل في هذه البطولة',
  waitlistHint: 'للانضمام إلى قائمة الانتظار',
  ownCourt: 'مقعدك في {court}.',
  ownSitOut: 'الجولة الأولى استراحة لك.',
  sitOut: 'خارج اللعب في الجولة الأولى',
  showAll: 'عرض كل الملاعب ({count})',
  showFewer: 'عرض ملاعب أقل',
  viewTournament: 'عرض البطولة',
};
