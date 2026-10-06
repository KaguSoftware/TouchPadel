import { describe, expect, it } from 'vitest';
import { isolate, isolateLtr, makeT } from '@touch/i18n';
import {
  buyCounts,
  byCategory,
  canStartAt,
  chipCellKeys,
  chipKey,
  displayName,
  displaySeat,
  freeCourtsAt,
  friendsFor,
  guestWindow,
  matchStartIntent,
  minuteWindow,
  missingTickets,
  needsFriendsDeclaration,
  parseMatchInvite,
  parseMatchQuote,
  parseMatchSlots,
  parseMatchView,
  parseMyMatches,
  parseOpenMatches,
  parseTicketBegin,
  parseTicketWallet,
  seatsOfLabel,
  slotActions,
  slotMatchesByStart,
  tradingNightOf,
  type MatchSeat,
  type MyMatchRow,
} from '../logic';
import { mergeReservationLists } from '../reservations';
import type { BookingRow } from '../../booking/logic';
import { myMatchRowFixture } from '../../../test/fixtures';

/**
 * The pure half of open matches (docs/design/open-matches/guest.md §4.3,
 * §4.9, §4.11, §4.12, §4.16): the defensive parsers of every read, how a
 * player prints, the Book tab's choice sheet and chips, trading nights, the
 * guest window and My Reservations' merge.
 */

const tEn = makeT('en');
const tAr = makeT('ar');

// ── Parsers ─────────────────────────────────────────────────────────────────

describe('parseMatchView', () => {
  const full = {
    id: 'm-1',
    venue_id: 'v-1',
    status: 'filling',
    ended_reason: null,
    start_at: '2026-10-02T17:00:00Z',
    end_at: '2026-10-02T18:30:00Z',
    duration_min: 90,
    category: 'women',
    visibility: 'link',
    join_policy: 'approve',
    price_iqd: 40000,
    shares_iqd: [10000, 10000, 10000, 10000],
    fill_deadline_at: '2026-10-02T15:00:00Z',
    seats_taken: 2,
    seats_left: 2,
    seats_total: 4,
    court_id: null,
    organiser: { name: 'Sara M.', former: false, is_me: false },
    seats: [
      {
        seat_id: 's-2', seat_no: 2, kind: 'friend', status: 'in', name: 'Sara M.', former: false,
        holder_seat_no: 1, is_me: false, is_mine: false, share_iqd: 10000, open: false,
        can: { remove: false, report: true, block: true },
      },
      {
        seat_id: 's-1', seat_no: 1, kind: 'account', status: 'in', name: 'Sara M.', former: false,
        holder_seat_no: null, is_me: false, is_mine: false, share_iqd: 10000, open: false,
        can: { remove: false, report: true, block: true },
      },
    ],
    me: {
      role: 'viewer', seats: [], request: null, excluded: false, refusal: null,
      tickets_available: 1, tickets_needed: 0, leave_outcome: 'none',
      can: { join: false, request: true, withdraw: false, leave: false, cancel: false, remove: false,
             decide: false, message: false, report: false, block: false, share: false },
    },
    requests: [],
    messages: [{ code: 'on_my_way', seat_no: 1, name: 'Sara M.', former: false, is_me: false, at: 'x' }, { code: 'shout', is_me: true }],
    share_token: null,
    server_now: '2026-10-01T12:00:00Z',
  };

  it('reads the full shape, seats in seat order', () => {
    const v = parseMatchView(full);
    if (v.restricted) throw new Error('expected the full shape');
    expect(v.category).toBe('women');
    expect(v.joinPolicy).toBe('approve');
    expect(v.visibility).toBe('link');
    expect(v.seats.map((s) => s.seatNo)).toEqual([1, 2]);
    expect(v.seats[1]!.holderSeatNo).toBe(1);
    expect(v.me.can.request).toBe(true);
    expect(v.me.ticketsAvailable).toBe(1);
    expect(v.messages[0]!.code).toBe('on_my_way');
  });

  it('parses every enum defensively: an unknown value falls back, never throws', () => {
    const v = parseMatchView({
      ...full,
      status: 'teleported',
      category: 'mixed',
      join_policy: 'lottery',
      me: { ...full.me, role: 'captain', leave_outcome: 'maybe', can: 'yes' },
    });
    if (v.restricted) throw new Error('expected the full shape');
    expect(v.status).toBeNull();
    expect(v.category).toBe('open');
    expect(v.joinPolicy).toBe('open');
    expect(v.me.role).toBe('viewer');
    expect(v.me.leaveOutcome).toBe('none');
    expect(v.me.can.join).toBe(false);
    // An unknown preset message code is kept as null, so the feed skips it.
    expect(v.messages[1]!.code).toBeNull();
  });

  it('reads the restricted card by its marker, with no ids and no names (R32)', () => {
    const v = parseMatchView({
      restricted: true, status: 'filling', start_at: 's', end_at: 'e', category: 'men', join_policy: 'open',
      seats_left: 2, venue: { name_en: 'Touch', name_ar: 'تاتش' }, timezone: 'Asia/Baghdad',
      me: { refusal: 'MATCH_BANNED' }, server_now: 'n',
    });
    expect(v.restricted).toBe(true);
    if (!v.restricted) return;
    expect(v.refusal).toBe('MATCH_BANNED');
    expect(v.venue?.nameAr).toBe('تاتش');
    expect(Object.keys(v)).not.toContain('id');
    expect(parseMatchView({ restricted: true, me: { refusal: 'SOMETHING_NEW' } })).toMatchObject({
      refusal: 'MATCH_UNAVAILABLE',
    });
  });

  it('refuses an answer with no match in it', () => {
    expect(() => parseMatchView({})).toThrow('MALFORMED_MATCH_DETAIL');
  });
});

