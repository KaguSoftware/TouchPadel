import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import { router, useRootNavigationState } from 'expo-router';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureException } from '../../lib/telemetry';
import { authLinkErrorKey, isRecoveryLink, parseAuthLink, type AuthLink } from './deepLink';

/**
 * Turns the tokens on an auth deep link into a session.
 *
 * Nothing did this before. `expo-linking` was a dependency imported nowhere and
 * supabase.ts sets `detectSessionInUrl: false` (right on native — there is no
 * URL bar to read), so an emailed verification or recovery link could never
 * sign anyone in even once it pointed at the app. Mounted once, from
 * app/_layout.tsx.
 *
 * Navigation on the HAPPY path is deliberately left alone: expo-router already
 * routes touchpadel://verify-email and touchpadel://reset-password to their
 * screens, and once the session lands, (auth)/_layout redirects the now-verified
 * user into (app) while reset-password — which lives outside that group — is
 * left where it is. Racing our own router.replace against those redirects would
 * only produce flicker. We navigate only when the link FAILS, because that is
 * the case where the user is otherwise left on a screen with no explanation.
 */
export function useAuthDeepLink(): void {
  // Both getInitialURL() and the 'url' listener can deliver the same cold-start
  // link. Auth codes are single-use, so exchanging twice fails and would report
  // a perfectly good link as expired.
  const seen = useRef(new Set<string>());
  // router.replace before the root navigator has mounted is a no-op that
  // silently swallows the error message.
  const navigationReady = Boolean(useRootNavigationState()?.key);

  useEffect(() => {
    if (!navigationReady) return;
    let cancelled = false;

    const failTo = (link: AuthLink, code: string | null | undefined) => {
      if (cancelled) return;
      const authError = authLinkErrorKey(code);
      // A dead recovery link belongs on forgot-password, where a fresh one is
      // one tap away. A dead sign-up link belongs on sign-in, which already
      // forwards an unconfirmed account to verify-email and its resend button.
      router.replace(
        isRecoveryLink(link)
          ? { pathname: '/forgot-password', params: { authError } }
          : { pathname: '/sign-in', params: { authError } },
      );
    };

    const apply = async (link: AuthLink) => {
      addBreadcrumb('auth.deepLink', { kind: link.kind, path: link.path });
      if (link.kind === 'error') {
        captureException(new Error(`auth deep link refused: ${link.code}`), {
          scope: 'auth.deepLink',
          description: link.description,
        });
        failTo(link, link.code);
        return;
      }
      try {
        const { error } =
          link.kind === 'pkce'
            ? await supabase.auth.exchangeCodeForSession(link.code)
            : await supabase.auth.setSession({
                access_token: link.accessToken,
                refresh_token: link.refreshToken,
              });
        if (error) throw error;
        // AuthProvider's onAuthStateChange listener takes it from here.
        addBreadcrumb('auth.deepLink.session', { recovery: isRecoveryLink(link) });
        // A recovery link must land on the reset form. Under Expo Go the URL is
        // exp://…/--/reset-password and this hook has already consumed the
        // cold-start URL, so expo-router's own linking may never route it.
        if (isRecoveryLink(link) && !cancelled) router.replace('/reset-password');
      } catch (error) {
        // The common non-expiry failure is a PKCE verifier mismatch: the link
        // was opened on a different device from the one that signed up, so the
        // code has nothing on this device to pair with.
        captureException(error, { scope: 'auth.deepLink.exchange', kind: link.kind });
        failTo(link, error instanceof Error ? error.message : null);
      }
    };

    const consume = (url: string | null) => {
      if (cancelled || !url || seen.current.has(url)) return;
      const link = parseAuthLink(url);
      if (!link) return;
      seen.current.add(url);
      void apply(link);
    };

    // Cold start: the link that launched the app.
    void Linking.getInitialURL()
      .then(consume)
      .catch((error) => captureException(error, { scope: 'auth.deepLink.initialUrl' }));
    // Warm: the app was already running when the browser handed the link over.
    const sub = Linking.addEventListener('url', ({ url }) => consume(url));

    return () => {
      cancelled = true;
      sub.remove();
    };
  }, [navigationReady]);
}
