import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// 0390 (F-40): the desk confirms each participant (only then are they in), the
// Pay tab takes the entry fees still owed, and a confirmed player may still owe.

const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async () => ({ entry_id: 'e1', confirmed: true, changed: true })),
}));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));
vi.mock('./TakeTournamentPayment', () => ({
  TakeTournamentPayment: ({ target }: { target: { entryId: string; dueIqd: number } }) => (
    <div data-testid="take-payment">{`${target.entryId}:${target.dueIqd}`}</div>
  ),
}));

import { appRpc } from '../../lib/appRpc';
import { EntriesPanel } from './EntriesPanel';
import { PayPanel } from './PayPanel';
import { readTournamentDetail, type TournamentDetail } from './tournamentPayloads';

const rpc = vi.mocked(appRpc);
const CAPS = { runTournaments: true, publishTournaments: false, takeTournamentPayment: true, editVenueDetails: false };

const entry = (id: string, over: Record<string, unknown> = {}) => ({
  entry_id: id,
  guest_id: `g-${id}`,
  full_name: `Player ${id}`,
  phone: null,
  status: 'registered',
  seed_no: null,
  waitlist_position: null,
  added_by_kind: 'guest',
  owed_iqd: 20000,
  net_paid_iqd: 0,
  refund_due_iqd: 0,
  substitute_for: null,
  payments: [],
  confirmed_at: null,
  confirmed_by_name: null,
  ...over,
});

function detail(entries: Record<string, unknown>[], status = 'closed'): TournamentDetail {
  return readTournamentDetail({
    id: 't1',
    venue_id: 'v',
    name_en: 'Cup',
    name_ar: 'كأس',
    format: 'americano',
    category: 'open',
    status,
    entry_fee_iqd: 20000,
    max_entries: 8,
    min_entries: 4,
    revision: 1,
    entries,
    courts: [],
    rounds: [],
    standings: [],
    can: { add: true, set_rounds: true, score: false, cancel: false, close: false, finish: false, settle: true, confirm: true },
  })!;
}

function mount(ui: React.ReactNode) {
  try {
    localStorage.setItem('touch-operator-locale', 'en');
  } catch {
    /* no storage */
  }
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <LocaleProvider>{ui}</LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  rpc.mockClear();
  toast.ok.mockReset();
});

describe('Entries: Confirm participant (0390, F-40)', () => {
  it('confirms an unconfirmed player and undoes a confirmed one', async () => {
    const user = userEvent.setup();
    mount(
      <EntriesPanel
        detail={detail([entry('e1'), entry('e2', { confirmed_at: '2026-10-05T09:00:00Z', confirmed_by_name: 'Sait' })])}
        caps={CAPS}
        onRefetch={vi.fn()}
      />,
    );
    expect(screen.getByText('1 to confirm before the start')).toBeTruthy();
    expect(screen.getByText('Not confirmed')).toBeTruthy();
    await user.click(screen.getByTestId('entry.confirm.e1'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('tournament_confirm_entry', { p_entry_id: 'e1', p_confirmed: true }));
    expect(toast.ok).toHaveBeenCalledWith(expect.stringContaining('is in the tournament'));
    await user.click(screen.getByTestId('entry.unconfirm.e2'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('tournament_confirm_entry', { p_entry_id: 'e2', p_confirmed: false }));
    expect(screen.queryByTestId('entry.confirm.e2')).toBeNull();
  });
});

describe('Pay tab (0390, F-40)', () => {
  it('lists who still owes, confirmed or not, and takes a fee', async () => {
    const user = userEvent.setup();
    mount(
      <PayPanel
        detail={detail([
          entry('e1'),
          entry('e2', { confirmed_at: '2026-10-05T09:00:00Z' }),
          entry('e3', { owed_iqd: 0, confirmed_at: '2026-10-05T09:00:00Z' }),
          entry('e4', { status: 'waitlisted' }),
        ])}
        caps={CAPS}
        onRefetch={vi.fn()}
      />,
    );
    const panel = screen.getByTestId('pay-panel');
    expect(within(panel).getByTestId('pay.row.e2')).toBeTruthy();
    expect(within(panel).getByTestId('pay.row.e1')).toBeTruthy();
    expect(within(panel).queryByTestId('pay.row.e3')).toBeNull();
    expect(within(panel).queryByTestId('pay.row.e4')).toBeNull();
    // Confirmed first.
    const rows = within(panel).getAllByRole('listitem');
    expect(rows[0]!.getAttribute('data-testid')).toBe('pay.row.e2');
    expect(within(panel).getByTestId('pay-total').textContent).toMatch(/2 owe .*40,000 IQD/);
    await user.click(within(panel).getByTestId('pay.take.e1'));
    expect(screen.getByTestId('take-payment').textContent).toBe('e1:20000');
  });

  it('says so when nobody owes', () => {
    mount(<PayPanel detail={detail([entry('e1', { owed_iqd: 0 })])} caps={CAPS} onRefetch={vi.fn()} />);
    expect(screen.getByText('Nobody owes an entry fee.')).toBeTruthy();
  });
});
