import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { wallTimeToUtc } from '@touch/core';
import { LocaleProvider } from '../../lib/i18n';
import { mutate } from '../../lib/mutate';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { CreateReservationDialog, toastBumpedMatches } from './CreateReservationDialog';
import { ReservationActionsDialog } from './ReservationActionsDialog';
import type { ReservationRow } from './deskTypes';
import type { MatchState, OpenMatch, OpenMatches } from '../matches/matchPayloads';

// The two desk dialogs over a real query client. The writes are mocked at
// mutate(), the price quote at appRpc('price_slot'), and the router and toast
// at their hooks — neither dialog renders a route of its own.

let priceRows: { rule_id: string; price_iqd: number }[] = [{ rule_id: 'r', price_iqd: 70000 }];
/** The station's reach (lib/stationReach): every open-match write is online only. */
let reachable = true;

vi.mock('../../lib/mutate', () => ({
  mutate: vi.fn(async () => ({ queued: false, localId: '', idempotencyKey: '', result: null })),
  isElectron: () => false,
}));
vi.mock('../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    code = 'UNKNOWN';
  },
  appRpc: vi.fn(async (fn: string) => (fn === 'price_slot' ? priceRows : [])),
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
const { navigateSpy } = vi.hoisted(() => ({ navigateSpy: vi.fn() }));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role: 'court_desk' } }) };
});
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  Link: ({ children }: { children: React.ReactNode }) => <a>{children}</a>,
}));

const TZ = 'Asia/Baghdad';
const DATE = '2099-09-03';
/** A night that has already been and gone — for the rules that read the clock. */
const PAST_DATE = '2020-09-03';
const courts = [
  { id: 'c1', name_en: 'Court 1', name_ar: 'ملعب 1', duration_options: [60, 90], sort_order: 1 },
  { id: 'c2', name_en: 'Court 2', name_ar: 'ملعب 2', duration_options: [60, 90], sort_order: 2 },
];
const at = (min: number) => wallTimeToUtc(DATE, min, TZ);

function booking(over: Partial<ReservationRow> & { id: string }): ReservationRow {
  return {
    court_id: 'c1',
    kind: 'booking',
    status: 'confirmed',
    start_at: at(20 * 60).toISOString(),
    end_at: at(21 * 60).toISOString(),
    guest_id: null,
    guest_name: 'Sara Ahmed',
    guest_phone: null,
    price_iqd: 50000,
    hold_expires_at: null,
    notes: null,
    ...over,
  };
}

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>{ui}</LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.mocked(mutate).mockClear();
  vi.mocked(appRpc).mockClear();
  priceRows = [{ rule_id: 'r', price_iqd: 70000 }];
  reachable = true;
});

