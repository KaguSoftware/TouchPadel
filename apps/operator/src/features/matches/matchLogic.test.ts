import { describe, expect, it } from 'vitest';
import { countPhrase, formatTime, isolate, isolateLtr, t, type MessageKey, type TParams } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { errorCodeToMessageKey } from '../../lib/errors';
import type { ReservationRow } from '../desk/deskTypes';
import {
  GENDERED_SEAT_LINES,
  MATCH_EVENT_TYPES,
  MATCH_RESERVATION_NAME,
  SEAT_LINE_IDS,
  awaitingCourtOverlap,
  bookingLabel,
  byCategory,
  callOffNames,
  callOffState,
  endedSentenceKey,
  eventKey,
  groupOwingByHolder,
  inviteUrl,
  isMatchLiteral,
  isStarted,
  markAllArrivedIds,
  matchActionsOf,
  matchErrorKey,
  matchErrorText,
  matchReadStatus,
  matchStatusKey,
  matchesBumpedBy,
  needsPlayersRows,
  openSeatLineOf,
  openSeatNumbers,
  owingPick,
  messageCodeText,
  reasonText,
  reservationNameOf,
  seatActionsOf,
  seatChipOf,
  seatLabelOf,
  seatLineKey,
  seatLineOf,
  seatLineParams,
  seatOwedNow,
  seatRows,
  ticketChipOf,
  ticketInUseDetail,
  type MatchCaps,
} from './matchLogic';
import type { MatchDetail, MatchInfo, MatchSeat, MatchState, OpenMatch, OpenMatches, SeatMoney } from './matchPayloads';

const en = (key: MessageKey, params?: TParams) => t('en', key, params);
const ar = (key: MessageKey, params?: TParams) => t('ar', key, params);

// 21:00–22:30 at the branch (UTC+3), so 18:00–19:30 UTC.
const START = '2026-10-01T18:00:00.000Z';
const END = '2026-10-01T19:30:00.000Z';
const BEFORE = '2026-10-01T17:00:00.000Z';
const AFTER = '2026-10-01T18:20:00.000Z';

function info(over: Partial<MatchInfo> = {}): MatchInfo {
  return {
    id: 'm1',
    venue_id: 'v1',
    status: 'booked',
    ended_reason: null,
    start_at: START,
    end_at: END,
    duration_min: 90,
    category: 'open',
    join_policy: 'open',
    visibility: 'public',
    price_iqd: 40000,
    shares_iqd: [10000, 10000, 10000, 10000],
    fill_deadline_at: '2026-10-01T16:00:00.000Z',
    share_token: 'abcdefghijklmnopqrstuv',
    organised_by: 'guest',
    organiser_seat_id: 's1',
    organiser: null,
    reservation_id: 'r1',
    reservation_status: 'confirmed',
    court_id: 'c1',
    court_name_en: 'Indoor Court 1',
    court_name_ar: 'الملعب الداخلي 1',
    sandbox: false,
    courts_free_firm: 1,
    courts_total: 2,
    started: false,
    marks_open: true,
    server_now: BEFORE,
    can: { add_seat: false, cancel: false, call_off: false },
    ...over,
  };
}

const NO_CAN = { mark_attended: false, mark_no_show: false, unmark: false, remove_reasons: [], take_share: false, write_off: false, replace: false };

function money(over: Partial<SeatMoney> = {}): SeatMoney {
  return {
    share_iqd: 10000,
    paid_desk_iqd: 0,
    credit_iqd: 0,
    owed_iqd: 10000,
    written_off_iqd: 0,
    write_off: null,
    open_iqd: 0,
    take_iqd: 10000,
    ...over,
  };
}

function seat(no: number, over: Partial<MatchSeat> = {}): MatchSeat {
  return {
    seat_id: `s${no}`,
    seat_no: no,
    kind: 'account',
    status: 'in',
    end_reason: null,
    carrying: true,
    customer_id: `g${no}`,
    full_name: `Player ${'ABCD'[no - 1]}`,
    display_name: `Player ${'ABCD'[no - 1]}.`,
    phone: null,
    holder_seat_id: null,
    holder_name: null,
    companion_no: null,
    gender: null,
    gender_source: null,
    vouched: false,
    flags: [],
    is_organiser: no === 1,
    joined_at: null,
    ended_at: null,
    marked_at: null,
    marked_by_name: null,
    replaces_seat_id: null,
    replaced_by_seat_id: null,
    ticket: { ticket_id: `t${no}`, status: 'in_use' },
    write_off_reason: null,
    money: null,
    can: { ...NO_CAN },
    ...over,
  };
}

function detail(match: Partial<MatchInfo>, seats: MatchSeat[]): MatchDetail {
  return { match: info(match), seats, requests: [], money: null, events: [] };
}

const ALL_CAPS: MatchCaps = { runMatches: true, takeSeatPayment: true, writeOffSeat: true };

function row(over: Partial<ReservationRow> = {}): ReservationRow {
  return {
    id: 'r1',
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: START,
    end_at: END,
    guest_id: null,
    guest_name: MATCH_RESERVATION_NAME,
    guest_phone: null,
    price_iqd: 40000,
    hold_expires_at: null,
    notes: null,
    ...over,
  };
}

function state(over: Partial<MatchState> = {}): MatchState {
  return {
    reservation_id: 'r1',
    match_id: 'm1',
    status: 'booked',
    category: 'open',
    label: 'Sara Karim',
    organiser_customer_id: 'g1',
    seats_in: 3,
    seats_attended: 0,
    seats_no_show: 0,
    seats_unmarked: 3,
    seats_left_late: 0,
    open_seats: 1,
    ...over,
  };
}

describe('the match booking literal and its label (§5.8)', () => {
  it('equals the DB literal and is read only from an account-less row', () => {
    expect(MATCH_RESERVATION_NAME).toBe('Open match');
    expect(isMatchLiteral(row())).toBe(true);
    expect(isMatchLiteral(row({ guest_id: 'g1' }))).toBe(false);
    expect(isMatchLiteral(row({ guest_name: 'Open match ' }))).toBe(false);
    expect(isMatchLiteral(null)).toBe(false);
  });

  it('bookingLabel: the state names the organiser, a bare literal reads Open match in the screen language, else the guest', () => {
    expect(bookingLabel(row(), state(), en)).toBe('Sara Karim');
    expect(bookingLabel(row(), state({ label: null }), en)).toBe('Open match');
    expect(bookingLabel(row(), undefined, en)).toBe('Open match');
    expect(bookingLabel(row(), undefined, ar)).toBe('مباراة مفتوحة');
    expect(bookingLabel(row({ guest_name: 'Omar' }), undefined, en)).toBe('Omar');
    expect(bookingLabel(row({ guest_id: 'g9', guest_name: null, guest: { full_name: 'Noor' } }), null, en)).toBe('Noor');
    expect(bookingLabel(row({ guest_name: null }), undefined, en)).toBeNull();
  });
});

