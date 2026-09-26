import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ReactNode } from 'react';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../lib/i18n';
import type { StaffRole } from '../../lib/auth';
import type { StaffRow } from './staff/staffModel';
import type * as SettingsModule from '../../lib/settings';

// The landing screen of the Setup section: what in setup will bite a shift,
// then one card per destination with the same role wall as the rail — a card
// is a link to a screen, so a role that may not open the screen may not be
// offered the card.

let role: StaffRole = 'owner';
const data: {
  staff: StaffRow[];
  outbox: { status: 'queued' | 'sent' | 'failed' | 'skipped'; created_at: string }[];
  telegram: { telegram_enabled: boolean; telegram_chat_id: string | null };
  /** Active prepared ingredients with no par level (the ingredients count). */
  noPar: number;
  /** Staff-logged stock lines with no cost (wave 5, the delivery_lines count). */
  needsCost: number;
} = { staff: [], outbox: [], telegram: { telegram_enabled: false, telegram_chat_id: null }, noPar: 0, needsCost: 0 };

const navigate = vi.hoisted(() => vi.fn());
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children, ...rest }: { to: string; children: ReactNode }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigate,
}));
vi.mock('../../lib/supabase', () => {
  const from = (table: string) => {
    const chain: Record<string, unknown> = {};
    chain.select = () => chain;
    chain.order = () => chain;
    chain.is = () => chain;
    if (table === 'ingredients') {
      // Prepared items with no par level: counted after three filters, so the
      // chain itself is what is awaited.
      chain.eq = () => chain;
      chain.then = (ok: (v: unknown) => unknown, fail: (e: unknown) => unknown) => Promise.resolve({ count: data.noPar, error: null }).then(ok, fail);
    } else if (table === 'delivery_lines') {
      // Wave 5: staff additions with no cost, counted after one filter.
      chain.eq = () => Promise.resolve({ count: data.needsCost, error: null });
    } else {
      // Courts and tables are counted (head: true); the outbox is listed.
      chain.eq = () => Promise.resolve({ count: 4, error: null });
    }
    chain.limit = () => Promise.resolve({ data: data.outbox, error: null });
    return chain;
  };
  return { supabase: { from }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async () => data.staff),
}));
vi.mock('../../lib/settings', async (importOriginal) => {
  const actual = await importOriginal<typeof SettingsModule>();
  return {
    ...actual,
    useCafeSettings: () => ({ isSuccess: true, isLoading: false, isError: false, settings: { ...actual.CAFE_SETTING_DEFAULTS, ...data.telegram } }),
  };
});
vi.mock('../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { id: 's1', displayName: 'Owner', role } }),
}));

import { SetupHomeScreen } from './SetupHome';

const person = (over: Partial<StaffRow>): StaffRow => ({ id: 'x', display_name: 'X', role: 'cashier', is_active: true, has_pin: false, ...over });

