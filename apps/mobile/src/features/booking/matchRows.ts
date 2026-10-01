/**
 * An open match as a row of My Reservations and the booking history
 * (docs/design/open-matches/guest.md §4.16). PURE.
 *
 * The lists draw a match with the booking rows' own components, so it needs
 * what a booking row has: a status for the pill, and one line saying what
 * happened. The line is the guest's §4.15 state (`stateLine`), which already
 * says everything the pill cannot ("Cancelled · a group booked the last court ·
 * tickets back"); the pill is only the nearest booking word for the colour.
 */
import type { Locale, MessageKey, TParams } from '@touch/i18n';
import type { MyMatchRow } from '../matches/logic';
import {
  guestStateOf,
  partyShareIqd,
  stateInputOfMine,
  stateLine,
  type GuestState,
} from '../matches/state';

/**
 * The booking status whose pill a match row wears (`StatusPill`): booked is
 * confirmed, checked in is arrived, played is completed, a no-show is a
 * no-show, and every other ending reads as cancelled, the one pill that says
 * "this did not happen" without claiming why. The line under it says why.
 */
export function matchPillStatus(state: GuestState): string {
  switch (state) {
    case 'booked':
      return 'confirmed';
    case 'checkedIn':
      return 'arrived';
    case 'played':
      return 'completed';
    case 'noShow':
      return 'no_show';
    case 'requested':
    case 'approvedIn':
    case 'in':
    case 'awaitingCourt':
    case 'leftLate':
    case 'removedLate':
      return 'pending';
    default:
      return 'cancelled';
  }
}

export interface MatchLineContext {
  t: (key: MessageKey, params?: TParams) => string;
  locale: Locale;
  /** The branch timezone, for "fills by {time}". */
  timezone: string;
}

/** The §4.15 line for a `my_matches` row, with the party's share at the desk. */
export function matchLineOf(row: MyMatchRow, ctx: MatchLineContext): string {
  const result = guestStateOf(stateInputOfMine(row));
  return stateLine(
    result,
    {
      t: ctx.t,
      locale: ctx.locale,
      category: row.category,
      timezone: ctx.timezone,
      isOrganiser: row.isOrganiser,
      seatsTaken: row.seatsTaken,
      fillDeadlineAt: row.fillDeadlineAt,
    },
    partyShareIqd(result, row.mySeats),
  );
}

/** What the guest's party owes at the desk for a match, or null (the hero's price). */
export function matchShareOf(row: MyMatchRow): number | null {
  return partyShareIqd(guestStateOf(stateInputOfMine(row)), row.mySeats);
}
