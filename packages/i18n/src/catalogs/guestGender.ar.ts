import type { DeepMessages } from './ws/types';
import type { guestGenderEn } from './guestGender.en';

/**
 * `guestGender.*` (Gender hours, the phone's side; Majed, 2026-10-19, migration 0353). Mirror
 * every key in guestGender.en.ts.
 *
 * Addressed to a reader of either gender, as playProfile.ar.ts is: no gendered imperatives
 * («يلزم اختيار»، «يمكن اختيار» rather than «اختر»).
 */
export const guestGenderAr: DeepMessages<typeof guestGenderEn> = {
  hint: 'بعض الملاعب والأوقات مخصصة للنساء أو للرجال. يكون الاختيار مرة واحدة، ويمكن لموظفي الاستقبال تصحيحه.',
  required: 'يلزم اختيار «امرأة» أو «رجل» للمتابعة.',
  completeBody: 'بقيت إجابة واحدة في ملفك الشخصي قبل الحجز.',
  tagBoth: 'غير متاح للحجز',
  match: {
    lockedWomen: 'هذا الوقت مخصص للنساء، لذا تكون المباراة للنساء فقط.',
    lockedMen: 'هذا الوقت مخصص للرجال، لذا تكون المباراة للرجال فقط.',
    closedWomen: 'هذا الوقت مخصص للنساء فقط. يمكن اختيار وقت آخر.',
    closedMen: 'هذا الوقت مخصص للرجال فقط. يمكن اختيار وقت آخر.',
    closedBoth: 'هذا الوقت غير متاح للمباريات. يمكن اختيار وقت آخر.',
  },
};