describe('reservationNameOf (§5.27: screens with no match state)', () => {
  it("reads a match booking's literal in the screen's language, and any other name as stored", () => {
    expect(reservationNameOf({ guest_id: null, guest_name: 'Open match' }, ar)).toBe('مباراة مفتوحة');
    expect(reservationNameOf({ guest_id: null, guest_name: 'Open match' }, en)).toBe('Open match');
    expect(reservationNameOf({ guest_id: 'g1', guest_name: null, guest: { full_name: 'Noor' } }, ar)).toBe('Noor');
    expect(reservationNameOf({ guest_id: null, guest_name: 'Omar' }, ar)).toBe('Omar');
    // A row without guest_id cannot be told apart: its name as stored.
    expect(reservationNameOf({ guest_name: 'Open match' }, ar)).toBe('Open match');
    expect(reservationNameOf(null, ar)).toBeNull();
    expect(reservationNameOf(undefined, ar)).toBeNull();
  });
});

describe('seatChipOf (§5.8)', () => {
  it('reads taken of four before any mark, LTR-isolated', () => {
    expect(seatChipOf(state({ open_seats: 1 }))).toEqual({ kind: 'fill', text: isolateLtr('3/4'), taken: 3, total: 4 });
    expect(seatChipOf(state({ open_seats: 0 }))).toMatchObject({ kind: 'fill', taken: 4 });
  });
  it('switches to here and missing once marking starts', () => {
    expect(seatChipOf(state({ open_seats: 0, seats_attended: 2, seats_no_show: 1 }))).toEqual({
      kind: 'marks',
      here: 2,
      missing: 1,
      taken: 4,
      total: 4,
    });
  });
  it('leaves the chip out when the server sent no count', () => {
    expect(seatChipOf(state({ open_seats: null }))).toBeNull();
  });
  it('after the start an unrefilled late leaver is missing (R39): three came and one left late reads here 3, missing 1', () => {
    const short = state({ open_seats: 0, seats_in: 0, seats_attended: 3, seats_no_show: 0, seats_unmarked: 0, seats_left_late: 1 });
    expect(seatChipOf(short, true)).toMatchObject({ kind: 'marks', here: 3, missing: 1 });
    // A late leaver after the start with nobody marked yet: the server counts the others as unmarked.
    expect(seatChipOf(state({ open_seats: 0, seats_in: 3, seats_unmarked: 3, seats_left_late: 1 }))).toMatchObject({ kind: 'marks', here: 0, missing: 1 });
  });
  it('before the start a late leaver is held for a refill, not missing', () => {
    expect(seatChipOf(state({ open_seats: 1, seats_in: 3, seats_unmarked: 0, seats_left_late: 1 }))).toMatchObject({ kind: 'fill', taken: 3 });
    const early = state({ open_seats: 1, seats_in: 0, seats_attended: 3, seats_unmarked: 0, seats_left_late: 1 });
    expect(seatChipOf(early, false)).toMatchObject({ kind: 'marks', here: 3, missing: 0 });
  });
});

describe('isStarted', () => {
  it('is the server’s answer, or its clock past the start, never the station clock alone', () => {
    expect(isStarted(info({ started: true, server_now: BEFORE }))).toBe(true);
    expect(isStarted(info({ server_now: BEFORE }))).toBe(false);
    expect(isStarted(info({ server_now: START }))).toBe(true);
    // An hour after the fetch, a screen left open counts from the payload's clock.
    expect(isStarted(info({ server_now: BEFORE }), 60 * 60_000)).toBe(true);
    expect(isStarted(info({ server_now: null }))).toBe(false);
  });
});

describe('seatRows and seat labels', () => {
  it('puts each number’s carrier on its row, an open number empty, and the rest under Earlier', () => {
    const d = detail({}, [
      seat(1),
      seat(2, { status: 'no_show', carrying: false, replaced_by_seat_id: 's5' }),
      seat(2, { seat_id: 's5', kind: 'desk', status: 'attended', replaces_seat_id: 's2', ticket: null }),
      seat(4, { status: 'left', carrying: false }),
    ]);
    const rows = seatRows(d.seats);
    expect(rows.numbered.map((n) => n.seat?.seat_id ?? null)).toEqual(['s1', 's5', null, null]);
    expect(rows.earlier.map((s) => s.seat_id)).toEqual(['s2', 's4']);
    expect(openSeatNumbers(d.seats)).toEqual([3, 4]);
  });

  it('names a player, a friend as holder +n, and a nameless desk seat by number', () => {
    expect(seatLabelOf(seat(1), en)).toBe(isolate('Player A'));
    expect(seatLabelOf(seat(2, { kind: 'friend', full_name: null, holder_name: 'Sara Karim', companion_no: 1 }), en)).toBe(
      `${isolate('Sara Karim')} ${isolateLtr('+1')}`,
    );
    expect(seatLabelOf(seat(3, { kind: 'desk', full_name: null }), en)).toBe(`Desk player ${isolateLtr('3')}`);
    expect(seatLabelOf(seat(3, { kind: 'desk', full_name: null }), ar)).toBe(`لاعب استقبال ${isolateLtr('3')}`);
  });
});

describe('ticketChipOf (§5.13.2)', () => {
  const filling = info({ status: 'filling', reservation_id: null });
  it('reads every row of the table', () => {
    const chip = (s: MatchSeat, m: MatchInfo = info()) => ticketChipOf(s, m)?.key ?? null;
    expect(chip(seat(1), filling)).toBe('ws.matches.common.ticket.inUse');
    expect(ticketChipOf(seat(2, { kind: 'friend', full_name: null, holder_name: 'Sara' }), filling)).toEqual({
      key: 'ws.matches.common.ticket.onHolder',
      params: { holder: isolate('Sara') },
    });
    expect(chip(seat(3, { kind: 'desk', ticket: null }), filling)).toBe('ws.matches.common.ticket.none');
    expect(chip(seat(3, { kind: 'desk', ticket: null, status: 'attended' }))).toBe('ws.matches.common.ticket.none');
    expect(chip(seat(1))).toBe('ws.matches.common.ticket.inUse');
    expect(chip(seat(1, { status: 'attended' }))).toBe('ws.matches.common.ticket.back');
    expect(chip(seat(1, { status: 'no_show' }))).toBe('ws.matches.common.ticket.lost');
    expect(chip(seat(1, { status: 'left_late' }))).toBe('ws.matches.common.ticket.held');
    expect(chip(seat(1, { status: 'left_late' }), info({ started: true }))).toBe('ws.matches.common.ticket.lost');
    for (const status of ['refilled', 'removed', 'left']) expect(chip(seat(1, { status }))).toBe('ws.matches.common.ticket.back');
    expect(chip(seat(1, { status: 'cancelled', ticket: { ticket_id: 't1', status: 'available' } }))).toBe('ws.matches.common.ticket.back');
    expect(chip(seat(1, { status: 'cancelled', ticket: { ticket_id: 't1', status: 'forfeited' } }))).toBe('ws.matches.common.ticket.lost');
    expect(chip(seat(1, { status: 'mystery' }))).toBeNull();
  });
});

