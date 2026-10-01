/**
 * The one coaching glossary (C-30, R55, R72): the words every coaching catalog builds from, on the
 * phone (`coaching.*`), the website (`coaching.web`) and the operator (`ws/coaching*`). A catalog
 * imports these constants rather than retyping the words, so the apps cannot drift apart.
 *
 * Binding (R55): «حصة» is a lesson in every app, never «درس»; «أجرة الملعب» is the court share and
 * «نصيب المدرّب» the coach's share, never «حصة الملعب» / «حصة المدرّب» (حصة already means
 * "lesson"). The rest is the terms table of docs/design/coaching/guest.md §4.15, plus the
 * operator's own words from operator.md §5.20 where the two tables do not overlap.
 *
 * DRAFT-AR: every Arabic word here is on the client's review list. A coach or student in the
 * third person is masculine in v1 (no gender is stored, operator.md §5.20).
 *
 * This is not a catalog: it adds no `t()` key. The app lanes add their catalog keys to
 * `coaching.*` and `ws/coaching*`, which read these words.
 */

const coachingGlossaryEn = {
  /** Any kind of lesson (C-30). */
  lesson: 'lesson',
  lessons: 'lessons',
  privateLesson: 'private lesson',
  groupSession: 'group session',
  course: 'course',
  /** One session of a course ("session 3 of 8"); the same Arabic word as `lesson`. */
  session: 'session',
  sessions: 'sessions',
  lessonType: 'lesson type',
  coach: 'coach',
  theCoach: 'the coach',
  student: 'student',
  /** The generic plural (guest.md §4.15). */
  students: 'students',
  place: 'place',
  places: 'places',
  signUp: 'sign-up',
  coachMode: 'coach mode',
  /** A coach's weekly hours. */
  hours: 'hours',
  timeOff: 'time off',
  /** A coach's monthly statement. */
  statement: 'statement',
  /** R55: the fixed amount per session the venue keeps for the court (C-6). */
  courtShare: 'court share',
  /** R55: what the coach earns (C-6). */
  coachShare: "coach's share",
  adjustments: 'adjustments',
  owedToCoaches: 'owed to coaches',
  coachPay: 'coach pay',
  /** The minimum-places cut-off (C-14). */
  cutoff: 'cut-off',
  attended: 'attended',
  noShow: 'no-show',
  walkIn: 'walk-in',
  frontDesk: 'front desk',
  venue: 'venue',
  till: 'till',
} as const;

export type CoachingTerm = keyof typeof coachingGlossaryEn;

export interface CoachingGlossary {
  readonly en: Readonly<Record<CoachingTerm, string>>;
  readonly ar: Readonly<Record<CoachingTerm, string>>;
}

export const coachingGlossary: CoachingGlossary = {
  en: coachingGlossaryEn,
  ar: {
    lesson: 'حصة',
    lessons: 'حصص',
    privateLesson: 'حصة خاصة',
    groupSession: 'حصة جماعية',
    course: 'دورة',
    session: 'حصة',
    sessions: 'حصص',
    lessonType: 'نوع الحصة',
    coach: 'مدرّب',
    theCoach: 'المدرّب',
    student: 'متدرّب',
    students: 'المتدرّبون',
    place: 'مكان',
    places: 'أماكن',
    signUp: 'تسجيل',
    coachMode: 'وضع المدرّب',
    hours: 'أوقات التدريب',
    timeOff: 'إجازة',
    statement: 'كشف حساب',
    courtShare: 'أجرة الملعب',
    coachShare: 'نصيب المدرّب',
    adjustments: 'التسويات',
    owedToCoaches: 'مستحق للمدرّبين',
    coachPay: 'مستحقات المدرّبين',
    cutoff: 'آخر موعد للتسجيل',
    attended: 'حضور',
    noShow: 'غياب',
    walkIn: 'زبون عابر',
    frontDesk: 'الاستقبال',
    venue: 'النادي',
    till: 'الصندوق',
  },
};
