import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// The customer record's ban and tags (0449): the desk bans with a reason and
// sees what the customer still has coming; a banned record opens on a banner
// with Lift ban and loses its booking actions; tags are ticked on in one
// window, where a manager also sets them up. A server without 0449 shows
// neither button.

const navigate = vi.fn();
let role = 'manager';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'c1' }),
  useSearch: () => ({}),
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
// Online payments are live in these tests (the paused case is covered in useOnlinePaymentsLive.test.tsx).
vi.mock('../../deposits/useOnlinePaymentsLive', () => ({ useOnlinePaymentsLive: () => true }));
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
vi.mock('../../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'DESK-1',
}));
// The rail's branch is Karrada; Mansour is the other branch a lesson row may name.
vi.mock('../../../lib/venue', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useVenue: () => ({
    venues: [
      { id: 'v1', slug: 'karrada', name_en: 'Karrada', name_ar: 'الكرادة', status: 'open', timezone: 'Asia/Baghdad', phone: null, created_at: '' },
      { id: 'v2', slug: 'mansour', name_en: 'Mansour', name_ar: 'المنصور', status: 'open', timezone: 'Asia/Baghdad', phone: null, created_at: '' },
    ],
    branchId: 'v1',
    current: null,
    stationBranchId: null,
    canSwitch: false,
    setBranch: () => undefined,
  }),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { CustomerRecordScreen } from './CustomerRecord';

const rpc = vi.mocked(appRpc);
const plain = (s: string | null | undefined) => (s ?? '').replace(/[⁦-⁩‎‏]/g, '');
const missing = () => {
  throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
};
/** app.customer_lessons; a server without coaching by default (RPC_MISSING). */
let lessonsRead: () => unknown = missing;
/** app.customer_discount (0342); none by default. */
let discountRead: () => unknown = () => ({ customer_id: 'c1', discount: null });

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
const FAMILY = { id: 't1', name: 'Family', cafe_bp: 1500, court_bp: 1500 };
const REGULAR = { id: 't2', name: 'Regular', cafe_bp: null, court_bp: null };
function rules(over: Record<string, unknown> = {}) {
  return {
    customer_id: 'c1',
    ban: null,
    tags: [],
    effective: null,
    coming: { bookings: 2, seats: 1 },
    is_staff: false,
    catalog: [{ ...FAMILY, members: 4 }, { ...REGULAR, members: 0 }],
    can_manage: true,
    ...over,
  };
}
let rulesRead: () => unknown = () => rules();

function mount() {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'customer_record') return current;
    // The Tickets panel has its own test; here the server has no wallet read.
    if (fn === 'guest_tickets') throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    if (fn === 'customer_lessons') return lessonsRead();
    if (fn === 'customer_discount') return discountRead();
    if (fn === 'customer_ban_and_tags') return rulesRead();
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

/** The dialog on top: a section's own prompt opens over the section's dialog. */
async function topDialog() {
  const all = await screen.findAllByRole('dialog');
  return within(all[all.length - 1]!);
}


beforeEach(() => {
  role = 'court_desk';
  current = record();
  lessonsRead = missing;
  discountRead = () => ({ customer_id: 'c1', discount: null });
  rulesRead = () => rules();
  rpc.mockReset();
  navigate.mockReset();
  localStorage.clear();
});

describe('CustomerRecord ▸ ban (0449)', () => {
  it('the desk bans with a reason, after reading what the customer still has coming', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(await screen.findByTestId('record-ban'));
    const dialog = await topDialog();
    expect(plain(dialog.getByTestId('ban-coming').textContent)).toBe(
      'They still have 2 bookings and 1 match seat coming. Cancel them from each booking if they should not play.',
    );
    await user.click(dialog.getByTestId('ban-confirm'));
    expect(calls('set_customer_ban')).toHaveLength(0);
    expect(dialog.getByText(/reason/i)).toBeTruthy();
    await user.type(dialog.getByTestId('ban-reason'), 'Fought at the bar');
    await user.click(dialog.getByTestId('ban-confirm'));
    await waitFor(() => expect(calls('set_customer_ban')).toHaveLength(1));
    expect(calls('set_customer_ban')[0]![1]).toEqual({ p_customer_id: 'c1', p_banned: true, p_reason: 'Fought at the bar' });
  });

  it('a banned record opens on the banner, loses its booking actions, and lifts with no reason', async () => {
    const user = userEvent.setup();
    current = record({ flags: [{ type: 'ban', label: 'Fought at the bar' }] });
    rulesRead = () => rules({ ban: { reason: 'Fought at the bar', by: { id: 's9', name: 'Ali' }, at: '2026-11-21T10:00:00Z' } });
    mount();
    const banner = await screen.findByTestId('ban-banner');
    expect(plain(banner.textContent)).toContain('Banned from everything');
    expect(plain(banner.textContent)).toContain('Fought at the bar');
    await waitFor(() => expect(plain(banner.textContent)).toContain('By Ali'));
    expect(screen.queryByRole('button', { name: 'New booking' })).toBeNull();
    expect(screen.queryByTestId('record-ban')).toBeNull();
    await user.click(within(banner).getByTestId('ban-lift'));
    const dialog = await topDialog();
    await user.click(dialog.getByRole('button', { name: 'Lift ban' }));
    await waitFor(() => expect(calls('set_customer_ban')).toHaveLength(1));
    expect(calls('set_customer_ban')[0]![1]).toEqual({ p_customer_id: 'c1', p_banned: false, p_reason: null });
  });

  it('a cashier sees the ban but cannot ban or lift', async () => {
    role = 'cashier';
    current = record({ flags: [{ type: 'ban', label: 'Fought' }] });
    mount();
    expect(await screen.findByTestId('ban-banner')).toBeTruthy();
    await screen.findByTestId('record-tags');
    expect(screen.queryByTestId('ban-lift')).toBeNull();
    expect(screen.queryByTestId('record-ban')).toBeNull();
  });

  it('a server without 0449 shows neither Ban nor Tags', async () => {
    rulesRead = missing;
    mount();
    expect(await screen.findByText('Sara Karim')).toBeTruthy();
    await waitFor(() => expect(calls('customer_ban_and_tags').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('record-ban')).toBeNull();
    expect(screen.queryByTestId('record-tags')).toBeNull();
  });
});

describe('CustomerRecord ▸ tags (0449)', () => {
  it('shows the tags beside the name, and the desk ticks one on', async () => {
    const user = userEvent.setup();
    rulesRead = () => rules({ tags: [{ ...REGULAR, set_by: null, set_at: '' }] });
    role = 'court_desk';
    mount();
    expect(await screen.findByText('Regular')).toBeTruthy();
    await user.click(screen.getByTestId('record-tags'));
    const dialog = await topDialog();
    expect(dialog.getByText('15% off everything')).toBeTruthy();
    // The desk does not set tags up.
    expect(dialog.queryByTestId('tag-new')).toBeNull();
    await user.click(dialog.getByTestId('tag-t1'));
    await user.click(dialog.getByTestId('tags-save'));
    await waitFor(() => expect(calls('set_customer_tags')).toHaveLength(1));
    expect(calls('set_customer_tags')[0]![1]).toEqual({ p_customer_id: 'c1', p_tag_ids: ['t2', 't1'] });
  });

  it('a manager makes "Family 15% off everything" from the same window', async () => {
    const user = userEvent.setup();
    role = 'manager';
    rulesRead = () => rules({ catalog: [] });
    mount();
    await user.click(await screen.findByTestId('record-tags'));
    const dialog = await topDialog();
    expect(dialog.getByTestId('tags-empty')).toBeTruthy();
    await user.click(dialog.getByTestId('tag-new'));
    await user.type(dialog.getByTestId('tag-name'), 'Family');
    await user.type(dialog.getByTestId('tag-cafe'), '15');
    await user.click(dialog.getByTestId('tag-form-save'));
    await waitFor(() => expect(calls('save_customer_tag')).toHaveLength(1));
    expect(calls('save_customer_tag')[0]![1]).toEqual({ p_tag_id: null, p_name: 'Family', p_cafe_bp: 1500, p_court_bp: 1500 });
  });

  it('refuses a percent out of range before asking the server', async () => {
    const user = userEvent.setup();
    role = 'owner';
    mount();
    await user.click(await screen.findByTestId('record-tags'));
    const dialog = await topDialog();
    await user.click(dialog.getByTestId('tag-new'));
    await user.type(dialog.getByTestId('tag-name'), 'Too much');
    await user.type(dialog.getByTestId('tag-cafe'), '150');
    await user.click(dialog.getByTestId('tag-form-save'));
    expect(dialog.getByText('A percent is between 0.01 and 100.')).toBeTruthy();
    expect(calls('save_customer_tag')).toHaveLength(0);
  });
});
