import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';
import { ConfirmProvider } from '../../../components/ConfirmDialog';

// Setup › Branches, Close (coaching operator.md §5.7, §5.19, §5.21; R37): a
// branch with coaching money to settle refuses BRANCH_HAS_BOOKINGS
// `coaching_money`, and the refusal reads its own line, beside the button and
// in the toast; any other refusal keeps its shared line.

const toast = vi.hoisted(() => ({ ok: vi.fn(), err: vi.fn(), info: vi.fn() }));

const BRANCH = {
  id: 'v1',
  slug: 'karrada',
  name_en: 'Karrada',
  name_ar: 'الكرادة',
  status: 'open',
  timezone: 'Asia/Baghdad',
  phone: null,
  address_en: null,
  address_ar: null,
  created_at: '2026-01-01T00:00:00Z',
};

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children }: { children: ReactNode }) => <a href="#">{children}</a>,
}));
vi.mock('../../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.order = () => Promise.resolve({ data: [BRANCH], error: null });
  return { supabase: { from: () => chain }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../../components/toast', () => ({ useToast: () => toast }));
vi.mock('../../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(),
}));

import { AppRpcError, appRpc } from '../../../lib/appRpc';
import { BranchesAdmin } from './BranchesAdmin';

const rpc = vi.mocked(appRpc);
let closeAnswer: () => unknown;

function mount() {
  rpc.mockImplementation(async (fn: string) => {
    if (fn === 'branch_readiness') return [{ key: 'manager', required: true, ok: true }];
    if (fn === 'close_branch') return closeAnswer();
    return {};
  });
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <ConfirmProvider>
          <BranchesAdmin />
        </ConfirmProvider>
      </LocaleProvider>
    </QueryClientProvider>,
  );
}

async function close(user: ReturnType<typeof userEvent.setup>) {
  // An open branch is not picked for you: choose it in the list first.
  await user.click(await screen.findByRole('button', { name: /Karrada/ }));
  await user.click(await screen.findByRole('button', { name: 'Close branch' }));
  await user.click(
    within(await screen.findByRole('dialog', { name: 'Close branch' })).getByRole('button', {
      name: 'Confirm',
    }),
  );
}

const COACHING_MONEY =
  'This branch still has coach statements to approve or pay, a month not drafted yet, or lesson money to refund at the desk. Settle them in Coach pay and Ops first.';

beforeEach(() => {
  rpc.mockReset();
  toast.err.mockReset();
  toast.ok.mockReset();
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
  });
});
