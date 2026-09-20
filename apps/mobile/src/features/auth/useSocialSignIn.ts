/**
 * Social sign-in orchestration shared by sign-in.tsx and sign-up.tsx (vendor
 * addition 2026-09-01). One attempt = fresh nonce -> provider sheet -> Supabase
 * id-token grant -> (Apple) first-authorization name patch -> profile read ->
 * either the complete-profile step (D3: no phone yet) or the SAME post-auth
 * continuation the email path uses (welcome-back toast + continueAfterAuth).
 *
 * The provider SDKs are behind ./providers/*; everything decidable without them
 * is in ./social.ts and unit-tested there.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { isolate } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { addBreadcrumb, captureException } from '../../lib/telemetry';
import { useLocale } from '../../i18n/LocaleProvider';
import { fetchOwnProfile, updateOwnProfile } from '../profile/api';
import { profileKeys } from '../profile/hooks';
import { getPendingSlot } from '../booking/pendingSlot';
import { setUserMetadata, signInWithIdToken } from './api';
import {
  PROVIDER_LABEL,
  SocialAuthError,
  buildProfilePatch,
  mapSocialError,
  postSignInStep,
  type SocialProvider,
} from './social';
import { newNonce } from './providers/nonce';
import { appleSignInExpected, isAppleSignInAvailable, requestAppleCredential } from './providers/apple';
import { isGoogleSignInAvailable, requestGoogleIdToken } from './providers/google';

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
  signInWith: (provider: SocialProvider) => Promise<void>;
}

export function useSocialSignIn(opts: { onComplete: () => void; disabled?: boolean }): UseSocialSignIn {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { t } = useLocale();
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
    async (provider: SocialProvider) => {
      if (busyRef.current || disabled) return;
      busyRef.current = true;
      setBusyProvider(provider);
      setErrorText(null);
      addBreadcrumb('auth.social.start', { provider });
      try {
        const nonce = await newNonce();
        let token: string;
        let fullName: string | null = null;
        if (provider === 'apple') {
          const credential = await requestAppleCredential(nonce.hashed);
          token = credential.identityToken;
          fullName = credential.fullName;
        } else {
          const credential = await requestGoogleIdToken(nonce.hashed);
          token = credential.idToken;
        }
        // RAW nonce here — GoTrue hashes it and compares with the token's claim.
        const { user } = await signInWithIdToken(supabase, { provider, token, nonce: nonce.raw });

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
              profile = { ...profile, ...patch };
              queryClient.setQueryData(profileKeys.own, profile);
            }
          } catch (error) {
            captureException(error, { scope: 'auth.social.name', provider });
          }
        }
        // D3: phone required before the flow continues. The decision (and why
        // the no-slot case navigates nowhere) is postSignInStep's, shared with
        // the email sign-in so the two paths cannot drift.
        const step = postSignInStep(profile, getPendingSlot() !== null);
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
        busyRef.current = false;
        setBusyProvider(null);
      }
    },
    [disabled, onComplete, queryClient, router, t],
  );

  const clearError = useCallback(() => setErrorText(null), []);

  return { available, busyProvider, errorText, clearError, signInWith };
}
