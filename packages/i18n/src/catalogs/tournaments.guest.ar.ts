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
      empty: 'لا بطولات قادمة.',
      emptyMine: 'لا اشتراك لديك في أي بطولة بعد.',
      off: 'لا توجد بطولات في أي فرع حاليًا.',
      error: 'تعذّر تحميل البطولات.',
      placesLeft: 'الأماكن المتاحة: {count}',
      noPlacesLeft: 'لا أماكن متاحة',
      statusOpen: 'مفتوحة',
      statusClosed: 'مغلقة',
    },
    detail: {
      title: 'البطولة',
      when: 'الموعد',
      branch: 'الفرع',
      placesLeft: 'الأماكن المتاحة',
      entries: 'عدد المشتركين',
      closes: 'يُغلق التسجيل في {time}',
      schedule: 'الجدول',
      standings: 'الترتيب',
      waitlistPosition: 'الرقم {position} في قائمة الانتظار',
      notFound: 'هذه البطولة غير متاحة.',
      registered: 'سُجّلت في البطولة.',
      waitlisted: 'اسمك في قائمة الانتظار. إذا توفّر مكان، يذهب إلى الأول في القائمة.',
      noShow: 'سُجّل غيابك.',
      closedNote: 'أُغلق التسجيل.',
      fullNote: 'اكتمل العدد في هذه البطولة وفي قائمة انتظارها.',
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
      played: 'لعب',
      withdrawn: '{name} (انسحاب)',
      withdrawTitle: 'الانسحاب من هذه البطولة؟',
      withdrawBody: 'الانسحاب مجاني حتى يُغلق التسجيل. يذهب مكانك إلى قائمة الانتظار.',
      withdrawWaitlistBody: 'سيُحذف اسمك من قائمة الانتظار.',
      withdrawConfirm: 'انسحاب',
      keep: 'إبقاء المكان',
      registeredToast: 'سُجّلت في البطولة.',
      waitlistedToast: 'أُضيف اسمك إلى قائمة الانتظار.',
      withdrawnToast: 'انسحبت من البطولة.',
      refundAtDesk: 'انسحبت من البطولة. يمكنك استلام {amount} عند الاستقبال.',
    },
    register: 'التسجيل',
    waitlist: 'الانضمام إلى قائمة الانتظار',
    withdraw: 'الانسحاب',
    owedAtDesk: 'يُدفع {amount} عند الاستقبال يوم البطولة',
    errors: {
      notOpenCutoff: 'أُغلق التسجيل عند حلول آخر موعد له.',
      withdrawCutoff:
        'أُغلق التسجيل، فلم يعد الانسحاب ممكنًا من التطبيق. يمكن لموظفي الاستقبال إلغاء اشتراكك.',
      notOpenStatus: 'التسجيل في هذه البطولة غير مفتوح حاليًا.',
      categoryMismatch: 'هذه البطولة لفئة أخرى من اللاعبين.',
      profileRequired: 'للتسجيل، نحتاج إلى معرفة مستواك ومدة لعبك.',
      levelMismatch: 'هذه البطولة لفئة أخرى من اللاعبين.',
      yearsMismatch: 'هذه البطولة للاعبين بعدد سنوات لعب مختلف.',
      answer: 'الإجابة الآن',
      full: 'اكتمل العدد في هذه البطولة وفي قائمة انتظارها.',
      notFound: 'لم تعد هذه البطولة متاحة.',
      off: 'البطولات متوقفة في هذا الفرع.',
      entryNotFound: 'ليس لديك اشتراك في هذه البطولة.',
      seatTaken: 'سبقك أحدهم إلى هذا المقعد للتو. يمكنك اختيار مقعد متاح آخر.',
    },
    push: {
      cancelled: 'أُلغيت البطولة.',
      promoted: 'توفّر مكان، وسُجّل اسمك في البطولة.',
    },
  },
};
