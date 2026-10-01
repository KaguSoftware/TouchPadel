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
  ONLINE_PAYMENT_OFF: 'الدفع الإلكتروني للحصص غير متاح هنا.',
  STATEMENT_NOT_DRAFT: 'لم يعد هذا الكشف مسودة.',
};
