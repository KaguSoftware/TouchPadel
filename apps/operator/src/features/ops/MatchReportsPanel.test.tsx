import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';

// operator.md §5.17: the Ops queue of player reports. hideWhenEmpty says
// nothing while nothing waits; Close report and Ban each send
// resolve_match_report; Ban is hidden once the player is banned; a role
// without reviewMatchReports sees nothing.

type Caps = Record<'runMatches' | 'takeSeatPayment' | 'writeOffSeat' | 'cashOutTickets' | 'banFromMatches' | 'reviewMatchReports', boolean>;
const MANAGER: Caps = { runMatches: true, takeSeatPayment: true, writeOffSeat: true, cashOutTickets: true, banFromMatches: true, reviewMatchReports: true };
let caps: Caps = MANAGER;
const navigate = vi.fn();
const toast = { ok: vi.fn(), err: vi.fn(), info: vi.fn() };

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => navigate }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../matches/useMatches', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useMatchCaps: () => caps,
}));
vi.mock('../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: async () => ({ timezone: 'Asia/Baghdad' }),
}));
vi.mock('../../components/toast', () => ({ useToast: () => toast }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { MatchReportsPanel } from './MatchReportsPanel';

const rpc = vi.mocked(appRpc);

function report(id: string, over: Record<string, unknown> = {}) {
  return {
    report_id: id,
    reason: 'abusive_behaviour',
    created_at: '2026-09-28T19:00:00Z',
    match: { id: 'm-1', start_at: '2026-09-28T17:00:00Z', category: 'open', status: 'played', reservation_id: 'res-1' },
    reported: { customer_id: 'c-omar', full_name: 'Omar Khalid', phone: '+9647701112222', flags: [], banned: false, reports_90d: 2, no_shows: 1 },
    reporter: { customer_id: 'c-sara', full_name: 'Sara Karim' },
    ...over,
  };
}

let reports: unknown[] = [];
let resolveAnswer: (args: Record<string, unknown>) => unknown = () => ({ status: 'dismissed', banned: false, duplicate: false });

function mount(hideWhenEmpty = true) {
  rpc.mockImplementation(async (fn: string, args?: Record<string, unknown>) => {
    if (fn === 'match_reports_open') return reports;
    if (fn === 'resolve_match_report') return resolveAnswer(args ?? {});
    return {};
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <MatchReportsPanel hideWhenEmpty={hideWhenEmpty} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

beforeEach(() => {
  caps = MANAGER;
  reports = [];
  resolveAnswer = () => ({ status: 'dismissed', banned: false, duplicate: false });
  rpc.mockReset();
  navigate.mockReset();
  toast.ok.mockReset();
  toast.err.mockReset();
});

describe('MatchReportsPanel', () => {
  it('hideWhenEmpty: nothing while no report waits', async () => {
    mount();
    await waitFor(() => expect(calls('match_reports_open')).toHaveLength(1));
    expect(calls('match_reports_open')[0]![1]).toEqual({ p_venue_id: null });
    expect(screen.queryByTestId('match-reports')).toBeNull();
  });

  it('a report: why, who, the match, and Close report sends dismissed', async () => {
    const user = userEvent.setup();
    reports = [report('r1')];
    mount();
    const row = within(await screen.findByTestId('match-report'));
    expect(row.getByText('Abusive behaviour')).toBeTruthy();
    expect(row.getByText('Omar Khalid')).toBeTruthy();
    expect(row.getByText(/Reports in 90 days 2 · No-shows 1/)).toBeTruthy();
    expect(row.getByText(/Reported by .*Sara Karim/)).toBeTruthy();
    await user.click(row.getByRole('button', { name: 'Open customer' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/desk/customers/$id', params: { id: 'c-omar' } });
    await user.click(row.getByRole('button', { name: 'Open match' }));
    expect(navigate).toHaveBeenLastCalledWith({ to: '/desk/matches/$id', params: { id: 'm-1' } });
    await user.click(row.getByRole('button', { name: 'Close report' }));
    await waitFor(() => expect(calls('resolve_match_report')).toHaveLength(1));
    expect(calls('resolve_match_report')[0]![1]).toEqual({ p_report_id: 'r1', p_outcome: 'dismissed' });
    expect(toast.ok).toHaveBeenCalledWith('Report closed.');
  });

  it('shows three, then View more opens the rest in place and Show less folds them', async () => {
    const user = userEvent.setup();
    reports = ['r1', 'r2', 'r3', 'r4', 'r5'].map((id) => report(id));
    mount();
    await waitFor(() => expect(screen.getAllByTestId('match-report')).toHaveLength(3));
    await user.click(screen.getByRole('button', { name: 'View more (2)' }));
    expect(screen.getAllByTestId('match-report')).toHaveLength(5);
    await user.click(screen.getByRole('button', { name: 'Show less' }));
    expect(screen.getAllByTestId('match-report')).toHaveLength(3);
  });

  it('Ban asks first, then sends banned', async () => {
    const user = userEvent.setup();
    reports = [report('r1')];
    resolveAnswer = () => ({ status: 'actioned', banned: true, duplicate: false });
    mount();
    await user.click(within(await screen.findByTestId('match-report')).getByRole('button', { name: 'Ban' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText('The reason recorded is: Reported by players.')).toBeTruthy();
    await user.click(dialog.getByRole('button', { name: 'Ban' }));
    await waitFor(() => expect(calls('resolve_match_report')).toHaveLength(1));
    expect(calls('resolve_match_report')[0]![1]).toEqual({ p_report_id: 'r1', p_outcome: 'banned' });
  });

  it('Ban is hidden once the player is banned', async () => {
    reports = [report('r1', { reported: { customer_id: 'c-omar', full_name: 'Omar Khalid', phone: null, flags: [{ type: 'match_ban', label: 'conduct' }], banned: true, reports_90d: 3, no_shows: 0 } })];
    mount();
    const row = within(await screen.findByTestId('match-report'));
    expect(row.queryByRole('button', { name: 'Ban' })).toBeNull();
    expect(row.getByRole('button', { name: 'Close report' })).toBeTruthy();
  });

  it('a report someone already closed: the list is read again and a toast says why', async () => {
    const user = userEvent.setup();
    reports = [report('r1')];
    resolveAnswer = () => {
      throw new AppRpcError('REPORT_CLOSED', 'REPORT_CLOSED');
    };
    mount();
    await user.click(within(await screen.findByTestId('match-report')).getByRole('button', { name: 'Close report' }));
    await waitFor(() => expect(toast.err).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(calls('match_reports_open').length).toBeGreaterThan(1));
  });

  it('a role without reviewMatchReports sees nothing and reads nothing', async () => {
    caps = { ...MANAGER, reviewMatchReports: false };
    reports = [report('r1')];
    mount(false);
    await new Promise((r) => setTimeout(r, 20));
    expect(screen.queryByTestId('match-reports')).toBeNull();
    expect(calls('match_reports_open')).toHaveLength(0);
  });

  it('a server without open matches (RPC_MISSING) shows nothing, even without hideWhenEmpty', async () => {
    rpc.mockImplementation(async () => {
      throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <LocaleProvider>
          <MatchReportsPanel />
        </LocaleProvider>
      </QueryClientProvider>,
    );
    await waitFor(() => expect(calls('match_reports_open')).toHaveLength(1));
    await waitFor(() => expect(screen.queryByTestId('match-reports')).toBeNull());
  });
});