describe('the list parsers', () => {
  it('reads match_slots and drops a row without a start', () => {
    const rows = parseMatchSlots([
      { start_at: '2026-10-02T17:00:00Z', end_at: '2026-10-02T18:30:00Z', duration_min: 90, category: 'open', join_policy: 'open', seats_left: 1, mine: false },
      { end_at: 'x' },
      'garbage',
    ]);
    expect(rows).toHaveLength(1);
    expect(parseMatchSlots(null)).toEqual([]);
  });

  it('reads open_matches, banned or not', () => {
    const r = parseOpenMatches({
      banned: false,
      matches: [{ match_id: 'm-1', start_at: 's', status: 'booked', refill: true, seats_left: 1, share_iqd: '10000', mine: 'seated' }],
    });
    expect(r.matches[0]).toMatchObject({ matchId: 'm-1', status: 'booked', refill: true, shareIqd: 10000, mine: 'seated' });
    expect(parseOpenMatches({ banned: true, matches: [] })).toEqual({ banned: true, matches: [] });
  });

  it('reads my_matches rows with their seats, request and ticket counts', () => {
    const [row] = parseMyMatches([
      {
        match_id: 'm-1', status: 'booked', start_at: 's', end_at: 'e', my_role: 'organiser', is_organiser: true,
        my_seats: [{ seat_id: 's-1', seat_no: 1, kind: 'desk', status: 'in', ticket_status: null }],
        request: { request_id: 'q-1', status: 'approved', seats_requested: 2, decided_at: 'd' },
        my_tickets: { locked: 1, released: 0, forfeited: 0 },
      },
    ]);
    expect(row!.mySeats[0]).toMatchObject({ kind: 'desk', ticketStatus: null });
    expect(row!.request).toEqual({ requestId: 'q-1', status: 'approved', seatsRequested: 2, decidedAt: 'd' });
    expect(row!.isOrganiser).toBe(true);
  });

  it('reads the invite; anything unreadable is closed (no oracle)', () => {
    expect(parseMatchInvite({ status: 'closed' })).toEqual({ status: 'closed' });
    expect(parseMatchInvite({ status: 'open' })).toEqual({ status: 'closed' });
    expect(parseMatchInvite(null)).toEqual({ status: 'closed' });
    expect(
      parseMatchInvite({ status: 'full', start_at: 's', timezone: 'Asia/Baghdad', venue: { name_en: 'T' }, seats_left: 0 }),
    ).toMatchObject({ status: 'full', seatsLeft: 0, venue: { nameEn: 'T', nameAr: null } });
  });

  it('reads the quote; a NO_RATE quote has no price or shares', () => {
    const q = parseMatchQuote({ enabled: true, price_iqd: null, shares_iqd: null, categories: ['open', 'x'], refusal: 'NO_RATE', seats_max: 9 });
    expect(q.priceIqd).toBeNull();
    expect(q.sharesIqd).toBeNull();
    expect(q.categories).toEqual(['open']);
    expect(q.seatsMax).toBe(3);
    expect(q.refusal).toBe('NO_RATE');
  });

  it('reads the wallet and its purchase in progress', () => {
    const w = parseTicketWallet({
      price_iqd: 10000, max_available: 9, available: 2, reserved: 1, in_use: 1, sandbox: true,
      tickets: [
        { id: 'k-1', status: 'in_use', match: { match_id: 'm-1', start_at: 's', venue_id: 'v', status: 'filling' } },
        { id: 'k-2', status: 'available', match: null },
        { status: 'available' },
      ],
      purchases: [{ request_id: 'r-1', status: 'succeeded', ticket_count: 2, amount_iqd: 20000 }],
      pending: { request_id: 'r-2', status: 'pending', ticket_count: 1, amount_iqd: 10000, form_url: 'https://pay', deadline_at: 'd' },
    });
    expect(w.sandbox).toBe(true);
    expect(w.tickets).toHaveLength(2);
    expect(w.tickets[0]!.match?.matchId).toBe('m-1');
    expect(w.pending?.formUrl).toBe('https://pay');
    expect(parseTicketWallet({}).pending).toBeNull();
  });

  it('reads ticket-begin, and refuses an answer with no page to open', () => {
    expect(parseTicketBegin({ request_id: 'r', form_url: 'https://pay', ticket_count: 2, reused: true })).toMatchObject({
      ref: 'r',
      ticketCount: 2,
      reused: true,
    });
    expect(() => parseTicketBegin({ request_id: 'r' })).toThrow('MALFORMED_TICKET_BEGIN');
  });
});

