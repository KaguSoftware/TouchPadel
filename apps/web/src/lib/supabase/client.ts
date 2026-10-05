import { createBrowserClient } from '@supabase/ssr';
import { supabaseEnv } from './env';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { DEFAULT_REQUEST_TIMEOUT_MS, timeoutFetch } from '@touch/core';

// Browser-side Supabase client (anonymous cafe sessions use the standard sb-* cookie
// via @supabase/ssr — design-arch.md §4).
// The cast unifies on the hoisted supabase-js generic signature — @supabase/ssr's
// .d.ts was built against an older supabase-js and instantiates SupabaseClient
// with a different arity, which otherwise poisons every downstream query type.
export function createBrowserSupabase(): SupabaseClient<Database> {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient<Database>(url, anonKey, {
    global: { fetch: timeoutFetch((input, init) => fetch(input, init), browserRequestTimeoutMs) },
  }) as unknown as SupabaseClient<Database>;
}

/**
 * The deadline a browser request gets when its caller set none (appRpc sets
 * its own): 15 s for the menu, order and session reads and for auth; none for
 * storage. A guest's phone that slept on the café Wi-Fi used to leave a read
 * hanging with no end; now it fails, and the screen's own error path runs.
 */
export function browserRequestTimeoutMs(url: string): number | null {
  return url.includes('/storage/v1/') ? null : DEFAULT_REQUEST_TIMEOUT_MS;
}

/**
 * Non-throwing variant for OPTIONAL client features (live refresh, presence).
 * A misconfigured deployment must degrade those features, never take down a
 * page whose server-rendered content already arrived (seen on the first
 * Vercel deploy: missing env vars nuked the whole menu page via MenuLive).
 */
export function tryCreateBrowserSupabase(): SupabaseClient<Database> | null {
  try {
    return createBrowserSupabase();
  } catch (e) {
    if (typeof console !== 'undefined') console.error('[supabase] client disabled:', e);
    return null;
  }
}

/**
 * A client whose session lives in memory only — for /delete-account, where a
 * guest signs in with a password just to delete the account. It must NOT use
 * the shared sb-* cookie: that cookie is the café table session, and a
 * password sign-in written into it would replace a guest's open tab. Nothing
 * persists, nothing refreshes, and closing the page forgets the session.
 */
export function createEphemeralBrowserSupabase(): SupabaseClient<Database> {
  const { url, anonKey } = supabaseEnv();
  return createClient<Database>(url, anonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storageKey: 'tp-delete-account',
    },
  });
}

/**
 * The cookie the web account's session lives in (loyalty build contracts §5, plan §5.2). The
 * café's anonymous table session keeps the default `sb-<ref>-auth-token`; a signed-in member
 * on /account must never write over it, or a guest who signs in at the table loses the tab.
 */
export const ACCOUNT_COOKIE = 'sb-tp-account';

/**
 * The browser client for the member's own account (/{locale}/account and the café's "earn
 * points" chip). A cookie session, so it survives a reload and the café page can read it,
 * under its own name. `isSingleton: false` matters as much as the name: @supabase/ssr caches
 * ONE browser client per page by default, and whichever of the two were made first would
 * be handed back for the other.
 */
export function createAccountBrowserSupabase(): SupabaseClient<Database> {
  const { url, anonKey } = supabaseEnv();
  return createBrowserClient<Database>(url, anonKey, {
    isSingleton: false,
    cookieOptions: { name: ACCOUNT_COOKIE, path: '/', sameSite: 'lax' },
    global: { fetch: timeoutFetch((input, init) => fetch(input, init), browserRequestTimeoutMs) },
  }) as unknown as SupabaseClient<Database>;
}

let accountClient: SupabaseClient<Database> | null | undefined;

/**
 * The one account client of this page, made on first use; null when the deployment has no
 * Supabase env (the account page then shows its unavailable state, the café chip hides).
 */
export function accountBrowserSupabase(): SupabaseClient<Database> | null {
  if (accountClient === undefined) {
    try {
      accountClient = createAccountBrowserSupabase();
    } catch (e) {
      if (typeof console !== 'undefined') console.error('[supabase] account client disabled:', e);
      accountClient = null;
    }
  }
  return accountClient;
}

export type BrowserSupabase = SupabaseClient<Database>;
