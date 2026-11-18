/**
 * The pure half of loyalty on the operator (docs/design/loyalty/build-contracts-2026-10-05.md
 * §1.3, plan §5.3): what the member field holds, what "Use points" offers, which of a tab's
 * adjustments are loyalty ones, and the Setup › Loyalty drafts. The server is the authority on
 * every figure (app.loyalty_redeem caps the points at what is left to pay); this only decides
 * what the screen offers before it asks. Tested in loyaltyLogic.test.ts under node.
 */
import {
  CARD_FRAME_IDS,
  CARD_LADDER,
  GIFT_TARGETS,
  GIFT_WHENS,
  MEMBER_TOKEN_RE,
  TIER_PERK_KINDS,
  TIER_PERK_REASON_CODE,
  isDealVoucherCode,
  isVoucherCode,
  parseDealVoucherCode,
  parseMemberInput,
  parseVoucherCode,
  redeemAmount,
  tierColor,
  type TierColor,
  type CardExtras,
  type CardFrameId,
  type GiftTarget,
  type GiftWhen,
  type PerkLine,
  type PerkLineKind,
  type StampCardSettings,
  type TierPerkConfig,
  type CourtRewardState,
  type IdentifiedMember,
  type LedgerKind,
  type LoyaltyRewardKind,
  type LoyaltyAdminPerk,
  type LoyaltyAdminReward,
  type LoyaltyAdminTier,
  type LoyaltyCustomer,
  type LoyaltySettings,
  type TabBenefits,
  type TabPerk,
  type TierPerkKind,
} from '@touch/core/loyalty';
import { makeT } from '@touch/i18n';

// ---------------------------------------------------------------------------
// The member field
// ---------------------------------------------------------------------------

/** What app.loyalty_identify is sent for the field's text, or null when it is neither. */
export function identifyCode(raw: string): { code: string; method: 'qr' | 'phone' } | null {
  const parsed = parseMemberInput(raw);
  if (parsed.kind === 'token') return { code: parsed.token, method: 'qr' };
  if (parsed.kind === 'phone') return { code: parsed.digits, method: 'phone' };
  return null;
}

/**
 * True when a scanner burst is a member card rather than a product barcode. The wedge sees
 * the keys as typed, so the case is whatever the scanner sent.
 */
export function isMemberScan(code: string): boolean {
  return MEMBER_TOKEN_RE.test(code.trim().toUpperCase());
}

/**
 * 0415: true when a scanner burst is a member card or a reward voucher (TPV-…), and (0445) a
 * deal's code (TPD-…): the till routes all three to the bill's member block instead of the
 * quick add.
 */
export function isLoyaltyScan(code: string): boolean {
  return isMemberScan(code) || isVoucherCode(code) || isDealVoucherCode(code);
}

/** 0445: a code from the guest's app, read from a scan or what was typed; null when it is neither. */
export type AppCode = { kind: 'reward'; code: string } | { kind: 'deal'; code: string };

/**
 * 0445: which code from the app this is (a reward's TPV-…, a deal's TPD-…), canonical, or null.
 * Neither kind is ever a member card, so a code that answers here never reaches loyalty_identify.
 */
export function parseAppCode(raw: string): AppCode | null {
  const reward = parseVoucherCode(raw);
  if (reward) return { kind: 'reward', code: reward };
  const deal = parseDealVoucherCode(raw);
  return deal ? { kind: 'deal', code: deal } : null;
}

/** The refusals of use_deal_voucher whose shared line speaks of a reward and its points. */
const DEAL_CODE_REFUSALS = ['VOUCHER_NOT_FOUND', 'VOUCHER_USED', 'VOUCHER_EXPIRED', 'VOUCHER_WRONG_BRANCH'] as const;
type DealCodeRefusal = (typeof DEAL_CODE_REFUSALS)[number];

/**
 * 0445: the deal code's own words for a refusal the shared catalogue words for reward codes
 * (VOUCHER_EXPIRED there says the points went back; a deal holds none). Null: the catalogue's
 * line is right as it is (DEAL_NOT_ON_BILL, VOUCHER_OTHER_MEMBER, TAB_NOT_OPEN, …).
 */
export function dealCodeErrorKey(error: unknown): `ws.loyalty.dealCode.errors.${DealCodeRefusal}` | null {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && (DEAL_CODE_REFUSALS as readonly string[]).includes(code)
    ? `ws.loyalty.dealCode.errors.${code as DealCodeRefusal}`
    : null;
}

// ---------------------------------------------------------------------------
// The member on a bill
// ---------------------------------------------------------------------------

/** What the chip shows. A member known only by id (a reload) has no name until scanned again. */
export interface MemberView {
  customerId: string;
  displayName: string | null;
  phoneMasked: string | null;
  tierEn: string | null;
  tierAr: string | null;
  balance: number;
  /** Null when unknown (read through loyalty_customer, which does not say). */
  enabled: boolean | null;
}

/**
 * The chip's member from what is known: the identify answer (name, masked phone) and, when it
 * was read, loyalty_customer's current balance and tier, which wins on those two.
 */
export function memberView(
  customerId: string,
  identified: IdentifiedMember | null,
  account: LoyaltyCustomer | null,
): MemberView {
  return {
    customerId,
    displayName: identified?.display_name ?? null,
    phoneMasked: identified?.phone_masked ?? null,
    tierEn: account ? (account.tier?.name_en ?? null) : (identified?.tier_name_en ?? null),
    tierAr: account ? (account.tier?.name_ar ?? null) : (identified?.tier_name_ar ?? null),
    balance: Number(account?.balance ?? identified?.balance ?? 0),
    enabled: identified ? Boolean(identified.enabled) : null,
  };
}

/** loyalty_customer's answer with every figure a number and the history a list, whatever came back. */
export function readLoyaltyCustomer(raw: unknown): LoyaltyCustomer {
  const r = (raw ?? {}) as Partial<LoyaltyCustomer>;
  return {
    balance: Number(r.balance ?? 0),
    lifetime: Number(r.lifetime ?? 0),
    points_12m: Number(r.points_12m ?? 0),
    tier: r.tier ?? null,
    history: Array.isArray(r.history) ? r.history : [],
  };
}

/**
 * The tab_adjustments reason codes app.loyalty_redeem writes (contracts §1.3): the rows a
 * cashier can undo. A card's free add-ons (`loyalty_tier_perk`, 0410) are NOT among them: the
 * server writes and removes those by itself (isTierPerkAdjustment), so they never get an Undo.
 */
export const LOYALTY_REASON_CODES = ['loyalty_points', 'loyalty_reward'] as const;

export interface AdjustmentLike {
  id: string;
  kind: string;
  amount_iqd: number;
  value?: number | null;
  reason_code?: string | null;
}

export function isLoyaltyAdjustment(a: Pick<AdjustmentLike, 'reason_code'>): boolean {
  return (LOYALTY_REASON_CODES as readonly string[]).includes(a.reason_code ?? '');
}

/** The tab's redemptions, newest last as the server lists them; each can be undone while open. */
export function loyaltyAdjustments<T extends AdjustmentLike>(rows: readonly T[]): T[] {
  return rows.filter(isLoyaltyAdjustment);
}

/** IQD the tab's loyalty rows take off, so the bill can show it on its own row. */
export function loyaltyDiscountIqd(rows: readonly AdjustmentLike[]): number {
  return loyaltyAdjustments(rows).reduce((s, a) => s + a.amount_iqd, 0);
}

// ---------------------------------------------------------------------------
// What the member's card gives on a bill (0410)
// ---------------------------------------------------------------------------

/** A free add-on row of the member's card: the server's own, never undone by hand. */
export function isTierPerkAdjustment(a: Pick<AdjustmentLike, 'reason_code'>): boolean {
  return a.reason_code === TIER_PERK_REASON_CODE;
}

/**
 * app.loyalty_tab_benefits with every list a list and every figure a number, whatever came
 * back; null when it is not an answer at all (the bill then shows nothing new).
 */
