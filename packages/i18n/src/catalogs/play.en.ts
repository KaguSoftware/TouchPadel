/**
 * `play.*` (Play tab (open matches + tournaments together), Play lane; Majed, 2026-10-11). Mirror every key in play.ar.ts.
 *
 * The tab reuses the open-match and tournament words wherever the text is the
 * same (`matches.list.*`, `matches.detail.join`, `tournaments.guest.list.*`,
 * `tournaments.common.*`); only what is new to a page holding both lives here.
 * Counts arrive phrased: `count.tournaments` goes through `countPhrase`.
 */
export const playEn = {
  // The page's one action, beside the title: opens the Book sheet, where a free time starts it.
  start: 'Start a match',
  // The kind switch's middle segment (All is `matches.list.filterAll`, Tournaments
  // `tournaments.guest.list.title`).
  kindMatches: 'Matches',
  // The branch has open matches off AND no branch runs tournaments.
  off: 'Open matches and tournaments are not running at this branch right now.',
  // Nothing on either side, with no chip narrowing it.
  emptyBody: 'No open matches or tournaments coming up. Start a match from any free time.',
  // One side failed to load while the other is on the page.
  matchesError: 'The open matches could not be loaded.',
  // Both sides failed.
  loadError: 'Open matches and tournaments could not be loaded.',
  // The court under the title (packages/court3d join.ts): the next open match, its
  // open seats marked on it. Its caption is "Tonight · 9:00 PM · 2 seats left"
  // (built from the night, the time and `matches.count.seatsLeft`); these are the rest.
  court: {
    // No match has a seat open: the caption reads "No open seats right now · Start a match".
    none: 'No open seats right now',
    // Screen readers, on the caption: what a tap does.
    hint: 'Shows this match in the list',
  },
  count: {
    // A night's line beside `matches.count.openMatches`: "2 open matches · 1 tournament".
    tournaments: {
      zero: 'No tournaments',
      one: '1 tournament',
      two: '2 tournaments',
      few: '{count} tournaments',
      many: '{count} tournaments',
      other: '{count} tournaments',
    },
  },
} as const;
