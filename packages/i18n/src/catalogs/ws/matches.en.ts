import { matchesPlayersEn } from './matchesPlayers.en';
import { matchesDeskEn } from './matchesDesk.en';
import { matchesAdminEn } from './matchesAdmin.en';

/**
 * `ws.matches.*`: open matches at the desk (docs/design/open-matches/operator.md
 * §5.21). Mirror every key in matches.ar.ts.
 *
 * This file is the assembly and owns `common`, `count`, `errors` and `offline`
 * (operator foundation lane). The other groups live in one file pair per lane
 * and are spread in here, so parallel lanes never edit the same file:
 * matchesPlayers.* (detail, events, players, seat, take, assign, writeOff,
 * callOff, add, remove), matchesDesk.* (chip, calendar, today, create, start),
 * matchesAdmin.* (customers, settings, ops, dayClose, reports). The group
 * names are the second key segment the assistant map's `LABEL_ROUTE_HINTS`
 * routes on (packages/db/scripts/build-assistant-map.mjs).
 *
 * `count.<noun>` is a counted phrase for `countPhrase` / `pluralForm`
 * (packages/i18n/src/plural.ts): all six forms `zero, one, two, few, many,
 * other`, English repeating `one` / `other`. A player in the third person
 * comes as a pair `x` / `xF` (EN repeats the text).
 */
