/**
 * Loyalty on the phone (loyalty plan §5.1; build contracts §1.3, §3). PURE: no RN, expo or
 * supabase imports, so it runs under the plain-node vitest setup.
 *
 * The RPCs answer jsonb, so every read is parsed here into the core shapes
 * (`@touch/core/loyalty`) before a screen sees it: a missing list is empty, a missing number is
 * 0, and a card without its three fields is no card at all. The member token itself is
 * `memberToken` from core; this file only decides WHEN it is drawn again.
 */
import type { MessageKey } from '@touch/i18n';
import {
  CARD_FRAME_IDS,
  GIFT_TARGETS,
  GIFT_WHENS,
  MEMBER_CODE_RE,
  TIER_PERK_KINDS,
  type CardFrameId,
  type GiftConfig,
  type GiftTarget,
  type GiftWhen,
  type LadderTier,
  type LedgerKind,
  type LedgerRow,
  type LoyaltyReward,
  type LoyaltyTier,
  type MemberCard,
  type MyLoyalty,
  type TierDeal,
  type TierPerk,
  type TierPerkConfig,
  type TierPerkKind,
  tierColor,
} from '@touch/core/loyalty';

type Obj = Record<string, unknown>;

// The jsonb readers, shared with deals.ts (the other half of the loyalty answers).
export const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
export const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
export const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

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

function parseTier(raw: unknown): LoyaltyTier | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  const tier: LoyaltyTier = {
    id: str(raw.id),
    name_en: str(raw.name_en),
    name_ar: str(raw.name_ar),
    multiplier: num(raw.multiplier ?? 1),
    // 0376: a server before it, or a colour this build does not know, is the classic card.
    color: tierColor(raw.color),
  };
  if (raw.min_points_12m !== undefined && raw.min_points_12m !== null) {
    tier.min_points_12m = num(raw.min_points_12m);
  }
  return tier;
}

function parseLedgerRow(raw: unknown): LedgerRow | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  const kind = LEDGER_KINDS.includes(raw.kind as LedgerKind) ? (raw.kind as LedgerKind) : null;
  if (!kind) return null;
  return {
    id: str(raw.id),
    kind,
    delta: num(raw.delta),
    venue_id: strOrNull(raw.venue_id),
    created_at: str(raw.created_at),
    note: strOrNull(raw.note),
  };
}

function parseReward(raw: unknown): LoyaltyReward | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  return {
    id: str(raw.id),
    name_en: str(raw.name_en),
    name_ar: str(raw.name_ar),
    cost_points: num(raw.cost_points),
    kind: raw.kind === 'item' || raw.kind === 'court_hour' ? raw.kind : 'iqd_off',
    iqd_off: raw.iqd_off === null || raw.iqd_off === undefined ? null : num(raw.iqd_off),
  };
}

export const list = <T>(raw: unknown, parse: (r: unknown) => T | null): T[] =>
  Array.isArray(raw) ? raw.map(parse).filter((x): x is T => x !== null) : [];

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

/**
 * A privilege's settings, by kind (0445), only what the phone shows: a gift's when (birthday when
 * absent), target (items when absent) and days (birthday 1..31, default 7; card-up 1..90, default
 * 30; none for monthly), a drink card size (2..20), a ring's id. Null when the kind carries none
 * or it does not read, so the line is then its name alone.
 */
function parsePerkConfig(kind: TierPerkKind, raw: unknown): TierPerkConfig | null {
  if (!isObj(raw)) return null;
  switch (kind) {
    case 'gift': {
      const when: GiftWhen = (GIFT_WHENS as readonly string[]).includes(str(raw.when))
        ? (raw.when as GiftWhen)
        : 'birthday';
      const target: GiftTarget = (GIFT_TARGETS as readonly string[]).includes(str(raw.target))
        ? (raw.target as GiftTarget)
        : 'items';
      const gift: GiftConfig = { when, target, categoryIds: ids(raw.categoryIds), itemIds: ids(raw.itemIds) };
      if (when !== 'monthly') {
        const [max, fallback] = when === 'card_up' ? [90, 30] : [31, 7];
        const days = raw.days === undefined || raw.days === null ? fallback : Math.round(num(raw.days));
        gift.days = days >= 1 && days <= max ? days : fallback;
      }
      return gift;
    }
    case 'size_upgrade':
      return { categoryIds: ids(raw.categoryIds), itemIds: ids(raw.itemIds) };
    case 'stamp_size': {
      const size = Math.round(num(raw.size));
      return size >= 2 && size <= 20 ? { size } : null;
    }
    case 'frame':
      return (CARD_FRAME_IDS as readonly string[]).includes(str(raw.frameId))
        ? { frameId: str(raw.frameId) as CardFrameId }
        : null;
    case 'free_with':
      return {
        triggerCategoryIds: ids(raw.triggerCategoryIds),
        triggerItemIds: ids(raw.triggerItemIds),
        freeCategoryIds: ids(raw.freeCategoryIds),
        freeItemIds: ids(raw.freeItemIds),
      };
    default:
      return null;
  }
}

