import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LocaleProvider } from '../../lib/i18n';
import type { OfflineTab } from '../../lib/offlineTabs';

// The offline tab's own panel (ported from fix/offline-signals 59b8c083, plus
// the in-window race the branch missed): a settle that is QUEUED keeps the tab
// on the plan under the settle's own key; one that ACKED inside mutate()'s
// wait has already fired its result, so the panel retires the tab itself. A
// settled tab is never offered Card or Cash again.

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
  mutate: vi.fn(),
}));

vi.mock('../../lib/offlineTabs', () => ({
  getOfflineTab: () => h.tab,
  markOfflineSettled: h.markOfflineSettled,
  removeOfflineTab: h.removeOfflineTab,
}));
vi.mock('../../lib/mutate', () => ({
  mutate: (...args: unknown[]) => {
    h.mutate(...args);
    return Promise.resolve(h.outcome);
  },
}));

import { OfflineTabPanel } from './OfflineTabPanel';

const base: OfflineTab = {
  idemKey: 'k1',
  localId: 'l1',
  label: null,
  tableNumber: '3',
  openedAt: '',
  lines: [{ name: 'Latte', qty: 1, priceIqd: 5000 }],
  settled: false,
};

function mount(onSettled = vi.fn()) {
  render(
    <LocaleProvider>
      <OfflineTabPanel idemKey="k1" onSettled={onSettled} />
    </LocaleProvider>,
  );
  return onSettled;
}

beforeEach(() => {
  h.tab = { ...base };
  h.markOfflineSettled.mockReset();
  h.removeOfflineTab.mockReset();
  h.mutate.mockReset();
});

describe('OfflineTabPanel', () => {
  it("a queued settle marks the tab settled under the settle's own key", async () => {
    h.outcome = { queued: true, localId: 'l', idempotencyKey: 'TILL1:tab.settle:Q', result: null };
    const onSettled = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(h.mutate).toHaveBeenCalledWith(
      'tab.settle',
      expect.objectContaining({ tabIdemKey: 'k1', method: 'card' }),
    );
    expect(h.markOfflineSettled).toHaveBeenCalledWith('k1', 'TILL1:tab.settle:Q');
    expect(h.removeOfflineTab).not.toHaveBeenCalled();
  });

  it('a settle that acked inside the wait retires the tab here, since its result has already gone by', async () => {
    h.outcome = {
      queued: false,
      localId: 'l',
      idempotencyKey: 'TILL1:tab.settle:F',
      result: { status: 'settled' },
    };
    const onSettled = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Card' }));
    await waitFor(() => expect(onSettled).toHaveBeenCalled());
    expect(h.removeOfflineTab).toHaveBeenCalledWith('k1');
    expect(h.markOfflineSettled).not.toHaveBeenCalled();
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
    await userEvent.click(screen.getByRole('button', { name: 'Remove from this till' }));
    expect(h.removeOfflineTab).toHaveBeenCalledWith('k1');
  });
});
