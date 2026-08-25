'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { appRpc, isRpcError } from '@/lib/appRpc';
import type { BrowserSupabase } from '@/lib/supabase/client';
import { useSupabase } from './useSupabase';

/**
 * QR table binding: anonymous sign-in + `app.open_table_session` (0014/0031),
 * run in the BACKGROUND while the server-rendered menu is already on screen.
 *
 * States: none (no token — walk-in browsing) · binding · bound · invalid
 * (rotated/forged token) · expired (inactivity TTL — re-scan) · error.
 */
export type TableSessionState = 'none' | 'binding' | 'bound' | 'invalid' | 'expired' | 'error';

export interface TableSession {
  sessionId: string;
  tableId: string;
  tableNumber: string;
  expiresAt: string;
  /** false ⇒ management switched this table's bell off (0031): hide the FAB. */
  bellEnabled: boolean;
}

export interface UseTableSession {
  state: TableSessionState;
  session: TableSession | null;
  /** convenience: false whenever there is no session */
  bellEnabled: boolean;
  retry(): void;
  markExpired(): void;
  /** after a write slid `expires_at` server-side: re-read it and re-arm the timer */
  touched(): void;
}

type BootResult =
  | { name: 'invalid' }
  | { name: 'error' }
  | { name: 'bound'; session: TableSession };

/**
 * One shared boot per token (module scope). React StrictMode double-mounts the
 * effect in dev and two PARALLEL `signInAnonymously()` calls mint two anon
 * users racing for the auth cookie — sharing the in-flight promise makes any
 * concurrent mount reuse the first sign-in + table session. Only a successful
 * boot stays cached, so "Try again" really retries.
 */
const bootCache = new Map<string, Promise<BootResult>>();

function bootSession(sb: BrowserSupabase, token: string): Promise<BootResult> {
  const cached = bootCache.get(token);
  if (cached) return cached;
  const p = (async (): Promise<BootResult> => {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) return { name: 'error' };
    }
    const { data, error } = await appRpc(sb, 'open_table_session', { p_token: token });
    if (error) return isRpcError(error, 'TOKEN_INVALID') ? { name: 'invalid' } : { name: 'error' };
    const row = data as {
      session_id: string;
      table_id: string;
      table_number: string;
      expires_at: string;
      bell_enabled?: boolean;
    };
    return {
      name: 'bound',
      session: {
        sessionId: row.session_id,
        tableId: row.table_id,
        tableNumber: row.table_number,
        expiresAt: row.expires_at,
        // 0031 added the key; a pre-0031 stack (staging) simply keeps the bell.
        bellEnabled: row.bell_enabled !== false,
      },
    };
  })().catch((): BootResult => ({ name: 'error' }));
  bootCache.set(token, p);
  void p.then((r) => {
    if (r.name !== 'bound') bootCache.delete(token);
  });
  return p;
}

/** Drop a cached boot (used by `retry`, and by tests). */
export function forgetTableBoot(token: string | null): void {
  if (token) bootCache.delete(token);
}

export function useTableSession(token: string | null): UseTableSession {
  const supabase = useSupabase();
  const [state, setState] = useState<TableSessionState>(token ? 'binding' : 'none');
  const [session, setSession] = useState<TableSession | null>(null);
  const [attempt, setAttempt] = useState(0);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------- boot
  useEffect(() => {
    if (!token) {
      setState('none');
      setSession(null);
      return;
    }
    if (!supabase) {
      setState('error');
      return;
    }
    let cancelled = false;
    setState('binding');
    void bootSession(supabase, token).then((result) => {
      if (cancelled) return;
      if (result.name === 'bound') {
        setSession(result.session);
        setState('bound');
      } else {
        setSession(null);
        setState(result.name);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [token, supabase, attempt]);

  // --------------------------------------------------- inactivity expiry arm
  const armExpiry = useCallback((expiresAt: string) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) {
      setState('expired');
      return;
    }
    // setTimeout caps at ~24.8 days; a table TTL is minutes, but clamp anyway.
    expiryTimer.current = setTimeout(() => setState('expired'), Math.min(ms, 2_147_483_647));
  }, []);

  useEffect(() => {
    if (session) armExpiry(session.expiresAt);
    return () => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [session, armExpiry]);

  const retry = useCallback(() => {
    forgetTableBoot(token);
    setAttempt((n) => n + 1);
  }, [token]);

  const markExpired = useCallback(() => {
    forgetTableBoot(token);
    setState('expired');
  }, [token]);

  /**
   * Every guest write calls app.touch_guest_session, which slides expires_at.
   * Re-read the row so the local timer matches the server's truth.
   */
  const touched = useCallback(() => {
    if (!supabase || !session) return;
    void (async () => {
      const { data } = await supabase
        .from('guest_sessions')
        .select('expires_at')
        .eq('id', session.sessionId)
        .maybeSingle();
      if (data?.expires_at) {
        setSession((prev) => (prev ? { ...prev, expiresAt: data.expires_at } : prev));
      }
    })();
  }, [supabase, session]);

  return {
    state,
    session: state === 'bound' ? session : null,
    bellEnabled: state === 'bound' && session ? session.bellEnabled : false,
    retry,
    markExpired,
    touched,
  };
}