export function readTabBenefits(raw: unknown): TabBenefits | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<TabBenefits>;
  if (typeof r.tab_id !== 'string') return null;
  const addons = (r.addons ?? {}) as Partial<TabBenefits['addons']>;
  const d = r.deal as Partial<NonNullable<TabBenefits['deal']>> | null | undefined;
  return {
    tab_id: r.tab_id,
    customer_id: typeof r.customer_id === 'string' ? r.customer_id : null,
    enabled: r.enabled === true,
    tier: r.tier && typeof r.tier === 'object' ? r.tier : null,
    perks: Array.isArray(r.perks) ? (r.perks as TabPerk[]).filter((p) => p && typeof p.id === 'string') : [],
    addons: {
      on_bill_iqd: Number(addons.on_bill_iqd ?? 0) || 0,
      due_iqd: Number(addons.due_iqd ?? 0) || 0,
      needs_refresh: addons.needs_refresh === true,
    },
    // 0445: why each line is free; an older server sends none.
    lines: readPerkLines(r.lines),
    // 0445: the court hour a card gift took off the bill's booking.
    court_gift: readCourtGift(r.court_gift),
    deal:
      d && typeof d.promotion_id === 'string'
        ? {
            promotion_id: d.promotion_id,
            name_en: String(d.name_en ?? ''),
            name_ar: String(d.name_ar ?? ''),
            // 0445: free_item is buy one, get one (value = percent off each unit given, 100 = free).
            type: d.type === 'amount' ? 'amount' : d.type === 'free_item' ? 'free_item' : 'percent',
            value: Number(d.value ?? 0) || 0,
            applied: d.applied === true,
          }
        : null,
  };
}

/**
 * The automatic refresh's memory of one state (the customer discount's refreshSignature, for
 * free add-ons): what the card gave, what the bill carried and the host's figures when the
 * refresh was last asked for. The same signature twice is the same question and is never asked
 * again, so a refresh the server refused (a part-paid bill) or one that changed nothing cannot
 * loop.
 */
export function perksRefreshSignature(b: TabBenefits, version: string): string {
  return JSON.stringify([
    version,
    b.tab_id,
    b.customer_id,
    b.tier?.id ?? null,
    b.perks.map((p) => p.id),
    b.addons.on_bill_iqd,
    b.addons.due_iqd,
    b.addons.needs_refresh,
  ]);
}

/**
 * True when the bill has something of the card to show: loyalty is on, the bill has a customer
 * (attached, or the booking's or the app order's own guest), and their card gives a privilege
 * or they picked a deal in the app.
 */
export function benefitsShown(b: TabBenefits | null | undefined): b is TabBenefits {
  return Boolean(b && b.enabled && b.customer_id && (b.perks.length > 0 || b.deal));
}

/**
 * 0445: the bill can show the member's card at all: loyalty on and a customer known. What it then
 * shows (privileges, the drink card, a birthday gift, the deal) each decide for themselves, so a
 * starter card with nothing but a drink card still shows the card.
 */
export function memberCardShown(b: TabBenefits | null | undefined): b is TabBenefits {
  return Boolean(b && b.enabled && b.customer_id);
}

/** The order the till explains free lines in: the engine's own (app.loyalty_perks_detail). */
export const PERK_LINE_KINDS: readonly PerkLineKind[] = ['stamp', 'gift', 'free_with', 'size_upgrade', 'free_addons'];

/** loyalty_tab_benefits.lines with every figure a number; rows that make no sense are dropped. */
export function readPerkLines(raw: unknown): PerkLine[] {
  if (!Array.isArray(raw)) return [];
  const out: PerkLine[] = [];
  for (const r of raw as Partial<PerkLine>[]) {
    if (!r || typeof r.order_item_id !== 'string' || !PERK_LINE_KINDS.includes(r.kind as PerkLineKind)) continue;
    const amount = Number(r.amount_iqd ?? 0) || 0;
    if (amount <= 0) continue;
    out.push({
      order_item_id: r.order_item_id,
      kind: r.kind as PerkLineKind,
      perk_id: typeof r.perk_id === 'string' ? r.perk_id : null,
      units: Math.max(0, Number(r.units ?? 0) || 0),
      amount_iqd: amount,
    });
  }
  return out;
}

/** The privileges a bill lists for the cashier: a ring and a drink card size do nothing on a bill. */
export function billPerks<T extends { kind: string }>(perks: readonly T[]): T[] {
  return perks.filter((p) => p.kind !== 'frame' && p.kind !== 'stamp_size');
}

/** A bill privilege's gift `when` (gift privileges only), from its config; null otherwise. */
export function perkGiftWhen(p: { kind: string; config?: unknown } | null | undefined): GiftWhen | null {
  return p && p.kind === 'gift' ? giftWhenOf(configOf(p).when) : null;
}

/** The court hour a card gift took off the bill's booking, read safely; null when none. */
export function readCourtGift(raw: unknown): NonNullable<TabBenefits['court_gift']> | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<NonNullable<TabBenefits['court_gift']>>;
  const amount = Number(r.amount_iqd ?? 0) || 0;
  if (amount <= 0) return null;
  return {
    perk_id: typeof r.perk_id === 'string' ? r.perk_id : null,
    name_en: typeof r.name_en === 'string' ? r.name_en : null,
    name_ar: typeof r.name_ar === 'string' ? r.name_ar : null,
    amount_iqd: amount,
  };
}

/**
 * How the cashier meets a privilege on a bill: the till frees it by itself (add-ons, a birthday
 * gift, a free-with), or the staff give it by hand (custom).
 */
export function perkHandling(kind: string): 'till' | 'hand' {
  return kind === 'custom' ? 'hand' : 'till';
}

/** One reason a line is free, ready for its label: the kind, and the privilege's names when known. */
export interface PerkLineReason {
  kind: PerkLineKind;
  /** The privilege that freed it (gift, free_with), as the bill's perks name it; null when unknown. */
  perk: { name_en: string; name_ar: string } | null;
  /** A gift's `when` (birthday, monthly, card_up), from the privilege's config; null when unknown. */
  when: GiftWhen | null;
  units: number;
  amount_iqd: number;
}

/**
 * The reasons of one bill line, in the engine's order, merged by kind and privilege (a refresh
 * keeps one detail row per reason, but a merge or an older bill can carry two).
 */
export function lineReasons(
  orderItemId: string,
  lines: readonly PerkLine[] | undefined,
  perks: readonly { id: string; kind?: string; name_en: string; name_ar: string; config?: unknown }[],
): PerkLineReason[] {
  const by = new Map<string, PerkLineReason>();
  for (const l of lines ?? []) {
    if (l.order_item_id !== orderItemId) continue;
    const key = `${l.kind}:${l.perk_id ?? ''}`;
    const had = by.get(key);
    if (had) {
      had.units += l.units;
      had.amount_iqd += l.amount_iqd;
      continue;
    }
    const p = l.perk_id ? perks.find((x) => x.id === l.perk_id) : undefined;
    by.set(key, {
      kind: l.kind,
      perk: p ? { name_en: p.name_en, name_ar: p.name_ar } : null,
      when: l.kind === 'gift' && p ? giftWhenOf(configOf(p).when) : null,
      units: l.units,
      amount_iqd: l.amount_iqd,
    });
  }
  return [...by.values()].sort((a, b) => PERK_LINE_KINDS.indexOf(a.kind) - PERK_LINE_KINDS.indexOf(b.kind));
}

export interface PerkLineTotal {
  kind: PerkLineKind;
  /** Gifts are summed by their `when` (a birthday gift and a monthly one are told apart); null otherwise or unknown. */
  when: GiftWhen | null;
  units: number;
  amount_iqd: number;
}

/**
 * The whole bill's free lines summed by reason, for the member block: one row per kind, and per
 * `when` for gifts (read off the privilege in `perks`), in the engine's order.
 */
export function perkLineTotals(
  lines: readonly PerkLine[] | undefined,
  perks: readonly { id: string; kind?: string; config?: unknown }[] = [],
): PerkLineTotal[] {
  const by = new Map<string, PerkLineTotal>();
  for (const l of lines ?? []) {
    const p = l.kind === 'gift' && l.perk_id ? perks.find((x) => x.id === l.perk_id) : undefined;
    const when = p ? giftWhenOf(configOf(p).when) : null;
    const key = `${l.kind}:${when ?? ''}`;
    const had = by.get(key) ?? { kind: l.kind, when, units: 0, amount_iqd: 0 };
    had.units += l.units;
    had.amount_iqd += l.amount_iqd;
    by.set(key, had);
  }
  const whenOrder = (w: GiftWhen | null) => (w ? GIFT_WHENS.indexOf(w) : GIFT_WHENS.length);
  return [...by.values()].sort(
    (a, b) => PERK_LINE_KINDS.indexOf(a.kind) - PERK_LINE_KINDS.indexOf(b.kind) || whenOrder(a.when) - whenOrder(b.when),
  );
}

