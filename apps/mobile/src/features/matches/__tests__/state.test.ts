import { describe, expect, it } from 'vitest';
import { formatIQD, isolateLtr, makeT, type Locale } from '@touch/i18n';
import {
  actionCardOf,
  guestStateOf,
  leaveConfirm,
  ownSeatOf,
  partyShareIqd,
  stateInputOfDetail,
  stateInputOfMine,
  stateLine,
  stateSection,
  type StateInput,
} from '../state';
import type { MatchCategory, MatchDetail, MySeat, SeatStatus } from '../logic';
import { matchDetailFixture, myMatchRowFixture } from '../../../test/fixtures';

/**
 * Every guest state of docs/design/open-matches/guest.md §4.15, row by row,
 * and the dead ends R32 closed: a linked desk seat has states without ticket
 * phrases, a desk removal reads "Removed by the venue", `no_court` has its own
 * line. The first matching row wins, so each case also proves the rows above
 * it did not match.
 */

let n = 0;
function seat(over: Partial<MySeat> = {}): MySeat {
  n += 1;
  return {
    seatId: `s-${n}`,
    seatNo: 1,
    kind: 'account',
    status: 'in',
    endReason: null,
    shareIqd: 10000,
    requestId: null,
    ticketStatus: 'in_use',
    ...over,
  };
}

function input(over: Partial<StateInput> = {}): StateInput {
  return { status: 'filling', endedReason: null, role: 'player', seats: [seat()], request: null, ...over };
}

const own = (status: SeatStatus, extra: Partial<MySeat> = {}) => [seat({ status, ...extra })];