describe('seatLineOf (§5.13.2): every row, both categories, an unknown status', () => {
  const line = (s: MatchSeat, m: Partial<MatchInfo> = {}, others: MatchSeat[] = []) => seatLineOf(s, detail(m, [s, ...others]));
  const filling: Partial<MatchInfo> = { status: 'filling', reservation_id: null };
  const started: Partial<MatchInfo> = { started: true, server_now: AFTER };

  it('reads the filling rows by seat kind, with the stamped share', () => {
    expect(line(seat(1), filling)).toEqual({ id: 'fillingAccount', params: { share: 10000 } });
    expect(line(seat(2, { kind: 'friend', full_name: null }), filling).id).toBe('fillingFriend');
    expect(line(seat(3, { kind: 'desk', ticket: null }), filling).id).toBe('fillingDesk');
    expect(line(seat(1), { status: 'awaiting_court' }).id).toBe('fillingAccount');
  });

  it('reads a booked player before and after the start', () => {
    expect(line(seat(1, { money: money() }))).toEqual({ id: 'bookedBeforeStart', params: { share: 10000 } });
    expect(line(seat(1, { money: money() }), started).id).toBe('notMarked');
  });

  it('reads an attended player who owes, has paid, or was written off', () => {
    expect(line(seat(1, { status: 'attended', money: money({ owed_iqd: 7500 }) }), started)).toEqual({ id: 'cameOwes', params: { owed: 7500 } });
    expect(
      line(seat(1, { status: 'attended', money: money({ owed_iqd: 0, paid_desk_iqd: 6000, credit_iqd: 4000, take_iqd: 0 }) }), started),
    ).toEqual({ id: 'camePaid', params: { paid: 10000 } });
    expect(
      line(
        seat(1, {
          status: 'attended',
          write_off_reason: 'walked_out',
          money: money({ owed_iqd: 0, written_off_iqd: 10000, write_off: 'manual', take_iqd: 10000 }),
        }),
        started,
      ),
    ).toEqual({ id: 'cameWrittenOff', params: { amount: 10000, reason: 'walked_out' } });
  });

  it('reads a no-show, and a no-show whose number a walk-in took', () => {
    expect(line(seat(4, { status: 'no_show' }), started).id).toBe('noShow');
    const walkIn = seat(4, { seat_id: 's9', kind: 'desk', full_name: 'Ali Hasan', status: 'attended', replaces_seat_id: 's4', ticket: null });
    const noShow = seat(4, { status: 'no_show', carrying: false, replaced_by_seat_id: 's9' });
    const l = line(noShow, started, [walkIn]);
    expect(l.id).toBe('noShowReseated');
    expect(l.params.taker?.seat_id).toBe('s9');
    expect(seatLineParams(l, 'en', en)).toEqual({ name: isolate('Ali Hasan') });
  });

  it('reads a late leave before and after the start, and the ended states', () => {
    expect(line(seat(2, { status: 'left_late' })).id).toBe('leftLateBeforeStart');
    expect(line(seat(2, { status: 'left_late' }), started).id).toBe('leftLateAfterStart');
    const taker = seat(2, { seat_id: 's7', full_name: 'Noor Salem', replaces_seat_id: 's2' });
    expect(line(seat(2, { status: 'refilled', carrying: false, replaced_by_seat_id: 's7' }), {}, [taker]).params.taker?.seat_id).toBe('s7');
    const removed = line(seat(3, { status: 'removed', end_reason: 'removed_by_staff', carrying: false }));
    expect(removed).toEqual({ id: 'removed', params: { reason: 'removed_by_staff' } });
    // Words, never the DB code, in both languages.
    expect(seatLineParams(removed, 'en', en).reason).toBe('at the desk');
    expect(ar(seatLineKey(removed, 'open'), seatLineParams(removed, 'ar', ar))).toBe('أُزيل من المباراة (بقرار الاستقبال)');
    expect(line(seat(3, { status: 'left', carrying: false }), filling).id).toBe('left');
    expect(line(seat(3, { status: 'cancelled', carrying: false }), { status: 'expired', ended_reason: 'deadline' }).id).toBe('matchEnded');
    expect(line(seat(1, { status: 'attended' }), { status: 'cancelled', ended_reason: 'called_off_short' }).id).toBe('calledOff');
  });

  it('reads the three open-seat rows', () => {
    expect(openSeatLineOf(3, detail(filling, []))).toEqual({ id: 'openFilling', params: {} });
    expect(openSeatLineOf(3, detail({ shares_iqd: [10000, 10000, 12500, 10000] }, []))).toEqual({
      id: 'openBookedBeforeStart',
      params: { share: 12500 },
    });
    expect(openSeatLineOf(3, detail(started, [])).id).toBe('openAfterStart');
  });

  it('keeps an unknown status neutral with its raw word', () => {
    const l = line(seat(1, { status: 'teleported' }));
    expect(l).toEqual({ id: 'unknown', params: { status: 'teleported' } });
    expect(seatLineParams(l, 'en', en)).toEqual({ status: 'teleported' });
  });

  it('picks the feminine key in a women’s match for the third-person lines only', () => {
    expect(seatLineKey({ id: 'cameOwes' }, 'women')).toBe('ws.matches.seat.cameOwesF');
    expect(seatLineKey({ id: 'cameOwes' }, 'men')).toBe('ws.matches.seat.cameOwes');
    expect(seatLineKey({ id: 'openFilling' }, 'women')).toBe('ws.matches.seat.openFilling');
    expect(byCategory('women', 'noShow')).toBe('noShowF');
    expect(byCategory('open', 'noShow')).toBe('noShow');
    for (const id of GENDERED_SEAT_LINES) expect(SEAT_LINE_IDS).toContain(id);
  });

  it('formats a line’s money in Latin digits and its write-off reason in words', () => {
    const l = { id: 'cameWrittenOff' as const, params: { amount: 10000, reason: 'walked_out' } };
    const enParams = seatLineParams(l, 'en', en);
    const arParams = seatLineParams(l, 'ar', ar);
    expect(enParams.reason).toBe('Left without paying');
    expect(arParams.reason).toBe('مغادرة دون دفع');
    expect(String(arParams.amount)).toMatch(/10,000/);
    expect(String(arParams.amount)).not.toMatch(/[٠-٩]/);
    expect(seatLineParams({ id: 'cameOwes', params: { owed: null } }, 'en', en)).toEqual({ owed: '—' });
  });
});