/** A claim's end as the server sent it (an ISO timestamp), or null for none or anything else. */
function claimedUntil(v: unknown): string | null {
  return typeof v === 'string' && v !== '' && !Number.isNaN(Date.parse(v)) ? v : null;
}

/** app.loyalty_card_extras with every figure a number, whatever came back; null when not an answer. */
export function readCardExtras(raw: unknown): CardExtras | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<CardExtras>;
  if (!r.stamps || typeof r.stamps !== 'object' || !r.birthday || typeof r.birthday !== 'object') return null;
  const s = r.stamps as Partial<CardExtras['stamps']>;
  const b = r.birthday as Partial<CardExtras['birthday']>;
  const str = (v: unknown) => (typeof v === 'string' ? v : '');
  return {
    stamps: {
      enabled: s.enabled === true,
      count: Math.max(0, Number(s.count ?? 0) || 0),
      size: Math.max(1, Number(s.size ?? STAMP_SIZE_STANDARD) || STAMP_SIZE_STANDARD),
      ready: s.ready === true,
      held: s.held === true,
      // 0445 (Redeem in the app): until when the member's Redeem press holds; only while ready.
      claimed_until: claimedUntil(s.claimed_until),
    },
    birthday: {
      has_date: b.has_date === true,
      gifts: (Array.isArray(b.gifts) ? b.gifts : [])
        .filter((g) => g && typeof g.perk_id === 'string')
        .map((g) => ({
          perk_id: g.perk_id,
          name_en: str(g.name_en),
          name_ar: str(g.name_ar),
          target: giftTargetOf(g.target),
          window_from: typeof g.window_from === 'string' ? g.window_from : null,
          window_to: typeof g.window_to === 'string' ? g.window_to : null,
          eligible: g.eligible === true,
          used: g.used === true,
          claimed_until: claimedUntil(g.claimed_until),
        })),
      counts_from: typeof b.counts_from === 'string' ? b.counts_from : null,
      gifts_on_card: (Array.isArray(b.gifts_on_card) ? b.gifts_on_card : [])
        .filter((g) => g && typeof g.perk_id === 'string')
        .map((g) => ({
          perk_id: g.perk_id,
          name_en: str(g.name_en),
          name_ar: str(g.name_ar),
          target: giftTargetOf(g.target),
          days: Number(g.days ?? GIFT_DAYS_DEFAULT) || GIFT_DAYS_DEFAULT,
        })),
    },
    // 0445: the monthly and card-up gifts open now; absent from an older answer.
    gifts: (Array.isArray(r.gifts) ? r.gifts : [])
      .filter((g) => g && typeof g.perk_id === 'string' && (g.when === 'monthly' || g.when === 'card_up'))
      .map((g) => ({
        perk_id: g.perk_id,
        name_en: str(g.name_en),
        name_ar: str(g.name_ar),
        when: g.when,
        target: giftTargetOf(g.target),
        window_to: str(g.window_to),
        used: g.used === true,
        claimed_until: claimedUntil(g.claimed_until),
      })),
  };
}

/**
 * Where the member's drink card stands, as the desk reads it at a glance:
 *   off           the drink card (or loyalty) is off: nothing shown;
 *   filling       count of size, no free drink yet;
 *   onThisBill    this bill carries the free drink (a stamp line);
 *   heldElsewhere another open bill of theirs carries it;
 *   ready         full: the next bill a till opens frees their dearest stamping drink.
 */
export type StampState = 'off' | 'filling' | 'ready' | 'onThisBill' | 'heldElsewhere';

export function stampState(extras: CardExtras | null | undefined, lines: readonly PerkLine[] | undefined): StampState {
  const s = extras?.stamps;
  if (!s || !s.enabled) return 'off';
  if ((lines ?? []).some((l) => l.kind === 'stamp')) return 'onThisBill';
  if (s.held) return 'heldElsewhere';
  if (s.ready || s.count >= s.size) return 'ready';
  return 'filling';
}

export type GiftTodayState = 'onThisBill' | 'open' | 'used' | 'tooRecent';

export interface GiftToday {
  perk_id: string;
  name_en: string;
  name_ar: string;
  when: GiftWhen;
  target: GiftTarget;
  state: GiftTodayState;
  /**
   * 0445 (Redeem in the app): until when the member's Redeem press (or a till's "Give it now")
   * holds, else null. A gift reaches a bill only once redeemed.
   */
  claimed_until: string | null;
}

/**
 * The card gifts open now (birthday first, then monthly, then card-up), in the four states the
 * desk tells the guest about: on this bill (a gift line of it, or the court hour it took off this
 * bill's booking), open, already used (or held by another bill), or, for a birthday gift only,
 * not given because the birth date is too new.
 */
export function giftsToday(
  extras: CardExtras | null | undefined,
  lines: readonly PerkLine[] | undefined,
  courtGift: TabBenefits['court_gift'] = null,
): GiftToday[] {
  const onBill = new Set((lines ?? []).filter((l) => l.kind === 'gift' && l.perk_id).map((l) => l.perk_id as string));
  if (courtGift?.perk_id) onBill.add(courtGift.perk_id);
  const birthday: GiftToday[] = (extras?.birthday.gifts ?? []).map((g) => ({
    perk_id: g.perk_id,
    name_en: g.name_en,
    name_ar: g.name_ar,
    when: 'birthday',
    target: giftTargetOf(g.target),
    state: onBill.has(g.perk_id) ? 'onThisBill' : !g.eligible ? 'tooRecent' : g.used ? 'used' : 'open',
    claimed_until: g.claimed_until ?? null,
  }));
  const others: GiftToday[] = (extras?.gifts ?? []).map((g) => ({
    perk_id: g.perk_id,
    name_en: g.name_en,
    name_ar: g.name_ar,
    when: g.when,
    target: giftTargetOf(g.target),
    state: onBill.has(g.perk_id) ? 'onThisBill' : g.used ? 'used' : 'open',
    claimed_until: g.claimed_until ?? null,
  }));
  return [...birthday, ...others.sort((a, b) => GIFT_WHENS.indexOf(a.when) - GIFT_WHENS.indexOf(b.when))];
}

/**
 * 0445 (Redeem in the app): a ready free drink or an open gift reaches a bill only after a claim.
 * `claimed` (with when it ends) once the member pressed Redeem, or a till gave it; `waiting`
 * otherwise, which is when the till offers "Give it now" for a member without the app.
 */
export type RewardClaim = { kind: 'claimed'; until: string } | { kind: 'waiting' };

export function rewardClaim(claimedUntilIso: string | null | undefined): RewardClaim {
  return claimedUntilIso ? { kind: 'claimed', until: claimedUntilIso } : { kind: 'waiting' };
}

/** True when the extras have anything for the bill to show. */
export function extrasShown(extras: CardExtras | null | undefined): boolean {
  return Boolean(extras && (extras.stamps.enabled || extras.birthday.gifts.length > 0 || (extras.gifts ?? []).length > 0));
}

/** What the staff side knows of the settings: the point value may be unreadable for a cashier. */
export interface RedeemTerms {
  pointValueIqd: number | null;
  minRedeemPoints: number | null;
}

/**
 * 0403 (Majed 2026-11-05: rewards are things you take, not a wallet): "Use points" is offered
 * only when the owner turned points-as-money-off on. Unknown (terms not read yet, an older
 * server) is off: loyalty_redeem would answer POINTS_OFF anyway.
 */
export function pointsOffOn(terms: { pointsOffEnabled?: boolean | null } | null | undefined): boolean {
  return terms?.pointsOffEnabled === true;
}

/** True when a free court hour can be redeemed on this tab now (loyalty_court_reward). */
export function courtRewardFits(state: CourtRewardState | null | undefined): boolean {
  return Boolean(state && state.plain_booking && state.refused === null && (state.value_iqd ?? 0) > 0);
}

