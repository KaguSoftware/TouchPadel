import { describe, expect, it } from 'vitest';
import {
  readGuestTickets,
  readMatchDetail,
  readMatchReports,
  readMatchSettings,
  readMatchStates,
  readOpenMatches,
} from './matchPayloads';

// Parsers are defensive (operator.md §5.6): a missing key is null ("—"),
// never a made-up zero; a `can` flag is true only when the server said true.

describe('readOpenMatches (§5.6.1)', () => {
  it('reads the envelope and its rows', () => {
    const out = readOpenMatches({
      matches_enabled: true,
      fill_deadline_minutes: 120,
      earliest_start_minutes: 180,
      ticket_price_iqd: 10000,
      server_now: '2026-10-01T15:00:00Z',
      matches: [
        {
          match_id: 'm1',
          venue_id: 'v1',
          status: 'filling',
          start_at: '2026-10-01T18:00:00Z',
          end_at: '2026-10-01T19:30:00Z',
          duration_min: 90,
          category: 'women',
          join_policy: 'approve',
          visibility: 'link',
          seats_taken: 3,
          seats_left: 1,
          requests_pending: 2,
          fill_deadline_at: '2026-10-01T16:00:00Z',
          organised_by: 'guest',
          organiser: { customer_id: 'g1', full_name: 'Sara Karim', phone: '+9647700000000' },
          price_iqd: 40000,
          shares_iqd: [10000, 10000, 10000, 10000],
          courts_free_firm: 1,
          courts_total: 3,
        },
        { match_id: 'broken' },
      ],
    });
    expect(out.matches_enabled).toBe(true);
    expect(out.earliest_start_minutes).toBe(180);
    expect(out.matches).toHaveLength(1);
    expect(out.matches[0]).toMatchObject({ category: 'women', seats_taken: 3, organiser: { full_name: 'Sara Karim' }, courts_free_firm: 1 });
  });

  it('survives a missing or wrong-shaped payload', () => {
    expect(readOpenMatches(null)).toEqual({
      matches_enabled: false,
      fill_deadline_minutes: null,
      earliest_start_minutes: null,
      ticket_price_iqd: null,
      server_now: null,
      matches: [],
    });
    expect(readOpenMatches({ matches_enabled: 'yes', matches: 'x' }).matches_enabled).toBe(false);
    const row = readOpenMatches({ matches: [{ match_id: 'm', start_at: 'a', end_at: 'b' }] }).matches[0]!;
    expect(row.seats_taken).toBeNull();
    expect(row.price_iqd).toBeNull();
    expect(row.shares_iqd).toEqual([]);
    expect(row.organiser).toBeNull();
  });
});

describe('readMatchStates (§5.6.2)', () => {
  it('keys by reservation id and drops a row without a match', () => {
    const out = readMatchStates({
      r1: { match_id: 'm1', status: 'booked', category: 'open', label: null, seats_in: 4, open_seats: 0, seats_attended: '2' },
      r2: { status: 'booked' },
      r3: 'nonsense',
    });
    expect(Object.keys(out)).toEqual(['r1']);
    expect(out.r1).toMatchObject({ reservation_id: 'r1', match_id: 'm1', label: null, seats_in: 4, open_seats: 0, seats_attended: 2 });
    expect(out.r1!.seats_no_show).toBeNull();
    expect(readMatchStates([])).toEqual({});
    expect(readMatchStates(null)).toEqual({});
  });
});

