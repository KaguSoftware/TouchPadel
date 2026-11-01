'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { BrowserSupabase } from '@/lib/supabase/client';
import {
  parseBindResult,
  tableSessionPath,
  TABLE_SESSION_HEADER,
  TABLE_SESSION_HEADER_VALUE,
  type BindResult,
  type TableSession,
  type TableSessionState,
} from '@/lib/cafe/tableSession';
import { useSupabase } from './useSupabase';

/**
 * QR table binding: anonymous sign-in in the browser, then the server opens the
 * table session (`app.open_table_session`, 0014/0031) from the HttpOnly
 * `tp-table` cookie through `/{locale}/menu/table`, all in the BACKGROUND while
 * the server-rendered menu is already on screen.
 *
 * F-42 (2026-11-01): the hook no longer sees the token. The page passes only
 * whether a table cookie came with the request (`hasTable`); the token stays
 * on the server (src/lib/cafe/tableSession.ts says why). When the session runs
 * out the hook asks the route to clear the cookie, so a later visit is a
 * walk-in's.
 *
 * States: none (no table cookie — walk-in browsing) · binding · bound · invalid
 * (rotated/forged token) · expired (inactivity TTL — re-scan) · error.
 */
export type { TableSession, TableSessionState };

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

/**
 * One shared boot per page (module scope). React StrictMode double-mounts the
 * effect in dev and two PARALLEL `signInAnonymously()` calls mint two anon
 * users racing for the auth cookie — sharing the in-flight promise makes any
 * concurrent mount reuse the first sign-in + table session. Only a successful
 * boot stays cached, so "Try again" really retries.
 */
const BOOT_KEY = 'table';
const bootCache = new Map<string, Promise<BindResult>>();

function tableRequest(locale: string, method: 'POST' | 'DELETE'): Promise<Response> {
  return fetch(tableSessionPath(locale), {
    method,
    headers: { [TABLE_SESSION_HEADER]: TABLE_SESSION_HEADER_VALUE },
    credentials: 'same-origin',
    cache: 'no-store',
  });
}

function bootSession(sb: BrowserSupabase, locale: string): Promise<BindResult> {
  const cached = bootCache.get(BOOT_KEY);
  if (cached) return cached;
  const p = (async (): Promise<BindResult> => {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) return { name: 'error' };
    }
    const res = await tableRequest(locale, 'POST');
    if (!res.ok) return { name: 'error' };
    return parseBindResult(await res.json());
  })().catch((): BindResult => ({ name: 'error' }));
  bootCache.set(BOOT_KEY, p);
  void p.then((r) => {
    if (r.name !== 'bound') bootCache.delete(BOOT_KEY);
  });
  return p;
}

/** Drop a cached boot (used by `retry`, and by tests). */
export function forgetTableBoot(): void {
  bootCache.delete(BOOT_KEY);
}

/** Clear the table cookie on the server. Best effort: it also ages out after 2 h. */
function forgetTableCookie(locale: string): void {
  try {
    void tableRequest(locale, 'DELETE').catch(() => {});
  } catch {
    /* no fetch (tests, very old browsers): the cookie still ages out */
  }
}

export function useTableSession(hasTable: boolean, locale: string): UseTableSession {
  const supabase = useSupabase();
  const [state, setState] = useState<TableSessionState>(hasTable ? 'binding' : 'none');
  const [session, setSession] = useState<TableSession | null>(null);
  const [attempt, setAttempt] = useState(0);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ------------------------------------------------------------------- boot
  useEffect(() => {
    if (!hasTable) {
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
    void bootSession(supabase, locale).then((result) => {
      if (cancelled) return;
      if (result.name === 'bound') {
        setSession(result.session);
        setState('bound');
      } else if (result.name === 'none') {
        // The cookie aged out between the page render and the bind: a walk-in now.
        setSession(null);
        setState('none');
      } else {
        setSession(null);
        setState(result.name);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hasTable, locale, supabase, attempt]);

  // The session ran out (the local timer, or a write the server refused as
  // expired): forget the table on the server too, so the next visit to the menu
  // is a walk-in's instead of a silent re-bind to this table (F-42).
  const expire = useCallback(() => {
    forgetTableBoot();
    forgetTableCookie(locale);
    setState('expired');
  }, [locale]);

  // --------------------------------------------------- inactivity expiry arm
  const armExpiry = useCallback((expiresAt: string) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (!Number.isFinite(ms) || ms <= 0) {
      expire();
      return;
    }
    // setTimeout caps at ~24.8 days; a table TTL is minutes, but clamp anyway.
    expiryTimer.current = setTimeout(expire, Math.min(ms, 2_147_483_647));
  }, [expire]);

  useEffect(() => {
    if (session) armExpiry(session.expiresAt);
    return () => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [session, armExpiry]);

  const retry = useCallback(() => {
    forgetTableBoot();
    setAttempt((n) => n + 1);
  }, []);

  const markExpired = expire;

  /**
   * Every guest write calls app.touch_guest_session, which slides expires_at.
   * Re-read the row so the local timer matches the server's truth.
   */
  const touched = useCallback(() => {
    if (!supabase || !session) return;
    void (async () => {
      const { data, error } = await supabase
        .from('guest_sessions')
        .select('expires_at')
        .eq('id', session.sessionId)
        .maybeSingle();
      // A failed read is NOT evidence about the session — only a successful
      // read that came back with a row is. Swallowing the error here used to
      // make "the network blipped" and "the row is gone" the same thing; the
      // local timer just keeps its previous value until a read succeeds.
      if (error) return;
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