/**
 * The rewards the till lists on this tab: court_hour rewards only where loyalty_court_reward
 * says a free hour fits (a plain booking's tab, none on it yet, something of the fee left);
 * every other kind as before.
 */
export function rewardsForTab<T extends { kind: LoyaltyRewardKind }>(
  rows: readonly T[],
  court: CourtRewardState | null | undefined,
): T[] {
  const fits = courtRewardFits(court);
  return rows.filter((r) => r.kind !== 'court_hour' || fits);
}

/**
 * The points "Use points" opens with: the most that fits what is left to pay. Without the point
 * value (a role that cannot read the settings) it is the whole balance, and the server rounds it
 * down to fit (contracts §1.3, "points rounded down to fit").
 */
export function defaultRedeemPoints(
  balance: number,
  remainingIqd: number | null,
  terms: RedeemTerms,
): number {
  if (balance <= 0) return 0;
  if (terms.pointValueIqd == null || remainingIqd == null) return balance;
  return redeemAmount({ points: balance, pointValueIqd: terms.pointValueIqd, remainingIqd }).points;
}

export type RedeemBlock = 'noBalance' | 'nothingDue' | 'belowMin' | 'overBalance' | 'invalid';

/** Why the points typed cannot be used, or null when they can be sent. */
export function redeemBlock(
  points: number | null,
  balance: number,
  remainingIqd: number | null,
  terms: RedeemTerms,
): RedeemBlock | null {
  if (balance <= 0) return 'noBalance';
  if (remainingIqd !== null && remainingIqd <= 0) return 'nothingDue';
  if (points === null || !Number.isInteger(points) || points <= 0) return 'invalid';
  if (points > balance) return 'overBalance';
  if (terms.minRedeemPoints != null && points < terms.minRedeemPoints) return 'belowMin';
  return null;
}

/** IQD the points take off, when the value is known: never more than is left to pay. */
export function redeemWorth(
  points: number,
  remainingIqd: number | null,
  terms: RedeemTerms,
): number | null {
  if (terms.pointValueIqd == null) return null;
  const amount = points * terms.pointValueIqd;
  return remainingIqd == null ? amount : Math.min(amount, Math.max(remainingIqd, 0));
}

/** A whole number from the field (Arabic-Indic digits already folded by the input), or null. */
export function parseWhole(text: string): number | null {
  const t = text.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

/** A signed whole number for "Adjust points" (100 or -50), or null. */
export function parseSigned(text: string): number | null {
  const t = text.trim().replace(/^[−–]/, '-');
  if (!/^-?\d+$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) ? n : null;
}

export interface AdjustDraft {
  delta: string;
  reason: string;
}

export function adjustErrors(d: AdjustDraft): {
  delta?: 'deltaRequired';
  reason?: 'reasonRequired';
} {
  const n = parseSigned(d.delta);
  return {
    ...(n === null || n === 0 ? { delta: 'deltaRequired' as const } : {}),
    ...(d.reason.trim() === '' ? { reason: 'reasonRequired' as const } : {}),
  };
}

/** A refusal the PIN prompt shows itself (it stays open); anything else closes it. */
const PIN_CODES = new Set(['PIN_INVALID', 'PIN_LOCKED', 'PIN_GRANT_REQUIRED', 'PIN_OWN']);
export function isPinRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && PIN_CODES.has(code);
}

/** The i18n leaf for a ledger row's kind; unknown kinds read as an adjustment. */
const LEDGER_KINDS: readonly LedgerKind[] = [
  'earn',
  'redeem',
  'redeem_void',
  'reward',
  'adjust',
  'clawback',
  'expire',
  'merge_in',
];
export function ledgerKind(kind: string): LedgerKind {
  return (LEDGER_KINDS as readonly string[]).includes(kind) ? (kind as LedgerKind) : 'adjust';
}

/**
 * Points earned per calendar month (in the venue's time zone) for the `months`
 * months ending with the current one, oldest first: the customer record's
 * "Earned per month" chart. Only `earn` rows count; uses, rewards, adjustments
 * and take-backs are not earning. Reads only the history it is given
 * (loyalty_customer sends the newest 100 rows).
 */
export function monthlyEarned(
  history: readonly { kind: string; delta: number; created_at: string }[],
  nowMs: number,
  tz: string,
  months = 6,
): { key: string; total: number }[] {
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit' });
  const keyOf = (ms: number) => {
    const parts = fmt.formatToParts(new Date(ms));
    return `${parts.find((x) => x.type === 'year')?.value}-${parts.find((x) => x.type === 'month')?.value}`;
  };
  let [y, m] = keyOf(nowMs).split('-').map(Number) as [number, number];
  const keys: string[] = [];
  for (let i = 0; i < months; i++) {
    keys.unshift(`${y}-${String(m).padStart(2, '0')}`);
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
  }
  const totals = new Map(keys.map((k) => [k, 0]));
  for (const r of history) {
    if (r.kind !== 'earn' || r.delta <= 0) continue;
    const k = keyOf(Date.parse(r.created_at));
    const t = totals.get(k);
    if (t !== undefined) totals.set(k, t + r.delta);
  }
  return keys.map((key) => ({ key, total: totals.get(key) ?? 0 }));
}

// ---------------------------------------------------------------------------
// Setup › Loyalty
// ---------------------------------------------------------------------------

export interface SettingsDraft {
  enabled: boolean;
  iqd_per_point: string;
  point_value_iqd: string;
  min_redeem_points: string;
  earn_cafe: boolean;
  earn_shop: boolean;
  earn_court: boolean;
  earn_lesson: boolean;
  earn_tournament: boolean;
  inactivity_expiry_months: string;
  totp_step_seconds: string;
  /** 0403: "Use points" as money off the bill; off by default. */
  points_off_enabled: boolean;
}

/** loyalty_settings.inactivity_expiry_months: between 1 and 120 (0305's check). */
export const EXPIRY_MONTHS_MAX = 120;

export function settingsDraft(s: LoyaltySettings): SettingsDraft {
  return {
    enabled: s.enabled,
    iqd_per_point: String(s.iqd_per_point),
    point_value_iqd: String(s.point_value_iqd),
    min_redeem_points: String(s.min_redeem_points),
    earn_cafe: s.earn_cafe,
    earn_shop: s.earn_shop,
    earn_court: s.earn_court,
    earn_lesson: s.earn_lesson,
    earn_tournament: s.earn_tournament,
    inactivity_expiry_months:
      s.inactivity_expiry_months == null ? '' : String(s.inactivity_expiry_months),
    totp_step_seconds: String(s.totp_step_seconds),
    points_off_enabled: s.points_off_enabled === true,
  };
}

export type SettingsFieldError = 'positive' | 'notNegative' | 'step' | 'months';

export function settingsErrors(
  d: SettingsDraft,
): Partial<Record<keyof SettingsDraft, SettingsFieldError>> {
  const out: Partial<Record<keyof SettingsDraft, SettingsFieldError>> = {};
  const positive = (k: 'iqd_per_point' | 'point_value_iqd') => {
    const n = parseWhole(d[k]);
    if (n === null || n <= 0) out[k] = 'positive';
  };
  positive('iqd_per_point');
  positive('point_value_iqd');
  if (parseWhole(d.min_redeem_points) === null) out.min_redeem_points = 'notNegative';
  if (d.inactivity_expiry_months.trim() !== '') {
    const n = parseWhole(d.inactivity_expiry_months);
    if (n === null || n <= 0 || n > EXPIRY_MONTHS_MAX) out.inactivity_expiry_months = 'months';
  }
  const step = parseWhole(d.totp_step_seconds);
  if (step === null || step < 15 || step > 120) out.totp_step_seconds = 'step';
  return out;
}

/** The p_patch app.set_loyalty_settings takes; call only when settingsErrors is empty. */
export function settingsPatch(d: SettingsDraft): LoyaltySettings {
  return {
    enabled: d.enabled,
    iqd_per_point: parseWhole(d.iqd_per_point) ?? 0,
    point_value_iqd: parseWhole(d.point_value_iqd) ?? 0,
    min_redeem_points: parseWhole(d.min_redeem_points) ?? 0,
    earn_cafe: d.earn_cafe,
    earn_shop: d.earn_shop,
    earn_court: d.earn_court,
    earn_lesson: d.earn_lesson,
    earn_tournament: d.earn_tournament,
    inactivity_expiry_months:
      d.inactivity_expiry_months.trim() === '' ? null : parseWhole(d.inactivity_expiry_months),
    totp_step_seconds: parseWhole(d.totp_step_seconds) ?? 30,
    points_off_enabled: d.points_off_enabled,
  };
}

