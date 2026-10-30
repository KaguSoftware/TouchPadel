import type { DeepMessages } from './ws/types';
import type { opErrorsTournamentsEn } from './opErrors.tournaments.en';

/**
 * `op.errors.<CODE>` بالعربية للبطولات. Mirrors opErrors.tournaments.en.ts key-for-key; the
 * `DeepMessages` type fails the typecheck on a missing or extra key.
 *
 * DRAFT-AR: every line here is on the client's review list
 * (docs/design/tournaments/build-contracts-2026-10-03.md §1.9). The tournament is «بطولة», an
 * entry «اشتراك», the waitlist «قائمة الانتظار».
 */
export const opErrorsTournamentsAr: DeepMessages<typeof opErrorsTournamentsEn> = {
  TOURNAMENTS_OFF: 'البطولات متوقفة في هذا الفرع.',
  TOURNAMENT_NOT_FOUND: 'تعذّر العثور على هذه البطولة، وحُدّثت القائمة.',
  TOURNAMENT_PUBLISH_REFUSED: 'لا يمكن نشر هذه الخطة بطولةً بعد.',
  TOURNAMENT_NOT_OPEN: 'التسجيل في هذه البطولة غير مفتوح.',
  TOURNAMENT_FULL: 'اكتملت هذه البطولة وقائمة انتظارها.',
  TOURNAMENT_CATEGORY_MISMATCH: 'فئة هذه البطولة لا تناسب هذا اللاعب.',
  TOURNAMENT_PROFILE_REQUIRED: 'للتسجيل في هذه البطولة، أجِب عن سؤالَي المستوى وسنوات اللعب.',
  TOURNAMENT_LEVEL_MISMATCH: 'هذه البطولة للاعبين من مستوى أو خبرة مختلفة.',
  TOURNAMENT_ENTRY_NOT_FOUND: 'تغيّر هذا الاشتراك، وحُدّثت القائمة.',
  TOURNAMENT_SEAT_TAKEN: 'حُجز هذا المقعد للتو. يمكن اختيار مقعد متاح آخر.',
  TOURNAMENT_ROUNDS_INVALID: 'تعذّر حفظ هذه الجولات. حدّث الصفحة ثم أنشئها من جديد.',
  TOURNAMENT_SCORE_REFUSED: 'تعذّر حفظ هذه النتيجة. راجِعها وحاول مجددًا.',
  TOURNAMENT_UNDER_FILLED: 'عدد المسجّلين أقل من الحد الأدنى. أضِف لاعبين أو ألغِ البطولة.',
  TOURNAMENT_FINISH_REFUSED:
    'لا يمكن إنهاء هذه البطولة بعد. سجّل نتائج الجولة الجارية أولًا. إن لم تُلعب أي جولة، فألغِ البطولة.',
  TOURNAMENT_NOT_PAYABLE: 'لا يمكن استلام أي مبلغ عن هذا الاشتراك الآن.',
  TOURNAMENT_OWED_CHANGED: 'تغيّر المبلغ المستحق عن هذا الاشتراك للتو. راجِع المبلغ الجديد.',
  TOURNAMENT_VIA_EVENTS: 'هذا الملعب محجوز لبطولة. عدّله من صفحة البطولة.',
};