/**
 * A privilege needs an id and a name to be shown; a kind this build does not know reads as a line
 * (`custom`). 0445: the kinds gift, free_with, size_upgrade, stamp_size and frame, each with its
 * config when it reads.
 */
function parsePerk(raw: unknown): TierPerk | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  const name_en = str(raw.name_en).trim();
  const name_ar = str(raw.name_ar).trim();
  if (!name_en && !name_ar) return null;
  const kind: TierPerkKind = (TIER_PERK_KINDS as readonly string[]).includes(str(raw.kind))
    ? (raw.kind as TierPerkKind)
    : 'custom';
  const perk: TierPerk = { id: str(raw.id), kind, name_en, name_ar };
  const config = parsePerkConfig(kind, raw.config);
  if (config) perk.config = config;
  return perk;
}

function parseTierDeal(raw: unknown): TierDeal | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  const name_en = str(raw.name_en).trim();
  const name_ar = str(raw.name_ar).trim();
  if (!name_en && !name_ar) return null;
  return { id: str(raw.id), name_en, name_ar };
}

/**
 * `my_loyalty.tiers` (0410): every tier from the base up, each with its own privileges and the
 * listed deals it unlocks. Absent (a server before 0410) or unreadable is no ladder at all; a
 * rung without an id is left out. Sorted by threshold, so the rungs climb whatever order they
 * came in.
 */
export function parseLadder(raw: unknown): LadderTier[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const rungs: LadderTier[] = [];
  for (const r of raw) {
    const tier = parseTier(r);
    if (!tier || !isObj(r) || seen.has(tier.id)) continue;
    seen.add(tier.id);
    rungs.push({
      ...tier,
      // A multiplier under 1 or unreadable would print "0× points": the plain rate instead.
      multiplier: tier.multiplier > 0 ? tier.multiplier : 1,
      min_points_12m: Math.max(0, tier.min_points_12m ?? 0),
      perks: list(r.perks, parsePerk),
      deals: list(r.deals, parseTierDeal),
    });
  }
  // Array.prototype.sort is stable: equal thresholds keep the server's order.
  return rungs.sort((a, b) => a.min_points_12m - b.min_points_12m);
}

/** app.my_loyalty(). Anything unreadable reads as "off", never as a crash. */
export function parseMyLoyalty(raw: unknown): MyLoyalty {
  const o = isObj(raw) ? raw : {};
  const next = parseTier(o.next_tier);
  return {
    enabled: o.enabled === true,
    balance: num(o.balance),
    lifetime: num(o.lifetime),
    points_12m: num(o.points_12m),
    tier: parseTier(o.tier),
    next_tier: next ? { ...next, min_points_12m: next.min_points_12m ?? 0 } : null,
    // 0410: absent from an older server reads as no ladder.
    tiers: parseLadder(o.tiers),
    point_value_iqd: num(o.point_value_iqd),
    min_redeem_points: num(o.min_redeem_points),
    // 0403: points as money off only when the owner turned it on; absent reads as off.
    points_off_enabled: o.points_off_enabled === true,
    history: list(o.history, parseLedgerRow),
    rewards: list(o.rewards, parseReward),
  };
}

/** app.my_member_card() / app.rotate_member_card(): null when the answer is not a usable card. */
export function parseMemberCard(raw: unknown): MemberCard | null {
  if (!isObj(raw)) return null;
  const code = str(raw.member_code).toUpperCase();
  const secret = str(raw.secret_b32).toUpperCase();
  if (!MEMBER_CODE_RE.test(code) || !/^[A-Z2-7]{16,}$/.test(secret)) return null;
  const step = num(raw.step);
  return { member_code: code, secret_b32: secret, step: step >= 15 && step <= 120 ? step : 30 };
}

