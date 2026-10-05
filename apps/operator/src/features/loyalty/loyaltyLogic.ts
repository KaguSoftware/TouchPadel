/**
 * The pure half of loyalty on the operator (docs/design/loyalty/build-contracts-2026-10-05.md
 * §1.3, plan §5.3): what the member field holds, what "Use points" offers, which of a tab's
 * adjustments are loyalty ones, and the Setup › Loyalty drafts. The server is the authority on
 * every figure (app.loyalty_redeem caps the points at what is left to pay); this only decides
 * what the screen offers before it asks. Tested in loyaltyLogic.test.ts under node.
 */
import {
  MEMBER_TOKEN_RE,
  parseMemberInput,
  redeemAmount,
  type IdentifiedMember,
  type LedgerKind,
  type LoyaltyAdminReward,
  type LoyaltyAdminTier,
  type LoyaltyCustomer,
  type LoyaltySettings,
} from '@touch/core/loyalty';

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

/** The tab_adjustments reason codes app.loyalty_redeem writes (contracts §1.3). */
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

/** What the staff side knows of the settings: the point value may be unreadable for a cashier. */
export interface RedeemTerms {
  pointValueIqd: number | null;
  minRedeemPoints: number | null;
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
}

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
  };
}

export type SettingsFieldError = 'positive' | 'notNegative' | 'step';

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
    if (n === null || n <= 0) out.inactivity_expiry_months = 'positive';
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
  };
}

/** The base tier (sort 0) is everyone's: app.delete_loyalty_tier refuses it. */
export function isBaseTier(t: Pick<LoyaltyAdminTier, 'sort'>): boolean {
  return t.sort === 0;
}

export interface RewardDraft {
  id: string | null;
  name_en: string;
  name_ar: string;
  cost_points: string;
  kind: 'iqd_off' | 'item';
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

/** The p_reward app.upsert_loyalty_reward takes: the other kind's column is sent as null (the table's check). */
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