describe('reasonText / messageCodeText', () => {
  it('words op.reasons codes and passes an unknown code through', () => {
    expect(reasonText('conduct', en)).toBe('Conduct');
    expect(reasonText('court_needed', ar)).toBe('الملعب مطلوب');
    expect(reasonText('teleported', en)).toBe('teleported');
    expect(reasonText(null, en)).toBe('—');
  });

  it("words a seat's end reason, never the raw code (the organiser's removal, the ban sweep)", () => {
    for (const code of ['removed_by_organiser', 'removed_by_staff', 'banned', 'account_deleted']) {
      expect(reasonText(code, en), code).not.toBe(code);
      expect(reasonText(code, ar), code).not.toMatch(/[a-z_]/);
    }
    expect(reasonText('removed_by_organiser', en)).toBe('by the organiser');
    expect(reasonText('removed_by_staff', ar)).toBe('بقرار الاستقبال');
  });

  it("words a quick message's code as the players picked it", () => {
    expect(messageCodeText('running_late', en)).toBe('Running late');
    expect(messageCodeText('on_my_way', ar)).toBe('في الطريق');
    expect(messageCodeText('shout', en)).toBe('shout');
    expect(messageCodeText(null, en)).toBe('—');
  });
});

describe('seatActionsOf (§5.13.3–§5.13.9)', () => {
  const booked = info();
  const started = info({ started: true, server_now: AFTER });
  const played = info({ status: 'played', started: true, server_now: AFTER });
  const inSeat = seat(1, { can: { ...NO_CAN, mark_attended: true } });

  it('before the start: Arrived is offered, No-show shows disabled with its reason', () => {
    const a = seatActionsOf(inSeat, booked, true, ALL_CAPS);
    expect(a.arrived).toEqual({ show: true, blockedBy: null });
    expect(a.noShow).toEqual({ show: true, blockedBy: 'notStarted' });
    expect(a.undo.show).toBe(false);
  });

  it('after the start: both marks, as the server allows them', () => {
    const a = seatActionsOf(seat(1, { can: { ...NO_CAN, mark_attended: true, mark_no_show: true } }), started, true, ALL_CAPS);
    expect(a.arrived).toEqual({ show: true, blockedBy: null });
    expect(a.noShow).toEqual({ show: true, blockedBy: null });
  });

  it('offers Undo and a correction on a marked row while booked', () => {
    const a = seatActionsOf(seat(1, { status: 'attended', can: { ...NO_CAN, unmark: true, mark_no_show: true } }), started, true, ALL_CAPS);
    expect(a.undo.show).toBe(true);
    expect(a.noShowInstead.show).toBe(true);
    expect(a.arrived.show).toBe(false);
    const n = seatActionsOf(seat(1, { status: 'no_show', can: { ...NO_CAN, unmark: true, mark_attended: true } }), started, true, ALL_CAPS);
    expect(n.arrivedInstead.show).toBe(true);
  });

  it('on played there is no Undo, only the corrections (R16)', () => {
    const a = seatActionsOf(seat(1, { status: 'attended', can: { ...NO_CAN, unmark: true, mark_no_show: true } }), played, true, ALL_CAPS);
    expect(a.undo.show).toBe(false);
    expect(a.noShowInstead.show).toBe(true);
  });

  it('offline: every shown control stays, disabled with the connection reason', () => {
    const s = seat(1, {
      status: 'attended',
      can: { ...NO_CAN, unmark: true, mark_no_show: true, take_share: true, write_off: true, remove_reasons: ['customer_request'] },
    });
    const a = seatActionsOf(s, started, false, ALL_CAPS);
    const shown = Object.values(a).filter((x) => x.show);
    expect(shown.length).toBe(5);
    for (const x of shown) expect(x.blockedBy).toBe('offline');
    expect(seatActionsOf(inSeat, booked, false, ALL_CAPS).noShow.blockedBy).toBe('offline');
  });

  it('follows each capability', () => {
    const s = seat(1, {
      status: 'attended',
      can: { ...NO_CAN, unmark: true, take_share: true, write_off: true, remove_reasons: ['customer_request'], replace: false },
    });
    const noRun = seatActionsOf(s, started, true, { ...ALL_CAPS, runMatches: false });
    expect(noRun.undo.show).toBe(false);
    expect(noRun.remove.show).toBe(false);
    expect(noRun.takeShare.show).toBe(true);
    expect(seatActionsOf(s, started, true, { ...ALL_CAPS, takeSeatPayment: false }).takeShare.show).toBe(false);
    expect(seatActionsOf(s, started, true, { ...ALL_CAPS, writeOffSeat: false }).writeOff.show).toBe(false);
    expect(seatActionsOf(s, started, true, ALL_CAPS).writeOff.show).toBe(true);
  });

  it('offers Take share on a manually written-off row (MD-11) and nothing at all on a sandbox match', () => {
    const w = seat(1, { status: 'attended', money: money({ owed_iqd: 0, write_off: 'manual', written_off_iqd: 10000 }), can: { ...NO_CAN, take_share: true } });
    expect(seatActionsOf(w, started, true, ALL_CAPS).takeShare.show).toBe(true);
    const sandbox = seatActionsOf(seat(1, { can: { ...NO_CAN, mark_attended: true, take_share: true } }), info({ sandbox: true }), true, ALL_CAPS);
    expect(Object.values(sandbox).some((x) => x.show)).toBe(false);
  });

  it('match actions: add and cancel follow can and go offline; the link never needs a server', () => {
    const m = info({ status: 'filling', can: { add_seat: true, cancel: true, call_off: false } });
    expect(matchActionsOf(m, true, ALL_CAPS)).toEqual({
      addSeat: { show: true, blockedBy: null },
      cancel: { show: true, blockedBy: null },
      copyLink: { show: true, blockedBy: null },
    });
    expect(matchActionsOf(m, false, ALL_CAPS).cancel.blockedBy).toBe('offline');
    expect(matchActionsOf(m, false, ALL_CAPS).copyLink.blockedBy).toBeNull();
    expect(matchActionsOf(m, true, { runMatches: false }).addSeat.show).toBe(false);
    expect(matchActionsOf({ ...m, sandbox: true }, true, ALL_CAPS).copyLink.show).toBe(false);
  });

  it('Mark all arrived names every in carrier that may be marked, in seat order', () => {
    const seats = [
      seat(3, { can: { ...NO_CAN, mark_attended: true } }),
      seat(1, { can: { ...NO_CAN, mark_attended: true } }),
      seat(2, { status: 'attended' }),
      seat(4, { carrying: false, status: 'left' }),
    ];
    expect(markAllArrivedIds(seats)).toEqual(['s1', 's3']);
  });
});

