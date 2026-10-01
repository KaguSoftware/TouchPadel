import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// The customer record's open-match block (operator.md §5.15): the no-show
// count names its match part, "Plays as" says who set it and is changed in
// two choices, and the ban is a manager's (R35: a code and an optional note,
// sent as `<code>: <note>`; lifting sends no reason). A server before 0262
// (no gender, no matches) shows none of it.

const navigate = vi.fn();
let role = 'manager';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'c1' }),
  useSearch: () => ({}),
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('../../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Staff', role } }),
}));
vi.mock('../../../lib/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchVenueSettings: async () => ({ timezone: 'Asia/Baghdad' }),
  fetchActiveCourts: async () => [],
}));
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }) }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { CustomerRecordScreen } from './CustomerRecord';

const rpc = vi.mocked(appRpc);

function record(over: Record<string, unknown> = {}, customer: Record<string, unknown> = {}) {
  return {
    customer: { id: 'c1', full_name: 'Sara Karim', phone: '+9647700000000', email: null, preferred_lang: 'ar', gender: 'female', gender_set_by: 'guest', ...customer },
    flags: [],
    counts: { bookings: 4, cancellations: 0, noShows: 3, cafeOrders: 0, matchesPlayed: 7, matchNoShows: 1, lateLeaves: 1 },
    upcoming: [],
    history: [],
    cafeOrders: [],
    notes: [],
    series: [],
    matches: [],
    ...over,
  };
}

let current: unknown = record();

function mount() {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'customer_record') return current;
    // The Tickets panel has its own test; here the server has no wallet read.
    if (fn === 'guest_tickets') throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    return {};
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <CustomerRecordScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const calls = (fn: string) => rpc.mock.calls.filter(([name]) => name === fn);

beforeEach(() => {
  role = 'manager';
  current = record();
  rpc.mockReset();
  navigate.mockReset();
});

describe('CustomerRecord ▸ open matches', () => {
  it('counts seat no-shows inside the no-show count, and shows matches played and late leaves', async () => {
    mount();
    expect(await screen.findByText('3 (open matches 1)')).toBeTruthy();
    expect(screen.getByText('Open matches played')).toBeTruthy();
    expect(screen.getByText('Late leaves')).toBeTruthy();
    expect(within(screen.getByTestId('customer-matches')).getByTestId('plays-as').textContent).toBe('Woman · set by the guest');
  });

  it('Change sends the other gender through staff_set_customer_gender', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Change' }));
    const dialog = within(await screen.findByRole('dialog'));
    const save = dialog.getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    // The current choice is no change.
    expect(save.disabled).toBe(true);
    await user.click(dialog.getByText('Man'));
    await user.click(save);
    await waitFor(() => expect(calls('staff_set_customer_gender')).toHaveLength(1));
    expect(calls('staff_set_customer_gender')[0]![1]).toEqual({ p_customer_id: 'c1', p_gender: 'male' });
  });

  it('a manager bans with a code and an optional note, sent as `<code>: <note>`', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByRole('button', { name: 'Ban from open matches' }));
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/Applies at every branch/)).toBeTruthy();
    await user.click(dialog.getByText('Repeated no-shows'));
    await user.type(dialog.getByRole('textbox'), 'three in a month');
    await user.click(dialog.getByRole('button', { name: 'Continue' }));
    await waitFor(() => expect(calls('set_match_ban')).toHaveLength(1));
    expect(calls('set_match_ban')[0]![1]).toEqual({ p_customer_id: 'c1', p_banned: true, p_reason: 'no_shows: three in a month' });
  });

  it('a banned customer: the badge, and Lift sends no reason', async () => {
    const user = userEvent.setup();
    current = record({ flags: [{ type: 'match_ban', label: 'reported' }] });
    mount();
    expect(await screen.findByText(/Banned from open matches/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Lift ban' }));
    await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Lift ban' }));
    await waitFor(() => expect(calls('set_match_ban')).toHaveLength(1));
    expect(calls('set_match_ban')[0]![1]).toEqual({ p_customer_id: 'c1', p_banned: false, p_reason: null });
    // The desk's flag editor still counts no flags of its own.
    expect(screen.getByRole('button', { name: 'Add a flag' })).toBeTruthy();
  });

  it('court_desk runs matches but cannot ban', async () => {
    role = 'court_desk';
    mount();
    expect(await screen.findByTestId('customer-matches')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Ban from open matches' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Start an open match' })).toBeTruthy();
  });

  it('a server before 0262 shows no open-match block', async () => {
    const { matches: _gone, ...old } = record();
    current = { ...old, customer: { id: 'c1', full_name: 'Sara Karim', phone: null, email: null, preferred_lang: 'ar' } };
    mount();
    expect(await screen.findByText('Sara Karim', { selector: 'h1' })).toBeTruthy();
    expect(screen.queryByTestId('customer-matches')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Start an open match' })).toBeNull();
  });
});
