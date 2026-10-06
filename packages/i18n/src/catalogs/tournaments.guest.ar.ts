import type { DeepMessages } from './ws/types';
import type { tournamentsGuestEn } from './tournaments.guest.en';

/**
 * `tournaments.guest` بالعربية. Mirrors tournaments.guest.en.ts key-for-key.
 *
 * DRAFT-AR: on the client's review list (build contracts §1.11). Text addressed to the guest reads
 * the same for a woman or a man.
 */
export const tournamentsGuestAr: DeepMessages<typeof tournamentsGuestEn> = {
  guest: {
    entry: {
      book: 'البطولات',
      mine: 'بطولاتي',
    },
    list: {
      title: 'البطولات',
      upcoming: 'القادمة',
      mine: 'بطولاتي',
      emptyTitle: 'لا شيء هنا بعد',
      empty: 'لا توجد بطولات قادمة.',
      emptyMine: 'لا يوجد اشتراك في أي بطولة بعد.',
      off: 'لا توجد بطولات في أي فرع حاليًا.',
      error: 'تعذّر تحميل البطولات.',
      placesLeft: 'الأماكن المتبقية: {count}',
      waitlistOnly: 'قائمة الانتظار مفتوحة',
      full: 'مكتملة',
    },
    detail: {
      title: 'البطولة',
      when: 'الموعد',
      branch: 'الفرع',
      placesLeft: 'الأماكن المتبقية',
      entries: 'عدد المشتركين',
      closes: 'يُغلق التسجيل {time}',
      schedule: 'الجدول',
      standings: 'الترتيب',
      waitlistPosition: 'الرقم {position} في قائمة الانتظار',
      notFound: 'هذه البطولة غير متاحة.',
      registered: 'تمّ التسجيل في البطولة.',
      waitlisted: 'الاسم في قائمة الانتظار. أيّ مكان يتوفّر يذهب إلى الأول في القائمة.',
      noShow: 'سُجّل عدم الحضور.',
      closedNote: 'أُغلق التسجيل.',
      fullNote: 'اكتملت البطولة وقائمة الانتظار.',
      cancelledNote: 'أُلغيت هذه البطولة.',
      finishedNote: 'انتهت هذه البطولة.',
      scheduleLater: 'يظهر الجدول هنا عند بدء اللعب.',
      court: 'الملعب {no}',
      sitOut: 'خارج هذه الجولة: {names}',
      vs: 'ضد',
      rank: 'المركز',
      player: 'اللاعب',
      pointsWon: 'النقاط',
      diff: 'الفارق',
      played: 'لُعبت',
      withdrawn: '{name} (انسحب)',
      withdrawTitle: 'الانسحاب من هذه البطولة؟',
      withdrawBody: 'الانسحاب مجاني حتى يُغلق التسجيل، ويذهب المكان إلى قائمة الانتظار.',
      withdrawWaitlistBody: 'سيُحذف الاسم من قائمة الانتظار.',
      withdrawConfirm: 'انسحاب',
      keep: 'إبقاء المكان',
      registeredToast: 'تمّ التسجيل في البطولة.',
      waitlistedToast: 'أُضيف الاسم إلى قائمة الانتظار.',
      withdrawnToast: 'تمّ الانسحاب.',
      refundAtDesk: 'تمّ الانسحاب. يُستردّ مبلغ {amount} من المكتب.',
    },
    register: 'التسجيل',
    waitlist: 'الانضمام إلى قائمة الانتظار',
    withdraw: 'الانسحاب',
    owedAtDesk: 'يُدفع {amount} عند المكتب يوم البطولة',
    errors: {
      notOpenCutoff: 'أُغلق التسجيل عند الموعد النهائي.',
      withdrawCutoff:
        'أُغلق التسجيل، فلم يعد الانسحاب ممكنًا من التطبيق. يمكن للمكتب إلغاء اشتراكك.',
      notOpenStatus: 'التسجيل في هذه البطولة غير مفتوح حاليًا.',
      categoryMismatch: 'هذه البطولة لفئة أخرى من اللاعبين.',
      full: 'اكتملت البطولة وقائمة الانتظار.',
      notFound: 'هذه البطولة لم تعد متاحة.',
      off: 'البطولات متوقّفة في هذا الفرع.',
      entryNotFound: 'لا يوجد اشتراك في هذه البطولة.',
    },
    push: {
      cancelled: 'أُلغيت البطولة.',
      promoted: 'توفّر مكان، وتمّ التسجيل في البطولة.',
    },
  },
};
