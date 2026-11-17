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
import type { CardRewardKind, MemberCard, MyDealVouchers } from '@touch/core/loyalty';
import { supabase } from '../../lib/supabase';
import {
  cancelDealVoucher,
  cancelRewardVoucher,
  claimCardReward,
  fetchMyDealVouchers,
  redeemDeal,
  fetchMyCardExtras,
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

/**
 * The drink card and the birthday gifts (0445). `enabled` false for a signed-out or anonymous
 * session. A server without them answers "off", so the screens simply show nothing new.
 */
/**
 * A deal's own codes (0445, 2026-11-15): the live one and those ended in the last half hour, with
 * the server clock (`data.now`, read at `dataUpdatedAt`). `poll` asks again every few seconds
 * while a code is on screen, so a till's scan turns it to used by itself.
 */
export function useMyDealVouchers(enabled: boolean, poll = false) {
  return useQuery({
    queryKey: loyaltyKeys.dealVouchers,
    queryFn: () => fetchMyDealVouchers(supabase),
    enabled,
    staleTime: 0,
    refetchInterval: poll ? VOUCHER_POLL_MS : false,
  });
}

/** Redeem on a deal: a new 15-minute code. The deals and the codes are read again after it. */
export function useRedeemDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: loyaltyKeys.mutation('redeem-deal'),
    mutationFn: (promotionId: string) => redeemDeal(supabase, promotionId),
    // The new code is on screen at once: the one before it is cancelled, as the server did.
    onSuccess: (r) => {
      queryClient.setQueryData<MyDealVouchers>(loyaltyKeys.dealVouchers, (old) => ({
        now: r.now,
        vouchers: [
          r.voucher,
          ...(old?.vouchers ?? [])
            .filter((v) => v.id !== r.voucher.id)
            .map((v) => (v.status === 'active' ? { ...v, status: 'cancelled' as const, ended_at: r.now } : v)),
        ],
      }));
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.dealVouchers });
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.deals });
    },
  });
}

/** Cancel a live deal code; the answer IS the codes again. */
export function useCancelDealVoucher() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: loyaltyKeys.mutation('cancel-deal-voucher'),
    mutationFn: (voucherId: string) => cancelDealVoucher(supabase, voucherId),
    onSuccess: (codes) => {
      queryClient.setQueryData(loyaltyKeys.dealVouchers, codes);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.dealVouchers });
    },
  });
}

/**
 * Redeem on the free drink or a card gift (0445). The answer IS the extras again, so the cache
 * takes it as it came; a refusal means what is on screen is out of date, so it is read again.
 */
export function useClaimCardReward() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationKey: loyaltyKeys.mutation('claim-reward'),
    mutationFn: (v: { kind: CardRewardKind; perkId: string | null }) =>
      claimCardReward(supabase, v.kind, v.perkId),
    onSuccess: (extras) => {
      queryClient.setQueryData(loyaltyKeys.extras, extras);
    },
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: loyaltyKeys.extras });
    },
  });
}

export function useMyCardExtras(enabled: boolean) {
  return useQuery({
    queryKey: loyaltyKeys.extras,
    queryFn: () => fetchMyCardExtras(supabase),
    enabled,
    staleTime: 60_000,
  });
}