function renderSetup(as: StaffRole) {
  role = as;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <LocaleProvider>
        <SetupHomeScreen />
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

const check = (key: string) => document.querySelector(`li[data-check="${key}"]`) as HTMLElement | null;

describe('SetupHomeScreen', () => {
  beforeEach(() => {
    data.staff = [person({ id: 'o1', role: 'owner', has_pin: true }), person({ id: 'o2', role: 'owner', has_pin: true })];
    data.outbox = [];
    data.telegram = { telegram_enabled: false, telegram_chat_id: null };
    data.noPar = 0;
    data.needsCost = 0;
  });

  it('offers every setup destination, each with what the screen decides', () => {
    renderSetup('owner');
    expect(screen.getByRole('heading', { name: 'Setup' })).toBeTruthy();
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).toEqual(['/admin/staff', '/admin/branches', '/admin/courts', '/admin/qr', '/admin/settings', '/admin/hero']);
    // The card says more than its rail row could: names alone are not answers.
    expect(screen.getByText(/replace a lost one/)).toBeTruthy();
  });

  it('never offers the section overview a card back to itself', () => {
    renderSetup('owner');
    expect(screen.queryByRole('link', { name: /Overview/ })).toBeNull();
  });

  it('drops a destination the role may not open', () => {
    // Staff is owner-only (ROUTE_ROLES); the rest of /admin is manager's too.
    renderSetup('manager');
    const links = screen.getAllByRole('link').map((a) => a.getAttribute('href'));
    expect(links).not.toContain('/admin/staff');
    expect(links).toContain('/admin/courts');
  });

  it('says plainly when nothing needs attention, and a switched-off Telegram is a choice, not a problem', async () => {
    renderSetup('owner');
    expect(await screen.findByText('Nothing in setup needs attention.')).toBeTruthy();
    expect(check('telegram')).toBeNull();
  });

  it('raises a manager with no PIN and a lone owner, each with the way to fix it', async () => {
    data.staff = [
      person({ id: 'o1', role: 'owner', has_pin: true }),
      person({ id: 'm1', role: 'manager', has_pin: false }),
      person({ id: 'm2', role: 'manager', has_pin: false, is_active: false }),
      person({ id: 'c1', role: 'cashier' }),
    ];
    renderSetup('owner');
    await waitFor(() => expect(check('pins')).toBeTruthy());
    // Only the active manager counts; a cashier holds no PIN at all.
    expect(within(check('pins')!).getByText('1')).toBeTruthy();
    expect(within(check('pins')!).getByRole('button', { name: 'Set PINs' })).toBeTruthy();
    expect(check('owner')).toBeTruthy();
  });

  it('raises anyone who can sign in still on Kitchen, which 0155 retired', async () => {
    data.staff = [
      person({ id: 'o1', role: 'owner', has_pin: true }),
      person({ id: 'o2', role: 'owner', has_pin: true }),
      person({ id: 'p1', role: 'prep' }),
      person({ id: 'p2', role: 'prep' }),
      person({ id: 'p3', role: 'prep', is_active: false }),
      person({ id: 'b1', role: 'barista' }),
    ];
    renderSetup('owner');
    await waitFor(() => expect(check('retiredRole')).toBeTruthy());
    // Someone without access holds nothing that needs moving.
    expect(within(check('retiredRole')!).getByText('2')).toBeTruthy();
    expect(within(check('retiredRole')!).getByText('Accounts still on the retired Kitchen role')).toBeTruthy();
    // An older station reads the new roles as no access, so the update comes first.
    expect(within(check('retiredRole')!).getByText(/^Update every station to the latest version first.*move each one to Barista or Chef/)).toBeTruthy();
    await userEvent.click(within(check('retiredRole')!).getByRole('button', { name: 'Go to Staff' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/staff' });
  });

  it('says nothing about Kitchen once nobody is on it', async () => {
    data.staff = [...data.staff, person({ id: 'p1', role: 'prep', is_active: false }), person({ id: 'c1', role: 'chef' })];
    renderSetup('owner');
    expect(await screen.findByText('Nothing in setup needs attention.')).toBeTruthy();
    expect(check('retiredRole')).toBeNull();
  });

  it('raises prepared items with no par level, which the kitchen is never asked to make', async () => {
    data.noPar = 3;
    renderSetup('owner');
    await waitFor(() => expect(check('noPar')).toBeTruthy());
    expect(within(check('noPar')!).getByText('3')).toBeTruthy();
    expect(within(check('noPar')!).getByText('Prepared items with no par level')).toBeTruthy();
    await userEvent.click(within(check('noPar')!).getByRole('button', { name: 'Open Ingredients' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/stock/ingredients' });
  });

  it('raises staff stock additions with no cost, and sends the owner to Goods in (wave 5)', async () => {
    data.needsCost = 2;
    renderSetup('owner');
    await waitFor(() => expect(check('needsCost')).toBeTruthy());
    expect(within(check('needsCost')!).getByText('2')).toBeTruthy();
    expect(within(check('needsCost')!).getByText('Staff stock additions need a cost')).toBeTruthy();
    await userEvent.click(within(check('needsCost')!).getByRole('button', { name: 'Open Goods in' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/stock/receive' });
  });

  it('raises cashiers and desk staff with no PIN: they close their till shift with a manager’s (wave 5 §5.2)', async () => {
    data.staff = [
      person({ id: 'o1', role: 'owner', has_pin: true }),
      person({ id: 'o2', role: 'owner', has_pin: true }),
      person({ id: 'c1', role: 'cashier' }),
      person({ id: 'c2', role: 'cashier', has_pin: true }),
      person({ id: 'c3', role: 'cashier', is_active: false }),
      person({ id: 'd1', role: 'court_desk' }),
      person({ id: 'b1', role: 'barista' }),
      person({ id: 'm1', role: 'manager', has_pin: false }),
    ];
    renderSetup('owner');
    await waitFor(() => expect(check('shiftNoPin')).toBeTruthy());
    // The active cashier and desk person; a manager without one is the approvals row.
    expect(within(check('shiftNoPin')!).getByText('2')).toBeTruthy();
    expect(within(check('shiftNoPin')!).getByText('Cashiers and desk staff with no PIN')).toBeTruthy();
    expect(check('pins')).toBeTruthy();
    await userEvent.click(within(check('shiftNoPin')!).getByRole('button', { name: 'Go to Staff' }));
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/staff' });
  });

  it('raises Telegram when it is switched on but has no real group', async () => {
    data.telegram = { telegram_enabled: true, telegram_chat_id: '-1001234567890' };
    renderSetup('owner');
    await waitFor(() => expect(check('telegram')).toBeTruthy());
    expect(within(check('telegram')!).getByText(/no staff group is chosen/)).toBeTruthy();
  });

  it('puts one honest live line on the cards it can count', async () => {
    data.staff = [person({ id: 'o1', role: 'owner', has_pin: true }), person({ id: 'o2', role: 'owner', has_pin: true }), person({ id: 'x', is_active: false })];
    renderSetup('owner');
    const staffCard = screen.getAllByRole('link').find((a) => a.getAttribute('href') === '/admin/staff')!;
    await waitFor(() => expect(within(staffCard).getByText('People with access')).toBeTruthy());
    expect(within(staffCard).getByText('2')).toBeTruthy();
  });
});