// ── Tickets ─────────────────────────────────────────────────────────────────

describe('buyCounts and missingTickets (§4.10)', () => {
  it('offers 1..3, no more than the wallet cap leaves room for', () => {
    expect(buyCounts({ maxAvailable: 9, available: 0 })).toEqual([1, 2, 3]);
    expect(buyCounts({ maxAvailable: 9, available: 7 })).toEqual([1, 2]);
    expect(buyCounts({ maxAvailable: 9, available: 9 })).toEqual([]);
    expect(buyCounts({ maxAvailable: 9, available: 12 })).toEqual([]);
  });

  it('asks for the shortfall, one purchase at most', () => {
    expect(missingTickets(2, 1)).toBe(0);
    expect(missingTickets(0, 1)).toBe(1);
    expect(missingTickets(1, 3)).toBe(2);
    expect(missingTickets(0, 5)).toBe(3);
  });
});

describe('friends (OM-20, OM-39)', () => {
  it('declares the category’s gender for every friend; an open match sends null', () => {
    expect(friendsFor('women', 3)).toEqual([{ gender: 'female' }, { gender: 'female' }]);
    expect(friendsFor('men', 2)).toEqual([{ gender: 'male' }]);
    expect(friendsFor('open', 2)).toEqual([{ gender: null }]);
    expect(friendsFor('open', 1)).toEqual([]);
    expect(friendsFor('open', 9)).toHaveLength(2);
  });

  it('needs the friends-gender switch only in a gendered match with friends', () => {
    expect(needsFriendsDeclaration('women', 2)).toBe(true);
    expect(needsFriendsDeclaration('women', 1)).toBe(false);
    expect(needsFriendsDeclaration('open', 3)).toBe(false);
  });
});

// ── Printing a player (§4.9) ────────────────────────────────────────────────

const seat = (over: Partial<MatchSeat>): MatchSeat => ({
  seatId: 's',
  seatNo: 1,
  kind: 'account',
  status: 'in',
  name: 'Ahmed K.',
  former: false,
  holderSeatNo: null,
  isMe: false,
  isMine: false,
  shareIqd: 10000,
  open: false,
  can: { remove: false, report: false, block: false },
  ...over,
});

