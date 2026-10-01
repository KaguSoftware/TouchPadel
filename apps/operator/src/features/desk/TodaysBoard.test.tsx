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
    live: true,
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

describe("TodaysBoardView — Today's board (spec 06.1)", () => {
  it('loading: renders the header actions and no bookings table', () => {
    renderView({ status: 'loading' });
    expect(screen.getByRole('heading', { name: 'Today' })).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
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

  it('empty: teaches the next action and still offers every court as a free tile that books it', async () => {
    const user = userEvent.setup();
    const props = renderView({ status: 'empty' });
    expect(screen.getByText('No bookings today')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Create a booking' }));
    expect(props.onCreateBooking).toHaveBeenCalledTimes(1);
    // Availability comes from the rows on screen: none, so both courts are free all night.
    expect(screen.getAllByText('Free until close')).toHaveLength(2);
    await user.click(screen.getByRole('button', { name: /^Court 2 · Free until close · Book this court$/ }));
    expect(props.onBookCourt).toHaveBeenCalledWith('c2');
  });

  it('arrivals: splits late guests from those due within the hour, and leaves out guests already here', async () => {
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
    const arrivals = screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!;
    const panel = within(arrivals);
    expect(panel.getByText('Started, not marked arrived')).toBeTruthy();
    expect(panel.getByText('Started 10 min ago')).toBeTruthy();
    expect(panel.getByText('Due in the next hour')).toBeTruthy();
    expect(panel.getByText('In 30 min')).toBeTruthy();
    expect(panel.queryByText('Here Already')).toBeNull();
    // Marking arrived is one click — no reason prompt in between.
    await user.click(panel.getAllByRole('button', { name: 'Mark arrived' })[0]!);
    expect(props.onMarkArrived).toHaveBeenCalledWith('late');
    // Header counts: three bookings, one here, one still to start.
    expect(screen.getByText('Still to come').textContent).toContain('Still to come');
  });

  it('arrivals: with nobody due, says who is next', () => {
    renderView({
      reservations: [row({ id: 'r1', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z' })],
    });
    expect(screen.getByText('Nobody is due in the next hour.')).toBeTruthy();
    expect(screen.getByText(/^Next: .* · Sara Ahmed · Court 1$/)).toBeTruthy();
  });

  it('ready: lists every booking with court, status, court fee and flags; rows and tiles open bookings', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [
        row({ id: 'r1', guest_id: 'g1' }),
        row({ id: 'r2', court_id: 'c2', status: 'arrived', start_at: '2026-09-03T14:00:00.000Z', end_at: '2026-09-03T15:00:00.000Z', guest_name: 'Omar' }),
        row({ id: 'r3', start_at: '2026-09-03T19:00:00.000Z', end_at: '2026-09-03T20:00:00.000Z', guest_name: 'Nadia' }),
        row({ id: 'm1', kind: 'maintenance', court_id: 'c2', start_at: '2026-09-03T18:00:00.000Z', end_at: '2026-09-03T19:00:00.000Z', guest_name: null, notes: 'Net repair', price_iqd: null }),
      ],
      billStates: statesById([
        billState({ reservation_id: 'r1', state: 'paid', due_iqd: 0, court_paid_iqd: 30000, court_remaining_iqd: 0 }),
        billState({ reservation_id: 'r2' }),
        billState({ reservation_id: 'r3' }),
      ]),
      flagsByGuest: new Map([['g1', [{ type: 'vip', label: null }]]]),
    });
    const table = screen.getByRole('table', { name: 'All bookings today' });
    expect(table.querySelectorAll('tbody tr')).toHaveLength(4);
    // Newest to oldest: Nadia (19:00) heads the list.
    expect(within(table.querySelectorAll('tbody tr')[0] as HTMLElement).getByText('Nadia')).toBeTruthy();
    const t = within(table);
    expect(t.getByText('VIP')).toBeTruthy();
    // Court fee, from the server: paid → Paid; not paid while the game is on or
    // still to come → a quiet fact, not a warning.
    expect(t.getByText('Paid')).toBeTruthy();
    expect(t.getAllByText('Not paid yet').length).toBe(2);
    expect(t.getByText('Net repair')).toBeTruthy();
    // Court 2 is in use right now (Omar, 14:00–15:00): its tile says so, and opens his booking.
    const omarTile = screen.getByRole('button', { name: /^Court 2 · In use until .* · Open$/ });
    await user.click(omarTile);
    expect(props.onSelectReservation).toHaveBeenCalledWith('r2');
    expect(screen.getByRole('button', { name: /^Court 1 · Free until .* · Book this court$/ })).toBeTruthy();
    await user.click(t.getByRole('button', { name: 'Open Nadia' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('r3');
  });

  it('played, not paid: games that are over with the fee open are listed to settle, and the next group hears about it', async () => {
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
    const toSettle = within(screen.getByRole('heading', { name: 'Played, not paid' }).closest('section')!);
    expect(toSettle.getByText('Early Group')).toBeTruthy();
    expect(toSettle.queryByText('Paid Group')).toBeNull();
    expect(toSettle.getByText(/^Not paid · /)).toBeTruthy();
    await user.click(toSettle.getByRole('button', { name: 'Take payment Early Group' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('early');
    // The group due on the same court next is told, on its own arrival row.
    const soon = within(screen.getByRole('heading', { name: 'Due in the next hour' }).closest('section')!);
    expect(soon.getByText('The group before on this court has not paid: Early Group')).toBeTruthy();
  });

  it('court fee prints "—" while the tabs are unknown, never a guess', () => {
    renderView({ reservations: [row({ id: 'r1' })] });
    const table = screen.getByRole('table', { name: 'All bookings today' });
    expect(within(table).getByText('—')).toBeTruthy();
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
    const table = within(screen.getByRole('table', { name: 'All bookings today' }));
    expect(table.getByText('Omar Saleh')).toBeTruthy();
    expect(table.getByRole('img', { name: 'Open match · 3 of 4 players' })).toBeTruthy();
    await user.click(table.getByRole('button', { name: 'Players Omar Saleh' }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('mr');
    // The walk-in keeps Mark arrived; the match has none.
    expect(table.getAllByRole('button', { name: 'Mark arrived' })).toHaveLength(1);
    const arrivals = within(screen.getByRole('heading', { name: 'Arrivals' }).closest('section')!);
    expect(arrivals.getByRole('button', { name: 'Players Omar Saleh' })).toBeTruthy();
    expect(props.onMarkArrived).not.toHaveBeenCalled();
  });

  it('without a state yet, reads "Open match" in the screen’s words and offers no Mark arrived', () => {
    renderView({ reservations: [matchRow] });
    const table = within(screen.getByRole('table', { name: 'All bookings today' }));
    expect(table.getByText('Open match')).toBeTruthy();
    expect(table.queryByRole('button', { name: 'Mark arrived' })).toBeNull();
    expect(table.getByRole('button', { name: 'Players Open match' })).toBeTruthy();
  });

  it('once marking starts the chip counts who came; a played match still owing says how many players owe', () => {
    renderView({
      nowIso: '2026-09-03T17:00:00.000Z',
      horizonIso: '2026-09-03T18:00:00.000Z',
      reservations: [{ ...matchRow, status: 'arrived' }],
      matchStates: { mr: matchState({ reservation_id: 'mr', seats_attended: 3, seats_no_show: 1, seats_unmarked: 0 }) },
      billStates: statesById([billState({ reservation_id: 'mr', match_id: 'm-booked', seats_owing: 2, seats_paid: 1 })]),
    });
    const toSettle = within(screen.getByRole('heading', { name: 'Played, not paid' }).closest('section')!);
    expect(toSettle.getByText('Omar Saleh')).toBeTruthy();
    expect(toSettle.getByText('Players owing: 2')).toBeTruthy();
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

describe('TodaysBoardView — a lesson’s court row (§5.8, §5.11)', () => {
  it('reads the lesson’s name, its pay, and offers Open lesson where a booking offers Mark arrived', async () => {
    const user = userEvent.setup();
    const props = renderView({
      reservations: [privateRow, row({ id: 'walk', guest_name: 'Nadia' })],
      lessons: lessonsRead([privateLesson]),
      ...lessonCallbacks(),
    });
    const table = within(screen.getByRole('table', { name: 'All bookings today' }));
    const lessonTr = table.getAllByRole('row').find((r) => plain(r.textContent).includes('Coach Sara · Ali Hasan'))!;
    const tr = within(lessonTr);
    expect(tr.getByText('Private lesson')).toBeTruthy();
    expect(tr.getByText('To pay 1')).toBeTruthy();
    expect(tr.queryByRole('button', { name: 'Mark arrived' })).toBeNull();
    await user.click(tr.getByRole('button', { name: /^Open lesson / }));
    expect(props.onSelectReservation).toHaveBeenCalledWith('lr2');
    // The walk-in keeps Mark arrived.
    expect(table.getAllByRole('button', { name: 'Mark arrived' })).toHaveLength(1);
    // The subtitle counts the lesson apart from the bookings.
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && plain(el.textContent) === 'Lessons 1')).toBeTruthy();
  });

  it('without its desk_lessons row it still reads "Lesson" and never offers Mark arrived', () => {
    renderView({ reservations: [privateRow] });
    const table = within(screen.getByRole('table', { name: 'All bookings today' }));
    expect(table.getAllByText('Lesson').length).toBeGreaterThan(0);
    expect(table.queryByRole('button', { name: 'Mark arrived' })).toBeNull();
    expect(table.getByRole('button', { name: 'Open lesson Lesson' })).toBeTruthy();
  });

  it('a court a lesson holds says "Lesson until" with the lesson’s name', () => {
    const now = '2026-09-03T15:10:00.000Z';
    renderView({ nowIso: now, horizonIso: '2026-09-03T16:10:00.000Z', reservations: [privateRow], lessons: lessonsRead([privateLesson], {}, now), ...lessonCallbacks() });
    const tile = screen.getByRole('button', { name: /^Court 2 · Lesson until 7:00 PM · Open$/ });
    expect(plain(tile.textContent)).toContain('Lesson until 7:00 PM · Coach Sara · Ali Hasan');
  });
});
