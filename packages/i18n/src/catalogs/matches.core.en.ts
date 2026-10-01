/**
 * `matches.{common, count, states, link}`: the words every open-match screen
 * shares, the counted phrases, the guest states and the links in
 * (docs/design/open-matches/guest.md §4.15, §4.18, §4.24). Owned by the mobile
 * foundation lane; spread into matches.en.ts. Mirror every key in
 * matches.core.ar.ts.
 *
 * `count.<key>` is a counted phrase for `countPhrase` (packages/i18n/src/plural.ts):
 * an object with all six forms `zero, one, two, few, many, other`. English
 * reads `one`, `other` and, at 0, `zero` ("No seats left"). Each form carries
 * the placeholders its Arabic twin carries (t.test.ts holds them equal), so an
 * English form Arabic words without `{count}` spells its number instead
 * ("1 seat left"; `two` is never read in English and says "2").
 *
 * A player in the third person comes as a pair `x` / `xF` (EN repeats the
 * text): the Arabic takes the feminine in a `women` match (guest.md §4.24,
 * `byCategory` in apps/mobile/src/features/matches/logic.ts).
 *
 * `states.*` are the parts of the §4.15 lines. apps/mobile's `stateLine`
 * joins them with " · ", and drops the ticket phrase (`count.ticketsBack`,
 * `count.ticketsLost`) for a seat the desk linked, which holds no ticket.
 */
