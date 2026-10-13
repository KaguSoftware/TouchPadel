/**
 * Social sign-in orchestration shared by sign-in.tsx and sign-up.tsx (vendor
 * addition 2026-09-01). One attempt = fresh nonce -> provider sheet -> Supabase
 * id-token grant -> (Apple) first-authorization name patch -> profile read ->
 * either the complete-profile step (D3: no phone yet) or the SAME post-auth
 * continuation the email path uses (welcome-back toast + continueAfterAuth).
 *
 * Android Google has a second way in: Google's page in the browser
 * (./providers/googleWeb.ts), first on a Huawei (googleStartsInBrowser), taken
 * when the phone's sheet fails and offered when it is closed (social.ts,
 * googleBrowserFallback). It ends in a session like the id-token grant and
 * runs the same steps after it.
 *
 * The provider SDKs are behind ./providers/*; everything decidable without them
 * is in ./social.ts and unit-tested there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { useRouter } from 'expo-router';
import type { User } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureException, captureMessage } from '../../lib/telemetry';
import { useLocale } from '../../i18n/LocaleProvider';
import { fetchOwnProfile, updateOwnProfile } from '../profile/api';
import { profileKeys } from '../profile/hooks';
import { hasPendingIntent } from '../booking/pendingIntent';
import { readOwnStaffRow } from '../staff/api';
import { claimSocialRefusal, holdStaffStatus } from '../staff/StaffStatusProvider';
import { useToast } from '../../components/overlays';
import { setUserMetadata, signInWithIdToken, signOut } from './api';
import {
  PROVIDER_LABEL,
  SocialAuthError,
  buildProfilePatch,
  googleBrowserFallback,
  googleStartsInBrowser,
  mapSocialError,
  postSignInStep,
  refusesSocialSignIn,
  type SocialProvider,
} from './social';
import { newNonce } from './providers/nonce';
import { appleSignInExpected, isAppleSignInAvailable, requestAppleCredential } from './providers/apple';
import { isGoogleSignInAvailable, requestGoogleIdToken } from './providers/google';
import { signInWithGoogleInBrowser } from './providers/googleWeb';

/** `browser`: Google's sign-in page instead of the phone's sheet (Android fallback, social.ts). */
export type GoogleVia = 'native' | 'browser';

/** The phone's maker, as Android reports it ("HUAWEI", "samsung", "Xiaomi"). */
const MANUFACTURER = Platform.OS === 'android' ? Platform.constants.Manufacturer : undefined;

/**
 * Google through the phone's sheet, or its page in the browser. A Huawei goes
 * to the browser first (googleStartsInBrowser). A native failure the guest did
 * not choose goes straight on to the browser; a cancel calls `onOffer` so the
 * screen can show the browser link (googleBrowserFallback).
 */
async function signInWithGoogle(via: GoogleVia, onOffer: () => void): Promise<User | null> {
  if (via === 'browser' || googleStartsInBrowser(Platform.OS, MANUFACTURER)) {
    return signInWithGoogleInBrowser();
  }
  const nonce = await newNonce();
  let token: string;
  try {
    token = (await requestGoogleIdToken(nonce.hashed)).idToken;
  } catch (error) {
    const fallback = googleBrowserFallback(error, Platform.OS);
    if (fallback === 'offer') onOffer();
    if (fallback !== 'auto') throw error;
    // How many guests the phone's sheet fails, and why: a rise on one build
    // is a client or SHA-1 problem, a steady trickle is phones like GBox ones.
    captureMessage('auth.google.browserFallback', 'warning', {
      code: error instanceof SocialAuthError ? error.code : undefined,
    });
    return signInWithGoogleInBrowser();
  }
  // RAW nonce here — GoTrue hashes it and compares with the token's claim.
  const { user } = await signInWithIdToken(supabase, { provider: 'google', token, nonce: nonce.raw });
  return user;
}

export interface SocialAvailability {
  apple: boolean;
  google: boolean;
}

export const hasSocial = (a: SocialAvailability): boolean => a.apple || a.google;

export interface UseSocialSignIn {
  available: SocialAvailability;
  busyProvider: SocialProvider | null;
  errorText: string | null;
  clearError: () => void;
  /** Android, after the phone's Google sheet was closed: offer Google in the browser. */
  googleBrowserOffer: boolean;
  signInWith: (provider: SocialProvider, via?: GoogleVia) => Promise<void>;
}

