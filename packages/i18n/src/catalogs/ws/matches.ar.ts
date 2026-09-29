import type { DeepMessages } from './types';
import type { matchesEn } from './matches.en';
import { matchesPlayersAr } from './matchesPlayers.ar';
import { matchesDeskAr } from './matchesDesk.ar';
import { matchesAdminAr } from './matchesAdmin.ar';

/**
 * `ws.matches.*` بالعربية: المباريات المفتوحة عند الاستقبال. Mirrors
 * matches.en.ts key-for-key (a missing key fails typecheck); the lanes'
 * groups are spread in from their own file pairs, as in matches.en.ts.
 *
 * DRAFT-AR: every line of this lane is on the client's review list
 * (docs/design/open-matches/operator.md §5.21, R38), here and in
 * matchesPlayers.ar.ts, matchesDesk.ar.ts and matchesAdmin.ar.ts: Latin digits
 * through `formatNumber` / `formatIQD`; buttons are verbal nouns (إلغاء، تسجيل،
 * استلام، توزيع، شطب، إضافة), never imperatives; staff are addressed without
 * gendered verbs (يلزم، يُرجى، يمكن + noun, passives); a player in the third
 * person follows the match category (`women` → the `…F` keys); `isolateLtr` on
 * "+1", "3/4" and counts; `isolate` on names.
 */
