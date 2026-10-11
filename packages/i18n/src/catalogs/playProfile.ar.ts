import type { DeepMessages } from './ws/types';
import type { playProfileEn } from './playProfile.en';

/**
 * `playProfile.*` (Sign-up play survey + suggestions, Survey lane; Majed, 2026-10-11). Mirror every key in playProfile.en.ts.
 *
 * Addressed to a reader of either gender: no imperatives, and a verb in the
 * second person only where the script writes both the same (بدأت). The tiles
 * speak in the first person (ألعب، أتعلّم), which Arabic does not mark for
 * gender. «حصة» is the lesson, as everywhere in the app (coaching C-30).
 */
export const playProfileAr: DeepMessages<typeof playProfileEn> = {
  survey: {
    intro: 'ثلاثة أسئلة سريعة لمباريات تناسبك أكثر، ويمكن تخطّي أيٍّ منها.',
    skip: 'تخطٍّ',
    progress: 'السؤال {n} من {total}',
    level: {
      question: 'ما مستواك في البادل؟',
      new: { title: 'ما زلت في البداية', body: 'لم ألعب بعد، أو لعبت مرات قليلة' },
      beginner: { title: 'مستوى المبتدئين', body: 'أستطيع تبادل الكرة وما زلت أتعلّم' },
      intermediate: { title: 'مستوى متوسط', body: 'ألعب بانتظام وأستخدم الجدران' },
      advanced: { title: 'مستوى متقدّم', body: 'ألعب بسرعة وتقنية متينة، وأشارك في المنافسات' },
    },
    years: {
      question: 'منذ متى بدأت لعب البادل؟',
      never: 'لم أبدأ بعد',
      under_one: 'أقل من سنة',
      one_to_three: 'من سنة إلى ثلاث سنوات',
      three_plus: 'أكثر من ثلاث سنوات',
    },
    wants: {
      question: 'ما الذي يهمّك؟',
      hint: 'يمكن اختيار أكثر من خيار.',
      matches: { title: 'المباريات المفتوحة', body: 'الانضمام إلى مباراة مع لاعبين آخرين' },
      tournaments: { title: 'البطولات', body: 'أمسيات أمريكانو ومكسيكانو' },
      lessons: { title: 'الحصص', body: 'التعلّم مع مدرّب' },
    },
    saveFailed: 'لم يُحفظ ذلك، وإجاباتك ما زالت هنا.',
    saved: 'تم الحفظ',
  },
  result: {
    title: 'اقتراحاتنا للبداية',
    body: 'بناءً على إجاباتك، ويمكن تغييرها في أي وقت من «تعديل الملف الشخصي».',
  },
  kind: {
    coaches: 'مدرّبون لمستواك',
    classes: 'الحصص الجماعية',
    matches: 'المباريات المفتوحة',
    americano: 'بطولات أمريكانو',
    mexicano: 'بطولات مكسيكانو',
  },
  why: {
    starting: 'خطوة أولى سهلة',
    beginner: 'اختيار يناسب المبتدئين',
    intermediate: 'على قدر مستواك',
    advanced: 'تحدٍّ يليق بالمستوى المتقدّم',
    seasoned: 'لأصحاب الخبرة في اللعب',
    wantsLessons: 'لاهتمامك بالحصص',
    wantsMatches: 'لاهتمامك بالمباريات',
    wantsTournaments: 'لاهتمامك بالبطولات',
    general: 'بداية جيدة',
  },
  forYou: {
    title: 'مقترحات لك',
    askTitle: 'مستواك يساعدنا في اقتراح مباريات أنسب',
    askBody: 'ثلاثة أسئلة سريعة، ويمكن تخطّي أيٍّ منها.',
    askDismiss: 'ليس الآن',
    change: 'تغيير الإجابات',
  },
  row: {
    label: 'مستواك في اللعب',
  },
};
