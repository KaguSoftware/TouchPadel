/**
 * `op.errors.<CODE>` for open matches at the desk (docs/design/open-matches/
 * operator.md §5.20), spread at the end of `op.errors` in en.ts. Mirror every
 * key in opErrors.matches.ar.ts.
 *
 * Each code lands with the migration that first raises it (build contracts
 * R11, R28), in the operator's MAPPED_CODES (apps/operator/src/lib/errors.ts).
 * 0259 created the pair: the customer record's Tickets panel and cash-out.
 * 0262 adds the desk's codes (seats, marks, seat money, reports). The detail
 * words (SEAT_MARK_LOCKED day_closed, …) are ws.matches.errors.*.
 * The TICKET_IN_USE detail ({reason, count, until_at}) has its own sentences
 * in the lane catalog ws.matches (operator.md §5.15.1); this line is the net
 * under them.
 */
export const opErrorsMatchesEn = {
  NO_UNUSED_TICKETS: 'No unused tickets are left on that purchase.',
  TICKET_IN_USE: 'A ticket from this purchase is still in use. Cash out once it comes back.',
  CUSTOMER_NOT_FOUND: "That customer can't be found.",
  // 0262: the desk's open-match RPCs, seat money and the DF-16 wall.
  MATCHES_OFF: 'Open matches are switched off at this branch.',
  MATCH_NOT_FOUND: "That open match isn't at this branch any more.",
  MATCH_NOT_FILLING: "This match isn't filling any more. A booked match is changed from its booking.",
  MATCH_NOT_BOOKED: 'This match has no court booked.',
  MATCH_NOT_STARTED: "The game hasn't started yet.",
  MATCH_FULL: 'No seat is free in this match.',
  MATCH_TOO_LATE: 'Too close to the start for an open match. Book the court instead.',
  MATCH_SLOT_FULL: 'Enough open matches are already filling at that time. Add the players to one of them.',
  MATCH_GENDER_MISMATCH: "This player doesn't fit this match's category.",
  MATCH_SEAT_LIMIT: 'One player can hold at most three seats.',
  MATCH_BANNED: 'This customer is banned from open matches.',
  MATCH_MARK_SEATS: 'Open matches are marked player by player, under Players.',
  MATCH_ALREADY_IN: 'This customer is already in this match.',
  MATCH_BOOKING_NO_CAFE: "Café orders don't go on an open match's booking. Open a separate café bill.",
  SEAT_NOT_FOUND: 'That seat changed. The list has been refreshed.',
  SEAT_NOT_STARTED: 'A no-show can be marked once the game starts.',
  SEAT_MARK_LOCKED: "This mark can't be changed any more.",
  SEAT_OWED_CHANGED: 'What this player owes just changed. Check the new amount.',
  NOTHING_OWED: 'Nothing is owed for this seat.',
  PAYMENT_NOT_ON_MATCH: "That payment isn't on this match's booking.",
  AMOUNT_OVER_SEAT: "That's more than is left of this player's share.",
  PAYMENT_OVER_ALLOCATED: "That's more than the payment has left to assign.",
  REPORT_NOT_FOUND: "That report isn't there any more.",
  REPORT_CLOSED: 'Someone already dealt with this report.',
};
