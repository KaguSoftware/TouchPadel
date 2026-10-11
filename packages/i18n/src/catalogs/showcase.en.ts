/**
 * `coachShowcase.*` (Coaches tab showcase, Coaches lane; Majed, 2026-10-11). Mirror every key in showcase.ar.ts.
 *
 * The levels describe the PLAYER a coach's lessons suit, never a coach's rank
 * (play-coaches contracts §6: no hierarchy between coaches). The page title,
 * the states and the kinds reuse `coaching.*`.
 */
export const coachShowcaseEn = {
  // Above the level switch: the guest picks their own level.
  yourLevel: 'Your level',
  levels: {
    all: 'All',
    beginner: 'Beginner',
    intermediate: 'Intermediate',
    advanced: 'Advanced',
  },
  // One line under the switch, about the player the level means.
  levelLine: {
    all: 'Every coach teaching at this branch.',
    beginner: 'For players just starting out.',
    intermediate: 'For players who can rally and want more.',
    advanced: 'For competitive players sharpening their game.',
  },
  // Under the coaches: why the order moves.
  fairOrder: 'The order changes every day.',
  // The two ways on from the page.
  classesTitle: 'Group sessions',
  classesSub: 'Join a group, no partner needed',
  myLessonsSub: 'The lessons you booked',
  emptyLevel: {
    title: 'No coaches for this level yet',
    message: 'You can see every coach at this branch under All.',
    action: 'Show all coaches',
  },
  // The coach page: the levels a coach teaches, as pills.
  levelsTitle: 'Player level',
  allLevels: 'All levels',
} as const;
