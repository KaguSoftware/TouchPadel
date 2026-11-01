import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import type { OfflineTab } from '../../lib/offlineTabs';
import { taxContextFrom } from './tabTotals';

// The offline tab's own panel (ported from fix/offline-signals 59b8c083, plus
// the in-window race the branch missed): a settle that is QUEUED keeps the tab
// on the plan under the settle's own key; one that ACKED inside mutate()'s
// wait has already fired its result, so the panel retires the tab itself. A
// settled tab is never offered Card or Cash again.
//
// F-06 / F-09 / F-32 / F-05: the money goes through the payment pane (amount
// shown, confirmed with a press) and carries the amount as the expectation;
// a discount is offered and its PIN checked on the station; unsent basket
// lines are asked about first; a settle refused at replay comes back as a row
// to take again or resolve.

const h = vi.hoisted(() => ({
  tab: null as OfflineTab | null,
  outcome: { queued: true, localId: 'l', idempotencyKey: 'TILL1:tab.settle:S', result: null } as {
    queued: boolean;
    localId: string;
    idempotencyKey: string;
    result: unknown;
  },
  markOfflineSettled: vi.fn(),
  removeOfflineTab: vi.fn(),
  appendOfflineAdjustment: vi.fn(),
  mutate: vi.fn(),
  pinOk: true,
  resolveRefusedRow: vi.fn(async () => {}),
}));

vi.mock('../../lib/offlineTabs', () => ({
  getOfflineTab: () => h.tab,
  markOfflineSettled: h.markOfflineSettled,
  removeOfflineTab: h.removeOfflineTab,
  appendOfflineAdjustment: h.appendOfflineAdjustment,
}));
vi.mock('../../lib/mutate', () => ({
  mutate: (...args: unknown[]) => {
    h.mutate(...args);
    return Promise.resolve(h.outcome);
  },
}));
vi.mock('../../lib/offlinePin', () => ({
  assertManagerPinOffline: async () => {
    if (!h.pinOk) {
      const { AppRpcError } = await import('../../lib/appRpc');
      throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
    }
  },
}));
vi.mock('./useTaxContext', () => ({ useTaxContext: () => taxContextFrom([{ id: 'cat-drinks', tax_group: { id: 'g', rate_bp: 0, is_active: true } }], false) }));
vi.mock('./refusedSettle', () => ({ resolveRefusedRow: (...a: unknown[]) => h.resolveRefusedRow(...(a as [])) }));

import { OfflineTabPanel } from './OfflineTabPanel';

const KEY = 'TILL1:tab.open:01J0000000000000000000000A';

const base: OfflineTab = {
  idemKey: KEY,
  localId: 'l1',
  label: null,
  tableNumber: '3',
  openedAt: '',
  lines: [{ name: 'Latte', qty: 1, priceIqd: 5000, categoryId: 'cat-drinks' }],
  settled: false,
};

function mount(onSettled = vi.fn(), unsentCount = 0) {
  render(
    <LocaleProvider>
      <OfflineTabPanel idemKey={KEY} onSettled={onSettled} unsentCount={unsentCount} />
    </LocaleProvider>,
  );
  return onSettled;
}

async function payByCard() {
  await userEvent.click(screen.getByRole('button', { name: 'Card' }));
  const dialog = within(await screen.findByRole('dialog'));
  // The pane states the amount before anything is recorded.
  expect(dialog.getAllByText(/5,000/).length).toBeGreaterThan(0);
  await userEvent.click(dialog.getByRole('button', { name: 'Record payment' }));
}

beforeEach(() => {
  h.tab = { ...base };
  h.outcome = { queued: true, localId: 'l', idempotencyKey: 'TILL1:tab.settle:S', result: null };
  h.markOfflineSettled.mockReset();
  h.removeOfflineTab.mockReset();
  h.appendOfflineAdjustment.mockReset();
  h.mutate.mockReset();
  h.resolveRefusedRow.mockReset();
  h.pinOk = true;
});

