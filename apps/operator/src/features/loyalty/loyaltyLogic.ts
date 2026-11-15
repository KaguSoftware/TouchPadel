/**
 * The pure half of loyalty on the operator (docs/design/loyalty/build-contracts-2026-10-05.md
 * §1.3, plan §5.3): what the member field holds, what "Use points" offers, which of a tab's
 * adjustments are loyalty ones, and the Setup › Loyalty drafts. The server is the authority on
 * every figure (app.loyalty_redeem caps the points at what is left to pay); this only decides
 * what the screen offers before it asks. Tested in loyaltyLogic.test.ts under node.
 */
import {
  CARD_LADDER,
  MEMBER_TOKEN_RE,
  TIER_PERK_REASON_CODE,
  isVoucherCode,
  parseMemberInput,
  redeemAmount,
  tierColor,
  type TierColor,
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
 * 0415: true when a scanner burst is a member card or a reward voucher (TPV-…): the till routes
 * both to the bill's member block instead of the quick add.
 */
export function isLoyaltyScan(code: string): boolean {
  return isMemberScan(code) || isVoucherCode(code);
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
    deal:
      d && typeof d.promotion_id === 'string'
        ? {
            promotion_id: d.promotion_id,
            name_en: String(d.name_en ?? ''),
            name_ar: String(d.name_ar ?? ''),
            type: d.type === 'amount' ? 'amount' : 'percent',
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

export interface PerkDraft {
  id: string | null;
  tier_id: string;
  kind: TierPerkKind;
  name_en: string;
  name_ar: string;
  /**
   * True until the owner types a name: the two names then follow the choice of add-ons
   * (defaultPerkNames). An existing privilege keeps the names it was saved with.
   */
  autoName: boolean;
  /** free_addons: every paid add-on, or only the groups chosen. */
  scope: 'all' | 'groups';
  modifier_group_ids: string[];
  active: boolean;
  /** Null on a new privilege: the server puts it after the tier's last one. */
  sort: number | null;
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
    const names = groups.map((g) => (locale === 'ar' ? g.name_ar || g.name_en : g.name_en || g.name_ar).trim()).filter(Boolean);
    if (names.length === 0) return tr(`${K}.some`);
    const line = tr(`${K}.groups`, { groups: names.join(tr(`${K}.sep`)) });
    return line.length <= PERK_NAME_MAX ? line : tr(`${K}.some`);
  };
  return { name_en: one('en'), name_ar: one('ar') };
}

/** The draft with its names brought in line with its add-ons, while they are still the default. */
export function withAutoNames(d: PerkDraft, groups: readonly AddonGroup[]): PerkDraft {
  if (!d.autoName) return d;
  if (d.kind === 'custom') return { ...d, name_en: '', name_ar: '' };
  const chosen = d.scope === 'groups' ? groups.filter((g) => d.modifier_group_ids.includes(g.id)) : [];
  return { ...d, ...defaultPerkNames(d.scope, chosen) };
}

export function perkDraft(p: LoyaltyAdminPerk | null, tierId: string): PerkDraft {
  if (p) {
    const ids = Array.isArray(p.modifier_group_ids) ? p.modifier_group_ids : [];
    return {
      id: p.id,
      tier_id: p.tier_id ?? tierId,
      kind: p.kind === 'custom' ? 'custom' : 'free_addons',
      name_en: p.name_en,
      name_ar: p.name_ar,
      autoName: false,
      scope: ids.length > 0 ? 'groups' : 'all',
      modifier_group_ids: [...ids],
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
    scope: 'all',
    modifier_group_ids: [],
    active: true,
    sort: null,
  };
}

/**
 * The groups a draft frees that the menu still has. `known` null (the menu has not been read)
 * keeps every id: nothing can be told apart yet.
 */
export function liveGroupIds(ids: readonly string[], known: ReadonlySet<string> | null): string[] {
  return known ? ids.filter((id) => known.has(id)) : [...ids];
}

/**
 * `groups` matters most: an empty list means EVERY add-on to the server, so "only these groups"
 * with none left (none ticked, or every ticked one since removed from the menu) must never be
 * saved as it stands. It would quietly make every add-on free.
 */
export function perkErrors(
  d: PerkDraft,
  known: ReadonlySet<string> | null,
): { names?: true; groups?: true } {
  const en = d.name_en.trim();
  const ar = d.name_ar.trim();
  return {
    ...(en === '' || ar === '' || en.length > PERK_NAME_MAX || ar.length > PERK_NAME_MAX
      ? { names: true as const }
      : {}),
    ...(d.kind === 'free_addons' && d.scope === 'groups' && liveGroupIds(d.modifier_group_ids, known).length === 0
      ? { groups: true as const }
      : {}),
  };
}

/**
 * The p_perk app.upsert_loyalty_tier_perk takes (no id: a new privilege); call only when
 * perkErrors is empty. A custom privilege and "every add-on" both carry no groups; a group the
 * menu no longer has is left out (the server refuses an unknown one).
 */
export function perkPayload(d: PerkDraft, known: ReadonlySet<string> | null): Record<string, unknown> {
  return {
    ...(d.id ? { id: d.id } : {}),
    tier_id: d.tier_id,
    kind: d.kind,
    name_en: d.name_en.trim(),
    name_ar: d.name_ar.trim(),
    modifier_group_ids:
      d.kind === 'free_addons' && d.scope === 'groups' ? liveGroupIds(d.modifier_group_ids, known) : [],
    active: d.active,
    ...(d.sort !== null ? { sort: d.sort } : {}),
  };
}

/** What a privilege gives, for its row: a hand-honoured line, every add-on, or the named groups. */
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
    };

/** `groups` null: the menu has not been read (or could not be), so only the count is known. */
export function perkGives(
  p: Pick<LoyaltyAdminPerk, 'kind' | 'modifier_group_ids'>,
  groups: readonly AddonGroup[] | null,
): PerkGives {
  if (p.kind === 'custom') return { kind: 'custom' };
  const ids = Array.isArray(p.modifier_group_ids) ? p.modifier_group_ids : [];
  if (ids.length === 0) return { kind: 'all' };
  if (!groups) return { kind: 'groups', groups: [], missing: 0, count: ids.length };
  const found = ids.map((id) => groups.find((g) => g.id === id)).filter((g): g is AddonGroup => Boolean(g));
  return { kind: 'groups', groups: found, missing: ids.length - found.length, count: ids.length };
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