describe('displaySeat', () => {
  it('prints a name isolated', () => {
    expect(displaySeat(seat({}), 'open', tEn)).toBe(isolate('Ahmed K.'));
  });

  it('prints a deleted account as Former player, feminine in a women’s match', () => {
    expect(displaySeat(seat({ former: true, name: null }), 'open', tEn)).toBe('Former player');
    expect(displaySeat(seat({ former: true, name: null }), 'women', tAr)).toBe('لاعبة سابقة');
    expect(displaySeat(seat({ former: true, name: null }), 'men', tAr)).toBe('لاعب سابق');
  });

  it('prints an unnamed seat as Player', () => {
    expect(displaySeat(seat({ name: null }), 'open', tAr)).toBe('لاعب');
    expect(displaySeat(seat({ name: null }), 'women', tAr)).toBe('لاعبة');
  });

  it('numbers a holder’s friend seats "+1", "+2" in seat order, "+k" LTR-isolated (GD-9)', () => {
    const grid = [
      seat({ seatId: 'a', seatNo: 1 }),
      seat({ seatId: 'c', seatNo: 3, kind: 'friend', holderSeatNo: 1 }),
      seat({ seatId: 'b', seatNo: 2, kind: 'friend', holderSeatNo: 1 }),
      seat({ seatId: 'd', seatNo: 4, name: 'Sara M.' }),
    ];
    expect(displaySeat(grid[2]!, 'open', tEn, grid)).toBe(`${isolate('Ahmed K.')} ${isolateLtr('+1')}`);
    expect(displaySeat(grid[1]!, 'open', tEn, grid)).toBe(`${isolate('Ahmed K.')} ${isolateLtr('+2')}`);
    // In Arabic "+1" never flips to "1+": it is its own LTR run.
    expect(displaySeat(grid[1]!, 'open', tAr, grid)).toContain(isolateLtr('+2'));
  });

  it('prints an open late-leave seat as taking a player', () => {
    expect(displaySeat(seat({ open: true, name: null }), 'open', tEn)).toBe('Open seat · taking a player');
    expect(displaySeat(seat({ open: true, name: null }), 'women', tAr)).toBe('مقعد متاح · بانتظار لاعبة');
  });

  it('prints a request or message author the same way', () => {
    expect(displayName({ name: null, former: true }, 'open', tEn)).toBe('Former player');
    expect(displayName({ name: 'Ali H.', former: false }, 'open', tEn)).toBe(isolate('Ali H.'));
  });

  it('byCategory picks the feminine twin in a women’s match only', () => {
    expect(byCategory('women', 'matches.common.player')).toBe('matches.common.playerF');
    expect(byCategory('men', 'matches.common.player')).toBe('matches.common.player');
    expect(byCategory(null, 'matches.common.player')).toBe('matches.common.player');
  });

  it('isolates "{taken}/4" as one unit, so the slash never flips in Arabic', () => {
    expect(seatsOfLabel(3, tAr)).toBe(isolateLtr('3/4'));
    expect(seatsOfLabel(1, tAr, 4)).toBe(isolateLtr('1/4'));
    // Two isolates around a bare slash would show "4/3" in an RTL paragraph.
    expect(seatsOfLabel(3, tAr)).not.toBe(`${isolateLtr('3')}/${isolateLtr('4')}`);
  });
});

// ── The Book tab (§4.11) ────────────────────────────────────────────────────

describe('slotActions', () => {
  it('offers view-mine before anything when a match at that minute is the guest’s', () => {
    expect(
      slotActions({ slotMatches: [{ mine: true, seatsLeft: 0 }, { mine: false, seatsLeft: 2 }], canStart: true, freeCourts: 3 }),
    ).toEqual(['view-mine', 'book', 'start']);
  });

  it('offers join when a match has a seat, then book', () => {
    expect(slotActions({ slotMatches: [{ mine: false, seatsLeft: 1 }], canStart: false, freeCourts: 2 })).toEqual(['join', 'book']);
  });

  it('offers start only while fewer matches fill there than courts are free (OM-42 hint)', () => {
    expect(slotActions({ slotMatches: [{ mine: false, seatsLeft: 1 }], canStart: true, freeCourts: 1 })).toEqual(['join', 'book']);
    expect(slotActions({ slotMatches: [], canStart: true, freeCourts: 1 })).toEqual(['book', 'start']);
  });

  it('is just "book" when there is nothing to choose, so the sheet is skipped', () => {
    expect(slotActions({ slotMatches: [], canStart: false, freeCourts: 2 })).toEqual(['book']);
    expect(slotActions({ slotMatches: [{ mine: false, seatsLeft: 0 }], canStart: false, freeCourts: 2 })).toEqual(['book']);
  });

  it('never offers more than Android’s three buttons', () => {
    for (const mine of [true, false]) {
      for (const canStart of [true, false]) {
        const out = slotActions({ slotMatches: [{ mine, seatsLeft: 1 }], canStart, freeCourts: 4 });
        expect(out.length).toBeLessThanOrEqual(3);
      }
    }
  });
});

