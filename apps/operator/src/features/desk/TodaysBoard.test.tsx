import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import { TodaysBoardView, type TodaysBoardViewProps } from './TodaysBoard';
import type { ReservationRow } from './deskTypes';
import { statesById, type BillStateRow } from './payment/deskPaymentLogic';
import type { MatchReadStatus } from '../matches/matchLogic';
import type { MatchState, OpenMatch, OpenMatches } from '../matches/matchPayloads';
import type { DeskLesson, DeskLessons } from '../coaching/lessonPayloads';

function billState(over: Partial<BillStateRow> & { reservation_id: string }): BillStateRow {
  return { state: 'none', live_tab_id: null, due_iqd: 30000, court_paid_iqd: 0, court_remaining_iqd: 30000, court_refund_due_iqd: 0, ...over };
}

const courts = [
  { id: 'c1', name_en: 'Court 1', name_ar: 'ملعب 1', duration_options: [60, 90], sort_order: 1 },
  { id: 'c2', name_en: 'Court 2', name_ar: 'ملعب 2', duration_options: [60, 90], sort_order: 2 },
];

function row(over: Partial<ReservationRow> & { id: string }): ReservationRow {
  return {
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: '2026-09-03T15:00:00.000Z',
    end_at: '2026-09-03T16:00:00.000Z',
    guest_id: null,
    guest_name: 'Sara Ahmed',
    guest_phone: '07701234567',
    price_iqd: 30000,
    hold_expires_at: null,
    notes: null,
    ...over,
  };
}

function renderView(over: Partial<TodaysBoardViewProps> = {}) {
  const props: TodaysBoardViewProps = {
    status: 'ready',
    date: '2026-09-03',
    tz: 'Asia/Baghdad',
    nowIso: '2026-09-03T14:30:00.000Z',
    horizonIso: '2026-09-03T15:30:00.000Z',
    courts,
    reservations: [],
    connection: 'live',
    onRetry: vi.fn(),
    onSelectReservation: vi.fn(),
    onCreateBooking: vi.fn(),
    onBookCourt: vi.fn(),
    onSearchCustomer: vi.fn(),
    onMarkArrived: vi.fn(),
    ...over,
  };
  render(
    <LocaleProvider>
      <TodaysBoardView {...props} />
    </LocaleProvider>,
  );
  return props;
}

