import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { LocaleProvider, useLocale } from '../../lib/i18n';

// The Players panel over a real query client (operator.md §5.13, §5.22).
// Reads and writes are mocked at appRpc; app.desk_match_detail answers from
// `raw`, which a test changes to play the server's next answer. The role is
// mocked at useAuth so the capabilities run for real, and the station's reach
// at useStationReach.

let role = 'court_desk';
let reachable = true;
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };

vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a href="#customer">{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/realtime', () => ({ useBroadcast: vi.fn() }));
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: vi.fn(async () => ({ timezone: 'Asia/Baghdad' })),
}));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));
vi.mock('../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'DESK-1',
}));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role } }) };
});
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable }) }));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { MatchPlayersPanel } from './MatchPlayersPanel';

const rpc = vi.mocked(appRpc);

// 21:00–22:30 at the branch.
const START = '2026-10-01T18:00:00.000Z';
const END = '2026-10-01T19:30:00.000Z';
const BEFORE = '2026-10-01T17:00:00.000Z';
const AFTER = '2026-10-01T18:20:00.000Z';

type Raw = Record<string, unknown>;

const NO_CAN = { mark_attended: false, mark_no_show: false, unmark: false, remove_reasons: [], take_share: false, write_off: false, replace: false };

function rawMoney(owed: number, over: Raw = {}): Raw {
  return { share_iqd: 10000, paid_desk_iqd: 10000 - owed, credit_iqd: 0, owed_iqd: owed, written_off_iqd: 0, write_off: null, open_iqd: owed, take_iqd: owed, ...over };
}

function rawSeat(no: number, over: Raw = {}): Raw {
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
    ticket: { ticket_id: `t${no}`, status: 'in_use' },
    write_off_reason: null,
    money: null,
    can: { ...NO_CAN },
    ...over,
  };
}

function rawDetail(match: Raw, seats: Raw[], money: Raw | null = null): Raw {
  return {
    match: {
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
      share_token: 'tok',
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
      started: true,
      marks_open: true,
      server_now: AFTER,
      can: { add_seat: false, cancel: false, call_off: false },
      ...match,
    },
    seats,
    requests: [],
    money,
    events: [],
  };
}

const bookingMoney = (over: Raw = {}): Raw => ({
  phase: 'booked',
  price_iqd: 40000,
  booking_price_iqd: 40000,
  price_delta_iqd: 0,
  paid_iqd: 0,
  live_tab_paid_iqd: 0,
  desk_paid_iqd: 0,
  unassigned_iqd: 0,
  delta_owed_iqd: 0,
  owed_iqd: 40000,
  written_off_iqd: 0,
  open_iqd: 40000,
  over_iqd: 0,
  vacant: [],
  unassigned: [],
  ...over,
});

/** A booked match after the start, every seat arrived and owing its share. */
const owingSeat = (no: number, over: Raw = {}) =>
  rawSeat(no, { status: 'attended', ticket: { ticket_id: `t${no}`, status: 'available' }, money: rawMoney(10000), can: { ...NO_CAN, take_share: true, write_off: true, unmark: true, mark_no_show: true }, ...over });

let raw: Raw;
let handlers: Record<string, (args: Record<string, unknown>) => unknown>;
const calls: { fn: string; args: Record<string, unknown> }[] = [];

beforeEach(() => {
  role = 'court_desk';
  reachable = true;
  localStorage.clear();
  calls.length = 0;
  handlers = {};
  for (const f of Object.values(toast)) f.mockClear();
  rpc.mockReset();
  rpc.mockImplementation(async (fn: string, args: Record<string, unknown> = {}) => {
    calls.push({ fn, args });
    if (fn === 'desk_match_detail') return structuredClone(raw);
    const h = handlers[fn];
    return h ? h(args) : {};
  });
});

function Dir({ children }: { children: ReactNode }) {
  const { dir } = useLocale();
  return <div dir={dir}>{children}</div>;
}

async function mount() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <Dir>
          <MatchPlayersPanel matchId="m1" />
        </Dir>
      </LocaleProvider>
    </QueryClientProvider>,
  );
  await screen.findByTestId('match-players');
  // Past the loading skeleton: the read has answered (rows, or a refusal).
  await waitFor(() => expect(document.querySelector('.tp-skel')).toBeNull());
  return view;
}

