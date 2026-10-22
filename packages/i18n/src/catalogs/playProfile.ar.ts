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
    intro: 'بضعة أسئلة سريعة لنقترح عليك مباريات أنسب. يمكن تخطّي أي سؤال.',
    skip: 'تخطّي',
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
      notWithLevel: 'اخترت «{level}»، أي أنك لعبت من قبل',
    },
    wants: {
      question: 'ما الذي يهمّك؟',
      hint: 'يمكن اختيار أكثر من خيار.',
      matches: { title: 'المباريات المفتوحة', body: 'الانضمام إلى مباراة مع لاعبين آخرين' },
      tournaments: { title: 'البطولات', body: 'أمسيات أمريكانو ومكسيكانو' },
      lessons: { title: 'الحصص', body: 'التعلّم مع مدرّب' },
    },
    gender: {
      question: 'هل أنت امرأة أم رجل؟',
      hint: 'للمباريات والبطولات الخاصة بالنساء أو بالرجال. بعد الحفظ، لا يغيّره إلا موظفو الاستقبال.',
    },
    saveFailed: 'تعذّر الحفظ. إجاباتك ما زالت هنا.',
    saved: 'تم الحفظ',
  },
  result: {
    title: 'اقتراحاتنا للبداية',
    body: 'بناءً على إجاباتك. يمكن تغييرها في أي وقت من «تعديل الملف الشخصي».',
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
    askBody: 'بضعة أسئلة سريعة. يمكن تخطّي أي سؤال.',
    askDismiss: 'ليس الآن',
    change: 'تغيير الإجابات',
    moreHint: 'لمزيد من الاقتراحات، يمكن اختيار ما يهمّك.',
  },
  row: {
    label: 'مستواك في اللعب',
  },
};