export function useSocialSignIn(opts: { onComplete: () => void; disabled?: boolean }): UseSocialSignIn {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useLocale();
  const toast = useToast();
  const { onComplete, disabled } = opts;

  // Google availability is synchronous (Expo Go + env). Apple's truth needs a
  // native probe, so the first frame renders the platform expectation (iOS: on)
  // and the probe can only take the button away — no 60pt pop-in on every open.
  const [available, setAvailable] = useState<SocialAvailability>(() => ({
    apple: appleSignInExpected,
    google: isGoogleSignInAvailable(),
  }));
  const [busyProvider, setBusyProvider] = useState<SocialProvider | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [googleBrowserOffer, setGoogleBrowserOffer] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    void isAppleSignInAvailable().then((apple) => {
      if (cancelled) return;
      setAvailable((prev) => (prev.apple === apple ? prev : { ...prev, apple }));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const signInWith = useCallback(
    async (provider: SocialProvider, via: GoogleVia = 'native') => {
      if (busyRef.current || disabled) return;
      busyRef.current = true;
      setBusyProvider(provider);
      setErrorText(null);
      addBreadcrumb('auth.social.start', { provider, via });
      // Until the staff check below has answered, an active staff row reads as
      // a guest: nothing routes to Today, or writes the staff hint, on the way.
      holdStaffStatus(true);
      try {
        let user: User | null;
        let fullName: string | null = null;
        if (provider === 'apple') {
          const nonce = await newNonce();
          const credential = await requestAppleCredential(nonce.hashed);
          fullName = credential.fullName;
          // RAW nonce here — GoTrue hashes it and compares with the token's claim.
          ({ user } = await signInWithIdToken(supabase, {
            provider,
            token: credential.identityToken,
            nonce: nonce.raw,
          }));
        } else {
          user = await signInWithGoogle(via, () => setGoogleBrowserOffer(true));
        }

        // Staff sign in with email and password only (build-contracts §6.6).
        // GoTrue links a provider to an account with the same verified email, so
        // this may be a staff account: sign it straight out and say why. Only a
        // row known to be active refuses. A read that fails is no answer, so a
        // guest is not signed out over it: the guest path runs, and
        // StaffStatusProvider, which never lets a provider session into the
        // staff area, refuses it once its own read of the row answers.
        if (user) {
          let refused = false;
          try {
            refused = refusesSocialSignIn(await readOwnStaffRow(queryClient, user.id));
          } catch (error) {
            captureException(error, { scope: 'auth.social.staffCheck' });
          }
          if (refused) {
            claimSocialRefusal(user.id);
            addBreadcrumb('auth.social.staffRefused', { provider });
            await signOut(supabase).catch((e) => captureException(e, { scope: 'auth.social.staffSignOut' }));
            const text = t('staff.shell.socialRefused');
            setErrorText(text);
            // The screen may already have given way to a gate's spinner; the
            // toast host sits above every route, so the reason is still read.
            toast(text, 'error');
            return;
          }
        }

        // Same cache entry the (auth) layout's useOwnProfile observes: one request.
        // Read BEFORE any name patch: GoTrue may have linked this identity to an
        // EXISTING account (same verified email), whose row must not be overwritten.
        let profile = await queryClient.fetchQuery({
          queryKey: profileKeys.own,
          queryFn: () => fetchOwnProfile(supabase),
          staleTime: 0,
        });

        // Apple hands the name over ONCE, on the first authorization. Write it now
        // or it is gone — but only into a blank / trigger-fallback name (a linked
        // guest keeps the name she chose). Best-effort: the complete-profile name
        // field is editable.
        const patch = buildProfilePatch(provider, {
          fullName,
          existingFullName: profile?.full_name,
          email: user?.email,
        });
        if (patch && user) {
          try {
            await updateOwnProfile(supabase, user.id, patch);
            await setUserMetadata(supabase, patch);
            if (profile) {
              // The server splits the new full_name into given_name and
              // family_name (0256, guest.md §4.9); the cached parts are still
              // the split of the trigger's fallback ('k3x9q2'). Dropped here,
              // so complete-profile prefills its two fields from the patched
              // full_name until the refetch brings the server's parts.
              profile = { ...profile, ...patch, given_name: null, family_name: null };
              queryClient.setQueryData(profileKeys.own, profile);
            }
          } catch (error) {
            captureException(error, { scope: 'auth.social.name', provider });
          }
        }
        // D3: phone required before the flow continues. The decision (and why
        // the no-slot case navigates nowhere) is postSignInStep's, shared with
        // the email sign-in so the two paths cannot drift.
        const step = postSignInStep(profile, hasPendingIntent());
        addBreadcrumb('auth.social.success', { provider, incomplete: step !== 'continue' });
        if (step === 'complete-profile') {
          router.replace({ pathname: '/complete-profile', params: { returnTo: 'continue' } });
        }
        if (step !== 'continue') return;
        onComplete();
      } catch (error) {
        const outcome = mapSocialError(error);
        if (outcome.kind === 'cancelled') {
          // `detail` = which cascade step was dismissed (providers/google.ts);
          // never a token, nonce or email.
          addBreadcrumb('auth.social.cancelled', {
            provider,
            detail: error instanceof SocialAuthError ? error.message : undefined,
          });
          return;
        }
        if (outcome.report) captureException(error, { scope: 'auth.social', provider });
        else addBreadcrumb('auth.social.failed', { provider, key: outcome.key });
        setErrorText(t(outcome.key, { provider: isolate(PROVIDER_LABEL[provider]) }));
      } finally {
        holdStaffStatus(false);
        busyRef.current = false;
        setBusyProvider(null);
      }
    },
    [disabled, onComplete, queryClient, router, t, toast],
  );

  const clearError = useCallback(() => setErrorText(null), []);

  return { available, busyProvider, errorText, clearError, googleBrowserOffer, signInWith };
}
