import { useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../auth/context';
import { profileKeys, useOwnProfile } from '../profile/hooks';
import type { ProfileRow } from '../profile/api';
import { setMyPlayProfile } from './api';
import { useTournamentsPublic } from '../tournaments/hooks';
import { tournamentRows } from '../tournaments/logic';
import { tournamentAvailability } from './fit';
import type { SuggestionKind } from './suggest';
import { playProfileOf, rowPatchOf, type PlayAnswers, type PlayProfile } from './logic';

/**
 * The signed-in guest's play profile, from the own-profile row (one read, the
 * same cache entry every screen shares). Null while it cannot be known: signed
 * out, still loading, or a row cached by a build from before 0334.
 */
export function usePlayProfile(): PlayProfile | null {
  const { session } = useAuth();
  const signedIn = !!session && !session.user.is_anonymous;
  const profile = useOwnProfile(signedIn);
  return signedIn ? playProfileOf(profile.data) : null;
}

/**
 * Save the answers (a skip is a save with none) and write what the server
 * stamped into the own-profile cache at once, so the Play strip, the Coaches
 * tab's level and the survey's own trigger all see it before any refetch.
 * Plain async, not only a hook: a sheet swiped away saves from its unmount,
 * when its hooks are already gone.
 */
export async function savePlayProfile(queryClient: QueryClient, answers: PlayAnswers): Promise<PlayProfile> {
  const saved = await setMyPlayProfile(supabase, answers);
  queryClient.setQueryData<ProfileRow | null>(profileKeys.own, (row) =>
    row ? { ...row, ...rowPatchOf(saved) } : row,
  );
  void queryClient.invalidateQueries({ queryKey: profileKeys.own });
  return saved;
}

export function useSavePlayProfile() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: ['set-play-profile'],
    mutationFn: (answers: PlayAnswers) => savePlayProfile(queryClient, answers),
  });
}

/**
 * What the suggestions have behind them (0339): an Americano or Mexicano suggestion only while
 * an open one fits the guest. Undefined until the list is known: everything counts as on offer.
 */
export function useSuggestionAvailability(): Partial<Record<SuggestionKind, boolean>> | undefined {
  const play = usePlayProfile();
  const pub = useTournamentsPublic();
  if (!pub.data) return undefined;
  if (pub.data.off) return { americano: false, mexicano: false };
  return tournamentAvailability(
    tournamentRows(pub.data, 'upcoming'),
    play ? { level: play.level, years: play.years } : null,
  );
}
