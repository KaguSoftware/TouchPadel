// Answer shapes of the loyalty RPCs (build contracts §1.3). The RPCs return jsonb, so these are
// the client-side contract; keys are snake_case as the SQL builds them.

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
}

export interface LoyaltyReward {
  id: string;
  name_en: string;
  name_ar: string;
  cost_points: number;
  kind: 'iqd_off' | 'item';
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
  adjustment_id: string;
  points: number;
  amount_iqd: number;
  balance: number;
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
}

export interface LoyaltyAdminTier {
  id: string;
  name_en: string;
  name_ar: string;
  min_points_12m: number;
  earn_multiplier: number;
  promotion_id: string | null;
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