describe('canStartAt (OM-43 hint)', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  it('needs the switch on and the fill deadline plus an hour of notice', () => {
    const settings = { matches_enabled: true, match_fill_deadline_minutes: 120 };
    expect(canStartAt(settings, new Date('2026-10-01T15:00:00Z'), now)).toBe(true);
    expect(canStartAt(settings, new Date('2026-10-01T14:59:00Z'), now)).toBe(false);
    expect(canStartAt({ ...settings, matches_enabled: false }, new Date('2026-10-05T15:00:00Z'), now)).toBe(false);
    expect(canStartAt(null, new Date('2026-10-05T15:00:00Z'), now)).toBe(false);
    // An older view without the deadline column: 0257's default.
    expect(canStartAt({ matches_enabled: true }, new Date('2026-10-01T15:00:00Z'), now)).toBe(true);
  });
});

describe('chips (rule 5, GD-6)', () => {
  const at = Date.parse('2026-10-02T17:00:00Z');
  const other = Date.parse('2026-10-02T18:00:00Z');
  const lanes = [
    { courtId: 'c1', cells: [{ startAt: new Date(at), state: 'booked' }, { startAt: new Date(other), state: 'free' }] },
    { courtId: 'c2', cells: [{ startAt: new Date(at), state: 'free' }, { startAt: new Date(other), state: 'free' }] },
  ];

  it('puts one chip per time, on the first lane whose cell is free', () => {
    const byStart = new Map<number, unknown[]>([[at, [{}]], [other, [{}, {}]]]);
    const keys = chipCellKeys(lanes, byStart);
    expect([...keys].sort()).toEqual([chipKey('c1', other), chipKey('c2', at)].sort());
  });

  it('puts no chip on a time with no free cell', () => {
    const none = Date.parse('2026-10-02T19:00:00Z');
    expect(chipCellKeys(lanes, new Map([[none, [{}]]])).size).toBe(0);
  });

  it('counts the free courts at a minute', () => {
    expect(freeCourtsAt(lanes, at)).toBe(1);
    expect(freeCourtsAt(lanes, other)).toBe(2);
  });

  it('keys the slot lookup by the epoch ms of each start', () => {
    const map = slotMatchesByStart(
      parseMatchSlots([
        { start_at: '2026-10-02T17:00:00Z', end_at: 'e', seats_left: 1 },
        { start_at: '2026-10-02T17:00:00.000Z', end_at: 'e', seats_left: 2 },
        { start_at: '2026-10-02T18:00:00Z', end_at: 'e', seats_left: 3 },
      ]),
    );
    expect(map.get(at)).toHaveLength(2);
    expect(map.get(other)).toHaveLength(1);
  });
});

// ── Windows and nights ──────────────────────────────────────────────────────

describe('guestWindow (R27)', () => {
  it('runs from the start of today, venue-local, for 16 days', () => {
    // 22:30 UTC on 1 Oct is 01:30 on 2 Oct in Baghdad (UTC+3).
    const w = guestWindow(new Date('2026-10-01T22:30:00Z'), 'Asia/Baghdad');
    expect(w.from).toBe('2026-10-01T21:00:00.000Z');
    expect(Date.parse(w.to) - Date.parse(w.from)).toBe(16 * 86_400_000);
  });

  it('keeps the same window all day (a stable query key)', () => {
    const a = guestWindow(new Date('2026-10-02T06:00:00Z'), 'Asia/Baghdad');
    const b = guestWindow(new Date('2026-10-02T20:00:00Z'), 'Asia/Baghdad');
    expect(a).toEqual(b);
  });

  it('gives one minute for a chip’s lookup', () => {
    expect(minuteWindow('2026-10-02T17:00:00Z')).toEqual({
      from: '2026-10-02T17:00:00.000Z',
      to: '2026-10-02T17:01:00.000Z',
    });
  });
});

describe('tradingNightOf', () => {
  const settings = {
    timezone: 'Asia/Baghdad',
    opening_hours: { fri: [['00:00', '02:00'], ['09:00', '24:00']], thu: [['00:00', '02:00'], ['09:00', '24:00']] },
  };

  it('files a 00:30 match under the night before', () => {
    // Fri 2 Oct 00:30 Baghdad = Thu 1 Oct 21:30 UTC.
    expect(tradingNightOf('2026-10-01T21:30:00Z', settings)).toBe('2026-10-01');
  });

  it('files an evening match under its own day, and 02:00 onwards under the new day', () => {
    expect(tradingNightOf('2026-10-02T17:00:00Z', settings)).toBe('2026-10-02');
    // Fri 02:00 Baghdad is outside the tail.
    expect(tradingNightOf('2026-10-01T23:00:00Z', settings)).toBe('2026-10-02');
  });

  it('uses the calendar day where there is no tail', () => {
    expect(tradingNightOf('2026-10-01T21:30:00Z', { timezone: 'Asia/Baghdad', opening_hours: {} })).toBe('2026-10-02');
  });
});

