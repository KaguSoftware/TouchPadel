/**
 * `ws.matches.{customers, settings, ops, dayClose, reports}`: the customer
 * record (counts, plays as, tickets, cash-out, ban), match settings, the Ops
 * reports queue and online refunds, day close and reports
 * (docs/design/open-matches/operator.md §5.15–§5.19). Owned by the operator
 * admin lane; spread into matches.en.ts. Mirror every key in
 * matchesAdmin.ar.ts.
 */
export const matchesAdminEn = {
  // The customer record (§5.15) and the customer screens' attach mode (§5.3).
  customers: {
    // The record's counts (DF-12, DF-15): a no-show count that includes seats.
    noShowsWithMatches: '{count} (open matches {matches})',
    matchesPlayed: 'Open matches played',
    lateLeaves: 'Late leaves',
    title: 'Open matches',
    startMatch: 'Start an open match',
    // Plays as (OM-39): the declared gender and who declared it.
    playsAs: {
      label: 'Plays as',
      female: 'Woman',
      male: 'Man',
      notSet: 'Not set',
      guest: 'set by the guest',
      staff: 'set at the desk',
      value: '{gender} · {source}',
      change: 'Change',
      lead: "This decides which women's or men's matches they see and can join.",
    },
    // GenderDialog.tsx
    gender: {
      title: 'Plays as',
      kept: 'Seats already taken keep the gender they were taken with.',
      save: 'Save',
      saved: 'Saved.',
    },
    // The ban (R35, R40), chain-wide.
    ban: {
      ban: 'Ban from open matches',
      lift: 'Lift ban',
      body: 'Applies at every branch: no new matches, joins or requests. Seats in matches still filling are released and their tickets come back; booked games stay.',
      liftTitle: 'Lift the ban on open matches?',
      liftBody: 'They can start, join and ask to join open matches again, at every branch.',
      liftConfirm: 'Lift ban',
      banned: 'Banned from open matches.',
      lifted: 'Ban lifted.',
    },
    // The record's list of their matches (customer_record.matches, the last 20).
    matches: {
      upcoming: 'Coming up',
      recent: 'Recent',
      otherBranch: 'At {branch}',
      anotherBranch: 'Another branch',
      open: 'Open',
      // match_seats.status, as the record names this player's seat.
      seatStatus: {
        in: 'In',
        attended: 'Arrived',
        no_show: "Didn't come",
        // eslint-disable-next-line no-restricted-syntax -- the status or event 'left', a catalog key, not CSS
        left: 'Left',
        left_late: 'Left late',
        removed: 'Removed',
        cancelled: 'Cancelled',
        refilled: 'Seat refilled',
      },
      // match_seats.kind, for a seat that is not their own account's.
      kind: {
        friend: 'friend seat',
        desk: 'desk seat',
      },
    },
    // TicketsPanel.tsx (money.md §5.7 guest_tickets).
    tickets: {
      title: 'Open-match tickets',
      available: 'Available',
      reserved: 'Held for a request',
      inUse: 'In a match',
      forfeited: 'Lost',
      cashedOut: 'Cashed out',
      everyBranch: 'Tickets work at every branch.',
      pending: 'Payment in progress',
      purchases: 'Purchases',
      noPurchases: 'No tickets bought yet.',
      paid: 'Paid {amount}',
      test: 'Test',
      testHint: 'A test purchase. No real money moved.',
      refundRequested: 'Refund requested',
      refundFailed: 'Refund failed: see Online refunds on Ops',
      refunded: 'Refunded {date}',
    },
    // Cash-out (R13), one purchase at a time.
    cashout: {
      button: 'Cash out {tickets} · {amount}',
      title: 'Refund {tickets} ({amount}) to the card they were bought with?',
      body: 'They leave the wallet now, and Qi sends the money back to the card.',
      confirm: 'Cash out',
      requested: 'Refund requested.',
      // A waiting reason with no known end (the server gave no time).
      waiting: 'A ticket from this purchase is still in use. Cash out once it comes back.',
    },
    // CustomerSearch.tsx / CustomerRecord.tsx attach mode (`attach=match`).
    attachMatch: 'Add to the match',
    attachingMatch: 'Choose the customer to add to this open match.',
    creatingForMatch: 'Once created, the customer goes straight back to the open match.',
  },
  // MatchSettingsPanel.tsx (§5.16).
  settings: {
    title: 'Open matches',
    lead: 'Players find, start and join open matches in the app. These rules decide when a match can start and what a ticket costs.',
    thisBranch: 'This branch',
    allBranches: 'All branches',
    allLead: 'Changing these changes them at every branch.',
    ownerOnly: 'Only the owner can change these.',
    enabled: 'Open matches at this branch',
    on: 'On',
    off: 'Off',
    onHint: 'Players can start open matches here and join them.',
    offHint: 'Nobody can start a new open match here and no new players can join. Matches already started carry on.',
    deadline: 'Fill deadline',
    deadlineHint:
      'A match not full this long before it starts is cancelled, and its tickets go back. A match can only be started for a time at least this long, plus one hour, from now.',
    price: 'Ticket price',
    priceHint: 'Tickets already bought keep the price paid; a cash-out returns what was paid.',
    maxFilling: 'Filling matches per player',
    maxFillingHint: 'How many open matches one player can have filling at once.',
    iqd: 'IQD',
    matchesUnit: 'matches',
    save: 'Save open-match rules',
    saved: 'Open-match rules saved.',
    appliesNow: 'Changes apply as soon as they are saved.',
    errors: {
      step: 'Use a multiple of 250.',
      refused: 'The server did not accept this value.',
    },
  },
  // MatchReportsPanel.tsx and the online-refund additions (§5.17).
  ops: {
    title: 'Player reports',
    lead: 'Reports players sent from the app about someone they played with, oldest first.',
    empty: 'No reports waiting.',
    reason: {
      offensive_name: 'Offensive name',
      abusive_behaviour: 'Abusive behaviour',
      harassment: 'Harassment',
      unsafe_play: 'Unsafe play',
      no_show: 'No-show',
      other: 'Other',
    },
    reportedAt: 'Reported {time}',
    reports90d: 'Reports in 90 days {count}',
    noShows: 'No-shows {count}',
    reporter: 'Reported by {name}',
    formerPlayer: 'Former player',
    openMatch: 'Open match',
    openCustomer: 'Open customer',
    close: 'Close report',
    closed: 'Report closed.',
    ban: 'Ban',
    banTitle: 'Ban {name} from open matches at every branch?',
    banBody: 'The reason recorded is: Reported by players.',
    banned: 'Banned from open matches.',
    // Online refunds (DepositAttentionPanel.tsx): R23 and ticket rows.
    refundSlowHint: "Qi hasn't answered yet. It is retried on its own and moves here as failed if it keeps failing.",
    ticketRow: 'Ticket refund · {tickets} · {name}',
    anyBranch: 'Any branch can settle this',
    // Added to ws.manager.onlineRefunds.reasons' words for the two ticket reasons.
    refundReason: {
      ticket_cashout: 'tickets cashed out',
      account_deleted: 'account deleted',
    },
  },
  // DayCloseOnline.tsx and the match rows of "Played, not paid" (§5.18).
  dayClose: {
    title: 'Money outside the drawer',
    lead: 'Online payments and open-match figures for this day. For information only: none of it is part of the drawer count.',
    deposits: {
      title: 'Online deposits, this branch',
      received: 'Received',
      refunded: 'Refunded',
      forfeited: 'Kept for no-shows',
      waiting: 'Refunds waiting',
    },
    ticketsHere: {
      title: 'Match tickets at this branch',
      forfeited: 'Lost at this branch (revenue)',
      cashouts: 'Cashed out here',
    },
    ticketsChain: {
      title: 'Match tickets, all branches',
      sold: 'Sold',
      refunded: 'Refunded',
      waiting: 'Refunds waiting',
      liability: 'Unused, owed to players',
    },
    matches: {
      title: 'Open-match bookings today',
      bookings: 'Bookings',
      price: 'Court price',
      deskPaid: 'Paid at the desk',
      writtenOff: 'Written off',
      owed: 'Still owed',
      calledOff: 'Called off',
      noShowSeats: 'No-show seats',
    },
    sandbox: {
      title: 'Test payments left out',
      deposits: 'Deposits',
      tickets: 'Ticket purchases',
    },
    // Played, not paid: a match booking and its owing seats.
    unpaidMatch: 'Open match · {label}',
    seatOwing: 'Seat {seat} · {name} · {amount}',
  },
  // CourtsReport.tsx's Open matches view and the management panel group (§5.19).
  reports: {
    band: {
      bookings: 'Match bookings',
      bookedIqd: 'Court price booked',
      deskPaidIqd: 'Paid at the desk',
      writtenOffIqd: 'Written off',
      noShowSeats: 'No-show seats',
      calledOffShort: 'Called off short',
      ticketForfeitsIqd: 'Lost tickets at this branch',
    },
    filters: {
      category: 'Category',
      allCategories: 'All categories',
      join: 'Joining',
      anyJoin: 'Any',
    },
    counts: {
      title: 'Matches',
      started: 'Started',
      booked: 'Booked',
      played: 'Played',
      bumped: 'Cancelled by a booking',
      expired: 'Not filled',
      cancelled: 'Cancelled',
      calledOffShort: 'Called off short',
      allNoShow: 'Nobody came',
      fillRate: 'Filled',
      fillRateHint: 'Matches that reached four players, out of those started',
    },
    seats: {
      title: 'Seats',
      filled: 'Seats filled',
      account: 'From the app',
      friend: 'Friends',
      desk: 'At the desk',
      attended: 'Arrived',
      noShow: 'No-shows',
      leftLate: 'Left late',
      refilled: 'Refilled',
    },
    byDay: {
      title: 'By day',
      day: 'Day',
      started: 'Started',
      booked: 'Booked',
      bookedIqd: 'Court price booked',
      writtenOffIqd: 'Written off',
      noShowSeats: 'No-show seats',
    },
    compareOff: "Comparison isn't available for open matches yet.",
    empty: 'No open matches in this period.',
    sandboxExcluded: 'Test matches are left out.',
    // ManagementPanel.tsx's online group: a chain-wide figure's hint (its title is ws.owner.panel.online).
    allBranches: 'All branches',
  },
};
