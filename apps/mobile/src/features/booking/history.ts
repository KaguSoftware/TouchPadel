/**
 * "Clear history" — the Booking history panel's cut, kept on the DEVICE.
 *
 * A reservation is the venue's record as much as the guest's, so clearing
 * history hides past games here and deletes nothing: no RPC, no row touched.
 * The cut is a single ISO timestamp; `visiblePast` (./logic) drops every past
 * game that had already ended when it was written.
 *
 * Stored per user id, because a phone is not an account: signing a second
 * person in on the same handset used to be the classic way for one guest's
 * preference to erase another's list.
 *
 * It rides the query cache rather than component state so the panel and the
 * bookings tab see the same cut without either owning it — and the cache is
 * persisted to the same AsyncStorage anyway (lib/queryClient.ts).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { captureException } from '../../lib/telemetry';
import { useAuth } from '../auth/context';
// Defined in a pure module: the SEC-16 deletion purge must name this key too,
// and cannot import this file (react-query / AsyncStorage). Re-exported so
// every existing call site is unchanged.
import { historyClearedKey } from './historyKeys';

export { historyClearedKey };


export const historyKeys = {
  clearedAt: (userId: string) => ['history-cleared-at', userId] as const,
};

async function readClearedAt(userId: string): Promise<string | null> {
  try {
    return await AsyncStorage.getItem(historyClearedKey(userId));
  } catch (error) {
    // A storage read that fails must not blank the list: showing every past
    // game is the safe side of this decision, so it degrades to "not cleared".
    captureException(error, { scope: 'history.read' });
    return null;
  }
}

/**
 * The cut, or null when history has never been cleared (or nobody is signed
 * in). `staleTime: Infinity` — nothing but this device writes it, and the
 * mutation below invalidates on write.
 */
export function useHistoryClearedAt() {
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  return useQuery({
    queryKey: historyKeys.clearedAt(userId),
    queryFn: () => readClearedAt(userId),
    enabled: !!userId,
    staleTime: Infinity,
  });
}

/** Write "everything that has already ended is hidden" as of now. */
export function useClearHistory() {
  const queryClient = useQueryClient();
  const { session } = useAuth();
  const userId = session?.user.id ?? '';
  return useMutation({
    mutationFn: async () => {
      const at = new Date().toISOString();
      await AsyncStorage.setItem(historyClearedKey(userId), at);
      return at;
    },
    onSuccess: (at) => {
      // Set before invalidating so the list empties in the same commit as the
      // toast, rather than a frame later when the re-read lands.
      queryClient.setQueryData(historyKeys.clearedAt(userId), at);
      void queryClient.invalidateQueries({ queryKey: historyKeys.clearedAt(userId) });
    },
  });
}
