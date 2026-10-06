/**
 * Loyalty reads and writes on the operator (docs/design/loyalty/build-contracts-2026-10-05.md
 * §1.3). Every write is an online-only app.* RPC through appRpc, like apply_best_promotion
 * (L-6: no queued mutation type), so the six-place parity lists stay untouched.
 *
 * Keys are this feature's own. The tab's member rides under ['tab', id], so the till's
 * refresh() (['tab', id]) and queueResults' tab invalidations re-read it with the tab; the
 * record's panel rides under ['customer', id] for the same reason.
 */
import { useQuery, type QueryClient } from '@tanstack/react-query';
import type {
  IdentifiedMember,
  LoyaltyAdmin,
  LoyaltyAdminReward,
  RedeemResult,
} from '@touch/core/loyalty';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { currentBranchId } from '../../lib/venueScope';
import { deviceId, onlineKey } from '../../lib/idem';
import { touch } from '../../ipc/bridge';
import {
  memberView,
  readLoyaltyCustomer,
  type AdjustmentLike,
  type MemberView,
  type RedeemTerms,
} from './loyaltyLogic';

export const LOYALTY_KEYS = {
  /** The member and loyalty rows of one tab (a child of the tab's own key). */
  tab: (tabId: string) => ['tab', tabId, 'loyalty'] as const,
  /** The chip's member: identify answer + loyalty_customer. */
  member: (customerId: string) => ['loyaltyMember', customerId] as const,
  /** The customer record's panel (a child of the record's own key). */
  customer: (customerId: string) => ['customer', customerId, 'loyalty'] as const,
  /** What the till may know of the settings and rewards. */
  terms: ['loyaltyTerms'] as const,
  /** Setup › Loyalty. */
  admin: ['loyaltyAdmin'] as const,
};

/**
 * Identify answers by customer, for this run of the app. A tab re-read after a reload knows its
 * customer only by id; the name comes back the next time the card is scanned. loyalty_identify
 * writes an audit row each call, so it is never re-issued just to repaint a chip.
 */
const identified = new Map<string, IdentifiedMember>();

/**
 * The member token last scanned for each customer (0308, c2): loyalty_redeem spends it as the
 * proof the member is at the till. The server takes a token within one step (30 s) either side
 * of now, once; an older one, or none, means a manager PIN instead.
 */
const scanned = new Map<string, { token: string; at: number }>();
const TOKEN_FRESH_MS = 45_000;

export async function identifyMember(code: string): Promise<IdentifiedMember> {
  const answer = await appRpc<IdentifiedMember & { error?: string }>('loyalty_identify', {
    p_code: code,
    p_venue_id: currentBranchId(),
  });
  // 0308: a miss is answered, not raised, so the server can count it (the throttle).
  if (answer.error || !answer.customer_id) {
    const c = answer.error ?? 'MEMBER_NOT_FOUND';
    throw new AppRpcError(c, c);
  }
  identified.set(answer.customer_id, answer);
  if (code.toUpperCase().startsWith('TP-')) {
    scanned.set(answer.customer_id, { token: code, at: Date.now() });
  } else {
    scanned.delete(answer.customer_id);
  }
  return answer;
}

/** The member's scanned token while it can still prove they are here, else null. */
export function freshMemberToken(customerId: string, now = Date.now()): string | null {
  const s = scanned.get(customerId);
  return s && now - s.at < TOKEN_FRESH_MS ? s.token : null;
}

/** A token is spent once: after a redemption (or a refusal of it) it proves nothing more. */
export function forgetMemberToken(customerId: string): void {
  scanned.delete(customerId);
}

/**
 * A manager PIN grant for the next PIN-gated call (the 0115 pattern): verify_manager_pin in its
 * own round trip, so the attempt row commits whatever happens next; null answers PIN_INVALID.
 */
export async function grantManagerPin(pin: string): Promise<void> {
  const authorizer = await appRpc<string | null>('verify_manager_pin', {
    p_pin: pin,
    p_device_id: deviceId(),
  });
  if (authorizer === null) throw new AppRpcError('PIN_INVALID', 'PIN_INVALID');
  touch.pinObserved(pin, authorizer);
}

export function knownMember(customerId: string): IdentifiedMember | null {
  return identified.get(customerId) ?? null;
}

export function setTabCustomer(tabId: string, customerId: string | null): Promise<unknown> {
  return appRpc('set_tab_customer', { p_tab_id: tabId, p_customer_id: customerId });
}

/** One key per opened "Use points" or reward choice, so a double press replays (claim_replay). */
export function redeemKey(): string {
  return onlineKey('loyalty_redeem');
}

/**
 * The proof loyalty_redeem needs (0308, c2): the member's scanned token, or (token null) a
 * manager PIN grant minted just before with grantManagerPin.
 */
export function redeemPoints(
  tabId: string,
  points: number,
  key: string,
  memberToken: string | null,
): Promise<RedeemResult> {
  return appRpc<RedeemResult>('loyalty_redeem', {
    p_tab_id: tabId,
    p_points: points,
    p_reward_id: null,
    p_idempotency_key: key,
    p_member_token: memberToken,
  });
}

