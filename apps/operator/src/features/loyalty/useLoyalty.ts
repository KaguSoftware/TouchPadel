/**
 * Loyalty reads and writes on the operator (docs/design/loyalty/build-contracts-2026-10-05.md
 * §1.3). Every write is an online-only app.* RPC through appRpc, like apply_best_promotion
 * (L-6: no queued mutation type), so the six-place parity lists stay untouched.
 *
 * Keys are this feature's own. The tab's member rides under ['tab', id], so the till's
 * refresh() (['tab', id]) and queueResults' tab invalidations re-read it with the tab; the
 * record's panel rides under ['customer', id] for the same reason.
 */
import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryClient, type UseQueryResult } from '@tanstack/react-query';
import type {
  CardExtras,
  CardRewardKind,
  CourtRewardState,
  IdentifiedMember,
  LoyaltyAdmin,
  LoyaltyAdminPerk,
  LoyaltyAdminReward,
  PerksRefreshResult,
  RedeemResult,
  StampCardSettings,
  TabBenefits,
  UseDealVoucherResult,
  UseVoucherResult,
} from '@touch/core/loyalty';
import { AppRpcError, appRpc } from '../../lib/appRpc';
import { supabase } from '../../lib/supabase';
import { currentBranchId } from '../../lib/venueScope';
import { deviceId, onlineKey } from '../../lib/idem';
import { touch } from '../../ipc/bridge';
import { LOCAL_TAB_PREFIX } from '../../lib/offlineTabs';
import {
  memberView,
  perksRefreshSignature,
  readCardExtras,
  readLoyaltyCustomer,
  readStampCard,
  readTabBenefits,
  type AdjustmentLike,
  type MemberView,
  type RedeemTerms,
} from './loyaltyLogic';

