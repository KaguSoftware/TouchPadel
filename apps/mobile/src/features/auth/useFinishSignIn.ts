import { useCallback } from 'react';
import { useRouter } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import type { User } from '@supabase/supabase-js';
import { supabase } from '../../lib/supabase';
import { readOwnStaffRow } from '../staff/api';
import { writeStaffHint } from '../staff/hint';
import { clearPendingIntents, hasPendingIntent } from '../booking/pendingIntent';
import { fetchOwnProfile } from '../profile/api';
import { profileKeys } from '../profile/hooks';
import { useLocale } from '../../i18n/LocaleProvider';
import { useToast } from '../../components/overlays';
import { postSignInStep } from './social';

/**
 * What happens once a sign-in has a session: the email + password sign-in
 * (app/sign-in.tsx) and the phone code sign-in (app/verify-otp.tsx, mode
 * signin) both land here, so a staff account, an incomplete profile and a
 * pending slot are routed the same way whichever way the guest came in.
 *
 * Staff sign in here too (build-contracts-2026-09-23 §6.6). The row is read
 * under the status provider's own key, so it asks nothing twice, and alongside
 * the profile, because RequireNoSession waits for both. A read that fails is
 * no answer: the guest path runs, and the provider routes a staff account to
 * Today once its own read lands.
 */
export function useFinishSignIn(continueAfterAuth: () => void) {
  const { t } = useLocale();
  const router = useRouter();
  const toast = useToast();
  const queryClient = useQueryClient();

  return useCallback(
    async (user: User | null) => {
      const staffRead = user ? readOwnStaffRow(queryClient, user.id).catch(() => null) : Promise.resolve(null);
      // Same cache entry RequireNoSession's useOwnProfile observes: one request.
      const profile = await queryClient.fetchQuery({
        queryKey: profileKeys.own,
        queryFn: () => fetchOwnProfile(supabase),
        staleTime: 0,
      });
      const staffRow = await staffRead;
      // A slot or an open-match intent (guest.md §4.18): either keeps RequireNoSession
      // from redirecting, so an incomplete profile is sent on from here.
      switch (postSignInStep(profile, hasPendingIntent(), staffRow)) {
        case 'staff':
          // A staff account books nothing: the slot or match a guest tapped is dropped.
          clearPendingIntents();
          if (user) await writeStaffHint(user.id);
          toast(t('auth.welcomeBack'), 'info');
          router.replace('/staff');
          return;
        case 'complete-profile':
          router.replace({ pathname: '/complete-profile', params: { returnTo: 'continue' } });
          return;
        case 'await-gate':
          // RequireNoSession routes the incomplete profile there itself.
          return;
        default:
          toast(t('auth.welcomeBack'), 'info');
          continueAfterAuth();
      }
    },
    [continueAfterAuth, queryClient, router, t, toast],
  );
}