describe('readMatchDetail (§5.6.3)', () => {
  const raw = {
    match: {
      id: 'm1',
      status: 'booked',
      start_at: '2026-10-01T18:00:00Z',
      end_at: '2026-10-01T19:30:00Z',
      category: 'men',
      shares_iqd: [10000, 10000, 10000, 10000],
      organiser: { customer_id: 'g1', full_name: 'Ali', phone: null, flags: [{ type: 'vip', label: null }, { label: 'no type' }] },
      sandbox: false,
      started: true,
      marks_open: true,
      server_now: '2026-10-01T18:10:00Z',
      can: { add_seat: true, cancel: 'true', call_off: false },
    },
    seats: [
      {
        seat_id: 's1',
        seat_no: 1,
        kind: 'account',
        status: 'attended',
        carrying: true,
        full_name: 'Ali',
        ticket: { ticket_id: 't1', status: 'available' },
        money: { share_iqd: 10000, owed_iqd: 10000, take_iqd: 10000, write_off: null },
        can: { mark_attended: false, mark_no_show: true, unmark: true, remove_reasons: ['customer_request', 7], take_share: true },
      },
      { seat_no: 2 },
    ],
    requests: [{ request_id: 'q1', full_name: 'Omar', seats_requested: 2, friend_genders: ['male', 3] }],
    money: {
      phase: 'started',
      unassigned_iqd: 5000,
      vacant: [{ seat_no: 4, open_iqd: 0, written_off_iqd: 10000 }],
      unassigned: [{ payment_id: 'p1', tab_live: true, amount_iqd: 5000, unassigned_iqd: 5000 }, { tab_live: true }],
    },
    events: [{ at: '2026-10-01T18:05:00Z', type: 'seat_attended', actor: 'staff-1', actor_name: 'Desk', seat_no: 1, code: null }, { at: 'x' }],
  };

  it('reads the match, its seats, requests, money and history', () => {
    const d = readMatchDetail(raw)!;
    expect(d.match).toMatchObject({ id: 'm1', category: 'men', started: true, marks_open: true });
    // A `can` flag is only true when the server said true.
    expect(d.match.can).toEqual({ add_seat: true, cancel: false, call_off: false });
    expect(d.match.organiser?.flags).toEqual([{ type: 'vip', label: null }]);
    expect(d.seats).toHaveLength(1);
    expect(d.seats[0]!.can).toEqual({
      mark_attended: false,
      mark_no_show: true,
      unmark: true,
      remove_reasons: ['customer_request'],
      take_share: true,
      write_off: false,
      replace: false,
    });
    expect(d.seats[0]!.money).toMatchObject({ take_iqd: 10000, paid_desk_iqd: null, write_off: null });
    expect(d.requests[0]).toMatchObject({ request_id: 'q1', seats_requested: 2, friend_genders: ['male'], games_played: null });
    expect(d.money?.vacant).toEqual([{ seat_no: 4, open_iqd: 0, written_off_iqd: 10000 }]);
    expect(d.money?.unassigned).toEqual([
      { payment_id: 'p1', tab_id: null, tab_live: true, method: null, amount_iqd: 5000, unassigned_iqd: 5000, created_at: null },
    ]);
    expect(d.events).toHaveLength(1);
  });

  it('is null without a readable match, and money is null while filling', () => {
    expect(readMatchDetail({ seats: [] })).toBeNull();
    expect(readMatchDetail({ match: { id: 'm1' } })).toBeNull();
    expect(readMatchDetail(null)).toBeNull();
    expect(readMatchDetail({ ...raw, money: null })!.money).toBeNull();
    expect(readMatchDetail({ ...raw, seats: undefined })!.seats).toEqual([]);
  });
});

describe('readGuestTickets (§5.6.4, money.md §5.7)', () => {
  it('reads the counts, tickets, purchases with their cash-out and the pending attempt', () => {
    const out = readGuestTickets({
      customer_id: 'g1',
      price_iqd: 10000,
      available: 2,
      reserved: 0,
      in_use: 1,
      forfeited: 1,
      cashed_out: 0,
      tickets: [{ id: 't1', status: 'in_use', match: { match_id: 'm1', start_at: 'x', venue_id: 'v1' } }, { status: 'x' }],
      purchases: [
        {
          payment_id: 'p1',
          status: 'succeeded',
          ticket_count: 3,
          amount_iqd: 30000,
          sandbox: true,
          cashout: { allowed: false, reason: 'in_use', tickets: 2, amount_iqd: 20000, until_at: '2026-10-01T19:30:00Z' },
        },
      ],
      pending: { request_id: 'q', status: 'created', ticket_count: 1, amount_iqd: 10000 },
      server_now: 'now',
    });
    expect(out).toMatchObject({ available: 2, forfeited: 1, cashed_out: 0 });
    expect(out.tickets).toHaveLength(1);
    expect(out.tickets[0]!.match?.match_id).toBe('m1');
    expect(out.purchases[0]!.cashout).toEqual({ allowed: false, reason: 'in_use', tickets: 2, amount_iqd: 20000, until_at: '2026-10-01T19:30:00Z' });
    expect(out.purchases[0]!.sandbox).toBe(true);
    expect(out.pending?.ticket_count).toBe(1);
    expect(readGuestTickets({}).pending).toBeNull();
  });
});

describe('readMatchSettings and readMatchReports (§5.6.4)', () => {
  it('reads the settings, off by default', () => {
    expect(readMatchSettings({ matches_enabled: true, match_fill_deadline_minutes: 120, match_ticket_price_iqd: 10000 })).toMatchObject({
      matches_enabled: true,
      match_fill_deadline_minutes: 120,
      max_filling_matches_per_guest: null,
    });
    expect(readMatchSettings(null).matches_enabled).toBe(false);
  });

  it('reads each report, oldest first as sent', () => {
    const out = readMatchReports([
      {
        report_id: 'r1',
        reason: 'harassment',
        created_at: 'a',
        match: { id: 'm1', start_at: 'b', category: 'open', status: 'played', reservation_id: 'x' },
        reported: { customer_id: 'g2', full_name: 'Omar', phone: null, flags: [], banned: true, reports_90d: 2, no_shows: 1 },
        reporter: { customer_id: 'g1', full_name: 'Sara' },
      },
      { reason: 'other' },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]!.reported).toMatchObject({ banned: true, reports_90d: 2 });
    expect(readMatchReports({})).toEqual([]);
  });
});