export const LOYALTY_KEYS = {
  /** The member and loyalty rows of one tab (a child of the tab's own key). */
  tab: (tabId: string) => ['tab', tabId, 'loyalty'] as const,
  /**
   * The free court hour on the tab's booking (loyalty_court_reward, 0403): a child of the tab's
   * own key, so every tab refresh re-reads it.
   */
  courtReward: (tabId: string) => ['tab', tabId, 'loyalty', 'courtReward'] as const,
  /**
   * What the tab customer's card gives on this bill (loyalty_tab_benefits, 0410): a child of the
   * tab's own key, so the till's refresh, an attach and every loyalty write re-read it. The
   * host's `version` ends the key (useTabBenefits), as it does for the customer discount.
   */
  benefits: (tabId: string) => ['tab', tabId, 'loyalty', 'benefits'] as const,
  /** The chip's member: identify answer + loyalty_customer. */
  member: (customerId: string) => ['loyaltyMember', customerId] as const,
  /** The customer record's panel (a child of the record's own key). */
  customer: (customerId: string) => ['customer', customerId, 'loyalty'] as const,
  /** What the till may know of the settings and rewards. */
  terms: ['loyaltyTerms'] as const,
  /** Setup › Loyalty. */
  admin: ['loyaltyAdmin'] as const,
  /** Setup › Loyalty › Drink card (0445, app.stamp_card_settings). */
  stampCard: ['loyaltyStampCard'] as const,
  /**
   * The bill customer's drink card and birthday gifts (0445, app.loyalty_card_extras): a child of
   * the tab's own key, so the till's refresh and the automatic privileges refresh re-read it.
   */
  extras: (tabId: string, customerId: string) => ['tab', tabId, 'loyalty', 'extras', customerId] as const,
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
 * of now, once; an older one, or none, means a manager PIN instead. The 45 s here is a guess at
 * that window (the till cannot read the token's counter), so a token sent a little late comes
 * back MEMBER_CODE_EXPIRED: the server never counts an expired token toward the throttle (0308),
 * so a late scan costs the press a PIN, never a lock.
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

/** set_tab_customer's refusal of an active staff member without another manager's PIN (0308, c2). */
export function needsAttachPin(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'PIN_GRANT_REQUIRED';
}

/** One key per opened "Use points" or reward choice, so a double press replays (claim_replay). */
export function redeemKey(): string {
  return onlineKey('loyalty_redeem');
}

/**
 * loyalty_redeem answers a token that does not pass as {error, detail} instead of raising it
 * (0308, c3: the miss must commit to count toward the throttle, and the call's key is released
 * so the same press can go on with a manager PIN). The till treats it as the refusal it is.
 */
async function redeem(args: Record<string, unknown>): Promise<RedeemResult> {
  const answer = await appRpc<RedeemResult & { error?: string; detail?: string | null }>(
    'loyalty_redeem',
    args,
  );
  if (answer.error) {
    throw new AppRpcError(answer.error, answer.error, undefined, answer.detail ?? undefined);
  }
  return answer;
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
  return redeem({
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
  return redeem({
    p_tab_id: tabId,
    p_points: null,
    p_reward_id: rewardId,
    p_idempotency_key: key,
    p_member_token: memberToken,
  });
}

/**
 * 0415: the till scans a reward the guest redeemed in the app (use_reward_voucher). The code is the
 * proof: no member on the bill, no token, no PIN. A code that names no voucher is answered
 * {error} (the server counts it toward the throttle and releases the key), thrown here as the
 * refusal it is. One key per scan: a double scan replays the first answer.
 */
export async function applyVoucher(tabId: string, code: string): Promise<UseVoucherResult> {
  const answer = await appRpc<UseVoucherResult & { error?: string }>('use_reward_voucher', {
    p_tab_id: tabId,
    p_code: code,
    p_idempotency_key: onlineKey('use_reward_voucher'),
  });
  if (answer.error) throw new AppRpcError(answer.error, answer.error);
  return answer;
}

/**
 * 0445: the till scans a deal the guest redeemed in the app (use_deal_voucher). The code is the
 * proof, as for a reward: the bill takes the code's member when it has none, the deal becomes
 * their pick and apply_best_promotion puts it on. Every refusal is raised (DEAL_NOT_ON_BILL keeps
 * nothing). Online only, like the reward path (L-6). One key per scan: a double scan replays.
 */
export function applyDealVoucher(tabId: string, code: string): Promise<UseDealVoucherResult> {
  return appRpc<UseDealVoucherResult>('use_deal_voucher', {
    p_tab_id: tabId,
    p_code: code,
    p_idempotency_key: onlineKey('use_deal_voucher'),
    p_device_id: deviceId(),
  });
}

/**
 * Undo a redemption: a tab adjustment's id, or (0403) a free court hour's
 * reservation_loyalty_rewards id, which loyalty_unredeem takes in the same argument.
 */
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
  /** The booking this tab belongs to (0106), else null: where a free court hour can go. */
  reservation_id: string | null;
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
          'id, status, customer_id, reservation_id, tab_adjustments(id, kind, amount_iqd, value, reason_code)',
        )
        .eq('id', tabId!)
        .single();
      if (error) throw error;
      return data as unknown as TabLoyalty;
    },
  });
}

/**
 * The free court hour on a booking tab (app.loyalty_court_reward, 0403): whether one fits now,
 * what it is worth, and the one already applied (the bill's line and its Undo). Read only for a
 * tab that belongs to a booking; a tab without one never has a free hour.
 */