describe('guestStateOf: the §4.15 table', () => {
  const rows: [number, string, StateInput][] = [
    [1, 'requested', input({ seats: [], role: 'requester', request: { requestId: 'q', status: 'pending', seatsRequested: 2, decidedAt: null } })],
    [2, 'declined', input({ seats: [], request: { requestId: 'q', status: 'declined', seatsRequested: 1, decidedAt: null } })],
    [3, 'withdrawn', input({ seats: [], request: { requestId: 'q', status: 'withdrawn', seatsRequested: 1, decidedAt: null } })],
    [4, 'requestExpired', input({ seats: [], request: { requestId: 'q', status: 'expired', seatsRequested: 1, decidedAt: null } })],
    [5, 'approvedIn', input({ seats: own('in', { requestId: 'q' }) })],
    [6, 'in', input()],
    [7, 'awaitingCourt', input({ status: 'awaiting_court' })],
    [8, 'booked', input({ status: 'booked' })],
    [9, 'checkedIn', input({ status: 'booked', seats: own('attended', { ticketStatus: 'available' }) })],
    [10, 'leftLate', input({ status: 'booked', seats: own('left_late', { endReason: 'left' }) })],
    [11, 'removedLate', input({ status: 'booked', seats: own('left_late', { endReason: 'removed_by_staff' }) })],
    [12, 'leftLateLost', input({ status: 'played', seats: own('left_late', { endReason: 'left', ticketStatus: 'forfeited' }) })],
    [13, 'leftDesk', input({ status: 'booked', seats: own('left_late', { kind: 'desk', ticketStatus: null, endReason: 'left' }) })],
    [14, 'refilled', input({ status: 'booked', seats: own('refilled', { ticketStatus: 'available' }) })],
    [15, 'calledOff', input({ status: 'cancelled', endedReason: 'called_off_short', seats: own('attended', { ticketStatus: 'available' }) })],
    [16, 'played', input({ status: 'played', seats: own('attended', { ticketStatus: 'available' }) })],
    [17, 'noShow', input({ status: 'played', seats: own('no_show', { ticketStatus: 'forfeited' }) })],
    [18, 'left', input({ seats: own('left', { endReason: 'left', ticketStatus: 'available' }) })],
    [19, 'removed', input({ role: 'removed', seats: own('removed', { endReason: 'removed_by_organiser' }) })],
    [20, 'removedByVenue', input({ seats: own('removed', { endReason: 'removed_by_staff' }) })],
    [21, 'banned', input({ seats: own('removed', { endReason: 'banned' }) })],
    [22, 'bumped', input({ status: 'bumped', endedReason: 'bumped', seats: own('cancelled') })],
    [23, 'expired', input({ status: 'expired', endedReason: 'deadline', seats: own('cancelled') })],
    [24, 'noCourt', input({ status: 'expired', endedReason: 'no_court', seats: own('cancelled') })],
    [25, 'cancelledByOrganiser', input({ status: 'cancelled', endedReason: 'organiser_cancelled', seats: own('cancelled') })],
    [26, 'cancelledByVenue', input({ status: 'cancelled', endedReason: 'staff_cancelled', seats: own('cancelled') })],
    [27, 'closedEmpty', input({ status: 'cancelled', endedReason: 'empty', seats: own('cancelled') })],
    [28, 'unknown', input({ status: 'played', seats: own('in') })],
  ];

  it.each(rows)('row %i reads %s', (row, state, i) => {
    const r = guestStateOf(i);
    expect(r.state).toBe(state);
    expect(r.row).toBe(row);
  });

  it('reads every venue cancel as the venue (row 26)', () => {
    for (const reason of ['staff_cancelled', 'reservation_cancelled', 'venue_closed'] as const) {
      expect(guestStateOf(input({ status: 'cancelled', endedReason: reason, seats: own('cancelled') })).state).toBe(
        'cancelledByVenue',
      );
    }
  });

  it('reads an attended seat on a cancelled match as called off, not played (row 15 before 16)', () => {
    expect(guestStateOf(input({ status: 'cancelled', endedReason: 'staff_cancelled', seats: own('attended') })).state).toBe(
      'calledOff',
    );
  });

  it('never reads a desk removal as "You left" (R32 item 3)', () => {
    const late = guestStateOf(input({ status: 'booked', seats: own('left_late', { endReason: 'removed_by_staff' }) }));
    expect(late.state).toBe('removedLate');
    const lost = guestStateOf(
      input({ status: 'played', seats: own('left_late', { endReason: 'removed_by_staff', ticketStatus: 'forfeited' }) }),
    );
    expect(lost.state).toBe('leftLateLost');
    expect(lost.endReason).toBe('removed_by_staff');
    // A linked desk seat the venue removed after booking: no ticket, so rows 11
    // and 12 cannot catch it, and row 13 is for a desk seat that left.
    const desk = guestStateOf(
      input({ status: 'booked', seats: own('left_late', { kind: 'desk', ticketStatus: null, endReason: 'removed_by_staff' }) }),
    );
    expect(desk.state).not.toBe('leftDesk');
    expect(desk.state).toBe('removedByVenue');
    expect(desk.tickets).toBe(0);
    for (const locale of ['en', 'ar'] as const) {
      const t = makeT(locale);
      const line = stateLine(desk, ctx(locale));
      expect(line).toBe(t('matches.states.removedByVenue'));
      expect(line).not.toContain(t('matches.states.leftDesk'));
    }
    expect(stateLine(desk, ctx('en'))).not.toMatch(/You left|ticket/);
    expect(stateLine(desk, ctx('ar'))).not.toMatch(/غادرت|تذكر|تذاكر/);
    // A desk seat that left is still row 13.
    const left = guestStateOf(
      input({ status: 'booked', seats: own('left_late', { kind: 'desk', ticketStatus: null, endReason: 'left' }) }),
    );
    expect(left.row).toBe(13);
  });

  it('knows nothing it was not told: a request that is still unknown, and no seat, is unknown', () => {
    expect(guestStateOf(input({ seats: [], request: null })).state).toBe('unknown');
    expect(guestStateOf(input({ seats: [], request: { requestId: 'q', status: null, seatsRequested: 1, decidedAt: null } })).state).toBe(
      'unknown',
    );
  });

  it('takes the LATEST own seat: a guest who left and joined again is in', () => {
    const seats = [seat({ status: 'left', endReason: 'left', ticketStatus: 'available' }), seat({ status: 'in' })];
    expect(guestStateOf(input({ seats })).state).toBe('in');
    expect(ownSeatOf(seats)?.status).toBe('in');
  });

  it('never takes a friend seat as the own seat', () => {
    const seats = [seat({ status: 'in' }), seat({ kind: 'friend', status: 'in', seatNo: 2 })];
    expect(ownSeatOf(seats)?.kind).toBe('account');
    expect(ownSeatOf([seat({ kind: 'friend' })])).toBeNull();
  });
});

