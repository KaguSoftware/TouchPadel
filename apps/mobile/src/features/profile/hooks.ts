import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { fetchOwnProfile, updateOwnProfile } from './api';

export const profileKeys = { own: ['own-profile'] as const };

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
    mutationFn: async (fields: { full_name?: string; phone?: string | null }) => {
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