export function redeemReward(
  tabId: string,
  rewardId: string,
  key: string,
  memberToken: string | null,
): Promise<RedeemResult> {
  return appRpc<RedeemResult>('loyalty_redeem', {
    p_tab_id: tabId,
    p_points: null,
    p_reward_id: rewardId,
    p_idempotency_key: key,
    p_member_token: memberToken,
  });
}

export function unredeem(adjustmentId: string): Promise<{ balance: number }> {
  return appRpc<{ balance: number }>('loyalty_unredeem', { p_adjustment_id: adjustmentId });
}

/**
 * Adjust a member's points behind a manager PIN: the 0115 grant pattern (tillShift/api.ts).
 * verify_manager_pin first, in its own round trip so the attempt row commits whatever happens
 * next; it RETURNS null for a wrong PIN. loyalty_adjust then consumes the grant it minted
 * (contracts §1.3: no p_pin argument, so appRpc's PIN_GATED_RPCS path does not apply).
 */
export async function adjustPoints(
  profileId: string,
  delta: number,
  reason: string,
  pin: string,
): Promise<{ balance: number }> {
  await grantManagerPin(pin);
  return appRpc<{ balance: number }>('loyalty_adjust', {
    p_profile_id: profileId,
    p_delta: delta,
    p_reason: reason,
  });
}

export interface TabLoyalty {
  id: string;
  status: string;
  customer_id: string | null;
  tab_adjustments: (AdjustmentLike & { id: string })[];
}

/** The tab's customer and its adjustments: a small read of its own (tabs.customer_id, 0305). */
export function useTabLoyalty(tabId: string | null) {
  return useQuery({
    queryKey: LOYALTY_KEYS.tab(tabId ?? ''),
    enabled: Boolean(tabId),
    queryFn: async (): Promise<TabLoyalty> => {
      const { data, error } = await supabase
        .from('tabs')
        .select(
          'id, status, customer_id, tab_adjustments(id, kind, amount_iqd, value, reason_code)',
        )
        .eq('id', tabId!)
        .single();
      if (error) throw error;
      return data as unknown as TabLoyalty;
    },
  });
}

/** The chip's member, its balance and tier re-read from loyalty_customer. */
export function useMemberView(customerId: string | null) {
  return useQuery({
    queryKey: LOYALTY_KEYS.member(customerId ?? ''),
    enabled: Boolean(customerId),
    queryFn: async (): Promise<MemberView> => {
      const id = customerId!;
      const account = await appRpc<unknown>('loyalty_customer', { p_profile_id: id }).then(
        readLoyaltyCustomer,
        () => null,
      );
      return memberView(id, knownMember(id), account);
    },
  });
}

export function useLoyaltyCustomer(customerId: string, enabled = true) {
  return useQuery({
    queryKey: LOYALTY_KEYS.customer(customerId),
    enabled,
    queryFn: async () =>
      readLoyaltyCustomer(await appRpc<unknown>('loyalty_customer', { p_profile_id: customerId })),
  });
}

export interface StaffLoyaltyTerms extends RedeemTerms {
  enabled: boolean | null;
  /** Null when this role cannot list them (loyalty_admin is manager/owner). */
  rewards: LoyaltyAdminReward[] | null;
}

/**
 * The point value, the smallest use and the rewards, for the till: app.loyalty_till_terms, which
 * every desk role may call (the loyalty tables themselves stay closed to clients).
 */
export function useLoyaltyTerms(enabled = true) {
  return useQuery({
    queryKey: LOYALTY_KEYS.terms,
    enabled,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<StaffLoyaltyTerms> => {
      const t = await appRpc<{
        enabled: boolean;
        point_value_iqd: number | null;
        min_redeem_points: number | null;
        rewards: LoyaltyAdminReward[];
      }>('loyalty_till_terms', { p_venue_id: currentBranchId() });
      return {
        enabled: t.enabled,
        pointValueIqd: t.point_value_iqd,
        minRedeemPoints: t.min_redeem_points,
        rewards: t.rewards,
      };
    },
  });
}

export function useLoyaltyAdmin(enabled = true) {
  return useQuery({
    queryKey: LOYALTY_KEYS.admin,
    enabled,
    queryFn: () => appRpc<LoyaltyAdmin>('loyalty_admin'),
  });
}

/** After a write on a tab: the tab (its totals and loyalty rows), the lists, a booking's bill, the member. */
export function invalidateTabLoyalty(
  qc: QueryClient,
  tabId: string,
  customerId: string | null,
): void {
  void qc.invalidateQueries({ queryKey: ['tab', tabId] });
  void qc.invalidateQueries({ queryKey: ['tabs'] });
  void qc.invalidateQueries({ queryKey: ['bookingBill'] });
  if (customerId) {
    void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.member(customerId) });
    void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.customer(customerId) });
  }
}

/** After a Setup › Loyalty write: the page and the till's copy of the terms. */
export function invalidateLoyaltyAdmin(qc: QueryClient): void {
  void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.admin });
  void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.terms });
}
