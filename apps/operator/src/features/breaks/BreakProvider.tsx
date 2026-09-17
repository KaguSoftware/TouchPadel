/**
 * Staff breaks (0105) — the station's break state, shared by the rail row,
 * the break screen and the idle lock.
 *
 * One query (`app.break_status`) answers everything: how much of today's
 * allowance is left, whether the signed-in person is away, who is covering,
 * and who could. The three actions each take a PIN and go through the RPC
 * that verifies it server-side; a wrong PIN comes back as `{ok:false}` (so
 * the server's attempt row survives — see the migration) and is re-thrown
 * here as the same AppRpcError every other PIN prompt in the app shows.
 *
 * The Supabase session stays the first person's throughout, exactly as the
 * idle lock keeps it. A cover is a fact recorded on the break row and shown in
 * the rail, not a second sign-in.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appRpc, AppRpcError } from '../../lib/appRpc';
import { useAuth } from '../../lib/auth';
import { touch } from '../../ipc/bridge';
import { breakPhase, type BreakPhase, type BreakStatus, type PinRefused } from '../../lib/breaks';

/** What end_break reports, for the "{n} min left today" toast. */
export interface BreakEnded {
  duration_seconds: number;
  allowance_seconds: number;
  used_seconds: number;
  remaining_seconds: number;
}

export interface BreakContextValue {
  stationId: string;
  status: BreakStatus | null;
  phase: BreakPhase;
  /** Ticks once a second while a break is open, so clocks re-render. */
  nowMs: number;
  start: (pin: string) => Promise<void>;
  end: (pin: string) => Promise<BreakEnded>;
  cover: (staffId: string, pin: string) => Promise<void>;
  refetch: () => void;
}

const BreakContext = createContext<BreakContextValue | null>(null);

export function breakStatusKey(stationId: string, staffId: string) {
  return ['breakStatus', stationId, staffId] as const;
}

function refused(data: unknown): data is PinRefused {
  return !!data && typeof data === 'object' && (data as { ok?: unknown }).ok === false;
}

export function BreakProvider({ children }: { children: ReactNode }) {
  const { staff } = useAuth();
  const queryClient = useQueryClient();
  const stationId = useMemo(() => touch.getStation().stationId, []);
  const staffId = staff?.id ?? '';
  const key = useMemo(() => breakStatusKey(stationId, staffId), [stationId, staffId]);

  const query = useQuery({
    queryKey: key,
    queryFn: () => appRpc<BreakStatus>('break_status', { p_device_id: stationId }),
    enabled: !!staff,
    staleTime: 15_000,
    // A break in progress is worth watching; a quiet station is not.
    refetchInterval: (q) => (q.state.data?.open ? 60_000 : 5 * 60_000),
  });
  const status = query.data ?? null;
  const phase = breakPhase(status);

  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (!status?.open) return;
    setNowMs(Date.now());
    const t = setInterval(() => setNowMs(Date.now()), 1_000);
    return () => clearInterval(t);
  }, [status?.open]);

  const refetch = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: key });
  }, [queryClient, key]);

  const start = useCallback(
    async (pin: string) => {
      const res = await appRpc<PinRefused | { ok: true }>('start_break', { p_pin: pin, p_device_id: stationId });
      if (refused(res)) throw new AppRpcError(res.code, res.code);
      refetch();
    },
    [stationId, refetch],
  );

  const end = useCallback(
    async (pin: string) => {
      const res = await appRpc<PinRefused | ({ ok: true } & BreakEnded)>('end_break', { p_pin: pin, p_device_id: stationId });
      if (refused(res)) throw new AppRpcError(res.code, res.code);
      refetch();
      return res;
    },
    [stationId, refetch],
  );

  const cover = useCallback(
    async (coverId: string, pin: string) => {
      const res = await appRpc<PinRefused | { ok: true }>('cover_station', {
        p_staff_id: coverId,
        p_pin: pin,
        p_device_id: stationId,
      });
      if (refused(res)) throw new AppRpcError(res.code, res.code);
      refetch();
    },
    [stationId, refetch],
  );

  const value = useMemo<BreakContextValue>(
    () => ({ stationId, status, phase, nowMs, start, end, cover, refetch }),
    [stationId, status, phase, nowMs, start, end, cover, refetch],
  );

  return <BreakContext.Provider value={value}>{children}</BreakContext.Provider>;
}

export function useBreak(): BreakContextValue {
  const ctx = useContext(BreakContext);
  if (!ctx) throw new Error('useBreak outside BreakProvider');
  return ctx;
}
