import { useCallback } from 'react';
import { useRouter, type Href } from 'expo-router';
import { useAuth } from './context';

/**
 * Opens an account-only page from a signed-in tap, or the Welcome screen at once
 * from a signed-out one. Deciding at the tap (rather than letting the page's
 * `RequireSession` redirect) is what keeps the guest from seeing the gated page's
 * blank first frame before Welcome lands. The page keeps its own guard for links.
 */
export function useAccountPush(): (href: Href) => void {
  const router = useRouter();
  const { session } = useAuth();
  const signedIn = session !== null;
  return useCallback(
    (href: Href) => {
      router.push(signedIn ? href : '/welcome');
    },
    [router, signedIn],
  );
}