// ── the cached card (SecureStore, so the QR works offline) ───────────────────

/**
 * The one SecureStore key the card lives under. It names no account: the value carries the
 * account it belongs to, so a second account signing in on this phone never draws the first
 * one's card, and a sign-out or a deletion can remove it by name (purgeKeys.ts).
 */
export const MEMBER_CARD_STORE_KEY = 'tp.memberCard';

export function encodeCachedCard(userId: string, card: MemberCard): string {
  return JSON.stringify({ uid: userId, card });
}

/** The stored card, only when it belongs to `userId` and still parses. */
export function decodeCachedCard(raw: string | null, userId: string | null): MemberCard | null {
  if (!raw || !userId) return null;
  try {
    const o: unknown = JSON.parse(raw);
    if (!isObj(o) || o.uid !== userId) return null;
    return parseMemberCard(o.card);
  } catch {
    return null;
  }
}

// ── the refresh clock ────────────────────────────────────────────────────────

/** How full the countdown bar is: 1 just after a new code, falling to 0 as the step ends. */
export function stepFraction(secondsLeft: number, step: number): number {
  if (step <= 0) return 0;
  return Math.min(1, Math.max(0, secondsLeft / step));
}

/**
 * Milliseconds until the next whole second. The screen ticks on second boundaries, so the
 * countdown and the code change on the same frame the server's counter does.
 */
export function msToNextTick(nowMs: number): number {
  const ms = 1000 - (nowMs % 1000);
  return ms <= 0 ? 1000 : ms;
}

// ── tiers ────────────────────────────────────────────────────────────────────

export interface TierProgress {
  /** 0..1 along the way from this tier's threshold to the next one's. */
  fraction: number;
  /** Points in the last 12 months still needed for the next tier. */
  remaining: number;
}

/**
 * Progress to the next tier, on `points_12m`. Null at the top tier. The current tier's own
 * threshold is used when the answer carries it, else 0 (the base tier's).
 */
export function tierProgress(
  l: Pick<MyLoyalty, 'points_12m' | 'tier' | 'next_tier'>,
): TierProgress | null {
  if (!l.next_tier) return null;
  const target = l.next_tier.min_points_12m;
  const from = Math.min(l.tier?.min_points_12m ?? 0, target);
  const span = target - from;
  const done = l.points_12m - from;
  return {
    fraction: span <= 0 ? 1 : Math.min(1, Math.max(0, done / span)),
    remaining: Math.max(0, target - l.points_12m),
  };
}

// ── the ladder (0410) ────────────────────────────────────────────────────────

/** held: a rung under the member's card; current: their card; ahead: a card still to reach. */
export type RungState = 'held' | 'current' | 'ahead';

export interface LadderRung {
  tier: LadderTier;
  state: RungState;
  /** Points in the last 12 months still needed for this rung; 0 unless it is ahead. */
  remaining: number;
}

export interface LadderPosition {
  /** Every rung from the base up. Empty when the answer carried no ladder. */
  rungs: LadderRung[];
  /** The member's own rung, or null when they hold no card on the ladder. */
  current: LadderTier | null;
  /** The first rung above theirs, or null at the top. */
  next: LadderTier | null;
}

/**
 * Where the member stands on the ladder. The SERVER names their tier (`tier.id`): a card can be
 * held above what `points_12m` alone would give, so the points decide only when the answer names
 * no tier the ladder carries. Everything under the current rung is held, everything over it is
 * ahead with the points still needed (never negative).
 */
export function ladderPosition(
  l: Pick<MyLoyalty, 'points_12m' | 'tier' | 'tiers'>,
): LadderPosition {
  const tiers = l.tiers ?? [];
  let at = l.tier ? tiers.findIndex((t) => t.id === l.tier?.id) : -1;
  if (at < 0) {
    tiers.forEach((t, i) => {
      if (t.min_points_12m <= l.points_12m) at = i;
    });
  }
  const rungs = tiers.map((tier, i): LadderRung => {
    const state: RungState = i > at ? 'ahead' : i === at ? 'current' : 'held';
    return {
      tier,
      state,
      remaining: state === 'ahead' ? Math.max(0, tier.min_points_12m - l.points_12m) : 0,
    };
  });
  return { rungs, current: tiers[at] ?? null, next: tiers[at + 1] ?? null };
}

