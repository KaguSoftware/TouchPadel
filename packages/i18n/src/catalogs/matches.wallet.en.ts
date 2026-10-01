/**
 * `matches.{tickets, pay, reservations}`: the ticket wallet, buying tickets,
 * the payment status for purpose `ticket`, and the open-match lines of My
 * Reservations (docs/design/open-matches/guest.md §4.10, §4.16). Owned by the
 * mobile wallet and account lane; spread into matches.en.ts. Mirror every key
 * in matches.wallet.ar.ts.
 *
 * Counts reach these strings already worded: `{tickets}` and `{ready}` are
 * `countPhrase` output (`matches.count.*`), `{count}` an LTR-isolated number,
 * money through `formatIQD`, a time through the formatters.
 */
export const matchesWalletEn = {
  tickets: {
    title: 'Open-match tickets',
    // The profile's `payment_sandbox` (the App Review account): never real money.
    sandbox: 'Test tickets',
    // `my_tickets.pending` (rules review §4.1 item 9): a purchase still open.
    pending: 'Payment in progress',
    pendingContinue: 'Continue',
    // `/tickets?buy=&for=` after a shortage; {tickets} is `count.tickets`.
    needJoin: 'To join this match you need {tickets} more.',
    needRequest: 'To ask to join this match you need {tickets} more.',
    needStart: 'To start this match you need {tickets} more.',
    buyTitle: 'Buy tickets',
    // "2 × 10,000 IQD = 20,000 IQD"
    priceLine: '{count} × {price} = {total}',
    buy: 'Pay with Qi Card',
    buyNote:
      'Paid online by Qi Card. A ticket is not your share of the court: you still pay your share at the desk.',
    tooManyAttempts: 'Too many payment attempts today. Try again tomorrow.',
    rulesTitle: 'How tickets work',
    rule1: 'One ticket per seat. Seats you take for friends use your tickets.',
    rule2: 'Joining puts a ticket in use. It comes back to your wallet after you play.',
    rule3: 'Asking to join holds a ticket until the organiser answers.',
    rule4: "If a match is cancelled or doesn't fill, your tickets come back.",
    rule5:
      "Leave before the court is booked and the ticket comes back. Leave after, and it stays held until another player takes your seat; if nobody does before the start, it's lost.",
    rule6: "Don't show up and the ticket is lost. Tickets never expire.",
    rule7: 'You still pay your share of the court at the desk.',
    historyTitle: 'Your tickets',
    // {when} is the match's weekday and time; {date} the day it ended.
    rowHeld: 'Held for a request · {when}',
    rowInMatch: 'In a match · {when}',
    rowLost: 'Lost · {date}',
    rowRefunded: 'Refunded to your card · {date}',
    // OM-48, R13.
    cashOut:
      "Money back for tickets you haven't used: ask at the front desk. A manager refunds a purchase's unused tickets to the card you paid with, once none of that purchase's tickets is in a match.",
    // My Reservations, under OPEN MATCHES; {ready} is `count.ticketsReady`.
    walletLine: 'Tickets · {ready}',
  },
  pay: {
    // The payment screen's card for a purchase, in place of court, date and time.
    summaryTitle: 'Open-match tickets',
    summaryCount: '× {count}',
    ticketsBoughtTitle: 'Tickets added',
    // {tickets} is `count.tickets`.
    ticketsBoughtBody: '{tickets} added to your wallet.',
    // While the purchase's continuation runs (§4.10.3).
    joining: 'Joining the match…',
    requesting: 'Sending your request…',
    starting: 'Starting your match…',
    viewTickets: 'View my tickets',
    // A continuation that did not run by itself (stale, or already claimed).
    backToMatch: 'Back to the match',
    continueStart: 'Start the match',
    // Toasts once it ran.
    joined: "You're in",
    requestSent: 'Request sent',
    started: 'Your match is open. Share the link to fill it.',
    ticketsKept: 'Your tickets are in your wallet.',
    // refund_pending on a purchase: amount_mismatch is the only refund a fresh one can show.
    ticketRefundPending:
      "The payment didn't go through as expected, so it's on its way back to your card. No tickets were added.",
    expiredBody: 'No money was taken.',
    failedNoAttempts: "You've used today's payment attempts for tickets. Try again tomorrow.",
    leaveBody:
      "If you already paid, your tickets will still be added. You'll find them under Open-match tickets.",
    stillCheckingBody:
      "This is taking longer than usual. We'll let you know as soon as your bank answers. If you paid, your tickets are safe.",
  },
  reservations: {
    // My Reservations: the section for matches still filling (§4.16).
    openMatches: 'Open matches',
    // The "Next up" card when the next game is a booked open match.
    viewMatch: 'View match',
  },
};
