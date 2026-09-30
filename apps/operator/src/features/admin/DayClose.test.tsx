import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// Day close's "Checklists not finished" (0165 app.checklist_day_state; plan
// §7.3): the daily lists with a line nobody ticked on the day being closed are
// a WARNING beside the steps. They never hold the close: with the tabs closed,
// the queue empty and the cash counted, "Close the day" stays open whatever
// the lists say, and a failed read of them only offers a retry.

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../components/ConfirmDialog', () => ({ useConfirm: () => vi.fn(async () => false) }));
vi.mock('../../lib/supabase', () => {
  // The open tabs (none), the day summary (none yet) and the adjustments (none).
  const from = () => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.eq = () => chain;
    chain.in = () => Promise.resolve({ data: [], error: null });
    chain.maybeSingle = () => Promise.resolve({ data: null, error: null });
    chain.order = () => Promise.resolve({ data: [], error: null });
    return chain;
  };
  return { supabase: { from }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // Yesterday's session, closed late: the lists are that day's, not today's.
  fetchOpenDay: vi.fn(async () => ({ id: 'ds1', status: 'open', business_date: '2026-09-24', opened_at: '2026-09-24T05:00:00Z', opening_float_iqd: 50000 })),
}));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<{ permissionsFor: (role: string) => unknown }>();
  return { ...actual, usePermissions: () => actual.permissionsFor('manager') };
});
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { DayClose } from './DayClose';

const rpc = vi.mocked(appRpc);

const dayState = {
  business_date: '2026-09-24',
  lists: [
    { role: 'barista', slot: 'open', name_en: 'Bar opening', name_ar: 'افتتاح البار', total: 2, done: 2, open_items: [] },
    {
      role: 'barista',
      slot: 'close',
      name_en: 'Bar closing',
      name_ar: 'إغلاق البار',
      total: 5,
      done: 1,
      open_items: [
        { text_en: 'Wipe the counter', text_ar: 'امسح الكاونتر' },
        { text_en: 'Empty the bins', text_ar: 'أفرغ السلال' },
        { text_en: 'Clean the grinder', text_ar: 'نظّف المطحنة' },
        { text_en: 'Lock the fridge', text_ar: 'اقفل الثلاجة' },
      ],
    },
    { role: 'driver', slot: 'open', name_en: 'Driver opening', name_ar: 'افتتاح السائق', total: 3, done: 0, open_items: [{ text_en: 'Check the van', text_ar: 'افحص السيارة' }] },
  ],
};

let checklists: unknown;
/** app.till_shift_list (wave 5): none unless a test sets it. */
let shifts: unknown = { from: null, to: null, shifts: [], outside: [], cross_day: [] };
const calls: { fn: string; args: Record<string, unknown> }[] = [];
/** app.unpaid_played_bookings and app.day_close_online (open matches, 0265): nothing unless a test sets them. */
let unpaid: unknown[] = [];
let online: unknown = {};
/** app.desk_match_states for the unpaid match rows: no state (the label falls back) unless a test sets one. */
let matchStates: unknown = {};

