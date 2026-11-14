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
  MEMBER_CODE_RE,
  type LadderTier,
  type LedgerKind,
  type LedgerRow,
  type LoyaltyReward,
  type LoyaltyTier,
  type MemberCard,
  type MyLoyalty,
  type TierDeal,
  type TierPerk,
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

/** A privilege needs an id and a name to be shown; a kind this build does not know reads as a line. */
function parsePerk(raw: unknown): TierPerk | null {
  if (!isObj(raw) || !str(raw.id)) return null;
  const name_en = str(raw.name_en).trim();
  const name_ar = str(raw.name_ar).trim();
  if (!name_en && !name_ar) return null;
  return { id: str(raw.id), kind: raw.kind === 'free_addons' ? 'free_addons' : 'custom', name_en, name_ar };
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
 */
export function cardHolds(position: LadderPosition): CardGives {
  const mine = position.rungs.filter((r) => r.state !== 'ahead').reverse();
  const perks = new Map<string, TierPerk>();
  const deals = new Map<string, TierDeal>();
  for (const r of mine) {
    for (const p of r.tier.perks) if (!perks.has(p.id)) perks.set(p.id, p);
    for (const d of r.tier.deals) if (!deals.has(d.id)) deals.set(d.id, d);
  }
  const rate = position.current?.multiplier ?? 1;
  return { multiplier: rate > 1 ? rate : null, perks: [...perks.values()], deals: [...deals.values()] };
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