export interface TierDraft {
  id: string | null;
  name_en: string;
  name_ar: string;
  min_points_12m: string;
  earn_multiplier: string;
  promotion_id: string | null;
  sort: number;
  /** 0376: the card colour the guest's points card takes in this tier. */
  color: TierColor;
}

/**
 * The colour a new tier starts on (0416): the first of the club's cards (white, green, blue,
 * black: CARD_LADDER) no tier has yet, so the starter card and three tiers added in a row come
 * out white, green, blue, black; black once every one is taken. The owner can pick any.
 */
export function suggestTierColor(tiers: readonly Pick<LoyaltyAdminTier, 'color'>[]): TierColor {
  const used = new Set(tiers.map((t) => tierColor(t.color)));
  return CARD_LADDER.find((c) => !used.has(c)) ?? 'black';
}

export function tierDraft(
  t: LoyaltyAdminTier | null,
  tiers: readonly LoyaltyAdminTier[],
): TierDraft {
  if (t) {
    return {
      id: t.id,
      name_en: t.name_en,
      name_ar: t.name_ar,
      min_points_12m: String(t.min_points_12m),
      earn_multiplier: String(t.earn_multiplier),
      promotion_id: t.promotion_id,
      sort: t.sort,
      color: tierColor(t.color),
    };
  }
  // A new tier goes after the last one; its order is unique (loyalty_tiers.sort).
  const sort = tiers.reduce((m, x) => Math.max(m, x.sort), -1) + 1;
  return {
    id: null,
    name_en: '',
    name_ar: '',
    min_points_12m: '',
    earn_multiplier: '1',
    promotion_id: null,
    sort,
    color: suggestTierColor(tiers),
  };
}

export function parseMultiplier(text: string): number | null {
  const t = text.trim().replace('٫', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(t)) return null;
  const n = Number(t);
  return n >= 1 && n <= 5 ? n : null;
}

export function tierErrors(d: TierDraft): {
  names?: true;
  min_points_12m?: true;
  earn_multiplier?: true;
} {
  return {
    ...(d.name_en.trim() === '' || d.name_ar.trim() === '' ? { names: true as const } : {}),
    ...(parseWhole(d.min_points_12m) === null ? { min_points_12m: true as const } : {}),
    ...(parseMultiplier(d.earn_multiplier) === null ? { earn_multiplier: true as const } : {}),
  };
}

/** The p_tier app.upsert_loyalty_tier takes (no id: a new tier). */
export function tierPayload(d: TierDraft): Record<string, unknown> {
  return {
    ...(d.id ? { id: d.id } : {}),
    name_en: d.name_en.trim(),
    name_ar: d.name_ar.trim(),
    min_points_12m: parseWhole(d.min_points_12m) ?? 0,
    earn_multiplier: parseMultiplier(d.earn_multiplier) ?? 1,
    promotion_id: d.promotion_id,
    sort: d.sort,
    color: d.color,
  };
}

/** The base tier (sort 0) is everyone's: app.delete_loyalty_tier refuses it. */
export function isBaseTier(t: Pick<LoyaltyAdminTier, 'sort'>): boolean {
  return t.sort === 0;
}

// ---------------------------------------------------------------------------
// Setup › Loyalty: what a card gives (0410)
// ---------------------------------------------------------------------------

/** loyalty_tier_perks.name_en / name_ar: 1 to 80 characters. */
export const PERK_NAME_MAX = 80;

/** An add-on group as the menu names it (modifier_groups). */
export interface AddonGroup {
  id: string;
  name_en: string;
  name_ar: string;
}

/** A menu section or item as a picker and a privilege's summary name it. */
export interface MenuNamed {
  id: string;
  name_en: string;
  name_ar: string;
}

/** The café menu's sections and items, as names (useAdminMenu). */
export interface MenuNames {
  categories: readonly MenuNamed[];
  items: readonly MenuNamed[];
}

/** The ids the menu still has; null where the menu has not been read. */
export interface MenuKnown {
  categories: ReadonlySet<string>;
  items: ReadonlySet<string>;
}

/** The menu's ids as sets, for perkErrors / perkPayload / the drink card. */
export function menuKnown(menu: MenuNames | null | undefined): MenuKnown | null {
  if (!menu) return null;
  return { categories: new Set(menu.categories.map((c) => c.id)), items: new Set(menu.items.map((i) => i.id)) };
}

/** 0445: a birthday gift's window, in days from the birthday (the server's 1..31, default 7). */
export const GIFT_DAYS_DEFAULT = 7;
export const GIFT_DAYS_MAX = 31;
/** A card-up gift's window, in days from the day the member reached the card (1..90, default 30). */
export const CARD_UP_DAYS_DEFAULT = 30;
export const CARD_UP_DAYS_MAX = 90;

/** The days a gift's `when` starts with; monthly has none (the calendar month). */
export function giftDaysDefault(when: GiftWhen): number | null {
  return when === 'birthday' ? GIFT_DAYS_DEFAULT : when === 'card_up' ? CARD_UP_DAYS_DEFAULT : null;
}

/** The most days a gift's `when` allows; null for monthly. */
export function giftDaysMax(when: GiftWhen): number | null {
  return when === 'birthday' ? GIFT_DAYS_MAX : when === 'card_up' ? CARD_UP_DAYS_MAX : null;
}

/** A gift's `when`, read safely (absent = birthday, as the server defaults it). */
export function giftWhenOf(v: unknown): GiftWhen {
  return (GIFT_WHENS as readonly unknown[]).includes(v) ? (v as GiftWhen) : 'birthday';
}

/** A gift's `target`, read safely (absent = items, as the server defaults it). */
export function giftTargetOf(v: unknown): GiftTarget {
  return (GIFT_TARGETS as readonly unknown[]).includes(v) ? (v as GiftTarget) : 'items';
}
/** 0445: a drink card fills at 2..20 stamps; the club's standard starts at 8. */
export const STAMP_SIZE_MIN = 2;
export const STAMP_SIZE_MAX = 20;
export const STAMP_SIZE_STANDARD = 8;

/** The order the editor offers the kinds in (TIER_PERK_KINDS: the till's own kinds first, by hand last). */
export const PERK_KINDS: readonly TierPerkKind[] = TIER_PERK_KINDS;

export interface PerkDraft {
  id: string | null;
  tier_id: string;
  kind: TierPerkKind;
  name_en: string;
  name_ar: string;
  /**
   * True until the owner types a name: the two names then follow what the privilege gives
   * (defaultNamesFor). An existing privilege keeps the names it was saved with.
   */
  autoName: boolean;
  /** free_addons: every paid add-on, or only the groups chosen. */
  scope: 'all' | 'groups';
  modifier_group_ids: string[];
  /** gift (0445): when it opens (birthday, every month, on reaching this card). */
  giftWhen: GiftWhen;
  /** gift: one unit of a matching menu item, or one hour of the booking's court fee. */
  giftTarget: GiftTarget;
  /** gift, target items: the menu sections and items one unit of which is free. */
  giftCategoryIds: string[];
  giftItemIds: string[];
  /** gift: how many days it can be used from its start (text, as typed); unused for monthly. */
  giftDays: string;
  /** size_upgrade (0445): the menu sections and items charged one size down. */
  sizeCategoryIds: string[];
  sizeItemIds: string[];
  /** free_with (0445): what must be on the bill, and what one unit of comes free with each. */
  triggerCategoryIds: string[];
  triggerItemIds: string[];
  freeCategoryIds: string[];
  freeItemIds: string[];
  /** frame (0445): the profile ring the card unlocks. */
  frameId: CardFrameId;
  /** stamp_size (0445): the stamps this card's drink card fills at (text, as typed). */
  stampSize: string;
  active: boolean;
  /** Null on a new privilege: the server puts it after the tier's last one. */
  sort: number | null;
}

/** The ring a frame privilege names, read safely (an unknown one reads as the green card's). */
export function frameIdOf(v: unknown): CardFrameId {
  return (CARD_FRAME_IDS as readonly unknown[]).includes(v) ? (v as CardFrameId) : 'card-green';
}