describe("TodaysBoardView — Today's board (option C, 2026-11-22)", () => {
  it('loading: renders the header actions and no court cards', () => {
    renderView({ status: 'loading' });
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /^Court \d · / })).toBeNull();
    expect(screen.getByRole('button', { name: 'Find customer' })).toBeTruthy();
  });

  it('error: states the failure and offers retry', async () => {
    const user = userEvent.setup();
    const props = renderView({ status: 'error', error: new Error('boom') });
    // The wrapper and the inline ErrorText are both alerts: the failure is stated, not hidden.
    expect(screen.getAllByRole('alert').length).toBeGreaterThan(0);
    expect(screen.getByText('This could not be loaded.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it('empty: teaches the next action and still offers every court as a free card that books it', async () => {
    const user = userEvent.setup();
    const props = renderView({ status: 'empty' });
    expect(screen.getByText('No bookings today')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create a booking' }));
    expect(props.onCreateBooking).toHaveBeenCalledTimes(1);
    // Availability comes from the rows on screen: none, so both courts are free until close.
    expect(screen.getAllByText('Until close')).toHaveLength(2);
    expect(screen.getAllByText('Nothing else booked')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^Court 2 · Free until close · Book this court$/ }));
    expect(props.onBookCourt).toHaveBeenCalledWith('c2');
  });

  it('court cards: every court in order, with its state, the time left, who is on and who is next', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [
        // Court 1 is free until 18:00 (Baghdad).
        row({ id: 'r1', guest_name: 'Nadia' }),
        // Court 2: Omar is on court until 18:00, then a block.
        row({ id: 'r2', court_id: 'c2', status: 'arrived', start_at: '2026-09-03T14:00:00.000Z', end_at: '2026-09-03T15:00:00.000Z', guest_name: 'Omar' }),
        row({ id: 'm1', kind: 'maintenance', court_id: 'c2', guest_name: null, notes: 'Net repair', price_iqd: null }),
      ],
    });
    const cards = screen.getAllByRole('button', { name: /^Court \d · / });
    expect(cards.map((b) => b.textContent?.match(/Court \d/)?.[0])).toEqual(['Court 1', 'Court 2']);
    const free = within(cards[0]!);
    expect(free.getByText('Free')).toBeTruthy();
    expect(free.getByText('30 min')).toBeTruthy();
    expect(free.getByText('Open until 6:00 PM')).toBeTruthy();
    expect(free.getByText('Book this court')).toBeTruthy();
    const busy = within(cards[1]!);
    expect(busy.getByText('On court')).toBeTruthy();
    expect(busy.getByText('30 min')).toBeTruthy();
    expect(busy.getByText('Left · ends 6:00 PM')).toBeTruthy();
    expect(busy.getByText('Omar')).toBeTruthy();
    expect(busy.getByText('Next 6:00 PM · Net repair')).toBeTruthy();
    expect(cards[1]!.getAttribute('aria-label')).toMatch(/^Court 2 · In use until 6:00 PM · Open$/);
    await user.click(cards[1]!);
    expect(props.onSelectReservation).toHaveBeenCalledWith('r2');
    await user.click(cards[0]!);
    expect(props.onBookCourt).toHaveBeenCalledWith('c1');
  });

  it('court cards: a booking that started with nobody marked reads Not arrived', () => {
    renderView({ nowIso: '2026-09-03T15:10:00.000Z', horizonIso: '2026-09-03T16:10:00.000Z', reservations: [row({ id: 'late' })] });
    const card = within(screen.getByRole('button', { name: /^Court 1 · / }));
    expect(card.getByText('Not arrived')).toBeTruthy();
    expect(card.getByText('50 min')).toBeTruthy();
    expect(card.getByText('Nobody after')).toBeTruthy();
  });

  it('figures: courts free, arrived, still to come, late and the court fee still to collect', () => {
    renderView({
      nowIso: '2026-09-03T15:10:00.000Z',
      horizonIso: '2026-09-03T16:10:00.000Z',
      reservations: [
        row({ id: 'late' }),
        row({ id: 'done', court_id: 'c2', start_at: '2026-09-03T13:00:00.000Z', end_at: '2026-09-03T14:00:00.000Z', status: 'arrived' }),
      ],
      billStates: statesById([billState({ reservation_id: 'late' }), billState({ reservation_id: 'done', court_remaining_iqd: 25000 })]),
    });
    const figures = within(screen.getByText('Courts free').closest('dl')!);
    const value = (label: string) => figures.getByText(label).parentElement!.querySelector('dd')!.textContent;
    expect(plain(value('Courts free'))).toBe('1 of 2');
    expect(plain(value('Arrived'))).toBe('1');
    expect(plain(value('Late'))).toBe('1');
    expect(plain(value('To collect'))).toMatch(/25,000/);
  });

  it('figures: the amount to collect prints "—" while the bill states are unknown, never a guess', () => {
    renderView({ reservations: [row({ id: 'r1' })] });
    const dl = screen.getByText('Courts free').closest('dl')!;
    expect(plain(within(dl).getByText('To collect').parentElement!.querySelector('dd')!.textContent)).toBe('—');
  });

  it('arrivals: late, then the next hour, one fact per line; guests already here are not listed', async () => {
    const user = userEvent.setup();
    const props = renderView({
      nowIso: '2026-09-03T15:10:00.000Z',
      horizonIso: '2026-09-03T16:10:00.000Z',
      reservations: [
        row({ id: 'late', guest_name: 'Late Guest' }), // 15:00–16:00, started 10 min ago
        row({ id: 'soon', court_id: 'c2', guest_name: 'Soon Guest', start_at: '2026-09-03T15:40:00.000Z', end_at: '2026-09-03T16:40:00.000Z' }),
        row({ id: 'here', court_id: 'c2', guest_name: 'Here Already', status: 'arrived', start_at: '2026-09-03T14:00:00.000Z', end_at: '2026-09-03T15:30:00.000Z' }),
      ],
    });
    const panel = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(panel.getByRole('heading', { name: 'Late · 1' })).toBeTruthy();
    expect(panel.getByText('10 min late')).toBeTruthy();
    expect(panel.getByText('Court 1 · until 7:00 PM')).toBeTruthy();
    expect(panel.getAllByText('07701234567').length).toBe(2);
    expect(panel.getByRole('heading', { name: 'Next hour · 1' })).toBeTruthy();
    expect(panel.getByText('In 30 min')).toBeTruthy();
    expect(panel.queryByText('Here Already')).toBeNull();
    // Marking arrived is one click — no reason prompt in between.
    await user.click(panel.getAllByRole('button', { name: 'Mark arrived' })[0]!);
    expect(props.onMarkArrived).toHaveBeenCalledWith('late');
    await user.click(panel.getByRole('button', { name: 'Open Soon Guest' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('soon');
  });

  it('arrivals: each group shows three, then View more reveals the rest of that group only', async () => {
    const user = userEvent.setup();
    renderView({
      nowIso: '2026-09-03T15:10:00.000Z',
      horizonIso: '2026-09-03T16:10:00.000Z',
      reservations: [
        ...[1, 2, 3, 4, 5].map((n) => row({ id: `late${n}`, court_id: n % 2 ? 'c1' : 'c2', guest_name: `Late Guest ${n}` })),
        row({ id: 'soon', court_id: 'c2', guest_name: 'Soon Guest', start_at: '2026-09-03T15:40:00.000Z', end_at: '2026-09-03T16:40:00.000Z' }),
      ],
    });
    const panel = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(panel.getAllByText(/^Late Guest \d$/)).toHaveLength(3);
    // The group below is not folded under the long one.
    expect(panel.getByText('Soon Guest')).toBeTruthy();
    await user.click(panel.getByRole('button', { name: 'View more (2)' }));
    expect(panel.getAllByText(/^Late Guest \d$/)).toHaveLength(5);
    await user.click(panel.getByRole('button', { name: 'Show less' }));
    expect(panel.getAllByText(/^Late Guest \d$/)).toHaveLength(3);
  });

  it('arrivals: with nobody due, says who is next', () => {
    renderView({
      reservations: [row({ id: 'r1', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z' })],
    });
    expect(screen.getByText('Nobody is due in the next hour.')).toBeTruthy();
    expect(screen.getByText(/^Next: .* · Sara Ahmed · Court 1$/)).toBeTruthy();
  });

  it('arrivals: a guest’s flags ride on their row', () => {
    renderView({ reservations: [row({ id: 'r1', guest_id: 'g1' })], flagsByGuest: new Map([['g1', [{ type: 'vip', label: null }]]]) });
    const panel = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(panel.getByText('VIP')).toBeTruthy();
  });

  it('to collect: games over with the fee open are listed, and the next group on that court hears about it', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [
        row({ id: 'early', start_at: '2026-09-03T13:00:00.000Z', end_at: '2026-09-03T14:00:00.000Z', guest_name: 'Early Group' }),
        row({ id: 'paidEarly', court_id: 'c2', start_at: '2026-09-03T12:00:00.000Z', end_at: '2026-09-03T13:00:00.000Z', guest_name: 'Paid Group' }),
        row({ id: 'next', start_at: '2026-09-03T15:00:00.000Z', end_at: '2026-09-03T16:00:00.000Z', guest_name: 'Next Group' }),
      ],
      billStates: statesById([
        billState({ reservation_id: 'early' }),
        billState({ reservation_id: 'paidEarly', state: 'paid', due_iqd: 0 }),
        billState({ reservation_id: 'next' }),
      ]),
    });
    const toCollect = within(screen.getByRole('heading', { name: 'To collect' }).closest('section')!);
    expect(toCollect.getByText('Early Group')).toBeTruthy();
    expect(toCollect.getByText('ended')).toBeTruthy();
    expect(toCollect.queryByText('Paid Group')).toBeNull();
    expect(toCollect.getByText(/^Not paid · /)).toBeTruthy();
    await user.click(toCollect.getByRole('button', { name: 'Take payment Early Group' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('early');
    // The group due on the same court next is told, on its own arrival row.
    const arrivals = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(arrivals.getByText('Early Group before them has not paid')).toBeTruthy();
  });

  it('to collect: says so when every finished game is paid', () => {
    renderView({ reservations: [row({ id: 'r1' })], billStates: statesById([billState({ reservation_id: 'r1' })]) });
    expect(screen.getByText('Every finished game is paid.')).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Open matches (docs/design/open-matches/operator.md §5.9)
// ---------------------------------------------------------------------------

function openMatch(over: Partial<OpenMatch> & { match_id: string }): OpenMatch {
  return {
    venue_id: 'v1',
    status: 'filling',
    start_at: '2026-09-03T18:00:00.000Z',
    end_at: '2026-09-03T19:30:00.000Z',
    duration_min: 90,
    category: 'open',
    join_policy: 'open',
    visibility: 'public',
    seats_taken: 3,
    seats_left: 1,
    requests_pending: 0,
    fill_deadline_at: '2026-09-03T16:00:00.000Z',
    organised_by: 'desk',
    organiser: { customer_id: 'g1', full_name: 'Layla Hassan', phone: null },
    price_iqd: 40000,
    shares_iqd: [10000, 10000, 10000, 10000],
    courts_free_firm: 2,
    courts_total: 3,
    ...over,
  };
}

function openRead(matches: OpenMatch[], over: Partial<OpenMatches> = {}): MatchReadStatus<OpenMatches> {
  return {
    kind: 'ready',
    data: { matches_enabled: true, fill_deadline_minutes: 120, earliest_start_minutes: 180, ticket_price_iqd: 10000, server_now: '2026-09-03T14:30:00.000Z', matches, ...over },
    stale: false,
    updatedAt: 1,
  };
}

function matchState(over: Partial<MatchState> & { reservation_id: string }): MatchState {
  return {
    match_id: 'm-booked',
    status: 'booked',
    category: 'open',
    label: 'Omar Saleh',
    organiser_customer_id: 'g9',
    seats_in: 4,
    seats_attended: 0,
    seats_no_show: 0,
    seats_unmarked: 4,
    seats_left_late: 0,
    open_seats: 0,
    ...over,
  };
}

const matchCallbacks = () => ({ onAddPlayer: vi.fn(), onOpenMatch: vi.fn(), onStartMatch: vi.fn(), onRetryOpenMatches: vi.fn() });

describe('TodaysBoardView — open matches needing players (§5.9)', () => {
  it('lists the night’s matches by start with players, requests, deadline and tags; Add player, Open and Start call back', async () => {
    const user = userEvent.setup();
    const cb = matchCallbacks();
    renderView({
      status: 'empty',
      runMatches: true,
      reachable: true,
      ...cb,
      openMatches: openRead([
        openMatch({ match_id: 'women', category: 'women', requests_pending: 1, join_policy: 'approve', visibility: 'link', courts_free_firm: 1, fill_deadline_at: '2026-09-03T14:50:00.000Z' }),
        openMatch({ match_id: 'waiting', status: 'awaiting_court', start_at: '2026-09-03T17:00:00.000Z', end_at: '2026-09-03T18:30:00.000Z', seats_taken: 4, seats_left: 0, organiser: null }),
      ]),
    });
    const group = within(screen.getByRole('list', { name: 'Open matches needing players' }));
    const rows = group.getAllByRole('listitem');
    // By start: the waiting match (20:00 in Baghdad) comes first.
    expect(within(rows[0]!).getByText('Open match')).toBeTruthy();
    expect(within(rows[0]!).getByText('Waiting for a court')).toBeTruthy();
    // Waiting for a court: no Add player, only Open.
    expect(within(rows[0]!).queryByRole('button', { name: /^Add player/ })).toBeNull();
    const women = within(rows[1]!);
    expect(women.getByText('Layla Hassan')).toBeTruthy();
    expect(women.getByText('Women')).toBeTruthy();
    expect(women.getByText('Players 3 of 4')).toBeTruthy();
    expect(women.getByText('Requests 1')).toBeTruthy();
    // Twenty minutes to the deadline by the server's clock.
    expect(women.getByText('Closes 5:50 PM')).toBeTruthy();
    expect(women.getByText('Ask to join')).toBeTruthy();
    expect(women.getByText('Link only')).toBeTruthy();
    expect(women.getByText('Last court free')).toBeTruthy();
    await user.click(women.getByRole('button', { name: /^Add player/ }));
    expect(cb.onAddPlayer).toHaveBeenCalledWith('women');
    await user.click(women.getByRole('button', { name: /^Open / }));
    expect(cb.onOpenMatch).toHaveBeenCalledWith('women');
    await user.click(screen.getByRole('button', { name: 'Start an open match' }));
    expect(cb.onStartMatch).toHaveBeenCalledTimes(1);
  });

  it('matches off with some still listed: the rows carry on, the line says so, and nothing new starts (R10)', () => {
    renderView({ status: 'empty', runMatches: true, reachable: true, ...matchCallbacks(), openMatches: openRead([openMatch({ match_id: 'm1' })], { matches_enabled: false }) });
    expect(screen.getByText('Open matches are switched off here. Matches already started carry on.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start an open match' })).toBeNull();
    // The desk can still add seats to a match that carries on.
    expect(screen.getByRole('button', { name: /^Add player/ })).toBeTruthy();
  });

  it('matches on, none tonight: says so and offers Start', () => {
    renderView({ status: 'empty', runMatches: true, reachable: true, ...matchCallbacks(), openMatches: openRead([]) });
    expect(screen.getByText('No open matches tonight')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Start an open match' })).toBeTruthy();
  });

  it('matches off and none listed: the group is hidden', () => {
    renderView({ status: 'empty', runMatches: true, ...matchCallbacks(), openMatches: openRead([], { matches_enabled: false }) });
    expect(screen.queryByText('Open matches needing players')).toBeNull();
  });

  it('a failed first read says it cannot show them, with Retry', async () => {
    const user = userEvent.setup();
    const cb = matchCallbacks();
    renderView({ status: 'empty', runMatches: true, ...cb, openMatches: { kind: 'failed', error: new Error('offline') } });
    expect(screen.getByText("Open matches can't be shown without a connection")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(cb.onRetryOpenMatches).toHaveBeenCalledTimes(1);
  });

  it('a server without matches (RPC_MISSING): no group', () => {
    renderView({ status: 'empty', runMatches: true, ...matchCallbacks(), openMatches: { kind: 'absent' } });
    expect(screen.queryByText('Open matches needing players')).toBeNull();
  });

  it('offline: Start and Add player stay on screen, disabled, with the reason (DF-11)', () => {
    renderView({ status: 'empty', runMatches: true, reachable: false, ...matchCallbacks(), openMatches: openRead([openMatch({ match_id: 'm1' })]) });
    const start = screen.getByRole('button', { name: 'Start an open match' }) as HTMLButtonElement;
    expect(start.disabled).toBe(true);
    expect(start.title).toBe('Needs a connection: open matches work online only');
    expect((screen.getByRole('button', { name: /^Add player/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('a role that cannot run matches sees the rows but neither Start nor Add player', () => {
    renderView({ status: 'empty', runMatches: false, reachable: true, ...matchCallbacks(), openMatches: openRead([openMatch({ match_id: 'm1' })]) });
    expect(screen.getByText('Layla Hassan')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Start an open match' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Add player/ })).toBeNull();
  });
});

describe('TodaysBoardView — a match booking (§5.9)', () => {
  const matchRow = row({ id: 'mr', guest_id: null, guest_name: 'Open match', guest_phone: null, start_at: '2026-09-03T15:00:00.000Z', end_at: '2026-09-03T16:30:00.000Z' });

  it('reads its organiser with the seat chip, and offers Players where others offer Mark arrived', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [matchRow, row({ id: 'walk', court_id: 'c2', guest_name: 'Nadia' })],
      matchStates: { mr: matchState({ reservation_id: 'mr', open_seats: 1 }) },
    });
    const arrivals = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(arrivals.getByText('Omar Saleh')).toBeTruthy();
    expect(arrivals.getByRole('img', { name: 'Open match · 3 of 4 players' })).toBeTruthy();
    await user.click(arrivals.getByRole('button', { name: 'Players Omar Saleh' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('mr');
    // The walk-in keeps Mark arrived; the match has none.
    expect(arrivals.getAllByRole('button', { name: 'Mark arrived' })).toHaveLength(1);
    expect(props.onMarkArrived).not.toHaveBeenCalled();
  });

  it('without a state yet, reads "Open match" in the screen’s words and offers no Mark arrived', () => {
    renderView({ reservations: [matchRow] });
    const arrivals = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(arrivals.getByText('Open match')).toBeTruthy();
    expect(arrivals.queryByRole('button', { name: 'Mark arrived' })).toBeNull();
    expect(arrivals.getByRole('button', { name: 'Players Open match' })).toBeTruthy();
  });

  it('once marking starts the chip counts who came; a played match still owing says how many players owe', () => {
    renderView({
      nowIso: '2026-09-03T17:00:00.000Z',
      horizonIso: '2026-09-03T18:00:00.000Z',
      reservations: [{ ...matchRow, status: 'arrived' }],
      matchStates: { mr: matchState({ reservation_id: 'mr', seats_attended: 3, seats_no_show: 1, seats_unmarked: 0 }) },
      billStates: statesById([billState({ reservation_id: 'mr', match_id: 'm-booked', seats_owing: 2, seats_paid: 1 })]),
    });
    const toCollect = within(screen.getByRole('heading', { name: 'To collect' }).closest('section')!);
    expect(toCollect.getByText('Omar Saleh')).toBeTruthy();
    expect(toCollect.getByText('Players owing: 2')).toBeTruthy();
    expect(screen.getAllByText('Here 3 · Missing 1').length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Lessons (docs/design/coaching/operator.md §5.8, §5.11)
// ---------------------------------------------------------------------------

/** The text without its bidi isolates (names and counts are isolated). */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');

function lesson(over: Partial<DeskLesson> & { lesson_id: string }): DeskLesson {
  return {
    reservation_id: null,
    court_id: 'c1',
    court_name_en: 'Court 1',
    court_name_ar: 'ملعب 1',
    kind: 'group',
    status: 'scheduled',
    // 20:00–21:30 in Baghdad.
    start_at: '2026-09-03T17:00:00.000Z',
    end_at: '2026-09-03T18:30:00.000Z',
    hold_expires_at: null,
    booked_by_kind: 'staff',
    coach_id: 'sara',
    coach_name_en: 'Coach Sara',
    coach_name_ar: 'المدرّبة سارة',
    lesson_type_id: 'g90',
    type_name_en: 'Group 90 min',
    type_name_ar: 'جماعية 90 دقيقة',
    course: null,
    label: null,
    party_size: null,
    places_taken: 4,
    max_places: 6,
    min_places: 5,
    // 18:00 in Baghdad: half an hour after the board's 17:30.
    cutoff_at: '2026-09-03T15:00:00.000Z',
    enrolments: 4,
    owing: 2,
    owing_iqd: 30000,
    paid_online: 0,
    awaiting: 0,
    paid_places: 2,
    ...over,
  };
}

/** A private lesson at 18:00 on Court 2 the coach booked, still unpaid (C-24), and its court row. */
const privateLesson = lesson({
  lesson_id: 'l-private',
  reservation_id: 'lr2',
  court_id: 'c2',
  court_name_en: 'Court 2',
  kind: 'private',
  start_at: '2026-09-03T15:00:00.000Z',
  end_at: '2026-09-03T16:00:00.000Z',
  booked_by_kind: 'coach',
  type_name_en: 'Private 60 min',
  label: 'Ali Hasan',
  party_size: 2,
  places_taken: 1,
  max_places: 4,
  min_places: 1,
  cutoff_at: null,
  enrolments: 1,
  owing: 1,
  owing_iqd: 35000,
});
const privateRow = row({ id: 'lr2', court_id: 'c2', kind: 'lesson', guest_name: 'Lesson', guest_phone: null, price_iqd: null, start_at: privateLesson.start_at, end_at: privateLesson.end_at });

function lessonsRead(lessons: DeskLesson[], over: Partial<DeskLessons> = {}, nowIso = '2026-09-03T14:30:00.000Z'): MatchReadStatus<DeskLessons> {
  return {
    kind: 'ready',
    data: { coaching_enabled: true, lesson_payment_mode: 'desk', server_now: nowIso, coaches: [], lesson_types: [], lessons, ...over },
    stale: false,
    updatedAt: Date.parse(nowIso),
  };
}

const lessonCallbacks = () => ({ onOpenLesson: vi.fn(), onPayLesson: vi.fn(), onNewLesson: vi.fn(), onRetryLessons: vi.fn() });

describe('TodaysBoardView — Lessons today (§5.11)', () => {
  it('lists the night’s lessons by start with time, court, kind, what, places, pay and tags; Take payment, Open and New lesson call back', async () => {
    const user = userEvent.setup();
    const cb = lessonCallbacks();
    renderView({
      status: 'empty',
      runLessons: true,
      takeLessonPayment: true,
      reachable: true,
      ...cb,
      lessons: lessonsRead([lesson({ lesson_id: 'l-group' }), privateLesson]),
    });
    const items = within(screen.getByRole('list', { name: 'Lessons today' })).getAllByRole('listitem');
    // By start: the private lesson at 18:00 first.
    const first = within(items[0]!);
    expect(plain(items[0]!.textContent)).toMatch(/· Court 2/);
    expect(first.getByText('Private lesson')).toBeTruthy();
    expect(plain(first.getByText(/Private 60 min/).textContent)).toBe('Private 60 min · Coach Sara · Ali Hasan');
    expect(plain(items[0]!.textContent)).toContain('+1');
    expect(first.getByText('Starts in 30 min')).toBeTruthy();
    expect(first.getByText('Booked by the coach · unpaid')).toBeTruthy();
    const group = within(items[1]!);
    expect(group.getByText('Group session')).toBeTruthy();
    expect(plain(group.getByText(/Group 90 min/).textContent)).toBe('Group 90 min · Coach Sara');
    expect(group.getByText('Places 4 of 6')).toBeTruthy();
    expect(group.getByText('To pay 2')).toBeTruthy();
    expect(group.getByText('Needs 1 more by 6:00 PM')).toBeTruthy();
    await user.click(group.getByRole('button', { name: /^Take payment / }));
    expect(cb.onPayLesson).toHaveBeenCalledWith('l-group');
    await user.click(group.getByRole('button', { name: /^Open / }));
    expect(cb.onOpenLesson).toHaveBeenCalledWith('l-group');
    await user.click(screen.getByRole('button', { name: 'New lesson' }));
    expect(cb.onNewLesson).toHaveBeenCalledTimes(1);
  });

  it('shows three lessons, then View more reveals the rest', async () => {
    const user = userEvent.setup();
    renderView({
      status: 'empty',
      runLessons: true,
      ...lessonCallbacks(),
      lessons: lessonsRead(['a', 'b', 'c', 'd'].map((id) => lesson({ lesson_id: `l-${id}`, reservation_id: `lr-${id}` }))),
    });
    const list = () => within(screen.getByRole('list', { name: 'Lessons today' })).getAllByRole('listitem');
    expect(list()).toHaveLength(3);
    await user.click(screen.getByRole('button', { name: 'View more (1)' }));
    expect(list()).toHaveLength(4);
  });

  it('a role without takeLessonPayment sees no Take payment', () => {
    renderView({ status: 'empty', runLessons: true, takeLessonPayment: false, ...lessonCallbacks(), lessons: lessonsRead([lesson({ lesson_id: 'l-group' })]) });
    expect(screen.queryByRole('button', { name: /^Take payment/ })).toBeNull();
    expect(screen.getByRole('button', { name: /^Open / })).toBeTruthy();
  });

  it('coaching off with lessons listed: the rows carry on, the line says so, and New lesson stays (the desk stages, R51)', () => {
    renderView({ status: 'empty', runLessons: true, reachable: true, ...lessonCallbacks(), lessons: lessonsRead([lesson({ lesson_id: 'l-group' })], { coaching_enabled: false }) });
    expect(screen.getByText('Lessons are switched off here. Lessons already booked carry on.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New lesson' })).toBeTruthy();
  });

  it('coaching off and none listed: the group is hidden', () => {
    renderView({ status: 'empty', runLessons: true, ...lessonCallbacks(), lessons: lessonsRead([], { coaching_enabled: false }) });
    expect(screen.queryByText('Lessons today')).toBeNull();
  });

  it('coaching on, none today: says so and offers New lesson', () => {
    renderView({ status: 'empty', runLessons: true, reachable: true, ...lessonCallbacks(), lessons: lessonsRead([]) });
    expect(screen.getByText('No lessons today')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New lesson' })).toBeTruthy();
  });

  it('a failed first read says it cannot show them, with Retry', async () => {
    const user = userEvent.setup();
    const cb = lessonCallbacks();
    renderView({ status: 'empty', runLessons: true, ...cb, lessons: { kind: 'failed', error: new Error('offline') } });
    expect(screen.getByText("Lessons can't be shown without a connection")).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(cb.onRetryLessons).toHaveBeenCalledTimes(1);
  });

  it('a server without coaching (RPC_MISSING): no group', () => {
    renderView({ status: 'empty', runLessons: true, ...lessonCallbacks(), lessons: { kind: 'absent' } });
    expect(screen.queryByText('Lessons today')).toBeNull();
  });

  it('offline: New lesson stays on screen, disabled, with the reason (CD-6)', () => {
    renderView({ status: 'empty', runLessons: true, reachable: false, ...lessonCallbacks(), lessons: lessonsRead([]) });
    const button = screen.getByRole('button', { name: 'New lesson' }) as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    expect(button.title).toBe('Needs a connection: lessons work online only');
  });

  it('a role that cannot run lessons sees the rows but no New lesson', () => {
    renderView({ status: 'empty', runLessons: false, ...lessonCallbacks(), lessons: lessonsRead([lesson({ lesson_id: 'l-group' })]) });
    expect(screen.getByText('Places 4 of 6')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'New lesson' })).toBeNull();
  });
});

describe('TodaysBoardView — a lesson’s court (§5.8, §5.11)', () => {
  it('a court a lesson holds shows a Lesson card with the lesson’s name that opens it; the lesson is never an arrival', async () => {
    const user = userEvent.setup();
    const now = '2026-09-03T15:10:00.000Z';
    const props = renderView({
      nowIso: now,
      horizonIso: '2026-09-03T16:10:00.000Z',
      reservations: [privateRow, row({ id: 'walk', guest_name: 'Nadia' })],
      lessons: lessonsRead([privateLesson], {}, now),
      ...lessonCallbacks(),
    });
    const tile = screen.getByRole('button', { name: /^Court 2 · Lesson until 7:00 PM · Open$/ });
    expect(within(tile).getByText('Lesson')).toBeTruthy();
    expect(plain(tile.textContent)).toContain('Coach Sara · Ali Hasan');
    await user.click(tile);
    expect(props.onSelectReservation).toHaveBeenCalledWith('lr2');
    // Only the walk-in is on the rail.
    const arrivals = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(arrivals.getAllByRole('button', { name: 'Mark arrived' })).toHaveLength(1);
    expect(arrivals.queryByText(/Coach Sara/)).toBeNull();
    // The subtitle counts the lesson apart from the bookings.
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && plain(el.textContent) === 'Lessons 1')).toBeTruthy();
  });

  it('without its desk_lessons row its card still reads "Lesson"', () => {
    renderView({ nowIso: '2026-09-03T15:10:00.000Z', horizonIso: '2026-09-03T16:10:00.000Z', reservations: [privateRow] });
    const tile = screen.getByRole('button', { name: /^Court 2 · Lesson until/ });
    expect(within(tile).getAllByText('Lesson').length).toBe(2);
    expect(screen.queryByRole('button', { name: 'Mark arrived' })).toBeNull();
  });
});
