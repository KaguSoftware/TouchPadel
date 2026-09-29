/**
 * `ws.matches.{chip, calendar, today, create, start, booking, bill}`: open
 * matches on the desk calendar and Today board, the new-booking dialog's
 * additions, the Start dialog, and a match booking's screen and bill
 * (docs/design/open-matches/operator.md §5.8–§5.11, §5.14). Owned by the
 * operator desk lane; spread into matches.en.ts. Mirror every key in
 * matchesDesk.ar.ts.
 *
 * Reused from the foundation groups, not repeated here: the category, join,
 * visibility and status words (`common`), the counted phrases (`count`), the
 * kept-court and too-late refusals (`errors.slotKept`, `errors.tooLateAt`)
 * and the offline reason (`offline.needsConnection`).
 */
export const matchesDeskEn = {
  // The seat chip after a match booking's name (§5.8): "3/4" before any mark
  // (built in matchLogic.seatChipOf), then label-and-figure pairs.
  chip: {
    marks: 'Here {here} · Missing {missing}',
    aria: 'Open match · {taken} of {total} players',
  },
  // The calendar's strip of the night's filling matches, and the record's
  // "Start an open match" mode (`/desk?customer=<id>&kind=match`).
  calendar: {
    strip: 'Open matches filling this night',
    stripChip: '{time} · {category} · {fill} · closes {deadline}',
    stripChipOpen: '{time} · {category} · {fill}',
    stripAwaiting: '{time} · {category} · {fill} · waiting for a court',
    startingFor: 'Starting an open match for {name}: pick a free time',
  },
  // The Today group (§5.9).
  today: {
    title: 'Open matches needing players',
    startMatch: 'Start an open match',
    players: 'Players {taken} of {total}',
    requests: 'Requests {count}',
    closes: 'Closes {time}',
    lastCourt: 'Last court free',
    bookedSeatFree: 'Booked · a seat is free',
    addPlayer: 'Add player',
    open: 'Open',
    off: 'Open matches are switched off here. Matches already started carry on.',
    none: 'No open matches tonight',
    playersOwing: 'Players owing: {count}',
  },
  // The new-booking dialog's additions (§5.10).
  create: {
    bump: 'Booking this court cancels the open match at {time} ({players} in). Their tickets go back to them.',
    bumpedToast: 'Court booked. The open match at {time} was cancelled and its players have their tickets back.',
    kept: 'A court at this time is kept for the open match at {time}: its four players are waiting for it.',
  },
  // The Start dialog (§5.11).
  start: {
    title: 'Start an open match',
    organiser: 'Organiser',
    banned: 'Banned from open matches',
    comingWith: 'Coming with',
    seatsAtStart: 'Seats at the start: {seats}',
    category: 'Category',
    women: 'Every player in this match is a woman.',
    men: 'Every player in this match is a man.',
    genderMismatch: "This customer's declared gender doesn't fit this category.",
    openRecord: 'Open their record',
    join: 'Join',
    approveNeedsCustomer: 'Only a customer with the app can approve players',
    visibility: 'Who can find it',
    price: 'Court {price} · each player pays {share} at the desk. Players who join in the app use one ticket each; desk players need none.',
    submit: 'Start match',
    startedToast: 'Open match started. Share the link or add players.',
    startedPriceToast: 'Open match started. The court price is now {price}; each player pays {share}.',
    slotFull: 'These open matches are already filling at that time:',
  },
  // A match booking's quick actions and screen (§5.8, §5.14).
  booking: {
    title: 'Open match · {label}',
    players: 'Players',
    cancelLine: 'Cancels the open match for all its players. Their tickets go back.',
    sharesLine: 'Shares stay as they are; any price difference goes on the bill.',
  },
  // A match booking's bill (§5.14): the booking-level truth.
  bill: {
    playersOwe: 'Players owe {amount} between them. Take each share under Players; money taken here stays unassigned until you assign it.',
    writtenOff: 'Written off',
    priceChanged: 'Price changed after booking',
    unassigned: 'Not assigned to players yet',
    seats: 'Seats: {list}',
    listSeparator: ', ',
  },
};