/** The card word of a ring: card-green → green. */
export function frameWord(id: CardFrameId): 'green' | 'blue' | 'black' {
  return id === 'card-blue' ? 'blue' : id === 'card-black' ? 'black' : 'green';
}

function idList(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && x !== '') : [];
}

function configOf(p: { config?: unknown } | null | undefined): Record<string, unknown> {
  const c = p?.config;
  return c && typeof c === 'object' && !Array.isArray(c) ? (c as Record<string, unknown>) : {};
}

function namesIn(list: readonly MenuNamed[], locale: 'en' | 'ar'): string[] {
  return list
    .map((g) => (locale === 'ar' ? g.name_ar || g.name_en : g.name_en || g.name_ar).trim())
    .filter(Boolean);
}

function pickedNamed(ids: readonly string[], from: readonly MenuNamed[] | undefined): MenuNamed[] {
  if (!from) return [];
  return ids.map((id) => from.find((x) => x.id === id)).filter((x): x is MenuNamed => Boolean(x));
}

/**
 * The names a free add-ons privilege starts with, in both languages: what the guest reads on
 * their card. "Free add-ons: Milk, Syrups" while the groups' own names fit, else the plain line.
 */
export function defaultPerkNames(
  scope: PerkDraft['scope'],
  groups: readonly AddonGroup[],
): { name_en: string; name_ar: string } {
  const one = (locale: 'en' | 'ar') => {
    const tr = makeT(locale);
    const K = 'ws.loyalty.setup.perks.defaults';
    if (scope === 'all') return tr(`${K}.all`);
    const names = namesIn(groups, locale);
    if (names.length === 0) return tr(`${K}.some`);
    const line = tr(`${K}.groups`, { groups: names.join(tr(`${K}.sep`)) });
    return line.length <= PERK_NAME_MAX ? line : tr(`${K}.some`);
  };
  return { name_en: one('en'), name_ar: one('ar') };
}

/**
 * 0445: the names any kind starts with, in both languages. A birthday gift names what it frees
 * ("Birthday gift: Hot drinks"), a free-with privilege both sides ("Free Tea with Desserts"), a
 * ring its card, a smaller drink card its size; each falls back to a plain line when the menu's
 * names are unknown or too long for the 80 characters a name may have. Something else: none.
 */
export function defaultNamesFor(
  d: PerkDraft,
  groups: readonly AddonGroup[],
  menu: MenuNames | null,
): { name_en: string; name_ar: string } {
  if (d.kind === 'free_addons') {
    const chosen = d.scope === 'groups' ? groups.filter((g) => d.modifier_group_ids.includes(g.id)) : [];
    return defaultPerkNames(d.scope, chosen);
  }
  if (d.kind === 'custom') return { name_en: '', name_ar: '' };
  const K = 'ws.loyalty.setup.perks.defaults';
  const fit = (line: string, plain: string) => (line.length <= PERK_NAME_MAX ? line : plain);
  const one = (locale: 'en' | 'ar') => {
    const tr = makeT(locale);
    const sep = tr(`${K}.sep`);
    const list = (cats: readonly string[], items: readonly string[]) =>
      [...namesIn(pickedNamed(cats, menu?.categories), locale), ...namesIn(pickedNamed(items, menu?.items), locale)];
    switch (d.kind) {
      case 'gift': {
        const plain = tr(`${K}.giftPlain.${d.giftWhen}`);
        if (d.giftTarget === 'court_hour') return tr(`${K}.giftCourt.${d.giftWhen}`);
        const what = list(d.giftCategoryIds, d.giftItemIds);
        return what.length === 0 ? plain : fit(tr(`${K}.gift.${d.giftWhen}`, { what: what.join(sep) }), plain);
      }
      case 'size_upgrade': {
        const what = list(d.sizeCategoryIds, d.sizeItemIds);
        return what.length === 0 ? tr(`${K}.sizeUpgradePlain`) : fit(tr(`${K}.sizeUpgrade`, { what: what.join(sep) }), tr(`${K}.sizeUpgradePlain`));
      }
      case 'free_with': {
        const free = list(d.freeCategoryIds, d.freeItemIds);
        const trigger = list(d.triggerCategoryIds, d.triggerItemIds);
        if (free.length === 0 || trigger.length === 0) return tr(`${K}.freeWithPlain`);
        return fit(tr(`${K}.freeWith`, { free: free.join(sep), trigger: trigger.join(sep) }), tr(`${K}.freeWithPlain`));
      }
      case 'frame':
        return tr(`${K}.frame.${frameWord(d.frameId)}`);
      case 'stamp_size': {
        const n = parseWhole(d.stampSize);
        return n === null ? tr(`${K}.stampSizePlain`) : tr(`${K}.stampSize`, { n });
      }
      default:
        return '';
    }
  };
  return { name_en: one('en'), name_ar: one('ar') };
}

/** The draft with its names brought in line with what it gives, while they are still the default. */
export function withAutoNames(d: PerkDraft, groups: readonly AddonGroup[], menu: MenuNames | null = null): PerkDraft {
  if (!d.autoName) return d;
  return { ...d, ...defaultNamesFor(d, groups, menu) };
}

const EMPTY_KIND_FIELDS = {
  scope: 'all' as const,
  modifier_group_ids: [] as string[],
  giftWhen: 'birthday' as GiftWhen,
  giftTarget: 'items' as GiftTarget,
  giftCategoryIds: [] as string[],
  giftItemIds: [] as string[],
  giftDays: String(GIFT_DAYS_DEFAULT),
  sizeCategoryIds: [] as string[],
  sizeItemIds: [] as string[],
  triggerCategoryIds: [] as string[],
  triggerItemIds: [] as string[],
  freeCategoryIds: [] as string[],
  freeItemIds: [] as string[],
  frameId: 'card-green' as CardFrameId,
  stampSize: '',
};

function giftFields(c: Record<string, unknown>) {
  const when = giftWhenOf(c.when);
  const fallback = giftDaysDefault(when) ?? GIFT_DAYS_DEFAULT;
  return {
    giftWhen: when,
    giftTarget: giftTargetOf(c.target),
    giftCategoryIds: idList(c.categoryIds),
    giftItemIds: idList(c.itemIds),
    giftDays: String(Number(c.days) > 0 ? Number(c.days) : fallback),
  };
}

/**
 * The draft with a gift's `when` changed: the days move to that `when`'s default (a birthday
 * week, a month after reaching the card), since a number typed for one rarely fits the other.
 */
export function withGiftWhen(d: PerkDraft, when: GiftWhen): Partial<PerkDraft> {
  if (d.giftWhen === when) return {};
  const days = giftDaysDefault(when);
  return { giftWhen: when, ...(days !== null ? { giftDays: String(days) } : {}) };
}

export function perkDraft(p: LoyaltyAdminPerk | null, tierId: string): PerkDraft {
  if (p) {
    const ids = Array.isArray(p.modifier_group_ids) ? p.modifier_group_ids : [];
    const c = configOf(p);
    const kind: TierPerkKind = (TIER_PERK_KINDS as readonly string[]).includes(p.kind) ? p.kind : 'free_addons';
    return {
      id: p.id,
      tier_id: p.tier_id ?? tierId,
      kind,
      name_en: p.name_en,
      name_ar: p.name_ar,
      autoName: false,
      ...EMPTY_KIND_FIELDS,
      scope: ids.length > 0 ? 'groups' : 'all',
      modifier_group_ids: [...ids],
      ...(kind === 'gift' ? giftFields(c) : {}),
      ...(kind === 'size_upgrade' ? { sizeCategoryIds: idList(c.categoryIds), sizeItemIds: idList(c.itemIds) } : {}),
      ...(kind === 'free_with'
        ? {
            triggerCategoryIds: idList(c.triggerCategoryIds),
            triggerItemIds: idList(c.triggerItemIds),
            freeCategoryIds: idList(c.freeCategoryIds),
            freeItemIds: idList(c.freeItemIds),
          }
        : {}),
      ...(kind === 'frame' ? { frameId: frameIdOf(c.frameId) } : {}),
      ...(kind === 'stamp_size' && Number(c.size) > 0 ? { stampSize: String(Number(c.size)) } : {}),
      active: p.active !== false,
      sort: typeof p.sort === 'number' ? p.sort : null,
    };
  }
  return {
    id: null,
    tier_id: tierId,
    kind: 'free_addons',
    ...defaultPerkNames('all', []),
    autoName: true,
    ...EMPTY_KIND_FIELDS,
    active: true,
    sort: null,
  };
}