describe('taking shares (§5.13.4, §5.13.5)', () => {
  const owing = (no: number, take: number, over: Partial<MatchSeat> = {}) =>
    seat(no, { status: 'attended', money: money({ take_iqd: take, owed_iqd: take }), can: { ...NO_CAN, take_share: take > 0 }, ...over });

  it('owingPick keeps seat order, drops what cannot be taken, and sums the server’s take', () => {
    const seats = [owing(3, 10000), owing(1, 7500), owing(2, 0), owing(4, 10000)];
    expect(owingPick(seats, ['s4', 's3', 's1', 's2'])).toEqual({ seatIds: ['s1', 's3', 's4'], due: 27500 });
    expect(owingPick(seats, [])).toEqual({ seatIds: [], due: 0 });
  });

  it('groups a holder with owing friends, the holder included when it owes', () => {
    const holder = owing(1, 10000, { full_name: 'Sara Karim' });
    const f1 = owing(2, 10000, { kind: 'friend', full_name: null, holder_seat_id: 's1', holder_name: 'Sara Karim', companion_no: 1 });
    const f2 = owing(3, 0, { kind: 'friend', full_name: null, holder_seat_id: 's1', holder_name: 'Sara Karim', companion_no: 2 });
    const other = owing(4, 10000);
    const groups = groupOwingByHolder([holder, f1, f2, other], en);
    expect(groups).toEqual([{ holderSeatId: 's1', holderName: isolate('Sara Karim'), seatIds: ['s1', 's2'], due: 20000 }]);
    // A paid holder with one owing friend is plain Take share, not a group.
    expect(groupOwingByHolder([owing(1, 0), f1], en)).toEqual([]);
  });
});

describe('callOffState and callOffNames (§5.13.10; R12, R21, R39)', () => {
  const started: Partial<MatchInfo> = { started: true, server_now: AFTER };

  it('is hidden before the start, off booked, and on a sandbox match', () => {
    expect(callOffState(detail({}, [seat(1)]))).toEqual({ state: 'hidden' });
    expect(callOffState(detail({ ...started, status: 'played' }, [seat(1, { status: 'attended' })]))).toEqual({ state: 'hidden' });
    expect(callOffState(detail({ ...started, sandbox: true }, [seat(1)]))).toEqual({ state: 'hidden' });
  });

  it('needs every carrier marked first', () => {
    const seats = [seat(1, { status: 'attended' }), seat(2, { status: 'attended' }), seat(3, { status: 'attended' }), seat(4)];
    expect(callOffState(detail(started, seats))).toEqual({ state: 'needsMarks', unmarked: 1 });
  });

  it('is short with a no-show carrier, enabled when the server allows it', () => {
    const seats = [seat(1, { status: 'attended' }), seat(2, { status: 'attended' }), seat(3, { status: 'attended' }), seat(4, { status: 'no_show' })];
    expect(callOffState(detail({ ...started, can: { add_seat: false, cancel: false, call_off: true } }, seats))).toEqual({ state: 'enabled' });
  });

  it('is short when the only one missing left late and nobody took the seat (R39)', () => {
    const seats = [seat(1, { status: 'attended' }), seat(2, { status: 'attended' }), seat(3, { status: 'attended' }), seat(4, { status: 'left_late' })];
    expect(callOffState(detail({ ...started, can: { add_seat: false, cancel: false, call_off: true } }, seats))).toEqual({ state: 'enabled' });
  });

  it('is not short once a no-show’s number was re-seated (carriers only, R21)', () => {
    const seats = [
      seat(1, { status: 'attended' }),
      seat(2, { status: 'attended' }),
      seat(3, { status: 'attended' }),
      seat(4, { status: 'no_show', carrying: false, replaced_by_seat_id: 's9' }),
      seat(4, { seat_id: 's9', kind: 'desk', status: 'attended', replaces_seat_id: 's4' }),
    ];
    expect(callOffState(detail(started, seats))).toEqual({ state: 'notShort' });
  });

  it('says why a short match cannot be called off: nobody came, or the day closed', () => {
    const allNo = [1, 2, 3, 4].map((n) => seat(n, { status: 'no_show' }));
    expect(callOffState(detail(started, allNo))).toEqual({ state: 'blocked', reason: 'ws.matches.errors.transition.nobody_came' });
    const short = [seat(1, { status: 'attended' }), seat(2, { status: 'no_show' })];
    expect(callOffState(detail({ ...started, marks_open: false }, short))).toEqual({
      state: 'blocked',
      reason: 'ws.matches.errors.markLocked.day_closed',
    });
  });

  it('names who came and who did not: no-shows and unreplaced late leavers', () => {
    const seats = [
      seat(1, { status: 'attended', full_name: 'Sara Karim' }),
      seat(2, { status: 'attended', full_name: 'Ali Hasan' }),
      seat(3, { status: 'no_show', full_name: 'Omar Khalid' }),
      seat(4, { status: 'left_late', full_name: 'Noor Salem' }),
      seat(2, { seat_id: 's8', status: 'left', carrying: false, full_name: 'Gone Early' }),
    ];
    expect(callOffNames(seats, en)).toEqual({
      came: [isolate('Sara Karim'), isolate('Ali Hasan')],
      missing: [isolate('Omar Khalid'), isolate('Noor Salem')],
    });
  });
});