export const matchesAr: DeepMessages<typeof matchesEn> = {
  ...matchesPlayersAr,
  ...matchesDeskAr,
  ...matchesAdminAr,
  common: {
    openMatch: 'مباراة مفتوحة',
    category: {
      open: 'للجميع',
      women: 'للسيدات',
      men: 'للرجال',
    },
    join: {
      open: 'الانضمام فوري',
      approve: 'بطلب انضمام',
    },
    visibility: {
      public: 'معروضة في الفرع',
      link: 'بالرابط فقط',
    },
    tag: {
      approve: 'بطلب انضمام',
      link: 'بالرابط فقط',
    },
    status: {
      filling: 'قيد الاكتمال',
      awaiting_court: 'بانتظار ملعب',
      booked: 'محجوزة',
      played: 'لُعبت',
      no_show: 'لم يحضر أحد',
      cancelled: 'ملغاة',
      bumped: 'أُلغيت بسبب حجز',
      expired: 'لم تكتمل',
    },
    endedReason: {
      played: 'لُعبت',
      allNoShow: 'لم يحضر أحد، وفُقدت كل تذاكرها.',
      organiserCancelled: 'ألغاها المنظّم وعادت التذاكر.',
      staffCancelled: 'أُلغيت من الاستقبال وعادت التذاكر.',
      reservationCancelled: 'أُلغي الحجز وعادت التذاكر، بما فيها تذاكر الغائبين.',
      calledOffShort: 'أُلغيت لنقص لاعب، واحتفظ الحاضرون بتذاكرهم.',
      empty: 'غادر الجميع قبل اكتمالها.',
      venueClosed: 'الفرع مغلق في ذلك الوقت، وعادت التذاكر.',
      bumped: 'حجز آخر أخذ آخر ملعب متاح، وعادت التذاكر.',
      bumpedNoCourt: 'لم يعد أي ملعب يتيح هذه المدة، وعادت التذاكر.',
      deadline: 'لم تكتمل قبل انتهاء المهلة، وعادت التذاكر.',
      expiredNoCourt: 'اكتمل اللاعبون الأربعة ولم يتوفر ملعب، وعادت التذاكر.',
    },
    ticket: {
      inUse: 'تذكرة قيد الاستخدام',
      onHolder: 'على تذكرة {holder}',
      none: 'بلا تذكرة',
      back: 'عادت التذكرة',
      lost: 'فُقدت التذكرة',
      held: 'التذكرة محجوزة',
    },
    kind: {
      account: 'تطبيق',
      friend: 'مرافق',
      desk: 'استقبال',
    },
    deskPlayer: 'لاعب استقبال {seat}',
  },
  count: {
    players: {
      zero: 'لا لاعبين',
      one: 'لاعب واحد',
      two: 'لاعبان',
      few: '{count} لاعبين',
      many: '{count} لاعبًا',
      other: '{count} لاعب',
    },
    playersF: {
      zero: 'لا لاعبات',
      one: 'لاعبة واحدة',
      two: 'لاعبتان',
      few: '{count} لاعبات',
      many: '{count} لاعبة',
      other: '{count} لاعبة',
    },
    shares: {
      zero: 'لا حصص',
      one: 'حصة واحدة',
      two: 'حصتان',
      few: '{count} حصص',
      many: '{count} حصة',
      other: '{count} حصة',
    },
    tickets: {
      zero: 'لا تذاكر',
      one: 'تذكرة واحدة',
      two: 'تذكرتان',
      few: '{count} تذاكر',
      many: '{count} تذكرة',
      other: '{count} تذكرة',
    },
    ticketsGen: {
      zero: 'لا تذاكر',
      one: 'تذكرة واحدة',
      two: 'تذكرتين',
      few: '{count} تذاكر',
      many: '{count} تذكرة',
      other: '{count} تذكرة',
    },
    sharesGen: {
      zero: 'لا حصص',
      one: 'حصة واحدة',
      two: 'حصتين',
      few: '{count} حصص',
      many: '{count} حصة',
      other: '{count} حصة',
    },
    seats: {
      zero: 'لا مقاعد',
      one: 'مقعد واحد',
      two: 'مقعدان',
      few: '{count} مقاعد',
      many: '{count} مقعدًا',
      other: '{count} مقعد',
    },
  },
  errors: {
    markLocked: {
      day_closed: 'أُغلق يوم هذه المباراة، فأصبح التسجيل نهائيًا.',
      ticket_used: 'استُخدمت التذكرة التي عادت في مباراة أخرى.',
      court_reused: 'حُجز الملعب مجددًا بعد إغلاق هذه المباراة.',
      replaced: 'شغل أحدهم هذا المقعد بعد ذلك، فيبقى الغياب مسجّلًا.',
      paid: 'دفع هذا اللاعب. يلزم ردّ المبلغ عند الصندوق قبل تسجيل الغياب.',
      match_ended: 'انتهت هذه المباراة، فلا يمكن إلا التبديل بين تسجيل الحضور وتسجيل الغياب.',
    },
    transition: {
      marked: 'يلزم التراجع عن التسجيل أولًا.',
      not_carrier: 'لم يعد لهذا اللاعب مقعد في المباراة.',
      use_attendance: 'بعد بدء المباراة، يُستخدم تسجيل الحضور أو الغياب.',
      not_short: 'لا غائب في المباراة، فلا يمكن إلغاؤها لنقص لاعب.',
      nobody_came: 'لم يحضر أحد. يُسجَّل غياب الجميع بدلًا من الإلغاء.',
      match_ended: 'انتهت هذه المباراة.',
      ended: 'غادر هذا اللاعب المباراة سابقًا.',
    },
    managerRequired: 'بعد الحجز، لا يزيل مقعدًا بسبب خطأ من الموظف أو تكرار إلا المدير.',
    paymentState: {
      empty: 'لم يُدفع شيء على هذه الفاتورة بعد. تُستلم الحصص من قسم اللاعبين بدلًا من ذلك.',
      over_paid: 'دُفع على هذه الفاتورة أكثر مما يستحقه الحجز الآن، ويردّ مدير الفرق عند الصندوق.',
      ticket: 'لا تُسترد مشتريات التذاكر إلا بالاسترداد من ملف الزبون.',
    },
    alreadyLinked: 'هذه الدفعة موزّعة على هذا اللاعب مسبقًا.',
    guestName: 'يلزم ألا يتجاوز الاسم {max} حرفًا.',
    guestPhone: 'يتكوّن رقم الهاتف من {min} إلى {max} رقمًا.',
    slotKept: 'هذا الملعب محجوز للمباراة المفتوحة في {time}. يُرجى اختيار ملعب أو وقت آخر.',
    ticketInUse: {
      in_use: 'إحدى تذاكر هذه الدفعة في مباراة حتى {time}، ويمكن الاسترداد بعد ذلك.',
      reserved: 'إحدى تذاكر هذه الدفعة محجوزة لطلب انضمام حتى {time}.',
      restorable: 'فُقدت اليوم إحدى تذاكر هذه الدفعة، ويمكن إعادتها حتى إغلاق اليوم. يمكن الاسترداد بعد إغلاق اليوم.',
    },
    tooLateAt: 'الموعد قريب جدًا لبدء مباراة مفتوحة: أقرب موعد ممكن {time}. يمكن حجز الملعب بدلًا من ذلك.',
  },
  offline: {
    needsConnection: 'يلزم الاتصال: المباريات المفتوحة تعمل عبر الإنترنت فقط',
    lastUpdated: 'آخر تحديث {time}',
    readFailed: 'تعذّر عرض المباريات المفتوحة دون اتصال',
  },
};
