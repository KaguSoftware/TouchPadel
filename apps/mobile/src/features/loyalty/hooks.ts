/**
 * The guest's loyalty React bindings (loyalty plan §5.1): `my_loyalty` and `my_member_card` as
 * queries, `rotate_member_card` as a mutation, all under `loyaltyKeys`.
 *
 * Retry, online-pause and persistence are set once in lib/queryClient.ts by the key prefixes:
 * the card never reaches the disk cache (SecureStore holds its offline copy, cardStore.ts), and
 * the rotation runs now or fails now. A screen never overrides them.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberCard } from '@touch/core/loyalty';
import { supabase } from '../../lib/supabase';
import { fetchMyLoyalty, fetchMyMemberCard, rotateMemberCard } from './api';
import { readCachedCard, storeCachedCard } from './cardStore';
import { loyaltyKeys } from './keys';

export { loyaltyKeys };

/** Balance, tier, history and rewards. `enabled` false for a signed-out or anonymous session. */
export function useMyLoyalty(enabled: boolean) {
  return useQuery({
    queryKey: loyaltyKeys.mine,
    queryFn: () => fetchMyLoyalty(supabase),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * The member card for `userId`: the server's answer when there is one, else the copy this phone
 * kept (SecureStore), so the QR draws at a till with no signal. Every good answer refreshes that
 * copy. `card` is null only when neither has a card.
 */
export function useMemberCard(userId: string | null) {
  // Tagged with the account it was read for, so a switch of account never draws the last one's.
  const [stored, setStored] = useState<{ uid: string; card: MemberCard | null } | null>(null);
  useEffect(() => {
    if (!userId) return;
    let live = true;
    void readCachedCard(userId).then((card) => {
      if (live) setStored({ uid: userId, card });
    });
    return () => {
      live = false;
    };
  }, [userId]);
  const cached = stored && stored.uid === userId ? stored.card : null;

  const query = useQuery({
    queryKey: loyaltyKeys.card,
    queryFn: async () => {
      const card = await fetchMyMemberCard(supabase);
      if (userId) void storeCachedCard(userId, card);
      return card;
    },
    enabled: !!userId,
    staleTime: 5 * 60_000,
  });

  return { card: query.data ?? cached, cached: !query.data && !!cached, query };
}

/** "Not working? Get a new code": a new secret, drawn at once and kept for offline. */
export function useRotateMemberCard(userId: string | null) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: loyaltyKeys.mutation('rotate'),
    mutationFn: () => rotateMemberCard(supabase),
    onSuccess: (card) => {
      queryClient.setQueryData(loyaltyKeys.card, card);
      if (userId) void storeCachedCard(userId, card);
    },
  });
}
