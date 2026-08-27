import { AppState, type AppStateStatus } from 'react-native';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import { chunkedSecureStore } from './secureStorage';
import { addBreadcrumb, captureException } from './telemetry';

// NOTE: `react-native-url-polyfill/auto` used to be imported here. Expo's winter
// runtime ships URL/URLSearchParams natively as of SDK 51+, so the polyfill now
// DOWNGRADES the global to the whatwg-url-without-unicode shim. Dropped.

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

/**
 * Missing env is a configuration failure, not a crash.
 *
 * This module used to `throw` at module scope. That throw happened inside the
 * bundle's import graph — BEFORE React mounted — so it produced a hard white
 * screen with no message and nothing an error boundary could catch. Instead we
 * record the problem and let the root layout render it (app/_layout.tsx).
 */
export const configError: string | null =
  !supabaseUrl || !supabaseAnonKey
    ? 'Missing EXPO_PUBLIC_SUPABASE_URL / EXPO_PUBLIC_SUPABASE_ANON_KEY — copy .env.example to .env'
    : null;

export const supabase = createClient<Database>(
  supabaseUrl ?? 'http://unconfigured.invalid',
  supabaseAnonKey ?? 'unconfigured',
  {
    auth: {
      // Chunked: a Supabase session exceeds SecureStore's ~2 KB per-value limit.
      storage: chunkedSecureStore,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false, // native: tokens arrive via deep link, not a URL bar
      flowType: 'pkce',
    },
  },
);

/**
 * Drive token refresh off the foreground lifecycle.
 *
 * Without this, supabase-js keeps (or loses) its refresh timer while the app is
 * backgrounded, and a user returning after an hour hits a stale JWT — surfacing
 * as an opaque AUTH_REQUIRED on their next booking action rather than a silent,
 * successful refresh. This is the documented supabase-js-on-React-Native
 * requirement and it was simply absent.
 *
 * Returns an unsubscribe function; called once from app/_layout.tsx.
 */
export function startAuthRefreshLifecycle(): () => void {
  const apply = (state: AppStateStatus) => {
    try {
      if (state === 'active') {
        supabase.auth.startAutoRefresh();
        addBreadcrumb('auth.autoRefresh.start');
      } else {
        supabase.auth.stopAutoRefresh();
        addBreadcrumb('auth.autoRefresh.stop', { state });
      }
    } catch (error) {
      captureException(error, { label: 'auth.autoRefreshLifecycle', state });
    }
  };

  apply(AppState.currentState);
  const sub = AppState.addEventListener('change', apply);
  return () => sub.remove();
}

/**
 * All business writes go through app.* RPCs (schema-qualified — mirrors
 * packages/db/tests/helpers.ts appRpc). The generated Database type covers the
 * `app` schema, so function names and args are typed.
 */
export const appSchema = () => supabase.schema('app');
