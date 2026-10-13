import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// Online payments are paused until the provider is live. The flag fails CLOSED
// (loading, error, missing RPC, anything but boolean true), and while it is
// closed the match capability and the open-matches read both go dark.

let role = 'owner';
let answer: () => unknown = () => true;
let openAnswer: () => unknown = () => ({ matches_enabled: true, matches: [] });

vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../lib/realtime', () => ({ useBroadcast: vi.fn() }));
vi.mock('../../lib/stationReach', () => ({ useStationReach: () => ({ reachable: true }) }));
vi.mock('../../lib/auth', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, useAuth: () => ({ staff: { role } }) };
});
vi.mock('../../lib/appRpc', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    appRpc: vi.fn(async (fn: string) => {
      if (fn === 'online_payments_live') return answer();
      if (fn === 'desk_open_matches') return openAnswer();
      return {};
    }),
  };
});

import { AppRpcError, appRpc } from '../../lib/appRpc';
import { useMatchCaps, useOpenMatches } from '../matches/useMatches';
import { readOnlinePaymentsLive, useOnlinePaymentsLive } from './useOnlinePaymentsLive';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  role = 'owner';
  answer = () => true;
  openAnswer = () => ({ matches_enabled: true, matches: [] });
  vi.mocked(appRpc).mockClear();
});

describe('readOnlinePaymentsLive', () => {
  it('only boolean true opens', () => {
    expect(readOnlinePaymentsLive(true)).toBe(true);
    for (const v of [false, null, undefined, 'true', 1, {}, []]) expect(readOnlinePaymentsLive(v)).toBe(false);
  });
});

describe('useOnlinePaymentsLive', () => {
  it('is closed while loading, then open when the server says true', async () => {
    const { result } = renderHook(() => useOnlinePaymentsLive(), { wrapper: wrapper() });
    expect(result.current).toBe(false);
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('stays closed when the server says false', async () => {
    answer = () => false;
    const { result } = renderHook(() => useOnlinePaymentsLive(), { wrapper: wrapper() });
    await waitFor(() => expect(vi.mocked(appRpc)).toHaveBeenCalled());
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current).toBe(false);
  });

  it('stays closed on an error and on a server without the RPC', async () => {
    for (const err of [new Error('network'), new AppRpcError('RPC_MISSING', 'missing', undefined, undefined, 'PGRST202')]) {
      answer = () => {
        throw err;
      };
      const { result } = renderHook(() => useOnlinePaymentsLive(), { wrapper: wrapper() });
      await waitFor(() => expect(vi.mocked(appRpc)).toHaveBeenCalled());
      await new Promise((r) => setTimeout(r, 20));
      expect(result.current).toBe(false);
    }
  });
});

describe('open matches follow the flag', () => {
  it('useMatchCaps.runMatches needs the flag as well as the role', async () => {
    const on = renderHook(() => useMatchCaps().runMatches, { wrapper: wrapper() });
    expect(on.result.current).toBe(false);
    await waitFor(() => expect(on.result.current).toBe(true));

    answer = () => false;
    const off = renderHook(() => useMatchCaps().runMatches, { wrapper: wrapper() });
    await new Promise((r) => setTimeout(r, 20));
    expect(off.result.current).toBe(false);
  });

  it('useOpenMatches answers null (no match UI) while paused and the envelope once live', async () => {
    const start = new Date('2026-10-01T10:00:00Z');
    const end = new Date('2026-10-02T04:00:00Z');
    answer = () => false;
    const off = renderHook(() => useOpenMatches(start, end), { wrapper: wrapper() });
    await waitFor(() => expect(off.result.current.isSuccess).toBe(true));
    expect(off.result.current.data).toBeNull();

    answer = () => true;
    const on = renderHook(() => useOpenMatches(start, end), { wrapper: wrapper() });
    await waitFor(() => expect(on.result.current.data?.matches_enabled).toBe(true));
  });
});