describe('desk seats (R32 item 2): the same states, no ticket phrase', () => {
  const desk = (status: SeatStatus, extra: Partial<MySeat> = {}) => [
    seat({ kind: 'desk', ticketStatus: null, status, ...extra }),
  ];

  it.each([
    ['in', 'filling', 'in'],
    ['in', 'awaiting_court', 'awaitingCourt'],
    ['in', 'booked', 'booked'],
    ['attended', 'booked', 'checkedIn'],
    ['attended', 'played', 'played'],
    ['no_show', 'played', 'noShow'],
  ] as const)('a %s desk seat on a %s match reads %s, with no tickets', (status, match, state) => {
    const r = guestStateOf(input({ status: match, seats: desk(status) }));
    expect(r.state).toBe(state);
    expect(r.desk).toBe(true);
    expect(r.tickets).toBe(0);
  });

  it('drops the ticket phrase from the line', () => {
    const t = makeT('en');
    const r = guestStateOf(input({ status: 'played', seats: desk('attended') }));
    expect(stateLine(r, ctx('en'))).toBe(t('matches.states.played'));
    expect(stateLine(r, ctx('en'))).not.toContain('ticket');
  });
});

function ctx(locale: Locale, over: Partial<Parameters<typeof stateLine>[1]> = {}) {
  return {
    t: makeT(locale),
    locale,
    category: 'open' as MatchCategory,
    timezone: 'Asia/Baghdad',
    isOrganiser: false,
    seatsTaken: 3,
    fillDeadlineAt: '2026-10-01T15:00:00.000Z',
    ...over,
  };
}

describe('stateLine', () => {
  it('counts the ticket phrase by the party: one ticket, then two', () => {
    const one = guestStateOf(input({ seats: own('left', { ticketStatus: 'available' }) }));
    expect(stateLine(one, ctx('en'))).toBe('You left · ticket back');
    const two = guestStateOf(
      input({
        seats: [
          seat({ status: 'left', ticketStatus: 'available' }),
          seat({ kind: 'friend', status: 'left', seatNo: 2, ticketStatus: 'available' }),
        ],
      }),
    );
    expect(two.tickets).toBe(2);
    expect(stateLine(two, ctx('en'))).toBe('You left · tickets back');
    expect(stateLine(two, ctx('ar'))).toBe('غادرت · عادت تذكرتاك');
  });

  it('speaks of a request by the seats it asked for', () => {
    const r = guestStateOf(input({ seats: [], request: { requestId: 'q', status: 'declined', seatsRequested: 3, decidedAt: null } }));
    expect(stateLine(r, ctx('en'))).toBe('Request not accepted · tickets back in your wallet');
    expect(stateLine(r, ctx('ar'))).toBe('لم يُقبل الطلب · عادت تذاكرك إلى محفظتك');
  });

  it('fills "waiting for {players}" and "fills by {time}" in the branch time zone', () => {
    const line = stateLine(guestStateOf(input()), ctx('en', { seatsTaken: 2 }));
    // `{count}` is LTR-isolated Latin digits (countPhrase).
    expect(line).toContain(`waiting for ${isolateLtr('2')} more players`);
    // 15:00 UTC is 18:00 in Baghdad.
    expect(line).toMatch(/fills by 6:00\s?PM/);
    expect(stateLine(guestStateOf(input()), ctx('en', { seatsTaken: 3 }))).toContain('waiting for 1 more player ·');
  });

  it('puts "{taken}/4" in ONE LTR isolate, so it never reads "4/3" in Arabic', () => {
    for (const locale of ['en', 'ar'] as const) {
      const line = stateLine(guestStateOf(input({ seats: own('in', { requestId: 'q' }) })), ctx(locale, { seatsTaken: 3 }));
      expect(line).toContain(isolateLtr('3/4'));
      expect(line).not.toContain(`${isolateLtr('3')}/`);
    }
  });

  it('adds the party share at the desk to a booked line', () => {
    const r = guestStateOf(input({ status: 'booked' }));
    expect(stateLine(r, ctx('en'), 10000)).toBe(`Booked · ${formatIQD(10000, 'en')} at the desk`);
    expect(stateLine(r, ctx('en'))).toBe('Booked');
  });

  it('checked in: the ticket is back and the share is still owed', () => {
    const r = guestStateOf(input({ status: 'booked', seats: own('attended', { ticketStatus: 'available' }) }));
    expect(stateLine(r, ctx('en'), 10000)).toBe(`Checked in · ticket back · ${formatIQD(10000, 'en')} at the desk`);
  });

  it('reads the organiser own cancel as "You cancelled this match"', () => {
    const r = guestStateOf(input({ status: 'cancelled', endedReason: 'organiser_cancelled', seats: own('cancelled') }));
    expect(stateLine(r, ctx('en', { isOrganiser: true }))).toBe('You cancelled this match · ticket back');
    expect(stateLine(r, ctx('en'))).toBe('Cancelled by the organiser · ticket back');
  });

  it('takes the feminine third person in a women’s match, and only there', () => {
    const removed = guestStateOf(input({ seats: own('removed', { endReason: 'removed_by_organiser' }) }));
    expect(stateLine(removed, ctx('ar', { category: 'women' }))).toContain('أزالتك المنظّمة');
    expect(stateLine(removed, ctx('ar', { category: 'men' }))).toContain('أزالك المنظّم');
    const refilled = guestStateOf(input({ status: 'booked', seats: own('refilled', { ticketStatus: 'available' }) }));
    expect(stateLine(refilled, ctx('ar', { category: 'women' }))).toContain('أخذت لاعبة أخرى مقعدك');
    const waiting = stateLine(guestStateOf(input()), ctx('ar', { category: 'women', seatsTaken: 2 }));
    expect(waiting).toContain('لاعبتين');
    const req = guestStateOf(input({ seats: [], request: { requestId: 'q', status: 'pending', seatsRequested: 1, decidedAt: null } }));
    expect(stateLine(req, ctx('ar', { category: 'women' }))).toBe('أُرسل الطلب · بانتظار ردّ المنظّمة');
    expect(stateLine(req, ctx('ar'))).toBe('أُرسل الطلب · بانتظار ردّ المنظّم');
  });

  it('writes a removal after the booking by the venue, never as leaving', () => {
    const lost = guestStateOf(
      input({ status: 'played', seats: own('left_late', { endReason: 'removed_by_staff', ticketStatus: 'forfeited' }) }),
    );
    expect(stateLine(lost, ctx('en'))).toBe('The venue removed you and nobody took your seat · ticket lost');
  });

  it('has a line for every state in both languages, with no stray placeholder', () => {
    const all: StateInput[] = [
      input(),
      input({ status: 'expired', endedReason: 'no_court', seats: own('cancelled') }),
      input({ status: 'cancelled', endedReason: 'called_off_short', seats: own('attended') }),
      input({ seats: own('removed', { endReason: 'banned' }) }),
      input({ status: 'played', seats: own('no_show', { ticketStatus: 'forfeited' }) }),
      input({ status: 'expired', endedReason: 'deadline', seats: own('cancelled') }),
    ];
    for (const locale of ['en', 'ar'] as const) {
      for (const i of all) {
        const line = stateLine(guestStateOf(i), ctx(locale), 10000);
        expect(line.length).toBeGreaterThan(0);
        expect(line).not.toMatch(/[{}]/);
      }
    }
  });
});

