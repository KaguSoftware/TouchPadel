// Answer shapes of the loyalty RPCs (build contracts §1.3). The RPCs return jsonb, so these are
// the client-side contract; keys are snake_case as the SQL builds them.
import type { TierColor } from './tierColors';

export type LedgerKind =
  'earn' | 'redeem' | 'redeem_void' | 'reward' | 'adjust' | 'clawback' | 'expire' | 'merge_in';

export interface LedgerRow {
  id: string;
  kind: LedgerKind;
  delta: number;
  venue_id: string | null;
  created_at: string;
  note: string | null;
}

export interface LoyaltyTier {
  id: string;
  name_en: string;
  name_ar: string;
  multiplier: number;
  min_points_12m?: number;
  /** 0376: the colour the owner gave the tier; the card's lines, tier word and name. */
  color: TierColor;
}

/**
 * What a tier privilege is (0410): `free_addons` makes paid add-ons free on the member's bills
 * (the till applies it), `custom` is a line the staff honour by hand.
 */
export type TierPerkKind = 'free_addons' | 'custom';

/** A tier privilege as a guest reads it (0410). */
export interface TierPerk {
  id: string;
  kind: TierPerkKind;
  name_en: string;
  name_ar: string;
}

/** A listed deal a tier unlocks, by name (0410). */
export interface TierDeal {
  id: string;
  name_en: string;
  name_ar: string;
}

/**
 * One rung of the guest's tier ladder (0410, `my_loyalty.tiers`): the tier and what it gives of
 * its own. A card also holds what every tier below it gives.
 */
export interface LadderTier extends LoyaltyTier {
  min_points_12m: number;
  perks: TierPerk[];
  deals: TierDeal[];
}

/**
 * What a reward gives: an amount off the bill, one free menu item (0350), or one free hour of
 * court on the booking the tab belongs to (0403; no amount, no item).
 */
export type LoyaltyRewardKind = 'iqd_off' | 'item' | 'court_hour';

export interface LoyaltyReward {
  id: string;
  name_en: string;
  name_ar: string;
  cost_points: number;
  kind: LoyaltyRewardKind;
  iqd_off: number | null;
}

/** app.my_loyalty() */
export interface MyLoyalty {
  enabled: boolean;
  balance: number;
  lifetime: number;
  points_12m: number;
  tier: LoyaltyTier | null;
  next_tier: (LoyaltyTier & { min_points_12m: number }) | null;
  /**
   * 0410: every tier from the base up, with its privileges and the listed deals it unlocks.
   * Absent from an older server: read as empty (the screen then shows no ladder).
   */
  tiers?: LadderTier[];
  point_value_iqd: number;
  min_redeem_points: number;
  /**
   * 0403 (Majed 2026-11-05: rewards are things you take, not a wallet): true when points can
   * also be spent as money off a bill ("Use points"). False, the default: rewards only, so a
   * balance is never shown as an IQD worth. Absent from an older server: read as false.
   */
  points_off_enabled?: boolean;
  history: LedgerRow[];
  rewards: LoyaltyReward[];
}

/** app.loyalty_identify() */
export interface IdentifiedMember {
  customer_id: string;
  display_name: string;
  phone_masked: string | null;
  tier_name_en: string | null;
  tier_name_ar: string | null;
  balance: number;
  enabled: boolean;
}

/** app.loyalty_redeem() */
export interface RedeemResult {
  /** Null for a free court hour (0403): it is a booking row, not a tab adjustment. */
  adjustment_id: string | null;
  points: number;
  amount_iqd: number;
  balance: number;
  /** 0350: the line an item reward freed, else null. */
  order_item_id?: string | null;
  /** 0350: the item reward ordered its item onto the tab first. */
  item_added?: boolean;
  /** 0403: a court_hour reward's reservation_loyalty_rewards id (what loyalty_unredeem takes). */
  court_reward_id?: string | null;
  reservation_id?: string | null;
}

/** Why a free court hour does not fit a tab now (app.loyalty_court_reward, 0403). */
export type CourtRewardRefusal =
  | 'REWARD_NEEDS_BOOKING'
  | 'COURT_DISCOUNT_NOT_ALLOWED'
  | 'REWARD_ALREADY_ON_BOOKING'
  | 'COURT_BILL_CLOSED'
  | 'NOTHING_OWED'
  | 'REWARD_EXCEEDS_BILL';

/** app.loyalty_court_reward(p_tab_id) (0403): the free court hour on this tab's booking. */
export interface CourtRewardState {
  tab_id: string;
  reservation_id: string | null;
  /** A confirmed, arrived or completed booking with a price and no open match. */
  plain_booking: boolean;
  /** What one free hour is worth on this booking now (plain bookings only). */
  value_iqd: number | null;
  /** Null: a court_hour reward can be redeemed on this tab now. */
  refused: CourtRewardRefusal | null;
  /** The free hour already on the booking, for the bill's line and its Undo. */
  reward: {
    /** reservation_loyalty_rewards.id: what app.loyalty_unredeem takes. */
    id: string;
    reward_id: string;
    name_en: string;
    name_ar: string;
    points: number;
    amount_iqd: number;
    created_at: string;
    /** A bill of the booking has closed since: no Undo. */
    closed: boolean;
  } | null;
}

