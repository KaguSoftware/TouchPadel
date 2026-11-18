/**
 * Google sign-in in the browser: the Android fallback for phones whose Google
 * Play services cannot hand Credential Manager an id token (social.ts,
 * googleBrowserFallback; first seen on a Huawei P60 Pro with GBox, 2026-10-13).
 *
 * GoTrue's own OAuth flow, PKCE like every other auth link here: supabase-js
 * keeps the code verifier in the session storage, Google's page signs the guest
 * in, GoTrue sends the browser to touchpadel://auth-callback?code=…, and the
 * code is exchanged on this phone. No token ever rides on the link (the S6 rule
 * in deepLink.ts holds). The redirect must be on the project's allow-list
 * (Auth -> URL Configuration); one that is not lands on the site_url instead.
 *
 * TWO WAYS THE LINK COMES BACK. On Android, expo-web-browser races the app
 * turning active again (reported as a dismiss) against the link itself, and
 * the dismiss can win while the link is still on its way. So useAuthDeepLink
 * hands every auth-callback link to deliverOAuthCallback, and a dismissed
 * session waits a moment for it before calling it a cancel. A link that comes
 * back with nobody waiting (the app was restarted under the browser) is
 * exchanged by useAuthDeepLink itself, the verifier being in storage.
 *
 * STRAIGHT AFTER THE PHONE'S SHEET (2026-11-18). When the sheet fails and the
 * browser is opened by itself (useSocialSignIn, `afterSheet`), the app is still
 * coming back to the front from the sheet: a browser launched then never showed
 * on a Huawei with GBox, and the app turning active read as the browser
 * closing. So that path waits for the app to be active and settled first, and
 * a session that ends before the browser can have been seen (browserNeverShown)
 * is a failure the guest is told about, not a silent cancel.
 */
import { AppState, Platform } from 'react-native';
import * as Linking from 'expo-linking';
import * as WebBrowser from 'expo-web-browser';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../../lib/supabase';
import { OAUTH_CALLBACK_PATH, parseAuthLink } from '../deepLink';
import { captureMessage } from '../../../lib/telemetry';
import { SocialAuthError, browserNeverShown, deviceDetail, oauthCallbackOutcome } from '../social';

/** How long a dismissed browser waits for a return link already on its way. */
const LATE_LINK_MS = 3000;
/** How long the app is given after the phone's sheet before a browser is launched over it. */
const SETTLE_MS = 600;
/** The longest wait for the app to turn active again after the sheet. */
const ACTIVE_WAIT_MS = 2000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Resolves once the app is active (or after ACTIVE_WAIT_MS), then SETTLE_MS more. */
async function settleInForeground(): Promise<void> {
  if (AppState.currentState !== 'active') {
    await new Promise<void>((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        sub.remove();
        clearTimeout(timer);
        resolve();
      };
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') finish();
      });
      const timer = setTimeout(finish, ACTIVE_WAIT_MS);
    });
  }
  await sleep(SETTLE_MS);
}

let waiting: ((url: string) => void) | null = null;

/** True when a browser sign-in in progress took the link (useAuthDeepLink then leaves it alone). */
export function deliverOAuthCallback(url: string): boolean {
  if (!waiting) return false;
  waiting(url);
  return true;
}

/**
 * `afterSheet`: opened by itself straight after the phone's Google sheet failed
 * (not by the guest's tap on the browser link), so the app settles first.
 */
export async function signInWithGoogleInBrowser(opts: { afterSheet?: boolean } = {}): Promise<User | null> {
  const redirectTo = Linking.createURL(OAUTH_CALLBACK_PATH);
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo,
      skipBrowserRedirect: true,
      // Always the account chooser: the guest is here because one account
      // did not work through the phone's own sheet.
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  if (!data.url) throw new SocialAuthError('FAILED', 'google', 'no authorize url');

  const late = new Promise<string>((resolve) => {
    waiting = resolve;
  });
  let url: string | null;
  let browserType: string;
  let elapsedMs: number;
  try {
    if (opts.afterSheet) await settleInForeground();
    const openedAt = Date.now();
    // createTask false, as for the payment page: the Custom Tab joins the
    // app's task, so the return link brings the app forward over it.
    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo, { createTask: false });
    elapsedMs = Date.now() - openedAt;
    browserType = result.type;
    url =
      result.type === 'success'
        ? result.url
        : await Promise.race([late, new Promise<null>((r) => setTimeout(() => r(null), LATE_LINK_MS))]);
  } finally {
    waiting = null;
  }

  if (url === null && browserNeverShown(elapsedMs)) {
    captureMessage('auth.google.browserNotShown', 'warning', {
      afterSheet: opts.afterSheet === true,
      type: browserType,
      elapsedMs,
      ...deviceDetail(Platform.OS === 'android' ? Platform.constants : null),
    });
    throw new SocialAuthError('FAILED', 'google', `browser not shown (${browserType}, ${elapsedMs} ms)`);
  }

  const outcome = oauthCallbackOutcome(parseAuthLink(url));
  if (outcome.kind === 'cancelled') throw new SocialAuthError('CANCELLED', 'google', 'cancelled in browser');
  if (outcome.kind === 'failed') throw new SocialAuthError('FAILED', 'google', `browser: ${outcome.detail}`);
  const { data: exchanged, error: exchangeError } = await supabase.auth.exchangeCodeForSession(outcome.code);
  if (exchangeError) throw exchangeError;
  return exchanged.user;
}
