import type { DeepMessages } from './types';
import type { matchesDeskEn } from './matchesDesk.en';

/**
 * `ws.matches.{chip, calendar, today, create, start, booking, bill}` بالعربية.
 * Owned by the operator desk lane; spread into matches.ar.ts. Mirrors
 * matchesDesk.en.ts key-for-key (a missing key fails typecheck).
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/open-matches/operator.md §5.21, R38; the rules are in the
 * matches.ar.ts header). Buttons are verbal nouns; staff are addressed with
 * يلزم / يُرجى / يمكن and passives, never a gendered imperative; figures,
 * times and "3/4" arrive through the formatters and isolateLtr, so the
 * digits are Latin.
 */
export const matchesDeskAr: DeepMessages<typeof matchesDeskEn> = {
  chip: {
    marks: 'حضور {here} · غياب {missing}',
    aria: 'مباراة مفتوحة · {taken} من {total} لاعبين',
  },
  calendar: {
    strip: 'المباريات المفتوحة قيد الاكتمال في هذه الليلة',
    stripChip: '{time} · {category} · {fill} · تُغلق {deadline}',
    stripChipOpen: '{time} · {category} · {fill}',
    stripAwaiting: '{time} · {category} · {fill} · بانتظار ملعب',
    startingFor: 'بدء مباراة مفتوحة باسم {name}: يُرجى اختيار وقت متاح',
  },
  list: {
    title: 'المباريات المفتوحة',
    lead: 'المباريات التي بدأها اللاعبون من التطبيق، يومًا بيوم. افتح مباراة لترى لاعبيها وتستلم حصصهم عند الاستقبال.',
    previousDay: 'اليوم السابق',
    nextDay: 'اليوم التالي',
    backToToday: 'اليوم',
    startOnCalendar: 'ابدأ مباراة من التقويم',
    offTitle: 'المباريات المفتوحة متوقفة',
    offBody: 'فعّلها من إعدادات الملاعب ليبدأ اللاعبون المباريات وينضموا إليها من التطبيق.',
    offAction: 'افتح الإعدادات',
  },
  today: {
    title: 'مباريات مفتوحة تحتاج إلى لاعبين',
    startMatch: 'بدء مباراة مفتوحة',
    players: 'اللاعبون {taken} من {total}',
    requests: 'الطلبات {count}',
    closes: 'تُغلق {time}',
    lastCourt: 'آخر ملعب متاح',
    bookedSeatFree: 'محجوزة · مقعد شاغر',
    addPlayer: 'إضافة لاعب',
    open: 'فتح',
    off: 'المباريات المفتوحة متوقفة هنا، وتستمر المباريات التي بدأت.',
    none: 'لا مباريات مفتوحة الليلة',
    playersOwing: 'لاعبون لم يدفعوا: {count}',
  },
  create: {
    bump: 'حجز هذا الملعب يلغي المباراة المفتوحة في {time} (فيها {players})، وتعود التذاكر إلى أصحابها.',
    bumpedToast: 'حُجز الملعب. أُلغيت المباراة المفتوحة في {time} وعادت التذاكر إلى لاعبيها.',
    kept: 'أحد ملاعب هذا الوقت محجوز للمباراة المفتوحة في {time}: لاعبوها الأربعة بانتظاره.',
  },
  start: {
    title: 'بدء مباراة مفتوحة',
    organiser: 'المنظّم',
    banned: 'ممنوع من المباريات المفتوحة',
    comingWith: 'عدد المرافقين',
    seatsAtStart: 'المقاعد عند البدء: {seats}',
    category: 'الفئة',
    women: 'المباراة للسيدات فقط.',
    men: 'المباراة للرجال فقط.',
    genderMismatch: 'الجنس المسجّل لهذا الزبون لا يناسب هذه الفئة.',
    openRecord: 'فتح ملف الزبون',
    join: 'الانضمام',
    approveNeedsCustomer: 'لا يوافق على اللاعبين إلا زبون لديه التطبيق.',
    visibility: 'من يمكنه العثور عليها',
    price: 'الملعب {price} · حصة كل لاعب {share} تُدفع في الاستقبال. من ينضم عبر التطبيق يستخدم تذكرة واحدة، ولا يحتاج لاعبو الاستقبال إلى تذاكر.',
    submit: 'بدء المباراة',
    startedToast: 'بدأت المباراة المفتوحة. يمكن مشاركة الرابط أو إضافة لاعبين.',
    startedPriceToast: 'بدأت المباراة المفتوحة. سعر الملعب الآن {price}، وحصة كل لاعب {share}.',
    slotFull: 'في هذا الموعد مباريات مفتوحة قيد الاكتمال:',
    wizard: {
      stepOrganiser: 'المنظّم',
      stepWhoPlays: 'مَن يلعب',
      stepWhen: 'الملعب والوقت',
      openBody: 'يمكن لأي شخص أن يشغل مقعدًا.',
      womenBody: 'جميع اللاعبات سيدات.',
      menBody: 'جميع اللاعبين رجال.',
      whenNote: '{time} · {duration}',
      priceFigure: 'الملعب {price} · حصة كل لاعب {share}',
      priceLine: 'تُدفع في الاستقبال. من ينضم عبر التطبيق يستخدم تذكرة واحدة، ولا يحتاج لاعبو الاستقبال إلى تذاكر.',
      priceLineDesk: 'عند الاستقبال. لا يحتاج أحد إلى تذكرة: يدفع كل لاعب حصته عند الاستقبال.',
      reviewOrganiser: 'المنظّم',
      reviewCategory: 'الفئة',
      reviewJoin: 'الانضمام',
      reviewFoundBy: 'يعثر عليها',
      reviewCourt: 'الملعب',
      reviewPrice: 'السعر',
      courtWhen: '{court} · {range}',
      priceEach: '{price} · {share} لكل لاعب',
    },
  },
  booking: {
    title: 'مباراة مفتوحة · {label}',
    players: 'اللاعبون',
    cancelLine: 'يلغي ذلك المباراة المفتوحة لجميع لاعبيها وتعود تذاكرهم.',
    sharesLine: 'تبقى الحصص كما هي، ويُضاف أي فرق في السعر إلى الفاتورة.',
  },
  bill: {
    playersOwe: 'على اللاعبين {amount} مجتمعين. تُستلم كل حصة من قسم اللاعبين، ويبقى المبلغ المستلم هنا دون توزيع إلى أن يُوزَّع.',
    writtenOff: 'مشطوب',
    priceChanged: 'تغيّر السعر بعد الحجز',
    unassigned: 'لم يُوزَّع على اللاعبين بعد',
    seats: 'المقاعد: {list}',
    listSeparator: '، ',
  },
};