export interface LoyaltySettings {
  enabled: boolean;
  iqd_per_point: number;
  point_value_iqd: number;
  min_redeem_points: number;
  earn_cafe: boolean;
  earn_shop: boolean;
  earn_court: boolean;
  earn_lesson: boolean;
  earn_tournament: boolean;
  inactivity_expiry_months: number | null;
  totp_step_seconds: number;
  /** 0403: "Use points" (points as money off the bill). Off by default; rewards always work. */
  points_off_enabled: boolean;
}

export interface LoyaltyAdminTier {
  id: string;
  name_en: string;
  name_ar: string;
  min_points_12m: number;
  earn_multiplier: number;
  promotion_id: string | null;
  sort: number;
  /** 0376 */
  color: TierColor;
  /** 0410: every privilege of the tier, switched off ones included. Absent from an older server. */
  perks?: LoyaltyAdminPerk[];
}

/** A tier privilege as the owner edits it (0410, `loyalty_admin.tiers[].perks`). */
export interface LoyaltyAdminPerk extends TierPerk {
  tier_id: string;
  /** free_addons: the modifier groups whose paid add-ons are free; empty = every add-on. */
  modifier_group_ids: string[];
  active: boolean;
  sort: number;
}

export interface LoyaltyAdminReward extends LoyaltyReward {
  menu_variant_id: string | null;
  active: boolean;
  venue_id: string | null;
}

/** app.loyalty_admin() */
export interface LoyaltyAdmin {
  settings: LoyaltySettings;
  tiers: LoyaltyAdminTier[];
  rewards: LoyaltyAdminReward[];
}

/** app.loyalty_customer() */
export interface LoyaltyCustomer {
  balance: number;
  lifetime: number;
  points_12m: number;
  tier: LoyaltyTier | null;
  history: LedgerRow[];
}

// ── deals (0410) ─────────────────────────────────────────────────────────────

export type DealState = 'open' | 'locked' | 'used';

export interface DealName {
  name_en: string;
  name_ar: string;
}

/** One listed deal, as app.my_deals() answers it. */
export interface Deal {
  id: string;
  name_en: string;
  name_ar: string;
  /** The owner's line for guests; null: show what the deal covers (`on`) instead. */
  blurb_en: string | null;
  blurb_ar: string | null;
  type: 'percent' | 'amount';
  /** A percent (1..99) or an IQD amount, by `type`. */
  value: number;
  ends_at: string | null;
  /** 0 = Sunday .. 6 = Saturday; empty = every day. */
  weekdays: number[];
  /** 'HH:MM' in the branch's time, or null for all day. */
  hour_from: string | null;
  hour_to: string | null;
  /** Inside its days and hours right now. */
  live_now: boolean;
  min_spend_iqd: number | null;
  /** How many times one guest may use it, or null. */
  per_customer: number | null;
  /** How many times this guest has used it. */
  used: number;
  /** The card it needs, or null for everybody. */
  tier: { id: string; name_en: string; name_ar: string; color: TierColor; min_points_12m: number } | null;
  /** open: theirs to pick; locked: their card is below `tier`; used: their uses are spent. */
  state: DealState;
  /** The deal they picked to use next. */
  picked: boolean;
  /** Null = every branch. */
  venue_id: string | null;
  /** What it takes money off: named items and categories (both empty = the whole café bill). */
  on: { items: DealName[]; categories: DealName[]; courts: boolean };
}

/** app.my_deals() and app.pick_deal() */
export interface MyDeals {
  picked_id: string | null;
  /** When the pick lapses (24 hours after it was made). */
  picked_until: string | null;
  deals: Deal[];
}

/** A privilege on a member's card, as the till reads it (app.loyalty_tab_benefits). */
export interface TabPerk extends TierPerk {
  tier_id: string;
  tier_name_en: string;
  tier_name_ar: string;
  tier_color: TierColor;
}

/** app.loyalty_tab_benefits(p_tab_id) (0410): what the tab customer's card gives on this bill. */
export interface TabBenefits {
  tab_id: string;
  customer_id: string | null;
  /** The loyalty switch. */
  enabled: boolean;
  tier: LoyaltyTier | null;
  /** Their tier's privileges and those of every tier below, highest tier first. */
  perks: TabPerk[];
  addons: {
    /** The free add-ons on the bill's live lines now. */
    on_bill_iqd: number;
    /** What they should come to. */
    due_iqd: number;
    /** app.loyalty_perks_refresh would change something. */
    needs_refresh: boolean;
  };
  /** The listed deal the member picked in the app, when it runs at this branch. */
  deal: {
    promotion_id: string;
    name_en: string;
    name_ar: string;
    type: 'percent' | 'amount';
    value: number;
    /** It is the promotion on this bill already. */
    applied: boolean;
  } | null;
}

/** app.loyalty_perks_refresh(p_tab_id, p_device_id) (0410). */
export interface PerksRefreshResult {
  changed: boolean;
  amount_iqd: number;
  lines: number;
  refused?: 'DISCOUNT_REQUIRES_REFUND';
}

/** The tab_adjustments.reason_code of a free add-on line discount (0410). */
export const TIER_PERK_REASON_CODE = 'loyalty_tier_perk';