/**
 * The ids a draft names that the menu still has. `known` null (the menu has not been read)
 * keeps every id: nothing can be told apart yet.
 */
export function liveGroupIds(ids: readonly string[], known: ReadonlySet<string> | null | undefined): string[] {
  return known ? ids.filter((id) => known.has(id)) : [...ids];
}

export interface PerkErrors {
  names?: true;
  groups?: true;
  /** gift (target items): no menu section or item chosen (or none left on the menu). */
  giftItems?: true;
  /** gift: days outside its `when`'s range (birthday 1..31, card_up 1..90). */
  days?: true;
  /** size_upgrade: no menu section or item chosen (or none left on the menu). */
  sizeItems?: true;
  /** free_with: nothing chosen that must be on the bill. */
  trigger?: true;
  /** free_with: nothing chosen that comes free. */
  free?: true;
  /** stamp_size: not 2..20. */
  size?: true;
}

/**
 * `groups` matters most: an empty list means EVERY add-on to the server, so "only these groups"
 * with none left (none ticked, or every ticked one since removed from the menu) must never be
 * saved as it stands. It would quietly make every add-on free. The 0445 kinds need what the
 * server checks (app.upsert_loyalty_tier_perk): something to give, and the numbers in range.
 */
export function perkErrors(d: PerkDraft, known: ReadonlySet<string> | null, menu: MenuKnown | null = null): PerkErrors {
  const en = d.name_en.trim();
  const ar = d.name_ar.trim();
  const out: PerkErrors = {};
  if (en === '' || ar === '' || en.length > PERK_NAME_MAX || ar.length > PERK_NAME_MAX) out.names = true;
  const none = (cats: readonly string[], items: readonly string[]) =>
    liveGroupIds(cats, menu?.categories).length + liveGroupIds(items, menu?.items).length === 0;
  switch (d.kind) {
    case 'free_addons':
      if (d.scope === 'groups' && liveGroupIds(d.modifier_group_ids, known).length === 0) out.groups = true;
      break;
    case 'gift': {
      if (d.giftTarget === 'items' && none(d.giftCategoryIds, d.giftItemIds)) out.giftItems = true;
      const max = giftDaysMax(d.giftWhen);
      if (max !== null) {
        const n = parseWhole(d.giftDays);
        if (n === null || n < 1 || n > max) out.days = true;
      }
      break;
    }
    case 'size_upgrade':
      if (none(d.sizeCategoryIds, d.sizeItemIds)) out.sizeItems = true;
      break;
    case 'free_with':
      if (none(d.triggerCategoryIds, d.triggerItemIds)) out.trigger = true;
      if (none(d.freeCategoryIds, d.freeItemIds)) out.free = true;
      break;
    case 'stamp_size': {
      const n = parseWhole(d.stampSize);
      if (n === null || n < STAMP_SIZE_MIN || n > STAMP_SIZE_MAX) out.size = true;
      break;
    }
    default:
      break;
  }
  return out;
}

/** The config app.upsert_loyalty_tier_perk checks for a 0445 kind; null for free_addons and custom. */
export function perkConfig(d: PerkDraft, menu: MenuKnown | null = null): TierPerkConfig | null {
  switch (d.kind) {
    case 'gift': {
      const items = d.giftTarget === 'items';
      const days = giftDaysMax(d.giftWhen) === null ? null : (parseWhole(d.giftDays) ?? giftDaysDefault(d.giftWhen));
      return {
        when: d.giftWhen,
        target: d.giftTarget,
        categoryIds: items ? liveGroupIds(d.giftCategoryIds, menu?.categories) : [],
        itemIds: items ? liveGroupIds(d.giftItemIds, menu?.items) : [],
        ...(days !== null ? { days } : {}),
      };
    }
    case 'size_upgrade':
      return {
        categoryIds: liveGroupIds(d.sizeCategoryIds, menu?.categories),
        itemIds: liveGroupIds(d.sizeItemIds, menu?.items),
      };
    case 'free_with':
      return {
        triggerCategoryIds: liveGroupIds(d.triggerCategoryIds, menu?.categories),
        triggerItemIds: liveGroupIds(d.triggerItemIds, menu?.items),
        freeCategoryIds: liveGroupIds(d.freeCategoryIds, menu?.categories),
        freeItemIds: liveGroupIds(d.freeItemIds, menu?.items),
      };
    case 'frame':
      return { frameId: d.frameId };
    case 'stamp_size':
      return { size: parseWhole(d.stampSize) ?? STAMP_SIZE_STANDARD };
    default:
      return null;
  }
}

/**
 * The p_perk app.upsert_loyalty_tier_perk takes (no id: a new privilege); call only when
 * perkErrors is empty. A custom privilege and "every add-on" both carry no groups; a group, menu
 * section or item the menu no longer has is left out (the server refuses an unknown one). Only
 * the 0445 kinds carry a config: for free add-ons and custom the server keeps it empty.
 */
export function perkPayload(
  d: PerkDraft,
  known: ReadonlySet<string> | null,
  menu: MenuKnown | null = null,
): Record<string, unknown> {
  const config = perkConfig(d, menu);
  return {
    ...(d.id ? { id: d.id } : {}),
    tier_id: d.tier_id,
    kind: d.kind,
    name_en: d.name_en.trim(),
    name_ar: d.name_ar.trim(),
    modifier_group_ids:
      d.kind === 'free_addons' && d.scope === 'groups' ? liveGroupIds(d.modifier_group_ids, known) : [],
    ...(config ? { config } : {}),
    active: d.active,
    ...(d.sort !== null ? { sort: d.sort } : {}),
  };
}

/** Chosen menu ids, read against the menu: the ones it has by name, and how many it lost. */
export interface MenuPick {
  named: MenuNamed[];
  missing: number;
  count: number;
}

function menuPick(cats: readonly string[], items: readonly string[], menu: MenuNames | null): MenuPick {
  const count = cats.length + items.length;
  if (!menu) return { named: [], missing: 0, count };
  const named = [...pickedNamed(cats, menu.categories), ...pickedNamed(items, menu.items)];
  return { named, missing: count - named.length, count };
}

/** What a privilege gives, for its row in plain words. */
export type PerkGives =
  | { kind: 'custom' }
  | { kind: 'all' }
  | {
      kind: 'groups';
      /** The chosen groups the menu still has (empty while the menu is unread). */
      groups: AddonGroup[];
      /** Chosen groups the menu no longer has. */
      missing: number;
      /** How many were chosen, known or not. */
      count: number;
    }
  | { kind: 'gift'; when: GiftWhen; target: GiftTarget; what: MenuPick; days: number | null }
  | { kind: 'size_upgrade'; what: MenuPick }
  | { kind: 'free_with'; trigger: MenuPick; free: MenuPick }
  | { kind: 'frame'; frameId: CardFrameId }
  | { kind: 'stamp_size'; size: number };

/** `groups` / `menu` null: not read (or could not be), so only the counts are known. */
export function perkGives(
  p: Pick<LoyaltyAdminPerk, 'kind' | 'modifier_group_ids'> & { config?: unknown },
  groups: readonly AddonGroup[] | null,
  menu: MenuNames | null = null,
): PerkGives {
  const c = configOf(p);
  switch (p.kind) {
    case 'custom':
      return { kind: 'custom' };
    case 'gift': {
      const when = giftWhenOf(c.when);
      const target = giftTargetOf(c.target);
      return {
        kind: 'gift',
        when,
        target,
        what: target === 'items' ? menuPick(idList(c.categoryIds), idList(c.itemIds), menu) : { named: [], missing: 0, count: 0 },
        days: giftDaysDefault(when) === null ? null : Number(c.days) > 0 ? Number(c.days) : giftDaysDefault(when),
      };
    }
    case 'size_upgrade':
      return { kind: 'size_upgrade', what: menuPick(idList(c.categoryIds), idList(c.itemIds), menu) };
    case 'free_with':
      return {
        kind: 'free_with',
        trigger: menuPick(idList(c.triggerCategoryIds), idList(c.triggerItemIds), menu),
        free: menuPick(idList(c.freeCategoryIds), idList(c.freeItemIds), menu),
      };
    case 'frame':
      return { kind: 'frame', frameId: frameIdOf(c.frameId) };
    case 'stamp_size':
      return { kind: 'stamp_size', size: Number(c.size) > 0 ? Number(c.size) : STAMP_SIZE_STANDARD };
    default:
      break;
  }
  const ids = Array.isArray(p.modifier_group_ids) ? p.modifier_group_ids : [];
  if (ids.length === 0) return { kind: 'all' };
  if (!groups) return { kind: 'groups', groups: [], missing: 0, count: ids.length };
  const found = ids.map((id) => groups.find((g) => g.id === id)).filter((g): g is AddonGroup => Boolean(g));
  return { kind: 'groups', groups: found, missing: ids.length - found.length, count: ids.length };
}

