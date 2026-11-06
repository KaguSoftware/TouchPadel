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