/** What a card gives, as the screen lists it. */
export interface CardGives {
  /** The earn rate when it is worth saying (above the rate it is compared with), else null. */
  multiplier: number | null;
  perks: TierPerk[];
  deals: TierDeal[];
}

/**
 * What one rung gives OF ITS OWN: its privileges, the deals it unlocks, and its points rate when
 * that is above `overRate` (the member's current rate for the next card, 1 for a row of the
 * ladder).
 */
export function rungGives(tier: LadderTier, overRate = 1): CardGives {
  return {
    multiplier: tier.multiplier > overRate ? tier.multiplier : null,
    perks: tier.perks,
    deals: tier.deals,
  };
}

/**
 * Everything the member's card holds: its own tier's privileges and deals and those of every
 * tier below it (0410), the highest tier's first, nothing twice; and its points rate when above 1.
 * 0445: the drink card fills at the LOWEST size a held privilege names, so only that one
 * stamp_size line is listed (a lower card's larger size would read as a second, worse card), and
 * a lower card's card-up gift is left out (it welcomed the member to that card, once).
 */
export function cardHolds(position: LadderPosition): CardGives {
  const mine = position.rungs.filter((r) => r.state !== 'ahead').reverse();
  const perks = new Map<string, TierPerk>();
  const deals = new Map<string, TierDeal>();
  for (const r of mine) {
    for (const p of r.tier.perks) {
      // A card-up gift is a welcome to THAT card: a card above it does not hold it.
      if (r.state === 'held' && giftOf(p)?.when === 'card_up') continue;
      if (!perks.has(p.id)) perks.set(p.id, p);
    }
    for (const d of r.tier.deals) if (!deals.has(d.id)) deals.set(d.id, d);
  }
  let smallest: TierPerk | null = null;
  for (const p of perks.values()) {
    const size = stampSizeOf(p);
    if (size !== null && (smallest === null || size < (stampSizeOf(smallest) ?? Infinity))) smallest = p;
  }
  const kept = [...perks.values()].filter(
    (p) => p.kind !== 'stamp_size' || stampSizeOf(p) === null || p === smallest,
  );
  const rate = position.current?.multiplier ?? 1;
  return { multiplier: rate > 1 ? rate : null, perks: kept, deals: [...deals.values()] };
}

/** A stamp_size privilege's size, or null for any other privilege (or one without a size). */
export function stampSizeOf(p: TierPerk): number | null {
  if (p.kind !== 'stamp_size' || !p.config || !('size' in p.config)) return null;
  return p.config.size;
}

/** A gift privilege's settings (0445), or null for any other privilege. */
export function giftOf(p: TierPerk): GiftConfig | null {
  if (p.kind !== 'gift') return null;
  const c = p.config;
  // A gift from before its config read is a birthday gift of an item, as the server defaults.
  if (!c || !('when' in c)) return { when: 'birthday', target: 'items', categoryIds: [], itemIds: [], days: 7 };
  return c as GiftConfig;
}

/** The keys a gift's detail line takes, by when and target (0445). */
export const GIFT_DETAIL_KEYS = {
  birthday: { items: 'loyalty.guest.gives.giftBirthday', court_hour: 'loyalty.guest.gives.giftBirthdayCourt' },
  monthly: { items: 'loyalty.guest.gives.giftMonthly', court_hour: 'loyalty.guest.gives.giftMonthlyCourt' },
  card_up: { items: 'loyalty.guest.gives.giftCardUp', court_hour: 'loyalty.guest.gives.giftCardUpCourt' },
} as const satisfies Record<GiftWhen, Record<GiftTarget, MessageKey>>;

/** The small line under a privilege's name (0445), by kind: what it is, when that helps. */
export type PerkDetail =
  | { key: (typeof GIFT_DETAIL_KEYS)[GiftWhen][GiftTarget]; days: number | null }
  | { key: 'loyalty.guest.gives.freeWithDetail' }
  | { key: 'loyalty.guest.gives.sizeUpgradeDetail' }
  | { key: 'loyalty.guest.gives.stampSizeDetail'; size: number }
  | { key: 'loyalty.guest.gives.frameDetail'; frameId: CardFrameId };

/**
 * What to say under a privilege's own name (the owner writes the name; this is the part a name
 * may leave out): when a gift opens (the birthday, every month, on reaching the card) and for how
 * many days, and whether it is a free court hour; that a free-with comes on every bill; a free
 * size up; the drink card's size; and that a ring is for the profile photo. Null for free add-ons
 * and a line the staff honour by hand (the name says it all) and for a kind whose config did not
 * read.
 */
