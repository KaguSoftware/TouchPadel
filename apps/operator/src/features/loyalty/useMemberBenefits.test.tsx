import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TabBenefits } from '@touch/core/loyalty';

// What the member's card gives on a bill (0410): the read degrades to nothing on a server
// without the RPC, and the free add-ons are refreshed by themselves: once per state, never a
// loop, again when the bill's lines change, silent when the server refuses or fails.

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async () => ({})),
}));
vi.mock('../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'TILL-1',
}));

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { LOYALTY_KEYS, useAutoTierPerks, useMemberBenefits } from './useLoyalty';

const rpc = vi.mocked(appRpc);

const needs: TabBenefits = {
  tab_id: 't1',
  customer_id: 'p1',
  enabled: true,
  tier: { id: 'g', name_en: 'Gold', name_ar: 'ذهبي', multiplier: 1.5, color: 'gold' },
  perks: [{ id: 'k1', kind: 'free_addons', name_en: 'Free add-ons', name_ar: 'إضافات مجانية', tier_id: 'g', tier_name_en: 'Gold', tier_name_ar: 'ذهبي', tier_color: 'gold' }],
  addons: { on_bill_iqd: 0, due_iqd: 1500, needs_refresh: true },
  deal: null,
};

function wrap(qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return { qc, wrapper };
}

function mountAuto(initial: { state: TabBenefits | null | undefined; version: string }) {
  const { qc, wrapper } = wrap();
  const invalidated = vi.spyOn(qc, 'invalidateQueries');
  const h = renderHook(({ state, version }: { state: TabBenefits | null | undefined; version: string }) => useAutoTierPerks({ tabId: 't1', state, version, enabled: true }), {
    wrapper,
    initialProps: initial,
  });
  return { h, invalidated };
}

const refreshes = () => rpc.mock.calls.filter((c) => c[0] === 'loyalty_perks_refresh');

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async () => ({ changed: true, amount_iqd: 1500, lines: 1 }));
});

describe('useAutoTierPerks', () => {
  it('refreshes once for a bill whose free add-ons are not what the card gives, then re-reads the bill', async () => {
    const { h, invalidated } = mountAuto({ state: needs, version: '10000|1' });
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    expect(refreshes()[0]).toEqual(['loyalty_perks_refresh', { p_tab_id: 't1', p_device_id: 'TILL-1' }]);
    await waitFor(() => expect(invalidated).toHaveBeenCalledWith({ queryKey: ['tab', 't1'] }));
    expect(invalidated).toHaveBeenCalledWith({ queryKey: ['bookingBill'] });
    // The server refused (a part-paid bill) or changed nothing, and the same state came back.
    h.rerender({ state: { ...needs }, version: '10000|1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshes()).toHaveLength(1);
  });

  it('asks again when the bill changes: a line with a paid add-on was added', async () => {
    const { h } = mountAuto({ state: needs, version: '10000|1' });
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    h.rerender({ state: { ...needs, addons: { on_bill_iqd: 1500, due_iqd: 2500, needs_refresh: true } }, version: '14000|2' });
    await waitFor(() => expect(refreshes()).toHaveLength(2));
  });

  it('does nothing when the bill is already right, while a newer read is on its way, or for another bill’s answer', async () => {
    const { h } = mountAuto({ state: { ...needs, addons: { on_bill_iqd: 1500, due_iqd: 1500, needs_refresh: false } }, version: '1' });
    h.rerender({ state: undefined, version: '2' });
    h.rerender({ state: { ...needs, tab_id: 'other' }, version: '3' });
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshes()).toHaveLength(0);
  });

  it('is silent when the refresh fails: nothing is thrown and nothing is re-read', async () => {
    rpc.mockImplementation(async () => {
      throw new AppRpcError('TAB_KIND_FORBIDDEN', 'TAB_KIND_FORBIDDEN');
    });
    const { invalidated } = mountAuto({ state: needs, version: '1' });
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(invalidated).not.toHaveBeenCalled();
  });
});

describe('useMemberBenefits', () => {
  const mount = (version = 'v1', tabId: string | null = 't1') => {
    const { wrapper } = wrap();
    return renderHook(({ v }: { v: string }) => useMemberBenefits({ tabId, version: v, enabled: true }), { wrapper, initialProps: { v: version } });
  };

  it('reads the benefits under the tab’s own key with the host’s version, and brings the add-ons onto the bill', async () => {
    rpc.mockImplementation(async (fn: string) => (fn === 'loyalty_tab_benefits' ? needs : { changed: true, amount_iqd: 1500, lines: 1 }));
    const h = mount();
    await waitFor(() => expect(h.result.current?.tier?.name_en).toBe('Gold'));
    expect(rpc.mock.calls[0]).toEqual(['loyalty_tab_benefits', { p_tab_id: 't1' }]);
    await waitFor(() => expect(refreshes()).toHaveLength(1));
    expect(LOYALTY_KEYS.benefits('t1')).toEqual(['tab', 't1', 'loyalty', 'benefits']);
  });

  it('a server without the RPC shows nothing and never asks for a refresh', async () => {
    rpc.mockImplementation(async () => {
      throw new AppRpcError('RPC_MISSING', 'RPC_MISSING');
    });
    const h = mount();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    await new Promise((r) => setTimeout(r, 0));
    expect(h.result.current).toBeNull();
    expect(refreshes()).toHaveLength(0);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('asks nothing for a tab opened offline, which has no server id yet', async () => {
    const h = mount('v1', 'local:abc');
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
    expect(h.result.current).toBeNull();
  });
});
