/**
 * `seating.*` (Tournament seating board + tournament rows in My reservations, Tournament lane;
 * Majed, 2026-10-11; play-coaches contracts §5). Mirror every key in seating.ar.ts.
 *
 * The board's chair words are labels, never colour alone: "Open", "You", a player's name. The
 * court title reuses `tournaments.guest.detail.court` and the nameless player
 * `tournaments.common.player` / `formerPlayer`.
 */
export const seatingEn = {
  title: 'Seating',
  drawTitle: 'Round 1 courts',
  caption: {
    americano: 'Americano: partners rotate every round.',
    mexicano: 'Mexicano: pairs re-form by score after each round.',
  },
  order: 'Chairs fill in the order players register.',
  tapHint: 'Tap an open chair to take the next place.',
  fullHint: 'Every chair is taken. You can still join the waitlist.',
  legend: {
    taken: 'Taken',
    mine: 'You',
    open: 'Open',
  },
  chair: {
    taken: 'Taken',
    mine: 'You',
    open: 'Open',
  },
  chairA11y: '{court}, chair {chair}: {who}',
  registerHint: 'Registers you for this tournament',
  waitlistHint: 'Puts you on the waitlist',
  ownCourt: 'Your chair is on {court}.',
  ownSitOut: 'You sit out round 1.',
  sitOut: 'Sitting out round 1',
  showAll: 'Show all courts ({count})',
  showFewer: 'Show fewer courts',
  // My reservations (play-coaches §1): a tournament entry among the bookings.
  viewTournament: 'View tournament',
} as const;
