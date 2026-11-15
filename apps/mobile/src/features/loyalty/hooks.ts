/**
 * The guest's loyalty React bindings (loyalty plan §5.1): `my_loyalty`, `my_member_card` and
 * `my_deals` (0410) as queries, `rotate_member_card` and `pick_deal` as mutations, all under
 * `loyaltyKeys`.
 *
 * Retry, online-pause and persistence are set once in lib/queryClient.ts by the key prefixes:
 * the card never reaches the disk cache (SecureStore holds its offline copy, cardStore.ts), the
 * deals never do either (live state), and both writes run now or fail now. A screen never
 * overrides them.
 */
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MemberCard } from '@touch/core/loyalty';
import { supabase } from '../../lib/supabase';
import {
  cancelRewardVoucher,
  fetchMyDeals,
  fetchMyLoyalty,
  fetchMyMemberCard,
  fetchMyRewardVouchers,
  pickDeal,
  redeemReward,
  rotateMemberCard,
} from './api';
import { rewardIdemKey } from '../../lib/idempotency';
import { VOUCHER_POLL_MS } from './vouchers';
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

/**
 * The listed deals and the one picked (0410). `enabled` false for a signed-out or anonymous
 * session. A server without deals answers an empty list, so `data.deals.length` is the only
 * thing a screen needs to ask; a failed read is simply no deals to show.
 */
export function useMyDeals(enabled: boolean) {
  return useQuery({
    queryKey: loyaltyKeys.deals,
    queryFn: () => fetchMyDeals(supabase),
    enabled,
    staleTime: 60_000,
  });
}

/**
 * "Use at the cashier" (a deal's id) and its undo (null). The answer IS the deals again, so the
 * cache takes it as it came; a refusal means the list on screen is out of date (the deal ended,
 * was used, or the card dropped under it), so it is read again.
 */
export function usePickDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: loyaltyKeys.mutation('pick-deal'),
    mutationFn: (promotionId: string | null) => pickDeal(supabase, promotionId),
    onSuccess: (deals) => {
      queryClient.setQueryData(loyaltyKeys.deals, deals);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.deals });
    },
  });
}

/**
 * The rewards redeemed in the app (0415): the active ones and those ended in the last half hour,
 * with the server clock (`data.now`, read at `dataUpdatedAt`). `poll` asks again every few
 * seconds while a voucher is on screen, so it turns to "collected" when the till scans it.
 */
export function useMyRewardVouchers(enabled: boolean, poll = false) {
  return useQuery({
    queryKey: loyaltyKeys.vouchers,
    queryFn: () => fetchMyRewardVouchers(supabase),
    enabled,
    staleTime: poll ? 0 : 30_000,
    refetchInterval: poll ? VOUCHER_POLL_MS : false,
  });
}

/**
 * Redeem a reward (0415): a fresh key per press. The new voucher goes straight into the list, and
 * the balance is read again (the points left at once).
 */
export function useRedeemReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: loyaltyKeys.mutation('redeem'),
    mutationFn: (rewardId: string) => redeemReward(supabase, rewardId, rewardIdemKey()),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.mine });
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.vouchers });
    },
  });
}

/** Cancel an active voucher (0415): its points come back. */
export function useCancelRewardVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: loyaltyKeys.mutation('cancel-voucher'),
    mutationFn: (voucherId: string) => cancelRewardVoucher(supabase, voucherId),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.mine });
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.vouchers });
    },
  });
}
