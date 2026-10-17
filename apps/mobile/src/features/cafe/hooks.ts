/**
 * The café menu's React binding: one branch's menu under `cafeKeys.menu`. Retry, online-pause and
 * persistence are set once in lib/queryClient.ts; the menu is public, so it is kept on disk.
 */
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import { fetchCafeMenu } from './api';
import { cafeKeys } from './keys';

export { cafeKeys };

/** The menu of `venueId`; idle until the branch is known. */
export function useCafeMenu(venueId: string | null) {
  return useQuery({
    queryKey: cafeKeys.menu(venueId ?? ''),
    queryFn: () => fetchCafeMenu(supabase, venueId!),
    enabled: !!venueId,
    staleTime: 5 * 60_000,
  });
}
