/**
 * Per-screen auth gate, for gated screens that live on the ROOT stack.
 *
 * The `(gated)` group guards its screens from its layout, which works — but a
 * screen inside that group is the first entry of a nested stack when it is
 * pushed from the tabs, so `canGoBack` is false there and UIKit draws no back
 * item of its own (only an item it draws itself animates). Screens that want
 * the native animated back button therefore have to sit directly on the root
 * stack, and carry their guard themselves rather than inheriting it.
 *
 * Same three states as `GatedLayout`, in the same order, so moving a screen
 * between the two changes nothing about who can see it:
 *   initializing → spinner (never a flash of the signed-out redirect)
 *   no session   → replaced by the welcome screen
 *   session      → the screen
 */
import type { ReactNode } from 'react';
import { Redirect } from 'expo-router';
import { useAuth } from './context';
import { sessionGate } from './gate';
import { Loading } from '../../components/ui';

export function RequireSession({ children }: { children: ReactNode }) {
  const { session, initializing } = useAuth();
  switch (sessionGate({ initializing, hasSession: session !== null })) {
    case 'loading':
      return <Loading />;
    case 'redirect':
      return <Redirect href="/welcome" />;
    default:
      return <>{children}</>;
  }
}
