import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

// Settings › Branches. Opening a branch in the list switches to it and lands
// on its Branch details, where Close sits (coaching operator.md §5.7, §5.19,
// §5.21; R37): a branch with coaching money to settle refuses
// BRANCH_HAS_BOOKINGS `coaching_money`, and the refusal reads its own line,
// beside the button and in the toast; any other refusal keeps its shared line.

const toast = vi.hoisted(() => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }));
const navigate = vi.hoisted(() => vi.fn());
const venue = vi.hoisted(() => ({ branchId: 'v1' as string | null, canSwitch: true, setBranch: vi.fn(), venues: [] as { id: string }[] }));
const who = vi.hoisted(() => ({ role: 'owner' }));

const BRANCH = {
  id: 'v1',
  slug: 'karrada',
  name_en: 'Karrada',
  name_ar: 'الكرادة',
  status: 'open',
  timezone: 'Asia/Baghdad',
  phone: null as string | null,
  address_en: null as string | null,
  address_ar: null as string | null,
  created_at: '2026-01-01T00:00:00Z',
};
const data = vi.hoisted(() => ({ branches: [] as Record<string, unknown>[], readiness: [] as { key: string; required: boolean; ok: boolean }[] }));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigate,
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('../../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.order = () => Promise.resolve({ data: data.branches, error: null });
  return { supabase: { from: () => chain }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../../lib/auth', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAuth: () => ({ staff: { role: who.role } }),
}));
vi.mock('../../../lib/venue', () => ({ useVenue: () => venue }));
vi.mock('../../../components/toast', () => ({ useToast: () => toast }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { BranchDetails, BranchesAdmin } from './BranchesAdmin';

const rpc = vi.mocked(appRpc);
let closeAnswer: () => unknown;

function mount(screenUnderTest: ReactNode = <BranchDetails><p>The venue</p></BranchDetails>) {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'branch_readiness') return data.readiness;
    if (fn === 'branch_counts') return [{ venue_id: 'v1', courts: 6, tables: 18 }];
    if (fn === 'close_branch') return closeAnswer();
    return {};
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <ConfirmProvider>
          {screenUnderTest}
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function close(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole('button', { name: 'Close branch' }));
  await user.click(
    within(await screen.findByRole('dialog', { name: 'Close branch' })).getByRole('button', {
      name: 'Confirm',
    }),
  );
}

const COACHING_MONEY =
  'This branch still has coach statements to approve or pay, a month or a pay adjustment not drafted yet, or lesson money still to refund or being refunded. Settle them in Coach pay and Ops first.';

beforeEach(() => {
  data.branches = [BRANCH];
  data.readiness = [{ key: 'manager', required: true, ok: true }];
  venue.branchId = 'v1';
  venue.canSwitch = true;
  venue.setBranch.mockReset();
  venue.venues = [];
  who.role = 'owner';
  navigate.mockReset();
  rpc.mockReset();
  toast.err.mockReset();
  toast.ok.mockReset();
});

describe('BranchesAdmin ▸ the list', () => {
  it('opening a branch switches to it and lands on its branch details', async () => {
    const user = userEvent.setup();
    venue.branchId = 'v0';
    mount(<BranchesAdmin />);
    await user.click(await screen.findByRole('button', { name: /Karrada/ }));
    expect(venue.setBranch).toHaveBeenCalledWith('v1');
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/settings' });
  });

  it('a manager sees only the branches they work at, and opens no new one', async () => {
    who.role = 'manager';
    venue.venues = [{ id: 'v1' }];
    mount(<BranchesAdmin />);
    expect(await screen.findByRole('button', { name: /Karrada/ })).toBeTruthy();
    expect(screen.queryByTestId('branches-open-new')).toBeNull();
  });

  it('a manager on branch details gets the way back, not Open or Close', async () => {
    who.role = 'manager';
    mount();
    expect(await screen.findByTestId('branch-details-back')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Close branch' })).toBeNull();
  });

  it('a station cannot open another branch', async () => {
    venue.branchId = 'v0';
    venue.canSwitch = false;
    mount(<BranchesAdmin />);
    expect(((await screen.findByRole('button', { name: /Karrada/ })) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('BranchesAdmin ▸ the cards', () => {
  it("counts each branch's courts and café tables, and marks the one shown now", async () => {
    mount(<BranchesAdmin />);
    const card = within(await screen.findByTestId('branch-card-karrada'));
    expect(await card.findByText('6')).toBeTruthy();
    expect(card.getByText('18')).toBeTruthy();
    expect(card.getByText('Courts')).toBeTruthy();
    expect(card.getByText('Café tables')).toBeTruthy();
    expect(card.getByText('Showing now')).toBeTruthy();
    expect(card.getByText('Branch details')).toBeTruthy();
  });

  it('lists a closed branch under the cards, and the filter narrows both', async () => {
    const user = userEvent.setup();
    data.branches = [BRANCH, { ...BRANCH, id: 'v2', slug: 'zayouna', name_en: 'Zayouna', status: 'closed', created_at: '2026-02-01T00:00:00Z' }];
    mount(<BranchesAdmin />);
    const closed = within(await screen.findByTestId('branches-closed'));
    expect(closed.getByRole('heading', { name: 'Closed branches' })).toBeTruthy();
    expect(closed.getByText('Zayouna')).toBeTruthy();
    await user.click(screen.getByTestId('branches-filter-open'));
    expect(screen.queryByTestId('branches-closed')).toBeNull();
    await user.click(screen.getByTestId('branches-filter-closed'));
    expect(screen.queryByTestId('branch-card-karrada')).toBeNull();
    expect(screen.getByTestId('branches-closed')).toBeTruthy();
  });
});

describe('BranchesAdmin ▸ Branch details', () => {
  it('a preparing branch shows its checklist, what is left, and Open stays shut until it is done', async () => {
    data.branches = [{ ...BRANCH, status: 'preparing' }];
    data.readiness = [
      { key: 'courts_and_rates', required: true, ok: true },
      { key: 'manager', required: true, ok: false },
      { key: 'telegram', required: false, ok: false },
    ];
    mount();
    expect(await screen.findByRole('heading', { level: 1, name: 'Karrada' })).toBeTruthy();
    expect(await screen.findByText(/required step left\./)).toBeTruthy();
    expect(screen.getByText('1 of 3 done')).toBeTruthy();
    const list = within(screen.getByTestId('branch-readiness'));
    expect(list.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
      expect.stringContaining('A manager works here'),
      expect.stringContaining('A Telegram group for alerts'),
      expect.stringContaining('A court with a rate'),
    ]);
    expect(list.getAllByRole('button', { name: /Fix/ })).toHaveLength(2);
    expect(list.getByText('Done')).toBeTruthy();
    expect((screen.getByTestId('branch-open-to-guests') as HTMLButtonElement).disabled).toBe(true);
  });

  it('an open branch shows no checklist and no Open button', async () => {
    mount();
    expect(await screen.findByRole('heading', { level: 1, name: 'Karrada' })).toBeTruthy();
    expect(screen.queryByTestId('branch-readiness')).toBeNull();
    expect(screen.queryByTestId('branch-open-to-guests')).toBeNull();
    expect(screen.getByText('The venue')).toBeTruthy();
  });
});

describe('BranchesAdmin ▸ Close', () => {
  it('BRANCH_HAS_BOOKINGS coaching_money reads its own line, beside the button and in the toast (R37)', async () => {
    const user = userEvent.setup();
    closeAnswer = () => {
      throw new AppRpcError(
        'BRANCH_HAS_BOOKINGS',
        'BRANCH_HAS_BOOKINGS',
        undefined,
        'coaching_money',
      );
    };
    mount();
    await close(user);
    expect(await screen.findByText(COACHING_MONEY)).toBeTruthy();
    expect(toast.err).toHaveBeenCalledWith(COACHING_MONEY);
  });

  it('BRANCH_HAS_BOOKINGS with no detail keeps the shared line', async () => {
    const user = userEvent.setup();
    closeAnswer = () => {
      throw new AppRpcError('BRANCH_HAS_BOOKINGS', 'BRANCH_HAS_BOOKINGS');
    };
    mount();
    await close(user);
    await waitFor(() => expect(toast.err).toHaveBeenCalled());
    expect(toast.err.mock.calls[0]![0]).not.toBe(COACHING_MONEY);
    expect(screen.queryByText(COACHING_MONEY)).toBeNull();
  });

  it('a close that goes through says so', async () => {
    const user = userEvent.setup();
    closeAnswer = () => ({});
    mount();
    await close(user);
    await waitFor(() => expect(toast.ok).toHaveBeenCalledWith('Karrada is closed.'));
    expect(navigate).toHaveBeenCalledWith({ to: '/admin/branches' });
  });
});

describe('BranchesAdmin ▸ Open a new branch, stepped', () => {
  it('fills the short name from the English name, copies the picked branch, and says what was copied', async () => {
    const user = userEvent.setup();
    mount(<BranchesAdmin />);
    rpc.mockImplementation(async (fn: string) =>
      fn === 'create_branch' ? { venue_id: 'v9', counts: { courts: 2, menu_items: 64, cafe_tables: 12 } } : {},
    );
    await user.click(await screen.findByTestId('branches-open-new'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Open a new branch' }));
    await user.click(dialog.getByTestId('branch-create.step.review'));
    expect(dialog.getByText('Type the name in both languages, 2 to 80 characters each.')).toBeTruthy();
    await user.type(dialog.getByRole('textbox', { name: 'Name (English)' }), 'Al Mansour');
    await user.type(dialog.getByRole('textbox', { name: 'Name (Arabic)' }), 'المنصور');
    expect((dialog.getByTestId('branch-slug') as HTMLInputElement).value).toBe('al-mansour');
    await user.click(dialog.getByTestId('branch-create.step.copy'));
    expect(dialog.getByTestId('branch-create.source.karrada').getAttribute('aria-pressed')).toBe('true');
    await user.click(dialog.getByTestId('branch-create.step.review'));
    expect(dialog.getByText('al-mansour')).toBeTruthy();
    await user.click(dialog.getByTestId('branch-create.submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_branch', expect.objectContaining({ p_source_venue: 'v1', p_slug: 'al-mansour', p_name_en: 'Al Mansour' })));
    await waitFor(() => expect(toast.ok).toHaveBeenCalledWith('Al Mansour is ready to set up.'));
    expect(toast.info).toHaveBeenCalledWith('Copied: 2 courts, 64 menu items, 12 tables.');
  });

  it('picks the timezone by continent, then country, then city, or by search', async () => {
    const user = userEvent.setup();
    mount(<BranchesAdmin />);
    rpc.mockImplementation(async (fn: string) => (fn === 'create_branch' ? { venue_id: 'v9', counts: {} } : {}));
    await user.click(await screen.findByTestId('branches-open-new'));
    const dialog = within(await screen.findByRole('dialog', { name: 'Open a new branch' }));
    await user.type(dialog.getByRole('textbox', { name: 'Name (English)' }), 'Al Mansour');
    await user.type(dialog.getByRole('textbox', { name: 'Name (Arabic)' }), 'المنصور');
    await user.click(dialog.getByTestId('branch-create.step.contact'));

    // It starts on the copied branch's timezone.
    const field = dialog.getByTestId('branch-create.timezone');
    expect(field.textContent).toContain('Asia › Iraq › Baghdad');

    await user.click(field);
    const panel = within(await screen.findByRole('dialog', { name: 'Timezone' }));
    await user.click(panel.getByRole('option', { name: /Europe/ }));
    await user.click(panel.getByRole('option', { name: /Germany/ }));
    await user.click(panel.getByRole('option', { name: /Berlin/ }));
    expect(field.textContent).toContain('Europe › Germany › Berlin');

    await user.click(field);
    const again = within(await screen.findByRole('dialog', { name: 'Timezone' }));
    await user.type(again.getByPlaceholderText('Or search a city or country'), 'dubai');
    await user.click(again.getByRole('option', { name: /Dubai/ }));
    expect(field.textContent).toContain('Dubai');

    await user.click(dialog.getByTestId('branch-create.step.review'));
    await user.click(dialog.getByTestId('branch-create.submit'));
    await waitFor(() => expect(rpc).toHaveBeenCalledWith('create_branch', expect.objectContaining({ p_timezone: 'Asia/Dubai' })));
  });
});
