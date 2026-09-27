import type { Locale } from '@touch/i18n';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { fetchOwnProfile, updateOwnProfile } from './api';
import { acceptTerms, fetchOwnConsent } from './consent';

export const profileKeys = {
  own: ['own-profile'] as const,
  /** 0153: the caller's accepted Terms/Privacy version, per account. */
  consent: (uid: string) => ['own-consent', uid] as const,
};

export function useOwnProfile(enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.own,
    queryFn: () => fetchOwnProfile(supabase),
    enabled,
    staleTime: 60_000,
  });
}

export function useUpdateProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['update-profile'],
    mutationFn: async (fields: { full_name?: string; phone?: string | null; preferred_lang?: Locale }) => {
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) throw new Error('NO_SESSION');
      await updateOwnProfile(supabase, uid, fields);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.own });
    },
  });
}

/** The caller's consent record (0153); `uid` null = no account session, nothing to read. */
export function useOwnConsent(uid: string | null) {
  return useQuery({
    queryKey: profileKeys.consent(uid ?? ''),
    queryFn: () => fetchOwnConsent(supabase, uid!),
    enabled: uid !== null,
    staleTime: 5 * 60_000,
  });
}

/** Records acceptance of CURRENT_TERMS_VERSION through app.accept_terms. */
export function useAcceptTerms() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['accept-terms'],
    mutationFn: () => acceptTerms(supabase),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['own-consent'] });
    },
  });
}
