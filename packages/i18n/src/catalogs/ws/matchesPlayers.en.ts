/**
 * `ws.matches.{detail, events, players, seat, take, assign, writeOff, callOff,
 * add, remove}`: the match screen and its Players panel
 * (docs/design/open-matches/operator.md §5.12, §5.13). Owned by the operator
 * match-screen lane; spread into matches.en.ts. Mirror every key in
 * matchesPlayers.ar.ts.
 *
 * A line about a player in the third person comes as a pair `x` / `xF`: the
 * Arabic `…F` is read in a women's match (matchLogic.byCategory); English
 * repeats the text so the catalogs keep parity.
 */
export const matchesPlayersEn = {
  // The match screen (operator.md §5.12, features/matches/MatchDetail.tsx).
  detail: {
    // "21:00–22:30 · Women"
    title: '{time} · {category}',
    closes: 'Closes {time}',
    copyLink: 'Copy invite link',
    linkCopied: 'Link copied',
    copyFailed: "The link couldn't be copied. Select it and copy it by hand.",
    cancel: 'Cancel match',
    cancelBody: 'Cancels the match for everyone in it. Tickets go back to the players; nobody is charged.',
    cancelled: 'Match cancelled.',
    openBooking: 'Open booking',
    // The banner of a live match (§5.12.1); ended matches read ws.matches.common.endedReason.
    banner: {
      filling: 'Players {taken} of {total} · needs {players} more by {time}',
      fillingF: 'Players {taken} of {total} · needs {players} more by {time}',
      awaitingCourt:
        'All four are in. The last free court is held by a guest who is paying: if they book it, this match is cancelled; if the hold runs out, the match books by itself.',
      booked: 'Booked on {court}',
    },
    requests: {
      title: 'Requests {count}',
      lead: 'The organiser answers requests in the app.',
      leadF: 'The organiser answers requests in the app.',
      empty: 'No requests waiting.',
      seats: 'Seats {count}',
      games: 'Games {count}',
      noShows: 'No-shows {count}',
      askedAt: 'Asked {time}',
    },
    invite: {
      title: 'Invite link',
      linkOnly: 'Only people with this link can find it.',
    },
    history: {
      title: 'History',
      empty: 'Nothing has happened in this match yet.',
      // The actor of an automatic event (the sweep, a booking's trigger).
      automatic: 'automatic',
    },
    sandbox: 'Test match: not a real booking. Nothing here can be changed.',
    notFound: "That open match isn't at this branch.",
    backToToday: 'Back to Today',
  },
  // One sentence per match_events.type (§5.12.2), "· {actor}" appended by the screen.
  events: {
    started: 'Match started',
    requested: 'Asked to join',
    approved: 'Request approved',
    declined: 'Request declined',
    withdrawn: 'Request withdrawn',
    request_expired: 'Request expired',
    joined: 'Seat {seat} taken',
    // eslint-disable-next-line no-restricted-syntax -- the status or event 'left', a catalog key, not CSS
    left: 'Seat {seat} left',
    left_late: 'Seat {seat} left after booking',
    refilled: 'Seat {seat} taken again',
    removed: 'Seat {seat} removed ({reason})',
    organiser_changed: 'Organiser changed',
    awaiting_court: 'Four in, waiting for a court',
    booked: 'Court booked',
    bumped: 'Cancelled by a booking',
    expired: 'Deadline passed',
    cancelled: 'Match cancelled',
    moved: 'Booking moved',
    deadline_warning: 'Deadline reminder sent',
    message: 'Quick message ({code})',
    seat_attended: 'Seat {seat} marked arrived',
    seat_no_show: 'Seat {seat} marked no-show',
    seat_unmarked: 'Seat {seat} mark undone',
    called_off_short: 'Called off, a player missing',
    played: 'Played',
    no_show: 'Nobody came',
  },
  // The Players panel (§5.13, features/matches/MatchPlayersPanel.tsx).
  players: {
    title: 'Players',
    earlier: 'Earlier in this match',
    seatNo: 'Seat {seat}',
    organiser: 'Organiser',
    organiserF: 'Organiser',
    openCustomer: 'Open customer',
    playersSee: 'Players see: {name}',
    playsAs: 'Plays as: {gender}',
    gender: {
      female: 'Woman',
      male: 'Man',
    },
    // Who declared a seat's gender (OM-39).
    source: {
      guest: 'declared by the guest',
      holder: 'declared by {holder}',
      desk: 'vouched at the desk',
    },
    arrived: 'Arrived',
    noShow: 'No-show',
    noShowBeforeStart: 'A no-show can be marked once the game starts',
    undo: 'Undo',
    noShowInstead: 'Mark no-show instead',
    arrivedInstead: 'Mark arrived instead',
    markAll: 'Mark all arrived',
    unmarkedNote: 'Unmarked players count as arrived when the booking is completed, or three hours after it ends.',
    takeShare: 'Take share',
    takeShareCard: 'Take share by card',
    writeOff: 'Write off',
    remove: 'Remove',
    addPlayer: 'Add player',
    addHere: 'Add player here',
    seatFree: 'Seat free for a walk-in',
    unassigned: 'Taken at the desk without a player: {amount}',
    assign: 'Assign',
    priceDelta: 'Price changed after booking: {delta}. It is on the bill, not on a player.',
  },
  // A seat's money line (§5.13.2), picked by matchLogic.seatLineOf / seatLineKey.
  seat: {
    fillingAccount: 'From the app · share {share}, paid at the desk',
    fillingFriend: 'Share {share}, paid at the desk',
    fillingDesk: 'From the desk · share {share}, paid on the night',
    bookedBeforeStart: 'Share {share}, paid at the desk',
    notMarked: 'Not marked yet',
    cameOwes: 'Came · owes {owed}',
    cameOwesF: 'Came · owes {owed}',
    camePaid: 'Came · paid {paid}',
    camePaidF: 'Came · paid {paid}',
    cameWrittenOff: 'Came · {amount} written off ({reason})',
    cameWrittenOffF: 'Came · {amount} written off ({reason})',
    noShow: "Didn't come · share written off",
    noShowF: "Didn't come · share written off",
    noShowReseated: "Didn't come · {name} took the seat",
    noShowReseatedF: "Didn't come · {name} took the seat",
    leftLateBeforeStart: 'Left after booking · the ticket is held until someone takes the seat, and lost at the start if nobody does',
    leftLateBeforeStartF: 'Left after booking · the ticket is held until someone takes the seat, and lost at the start if nobody does',
    leftLateAfterStart: 'Left late and nobody took the seat',
    leftLateAfterStartF: 'Left late and nobody took the seat',
    refilled: 'Left · {name} took the seat',
    refilledF: 'Left · {name} took the seat',
    removed: 'Removed ({reason})',
    removedF: 'Removed ({reason})',
    // eslint-disable-next-line no-restricted-syntax -- the status or event 'left', a catalog key, not CSS
    left: 'Left before booking',
    leftF: 'Left before booking',
    matchEnded: 'Match ended',
    calledOff: 'Called off · nothing to pay',
    openFilling: 'Open seat',
    openBookedBeforeStart: 'Open seat · share {share} not yet taken',
    openAfterStart: 'Empty seat · share written off',
    unknown: '{status}',
    // A removed seat's end reason, the {reason} of "Removed ({reason})" and of
    // the history's removal line (match_seats.end_reason; a desk removal's own
    // code reads through op.reasons).
    endReason: {
      removed_by_organiser: 'by the organiser',
      removed_by_staff: 'at the desk',
      banned: 'banned from open matches',
      account_deleted: 'account deleted',
    },
  },
  // Take share and Take several (§5.13.4, §5.13.5).
  take: {
    subtitle: "{name}'s share",
    several: 'Take several',
    severalLead: 'Tick the shares to take in one payment.',
    severalButton: 'Take {shares} · {amount}',
    severalCard: 'By card',
    severalSubtitle: 'Shares of {names}',
    group: "Take {name}'s group · {amount}",
    took: 'Took {amount} for {name}.',
    change: 'Change {change}',
    owedChanged: 'What this player owes changed to {amount}. Check before taking it.',
    nothingLeft: 'Nothing left to take for this seat.',
    tabOpen:
      'This booking has a bill open with money on it. Assign that money to players first, then take the rest here.',
    pick: 'Take the share of {name}',
  },
  // Assign money taken on the booking's bill (§5.13.6, AssignPaymentDialog.tsx).
  assign: {
    title: 'Assign money to players',
    lead: 'Money taken on the booking without naming a player. Put it on the players it was for.',
    payment: '{method} · {time}',
    // eslint-disable-next-line no-restricted-syntax -- the amount left to assign, a catalog key, not CSS
    left: 'Left to assign {amount}',
    owes: 'Owes {amount}',
    // What the credit pool (money on the booking no player holds) already covers.
    covered: 'Covered from the booking {amount}',
    writtenOff: 'Written off {amount}',
    // A late leave before the start: the share is not due until the start.
    notDue: 'Not due yet {amount}',
    amountFor: 'Amount for {name}',
    keep: 'Keep on the booking',
    keepLead: 'Closes the bill at what was paid and leaves the amount on the booking, not on a player.',
    save: 'Save',
    saved: 'Money assigned to players.',
    kept: 'Kept on the booking.',
    overPayment: 'That is more than this payment has left to assign ({amount}).',
    overSeat: "That is more than is left of this player's share ({amount}).",
    enterAmount: 'Enter an amount for at least one player.',
    nobodyOwes: 'Every share is already paid at the desk.',
    method: {
      cash: 'Cash',
      card: 'Card',
      other: 'Payment',
    },
  },
  // Write off a share with a manager's PIN (§5.13.7, R1).
  writeOff: {
    title: "Write off {name}'s share",
    body: "The booking stops owing {amount}, and reports show it as written off. A manager's PIN authorises this.",
    done: "{name}'s share written off.",
  },
  // Call off short (§5.13.10, R12, CallOffDialog.tsx).
  callOff: {
    button: 'Call off the match',
    needsMarks: 'Mark every player first ({players} not marked)',
    title: 'Call off this match?',
    came: 'Came: {names}.',
    cameF: 'Came: {names}.',
    missing: "Didn't come: {names}.",
    missingF: "Didn't come: {names}.",
    body: "Calling off cancels the booking and nobody pays for the court. The players who came keep their tickets; the ticket of anyone who didn't come is lost. This can't be undone.",
    bodyF:
      "Calling off cancels the booking and nobody pays for the court. The players who came keep their tickets; the ticket of anyone who didn't come is lost. This can't be undone.",
    deskPaid: '{amount} was already taken at the desk for this match. After calling off, a manager refunds it at the till.',
    keep: 'Keep playing',
    confirm: 'Call off the match',
    done: 'Match called off.',
  },
  // Add player (§5.13.9, AddSeatDialog.tsx).
  add: {
    title: 'Add player',
    titleBooked: 'Add a player in a free seat',
    oweShare: "They owe the seat's share of {share}.",
    oweShareF: "They owe the seat's share of {share}.",
    createCustomer: 'Create customer',
    banned: 'Banned from open matches',
    // A linked customer whose declared gender is not the match's category.
    genderWomen: "This customer plays as a man. This match is for women.",
    genderMen: 'This customer plays as a woman. This match is for men.',
    openRecord: 'Open their record',
    vouchedWomen: 'Seated as a woman (vouched at the desk).',
    vouchedMen: 'Seated as a man (vouched at the desk).',
    needsPlayer: 'Pick a customer or type a name.',
    submit: 'Add player',
    added: '{name} is in.',
    addedF: '{name} is in.',
    fourBooked: 'Four in: booked on {court}.',
    fourWaiting: 'Four in: waiting for a court.',
  },
  // Remove a seat (§5.13.8); the reason form is ReasonCodePrompt's.
  remove: {
    action: 'Remove {name}',
    filling: "Their ticket goes back. Removed for conduct, they can't rejoin this match.",
    lateLeave: 'Counts as leaving late: the ticket is held until someone takes the seat, and lost at the start if nobody does.',
    noCount: 'Their ticket goes back. Nothing counts against them.',
    noCountF: 'Their ticket goes back. Nothing counts against them.',
    // A desk seat holds no ticket.
    deskSeat: 'The seat opens again.',
    // When the offered reasons lead to different outcomes, each line names its reasons.
    byReason: '{reasons}: {line}',
    friends: "Their friends' seats go too.",
    friendsF: "Their friends' seats go too.",
    done: '{name} removed.',
    doneF: '{name} removed.',
  },
};
