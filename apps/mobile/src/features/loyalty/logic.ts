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
  type LedgerKind,
  type LedgerRow,
  type LoyaltyReward,
  type LoyaltyTier,
  type MemberCard,
  type MyLoyalty,
} from '@touch/core/loyalty';

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0;
const str = (v: unknown): string => (typeof v === 'string' ? v : '');
const strOrNull = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);

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
    kind: raw.kind === 'item' ? 'item' : 'iqd_off',
    iqd_off: raw.iqd_off === null || raw.iqd_off === undefined ? null : num(raw.iqd_off),
  };
}

const list = <T>(raw: unknown, parse: (r: unknown) => T | null): T[] =>
  Array.isArray(raw) ? raw.map(parse).filter((x): x is T => x !== null) : [];

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
    point_value_iqd: num(o.point_value_iqd),
    min_redeem_points: num(o.min_redeem_points),
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