describe('stateSection', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const future = { startAt: '2026-10-02T17:00:00Z', endAt: '2026-10-02T18:30:00Z', now };
  const past = { startAt: '2026-09-30T17:00:00Z', endAt: '2026-09-30T18:30:00Z', now };

  it('files each state where §4.15 says', () => {
    expect(stateSection('requested', future)).toBe('open');
    expect(stateSection('in', future)).toBe('open');
    expect(stateSection('booked', future)).toBe('upcoming');
    expect(stateSection('checkedIn', future)).toBe('upcoming');
    expect(stateSection('played', past)).toBe('played');
    expect(stateSection('noCourt', past)).toBe('cancelled');
    expect(stateSection('noShow', past)).toBe('history');
    expect(stateSection('declined', future)).toBe('history');
  });

  it('keeps a late leaver under Open matches until the start, and a booking under Upcoming until its end', () => {
    expect(stateSection('leftLate', future)).toBe('open');
    expect(stateSection('leftLate', past)).toBe('history');
    expect(stateSection('booked', past)).toBe('history');
  });
});

describe('partyShareIqd', () => {
  it('sums the own seat and the friends still in, from the server’s shares', () => {
    const seats = [
      seat({ shareIqd: 10001 }),
      seat({ kind: 'friend', seatNo: 2, shareIqd: 10000 }),
      seat({ kind: 'friend', seatNo: 3, shareIqd: 10000, status: 'left' }),
    ];
    const r = guestStateOf(input({ status: 'booked', seats }));
    expect(partyShareIqd(r, seats)).toBe(20001);
  });

  it('is null without a seat', () => {
    expect(partyShareIqd(guestStateOf(input({ seats: [] })), [])).toBeNull();
  });
});

