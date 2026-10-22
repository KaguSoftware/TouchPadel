import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LocaleProvider } from '../../../lib/i18n';

// Add a cafe bill (0106) as a stepped wizard: Which bill, then Review, which
// holds "Add to this booking". The bills are a mocked supabase read, the
// booking's bill and the merge are mocked at appRpc, opening the booking's
// bill at mutate().

const tabs = [
  {
    id: 't4',
    label: null,
    opened_at: '2026-10-23T15:40:00.000Z',
    table: { table_number: '4' },
    orders: [{ status: 'open', order_items: [{ voided: false, qty: 4 }, { voided: false, qty: 2 }, { voided: true, qty: 9 }] }],
  },
  { id: 'ali', label: 'Ali group', opened_at: '2026-10-23T16:05:00.000Z', table: null, orders: [] },
];

vi.mock('../../../lib/supabase', () => {
  const chain: Record<string, unknown> = {};
  for (const m of ['select', 'eq', 'is']) chain[m] = () => chain;
  chain.order = async () => ({ data: tabs, error: null });
  return { supabase: { from: () => chain }, supabaseUrl: '', supabaseAnonKey: '' };
});
vi.mock('../../../lib/mutate', () => ({
  mutate: vi.fn(async () => ({ queued: false, localId: '', idempotencyKey: '', result: { tab_id: 'live' } })),
  isElectron: () => false,
}));
vi.mock('../../../lib/appRpc', () => ({
  AppRpcError: class AppRpcError extends Error {
    code = 'UNKNOWN';
  },
  appRpc: vi.fn(async (fn: string) =>
    fn === 'booking_bill'
      ? {
          reservation: {
            id: 'r1',
            kind: 'booking',
            status: 'confirmed',
            price_iqd: 45000,
            guest_name: 'Ali Hassan',
            start_at: '2026-10-23T16:00:00.000Z',
            end_at: '2026-10-23T17:30:00.000Z',
            court_id: 'c1',
            court_name_en: 'Court 1',
            court_name_ar: 'الملعب 1',
          },
        }
      : null,
  ),
}));
const toastOk = vi.fn();
vi.mock('../../../components/toast', () => ({ useToast: () => ({ ok: toastOk, err: vi.fn(), info: vi.fn() }) }));

import { appRpc } from '../../../lib/appRpc';
import { mutate } from '../../../lib/mutate';
import { AddCafeBillDialog, liveItemCount } from './AddCafeBillDialog';

function mount(liveTabId: string | null = null) {
  const onAdded = vi.fn();
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <LocaleProvider>
        <AddCafeBillDialog reservationId="r1" liveTabId={liveTabId} tz="Asia/Baghdad" onClose={vi.fn()} onAdded={onAdded} />
      </LocaleProvider>
    </QueryClientProvider>,
  );
  return { onAdded };
}

beforeEach(() => {
  vi.mocked(appRpc).mockClear();
  vi.mocked(mutate).mockClear();
  toastOk.mockClear();
});

describe('AddCafeBillDialog', () => {
  it('counts the live units on a bill, never a voided one', () => {
    expect(liveItemCount(tabs[0]!)).toBe(6);
  });

  it('holds Which bill until one is chosen, and names the booking it lands on', async () => {
    const user = userEvent.setup();
    mount();
    expect(screen.getByRole('heading', { name: 'Add a cafe bill' })).toBeTruthy();
    expect(await screen.findByText('Court 1 · 7:00 PM · Ali Hassan')).toBeTruthy();
    await screen.findByText('Table 4');
    await user.click(screen.getByTestId('cafeBill.step.review'));
    expect(screen.getByText('Choose a bill first')).toBeTruthy();
    expect(screen.queryByTestId('cafeBill.submit')).toBeNull();
  });

  it('reviews the bill, what moves and the booking, then opens the booking’s bill and merges into it', async () => {
    const user = userEvent.setup();
    const { onAdded } = mount();
    await user.click(await screen.findByRole('option', { name: /Table 4/ }));
    await user.click(screen.getByTestId('cafeBill.step.review'));
    const review = within(document.querySelector('.tp-wiz-review') as HTMLElement);
    expect(review.getByText('Table 4')).toBeTruthy();
    expect(review.getByText('6 items onto this booking')).toBeTruthy();
    expect(review.getByText('Court 1 · 7:00 PM · Ali Hassan')).toBeTruthy();
    expect(screen.getByText("The cafe bill closes. The booking’s bill now holds the court fee and the cafe items.")).toBeTruthy();
    await user.click(screen.getByTestId('cafeBill.submit'));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(mutate).toHaveBeenCalledWith('tab.open', { reservationId: 'r1' });
    expect(appRpc).toHaveBeenCalledWith('merge_tabs', { p_donor_tab_id: 't4', p_survivor_tab_id: 'live' });
    expect(toastOk).toHaveBeenCalledWith('Cafe bill added to the booking.');
  });
});