export const matchesCoreEn = {
  common: {
    title: 'Open match',
    player: 'Player',
    playerF: 'Player',
    formerPlayer: 'Former player',
    formerPlayerF: 'Former player',
    organiser: 'Organiser',
    organiserF: 'Organiser',
    you: 'You',
    openSeat: 'Open seat',
    openSeatTaking: 'Open seat · taking a player',
    openSeatTakingF: 'Open seat · taking a player',
    // A friend seat: the holder's name (isolated) and "+1" (LTR-isolated).
    friendSeat: '{name} {extra}',
    // "3/4": Latin digits; the caller LTR-isolates the whole fraction as one
    // unit (`seatsOfLabel`), so the slash never flips in Arabic.
    seatsOf: '{taken}/{total}',
    categoryOpen: 'Open to all',
    categoryWomen: 'Women only',
    categoryMen: 'Men only',
    approves: 'The organiser approves each player',
    approvesF: 'The organiser approves each player',
    shareAtDesk: '{share} at the desk',
  },
  count: {
    seatsLeft: {
      zero: 'No seats left',
      one: '1 seat left',
      two: '2 seats left',
      few: '{count} seats left',
      many: '{count} seats left',
      other: '{count} seats left',
    },
    seats: {
      zero: 'No seats',
      one: '1 seat',
      two: '2 seats',
      few: '{count} seats',
      many: '{count} seats',
      other: '{count} seats',
    },
    tickets: {
      zero: 'No tickets',
      one: '1 ticket',
      two: '2 tickets',
      few: '{count} tickets',
      many: '{count} tickets',
      other: '{count} tickets',
    },
    // After a verbal noun or a preposition ("You need {tickets} more"): the
    // Arabic dual takes its genitive form here.
    ticketsGen: {
      zero: 'no tickets',
      one: '1 ticket',
      two: '2 tickets',
      few: '{count} tickets',
      many: '{count} tickets',
      other: '{count} tickets',
    },
    ticketsReady: {
      zero: 'No tickets yet',
      one: '1 ticket ready',
      two: '2 tickets ready',
      few: '{count} tickets ready',
      many: '{count} tickets ready',
      other: '{count} tickets ready',
    },
    ticketsHeld: {
      zero: 'None held for requests',
      one: '1 held for a request',
      two: '2 held for requests',
      few: '{count} held for requests',
      many: '{count} held for requests',
      other: '{count} held for requests',
    },
    ticketsInMatch: {
      zero: 'None in matches',
      one: '1 in a match',
      two: '2 in matches',
      few: '{count} in matches',
      many: '{count} in matches',
      other: '{count} in matches',
    },
    ticketsUse: {
      zero: 'Uses no tickets',
      one: 'Uses 1 ticket',
      two: 'Uses 2 tickets',
      few: 'Uses {count} tickets',
      many: 'Uses {count} tickets',
      other: 'Uses {count} tickets',
    },
    ticketsBack: {
      zero: 'tickets back',
      one: 'ticket back',
      two: 'tickets back',
      few: 'tickets back',
      many: 'tickets back',
      other: 'tickets back',
    },
    ticketsLost: {
      zero: 'tickets lost',
      one: 'ticket lost',
      two: 'tickets lost',
      few: 'tickets lost',
      many: 'tickets lost',
      other: 'tickets lost',
    },
    // After "waiting for".
    playersNeeded: {
      zero: 'no more players',
      one: '1 more player',
      two: '2 more players',
      few: '{count} more players',
      many: '{count} more players',
      other: '{count} more players',
    },
    playersNeededF: {
      zero: 'no more players',
      one: '1 more player',
      two: '2 more players',
      few: '{count} more players',
      many: '{count} more players',
      other: '{count} more players',
    },
    games: {
      zero: 'no games yet',
      one: '1 game',
      two: '2 games',
      few: '{count} games',
      many: '{count} games',
      other: '{count} games',
    },
    noShows: {
      zero: 'no no-shows',
      one: '1 no-show',
      two: '2 no-shows',
      few: '{count} no-shows',
      many: '{count} no-shows',
      other: '{count} no-shows',
    },
    openMatches: {
      zero: 'No open matches',
      one: '1 open match',
      two: '2 open matches',
      few: '{count} open matches',
      many: '{count} open matches',
      other: '{count} open matches',
    },
    openMatchesSoon: {
      zero: 'No open matches coming up',
      one: '1 open match coming up',
      two: '2 open matches coming up',
      few: '{count} open matches coming up',
      many: '{count} open matches coming up',
      other: '{count} open matches coming up',
    },
    minutes: {
      zero: '{count} minutes',
      one: '1 minute',
      two: '2 minutes',
      few: '{count} minutes',
      many: '{count} minutes',
      other: '{count} minutes',
    },
  },
  // The §4.15 table, row by row. {tickets} in `inWallet` is a counted
  // `ticketsBack`; {players} a counted `playersNeeded`; {time} a branch-local
  // time; {share} an IQD amount; {seats} the "3/4" of `common.seatsOf`,
  // LTR-isolated as one unit.
  states: {
    requested: 'Request sent · waiting for the organiser',
    requestedF: 'Request sent · waiting for the organiser',
    declined: 'Request not accepted',
    withdrawn: 'Request withdrawn',
    requestExpired: 'Request closed',
    approvedIn: "Approved · you're in · {seats}",
    in: "You're in · waiting for {players} · fills by {time}",
    awaitingCourt: 'Four players · waiting for a court',
    booked: 'Booked',
    checkedIn: 'Checked in',
    leftLate: 'You left · your ticket is held until someone takes your seat',
    removedLate: 'The venue removed you · your ticket is held until someone takes your seat',
    leftLateLost: 'You left and nobody took your seat · ticket lost',
    removedLateLost: 'The venue removed you and nobody took your seat · ticket lost',
    leftDesk: 'You left this match',
    refilled: 'Someone took your seat',
    refilledF: 'Someone took your seat',
    calledOff: 'Called off at the desk',
    nothingToPay: 'nothing to pay',
    played: 'Played',
    noShow: 'Marked as not attended',
    // eslint-disable-next-line no-restricted-syntax -- the status or event 'left', a catalog key, not CSS
    left: 'You left',
    removed: 'Removed by the organiser',
    removedF: 'Removed by the organiser',
    cantRejoin: "you can't rejoin this match",
    removedByVenue: 'Removed by the venue',
    banned: "Removed · open matches aren't available on your account",
    bumped: 'Cancelled · a group booked the last court',
    expired: "Cancelled · didn't fill by {time}",
    noCourt: 'Cancelled · no court came free',
    cancelledByOrganiser: 'Cancelled by the organiser',
    cancelledByOrganiserF: 'Cancelled by the organiser',
    cancelledByMe: 'You cancelled this match',
    cancelledByVenue: 'Cancelled by the venue',
    closedEmpty: 'Closed · everyone left',
    unknown: 'Open match',
    inWallet: '{tickets} in your wallet',
  },
  // Links in (§4.18): the invite a signed-out guest opens, the card a
  // restricted viewer gets, the welcome banner and the share sheet.
  link: {
    waiting: 'Opening the match…',
    signIn: 'Sign in to join',
    signUp: 'Create an account',
    full: 'This match is full',
    closed: 'This match is no longer open',
    find: 'Find a match',
    findAnother: 'Find another match',
    error: "We couldn't load this match. Try again in a moment.",
    pendingBanner: 'Sign in to join the open match',
    // {branch} is `shareBranch` or empty; {when} the day and time; {seats} a
    // counted `seatsLeft`; {url} the invite link. It names nobody.
    shareMessage: 'Join our padel match at Touch Padel{branch}, {when}. {seats}: {url}',
    shareBranch: ' · {name}',
  },
};
