import type { DeepMessages } from './types';
import type { assistantFreeEn } from './assistantFree.en';

/**
 * `ws.assistantFree.*` بالعربية. Mirrors assistantFree.en.ts key-for-key (a missing key fails
 * typecheck).
 *
 * «المساعد المجاني» is the free AI everywhere; «المساعد المدفوع» is the owner's paid one.
 * GROQ_API_KEY stays in Latin script: it is the name of a setting, not a word.
 */
export const assistantFreeAr: DeepMessages<typeof assistantFreeEn> = {
  name: 'المساعد المجاني',
  badge: 'مجاني',
  hint: 'يدلّك على الصفحات ويشرح طريقة العمل، ولا يرى بياناتك',
  lead: 'المساعد المجاني يدلّك على الصفحات ويشرح طريقة العمل في التطبيق، ولا يرى المبيعات ولا الحجوزات ولا أي بيانات أخرى.',
  starters: {
    title: 'جرّب أن تسأل',
    tasks: 'أين أجد مهامي؟',
    break: 'كيف آخذ استراحة؟',
    incident: 'كيف أبلّغ عن حادثة؟',
  },
  composer: {
    placeholder: 'اسأل عن مكان شيء أو طريقة القيام به…',
    hint: 'مجاني. الإجابات من دليل التطبيق، لا من بياناتك.',
  },
  usePaid: 'استخدم المساعد المدفوع',
  newChat: 'محادثة جديدة',
  you: 'أنت',
  assistant: 'المساعد المجاني',
  thinking: 'يفكّر…',
  goTo: 'الانتقال إلى {page}',
  stopped: 'أُوقفت الإجابة قبل اكتمالها.',
  retry: 'أعد المحاولة',
  errors: {
    minute: {
      zero: 'طرحت أسئلة كثيرة خلال دقيقة؛ أعد المحاولة بعد لحظات.',
      one: 'طرحت أسئلة كثيرة خلال دقيقة؛ أعد المحاولة بعد ثانية.',
      two: 'طرحت أسئلة كثيرة خلال دقيقة؛ أعد المحاولة بعد ثانيتين.',
      few: 'طرحت أسئلة كثيرة خلال دقيقة؛ أعد المحاولة بعد {count} ثوانٍ.',
      many: 'طرحت أسئلة كثيرة خلال دقيقة؛ أعد المحاولة بعد {count} ثانية.',
      other: 'طرحت أسئلة كثيرة خلال دقيقة؛ أعد المحاولة بعد {count} ثانية.',
    },
    minuteSoon: 'طرحت أسئلة كثيرة خلال دقيقة؛ أعد المحاولة بعد قليل.',
    day: 'نفدت أسئلة اليوم المجانية؛ تعود غدًا.',
    club: 'المساعد المجاني مشغول الآن؛ أعد المحاولة بعد دقيقة.',
    notConfigured: 'المساعد المجاني غير مُعدّ بعد (GROQ_API_KEY).',
    timeout: 'استغرقت الإجابة وقتًا طويلًا فأُوقفت.',
    generic: 'لم يُجب المساعد المجاني. تحقّق من الاتصال وأعد المحاولة.',
  },
};
