/**
 * `play.*` (Play tab (open matches + tournaments together), Play lane; Majed, 2026-10-11). Mirror every key in play.ar.ts.
 *
 * The tab reuses the open-match and tournament words wherever the text is the
 * same (`matches.list.*`, `matches.detail.join`, `tournaments.guest.list.*`,
 * `tournaments.common.*`); only what is new to a page holding both lives here.
 */
export const playEn = {
  // The page's one action, beside the title: opens the Book sheet, where a free time starts it.
  start: 'Book & invite',
  // The kind switch's middle segment (All is `matches.list.filterAll`, Tournaments
  // `tournaments.guest.list.title`).
  kindMatches: 'Matches',
  // The branch has open matches off AND no branch runs tournaments.
  off: 'Open matches and tournaments are not running at this branch right now.',
  // Nothing on either side, with no chip narrowing it.
  emptyBody: 'No open matches or tournaments coming up. Start a match from any free time.',
  // One side failed to load while the other is on the page.
  matchesError: "Couldn't load matches.",
  // 0339: a signed-in guest who skipped the level or years question sees every tournament.
  fitAsk: 'Set your level to see your tournaments.',
  // The round filter button in the title bar (Sait, 2026-10-20): its spoken name
  // while "All" is on (a category speaks its own name).
  filter: {
    label: 'Filter',
  },
  // Both sides failed.
  loadError: "Couldn't load matches or tournaments.",
  // The court under the title (packages/court3d join.ts): the next open match, its
  // open seats marked on it. Its caption is "Tonight · 9:00 PM · 2 seats left"
  // (built from the night, the time and `matches.count.seatsLeft`); these are the rest.
  court: {
    // No match has a seat open: the caption reads "No open seats right now · Start a match".
    none: 'No open seats right now',
    // Screen readers, on the caption: what a tap does.
    hint: 'Shows this match in the list',
  },
} as const;
