/**
 * `tournaments.web`: the website's tournament words (T-8; build contracts §1.11): the landing's
 * event cards and the noindex `/[locale]/events/[id]` page. Owned by the web lane; spread into
 * tournaments.en.ts. Mirror every key in tournaments.web.ar.ts.
 *
 * Names on the page are "First I." only, never the waitlist (§1.8). The formats, states, the
 * free-entry and player words are `tournaments.common.*`; the category pills the open-match words
 * (`matches.common.category*`).
 */
export const tournamentsWebEn = {
  web: {
    // "Entry 25,000 IQD" (formatIQD; the free case is tournaments.common.free).
    fee: 'Entry {amount}',
    // In the branch's timezone: "Thu 2 Oct 2026 · 6:00 PM – 10:00 PM" (date and times isolated).
    when: '{weekday} {date} · {from} – {to}',
    eventsCards: {
      title: 'Upcoming tournaments',
      // {count}: LTR-isolated Latin digits.
      placesLeft: 'Places left: {count}',
      full: 'Full: waitlist open',
      fullNoWaitlist: 'Full',
      registerInApp: 'Register in the app',
      details: 'Details',
    },
    page: {
      title: 'Tournament',
      metaDescription:
        'A padel tournament at Touch Padel: the schedule, the scores and the standings.',
      schedule: 'Schedule',
      standings: 'Standings',
      cancelled: 'This tournament was cancelled.',
      missing: 'This tournament is not available.',
      error: 'This page could not be loaded. Please try again in a moment.',
      court: 'Court {court}',
      // A team of two: "Sara A. & Huda K." (each name isolated).
      team: '{one} & {two}',
      vs: 'vs',
      notPlayed: 'To play',
      scoring: 'Scoring',
      places: 'Places',
      sitOut: 'Sitting out: {players}',
      noSchedule: 'The schedule appears here once play starts.',
      entries: 'Players entered: {count}',
      live: 'Updates every 30 seconds while play is on.',
      registerInApp: 'Register in the app',
      openInApp: 'Open in the app',
      noApp: "Don't have the app?",
      allEvents: 'All tournaments',
      col: {
        rank: 'Rank',
        player: 'Player',
        points: 'Points',
        diff: 'Difference',
        played: 'Played',
      },
    },
  },
};
