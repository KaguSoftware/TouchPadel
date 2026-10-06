import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import {
  checkUsername,
  fetchMyBirthDate,
  fetchMyFrames,
  fetchOwnProfile,
  setMyBirthDate,
  setMyFrame,
  setMyUsername,
  suggestUsername,
  updateOwnProfile,
} from './api';
import { avatarUrl, AVATAR_URL_TTL_S, removeAvatar, replaceAvatar } from './avatar';
import { acceptTerms, fetchOwnConsent } from './consent';

export const profileKeys = {
  own: ['own-profile'] as const,
  /** 0153: the caller's accepted Terms/Privacy version, per account. */
  consent: (uid: string) => ['own-consent', uid] as const,
  /** 0302: the caller's date of birth. Never persisted (src/lib/queryClient.ts). */
  birthDate: ['own-birth-date'] as const,
  /** 0302: a signed avatar URL, per path. Never persisted: it expires. */
  avatarUrl: (path: string) => ['avatar-url', path] as const,
  /** 0307: the live availability answer for one typed name. Never persisted. */
  usernameCheck: (name: string) => ['username-check', name] as const,
  /** 0307: a suggested username. Never persisted: it goes stale as names are taken. */
  usernameSuggestion: ['username-check', 'suggest'] as const,
  /** 0307: the frame picker (closed list + what is unlocked). */
  frames: ['own-frames'] as const,
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
    mutationFn: async (fields: Parameters<typeof updateOwnProfile>[2]) => {
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
    onSuccess: (row) => {
      // Into the cache now, before the screen closes. Only invalidating left the
      // old row in place until the refetch landed, and the route change from
      // closing the screen made the gate present it again.
      queryClient.setQueriesData({ queryKey: ['own-consent'] }, row);
      void queryClient.invalidateQueries({ queryKey: ['own-consent'] });
    },
  });
}

/** The caller's date of birth (0302), `YYYY-MM-DD` or null. */
export function useMyBirthDate(enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.birthDate,
    queryFn: () => fetchMyBirthDate(supabase),
    enabled,
    staleTime: 5 * 60_000,
  });
}

/** Sets (`YYYY-MM-DD`) or clears (null) the date of birth. */
export function useSetBirthDate() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['set-birth-date'],
    mutationFn: (birthDate: string | null) => setMyBirthDate(supabase, birthDate),
    onSuccess: (_void, birthDate) => {
      queryClient.setQueryData(profileKeys.birthDate, birthDate);
    },
  });
}

/** A signed URL for an avatar path; refetched well before the URL expires. */
export function useAvatarUrl(path: string | null | undefined) {
  return useQuery({
    queryKey: profileKeys.avatarUrl(path ?? ''),
    queryFn: () => avatarUrl(path!),
    enabled: !!path,
    staleTime: (AVATAR_URL_TTL_S / 2) * 1000,
    gcTime: (AVATAR_URL_TTL_S / 2) * 1000,
  });
}

/** Upload a picked photo and make it the profile's (`uri`), or go back to initials (null). */
export function useSetAvatar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['set-avatar'],
    mutationFn: async (photoUri: string | null) => {
      if (photoUri === null) return removeAvatar();
      const { data } = await supabase.auth.getUser();
      const uid = data.user?.id;
      if (!uid) throw new Error('NO_SESSION');
      await replaceAvatar(uid, photoUri);
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.own });
    },
  });
}

/** app.username_check for a typed name (already normalised and shaped). */
export function useUsernameCheck(name: string, enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.usernameCheck(name),
    queryFn: () => checkUsername(supabase, name),
    enabled: enabled && name.length > 0,
    staleTime: 10_000,
    gcTime: 60_000,
  });
}

/** A free username built from the guest's name (hassan.s). */
export function useUsernameSuggestion(enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.usernameSuggestion,
    queryFn: () => suggestUsername(supabase),
    enabled,
    staleTime: 30_000,
  });
}

export function useSetUsername() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['set-username'],
    mutationFn: (username: string) => setMyUsername(supabase, username),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.own });
      void queryClient.invalidateQueries({ queryKey: ['username-check'] });
    },
  });
}

/** The caller's frame picker. */
export function useMyFrames(enabled: boolean) {
  return useQuery({
    queryKey: profileKeys.frames,
    queryFn: () => fetchMyFrames(supabase),
    enabled,
    staleTime: 60_000,
  });
}

export function useSetFrame() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['set-frame'],
    mutationFn: (frame: string) => setMyFrame(supabase, frame),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: profileKeys.own });
      void queryClient.invalidateQueries({ queryKey: profileKeys.frames });
    },
  });
}
