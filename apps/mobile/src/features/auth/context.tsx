import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { clearAllCaches } from '../../lib/queryClient';
import { addBreadcrumb, captureException } from '../../lib/telemetry';

export interface AuthContextValue {
  session: Session | null;
  /** True until the persisted session has been read from SecureStore. */
  initializing: boolean;
}

const AuthContext = createContext<AuthContextValue>({ session: null, initializing: true });

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    let cancelled = false;
    // A hung getSession() (corrupt keychain entry, cold keystore) used to leave
    // the app on the loading gate forever with no way out. Fail open after 8s:
    // signed-out is a recoverable state, an infinite spinner is not.
    const bail = setTimeout(() => {
      if (cancelled) return;
      captureException(new Error('auth.getSession timed out'), { scope: 'auth.init' });
      setInitializing(false);
    }, 8_000);
    void supabase.auth
      .getSession()
      .then(({ data }) => {
        if (cancelled) return;
        setSession(data.session);
      })
      .catch((error) => captureException(error, { scope: 'auth.init' }))
      .finally(() => {
        if (cancelled) return;
        clearTimeout(bail);
        setInitializing(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((event, next) => {
      setSession(next);
      addBreadcrumb('auth.' + event);
      // Private realtime channels ('courts') authorize via the user's JWT.
      if (next?.access_token) supabase.realtime.setAuth(next.access_token);
      // Wipe every cache on sign-out. Without this, account B signing in on the
      // same device read account A's cached `my-bookings` until staleTime
      // expired — and the disk persister made it survive a restart. Handled
      // HERE rather than in the settings screen so every sign-out path is
      // covered, including a refresh-token failure we did not initiate.
      if (event === 'SIGNED_OUT') void clearAllCaches();
    });
    return () => {
      cancelled = true;
      clearTimeout(bail);
      sub.subscription.unsubscribe();
    };
  }, []);

  const value = useMemo(() => ({ session, initializing }), [session, initializing]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