/** Visible text without the bidi isolates `isolate` / `isolateLtr` wrap names and counts in. */
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩]/g, '');
const row = (no: number) => screen.getByTestId(`seat-${no}`);
const settleCalls = () => calls.filter((c) => c.fn === 'match_seat_settle');

describe('MatchPlayersPanel', () => {
  it('four numbered rows while filling: the carriers, then open seats, Add player on the lowest', async () => {
    raw = rawDetail(
      { status: 'filling', started: false, server_now: BEFORE, reservation_id: null, can: { add_seat: true, cancel: true, call_off: false } },
      [rawSeat(1), rawSeat(2, { kind: 'friend', full_name: null, holder_seat_id: 's1', holder_name: 'Player A', companion_no: 1, customer_id: 'g1', is_organiser: false })],
    );
    await mount();
    expect(screen.getAllByTestId(/^seat-\d$/)).toHaveLength(4);
    expect(plain(row(1).textContent)).toContain('From the app · share 10,000 IQD, paid at the desk');
    expect(plain(row(2).textContent)).toContain('Player A +1');
    expect(plain(row(2).textContent)).toContain("On Player A's ticket");
    expect(row(3).textContent).toContain('Open seat');
    expect(within(row(3)).getByRole('button', { name: 'Add player' })).toBeTruthy();
    expect(within(row(4)).queryByRole('button', { name: 'Add player' })).toBeNull();
  });

  it('Arrived is optimistic, then the server answer offers Undo, which sends `in`', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [rawSeat(1, { money: rawMoney(10000), can: { ...NO_CAN, mark_attended: true, mark_no_show: true } }), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    let answer: () => void = () => {};
    handlers.mark_match_seats = () => new Promise<void>((resolve) => (answer = resolve));
    await mount();
    expect(row(1).textContent).toContain('Not marked yet');
    await user.click(within(row(1)).getByRole('button', { name: 'Arrived' }));
    // Before the server answers, the row already reads as arrived.
    await waitFor(() => expect(plain(row(1).textContent)).toContain('Came · owes 10,000 IQD'));
    expect(calls.find((c) => c.fn === 'mark_match_seats')?.args).toEqual({ p_seat_ids: ['s1'], p_attendance: 'attended' });
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    answer();
    const undo = await within(row(1)).findByRole('button', { name: 'Undo' });
    await user.click(undo);
    await waitFor(() => expect(calls.filter((c) => c.fn === 'mark_match_seats').at(-1)?.args).toEqual({ p_seat_ids: ['s1'], p_attendance: 'in' }));
  });

  it('a refused mark rolls the row back and says why', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    handlers.mark_match_seats = () => {
      throw new AppRpcError('SEAT_MARK_LOCKED', 'SEAT_MARK_LOCKED', undefined, 'paid');
    };
    await mount();
    await user.click(within(row(1)).getByRole('button', { name: 'Mark no-show instead' }));
    expect(await within(row(1)).findByText('This player has paid. Refund the payment at the till before marking a no-show.')).toBeTruthy();
    expect(plain(row(1).textContent)).toContain('Came · owes 10,000 IQD');
  });

  it('before the start No-show is shown disabled with its reason', async () => {
    raw = rawDetail({ started: false, server_now: BEFORE }, [rawSeat(1, { money: rawMoney(10000), can: { ...NO_CAN, mark_attended: true } }), rawSeat(2), rawSeat(3), rawSeat(4)], bookingMoney());
    await mount();
    const noShow = within(row(1)).getByRole('button', { name: 'No-show' }) as HTMLButtonElement;
    expect(noShow.disabled).toBe(true);
    expect(noShow.title).toBe('A no-show can be marked once the game starts');
    expect(row(1).textContent).toContain('Share 10,000 IQD, paid at the desk');
  });

  it('on a played match there is no Undo, only the corrections', async () => {
    raw = rawDetail({ status: 'played', reservation_status: 'completed' }, [owingSeat(1, { can: { ...NO_CAN, mark_no_show: true, take_share: true } }), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    await mount();
    expect(within(row(1)).queryByRole('button', { name: 'Undo' })).toBeNull();
    expect(within(row(1)).getByRole('button', { name: 'Mark no-show instead' })).toBeTruthy();
    // R16: a played match offers no Undo whatever the payload says.
    expect(within(row(2)).queryByRole('button', { name: 'Undo' })).toBeNull();
  });

  it('Take share opens the Cash pane at take_iqd, also on a written-off row, and sends the settle', async () => {
    const user = userEvent.setup();
    const writtenOff = owingSeat(2, {
      write_off_reason: 'walked_out',
      money: rawMoney(0, { paid_desk_iqd: 0, write_off: 'manual', written_off_iqd: 10000, take_iqd: 10000 }),
      can: { ...NO_CAN, take_share: true },
    });
    raw = rawDetail({}, [owingSeat(1), writtenOff, owingSeat(3), owingSeat(4)], bookingMoney());
    handlers.match_seat_settle = () => ({ duplicate: false, payment_id: 'p1', amount_iqd: 10000, change_iqd: 0, seats: [] });
    await mount();
    expect(plain(row(2).textContent)).toContain('Came · 10,000 IQD written off (Left without paying)');
    await user.click(within(row(2)).getByRole('button', { name: 'Take share' }));
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(plain(pane.textContent)).toContain("Player B's share");
    expect(within(pane).getAllByText('10,000 IQD').length).toBeGreaterThan(0);
    await user.click(within(pane).getByRole('button', { name: 'Exact amount' }));
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(settleCalls()).toHaveLength(1));
    const args = settleCalls()[0]!.args;
    expect(args).toMatchObject({ p_seat_ids: ['s2'], p_method: 'cash', p_expected_owed_iqd: 10000, p_tendered_iqd: 10000, p_amount_iqd: null, p_device_id: 'DESK-1' });
    expect(String(args.p_idempotency_key)).toMatch(/^match\.settle:/);
    await waitFor(() => expect(toast.ok).toHaveBeenCalled());
    expect(plain(toast.ok.mock.calls[0]![0] as string)).toBe('Took 10,000 IQD for Player B.');
  });

  it('Take several sums the picked shares and takes them whole, in seat order', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    handlers.match_seat_settle = () => ({ duplicate: false, amount_iqd: 20000, change_iqd: 0, seats: [] });
    await mount();
    await user.click(screen.getByRole('button', { name: 'Take several' }));
    await user.click(screen.getByRole('checkbox', { name: /Take the share of .*Player C/ }));
    await user.click(screen.getByRole('checkbox', { name: /Take the share of .*Player A/ }));
    const take = screen.getByRole('button', { name: /^Take .*2.* shares · 20,000 IQD$/ });
    await user.click(take);
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    expect(within(pane).queryByText('Part payment')).toBeNull();
    expect(within(pane).getAllByText('20,000 IQD').length).toBeGreaterThan(0);
    await user.click(within(pane).getByRole('button', { name: 'Exact amount' }));
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(settleCalls()).toHaveLength(1));
    expect(settleCalls()[0]!.args).toMatchObject({ p_seat_ids: ['s1', 's3'], p_expected_owed_iqd: 20000, p_amount_iqd: null });
  });

  it('SEAT_OWED_CHANGED re-reads the match and keeps the pane open on the new due', async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    handlers.match_seat_settle = () => {
      raw = rawDetail({}, [owingSeat(1, { money: rawMoney(6000) }), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
      throw new AppRpcError('SEAT_OWED_CHANGED', 'SEAT_OWED_CHANGED', undefined, 'expected 10000, now 6000');
    };
    await mount();
    const readsBefore = calls.filter((c) => c.fn === 'desk_match_detail').length;
    await user.click(within(row(1)).getByRole('button', { name: 'Take share' }));
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    await user.click(within(pane).getByRole('button', { name: 'Exact amount' }));
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    expect(await within(pane).findByText('What this player owes changed to 6,000 IQD. Check before taking it.')).toBeTruthy();
    expect(calls.filter((c) => c.fn === 'desk_match_detail').length).toBeGreaterThan(readsBefore);
    expect(within(pane).getAllByText('6,000 IQD').length).toBeGreaterThan(0);
    expect(screen.getByRole('dialog', { name: 'Cash' })).toBe(pane);
  });

  it('BOOKING_TAB_OPEN closes the pane and opens Assign on the money in that bill', async () => {
    const user = userEvent.setup();
    // Money on a LIVE bill: in unassigned[], but not in the booking's
    // unassigned_iqd, which counts settled bills only (money.md §6.2).
    const money = bookingMoney({
      unassigned_iqd: 0,
      unassigned: [{ payment_id: 'p9', tab_id: 'tab-9', tab_live: true, method: 'cash', amount_iqd: 5000, unassigned_iqd: 5000, created_at: '2026-10-01T18:05:00.000Z' }],
    });
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], money);
    handlers.match_seat_settle = () => {
      throw new AppRpcError('BOOKING_TAB_OPEN', 'BOOKING_TAB_OPEN', undefined, 'tab-9');
    };
    await mount();
    await user.click(within(row(1)).getByRole('button', { name: 'Take share' }));
    const pane = await screen.findByRole('dialog', { name: 'Cash' });
    await user.click(within(pane).getByRole('button', { name: 'Exact amount' }));
    await user.click(within(pane).getByRole('button', { name: 'Record payment' }));
    const assign = await screen.findByRole('dialog', { name: 'Assign money to players' });
    expect(within(assign).getByText(/This booking has a bill open with money on it/)).toBeTruthy();
    expect(within(assign).getByRole('button', { name: 'Keep on the booking' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Cash' })).toBeNull();
  });

  it('money taken on a live bill shows in the footer with Assign, though the booking figure counts settled bills only', async () => {
    const user = userEvent.setup();
    const live = { payment_id: 'p9', tab_id: 'tab-9', tab_live: true, method: 'cash', amount_iqd: 5000, unassigned_iqd: 5000, created_at: '2026-10-01T18:05:00.000Z' };
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney({ unassigned_iqd: 0, unassigned: [live] }));
    await mount();
    const panel = screen.getByTestId('match-players');
    expect(within(panel).getByText('Taken at the desk without a player: 5,000 IQD')).toBeTruthy();
    await user.click(within(panel).getByRole('button', { name: 'Assign' }));
    const assign = await screen.findByRole('dialog', { name: 'Assign money to players' });
    expect(within(assign).getByRole('button', { name: 'Keep on the booking' })).toBeTruthy();
  });

  it('no row with money left: no Assign line, whatever the booking figure says', async () => {
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney({ unassigned_iqd: 40000, unassigned: [] }));
    await mount();
    expect(within(screen.getByTestId('match-players')).queryByRole('button', { name: 'Assign' })).toBeNull();
    expect(screen.queryByText(/Taken at the desk without a player/)).toBeNull();
  });

  it("Write off asks a manager's PIN and sends p_pin with the station's device id", async () => {
    const user = userEvent.setup();
    raw = rawDetail({}, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    handlers.match_seat_write_off = () => ({ duplicate: false });
    await mount();
    await user.click(within(row(1)).getByRole('button', { name: 'Write off' }));
    const modal = await screen.findByRole('dialog');
    expect(plain(modal.textContent)).toContain("Write off Player A's share");
    expect(plain(modal.textContent)).toContain("The booking stops owing 10,000 IQD, and reports show it as written off. A manager's PIN authorises this.");
    await user.type(within(modal).getByLabelText('Manager PIN'), '1234');
    await user.click(within(modal).getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(calls.find((c) => c.fn === 'match_seat_write_off')?.args).toEqual({ p_seat_id: 's1', p_reason: 'walked_out', p_pin: '1234', p_device_id: 'DESK-1' }));
  });

  it('Call off waits for every mark, then names who came and who did not', async () => {
    const user = userEvent.setup();
    const seats = [owingSeat(1), rawSeat(2, { status: 'no_show', ticket: { ticket_id: 't2', status: 'forfeited' }, money: rawMoney(0, { write_off: 'no_show', written_off_iqd: 10000, take_iqd: 0 }) }), rawSeat(3, { money: rawMoney(10000) }), owingSeat(4)];
    raw = rawDetail({}, seats, bookingMoney());
    const first = await mount();
    const blocked = screen.getByRole('button', { name: 'Call off the match' }) as HTMLButtonElement;
    expect(blocked.disabled).toBe(true);
    expect(plain(blocked.title)).toBe('Mark every player first (one player not marked)');
    first.unmount();

    raw = rawDetail({ can: { add_seat: false, cancel: false, call_off: true } }, [seats[0]!, seats[1]!, owingSeat(3), seats[3]!], bookingMoney({ desk_paid_iqd: 10000 }));
    handlers.desk_call_off_short = () => ({ match_id: 'm1', status: 'cancelled' });
    await mount();
    await user.click(screen.getByRole('button', { name: 'Call off the match' }));
    const dialog = await screen.findByRole('dialog', { name: 'Call off this match?' });
    expect(plain(dialog.textContent)).toContain("Came: Player A, Player C, Player D. Didn't come: Player B.");
    expect(plain(dialog.textContent)).toContain('10,000 IQD was already taken at the desk for this match.');
    await user.click(within(dialog).getByRole('button', { name: 'Call off the match' }));
    await waitFor(() => expect(calls.find((c) => c.fn === 'desk_call_off_short')?.args).toEqual({ p_match_id: 'm1' }));
  });

  it('a sandbox match (App Review) says so and offers no control', async () => {
    raw = rawDetail({ sandbox: true, can: { add_seat: false, cancel: false, call_off: false } }, [owingSeat(1), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    await mount();
    expect(screen.getByText('Test match: not a real booking. Nothing here can be changed.')).toBeTruthy();
    expect(within(screen.getByTestId('match-players')).queryAllByRole('button')).toHaveLength(0);
  });

  it('a match the server will not show reads "not at this branch", never "offline"', async () => {
    raw = rawDetail({}, []);
    rpc.mockImplementation(async (fn: string) => {
      if (fn === 'desk_match_detail') throw new AppRpcError('MATCH_NOT_FOUND', 'MATCH_NOT_FOUND');
      return {};
    });
    await mount();
    expect(await screen.findByText("That open match isn't at this branch.")).toBeTruthy();
  });

  it('offline: every control is disabled and says it needs a connection', async () => {
    reachable = false;
    raw = rawDetail(
      { can: { add_seat: true, cancel: false, call_off: true } },
      [
        rawSeat(1, { money: rawMoney(10000), can: { ...NO_CAN, mark_attended: true, mark_no_show: true, remove_reasons: ['staff_error'] } }),
        owingSeat(2),
        owingSeat(3),
        rawSeat(4, { status: 'no_show', money: rawMoney(0, { take_iqd: 0 }), can: { ...NO_CAN, mark_attended: true, unmark: true, replace: true } }),
      ],
      bookingMoney({ unassigned_iqd: 5000, unassigned: [{ payment_id: 'p9', tab_id: 't9', tab_live: false, method: 'card', amount_iqd: 5000, unassigned_iqd: 5000, created_at: null }] }),
    );
    await mount();
    const buttons = within(screen.getByTestId('match-players')).getAllByRole('button') as HTMLButtonElement[];
    expect(buttons.length).toBeGreaterThan(8);
    for (const b of buttons) {
      expect(b.disabled, b.textContent ?? '').toBe(true);
      expect(b.title, b.textContent ?? '').toBe('Needs a connection: open matches work online only');
    }
  });

  it('Arabic: right to left, Latin digits, and feminine lines in a women’s match', async () => {
    localStorage.setItem('touch-operator-locale', 'ar');
    raw = rawDetail({ category: 'women' }, [owingSeat(1, { gender: 'female', gender_source: 'guest' }), owingSeat(2), owingSeat(3), owingSeat(4)], bookingMoney());
    const { container } = await mount();
    expect(container.querySelector('[dir="rtl"]')).toBeTruthy();
    const text = plain(row(1).textContent);
    expect(text).toContain('حضرت · عليها');
    expect(text).toMatch(/10,000/);
    expect(text).not.toMatch(/[٠-٩]/);
    expect(text).toContain('الفئة: سيدة · بتصريح الزبون');
    expect(within(row(1)).getByRole('button', { name: 'استلام الحصة' })).toBeTruthy();
    expect(within(row(1)).getByText('المنظّمة')).toBeTruthy();
  });
});
