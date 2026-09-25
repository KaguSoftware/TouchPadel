/**
 * What the protocol reads return on the phone (build-contracts-2026-09-23
 * §2.7, §2.9-§2.13), beside the engine shapes `@touch/core` already names
 * (RunRow, StepRow, Can, MyProtocolWork). Every key the SQL builds is here;
 * nulls are allowed where the SQL can return one.
 *
 * Types only (vitest-safe).
 */
import type { Can, RunRow, StaffRole, StepRow } from '@touch/core';

/** `app.protocol_step_def`: one built-in step's def, or null for an owner-added step. */
export interface StepDef {
  step_key: string;
  name_en: string;
  name_ar: string;
  actor_roles: StaffRole[];
  assign_to_starter: boolean;
  needs_owner_ok: boolean;
  ok_fixed: boolean;
  optional: boolean;
  after: string[];
  fixed: 'first' | 'last' | null;
  photo_folder: string | null;
  photos_min: number;
  photos_max: number;
  record_visibility: 'run' | 'mgmt';
}

/** `app.protocol_run_detail`. `data` is null for anyone but management and the starter. */
export interface RunDetail {
  run: RunRow & {
    template_name_en: string | null;
    template_name_ar: string | null;
    data: Record<string, unknown> | null;
  };
  steps: StepRow[];
  can: Can;
}

/** `app.protocol_step_detail`. */
export interface StepDetail {
  run: RunRow & { data: Record<string, unknown> | null };
  step: StepRow;
  can: Can;
  def: StepDef | null;
}

export interface RunsPage {
  runs: RunRow[];
  total: number;
}

export interface StartResult {
  run_id: string;
  status: string;
  first_step_id: string;
  submission_id: string;
  auto: boolean;
}

export interface SubmitResult {
  submission_id: string;
  auto: boolean;
  step_status: string;
  run_status: string;
  opened_step_ids: string[];
}

export interface IngredientOption {
  id: string;
  name_en: string;
  name_ar: string;
  unit: string;
  kind: string;
  pack_size: number | null;
}

export interface NamedRow {
  id: string;
  name_en: string;
  name_ar: string;
}

export interface ReleaseTestContext {
  sizes: {
    variant_id: string;
    name_en: string;
    name_ar: string;
    lines: { ingredient_id: string; name_en: string; name_ar: string; qty: number; unit: string }[];
  }[];
}

export interface ReleaseCost {
  sizes: { variant_id: string; name_en: string; name_ar: string; cost_iqd: number | null; cost_known: boolean }[];
  unknown_lines: string[];
}

export type ReadinessKey = 'names' | 'prices' | 'photo' | 'recipe' | 'category';
export type ReadinessWarning = 'allergens' | 'serve_temp';

export interface ReleaseReadiness {
  ready: boolean;
  checks: { key: ReadinessKey; ok: boolean }[];
  warnings: { key: ReadinessWarning }[];
}

/** `app.release_review`: management only (#54); null until it is written. */
export interface ReleaseReview {
  status: 'written' | 'thin' | 'fallback' | 'failed';
  numbers: {
    units?: number | null;
    revenue_iqd?: number | null;
    margin_iqd?: number | null;
    margin_pct?: number | null;
    category_share_pct?: number | null;
    days_sold?: number | null;
    bought_with?: { item_id: string; name_en: string; name_ar: string; count: number }[] | null;
  } | null;
  write_up: { en?: string | null; ar?: string | null } | null;
  model: string | null;
  written_at: string | null;
}

export interface TargetSize {
  variant_id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
}

export interface TargetItem {
  menu_item_id: string;
  name_en: string;
  name_ar: string;
  category_kind: 'cafe' | 'shop' | string;
  is_active?: boolean;
  sizes: TargetSize[];
}

export interface TargetAddon {
  modifier_id: string;
  group_id: string;
  group_name_en: string;
  group_name_ar: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  is_active: boolean;
  launched: boolean;
}

export interface TargetPromotion {
  promotion_id: string;
  name_en: string;
  name_ar: string;
  type: 'percent' | 'amount';
  value: number;
  starts_at: string | null;
  ends_at: string | null;
  weekdays: number[] | null;
  hour_from: string | null;
  hour_to: string | null;
  scope: Record<string, unknown> | null;
  limits: Record<string, unknown> | null;
  auto: boolean | null;
  public_code: string | null;
  code_single_use: boolean | null;
  enabled: boolean;
  updated_at: string;
}

export interface TargetRule {
  rule_id: string;
  name: string;
  court_id: string | null;
  court_name_en: string | null;
  court_name_ar: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  priority: number | null;
  valid_from: string | null;
  valid_to: string | null;
  is_active: boolean;
  prices: Record<string, number>;
}

/** `app.price_promo_targets(change)`: the one list its change kind reads. */
export interface PriceTargets {
  items?: TargetItem[];
  addons?: TargetAddon[];
  promotions?: TargetPromotion[];
  rules?: TargetRule[];
  featured_item_id?: string | null;
  featured_discount_pct?: number | null;
  hero_mode?: string | null;
}

/** `app.price_promo_numbers`: management only. */
export interface PriceNumbers {
  change: string;
  sizes: {
    variant_id: string | null;
    name_en: string;
    name_ar: string;
    current_price_iqd: number | null;
    new_price_iqd: number | null;
    cost_iqd: number | null;
    cost_known: boolean;
    margin_before_iqd: number | null;
    margin_after_iqd: number | null;
    units_30d: number;
    revenue_30d_iqd: number;
  }[];
  addons: {
    modifier_id: string;
    group_name_en: string;
    group_name_ar: string;
    name_en: string;
    name_ar: string;
    current_delta_iqd: number | null;
    new_delta_iqd: number | null;
    count_30d: number;
    revenue_30d_iqd: number;
  }[];
  promotion: {
    current_value: number | null;
    new_value: number | null;
    discount_cost_30d_iqd: number;
    units_30d: number;
    revenue_30d_iqd: number;
  } | null;
  rate: {
    durations: { duration_min: number; current_price_iqd: number | null; new_price_iqd: number | null }[];
    bookings_30d: number;
    revenue_30d_iqd: number;
  } | null;
  featured: {
    current_item_id: string | null;
    new_item_id: string | null;
    current_pct: number | null;
    new_pct: number | null;
    current_hero_mode: string | null;
    sizes: TargetSize[];
    units_30d: number;
    discount_cost_30d_iqd: number;
  } | null;
}

export interface TournamentFeasibility {
  ranges: {
    court_id: string;
    court_name_en: string;
    court_name_ar: string;
    from: string;
    to: string;
    bookings: number;
    guests: number;
  }[];
}

export interface HiringCandidate {
  id: string;
  candidate_name: string;
  candidate_phone: string;
  brief: string;
  interview_at: string | null;
  picked: boolean;
  pick_reason: string | null;
}

export interface HiringCandidates {
  candidates: HiringCandidate[];
  purged: boolean;
}

export interface CampaignDraft {
  id: string;
  name_en: string | null;
  name_ar: string | null;
  status: string;
  editable: boolean;
}

export interface MarketingNote {
  id: string;
  author_name: string | null;
  body: string;
  photos: string[] | null;
  created_at: string;
}