function mount() {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    calls.push({ fn, args: args ?? {} });
    if (fn === 'checklist_day_state') {
      if (checklists instanceof Error) throw checklists;
      return checklists;
    }
    if (fn === 'unpaid_played_bookings') return unpaid;
    if (fn === 'desk_match_states') return matchStates;
    if (fn === 'day_close_online') {
      if (online instanceof Error) throw online;
      return online;
    }
    if (fn === 'till_shift_list') {
      if (shifts instanceof Error) throw shifts;
      return shifts;
    }
    throw new Error(`unexpected ${fn}`);
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <DayClose />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const closeButton = () => screen.getByRole('button', { name: 'Close the day' }) as HTMLButtonElement;

async function countTheCash() {
  await screen.findByRole('button', { name: 'Close the day' });
  // Only the count holds it at this point: the tabs are closed and the queue is empty.
  expect(closeButton().disabled).toBe(true);
  await userEvent.type(screen.getByLabelText('Counted cash (IQD)'), '125000');
  // Re-read each time: the button is rendered anew once its disabled reason goes.
  await waitFor(() => expect(closeButton().disabled).toBe(false));
}

beforeEach(() => {
  rpc.mockReset();
  calls.length = 0;
  shifts = { from: null, to: null, shifts: [], outside: [], cross_day: [] };
  unpaid = [];
  online = {};
  matchStates = {};
});

describe('Day close ▸ Checklists not finished', () => {
  it('lists the unfinished lists of the day being closed, and the close stays open', async () => {
    checklists = dayState;
    mount();
    const panel = await screen.findByTestId('day-close-checklists');
    expect(within(panel).getByText('Checklists not finished')).toBeTruthy();
    expect(within(panel).getByText('2 open')).toBeTruthy();
    // The lead names the day being closed, never "today".
    expect(panel.textContent).not.toMatch(/today/i);
    const rows = within(panel).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('1 of 5 done');
    // Three open lines are named, the rest counted.
    expect(rows[0]!.textContent).toContain('Wipe the counter, Empty the bins, Clean the grinder');
    expect(rows[0]!.textContent).toContain('+1 more');
    expect(rows[1]!.textContent).toContain('Check the van');
    // Read for the open session's business date, not the calendar's.
    expect(calls.find((c) => c.fn === 'checklist_day_state')?.args).toEqual({ p_business_date: '2026-09-24' });

    await countTheCash();
    // Still listed: a warning beside an open close, never a block.
    expect(screen.getByTestId('day-close-checklists')).toBeTruthy();
  });

  it('shows only a retry when the lists cannot be read, and the close stays open', async () => {
    checklists = new AppRpcError('UNKNOWN', 'network down');
    mount();
    const panel = await screen.findByTestId('day-close-checklists');
    expect(within(panel).queryAllByRole('listitem')).toHaveLength(0);
    expect(within(panel).getByRole('button', { name: 'Try again' })).toBeTruthy();
    await countTheCash();

    // The read comes back: the retry lists them.
    checklists = dayState;
    await userEvent.click(within(panel).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(within(screen.getByTestId('day-close-checklists')).getAllByRole('listitem')).toHaveLength(2));
  });

  it('shows nothing when every list is finished', async () => {
    checklists = { business_date: '2026-09-24', lists: [dayState.lists[0]] };
    mount();
    await countTheCash();
    await waitFor(() => expect(calls.some((c) => c.fn === 'checklist_day_state')).toBe(true));
    expect(screen.queryByTestId('day-close-checklists')).toBeNull();
  });
});

// Till shifts (wave5-addendum-2026-09-25 §5.2, V10): a step of their own, a
// WARNING and never a block. An open shift says what closing the day does to
// it; the close stays open once the cash is counted.
describe('Day close ▸ Till shifts', () => {
  const shift = (over: Record<string, unknown>) => ({
    id: 's1', day_session_id: 'ds1', business_date: '2026-09-24', station_id: 'TILL-01', staff_id: 'maha', staff_name: 'Maha',
    opened_at: '2026-09-24T06:00:00Z', closed_at: '2026-09-24T13:00:00Z', closed_via: 'own_pin', closed_by_name: 'Maha',
    authorized_by_name: 'Maha', opening_float_iqd: 100000, handover_difference_iqd: null, cash_payments_iqd: 250000,
    cash_refunds_iqd: 0, cash_expected_iqd: 350000, cash_counted_iqd: 345000, cash_variance_iqd: -5000,
    card_payments_iqd: 80000, card_refunds_iqd: 0, payment_count: 12, refund_count: 0, drawer_open_count: 1,
    open_note: null, close_note: null, ...over,
  });

  it('lists each shift with its difference, the money outside a shift and the cross-day refunds, and the close stays open', async () => {
    checklists = { business_date: '2026-09-24', lists: [] };
    shifts = {
      from: '2026-09-24',
      to: '2026-09-24',
      shifts: [
        shift({}),
        shift({ id: 's2', staff_id: 'ali', staff_name: 'Ali', opened_at: '2026-09-24T13:05:00Z', closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null, handover_difference_iqd: 5000 }),
      ],
      outside: [{ day_session_id: 'ds1', business_date: '2026-09-24', station_id: 'TILL-01', cash_payments_iqd: 20000, cash_refunds_iqd: 0, card_payments_iqd: 0, card_refunds_iqd: 0, payment_count: 1, refund_count: 0 }],
      cross_day: [{ day_session_id: 'ds1', business_date: '2026-09-24', earlier_days_cash_refunds_iqd: 30000, earlier_days_card_refunds_iqd: 0, later_cash_refunds_iqd: 0, later_card_refunds_iqd: 0 }],
    };
    mount();
    const step = await screen.findByTestId('day-close-shifts');
    expect(screen.getByText('Till shifts')).toBeTruthy();
    expect(await screen.findByText('1 still open')).toBeTruthy();
    // The difference as a sign word, the open one as open.
    expect(within(step).getByText('Short by 5,000 IQD')).toBeTruthy();
    expect(within(step).getByText('Open')).toBeTruthy();
    expect(step.textContent).toContain('Closing the day ends an open shift without a count');
    expect(step.textContent).toContain('Taken outside a shift');
    expect(step.textContent).toContain('Refunds made on this day for earlier days’ payments: 30,000 IQD in cash');
    // Read with no dates: the open day's, narrowed to the session on screen.
    expect(calls.find((c) => c.fn === 'till_shift_list')?.args).toEqual({ p_from: null, p_to: null, p_station_id: null, p_staff_id: null });

    await countTheCash();
    // Still listed: a warning beside an open close.
    expect(screen.getByTestId('day-close-shifts')).toBeTruthy();
  });

  it('shows a retry when the shifts cannot be read, and the close stays open', async () => {
    checklists = { business_date: '2026-09-24', lists: [] };
    shifts = new AppRpcError('UNKNOWN', 'network down');
    mount();
    const step = await screen.findByTestId('day-close-shifts');
    expect(within(step).getByRole('button', { name: 'Try again' })).toBeTruthy();
    await countTheCash();
  });

  it('says so plainly when there were no shifts', async () => {
    checklists = { business_date: '2026-09-24', lists: [] };
    mount();
    expect(await screen.findByText('No shifts')).toBeTruthy();
    expect(screen.queryByTestId('day-close-shifts')).toBeNull();
    await countTheCash();
  });
});

// Open matches (operator.md §5.18): "Money outside the drawer" is information
// only, hidden when every figure is zero; a played-not-paid match booking
// lists the seats still owing.
describe('Day close ▸ Money outside the drawer', () => {
  it('shows the day’s online money and open-match figures, and the close stays open', async () => {
    checklists = { business_date: '2026-09-24', lists: [] };
    online = {
      day_session_id: 'ds1',
      business_date: '2026-09-24',
      deposits: { received_iqd: 45000, received_count: 3, refunded_iqd: 0, refunded_count: 0, forfeited_iqd: 0, forfeited_count: 0, refunds_waiting_iqd: 0, refunds_waiting_count: 0 },
      tickets_here: { forfeited_iqd: 10000, forfeited_count: 1, restored_count: 0, cashouts_iqd: 0, cashouts_count: 0 },
      tickets_chain: { sold_iqd: 0, sold_tickets: 0, purchases: 0, refunded_iqd: 0, refunded_tickets: 0, refunds_waiting_iqd: 0, refunds_waiting_count: 0, liability_iqd: 0, liability_tickets: 0 },
      matches: { bookings: 2, price_iqd: 120000, desk_paid_iqd: 90000, written_off_iqd: 30000, owed_iqd: 0, called_off: 0, no_show_seats: 1 },
      sandbox_excluded: { deposits: 0, tickets: 0 },
    };
    mount();
    const card = await screen.findByTestId('day-close-online');
    expect(within(card).getByText('Money outside the drawer')).toBeTruthy();
    expect(within(card).getByText('Online deposits, this branch')).toBeTruthy();
    expect(within(card).getByText('45,000 IQD')).toBeTruthy();
    expect(within(card).getByText('Lost at this branch (revenue)')).toBeTruthy();
    expect(within(card).getByText('Open-match bookings today')).toBeTruthy();
    expect(within(card).getByText('30,000 IQD')).toBeTruthy();
    // Nothing chain-wide moved and no test payment was left out: those groups are not drawn.
    expect(within(card).queryByText('Match tickets, all branches')).toBeNull();
    expect(within(card).queryByText('Test payments left out')).toBeNull();
    expect(calls.find((c) => c.fn === 'day_close_online')?.args).toEqual({ p_day_session_id: 'ds1' });
    await countTheCash();
  });

  it('is not drawn when every figure is zero, nor on a server without the read', async () => {
    checklists = { business_date: '2026-09-24', lists: [] };
    online = { deposits: { received_iqd: 0 }, matches: { bookings: 0 } };
    mount();
    await countTheCash();
    await waitFor(() => expect(calls.some((c) => c.fn === 'day_close_online')).toBe(true));
    expect(screen.queryByTestId('day-close-online')).toBeNull();
  });

  it('a match booking played and not paid reads Open match and lists its owing seats', async () => {
    checklists = { business_date: '2026-09-24', lists: [] };
    unpaid = [
      {
        reservation_id: 'r1',
        guest_name: 'Open match',
        status: 'completed',
        start_at: '2026-09-24T17:00:00Z',
        end_at: '2026-09-24T18:30:00Z',
        court_name_en: 'Court 1',
        court_name_ar: 'ملعب 1',
        price_iqd: 40000,
        remaining_iqd: 20000,
        live_tab_id: null,
        match_id: 'm1',
        owed_by_seats_iqd: 20000,
        delta_owed_iqd: 0,
        seats_owing: [
          { seat_no: 4, label: 'Omar Khalid', owed_iqd: 10000 },
          { seat_no: 2, label: 'Ali Hasan', owed_iqd: 10000 },
        ],
      },
    ];
    mount();
    expect(await screen.findByText('Open match')).toBeTruthy();
    const seats = await screen.findAllByText(/^Seat \d · .+ · 10,000 IQD$/);
    expect(seats.map((el) => el.textContent?.replace(/[\u2066-\u2069]/g, ''))).toEqual(['Seat 2 · Ali Hasan · 10,000 IQD', 'Seat 4 · Omar Khalid · 10,000 IQD']);
    await countTheCash();
  });

  it("a match row names the match by its desk state's label: Open match · {organiser}", async () => {
    checklists = { business_date: '2026-09-24', lists: [] };
    unpaid = [
      {
        reservation_id: 'r1',
        guest_name: 'Open match',
        status: 'completed',
        start_at: '2026-09-24T17:00:00Z',
        end_at: '2026-09-24T18:30:00Z',
        court_name_en: 'Court 1',
        court_name_ar: 'ملعب 1',
        price_iqd: 40000,
        remaining_iqd: 10000,
        live_tab_id: null,
        match_id: 'm1',
        owed_by_seats_iqd: 10000,
        delta_owed_iqd: 0,
        seats_owing: [{ seat_no: 2, label: 'Ali Hasan', owed_iqd: 10000 }],
      },
    ];
    matchStates = { r1: { match_id: 'm1', status: 'played', category: 'open', label: 'Sara Karim', open_seats: 0 } };
    mount();
    expect(await screen.findByText((text) => text.replace(/[⁦-⁩]/g, '') === 'Open match · Sara Karim')).toBeTruthy();
    expect(calls.find((c) => c.fn === 'desk_match_states')?.args).toEqual({ p_reservation_ids: ['r1'] });
    await countTheCash();
  });
});
