import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// The bill's automatic refresh (0342): once per state, never a loop, again
// when the goods change, and never on a bill the server says is waived.

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/appRpc', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  appRpc: vi.fn(async () => ({})),
}));
vi.mock('../../lib/idem', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  deviceId: () => 'TILL-1',
}));

import { appRpc } from '../../lib/appRpc';
import { useAutoCustomerDiscount } from './useCustomerDiscount';
import type { BillDiscountState } from './discountLogic';

const rpc = vi.mocked(appRpc);

const needs: BillDiscountState = {
  customer: { id: 'c1', name: 'Sara' },
  standing: { cafe: { kind: 'percent', value: 2000 }, court: null, reason: 'coach', note: null, set_by: null, set_at: null },
  cafe: null,
  court: null,
  cafe_needs_refresh: true,
  court_needs_refresh: false,
  court_allowed: false,
  cafe_waived: false,
  court_waived: false,
};

function mount(initial: { state: BillDiscountState; version: string }) {
  const qc = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  return renderHook(({ state, version }: { state: BillDiscountState; version: string }) => useAutoCustomerDiscount({ tabId: 't1', reservationId: null, state, version, enabled: true }), {
    wrapper,
    initialProps: initial,
  });
}

beforeEach(() => {
  rpc.mockReset();
  rpc.mockImplementation(async () => ({}));
});

describe('useAutoCustomerDiscount', () => {
  it('refreshes once for a state that needs it, and not again for the same state re-read', async () => {
    const h = mount({ state: needs, version: '10000|1' });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(rpc.mock.calls[0]).toEqual(['apply_customer_discount', { p_tab_id: 't1', p_device_id: 'TILL-1' }]);
    // The server refused (or changed nothing) and the same state came back.
    h.rerender({ state: { ...needs }, version: '10000|1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('asks again when the goods change, so a percent follows the bill', async () => {
    const h = mount({ state: needs, version: '10000|1' });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    h.rerender({ state: { ...needs }, version: '15000|2' });
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(2));
  });

  it('does nothing when the bill is already right', async () => {
    mount({ state: { ...needs, cafe_needs_refresh: false }, version: '1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
  });

  it('a bill that waived it (needs_refresh false from the server) is left at full price', async () => {
    mount({ state: { ...needs, cafe_needs_refresh: false, cafe_waived: true }, version: '1' });
    await new Promise((r) => setTimeout(r, 0));
    expect(rpc).not.toHaveBeenCalled();
  });
});