describe('OfflineTabPanel', () => {
  it('Card opens a confirm step with the amount; nothing is recorded by the first tap', async () => {
    mount();
    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    expect(await screen.findByRole('dialog')).toBeTruthy();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it("a queued settle carries the amount shown as the expectation and marks the tab settled under the settle's own key", async () => {
    h.outcome = { queued: true, localId: 'l', idempotencyKey: 'TILL1:tab.settle:Q', result: null };
    const onSettled = mount();
    await payByCard();
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(h.mutate).toHaveBeenCalledWith('tab.settle', { tabIdemKey: KEY, method: 'card', amountIqd: 5000, expectedTotalIqd: 5000 });
    expect(h.markOfflineSettled).toHaveBeenCalledWith(KEY, 'TILL1:tab.settle:Q', { method: 'card', amountIqd: 5000, tenderedIqd: null });
    expect(h.removeOfflineTab).not.toHaveBeenCalled();
  });

  it('cash takes the tender and shows the change before it is recorded', async () => {
    const onSettled = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Cash' }));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByRole('textbox', { name: 'Tendered' }), '10000');
    expect(dialog.getByRole('status').textContent).toMatch(/5,000/);
    await userEvent.click(dialog.getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(h.mutate).toHaveBeenCalledWith('tab.settle', { tabIdemKey: KEY, method: 'cash', amountIqd: 5000, expectedTotalIqd: 5000, tenderedIqd: 10000 });
  });

  it('a settle that acked inside the wait retires the tab here, since its result has already gone by', async () => {
    h.outcome = { queued: false, localId: 'l', idempotencyKey: 'TILL1:tab.settle:F', result: { status: 'settled' } };
    const onSettled = mount();
    await payByCard();
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(h.removeOfflineTab).toHaveBeenCalledWith(KEY);
    expect(h.markOfflineSettled).not.toHaveBeenCalled();
  });

  it('the estimate includes a discount queued on the tab, and is what is charged', async () => {
    h.tab = { ...base, adjustments: [{ kind: 'discount_amount', value: 1000, amountIqd: 1000, idemKey: 'A' }] };
    mount();
    expect(screen.getByTestId('offline-discount-row').textContent).toMatch(/1,000/);
    expect(screen.getByTestId('offline-total').textContent).toMatch(/4,000/);
    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledWith('tab.settle', expect.objectContaining({ amountIqd: 4000, expectedTotalIqd: 4000 })));
  });

  it('unsent basket lines are asked about first; paying needs the acknowledgement', async () => {
    mount(vi.fn(), 2);
    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    const guard = within(await screen.findByRole('dialog'));
    expect(guard.getByText(/They are not on this bill/)).toBeTruthy();
    const payAnyway = guard.getByTestId('unsent-pay-anyway');
    expect((payAnyway as HTMLButtonElement).disabled).toBe(true);
    await userEvent.click(guard.getByTestId('unsent-ack'));
    await userEvent.click(payAnyway);
    expect(await screen.findByRole('button', { name: 'Record payment' })).toBeTruthy();
    expect(h.mutate).not.toHaveBeenCalled();
  });

  it('discount is always offered: offline a wrong PIN is refused on the spot and nothing is queued', async () => {
    h.pinOk = false;
    mount();
    await userEvent.click(screen.getByTestId('offline-discount'));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Manager PIN'), '1234');
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm' }));
    expect(await dialog.findByText('Incorrect PIN.')).toBeTruthy();
    expect(h.mutate).not.toHaveBeenCalled();
    expect(h.appendOfflineAdjustment).not.toHaveBeenCalled();
  });

  it('a right PIN queues adjustment.apply against the tab.open key and records what it takes off', async () => {
    h.outcome = { queued: true, localId: 'l', idempotencyKey: 'TILL1:adjustment.apply:D', result: null };
    mount();
    await userEvent.click(screen.getByTestId('offline-discount'));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText('Manager PIN'), '1234');
    await userEvent.click(dialog.getByRole('button', { name: 'Confirm' }));
    await waitFor(() => expect(h.appendOfflineAdjustment).toHaveBeenCalled());
    expect(h.mutate).toHaveBeenCalledWith('adjustment.apply', expect.objectContaining({ kind: 'discount_percent', tabIdemKey: KEY, value: 1000, pin: '1234' }));
    expect(h.appendOfflineAdjustment).toHaveBeenCalledWith(KEY, { kind: 'discount_percent', value: 1000, amountIqd: 500, idemKey: 'TILL1:adjustment.apply:D' });
  });

  it('a settled tab is read-only: no second Card or Cash', () => {
    h.tab = { ...base, settled: true, settleIdemKey: 'TILL1:tab.settle:Q' };
    mount();
    expect(screen.getByText('Settled — waiting to reach the server')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Card' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Cash' })).toBeNull();
  });

  it('a refused tab says so, takes no payment, and can be taken off this till', async () => {
    h.tab = { ...base, failure: { state: 'failed', error: '400: FORBIDDEN' } };
    mount();
    expect(screen.getByText('Did not sync — see Day close')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Card' })).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Remove from this café cashier' }));
    expect(h.removeOfflineTab).toHaveBeenCalledWith(KEY);
  });

  it('a settle refused at replay comes back with the server total, to take again at that figure', async () => {
    h.tab = {
      ...base,
      settled: true,
      settleIdemKey: 'TILL1:tab.settle:R',
      settle: { method: 'card', amountIqd: 5000, tenderedIqd: null },
      failure: { state: 'failed', on: 'settle', code: 'TOTAL_CHANGED', serverTotalIqd: 5500, settleIdemKey: 'TILL1:tab.settle:R' },
    };
    h.outcome = { queued: true, localId: 'l', idempotencyKey: 'TILL1:tab.settle:R2', result: null };
    mount();
    const row = screen.getByTestId('offline-settle-refused');
    expect(row.textContent).toMatch(/5,500/);
    await userEvent.click(screen.getByTestId('offline-settle-retry'));
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Record payment' }));
    await waitFor(() => expect(h.mutate).toHaveBeenCalledWith('tab.settle', { tabIdemKey: KEY, method: 'card', amountIqd: 5500, expectedTotalIqd: 5500 }));
    expect(h.markOfflineSettled).toHaveBeenCalledWith(KEY, 'TILL1:tab.settle:R2', { method: 'card', amountIqd: 5500, tenderedIqd: null });
  });

  it('or a manager resolves the refused row with a PIN, and the entry leaves this till', async () => {
    h.tab = {
      ...base,
      settled: true,
      settleIdemKey: 'TILL1:tab.settle:R',
      settle: { method: 'cash', amountIqd: 5000, tenderedIqd: 5000 },
      failure: { state: 'failed', on: 'settle', code: 'TENDER_SHORT', serverTotalIqd: null, settleIdemKey: 'TILL1:tab.settle:R' },
    };
    const onSettled = mount();
    await userEvent.click(screen.getByTestId('offline-settle-resolve'));
    const dialog = within(await screen.findByRole('dialog'));
    await userEvent.type(dialog.getByLabelText(/PIN/), '4321');
    await userEvent.click(dialog.getByRole('button', { name: /Authori[sz]e|Confirm/ }));
    await waitFor(() => expect(h.resolveRefusedRow).toHaveBeenCalledWith('TILL1:tab.settle:R', '4321'));
    expect(h.removeOfflineTab).toHaveBeenCalledWith(KEY);
    expect(onSettled).toHaveBeenCalled();
  });
});