function openMatch(over: Partial<OpenMatch> = {}): OpenMatch {
  return {
    match_id: 'm1',
    venue_id: 'v1',
    status: 'filling',
    start_at: START,
    end_at: END,
    duration_min: 90,
    category: 'open',
    join_policy: 'open',
    visibility: 'public',
    seats_taken: 3,
    seats_left: 1,
    requests_pending: 0,
    fill_deadline_at: '2026-10-01T16:00:00.000Z',
    organised_by: 'guest',
    organiser: null,
    price_iqd: 40000,
    shares_iqd: [10000, 10000, 10000, 10000],
    courts_free_firm: 1,
    courts_total: 2,
    ...over,
  };
}

describe('needsPlayersRows (§5.9)', () => {
  const envelope = (matches: OpenMatch[], server_now = '2026-10-01T15:00:00.000Z'): OpenMatches => ({
    matches_enabled: true,
    fill_deadline_minutes: 120,
    earliest_start_minutes: 180,
    ticket_price_iqd: 10000,
    server_now,
    matches,
  });

  it('lists filling, waiting and part-booked matches by start, with their tags', () => {
    const rows = needsPlayersRows(
      envelope([
        openMatch({ match_id: 'late', start_at: '2026-10-01T20:00:00.000Z', end_at: '2026-10-01T21:30:00.000Z', join_policy: 'approve', visibility: 'link', courts_free_firm: 2 }),
        openMatch({ match_id: 'wait', status: 'awaiting_court', seats_taken: 4, seats_left: 0 }),
        openMatch({ match_id: 'full', status: 'booked', seats_left: 0 }),
        openMatch({ match_id: 'free', status: 'booked', start_at: '2026-10-01T17:00:00.000Z', seats_left: 1 }),
        openMatch({ match_id: 'played', status: 'played' }),
      ]),
    );
    expect(rows.map((r) => r.match.match_id)).toEqual(['free', 'wait', 'late']);
    expect(rows.find((r) => r.match.match_id === 'late')!.tags).toEqual(['approve', 'link']);
    expect(rows.find((r) => r.match.match_id === 'wait')!).toMatchObject({ tags: ['waitingCourt'], canAddPlayer: false, deadlineAt: null });
    expect(rows.find((r) => r.match.match_id === 'free')!.tags).toEqual(['bookedSeatFree']);
  });

  it('warns under thirty minutes to the deadline, and on the last free court', () => {
    const [row0] = needsPlayersRows(envelope([openMatch({ fill_deadline_at: '2026-10-01T15:20:00.000Z' })]));
    expect(row0!.deadlineWarn).toBe(true);
    expect(row0!.tags).toContain('lastCourt');
    const [row1] = needsPlayersRows(envelope([openMatch({ fill_deadline_at: '2026-10-01T16:00:00.000Z', courts_free_firm: 2 })]));
    expect(row1!.deadlineWarn).toBe(false);
    expect(row1!.tags).not.toContain('lastCourt');
  });

  it('is empty without a read', () => {
    expect(needsPlayersRows(null)).toEqual([]);
  });
});

describe('matchesBumpedBy and awaitingCourtOverlap (§5.10; OM-13, R22)', () => {
  const courts = [
    { id: 'c1', duration_options: [60, 90, 120] },
    { id: 'c2', duration_options: [60, 90, 120] },
    { id: 'c3', duration_options: [60] },
  ];
  const draft = (over: Partial<{ courtId: string; startAt: string; endAt: string; kind: string }> = {}) => ({
    courtId: 'c2',
    startAt: START,
    endAt: '2026-10-01T19:00:00.000Z',
    kind: 'booking',
    ...over,
  });
  const firmOnC1 = row({ id: 'x1', court_id: 'c1', guest_name: 'Desk guest', guest_id: null });

  it('warns when the other court is firm, so this one is the last', () => {
    expect(matchesBumpedBy([openMatch()], [firmOnC1], courts, draft()).map((m) => m.match_id)).toEqual(['m1']);
  });

  it('counts a pending booking as firm, but not a hold (the server then reports two free courts)', () => {
    expect(matchesBumpedBy([openMatch()], [{ ...firmOnC1, status: 'pending' }], courts, draft())).toHaveLength(1);
    const holdOnC1 = { ...firmOnC1, kind: 'hold' as const, status: 'pending' };
    expect(matchesBumpedBy([openMatch({ courts_free_firm: 2 })], [holdOnC1], courts, draft())).toEqual([]);
  });

  it('does not warn on the court that is already firm, nor for a hold draft', () => {
    expect(matchesBumpedBy([openMatch()], [firmOnC1], courts, draft({ courtId: 'c1' }))).toEqual([]);
    expect(matchesBumpedBy([openMatch()], [{ ...firmOnC1, status: 'pending' }], courts, draft({ courtId: 'c1' }))).toEqual([]);
    expect(matchesBumpedBy([openMatch()], [firmOnC1], courts, draft({ kind: 'hold' }))).toEqual([]);
    expect(matchesBumpedBy([openMatch()], [firmOnC1], courts, draft({ kind: 'maintenance' }))).toHaveLength(1);
  });

  it('touching ends do not overlap', () => {
    expect(matchesBumpedBy([openMatch()], [firmOnC1], courts, draft({ startAt: END, endAt: '2026-10-01T20:30:00.000Z' }))).toEqual([]);
  });

  it('a court that does not sell the match’s length cannot be its court', () => {
    expect(matchesBumpedBy([openMatch()], [firmOnC1], courts, draft({ courtId: 'c3' }))).toEqual([]);
  });

  it('only filling matches are bumped', () => {
    expect(matchesBumpedBy([openMatch({ status: 'awaiting_court' })], [firmOnC1], courts, draft())).toEqual([]);
    expect(matchesBumpedBy(undefined, [firmOnC1], courts, draft())).toEqual([]);
  });

  it('awaitingCourtOverlap names the waiting matches over the draft’s time', () => {
    const wait = openMatch({ match_id: 'w', status: 'awaiting_court' });
    expect(awaitingCourtOverlap([wait, openMatch()], draft()).map((m) => m.match_id)).toEqual(['w']);
    expect(awaitingCourtOverlap([wait], draft({ startAt: END, endAt: '2026-10-01T20:00:00.000Z' }))).toEqual([]);
  });
});

describe('inviteUrl (§5.12)', () => {
  it('uses the guest site origin rule of the QR cards', () => {
    expect(inviteUrl('abc_DEF-123', 'https://touch-padel.com/en/', true)).toBe('https://touch-padel.com/m/abc_DEF-123');
    expect(inviteUrl('tok', 'http://localhost:3000', false)).toBe('http://localhost:3000/m/tok');
    // A production build never links to localhost.
    expect(inviteUrl('tok', 'http://localhost:3000', true)).not.toContain('localhost');
  });
});

