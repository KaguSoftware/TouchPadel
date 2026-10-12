/**
 * `coachShowcase.*` (Coaches tab showcase, Coaches lane; Majed, 2026-10-11). Mirror every key in showcase.ar.ts.
 *
 * The levels describe the PLAYER a coach's lessons suit, never a coach's rank
 * (play-coaches contracts §6: no hierarchy between coaches). The page title,
 * the states and the kinds reuse `coaching.*`.
 */
export const coachShowcaseEn = {
  levels: {
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
  },
  // Under the coaches: why the order moves.
  fairOrder: 'The order changes every day.',
  // The two ways on from the page.
  classesTitle: 'Group sessions',
  classesSub: 'Join a group, no partner needed',
  myLessonsSub: 'The lessons you booked',
  emptyLevel: {
    title: 'No coaches for this level yet',
    message: 'Every coach at this branch is still one tap away.',
    action: 'Show all coaches',
  },
  // The coach page: the levels a coach teaches, as pills.
  levelsTitle: 'Player level',
  allLevels: 'All levels',
} as const;
