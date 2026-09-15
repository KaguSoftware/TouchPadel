import type { ReactNode } from 'react';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../../lib/settings', () => ({
  useCafeSettings: () => ({ isSuccess: true, isError: false, error: null, settings: { analytics_business_day_start_hour: 4, analytics_excluded_item_ids: [], analytics_engagement_floor: null } }),
}));
vi.mock('../../lib/analyticsApi', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  analyticsRpc: { dailySales: vi.fn() },
}));
vi.mock('./courts/api', () => ({ courtsRpc: vi.fn() }));

import { analyticsRpc } from '../../lib/analyticsApi';
import { courtsRpc } from './courts/api';
import { summaryJson, summaryPrevJson } from './courts/fixtures';
import { dailySalesJson, dailySalesPrevJson, RANGE, COMPARE_RANGE } from './fixtures';
import { useVenueRevenue } from './useVenueRevenue';

const daily = vi.mocked(analyticsRpc.dailySales);
const courts = vi.mocked(courtsRpc);

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  daily.mockReset();
  courts.mockReset();
  daily.mockImplementation(async (from) => (from === RANGE.from ? dailySalesJson : dailySalesPrevJson) as never);
  courts.mockImplementation(async (_name, { from }) => (from === RANGE.from ? summaryJson : summaryPrevJson) as never);
});

describe('useVenueRevenue', () => {
  it('adds cafe net revenue to court revenue for both windows, venue-wide', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useVenueRevenue(RANGE, COMPARE_RANGE), { wrapper: wrapper(client) });
    expect(result.current.state).toBe('loading');
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.current).toEqual({ cafeIqd: 700000, courtsIqd: 1200000, venueIqd: 1900000 });
    expect(result.current.previous).toEqual({ cafeIqd: 560000, courtsIqd: 1000000, venueIqd: 1560000 });
    // The courts summary is asked for the whole venue (no court), on the tab's own key.
    expect(courts).toHaveBeenCalledWith('analytics_courts_summary', { from: RANGE.from, to: RANGE.to });
    expect(client.getQueryData(['analytics', 'dailySales', RANGE.from, RANGE.to])).toBeDefined();
    expect(client.getQueryData(['analytics', 'courts', 'analytics_courts_summary', RANGE.from, RANGE.to, ''])).toBeDefined();
  });

  it('dedupes against a tab that already holds the same window: no second fetch', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(['analytics', 'dailySales', RANGE.from, RANGE.to], dailySalesJson);
    client.setQueryData(['analytics', 'courts', 'analytics_courts_summary', RANGE.from, RANGE.to, ''], summaryJson);
    const { result } = renderHook(() => useVenueRevenue(RANGE, COMPARE_RANGE), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    // Only the compare window had to be fetched.
    expect(daily).toHaveBeenCalledTimes(1);
    expect(daily).toHaveBeenCalledWith(COMPARE_RANGE.from, COMPARE_RANGE.to);
    expect(courts).toHaveBeenCalledTimes(1);
  });

  it('is unavailable when the current window fails, and only mutes the baseline when the compare window fails', async () => {
    courts.mockImplementation(async (_name, { from }) => {
      if (from === COMPARE_RANGE.from) throw new Error('boom');
      return summaryJson as never;
    });
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const { result } = renderHook(() => useVenueRevenue(RANGE, COMPARE_RANGE), { wrapper: wrapper(client) });
    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(result.current.current?.venueIqd).toBe(1900000);
    await waitFor(() => expect(daily).toHaveBeenCalledTimes(2));
    expect(result.current.previous).toBeNull();

    daily.mockRejectedValue(new Error('down'));
    const client2 = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const second = renderHook(() => useVenueRevenue(RANGE, COMPARE_RANGE), { wrapper: wrapper(client2) });
    await waitFor(() => expect(second.result.current.state).toBe('error'));
    expect(second.result.current.current).toBeNull();
  });
});