export function perkDetail(p: TierPerk): PerkDetail | null {
  const c = p.config;
  switch (p.kind) {
    case 'gift': {
      const g = giftOf(p) as GiftConfig;
      return { key: GIFT_DETAIL_KEYS[g.when][g.target], days: g.when === 'monthly' ? null : (g.days ?? null) };
    }
    case 'free_with':
      return { key: 'loyalty.guest.gives.freeWithDetail' };
    case 'size_upgrade':
      return { key: 'loyalty.guest.gives.sizeUpgradeDetail' };
    case 'stamp_size': {
      const size = stampSizeOf(p);
      return size === null ? null : { key: 'loyalty.guest.gives.stampSizeDetail', size };
    }
    case 'frame':
      return c && 'frameId' in c ? { key: 'loyalty.guest.gives.frameDetail', frameId: c.frameId } : null;
    default:
      return null;
  }
}

/** Which mark a privilege's line wears (0445): the screen maps each to an icon. */
export type PerkMark =
  | 'addons'
  | 'birthday'
  | 'monthly'
  | 'cardUp'
  | 'court'
  | 'freeWith'
  | 'sizeUp'
  | 'stamps'
  | 'ring'
  | 'line';

/** A court-hour gift wears the court whenever it opens; an item gift says when it opens. */
export function perkMark(p: TierPerk): PerkMark {
  switch (p.kind) {
    case 'free_addons':
      return 'addons';
    case 'gift': {
      const g = giftOf(p) as GiftConfig;
      if (g.target === 'court_hour') return 'court';
      return g.when === 'monthly' ? 'monthly' : g.when === 'card_up' ? 'cardUp' : 'birthday';
    }
    case 'free_with':
      return 'freeWith';
    case 'size_upgrade':
      return 'sizeUp';
    case 'stamp_size':
      return 'stamps';
    case 'frame':
      return p.config && 'frameId' in p.config ? 'ring' : 'line';
    default:
      return 'line';
  }
}

/** True when the ladder carries a birthday gift on any card (Edit profile's 30-day note). */
export function ladderHasBirthdayGift(l: Pick<MyLoyalty, 'enabled' | 'tiers'> | null | undefined): boolean {
  return !!l?.enabled && (l.tiers ?? []).some((t) => t.perks.some((p) => giftOf(p)?.when === 'birthday'));
}

/** True when there is something to list. */
export function givesAnything(g: CardGives): boolean {
  return g.multiplier !== null || g.perks.length > 0 || g.deals.length > 0;
}

/** A tier's name in the guest's language, the other one when that is empty. */
export function tierName(
  tier: Pick<LoyaltyTier, 'name_en' | 'name_ar'>,
  locale: 'en' | 'ar',
): string {
  return locale === 'ar' ? tier.name_ar || tier.name_en : tier.name_en || tier.name_ar;
}

/** A reward's name, the same rule. */
export function rewardName(
  r: Pick<LoyaltyReward, 'name_en' | 'name_ar'>,
  locale: 'en' | 'ar',
): string {
  return tierName(r, locale);
}

// ── history ──────────────────────────────────────────────────────────────────

/** The line each ledger kind reads in the guest's history. */
export const LEDGER_KIND_KEYS = {
  earn: 'loyalty.guest.history.kind.earn',
  redeem: 'loyalty.guest.history.kind.redeem',
  redeem_void: 'loyalty.guest.history.kind.redeem_void',
  reward: 'loyalty.guest.history.kind.reward',
  adjust: 'loyalty.guest.history.kind.adjust',
  clawback: 'loyalty.guest.history.kind.clawback',
  expire: 'loyalty.guest.history.kind.expire',
  merge_in: 'loyalty.guest.history.kind.merge_in',
} as const satisfies Record<LedgerKind, MessageKey>;

/** `+120` / `−40`: the sign is part of the figure, so the caller isolates it LTR. */
export function signedPoints(delta: number, format: (n: number) => string): string {
  if (delta > 0) return `+${format(delta)}`;
  if (delta < 0) return `−${format(-delta)}`;
  return format(0);
}

/** The profile entries show only while loyalty is on (build contracts L-1). */
export function loyaltyOn(l: Pick<MyLoyalty, 'enabled'> | null | undefined): boolean {
  return l?.enabled === true;
}