export const matchesEn = {
  ...matchesPlayersEn,
  ...matchesDeskEn,
  ...matchesAdminEn,
  // The words every open-match surface shares (features/matches/matchLogic.ts
  // reads them): the labels, the ended-match sentences, the ticket chip and
  // the seat kind.
  common: {
    openMatch: 'Open match',
    category: {
      open: 'Open',
      women: 'Women',
      men: 'Men',
    },
    // matches.join_policy
    join: {
      open: 'Anyone joins at once',
      approve: 'Players ask to join',
    },
    // matches.visibility
    visibility: {
      public: 'Listed at the branch',
      link: 'Only with the link',
    },
    // The short tags a row carries for a join policy or visibility that is not the default.
    tag: {
      approve: 'Ask to join',
      link: 'Link only',
    },
    status: {
      filling: 'Needs players',
      awaiting_court: 'Waiting for a court',
      booked: 'Booked',
      played: 'Played',
      no_show: 'Nobody came',
      cancelled: 'Cancelled',
      bumped: 'Cancelled by a booking',
      expired: 'Not filled',
    },
    // One sentence per ended status and reason (operator.md §5.12.1), picked by
    // matchLogic.endedSentenceKey. The live states' banners are the match screen's.
    endedReason: {
      played: 'Played',
      allNoShow: 'Nobody came. Every ticket in it was lost.',
      organiserCancelled: 'Cancelled by the organiser. Tickets went back.',
      staffCancelled: 'Cancelled at the desk. Tickets went back.',
      reservationCancelled: 'The booking was cancelled. Tickets went back; no-show tickets were given back too.',
      calledOffShort: 'Called off: a player was missing. Players who came kept their tickets.',
      empty: 'Everyone left before it filled.',
      venueClosed: 'The branch is closed at that time. Tickets went back.',
      bumped: 'A booking took the last free court. Tickets went back.',
      bumpedNoCourt: 'No court offers this length any more. Tickets went back.',
      deadline: 'Not full by the deadline. Tickets went back.',
      expiredNoCourt: 'Four players, but no court came free. Tickets went back.',
    },
    // A seat's ticket chip (operator.md §5.13.2), picked by matchLogic.ticketChipOf.
    ticket: {
      inUse: 'Ticket in use',
      onHolder: "On {holder}'s ticket",
      none: 'No ticket',
      back: 'Ticket back',
      lost: 'Ticket lost',
      held: 'Ticket held',
    },
    // match_seats.kind
    kind: {
      account: 'App',
      friend: 'Friend',
      desk: 'Desk',
    },
    // A desk seat with no name and no holder (matchLogic.seatLabelOf).
    deskPlayer: 'Desk player {seat}',
  },
  // Counted phrases (countPhrase / pluralForm, operator.md §5.21). The `zero`
  // form is read at 0 in both languages; `one` and `two` spell the number
  // out, as the Arabic forms do (placeholders must match key for key).
  count: {
    players: {
      zero: 'no players',
      one: 'one player',
      two: 'two players',
      few: '{count} players',
      many: '{count} players',
      other: '{count} players',
    },
    // Women's matches: the Arabic counts women (EN repeats).
    playersF: {
      zero: 'no players',
      one: 'one player',
      two: 'two players',
      few: '{count} players',
      many: '{count} players',
      other: '{count} players',
    },
    shares: {
      zero: 'no shares',
      one: 'one share',
      two: 'two shares',
      few: '{count} shares',
      many: '{count} shares',
      other: '{count} shares',
    },
    tickets: {
      zero: 'no tickets',
      one: 'one ticket',
      two: 'two tickets',
      few: '{count} tickets',
      many: '{count} tickets',
      other: '{count} tickets',
    },
    // After a verbal noun ("Cash out {tickets}", "Take {shares}"): the Arabic
    // dual takes its genitive form (تذكرتين، حصتين). EN repeats.
    ticketsGen: {
      zero: 'no tickets',
      one: 'one ticket',
      two: 'two tickets',
      few: '{count} tickets',
      many: '{count} tickets',
      other: '{count} tickets',
    },
    sharesGen: {
      zero: 'no shares',
      one: 'one share',
      two: 'two shares',
      few: '{count} shares',
      many: '{count} shares',
      other: '{count} shares',
    },
    seats: {
      zero: 'no seats',
      one: 'one seat',
      two: 'two seats',
      few: '{count} seats',
      many: '{count} seats',
      other: '{count} seats',
    },
  },
  // A refusal read from its detail (operator.md §5.20), picked by
  // matchLogic.matchErrorKey; anything else falls back to op.errors.<CODE>.
  errors: {
    // SEAT_MARK_LOCKED · detail
    markLocked: {
      day_closed: 'The day of this game is closed, so its marks are final.',
      ticket_used: 'The ticket that came back has already been used in another match.',
      court_reused: 'The court was booked again after this match closed.',
      replaced: 'Someone has taken this seat since, so the no-show stays.',
      paid: 'This player has paid. Refund the payment at the till before marking a no-show.',
      match_ended: 'This match has ended, so a mark can only be switched between arrived and no-show.',
    },
    // INVALID_TRANSITION · detail
    transition: {
      marked: 'Undo the mark first.',
      not_carrier: 'This player no longer holds a seat in the match.',
      use_attendance: 'After the start, use Arrived or No-show.',
      not_short: "Nobody is missing, so the match can't be called off.",
      nobody_came: 'Nobody came. Mark everyone as no-show instead.',
      match_ended: 'This match has ended.',
      ended: 'This player has already left the match.',
    },
    // FORBIDDEN · manager_required
    managerRequired: 'After booking, only a manager removes a seat for a staff error or a duplicate.',
    // PAYMENT_STATE · detail
    paymentState: {
      empty: 'Nothing has been paid on this bill yet. Take the shares under Players instead.',
      over_paid: 'More was paid on this bill than the booking now owes. A manager refunds the difference at the till.',
      ticket: 'Ticket purchases are refunded only by a cash-out.',
    },
    // INVALID_ARGUMENT · already_linked
    alreadyLinked: 'This payment is already assigned to that player.',
    // INVALID_ARGUMENT · p_guest_name / p_guest_phone (desk_start_match,
    // desk_add_seat), shown on the typed player's field; also the mirrors.
    guestName: 'A name can be at most {max} characters.',
    guestPhone: 'A phone number has {min} to {max} digits.',
    // SLOT_TAKEN · match_waiting (R22), with the waiting match's start.
    slotKept: 'This court is kept for the open match at {time}. Pick another court or time.',
    // TICKET_IN_USE · {reason, count, until_at} (R13); also the record's cash-out lines.
    ticketInUse: {
      in_use: 'A ticket from this purchase is in a match until {time}. Cash out after that.',
      reserved: 'A ticket from this purchase is held for a request until {time}.',
      restorable:
        'A ticket from this purchase was lost today and can still be given back until the day is closed. Cash out after day close.',
    },
    // MATCH_TOO_LATE · minutes (OM-43), with now + minutes.
    tooLateAt: 'Too close to the start for an open match: the earliest is {time}. Book the court instead.',
  },
  // DF-11: every match write is online only (lib/stationReach.tsx).
  offline: {
    needsConnection: 'Needs a connection: open matches work online only',
    lastUpdated: 'Last updated {time}',
    readFailed: "Open matches can't be shown without a connection",
  },
};