export function useCourtReward(tabId: string | null, enabled = true) {
  return useQuery({
    queryKey: LOYALTY_KEYS.courtReward(tabId ?? ''),
    enabled: Boolean(tabId) && enabled,
    queryFn: () => appRpc<CourtRewardState>('loyalty_court_reward', { p_tab_id: tabId }),
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
  /** 0403: "Use points" (points as money off) is on. Null while unknown, which reads as off. */
  pointsOffEnabled: boolean | null;
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
        points_off_enabled?: boolean;
        rewards: LoyaltyAdminReward[];
      }>('loyalty_till_terms', { p_venue_id: currentBranchId() });
      return {
        enabled: t.enabled,
        pointsOffEnabled: t.points_off_enabled === true,
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

// ---------------------------------------------------------------------------
// What the member's card gives on a bill (0410)
// ---------------------------------------------------------------------------

/**
 * A server without 0410 (PGRST202, appRpc's RPC_MISSING): the bill shows nothing new. Read off
 * the code, as features/discounts does, so a screen test that mocks lib/appRpc still mounts.
 */
function rpcMissing(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'RPC_MISSING';
}

/**
 * What the tab customer's card gives on this bill: their card, its privileges, the free
 * add-ons on the bill against what they should come to, and the deal they picked in the app.
 * Asked for every live bill, not only one with a member attached: the server also knows the
 * customer of a booking's bill and of an order placed from the app (app.tab_customer).
 * `version` is the host's own figures, so a bill whose lines changed is asked again.
 */
export function useTabBenefits({
  tabId,
  version,
  enabled,
}: {
  tabId: string | null;
  version: string;
  enabled: boolean;
}): UseQueryResult<TabBenefits | null> {
  return useQuery({
    queryKey: [...LOYALTY_KEYS.benefits(tabId ?? ''), version],
    enabled: enabled && Boolean(tabId) && !(tabId ?? '').startsWith(LOCAL_TAB_PREFIX),
    queryFn: async () => readTabBenefits(await appRpc<unknown>('loyalty_tab_benefits', { p_tab_id: tabId })),
    retry: (n, e) => !rpcMissing(e) && n < 1,
    placeholderData: (prev) => prev,
  });
}

/**
 * While a bill is open: when its benefits say the free add-ons on it are not what the card
 * gives (a line with a paid add-on was added or voided, the member was attached or taken off,
 * their card or its privileges changed), ask app.loyalty_perks_refresh for them, once per
 * state, then re-read the bill. Nobody presses anything, and nothing is shown: a success is the
 * bill's own "Card privileges" row, and a refusal (a part-paid bill, answered as data, or
 * anything raised) leaves the bill as it was. Never loops: the same state and figures are
 * never asked twice (perksRefreshSignature).
 */
export function useAutoTierPerks({
  tabId,
  state,
  version,
  enabled,
}: {
  tabId: string | null;
  /** The benefits as read for THIS version; pass undefined while a newer read is on its way. */
  state: TabBenefits | null | undefined;
  version: string;
  enabled: boolean;
}): void {
  const qc = useQueryClient();
  const asked = useRef<string | null>(null);
  useEffect(() => {
    if (!enabled || !tabId || !state || state.tab_id !== tabId || !state.addons.needs_refresh) return;
    const signature = perksRefreshSignature(state, version);
    if (asked.current === signature) return;
    asked.current = signature;
    void (async () => {
      try {
        await appRpc<PerksRefreshResult>('loyalty_perks_refresh', { p_tab_id: tabId, p_device_id: deviceId() });
      } catch {
        // Left as it was; the bill's rows still say what it carries.
        return;
      }
      void qc.invalidateQueries({ queryKey: ['tab', tabId] });
      void qc.invalidateQueries({ queryKey: ['tabs'] });
      void qc.invalidateQueries({ queryKey: ['bookingBill'] });
      void qc.invalidateQueries({ queryKey: ['bookingBillStates'] });
    })();
  }, [enabled, state, version, tabId, qc]);
}

/**
 * The two above for a host: the read, and the automatic refresh beside it. Mounted wherever the
 * customer discount's own refresh is (the café till, the shop till's member step, the desk's
 * booking bill). Returns what the member block shows, or null (not read yet, nothing to show,
 * or a server without 0410).
 */
export function useMemberBenefits(args: { tabId: string | null; version: string; enabled: boolean }): TabBenefits | null {
  const q = useTabBenefits(args);
  useAutoTierPerks({
    tabId: args.tabId,
    state: q.isPlaceholderData ? undefined : q.data,
    version: args.version,
    enabled: args.enabled,
  });
  return rpcMissing(q.error) ? null : (q.data ?? null);
}

// ---------------------------------------------------------------------------
// Setup › Loyalty: a tier's privileges (0410)
// ---------------------------------------------------------------------------

/** Owner: create (no id) or change a tier privilege; absent keys are kept on a change. */
export function upsertTierPerk(perk: Record<string, unknown>): Promise<LoyaltyAdminPerk> {
  return appRpc<LoyaltyAdminPerk>('upsert_loyalty_tier_perk', { p_perk: perk });
}

/** Owner: remove one tier privilege. Open bills drop its free add-ons at their next refresh. */
export function deleteTierPerk(perkId: string): Promise<unknown> {
  return appRpc('delete_loyalty_tier_perk', { p_perk_id: perkId });
}

// ---------------------------------------------------------------------------
// The drink card and birthday gifts (0445)
// ---------------------------------------------------------------------------

/**
 * The bill customer's drink card (x of N, a free drink ready or held) and the birthday gifts
 * whose days hold today. Null on a server without 0445 or an answer that is not one; the bill
 * then shows nothing new.
 */
export function useCardExtras({
  tabId,
  customerId,
  enabled,
}: {
  tabId: string;
  customerId: string | null;
  enabled: boolean;
}): CardExtras | null {
  const q = useQuery({
    queryKey: LOYALTY_KEYS.extras(tabId, customerId ?? ''),
    enabled: enabled && Boolean(customerId),
    queryFn: async () => readCardExtras(await appRpc<unknown>('loyalty_card_extras', { p_profile_id: customerId })),
    retry: (n, e) => !rpcMissing(e) && n < 1,
    placeholderData: (prev) => prev,
  });
  return rpcMissing(q.error) ? null : (q.data ?? null);
}

/**
 * Setup › Loyalty › Drink card (manager and owner read). `data` null: a server without 0445,
 * where the panel is left out.
 */
export function useStampCard(enabled = true): UseQueryResult<StampCardSettings | null> {
  return useQuery({
    queryKey: LOYALTY_KEYS.stampCard,
    enabled,
    queryFn: async () => {
      try {
        return readStampCard(await appRpc<unknown>('stamp_card_settings'));
      } catch (e) {
        if (rpcMissing(e)) return null;
        throw e;
      }
    },
  });
}

/** Owner: the drink card's settings (absent keys kept). Returns them as saved. */
export function setStampCard(card: StampCardSettings): Promise<unknown> {
  return appRpc('set_stamp_card', { p_card: card });
}

/**
 * 0445 (Redeem in the app): the till presses Redeem for the bill's member, for a member without
 * the app (app.claim_card_reward_for_tab): their ready free drink (`stamp`) or one open card gift
 * (`gift`, with its privilege id). The server records the claim, refreshes an open bill's card
 * privileges, and answers the bill's benefits. REWARD_NOT_READY when it is no longer there to take.
 */
export async function claimCardRewardForTab(tabId: string, kind: CardRewardKind, perkId: string | null): Promise<TabBenefits | null> {
  return readTabBenefits(
    await appRpc<unknown>('claim_card_reward_for_tab', {
      p_tab_id: tabId,
      p_kind: kind,
      p_perk_id: kind === 'gift' ? perkId : null,
      p_device_id: deviceId(),
    }),
  );
}

/**
 * "Give it now" in the member block: the claim above, then the bill, its benefits and extras
 * (children of ['tab', id]), the lists and a booking's bill are read again. A refusal is the
 * mutation's error for the caller to show; REWARD_NOT_READY also re-reads, since the card moved.
 */
export function useClaimCardReward(tabId: string, customerId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, perkId }: { kind: CardRewardKind; perkId: string | null }) => claimCardRewardForTab(tabId, kind, perkId),
    onSettled: () => {
      invalidateTabLoyalty(qc, tabId, customerId);
      void qc.invalidateQueries({ queryKey: ['bookingBillStates'] });
    },
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
  void qc.invalidateQueries({ queryKey: LOYALTY_KEYS.stampCard });
}
