/**
 * Who a player is, the server half (0368): the level a coach, the desk, a
 * manager or the owner confirms, the age band the desk fills in, and the queue
 * of players whose games disagree with what the club has on record. Every call
 * is an online-only `app.*` RPC through appRpc, like the customer discount
 * writes: no queued mutation type, no PIN.
 *
 * The facts themselves arrive inside `app.customer_record`, so there is no
 * read here for one player; a write invalidates `['customer', id]` and the
 * record brings the new block back with it.
 */
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { appRpc } from '../../lib/appRpc';
import { can, type Capability, type StaffWho } from '../../lib/auth';
import type { AgeBand, PlayLevel } from './playerLogic';
import { parseLevelReviews } from './playerLogic';

/**
 * Who may judge a level in the operator: the court desk, a manager and the
 * owner. A coach may too (app.staff_set_customer_level), but a coach is a
 * guest account and never signs in here.
 */
export const JUDGE_CAPABILITY: Capability = 'judgePlayerLevel';

export function canJudgeLevel(who: StaffWho): boolean {
  return can(who, JUDGE_CAPABILITY);
}

/** A server without 0368: every player surface renders nothing at all. */
export function rpcMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'RPC_MISSING';
}

export const PLAYER_KEYS = {
  /** The queue, business-wide: a level is a property of the player, not of a branch. */
  reviews: ['levelReviews'] as const,
};

export function useLevelReviews(enabled: boolean, limit = 30) {
  return useQuery({
    queryKey: PLAYER_KEYS.reviews,
    queryFn: async () => parseLevelReviews(await appRpc<unknown>('customer_level_reviews', { p_limit: limit })),
    enabled,
    staleTime: 60_000,
  });
}

/** Both facts in one press: only what changed is sent (playerLogic.saveSteps). */
export interface SavePlayerFacts {
  customerId: string;
  band: AgeBand | null | 'keep';
  level: { level: PlayLevel | null; note: string | null } | 'keep';
}

export async function savePlayerFacts({ customerId, band, level }: SavePlayerFacts): Promise<void> {
  if (band !== 'keep') {
    await appRpc('staff_set_customer_age_band', { p_customer_id: customerId, p_band: band });
  }
  if (level !== 'keep') {
    await appRpc('staff_set_customer_level', {
      p_customer_id: customerId,
      p_level: level.level,
      p_note: level.note,
    });
  }
}

export function invalidatePlayer(client: QueryClient, customerId: string): void {
  void client.invalidateQueries({ queryKey: ['customer', customerId] });
  void client.invalidateQueries({ queryKey: PLAYER_KEYS.reviews });
}

/** The record's dialog and the queue's rows share this one write. */
export function useSavePlayerFacts(customerId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['save-player-facts', customerId],
    mutationFn: (args: Omit<SavePlayerFacts, 'customerId'>) => savePlayerFacts({ customerId, ...args }),
    onSuccess: () => invalidatePlayer(client, customerId),
  });
}

/** The queue's own row buttons: confirm a level for someone, then re-read the list. */
export function useConfirmLevel() {
  const client = useQueryClient();
  return useMutation({
    mutationKey: ['confirm-player-level'],
    mutationFn: ({ profileId, level }: { profileId: string; level: PlayLevel }) =>
      savePlayerFacts({ customerId: profileId, band: 'keep', level: { level, note: null } }),
    onSuccess: (_void, { profileId }) => invalidatePlayer(client, profileId),
  });
}