/** True when a privilege's row should warn: something it names is gone from the menu. */
export function perkMissing(g: PerkGives): number {
  if (g.kind === 'groups') return g.missing;
  if (g.kind === 'gift' || g.kind === 'size_upgrade') return g.what.missing;
  if (g.kind === 'free_with') return g.trigger.missing + g.free.missing;
  return 0;
}

/**
 * 0445: the drink card size each card's privileges set (the lowest active stamp_size of the card
 * and every card below it, as app.loyalty_stamp_size takes it), for the cards that change it.
 */
export function stampSizesByCard(
  tiers: readonly Pick<LoyaltyAdminTier, 'id' | 'sort' | 'perks' | 'name_en' | 'name_ar'>[],
  standard: number,
): { tier: Pick<LoyaltyAdminTier, 'id' | 'name_en' | 'name_ar'>; size: number }[] {
  const sorted = [...tiers].sort((a, b) => a.sort - b.sort);
  const out: { tier: Pick<LoyaltyAdminTier, 'id' | 'name_en' | 'name_ar'>; size: number }[] = [];
  let lowest = standard;
  for (const t of sorted) {
    for (const p of t.perks ?? []) {
      if (p.kind !== 'stamp_size' || p.active === false) continue;
      const n = Number(configOf(p).size);
      if (n >= STAMP_SIZE_MIN && n < lowest) lowest = n;
    }
    if (lowest < standard) out.push({ tier: t, size: lowest });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Setup › Loyalty: the drink card (0445)
// ---------------------------------------------------------------------------

/** app.stamp_card_settings with every list a list, whatever came back; null when not an answer. */
export function readStampCard(raw: unknown): StampCardSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Partial<StampCardSettings>;
  if (typeof r.enabled !== 'boolean' && r.size === undefined) return null;
  const size = Number(r.size);
  return {
    enabled: r.enabled === true,
    size: Number.isInteger(size) && size >= STAMP_SIZE_MIN && size <= STAMP_SIZE_MAX ? size : STAMP_SIZE_STANDARD,
    category_ids: idList(r.category_ids),
    excluded_item_ids: idList(r.excluded_item_ids),
    updated_at: typeof r.updated_at === 'string' ? r.updated_at : null,
  };
}

export interface StampCardDraft {
  enabled: boolean;
  size: string;
  category_ids: string[];
  excluded_item_ids: string[];
}

export function stampCardDraft(s: StampCardSettings): StampCardDraft {
  return {
    enabled: s.enabled,
    size: String(s.size),
    category_ids: [...s.category_ids],
    excluded_item_ids: [...s.excluded_item_ids],
  };
}

/**
 * What app.set_stamp_card refuses, asked first: a size outside 2..20, and a drink card that is on
 * with no menu section to stamp (none chosen, or every chosen one gone from the menu).
 */
export function stampCardErrors(d: StampCardDraft, menu: MenuKnown | null): { size?: true; categories?: true } {
  const n = parseWhole(d.size);
  return {
    ...(n === null || n < STAMP_SIZE_MIN || n > STAMP_SIZE_MAX ? { size: true as const } : {}),
    ...(d.enabled && liveGroupIds(d.category_ids, menu?.categories).length === 0 ? { categories: true as const } : {}),
  };
}

/** The p_card app.set_stamp_card takes; ids the menu no longer has are left out (the server refuses them). */
export function stampCardPayload(d: StampCardDraft, menu: MenuKnown | null): StampCardSettings {
  return {
    enabled: d.enabled,
    size: parseWhole(d.size) ?? STAMP_SIZE_STANDARD,
    category_ids: liveGroupIds(d.category_ids, menu?.categories),
    excluded_item_ids: liveGroupIds(d.excluded_item_ids, menu?.items),
  };
}

/**
 * The items the "never stamp" picker offers: the items of the stamping sections, and any item
 * already excluded (so one whose section was taken off can still be removed).
 */
export function excludableItems<T extends { id: string; category_id: string }>(
  items: readonly T[],
  d: Pick<StampCardDraft, 'category_ids' | 'excluded_item_ids'>,
): T[] {
  const cats = new Set(d.category_ids);
  return items.filter((i) => cats.has(i.category_id) || d.excluded_item_ids.includes(i.id));
}

/** A tier's privileges in the order the guest reads them. */
export function sortedPerks(perks: readonly LoyaltyAdminPerk[] | undefined): LoyaltyAdminPerk[] {
  return [...(perks ?? [])].sort((a, b) => a.sort - b.sort);
}

/** True when the server lists privileges at all (0410); an older one sends no `perks`. */
export function perksSupported(tiers: readonly Pick<LoyaltyAdminTier, 'perks'>[]): boolean {
  return tiers.some((t) => Array.isArray(t.perks));
}

export interface RewardDraft {
  id: string | null;
  name_en: string;
  name_ar: string;
  cost_points: string;
  kind: LoyaltyRewardKind;
  iqd_off: string;
  menu_variant_id: string | null;
  active: boolean;
  venue_id: string | null;
}

export function rewardDraft(r: LoyaltyAdminReward | null): RewardDraft {
  if (r) {
    return {
      id: r.id,
      name_en: r.name_en,
      name_ar: r.name_ar,
      cost_points: String(r.cost_points),
      kind: r.kind,
      iqd_off: r.iqd_off == null ? '' : String(r.iqd_off),
      menu_variant_id: r.menu_variant_id,
      active: r.active,
      venue_id: r.venue_id,
    };
  }
  return {
    id: null,
    name_en: '',
    name_ar: '',
    cost_points: '',
    kind: 'iqd_off',
    iqd_off: '',
    menu_variant_id: null,
    active: true,
    venue_id: null,
  };
}

export function rewardErrors(d: RewardDraft): {
  names?: true;
  cost?: true;
  iqdOff?: true;
  variant?: true;
} {
  const cost = parseWhole(d.cost_points);
  const off = parseWhole(d.iqd_off);
  return {
    ...(d.name_en.trim() === '' || d.name_ar.trim() === '' ? { names: true as const } : {}),
    ...(cost === null || cost <= 0 ? { cost: true as const } : {}),
    ...(d.kind === 'iqd_off' && (off === null || off <= 0) ? { iqdOff: true as const } : {}),
    ...(d.kind === 'item' && !d.menu_variant_id ? { variant: true as const } : {}),
  };
}

/**
 * The p_reward app.upsert_loyalty_reward takes: the other kind's column is sent as null (the
 * table's check); a court_hour reward (0403) sends both as null.
 */
export function rewardPayload(d: RewardDraft): Record<string, unknown> {
  return {
    ...(d.id ? { id: d.id } : {}),
    name_en: d.name_en.trim(),
    name_ar: d.name_ar.trim(),
    cost_points: parseWhole(d.cost_points) ?? 0,
    kind: d.kind,
    iqd_off: d.kind === 'iqd_off' ? parseWhole(d.iqd_off) : null,
    menu_variant_id: d.kind === 'item' ? d.menu_variant_id : null,
    active: d.active,
    venue_id: d.venue_id,
  };
}

/** Rewards the till offers at this branch: active, and for every branch or this one. */
export function rewardsHere<T extends { active?: boolean; venue_id?: string | null }>(
  rows: readonly T[],
  branchId: string | null,
): T[] {
  return rows.filter((r) => r.active !== false && (r.venue_id == null || r.venue_id === branchId));
}