describe('ended sentences, statuses and history keys (§5.12.1, §5.12.2)', () => {
  it('names a sentence for every ended row of the table, and none for a live status or an unknown pairing', () => {
    const rows: [string, string | null, string][] = [
      ['played', null, 'Played'],
      ['no_show', 'all_no_show', 'Nobody came. Every ticket in it was lost.'],
      ['cancelled', 'organiser_cancelled', 'Cancelled by the organiser. Tickets went back.'],
      ['cancelled', 'staff_cancelled', 'Cancelled at the desk. Tickets went back.'],
      ['cancelled', 'reservation_cancelled', 'The booking was cancelled. Tickets went back; no-show tickets were given back too.'],
      ['cancelled', 'called_off_short', 'Called off: a player was missing. Players who came kept their tickets.'],
      ['cancelled', 'empty', 'Everyone left before it filled.'],
      ['cancelled', 'venue_closed', 'The branch is closed at that time. Tickets went back.'],
      ['bumped', 'bumped', 'A booking took the last free court. Tickets went back.'],
      ['bumped', 'no_court', 'No court offers this length any more. Tickets went back.'],
      ['expired', 'deadline', 'Not full by the deadline. Tickets went back.'],
      ['expired', 'no_court', 'Four players, but no court came free. Tickets went back.'],
    ];
    for (const [status, reason, text] of rows) {
      const key = endedSentenceKey(status, reason);
      expect(key, `${status}/${reason}`).not.toBeNull();
      expect(en(key!)).toBe(text);
      expect(ar(key!)).not.toBe(text);
    }
    expect(endedSentenceKey('filling', null)).toBeNull();
    expect(endedSentenceKey('booked', null)).toBeNull();
    expect(endedSentenceKey('cancelled', 'meteor')).toBeNull();
    expect(endedSentenceKey('warp', null)).toBeNull();
  });

  it('words every status, and prints an unknown one raw', () => {
    expect(en(matchStatusKey('awaiting_court')!)).toBe('Waiting for a court');
    expect(ar(matchStatusKey('expired')!)).toBe('لم تكتمل');
    expect(matchStatusKey('warp')).toBeNull();
  });

  it('keys every event type under ws.matches.events, and none for an unknown one', () => {
    expect(MATCH_EVENT_TYPES).toHaveLength(26);
    expect(eventKey('seat_no_show')).toBe('ws.matches.events.seat_no_show');
    expect(eventKey('teleported')).toBeNull();
  });
});

describe('matchErrorKey (§5.20): every detail row', () => {
  const err = (code: string, details?: string) => new AppRpcError(code, code, undefined, details);
  const key = (code: string, details?: string, ctx = {}) => matchErrorKey(err(code, details), ctx).key;

  it('reads SEAT_MARK_LOCKED, INVALID_TRANSITION, FORBIDDEN, PAYMENT_STATE and INVALID_ARGUMENT details', () => {
    const rows: [string, string, string][] = [
      ['SEAT_MARK_LOCKED', 'day_closed', 'The day of this game is closed, so its marks are final.'],
      ['SEAT_MARK_LOCKED', 'ticket_used', 'The ticket that came back has already been used in another match.'],
      ['SEAT_MARK_LOCKED', 'court_reused', 'The court was booked again after this match closed.'],
      ['SEAT_MARK_LOCKED', 'replaced', 'Someone has taken this seat since, so the no-show stays.'],
      ['SEAT_MARK_LOCKED', 'paid', 'This player has paid. Refund the payment at the till before marking a no-show.'],
      ['SEAT_MARK_LOCKED', 'match_ended', 'This match has ended, so a mark can only be switched between arrived and no-show.'],
      ['INVALID_TRANSITION', 'marked', 'Undo the mark first.'],
      ['INVALID_TRANSITION', 'not_carrier', 'This player no longer holds a seat in the match.'],
      ['INVALID_TRANSITION', 'use_attendance', 'After the start, use Arrived or No-show.'],
      ['INVALID_TRANSITION', 'not_short', "Nobody is missing, so the match can't be called off."],
      ['INVALID_TRANSITION', 'nobody_came', 'Nobody came. Mark everyone as no-show instead.'],
      ['INVALID_TRANSITION', 'match_ended', 'This match has ended.'],
      ['INVALID_TRANSITION', 'ended', 'This player has already left the match.'],
      ['FORBIDDEN', 'manager_required', 'After booking, only a manager removes a seat for a staff error or a duplicate.'],
      ['PAYMENT_STATE', 'empty', 'Nothing has been paid on this bill yet. Take the shares under Players instead.'],
      ['PAYMENT_STATE', 'over_paid', 'More was paid on this bill than the booking now owes. A manager refunds the difference at the till.'],
      ['PAYMENT_STATE', 'ticket', 'Ticket purchases are refunded only by a cash-out.'],
      ['INVALID_ARGUMENT', 'already_linked', 'This payment is already assigned to that player.'],
    ];
    for (const [code, details, text] of rows) {
      const k = key(code, details);
      expect(en(k), `${code} · ${details}`).toBe(text);
      expect(ar(k), `${code} · ${details}`).not.toBe(k);
    }
  });

  it('falls back to the code’s own line for a detail it does not know', () => {
    // The code's own line once the DB step maps it (errors.generic until then).
    expect(key('SEAT_MARK_LOCKED', 'meteor')).toBe(errorCodeToMessageKey('SEAT_MARK_LOCKED'));
    expect(key('FORBIDDEN')).toBe('op.errors.FORBIDDEN');
    expect(key('INVALID_TRANSITION', 'weird')).toBe('op.errors.INVALID_TRANSITION');
    expect(key('PIN_INVALID')).toBe('op.errors.PIN_INVALID');
    expect(matchErrorKey(new TypeError('Failed to fetch')).key).toBe('errors.network');
  });

  it('reads SLOT_TAKEN match_waiting with the waiting match’s time, else the plain refusal', () => {
    expect(matchErrorKey(err('SLOT_TAKEN', 'match_waiting'), { waitingStartAt: START })).toEqual({
      key: 'ws.matches.errors.slotKept',
      timeAt: START,
    });
    expect(key('SLOT_TAKEN', 'match_waiting')).toBe('op.errors.SLOT_TAKEN');
  });

  it('reads the TICKET_IN_USE JSON detail by reason, with until when', () => {
    const d = (o: object) => JSON.stringify(o);
    expect(matchErrorKey(err('TICKET_IN_USE', d({ reason: 'in_use', count: 1, until_at: END })))).toEqual({
      key: 'ws.matches.errors.ticketInUse.in_use',
      timeAt: END,
    });
    expect(matchErrorKey(err('TICKET_IN_USE', d({ reason: 'reserved', count: 2, until_at: START }))).key).toBe('ws.matches.errors.ticketInUse.reserved');
    expect(matchErrorKey(err('TICKET_IN_USE', d({ reason: 'restorable', count: 1, until_at: null })))).toEqual({
      key: 'ws.matches.errors.ticketInUse.restorable',
    });
    expect(key('TICKET_IN_USE', d({ reason: 'in_use', count: 1, until_at: null }))).toBe('op.errors.TICKET_IN_USE');
    expect(key('TICKET_IN_USE', 'not json')).toBe('op.errors.TICKET_IN_USE');
    expect(ticketInUseDetail(d({ reason: 'reserved', count: 2, until_at: START }))).toEqual({ reason: 'reserved', count: 2, untilAt: START });
  });

  it('reads MATCH_TOO_LATE minutes from the payload’s server_now', () => {
    expect(matchErrorKey(err('MATCH_TOO_LATE', '180'), { serverNow: '2026-10-01T15:00:00.000Z' })).toEqual({
      key: 'ws.matches.errors.tooLateAt',
      timeAt: '2026-10-01T18:00:00.000Z',
    });
    expect(matchErrorKey(err('MATCH_TOO_LATE', '180')).key).not.toBe('ws.matches.errors.tooLateAt');
  });

  it('puts the time in the sentence in the branch timezone, Latin digits in Arabic', () => {
    const e = err('MATCH_TOO_LATE', '180');
    const opts = { serverNow: '2026-10-01T15:00:00.000Z', tz: 'Asia/Baghdad' };
    expect(matchErrorText(e, { ...opts, tr: en, locale: 'en' })).toBe(
      en('ws.matches.errors.tooLateAt', { time: formatTime(new Date('2026-10-01T18:00:00.000Z'), 'en', 'Asia/Baghdad') }),
    );
    const arText = matchErrorText(e, { ...opts, tr: ar, locale: 'ar' });
    expect(arText).toContain('9:00');
    expect(arText).not.toMatch(/[٠-٩]/);
  });

  it('reads SEAT_OWED_CHANGED’s new owed from its detail', () => {
    expect(seatOwedNow(err('SEAT_OWED_CHANGED', 'expected 20000, now 12500'))).toBe(12500);
    expect(seatOwedNow(err('SEAT_OWED_CHANGED'))).toBeNull();
    expect(seatOwedNow(err('NOTHING_OWED', 'now 5'))).toBeNull();
  });
});

