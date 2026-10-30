import type { DeepMessages } from './ws/types';
import type { opErrorsCoachingEn } from './opErrors.coaching.en';

/**
 * `op.errors.<CODE>` بالعربية للتدريب والحصص. Mirrors opErrors.coaching.en.ts
 * key-for-key; the `DeepMessages` type fails the typecheck on a missing or extra
 * key.
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/coaching/operator.md §5.19). The lesson is «حصة» everywhere
 * (C-30, R55).
 */
export const opErrorsCoachingAr: DeepMessages<typeof opErrorsCoachingEn> = {
  ONLINE_PAYMENTS_PAUSED: 'المدفوعات الإلكترونية متوقفة مؤقتًا. لا يمكن تفعيل هذا الإعداد حاليًا.',
  ONLINE_PAYMENT_OFF: 'الدفع الإلكتروني للحصص غير متاح هنا.',
  STATEMENT_NOT_DRAFT: 'لم يعد هذا الكشف مسودة.',
  LESSON_VIA_COACHING: 'هذا الملعب محجوز لحصة. عدّله من صفحة الحصة.',
  ENROLMENT_NOT_FOUND: 'تغيّر هذا التسجيل، وحُدّثت القائمة.',
  LESSON_NOT_PAYABLE: 'لا يمكن استلام أي مبلغ عن هذا التسجيل الآن.',
  LESSON_OWED_CHANGED: 'تغيّر المبلغ المستحق عن هذه الحصة للتو. راجِع المبلغ الجديد.',
  LESSON_TAB_NO_GOODS: 'لا تُضاف أصناف الكافيه إلى فاتورة الحصة. افتح فاتورة كافيه منفصلة.',
  REFUND_EXCEEDS_DUE:
    'هذا المبلغ أكبر من المستحق ردّه. حدّث القائمة، أو اختر «رد بحسن نية» لتردّ مبلغًا أكبر.',
  NOT_A_COACH: 'هذا الحساب ليس حساب مدرّب.',
  ALREADY_COACH: 'هذا الزبون مدرّب أصلًا.',
  COACH_NOT_FOUND: 'تعذّر العثور على هذا المدرّب.',
  COACH_NOT_AT_BRANCH: 'لا يدرّب هذا المدرّب في هذا الفرع.',
  COACH_SLUG_TAKEN: 'مدرّب آخر يستخدم اسم الرابط هذا. اختر اسمًا آخر.',
  LESSON_TYPE_NOT_FOUND: 'تعذّر العثور على نوع الحصة هذا.',
  LESSON_TYPE_NOT_OFFERED: 'لا يقدّم هذا المدرّب نوع الحصة هذا.',
  HOURS_INVALID: 'يجب أن تبدأ كل فترة قبل أن تنتهي، وفي اليوم نفسه.',
  HOURS_OVERLAP: 'تتداخل هذه الساعات مع ساعات أخرى لهذا المدرّب.',
  TIME_OFF_HAS_LESSONS: 'لدى المدرّب حصص في هذه الفترة. ألغِها أو انقلها أولًا.',
  COACHING_OFF: 'الحصص متوقفة في هذا الفرع.',
  COACH_INACTIVE: 'هذا المدرّب موقوف مؤقتًا أو متقاعد، فلا يمكن حجز حصص جديدة معه.',
  LESSON_TYPE_INACTIVE: 'نوع الحصة هذا غير معروض للبيع.',
  COACH_UNAVAILABLE: 'المدرّب لا يعمل في هذا الوقت.',
  COACH_BUSY: 'لدى المدرّب حصة أخرى في هذا الوقت.',
  GUEST_BUSY: 'لديك حصة أخرى في هذا الوقت.',
  NO_COURT_FREE: 'لا يوجد ملعب متاح في هذا الوقت.',
  SLOT_NOT_ON_GRID: 'تبدأ الحصص عند رأس الساعة أو نصفها.',
  PARTY_TOO_LARGE: 'العدد أكبر مما تتّسع له هذه الحصة.',
  LESSON_FULL: 'لم يبقَ مكان في هذه الحصة.',
  LESSON_CLOSED: 'لم تعد هذه الحصة تقبل التسجيل.',
  ALREADY_ENROLLED: 'هذا الشخص مسجّل أصلًا.',
  LESSON_NOT_FOUND: 'لم تعد هذه الحصة في هذا الفرع.',
  LESSON_NOT_CANCELLABLE: 'لم يعد إلغاء هذه الحصة ممكنًا.',
  ONLINE_PAYMENT_REQUIRED: 'يقبل هذا الفرع دفع الحصص إلكترونيًا فقط.',
  COURSE_STARTS_INVALID: 'مواعيد الدورة غير صحيحة. ضع موعدًا لكل حصة، وكل موعد بعد الذي قبله، وكلها خلال سنة.',
  SESSION_NOT_MOVABLE: 'لم يعد نقل هذه الحصة ممكنًا.',
  COACH_ADD_LIMIT: 'بلغ هذا المدرّب الحدّ المسموح لإضافة المتدرّبين.',
  STATEMENT_NOT_APPROVED: 'اعتمِد الكشف أولًا، ثم سجّله مدفوعًا.',
  STATEMENT_REFERENCE_REQUIRED: 'أدخِل مرجع الدفع.',
};
