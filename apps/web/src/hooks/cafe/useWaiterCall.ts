'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { appRpc, isRpcError, rpcErrorKey } from '@/lib/appRpc';
import type { MessageKey } from '@touch/i18n';
import type { BrowserSupabase } from '@/lib/supabase/client';
import {
  cooldownLeftMs,
  cooldownStorageKey,
  isCallOpen,
  waiterPhase,
  type WaiterCall,
  type WaiterCallStatus,
  type WaiterPhase,
} from './waiter';
import type { WaiterCallStatusPayload } from './useSessionChannel';

/**
 * The waiter bell: `app.raise_waiter_call` (0016/0032) plus the live status
 * that comes back on `session:{id}` (0033). The old 20 s poll is gone — a
 * 60 s SAFETY poll only runs while a call is open, in case a broadcast is lost.
 *
 * Cooldown is a soft server limit (`venue_settings.waiter_call_cooldown_seconds`,
 * not exposed to anon), so the client mirrors it locally and PERSISTS the
 * deadline under `tp-waiter-{tableId}` — a reload must not hand the guest a
 * fresh bell.
 */
export type WaiterReason = 'order' | 'bill' | 'water' | 'assistance';

/** Fallback when the venue's cooldown is not known to the client. */
export const DEFAULT_COOLDOWN_SECONDS = 120;

const SAFETY_POLL_MS = 60_000;
const COOLDOWN_TICK_MS = 1_000;

export type RaiseResult =
  | { ok: true; callId: string }
  | { ok: false; kind: 'cooldown'; messageKey: MessageKey }
  | { ok: false; kind: 'expired' }
  | { ok: false; kind: 'degraded'; messageKey: MessageKey }
  | { ok: false; kind: 'error'; messageKey: MessageKey };

export interface UseWaiterCall {
  phase: WaiterPhase;
  call: WaiterCall | null;
  cooldownLeftMs: number;
  raise(reason: WaiterReason): Promise<RaiseResult>;
  /** apply a `waiter_call_status` broadcast */
  applyStatus(payload: WaiterCallStatusPayload): void;
  /** clear a failed phase (sheet reopened / retried) */
  reset(): void;
}

export function useWaiterCall(
  supabase: BrowserSupabase | null,
  session: { sessionId: string; tableId: string } | null,
  cooldownSeconds: number = DEFAULT_COOLDOWN_SECONDS,
): UseWaiterCall {
  const tableId = session?.tableId ?? null;
  const [call, setCall] = useState<WaiterCall | null>(null);
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [cooldownMs, setCooldownMs] = useState(0);
  const deadlineRef = useRef(0);

  // ------------------------------------------------- persisted cooldown read
  useEffect(() => {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(cooldownStorageKey(tableId));
    } catch {
      /* private mode — the cooldown simply does not survive reloads */
    }
    const left = cooldownLeftMs(raw);
    deadlineRef.current = left > 0 ? Date.now() + left : 0;
    setCooldownMs(left);
  }, [tableId]);

  // ------------------------------------------------------- cooldown countdown
  // Ticks only while a cooldown is running (the badge shows m:ss).
  const cooldownActive = cooldownMs > 0;
  useEffect(() => {
    if (!cooldownActive) return;
    const id = setInterval(() => {
      const left = deadlineRef.current - Date.now();
      setCooldownMs(left > 0 ? left : 0);
    }, COOLDOWN_TICK_MS);
    return () => clearInterval(id);
  }, [cooldownActive]);

  const armCooldown = useCallback(
    (seconds: number) => {
      const until = Date.now() + seconds * 1000;
      deadlineRef.current = until;
      setCooldownMs(seconds * 1000);
      try {
        window.localStorage.setItem(cooldownStorageKey(tableId), String(until));
      } catch {
        /* ignore */
      }
    },
    [tableId],
  );

  // ---------------------------------------------------------- safety poll
  useEffect(() => {
    if (!supabase || !call || !isCallOpen(call)) return;
    const id = setInterval(async () => {
      const { data } = await supabase
        .from('waiter_calls')
        .select('id, status')
        .eq('id', call.callId)
        .maybeSingle();
      if (data && data.status !== call.status) {
        setCall({ callId: data.id, status: data.status as WaiterCallStatus });
      }
    }, SAFETY_POLL_MS);
    return () => clearInterval(id);
  }, [supabase, call]);

  const applyStatus = useCallback((payload: WaiterCallStatusPayload) => {
    setCall((prev) =>
      // Ignore chatter about an older call once a newer one is in flight.
      prev && prev.callId !== payload.call_id ? prev : { callId: payload.call_id, status: payload.status },
    );
  }, []);

  const reset = useCallback(() => setFailed(false), []);

  const raise = useCallback(
    async (reason: WaiterReason): Promise<RaiseResult> => {
      if (!supabase || !session) {
        return { ok: false, kind: 'error', messageKey: 'errors.generic' };
      }
      setFailed(false);
      setSending(true);
      const { data, error } = await appRpc(supabase, 'raise_waiter_call', { p_reason: reason });
      setSending(false);

      if (error) {
        if (isRpcError(error, 'SESSION_EXPIRED')) return { ok: false, kind: 'expired' };
        if (isRpcError(error, 'ALREADY_NOTIFIED') || isRpcError(error, 'CALL_COOLDOWN')) {
          // Soft refusals: staff already know. Info toast + arm the local badge.
          armCooldown(cooldownSeconds);
          return { ok: false, kind: 'cooldown', messageKey: rpcErrorKey(error) };
        }
        if (isRpcError(error, 'DEGRADED_LOCKOUT')) {
          setFailed(true);
          return { ok: false, kind: 'degraded', messageKey: 'degraded.waiterCallRefused' };
        }
        setFailed(true);
        return { ok: false, kind: 'error', messageKey: rpcErrorKey(error) };
      }

      const row = data as { call_id: string; status?: WaiterCallStatus };
      setCall({ callId: row.call_id, status: row.status ?? 'raised' });
      armCooldown(cooldownSeconds);
      return { ok: true, callId: row.call_id };
    },
    [supabase, session, cooldownSeconds, armCooldown],
  );

  return {
    phase: waiterPhase({ sending, failed, call }),
    call,
    cooldownLeftMs: cooldownMs,
    raise,
    applyStatus,
    reset,
  };
}
