import type { DeepMessages } from './types';
import type { coachingMoneyEn } from './coachingMoney.en';

/**
 * `ws.coaching.*` money groups بالعربية. Mirrors coachingMoney.en.ts.
 * DRAFT-AR (docs/design/coaching/operator.md §5.20); «كشف حساب» a statement,
 * «أجرة الملعب» the court share, «نصيب المدرّب» the coach's share, «مستحق
 * للمدرّبين» owed to coaches (the coaching glossary, R55, R81).
 */
export const coachingMoneyAr: DeepMessages<typeof coachingMoneyEn> = {};