describe('CreateReservationDialog', () => {
  const night = { date: DATE, rows: [19 * 60, 19 * 60 + 30, 20 * 60, 20 * 60 + 30, 21 * 60], reservations: [booking({ id: 'held' })] };

  it('shows the price the server will charge for the chosen court, start and length', async () => {
    wrap(<CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText(/70,000/)).toBeTruthy();
    expect(appRpc).toHaveBeenCalledWith('price_slot', { p_court_id: 'c2', p_start_at: at(20 * 60).toISOString(), p_duration_min: 60 });
  });

  it('marks start times the court is already booked for, and will not book one', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    wrap(<CreateReservationDialog courtId="c1" startAt={at(19 * 60)} courts={courts} tz={TZ} night={night} onClose={vi.fn()} onCreated={onCreated} />);
    // The pickers are our own listboxes now: a row's state is on the option
    // element in the open panel, not on a native <option>.
    const openStart = async () => {
      await user.click(screen.getByRole('combobox', { name: 'Start' }));
      return screen.getByRole('listbox');
    };
    const takenLabels = within(await openStart())
      .getAllByRole('option')
      .filter((o) => o.hasAttribute('disabled'))
      .map((o) => o.textContent);
    // 19:30, 20:00 and 20:30 (+60 min) all overlap the 20:00–21:00 booking;
    // 19:00 + 60 does not. Asserted by the times shown, so this still fails if
    // the WRONG three rows are the disabled ones.
    expect(takenLabels).toEqual(['7:30 PM · taken', '8:00 PM · taken', '8:30 PM · taken']);
    await user.keyboard('{Escape}');
    // Moving to a free court clears it.
    await user.click(screen.getByRole('combobox', { name: 'Court' }));
    // Scoped to the open panel: the Start picker is a listbox on this dialog too.
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Court 2' }));
    expect(within(await openStart()).getAllByRole('option').some((o) => o.hasAttribute('disabled'))).toBe(false);
    await user.keyboard('{Escape}');
    await user.type(screen.getByLabelText(/Guest name/), 'Walk In');
    await user.click(screen.getByRole('button', { name: 'Create booking' }));
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith('reservation.create', expect.objectContaining({ courtId: 'c2', kind: 'booking', guestName: 'Walk In', startAt: at(19 * 60).toISOString() }));
  });

  it('refuses to book a length no rate prices, and says why', async () => {
    priceRows = [];
    wrap(<CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(await screen.findByText('No price is set for this court at this time and length.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Create booking' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('starts linked to a customer when booking for one', () => {
    wrap(
      <CreateReservationDialog
        courtId="c2"
        startAt={at(20 * 60)}
        courts={courts}
        tz={TZ}
        customer={{ id: 'g1', name: 'Layla Hassan', phone: '07701234567', flags: [] }}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByText('Linked to Layla Hassan')).toBeTruthy();
    expect((screen.getByLabelText(/Guest name/) as HTMLInputElement).value).toBe('Layla Hassan');
  });
});

describe('ReservationActionsDialog', () => {
  const rows = [19 * 60, 20 * 60, 21 * 60];

  it('marks a guest arrived in one click, with no reason attached', async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    wrap(<ReservationActionsDialog reservation={booking({ id: 'r1' })} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={vi.fn()} onChanged={onChanged} />);
    await user.click(screen.getByRole('button', { name: 'Mark arrived' }));
    expect(onChanged).toHaveBeenCalled();
    expect(mutate).toHaveBeenCalledWith('reservation.update', { action: 'mark', reservationId: 'r1', status: 'arrived' });
  });

  it('marks a no-show in one click, with no reason attached', async () => {
    // A no-show is only offered once the slot has started (allowedMarks mirrors
    // the server's SEC-11 guard), so this booking sits in the past -- unlike
    // every other case in this file, which uses the 2099 fixture date.
    const started = booking({
      id: 'r1',
      start_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      end_at: new Date(Date.now() - 3_600_000).toISOString(),
    });
    const user = userEvent.setup();
    wrap(<ReservationActionsDialog reservation={started} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={vi.fn()} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Mark no-show' }));
    // No `reason` key at all: the dialog's Select is pre-filled, and sending it
    // stamped every calendar no-show as "Customer request".
    expect(mutate).toHaveBeenCalledWith('reservation.update', { action: 'mark', reservationId: 'r1', status: 'no_show' });
  });

  it('takes the desk to the booking screen to take payment (0106)', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(<ReservationActionsDialog reservation={booking({ id: 'r1', status: 'completed' })} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={onClose} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('button', { name: 'Take payment' }));
    expect(onClose).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/bookings/$id', params: { id: 'r1' } });
  });

  /*
   * 2026-09-23: a booking moved to a start that has already passed stays
   * 'confirmed' on the desk and leaves the guest's app entirely — not in
   * Upcoming, not in Played, not in Cancelled. The server refuses it since
   * 0150; this is the desk not asking for it.
   */
  it('will not offer a start time that has already passed', async () => {
    const user = userEvent.setup();
    const pastAt = (min: number) => wallTimeToUtc(PAST_DATE, min, TZ);
    wrap(
      <ReservationActionsDialog
        reservation={booking({ id: 'r1', start_at: pastAt(20 * 60).toISOString(), end_at: pastAt(21 * 60).toISOString() })}
        courts={courts}
        date={PAST_DATE}
        tz={TZ}
        rows={rows}
        onClose={vi.fn()}
        onChanged={vi.fn()}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Move' }));
    await user.click(screen.getByRole('combobox', { name: 'New start time' }));
    const options = within(screen.getByRole('listbox')).getAllByRole('option') as HTMLButtonElement[];
    // [0] is "same time"; then the three rows: 19:00, 20:00 (its own start), 21:00.
    expect([options[1]?.disabled, options[2]?.disabled, options[3]?.disabled]).toEqual([true, false, true]);
    expect(options[1]?.textContent).toMatch(/past/);
  });

  it('carries the chosen reason on an override (SOW L313)', async () => {
    const user = userEvent.setup();
    wrap(<ReservationActionsDialog reservation={booking({ id: 'r1', end_at: at(21 * 60 + 30).toISOString() })} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={vi.fn()} onChanged={vi.fn()} />);
    await user.click(screen.getByRole('combobox', { name: 'Reason for this change' }));
    await user.click(within(screen.getByRole('listbox')).getByRole('option', { name: 'Weather' }));
    await user.click(screen.getByRole('button', { name: 'Shorten −30 min' }));
    await waitFor(() => expect(mutate).toHaveBeenCalledWith('reservation.update', expect.objectContaining({ action: 'extend', reservationId: 'r1', reason: 'weather' })));
  });
});

// ---------------------------------------------------------------------------
// Open matches (docs/design/open-matches/operator.md §5.8, §5.10, §5.14)
// ---------------------------------------------------------------------------

function openMatch(over: Partial<OpenMatch> & { match_id: string }): OpenMatch {
  return {
    venue_id: 'v1',
    status: 'filling',
    start_at: at(20 * 60).toISOString(),
    end_at: at(21 * 60 + 30).toISOString(),
    duration_min: 90,
    category: 'open',
    join_policy: 'open',
    visibility: 'public',
    seats_taken: 3,
    seats_left: 1,
    requests_pending: 0,
    fill_deadline_at: at(18 * 60).toISOString(),
    organised_by: 'desk',
    organiser: null,
    price_iqd: 40000,
    shares_iqd: [10000, 10000, 10000, 10000],
    courts_free_firm: 1,
    courts_total: 2,
    ...over,
  };
}

describe('CreateReservationDialog — open matches', () => {
  // Court 1 is firmly booked 20:00–21:00; Court 2 is the last court free for the match.
  const night = { date: DATE, rows: [19 * 60, 19 * 60 + 30, 20 * 60, 20 * 60 + 30, 21 * 60], reservations: [booking({ id: 'held' })] };

  it('offers the Open match kind, and hands the court, start and guest to the Start dialog', async () => {
    const user = userEvent.setup();
    const onStartMatch = vi.fn();
    wrap(<CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} onStartMatch={onStartMatch} onClose={vi.fn()} onCreated={vi.fn()} />);
    await user.type(screen.getByLabelText(/Guest name/), 'Walk In');
    await user.click(screen.getByRole('button', { name: 'Open match' }));
    expect(onStartMatch).toHaveBeenCalledWith({ courtId: 'c2', startAt: at(20 * 60), customer: null, guestName: 'Walk In', guestPhone: '' });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('has no Open match kind for a caller that does not offer it (no runMatches, or matches off)', () => {
    wrap(<CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.queryByRole('button', { name: 'Open match' })).toBeNull();
  });

  it('offline: the Open match kind is disabled, and says why (DF-11)', () => {
    reachable = false;
    wrap(<CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} onStartMatch={vi.fn()} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect((screen.getByRole('button', { name: 'Open match' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('Needs a connection: open matches work online only')).toBeTruthy();
  });

  it('warns that booking the last free court cancels a filling match, and still books (OM-13)', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    wrap(
      <CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} openMatches={[openMatch({ match_id: 'm1' })]} onClose={vi.fn()} onCreated={onCreated} />,
    );
    // The count is LTR-isolated (countPhrase), so the digits sit inside marks.
    expect(screen.getByText(/^Booking this court cancels the open match at 8:00 PM \(\u20663\u2069 players in\)\. Their tickets go back to them\.$/)).toBeTruthy();
    await user.type(screen.getByLabelText(/Guest name/), 'Walk In');
    const create = screen.getByRole('button', { name: 'Create booking' }) as HTMLButtonElement;
    expect(create.disabled).toBe(false);
    await user.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(false));
  });

  it('does not warn on the court whose firm booking already holds that time, nor for a match with courts to spare', () => {
    const { unmount } = wrap(
      <CreateReservationDialog courtId="c1" startAt={at(19 * 60)} courts={courts} tz={TZ} night={night} openMatches={[openMatch({ match_id: 'm1' })]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(screen.queryByTestId('bump-warning')).toBeNull();
    unmount();
    wrap(
      <CreateReservationDialog courtId="c2" startAt={at(20 * 60)} courts={courts} tz={TZ} night={night} openMatches={[openMatch({ match_id: 'm1', courts_free_firm: 2 })]} onClose={vi.fn()} onCreated={vi.fn()} />,
    );
    expect(screen.queryByTestId('bump-warning')).toBeNull();
  });

  it('counts the players of a women’s match as women (R38)', () => {
    wrap(
      <CreateReservationDialog
        courtId="c2"
        startAt={at(20 * 60)}
        courts={courts}
        tz={TZ}
        night={night}
        openMatches={[openMatch({ match_id: 'm1', category: 'women', seats_taken: 1 })]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByText('Booking this court cancels the open match at 8:00 PM (one player in). Their tickets go back to them.')).toBeTruthy();
  });

  it('says a court at this time is kept for a match waiting for it, and reads SLOT_TAKEN as that (R22)', async () => {
    const user = userEvent.setup();
    const refused = new AppRpcError('SLOT_TAKEN', 'SLOT_TAKEN');
    (refused as unknown as { code: string }).code = 'SLOT_TAKEN';
    vi.mocked(mutate).mockRejectedValueOnce(refused);
    wrap(
      <CreateReservationDialog
        courtId="c2"
        startAt={at(20 * 60)}
        courts={courts}
        tz={TZ}
        night={night}
        openMatches={[openMatch({ match_id: 'w1', status: 'awaiting_court', seats_taken: 4, seats_left: 0 })]}
        onClose={vi.fn()}
        onCreated={vi.fn()}
      />,
    );
    expect(screen.getByText('A court at this time is kept for the open match at 8:00 PM: its four players are waiting for it.')).toBeTruthy();
    // A waiting match is not bumped by a booking: it keeps its court.
    expect(screen.queryByTestId('bump-warning')).toBeNull();
    await user.type(screen.getByLabelText(/Guest name/), 'Walk In');
    await user.click(screen.getByRole('button', { name: 'Create booking' }));
    expect(await screen.findByText('This court is kept for the open match at 8:00 PM. Pick another court or time.')).toBeTruthy();
  });
});

describe('toastBumpedMatches', () => {
  it('after the refetch, toasts each warned match the server no longer lists', async () => {
    const qc = new QueryClient();
    const listed: OpenMatches = { matches_enabled: true, fill_deadline_minutes: 120, earliest_start_minutes: 180, ticket_price_iqd: 10000, server_now: null, matches: [openMatch({ match_id: 'kept' })] };
    qc.setQueryData(['deskMatches', 'open', 'a', 'b'], listed);
    const notify = vi.fn();
    await toastBumpedMatches(qc, [openMatch({ match_id: 'gone' }), openMatch({ match_id: 'kept' })], notify);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]![0].match_id).toBe('gone');
  });
});

describe('ReservationActionsDialog — an open match’s booking', () => {
  const rows = [19 * 60, 20 * 60, 21 * 60];
  const started = booking({
    id: 'mr',
    guest_id: null,
    guest_name: 'Open match',
    start_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
    end_at: new Date(Date.now() - 1_800_000).toISOString(),
  });
  const state: MatchState = {
    reservation_id: 'mr',
    match_id: 'm1',
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
  };

  it('is named by its organiser with the chip, offers Players, and never a whole-booking no-show', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    wrap(<ReservationActionsDialog reservation={started} match={state} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={onClose} onChanged={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /Omar Saleh/ })).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Open match · 4 of 4 players' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark no-show' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Mark arrived' })).toBeNull();
    expect(screen.getByText('Shares stay as they are; any price difference goes on the bill.')).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Players' }));
    expect(onClose).toHaveBeenCalled();
    expect(navigateSpy).toHaveBeenCalledWith({ to: '/desk/bookings/$id', params: { id: 'mr' } });
  });

  it('is known from the row alone before its state arrives, and says what a cancel does to the match', async () => {
    const user = userEvent.setup();
    wrap(<ReservationActionsDialog reservation={started} courts={courts} date={DATE} tz={TZ} rows={rows} onClose={vi.fn()} onChanged={vi.fn()} />);
    expect(screen.getByRole('dialog', { name: /Open match/ })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Mark no-show' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel booking' }));
    expect(screen.getByText('Cancels the open match for all its players. Their tickets go back.')).toBeTruthy();
  });
});