describe('matchReadStatus (§5.5)', () => {
  const q = (over: Partial<Parameters<typeof matchReadStatus>[0]> = {}) => ({
    data: undefined,
    error: null,
    isError: false,
    isPlaceholderData: false,
    dataUpdatedAt: 0,
    ...over,
  });

  it('is absent when the server has no matches (RPC_MISSING answers null)', () => {
    expect(matchReadStatus(q({ data: null }), true)).toEqual({ kind: 'absent' });
    expect(matchReadStatus(q({ isError: true, error: new AppRpcError('RPC_MISSING', 'x') }), true)).toEqual({ kind: 'absent' });
  });

  it('fails visibly the first time, loads, then keeps the last data with a stale mark', () => {
    const e = new TypeError('Failed to fetch');
    expect(matchReadStatus(q({ isError: true, error: e }), true)).toEqual({ kind: 'failed', error: e });
    expect(matchReadStatus(q(), true)).toEqual({ kind: 'loading' });
    expect(matchReadStatus(q({ data: [1], dataUpdatedAt: 5 }), true)).toEqual({ kind: 'ready', data: [1], stale: false, updatedAt: 5 });
    expect(matchReadStatus(q({ data: [1], isError: true, error: e }), true)).toMatchObject({ kind: 'ready', stale: true });
    expect(matchReadStatus(q({ data: [1] }), false)).toMatchObject({ kind: 'ready', stale: true });
    expect(matchReadStatus(q({ data: [1], isPlaceholderData: true }), true)).toMatchObject({ kind: 'ready', stale: true });
  });
});

describe('the lane’s counted phrases (§5.21, R38)', () => {
  it('reads every plural form, Latin digits isolated, and the zero form at 0', () => {
    const n = (c: number) => isolateLtr(String(c));
    expect(countPhrase('ws.matches.count.players', 1, 'en')).toBe('one player');
    expect(countPhrase('ws.matches.count.players', 3, 'en')).toBe(`${n(3)} players`);
    expect(countPhrase('ws.matches.count.players', 0, 'en')).toBe('no players');
    expect(countPhrase('ws.matches.count.players', 2, 'ar')).toBe('لاعبان');
    expect(countPhrase('ws.matches.count.players', 3, 'ar')).toBe(`${n(3)} لاعبين`);
    expect(countPhrase('ws.matches.count.players', 11, 'ar')).toBe(`${n(11)} لاعبًا`);
    expect(countPhrase('ws.matches.count.playersF', 1, 'ar')).toBe('لاعبة واحدة');
    expect(countPhrase('ws.matches.count.shares', 2, 'ar')).toBe('حصتان');
    expect(countPhrase('ws.matches.count.tickets', 4, 'ar')).toBe(`${n(4)} تذاكر`);
    expect(countPhrase('ws.matches.count.seats', 0, 'ar')).toBe('لا مقاعد');
    expect(countPhrase('ws.matches.count.seats', 100, 'ar')).toBe(`${n(100)} مقعد`);
  });

  it('after a verbal noun (استرداد، استلام) the dual is genitive; the other forms are unchanged', () => {
    const n = (c: number) => isolateLtr(String(c));
    expect(countPhrase('ws.matches.count.ticketsGen', 2, 'ar')).toBe('تذكرتين');
    expect(countPhrase('ws.matches.count.sharesGen', 2, 'ar')).toBe('حصتين');
    expect(countPhrase('ws.matches.count.ticketsGen', 3, 'ar')).toBe(`${n(3)} تذاكر`);
    expect(countPhrase('ws.matches.count.sharesGen', 1, 'ar')).toBe('حصة واحدة');
    expect(countPhrase('ws.matches.count.sharesGen', 2, 'en')).toBe(`${n(2)} shares`);
    expect(t('ar', 'ws.matches.take.severalButton', { shares: countPhrase('ws.matches.count.sharesGen', 2, 'ar'), amount: '20,000' })).toBe('استلام حصتين · 20,000');
  });
});