describe('matchStartIntent', () => {
  it('names the one start intent (§4.23)', () => {
    expect(matchStartIntent({ venueId: 'v', courtId: 'c', startAt: 's', durationMin: 90 })).toBe('start:v|c|s|90');
  });
});

// ── My Reservations (§4.16) ─────────────────────────────────────────────────

describe('mergeReservationLists', () => {
  const now = new Date('2026-10-01T12:00:00Z');
  const booking = (over: Partial<BookingRow>): BookingRow => ({
    id: 'b',
    court_id: 'c',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-10-03T17:00:00Z',
    end_at: '2026-10-03T18:30:00Z',
    price_iqd: 30000,
    ...over,
  });
  const match = (over: Partial<MyMatchRow>): MyMatchRow => myMatchRowFixture(over);

  const filling = match({ matchId: 'm-open', startAt: '2026-10-02T17:00:00Z', endAt: '2026-10-02T18:30:00Z' });
  const booked = match({
    matchId: 'm-booked',
    status: 'booked',
    startAt: '2026-10-02T19:00:00Z',
    endAt: '2026-10-02T20:30:00Z',
  });
  const played = match({
    matchId: 'm-played',
    status: 'played',
    startAt: '2026-09-28T17:00:00Z',
    endAt: '2026-09-28T18:30:00Z',
    mySeats: [{ ...filling.mySeats[0]!, status: 'attended', ticketStatus: 'available' }],
  });
  const bumped = match({
    matchId: 'm-bumped',
    status: 'bumped',
    endedReason: 'bumped',
    startAt: '2026-09-29T17:00:00Z',
    endAt: '2026-09-29T18:30:00Z',
    mySeats: [{ ...filling.mySeats[0]!, status: 'cancelled', ticketStatus: 'available' }],
  });
  const noShow = match({
    matchId: 'm-noshow',
    status: 'played',
    startAt: '2026-09-27T17:00:00Z',
    endAt: '2026-09-27T18:30:00Z',
    mySeats: [{ ...filling.mySeats[0]!, status: 'no_show', ticketStatus: 'forfeited' }],
  });

  const bookings = [
    booking({ id: 'b-up' }),
    booking({ id: 'b-played', status: 'completed', start_at: '2026-09-20T17:00:00Z', end_at: '2026-09-20T18:30:00Z' }),
    booking({ id: 'b-cancelled', status: 'cancelled', start_at: '2026-09-21T17:00:00Z', end_at: '2026-09-21T18:30:00Z' }),
  ];

  it('files open matches, merges upcoming by start, and splits the past', () => {
    const out = mergeReservationLists(bookings, [filling, booked, played, bumped, noShow], now, null);
    expect(out.openMatches.map((m) => m.row.matchId)).toEqual(['m-open']);
    expect(out.upcoming.map((i) => (i.kind === 'booking' ? i.row.id : i.row.matchId))).toEqual(['m-booked', 'b-up']);
    expect(out.past.map((i) => (i.kind === 'booking' ? i.row.id : i.row.matchId))).toEqual([
      'm-bumped',
      'm-played',
      'm-noshow',
      'b-cancelled',
      'b-played',
    ]);
    expect(out.played.map((i) => (i.kind === 'booking' ? i.row.id : i.row.matchId))).toEqual(['m-played', 'b-played']);
    expect(out.cancelled.map((i) => (i.kind === 'booking' ? i.row.id : i.row.matchId))).toEqual([
      'm-bumped',
      'b-cancelled',
    ]);
  });

  it('never counts a no-show as a game or a cancellation', () => {
    const out = mergeReservationLists([], [noShow], now, null);
    expect(out.played).toEqual([]);
    expect(out.cancelled).toEqual([]);
    expect(out.past).toHaveLength(1);
  });

  it('applies "Clear history" to match rows too', () => {
    const out = mergeReservationLists(bookings, [played, bumped], now, '2026-09-28T19:00:00Z');
    expect(out.past.map((i) => (i.kind === 'booking' ? i.row.id : i.row.matchId))).toEqual(['m-bumped']);
  });

  it('lists a match once when both scopes carried it', () => {
    const out = mergeReservationLists([], [filling, filling], now, null);
    expect(out.openMatches).toHaveLength(1);
  });
});
