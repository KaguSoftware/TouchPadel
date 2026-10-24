/**
 * `playProfile.*` (Sign-up play survey + suggestions, Survey lane; Majed, 2026-10-11). Mirror every key in playProfile.ar.ts.
 *
 * The survey (apps/mobile/app/play-survey.tsx), the "For you" strip on the Play tab
 * (src/components/forYou.tsx) and Edit profile's "Your game" row. Short and warm, never a
 * nag: every question is optional and the copy says so once, at the start.
 */
export const playProfileEn = {
  survey: {
    intro: 'A few quick questions for better matches. Only your level is needed; skip the rest.',
    skip: 'Skip',
    progress: 'Question {n} of {total}',
    level: {
      question: "What's your level?",
      new: { title: 'Just starting', body: "I haven't played, or only a few times" },
      beginner: { title: 'Beginner', body: "I can keep a rally going and I'm still learning" },
      intermediate: { title: 'Intermediate', body: 'I play regularly and use the walls' },
      advanced: { title: 'Advanced', body: 'I play fast, with solid technique, and compete' },
    },
    // 0368 (customers contracts §4): asked while the profile has no band, so
    // an older account and a social sign-in answer it here.
    age: {
      question: 'How old are you?',
      hint: 'A range is enough. It tells us who actually plays here, so the nights and offers suit them.',
    },
    years: {
      question: 'How long have you played?',
      never: 'Not yet',
      under_one: 'Less than a year',
      one_to_three: '1 to 3 years',
      three_plus: 'More than 3 years',
      // Under "Not yet" when the level says they have played (yearsFitLevel).
      notWithLevel: "You picked {level}, so you've played before",
    },
    wants: {
      question: 'What are you after?',
      hint: 'Pick as many as you like.',
      matches: { title: 'Open matches', body: 'Join a game with other players' },
      tournaments: { title: 'Tournaments', body: 'Americano and Mexicano nights' },
      lessons: { title: 'Lessons', body: 'Learn with a coach' },
    },
    // Asked only while the profile has none; set once (OM-28).
    gender: {
      question: 'Are you a woman or a man?',
      hint: "For women-only and men-only matches and tournaments. Once saved, only the front desk can change it.",
    },
    saveFailed: "That didn't save. Your answers are still here.",
    saved: 'Saved',
  },
  result: {
    title: "Here's where to start",
    body: 'Based on your answers. You can change them any time in Edit profile.',
  },
  kind: {
    coaches: 'Coaches for your level',
    classes: 'Group sessions',
    matches: 'Open matches',
    americano: 'Americano tournaments',
    mexicano: 'Mexicano tournaments',
  },
  why: {
    starting: 'An easy first step',
    beginner: 'Picked for beginners',
    intermediate: 'Right for your level',
    advanced: 'A real test at the top level',
    seasoned: 'For players with a few years in',
    wantsLessons: 'You said lessons interest you',
    wantsMatches: 'You said matches interest you',
    wantsTournaments: 'You said tournaments interest you',
    general: 'A good place to start',
  },
  forYou: {
    title: 'For you',
    askTitle: 'Tell us your level for better matches',
    askBody: 'A few quick questions. Skip any of them.',
    askDismiss: 'Not now',
    change: 'Change answers',
    // Under the strip while "What are you after?" has no answer (group sessions alone above it).
    moreHint: "Want more suggestions? Tell us what you're after.",
  },
  row: {
    label: 'Your game',
  },
} as const;
