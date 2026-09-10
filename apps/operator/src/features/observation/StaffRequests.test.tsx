import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRequestRow, StaffRequestsPage } from './requestTypes';

// The confirmation queue's three rules, checked at the UI: a decision is
// final, a refusal must say why, and nobody decides their own request. All
// three are enforced again in migration 0072 — this screen is the courtesy.

const OWNER_ID = 'owner-1';

vi.mock('@tanstack/react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: OWNER_ID, displayName: 'Owner', role: 'owner' } }),
}));
vi.mock('../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), info: vi.fn(), err: vi.fn() }) }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { appRpc } from '../../lib/appRpc';
import { StaffRequestsScreen } from './StaffRequests';

const rpc = vi.mocked(appRpc);

const row = (over: Partial<StaffRequestRow> = {}): StaffRequestRow => ({
  id: 'r1',
  kind: 'leave',
  status: 'pending',
  from_date: '2026-10-01',
  to_date: '2026-10-03',
  amount_iqd: null,
  note: '',
  created_at: '2026-09-01T00:00:00Z',
  decided_at: null,
  decision_note: null,
  staff_id: 'staff-1',
  staff_name: 'Sara',
  staff_role: 'cashier',
  decided_by_name: null,
  ...over,
});

function page(requests: StaffRequestRow[]): StaffRequestsPage {
  return { requests, total: requests.length, pending: requests.filter((r) => r.status === 'pending').length };
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <StaffRequestsScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => rpc.mockReset());

describe('StaffRequestsScreen', () => {
  it('offers approve and decline on someone else’s pending request', async () => {
    rpc.mockResolvedValue(page([row()]));
    renderScreen();
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Decline' })).toBeTruthy();
  });

  it('offers no controls at all on the viewer’s own request', async () => {
    // Not disabled buttons: a disabled control carries no reason, and the row
    // already names who asked.
    rpc.mockResolvedValue(page([row({ staff_id: OWNER_ID, staff_name: 'Owner' })]));
    renderScreen();
    await screen.findByText('Owner');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('offers no way to reverse a decision', async () => {
    rpc.mockResolvedValue(page([row({ status: 'approved', decided_by_name: 'Owner' })]));
    renderScreen();
    await screen.findByText('Approved');
    expect(screen.queryByRole('button', { name: 'Approve' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Decline' })).toBeNull();
  });

  it('will not submit a decline without a reason, and does not call the server', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(page([row()]));
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));

    // Two buttons now read "Decline": the row's and the dialog's. The dialog
    // opens last, so it is the final one in the tree.
    await screen.findByRole('textbox');
    rpc.mockClear();
    await user.click(screen.getAllByRole('button', { name: 'Decline' }).at(-1)!);

    expect(await screen.findByText('A reason is required.')).toBeTruthy();
    expect(rpc).not.toHaveBeenCalledWith('decide_staff_request', expect.anything());
  });

  it('sends the decision with its note once a reason is given', async () => {
    const user = userEvent.setup();
    rpc.mockResolvedValue(page([row()]));
    renderScreen();
    await user.click(await screen.findByRole('button', { name: 'Decline' }));
    await user.type(screen.getByRole('textbox'), 'roster shows otherwise');
    await user.click(screen.getAllByRole('button', { name: 'Decline' }).at(-1)!);

    await waitFor(() =>
      expect(rpc).toHaveBeenCalledWith('decide_staff_request', {
        p_id: 'r1',
        p_approve: false,
        p_note: 'roster shows otherwise',
      }),
    );
  });

  it('states an advance as money and leave as a date range', async () => {
    rpc.mockResolvedValue(
      page([
        row({ id: 'a', kind: 'advance', amount_iqd: 250_000, from_date: null, to_date: null }),
        row({ id: 'b', kind: 'leave' }),
      ]),
    );
    renderScreen();
    expect(await screen.findByText(/250,000/)).toBeTruthy();
    expect(screen.getByText('Wage advance')).toBeTruthy();
    expect(screen.getByText('Leave')).toBeTruthy();
  });
});
