import type { DeepMessages } from '../ws/types';
import type { staffNotesEn } from './notes.en';

export const staffNotesAr: DeepMessages<typeof staffNotesEn> = {
  title: 'ملاحظات على الأصناف الجديدة',
  lead: 'خلال 30 يوماً من إطلاق صنف جديد، دوّن ما يقوله الزبائن والفريق عنه. تدخل الملاحظات في مراجعة اليوم الثلاثين.',
  empty: 'لا يوجد صنف جديد في أيامه الثلاثين الأولى الآن.',
  pick: 'أي صنف؟',
  daysLeft: 'بقي {days} يوماً',
  lastDay: 'آخر يوم للملاحظات',
  closed: 'أُغلقت الملاحظات على هذا الصنف بعد 30 يوماً من إطلاقه.',
  body: 'ماذا سمعت أو رأيت؟',
  hint: 'اكتب ما قاله الزبائن، من دون أسماء أو أرقام هواتف.',
  add: 'أضف الملاحظة',
  added: 'أُضيفت الملاحظة',
  notesTitle: 'الملاحظات حتى الآن',
  none: 'لا ملاحظات على هذا الصنف بعد.',
  mine: 'أنت',
  by: '{name}، {when}',
  tooLong: 'اجعلها أقل من 2000 حرف.',
  required: 'اكتب شيئاً أولاً.',
};