describe('the adapters', () => {
  it('read the same fields from the detail and from a my_matches row', () => {
    const d = matchDetailFixture();
    expect(stateInputOfDetail(d)).toEqual({ status: 'filling', endedReason: null, role: 'viewer', seats: [], request: null });
    const m = myMatchRowFixture();
    expect(guestStateOf(stateInputOfMine(m)).state).toBe('in');
  });
});

describe('actionCardOf (§4.14)', () => {
  const now = Date.now();
  const detail = (over: Partial<MatchDetail> = {}, me: Partial<MatchDetail['me']> = {}) => {
    const d = matchDetailFixture(over);
    return { ...d, me: { ...d.me, ...me } };
  };

  it('offers Join to a viewer with a ticket, up to the seats left (at most three)', () => {
    expect(actionCardOf(detail(), { genderUnset: false, nowMs: now })).toEqual({ kind: 'join', maxSeats: 1 });
    expect(actionCardOf(detail({ seatsLeft: 4 }), { genderUnset: false, nowMs: now })).toEqual({ kind: 'join', maxSeats: 3 });
  });

  it('offers the buy card when the wallet cannot cover one seat', () => {
    const d = detail({}, { ticketsAvailable: 0, ticketsNeeded: 1 });
    expect(actionCardOf(d, { genderUnset: false, nowMs: now })).toEqual({ kind: 'buy', mode: 'join', missing: 1, maxSeats: 1 });
    const ask = detail(
      { joinPolicy: 'approve' },
      { ticketsAvailable: 0, ticketsNeeded: 1, can: { ...matchDetailFixture().me.can, join: false, request: true } },
    );
    expect(actionCardOf(ask, { genderUnset: false, nowMs: now })).toMatchObject({ kind: 'buy', mode: 'ask' });
  });

  it('asks the gender first while it is unset (OM-28)', () => {
    expect(actionCardOf(detail(), { genderUnset: true, nowMs: now })).toEqual({ kind: 'gender' });
    const refused = detail({}, { refusal: 'GENDER_REQUIRED', can: { ...matchDetailFixture().me.can, join: false } });
    expect(actionCardOf(refused, { genderUnset: false, nowMs: now })).toEqual({ kind: 'gender' });
  });

  it('shows any other refusal as its copy, with no button', () => {
    const d = detail({}, { refusal: 'MATCH_TIME_CLASH', can: { ...matchDetailFixture().me.can, join: false } });
    expect(actionCardOf(d, { genderUnset: false, nowMs: now })).toEqual({ kind: 'refusal', code: 'MATCH_TIME_CLASH' });
  });

  it('shows the organiser’s removal before anything else (OM-44)', () => {
    expect(actionCardOf(detail({}, { excluded: true }), { genderUnset: true, nowMs: now })).toEqual({ kind: 'excluded' });
  });

  it('shows a pending request with the tickets it holds', () => {
    const d = detail({}, { role: 'requester', request: { requestId: 'q', status: 'pending', seatsRequested: 2, decidedAt: null } });
    expect(actionCardOf(d, { genderUnset: false, nowMs: now })).toEqual({ kind: 'requested', tickets: 2 });
  });

  it('shows a member their seat by the match’s status', () => {
    const me = { role: 'player' as const, seats: [seat()] };
    expect(actionCardOf(detail({}, me), { genderUnset: false, nowMs: now })).toEqual({ kind: 'in', approved: false });
    expect(actionCardOf(detail({ status: 'awaiting_court' }, me), { genderUnset: false, nowMs: now })).toEqual({ kind: 'awaitingCourt' });
    expect(actionCardOf(detail({ status: 'booked' }, me), { genderUnset: false, nowMs: now })).toEqual({ kind: 'booked' });
    // After the start a booked member has no card of their own: the state line.
    const started = detail({ status: 'booked', startAt: new Date(now - 60_000).toISOString() }, { ...me, can: { ...matchDetailFixture().me.can, join: false } });
    expect(actionCardOf(started, { genderUnset: false, nowMs: now })).toEqual({ kind: 'state' });
  });
});

describe('leaveConfirm', () => {
  it('follows the server’s leave_outcome, with the friends and organiser lines', () => {
    const d = matchDetailFixture();
    expect(leaveConfirm(d)).toBeNull();
    const member = {
      ...d,
      me: {
        ...d.me,
        role: 'organiser' as const,
        leaveOutcome: 'locked_until_refill' as const,
        seats: [seat(), seat({ kind: 'friend', seatNo: 2 })],
      },
    };
    expect(leaveConfirm(member)).toEqual({ outcome: 'locked_until_refill', withFriends: true, organiser: true });
  });
});
