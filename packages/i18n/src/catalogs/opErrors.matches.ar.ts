import type { DeepMessages } from './ws/types';
import type { opErrorsMatchesEn } from './opErrors.matches.en';

/**
 * `op.errors.<CODE>` بالعربية للمباريات المفتوحة عند الاستقبال. Mirrors
 * opErrors.matches.en.ts key-for-key; the `DeepMessages` type fails the
 * typecheck on a missing or extra key.
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/open-matches/operator.md §5.20, §5.21), including the word for
 * "ticket".
 */
export const opErrorsMatchesAr: DeepMessages<typeof opErrorsMatchesEn> = {
  NO_UNUSED_TICKETS: 'لم تبقَ في هذه الدفعة تذاكر غير مستخدمة.',
  TICKET_IN_USE: 'إحدى تذاكر هذه الدفعة ما زالت قيد الاستخدام. يمكن الاسترداد بعد عودتها.',
  CUSTOMER_NOT_FOUND: 'تعذّر العثور على هذا الزبون.',
  // 0262: the desk's open-match RPCs, seat money and the DF-16 wall. DRAFT-AR.
  MATCHES_OFF: 'المباريات المفتوحة متوقفة في هذا الفرع.',
  MATCH_NOT_FOUND: 'هذه المباراة المفتوحة لم تعد في هذا الفرع.',
  MATCH_NOT_FILLING: 'لم تعد هذه المباراة قيد الاكتمال. تُعدَّل المباراة المحجوزة من صفحة حجزها.',
  MATCH_NOT_BOOKED: 'لا ملعب محجوز لهذه المباراة.',
  MATCH_NOT_STARTED: 'لم تبدأ المباراة بعد.',
  MATCH_FULL: 'لا مقعد شاغر في هذه المباراة.',
  MATCH_TOO_LATE: 'الموعد قريب جدًا لبدء مباراة مفتوحة، ويمكن حجز الملعب بدلًا منها.',
  MATCH_SLOT_FULL: 'في هذا الموعد ما يكفي من المباريات المفتوحة قيد الاكتمال. يمكن إضافة اللاعبين إلى إحداها.',
  MATCH_GENDER_MISMATCH: 'هذا اللاعب لا يناسب فئة هذه المباراة.',
  MATCH_SEAT_LIMIT: 'لا يحق للاعب الواحد أكثر من ثلاثة مقاعد.',
  MATCH_BANNED: 'هذا الزبون ممنوع من المباريات المفتوحة.',
  MATCH_MARK_SEATS: 'يُسجَّل الحضور في المباريات المفتوحة لكل لاعب على حدة، من قسم اللاعبين.',
  MATCH_ALREADY_IN: 'هذا الزبون موجود في المباراة أصلًا.',
  MATCH_BOOKING_NO_CAFE: 'لا تُضاف طلبات المقهى إلى حجز مباراة مفتوحة. يُرجى فتح فاتورة مقهى منفصلة.',
  SEAT_NOT_FOUND: 'تغيّر هذا المقعد، وحُدّثت القائمة.',
  SEAT_NOT_STARTED: 'لا يُسجَّل الغياب قبل بدء المباراة.',
  SEAT_MARK_LOCKED: 'لم يعد تعديل هذا التسجيل ممكنًا.',
  SEAT_OWED_CHANGED: 'تغيّر المستحق على هذا اللاعب للتو. يُرجى مراجعة المبلغ الجديد.',
  NOTHING_OWED: 'لا مبلغ مستحق على هذا المقعد.',
  PAYMENT_NOT_ON_MATCH: 'هذه الدفعة ليست على حجز هذه المباراة.',
  AMOUNT_OVER_SEAT: 'المبلغ أكبر مما تبقّى من حصة هذا اللاعب.',
  PAYMENT_OVER_ALLOCATED: 'المبلغ أكبر من المتبقي من الدفعة للتوزيع.',
  REPORT_NOT_FOUND: 'هذا البلاغ لم يعد موجودًا.',
  REPORT_CLOSED: 'سبقت معالجة هذا البلاغ.',
};
