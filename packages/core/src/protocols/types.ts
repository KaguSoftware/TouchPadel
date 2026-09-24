/**
 * Protocol shapes both apps share (docs/design/protocols/build-contracts-2026-09-23.md
 * §2.6-§2.8, §7.2): the vocabularies the engine stores, the record every step
 * submits, and the JSON the engine's reads return. Values match the database
 * spellings exactly, so a screen can look a label up by the stored value.
 *
 * Types only, apart from the value lists the types are derived from. The server's
 * check hooks are the authority on every record; these describe what they accept.
 */
import type { StaffRole } from '../staff/roles';

// ── Vocabularies ────────────────────────────────────────────────────────────

export const PROTOCOL_KINDS = ['product_release', 'tournament', 'hiring', 'price_promo'] as const;
export type ProtocolKind = (typeof PROTOCOL_KINDS)[number];

/** Tournaments only: type 1 (club), type 2 (community, the manager decides), type 3 (sponsor or client). */
export const TOURNAMENT_VARIANTS = ['type1', 'type2', 'type3'] as const;
export type TournamentVariant = (typeof TOURNAMENT_VARIANTS)[number];

export const RUN_STATUSES = ['active', 'scheduled', 'live', 'done', 'stopped', 'withdrawn'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export const STEP_STATUSES = ['waiting', 'open', 'submitted', 'passed', 'skipped', 'stopped'] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

export const DECISIONS = ['approve', 'auto', 'send_back', 'stop'] as const;
export type Decision = (typeof DECISIONS)[number];
/** What a person can press; 'auto' is the engine's own. */
export type DecisionChoice = Exclude<Decision, 'auto'>;

/** The eight kinds of a price or promotion change (the `propose` record's `change`). */
export const PRICE_CHANGE_KINDS = [
  'price',
  'shop_launch',
  'addon_price',
  'promotion',
  'promotion_edit',
  'promotion_enable',
  'rate',
  'featured_discount',
] as const;
export type PriceChangeKind = (typeof PRICE_CHANGE_KINDS)[number];

/** `staff_media_uploads.folder`: where a slot's photo is filed. */
export const PHOTO_FOLDERS = ['proposals', 'tests', 'steps', 'marketing', 'campaigns', 'receipts'] as const;
export type PhotoFolder = (typeof PHOTO_FOLDERS)[number];

/** The built-in step keys of each kind, in their default order (§2.8). */
export const STEP_KEYS = {
  product_release: ['propose', 'test', 'analysis', 'marketing', 'launch'],
  tournament: ['plan', 'feasibility', 'marketing', 'courts', 'ready'],
  hiring: ['open_position', 'interviews', 'add_staff'],
  price_promo: ['propose', 'numbers', 'announce', 'apply'],
} as const satisfies Record<ProtocolKind, readonly string[]>;

export type StepKey<K extends ProtocolKind = ProtocolKind> = (typeof STEP_KEYS)[K][number];

// ── Records (§2.8), one per built-in step ───────────────────────────────────

export type ItemKind = 'drink' | 'dessert' | 'food';
export type RecipeUnit = 'g' | 'ml' | 'pc';

/** Two languages of one short line (a hero label, a ticker line). */
export interface BilingualLine {
  en: string;
  ar: string;
}

export interface ReleaseProposeRecord {
  name_en?: string | null;
  name_ar?: string | null;
  item_kind: ItemKind;
  /** Each line names an ingredient or, when it is not stocked yet, a label. */
  lines: { ingredient_id?: string | null; label?: string | null; qty: number; unit: RecipeUnit }[];
  sizes: { name_en?: string | null; name_ar?: string | null }[];
  audience?: string | null;
  inspiration?: string | null;
  link?: string | null;
  notes?: string | null;
  /** Required when the submitter decides this step (a manager or the owner starting one). */
  category_id?: string | null;
}

export interface ReleaseTestRecord {
  servings: { variant_id: string; count: number }[];
  notes?: string | null;
}

export interface ReleaseAnalysisRecord {
  prices: { variant_id: string; price_iqd: number }[];
  name_en: string;
  name_ar: string;
  notes?: string | null;
}

/** Release `marketing`, tournament `marketing`. */
export interface MarketingRecord {
  highlights_en: string;
  highlights_ar: string;
  hero?: BilingualLine | null;
  ticker?: BilingualLine | null;
  campaign_id?: string | null;
  notes?: string | null;
}

export interface ReleaseLaunchRecord {
  when: 'now' | 'date';
  at?: string | null;
  /** A `tests` or `marketing` photo of this run. */
  photo_path: string;
  /** Written by the protocol-action function after its copy; never typed. */
  menu_photo_path?: string | null;
}

export type TournamentClass = 'A' | 'B' | 'C';
export type TournamentFormat = 'americano' | 'mexicano' | 'knockout' | 'league';

export interface CourtRange {
  court_ids: string[];
  from: string;
  to: string;
}

export interface TournamentPlanRecord {
  class: TournamentClass;
  name_en: string;
  name_ar: string;
  /** Required for type 1 and type 3. */
  format?: TournamentFormat | null;
  ranges: CourtRange[];
  capacity: { unit: 'players' | 'pairs'; count: number };
  entry_fee_iqd?: number | null;
  prize?: { text?: string | null; iqd?: number | null } | null;
  budget_iqd?: number | null;
  expected_entries?: number | null;
  risks?: string | null;
  notes?: string | null;
  /** Required for type 3 (SPONSOR_DETAILS_REQUIRED). */
  sponsor?: {
    name: string;
    contact: string;
    contribution_iqd: number;
    branding?: string | null;
    invoice?: boolean | null;
  } | null;
}

export interface TournamentFeasibilityRecord {
  staffing: string;
  income_iqd: number;
  cost_iqd: number;
  risks: string;
  notes?: string | null;
}

export interface TournamentCourtsRecord {
  /** Event blocks of this run, written by block_courts_for_event. */
  reservation_ids: string[];
  moved_note?: string | null;
}

export interface NotesRecord {
  notes?: string | null;
}

export interface HiringOpenPositionRecord {
  role: StaffRole;
  why: string;
  hours: string;
  start_date: string;
  pay_min_iqd?: number | null;
  pay_max_iqd?: number | null;
}

export interface HiringInterviewsRecord {
  candidate_ids: string[];
  picked_id: string;
}

export interface HiringAddStaffRecord {
  staff_id: string;
}

/** The `upsert_promotion` arguments (0067:259-275) without `p_id` and `p_enabled`. */
export interface PromotionFields {
  name_en: string;
  name_ar: string;
  type: 'percent' | 'amount';
  value: number;
  starts_at?: string | null;
  ends_at?: string | null;
  /** 0 = Sunday .. 6 = Saturday; empty = every day. */
  weekdays: number[];
  hour_from?: string | null;
  hour_to?: string | null;
  scope: { courtIds?: string[] | null; categoryIds?: string[] | null; itemIds?: string[] | null };
  limits?: { total?: number | null; perCustomer?: number | null; minSpendIqd?: number | null } | null;
  auto?: boolean | null;
  public_code?: string | null;
  code_single_use?: boolean | null;
}

/** The `upsert_rate_rule` arguments (0071:153-165). */
export interface RateRuleFields {
  name: string;
  court_id?: string | null;
  days_of_week: number[];
  start_time: string;
  end_time: string;
  /** `{"<duration_min>": price_iqd}`. */
  prices: Record<string, number>;
  priority?: number | null;
  valid_from?: string | null;
  valid_to?: string | null;
  is_active: boolean;
}

interface PriceProposeBase {
  reason: string;
  expected_effect: string;
}

export type PriceProposeRecord = PriceProposeBase &
  (
    | {
        change: 'price';
        menu_item_id: string;
        prices: { variant_id: string; price_iqd: number }[];
        new_sizes?: { name_en?: string | null; name_ar?: string | null; price_iqd: number }[] | null;
      }
    | { change: 'shop_launch'; menu_item_id: string; prices: { variant_id: string; price_iqd: number }[] }
    | { change: 'addon_price'; addons: { modifier_id: string; price_delta_iqd: number }[] }
    | { change: 'promotion'; promotion: PromotionFields }
    | { change: 'promotion_edit'; promotion_id: string; promotion: PromotionFields }
    | { change: 'promotion_enable'; promotion_id: string }
    | { change: 'rate'; rule_id?: string | null; rule: RateRuleFields }
    | { change: 'featured_discount'; menu_item_id: string; discount_pct: number }
  );

export interface PriceNumbersRecord {
  recommendation: 'go' | 'change' | 'drop';
  prices?: { variant_id: string; price_iqd: number }[] | null;
  new_sizes?: { name_en?: string | null; name_ar?: string | null; price_iqd: number }[] | null;
  addons?: { modifier_id: string; price_delta_iqd: number }[] | null;
  rule_prices?: Record<string, number> | null;
  discount_pct?: number | null;
  promotion_value?: number | null;
  note?: string | null;
}

export interface PriceAnnounceRecord {
  campaign_id?: string | null;
  hero?: BilingualLine | null;
  ticker?: BilingualLine | null;
  notes?: string | null;
}

export interface ScheduleRecord {
  when: 'now' | 'date';
  at?: string | null;
}

/** An owner-added step: a note and 0 to 6 photos in `steps`. */
export interface GenericStepRecord {
  note?: string | null;
}

/** Every record, by kind and step key. */
export interface StepRecords {
  product_release: {
    propose: ReleaseProposeRecord;
    test: ReleaseTestRecord;
    analysis: ReleaseAnalysisRecord;
    marketing: MarketingRecord;
    launch: ReleaseLaunchRecord;
  };
  tournament: {
    plan: TournamentPlanRecord;
    feasibility: TournamentFeasibilityRecord;
    marketing: MarketingRecord;
    courts: TournamentCourtsRecord;
    ready: NotesRecord;
  };
  hiring: {
    open_position: HiringOpenPositionRecord;
    interviews: HiringInterviewsRecord;
    add_staff: HiringAddStaffRecord;
  };
  price_promo: {
    propose: PriceProposeRecord;
    numbers: PriceNumbersRecord;
    announce: PriceAnnounceRecord;
    apply: ScheduleRecord;
  };
}

export type StepRecord<K extends ProtocolKind, S extends StepKey<K>> = S extends keyof StepRecords[K]
  ? StepRecords[K][S]
  : never;

/** The decision data an approval may carry (only release `propose` asks for any). */
export interface ReleaseProposeDecisionData {
  category_id: string;
}

// ── What the engine's reads return (§2.7; every key present, nulls allowed) ──

export interface StepBrief {
  id: string;
  position: number;
  step_key: string | null;
  name_en: string;
  name_ar: string;
  status: StepStatus;
  round: number;
}

export interface RunRow {
  id: string;
  kind: ProtocolKind;
  variant: TournamentVariant | null;
  title_en: string | null;
  title_ar: string | null;
  status: RunStatus;
  started_by: string;
  started_by_name: string | null;
  started_at: string;
  finished_at: string | null;
  scheduled_for: string | null;
  live_at: string | null;
  menu_item_id: string | null;
  promotion_id: string | null;
  current_steps: StepBrief[];
  waiting_on_me: boolean;
}

export interface ItemRow {
  id: string;
  position: number;
  text_en: string;
  text_ar: string;
  done_by: string | null;
  done_by_name: string | null;
  done_at: string | null;
}

export interface SubmissionRow {
  id: string;
  round: number;
  submitted_by: string;
  submitted_by_name: string | null;
  submitted_at: string;
  /** Null when the caller may not see this step's record (a `mgmt` step, §2.7). */
  record: Record<string, unknown> | null;
  photos: string[] | null;
  withdrawn_at: string | null;
  superseded_at: string | null;
  decision: Decision | null;
  decided_by: string | null;
  decided_by_name: string | null;
  decided_at: string | null;
  decision_note: string | null;
  send_back_to: string | null;
}

export interface StepRow extends StepBrief {
  actor_roles: StaffRole[];
  assigned_to: string | null;
  assigned_to_name: string | null;
  needs_owner_ok: boolean;
  optional: boolean;
  after_keys: string[];
  opened_at: string | null;
  passed_at: string | null;
  skip_note: string | null;
  skipped_by_name: string | null;
  skipped_at: string | null;
  items: ItemRow[];
  submissions: SubmissionRow[];
}

/** What the caller may do on a run or a step; buttons follow it, never a role check. */
export interface Can {
  submit: boolean;
  withdraw_submission_id: string | null;
  decide_submission_id: string | null;
  send_back_targets: string[];
  skip: boolean;
  tick: boolean;
  edit_items: boolean;
  add_step: boolean;
  stop: boolean;
  withdraw_run: boolean;
  cancel_schedule: boolean;
}

/** `my_protocol_work`: one person's To do, Waiting, Decided and To decide lists. */
export interface MyProtocolWork {
  todo: {
    run_step_id: string;
    run_id: string;
    kind: ProtocolKind;
    variant: TournamentVariant | null;
    title_en: string | null;
    title_ar: string | null;
    step_key: string | null;
    name_en: string;
    name_ar: string;
    opened_at: string | null;
    round: number;
  }[];
  waiting: {
    submission_id: string;
    run_step_id: string;
    run_id: string;
    kind: ProtocolKind;
    title_en: string | null;
    title_ar: string | null;
    name_en: string;
    name_ar: string;
    submitted_at: string;
  }[];
  decided: (MyProtocolWork['waiting'][number] & {
    decision: Decision;
    decision_note: string | null;
    decided_at: string;
    decided_by_name: string | null;
  })[];
  to_decide: {
    submission_id: string;
    run_step_id: string;
    run_id: string;
    kind: ProtocolKind;
    title_en: string | null;
    title_ar: string | null;
    name_en: string;
    name_ar: string;
    submitted_by_name: string | null;
    submitted_at: string;
    needs_owner_ok: boolean;
  }[];
  counts: { todo: number; waiting: number; to_decide: number };
}
