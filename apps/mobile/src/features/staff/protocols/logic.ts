/**
 * The rules behind the phone's protocol pages (build-contracts-2026-09-23 §6.1,
 * §2.7-§2.13): who may open which page, what a step page offers, what a
 * price or promotion change's form starts from, and the court desk's windows.
 * The server is the wall on every one of them; these only keep a page from
 * offering what the server would refuse.
 *
 * PURE (vitest): no react-native, no supabase.
 */
import {
  PROMOTION_FIELDS,
  RATE_RULE_FIELDS,
  STAFF_ROLES,
  stepForm,
  startableKinds,
  type PriceChangeKind,
  type ProtocolKind,
  type RunRow,
  type StaffRole,
  type StepRow,
  type SubmissionRow,
  type TournamentVariant,
} from '@touch/core';
import type { Locale } from '@touch/i18n';
import { draftFromRecord, emptyDraft, type Draft } from './assemble';
import type { PriceNumbers, PriceTargets, TargetAddon, TargetItem, TargetPromotion, TargetRule } from './types';

// ── Roles ───────────────────────────────────────────────────────────────────

export const MGMT_ROLES: readonly StaffRole[] = ['manager', 'owner'];

export function isMgmt(role: StaffRole | null | undefined): boolean {
  return !!role && MGMT_ROLES.includes(role);
}

/** Every role that may start at least one kind (§2.7): the start page's gate. */
export const START_ROLES: readonly StaffRole[] = STAFF_ROLES.filter((r) => startableKinds(r).length > 0);

/** A barista's or chef assistant's ideas go to their head (#65). */
export const IDEA_AUTHOR_ROLES: readonly StaffRole[] = ['barista', 'chef'];
/** Heads review their own team's ideas; management reviews both teams'. */
export const IDEA_REVIEW_ROLES: readonly StaffRole[] = ['head_barista', 'head_chef', 'manager', 'owner'];
export const IDEA_ROLES: readonly StaffRole[] = [...IDEA_AUTHOR_ROLES, ...IDEA_REVIEW_ROLES];

// ── Bilingual rows ──────────────────────────────────────────────────────────

function filled(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

/** A row's name in the reader's language, else the other one (§4 "Bilingual data"). */
export function bilingual(locale: Locale, en: string | null | undefined, ar: string | null | undefined): string | null {
  return locale === 'ar' ? (filled(ar) ?? filled(en)) : (filled(en) ?? filled(ar));
}

/** A run's title: staff may type one language (Q10), so either is shown in both locales. */
export function runTitle(run: Pick<RunRow, 'title_en' | 'title_ar'>, locale: Locale): string | null {
  return bilingual(locale, run.title_en, run.title_ar);
}

// ── Runs ────────────────────────────────────────────────────────────────────

export const RUN_FILTERS = ['waiting', 'active', 'finished', 'mine'] as const;
export type RunFilter = (typeof RUN_FILTERS)[number];

export function parseRunFilter(value: string | undefined | null): RunFilter {
  return (RUN_FILTERS as readonly string[]).includes(value ?? '') ? (value as RunFilter) : 'waiting';
}

// ── Submissions ─────────────────────────────────────────────────────────────

/** Newest first, as a history reads. */
export function submissionsNewestFirst(step: Pick<StepRow, 'submissions'>): SubmissionRow[] {
  return [...step.submissions].sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at));
}

/**
 * What a reopened step's form starts from: the newest submission whose record
 * the caller may read. After a send-back the sender changes what they sent
 * rather than typing it again; its photos come back too (§2.3's re-claim).
 */
export function resubmissionSource(step: Pick<StepRow, 'submissions'>): SubmissionRow | null {
  return submissionsNewestFirst(step).find((s) => s.record !== null) ?? null;
}

/**
 * The intent a step's send is keyed under (§6.4): the step, its round and how
 * many submissions it already holds. A retry before anything lands reuses the
 * key. A withdraw keeps its submission in the list (withdrawn), so the next
 * send is a new intent even when the first one's answer never arrived, and
 * never replays the withdrawn send as "sent".
 */
export function submitIntent(step: Pick<StepRow, 'id' | 'round' | 'submissions'>): string {
  return `submit:${step.id}:${step.round}:${step.submissions.length}`;
}

/** The send-back targets of a decision, in run order, named from the run's steps. */
export function sendBackTargets(
  targetIds: readonly string[],
  steps: readonly Pick<StepRow, 'id' | 'name_en' | 'name_ar' | 'position'>[],
  locale: Locale,
): { id: string; name: string; position: number }[] {
  return targetIds
    .map((id) => steps.find((s) => s.id === id))
    .filter((s): s is Pick<StepRow, 'id' | 'name_en' | 'name_ar' | 'position'> => !!s)
    .sort((a, b) => a.position - b.position)
    .map((s) => ({ id: s.id, name: bilingual(locale, s.name_en, s.name_ar) ?? '', position: s.position }));
}

/**
 * The photos a launch may show on the menu (§2.8 release `launch`): the test
 * and marketing photos of the run's standing submissions, newest first, each
 * once. The launch check on the server decides which are really this run's.
 */
export function launchPhotoChoices(steps: readonly Pick<StepRow, 'step_key' | 'submissions'>[]): string[] {
  const out: string[] = [];
  const subs = steps
    .filter((s) => s.step_key === 'test' || s.step_key === 'marketing')
    .flatMap((s) => s.submissions)
    .filter((sub) => sub.withdrawn_at === null && sub.superseded_at === null && sub.decision !== 'send_back')
    .sort((a, b) => Date.parse(b.submitted_at) - Date.parse(a.submitted_at));
  for (const sub of subs) for (const p of sub.photos ?? []) if (!out.includes(p)) out.push(p);
  return out;
}

/** The role a hiring run's position named, from its `open_position` record (management reads it). */
export function positionRole(steps: readonly Pick<StepRow, 'step_key' | 'submissions'>[]): StaffRole | null {
  const step = steps.find((s) => s.step_key === 'open_position');
  const source = step ? resubmissionSource(step) : null;
  const role = source?.record?.role;
  return typeof role === 'string' && (STAFF_ROLES as readonly string[]).includes(role) ? (role as StaffRole) : null;
}

/** The change kind a price or promotion run carries, from its `propose` record. */
export function runChange(steps: readonly Pick<StepRow, 'step_key' | 'submissions'>[]): PriceChangeKind | null {
  const step = steps.find((s) => s.step_key === 'propose');
  const change = step ? resubmissionSource(step)?.record?.change : null;
  return typeof change === 'string' ? (change as PriceChangeKind) : null;
}

/** The standing `propose` record of a price or promotion run, for the targets a later step shows. */
export function proposeRecord(steps: readonly Pick<StepRow, 'step_key' | 'submissions'>[]): Record<string, unknown> | null {
  const step = steps.find((s) => s.step_key === 'propose');
  return step ? (resubmissionSource(step)?.record ?? null) : null;
}

// ── Starting ────────────────────────────────────────────────────────────────

/**
 * Whether a starter decides the first step, so it passes at once (§2.7): the
 * owner and the managers on every first step whose OK is off. Only release
 * `propose` asks the decider for anything (the menu category).
 */
export function startDecidedByStarter(kind: ProtocolKind, role: StaffRole | null | undefined): boolean {
  if (kind === 'hiring') return role === 'owner';
  return isMgmt(role);
}

/**
 * The run's title when the starter typed none: a new item's or a
 * tournament's own names, which already say what it is.
 */
export function titlesFromRecord(kind: ProtocolKind, record: Record<string, unknown>): { en: string | null; ar: string | null } {
  if (kind !== 'product_release' && kind !== 'tournament') return { en: null, ar: null };
  const en = typeof record.name_en === 'string' ? filled(record.name_en) : null;
  const ar = typeof record.name_ar === 'string' ? filled(record.name_ar) : null;
  return { en, ar };
}

/** A tournament's variant from a route param, or null. */
export function parseVariant(value: string | undefined | null): TournamentVariant | null {
  return value === 'type1' || value === 'type2' || value === 'type3' ? value : null;
}

// ── Price or promotion change: targets and prefills ─────────────────────────

/** What a change kind is aimed at, so the start page knows which list to offer. */
export type TargetKind = 'item' | 'promotion' | 'rule' | 'featured' | 'addons' | 'none';

export function targetKindOf(change: PriceChangeKind): TargetKind {
  switch (change) {
    case 'price':
    case 'shop_launch':
      return 'item';
    case 'featured_discount':
      return 'featured';
    case 'promotion_edit':
    case 'promotion_enable':
      return 'promotion';
    case 'rate':
      return 'rule';
    case 'addon_price':
      return 'addons';
    case 'promotion':
      return 'none';
  }
}

/** The fields of a propose record the start page picks itself, never typed. */
export const PROPOSE_PICKED_FIELDS = ['change', 'menu_item_id', 'promotion_id', 'rule_id'] as const;

/** A fixed row of a form: which size or add-on it prices, and what it costs now. */
export interface FixedRow {
  id: string;
  name_en: string;
  name_ar: string;
  /** The group of an add-on. */
  group_en?: string;
  group_ar?: string;
  current: number | null;
}

export interface PriceProposeStart {
  draft: Draft;
  /** List template path → the member naming each row and its rows. */
  fixed: Record<string, { key: string; rows: FixedRow[] }>;
  /** Template paths the form hides. */
  hidden: string[];
}

// Wave 5 (wave5-addendum-2026-09-25 §2.2, #9): a rename row names its size or
// option by its fixed row, never a picker.
const PRICE_PROPOSE_HIDDEN = [
  ...PROPOSE_PICKED_FIELDS,
  'prices.variant_id',
  'addons.modifier_id',
  'renames.variant_id',
  'renames.modifier_id',
];

function sizeRows(item: TargetItem): FixedRow[] {
  return item.sizes.map((s) => ({ id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar, current: s.price_iqd }));
}

/** A rename row is headed by the name it has today; no price beside it (the prices are above). */
function sizeRenameRows(item: TargetItem): FixedRow[] {
  return item.sizes.map((s) => ({ id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar, current: null }));
}

/** Only an option on sale is renamed through a price change (0195); one never on sale is the manager's to rename. */
function addonRenameRows(addons: readonly TargetAddon[]): FixedRow[] {
  return addons
    .filter((a) => a.launched)
    .map((a) => ({
      id: a.modifier_id,
      name_en: a.name_en,
      name_ar: a.name_ar,
      group_en: a.group_name_en,
      group_ar: a.group_name_ar,
      current: null,
    }));
}

/** The blank rename rows for the fixed rows, with what a sent-back record already renamed typed in. */
function renameDraft(key: 'variant_id' | 'modifier_id', rows: readonly FixedRow[], record?: Record<string, unknown>): Draft[] {
  const sent = new Map(
    (Array.isArray(record?.renames) ? record.renames : []).map((r) => {
      const row = r as Record<string, unknown>;
      return [row[key], row] as const;
    }),
  );
  return rows.map((r) => {
    const typed = sent.get(r.id);
    return {
      [key]: r.id,
      name_en: typeof typed?.name_en === 'string' ? typed.name_en : '',
      name_ar: typeof typed?.name_ar === 'string' ? typed.name_ar : '',
    };
  });
}

/**
 * The rename rows as they are sent (wave5-addendum-2026-09-25 §2.2, #9). The
 * phone asks only for what changes: a language left empty keeps today's name,
 * a row left empty or typed back to today's names renames nothing and is
 * blanked (so `recordFromDraft` drops it with the other untouched fixed
 * rows). Names are compared as the server compares them: whitespace aside, a
 * case change is a rename.
 */
export function completeRenames(draft: Draft, fixed: { key: string; rows: readonly FixedRow[] } | undefined): Draft {
  if (!fixed || !Array.isArray(draft.renames)) return draft;
  const text = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const renames = (draft.renames as Draft[]).map((row) => {
    const now = fixed.rows.find((r) => r.id === row[fixed.key]);
    const typedEn = text(row.name_en);
    const typedAr = text(row.name_ar);
    if (!now || (typedEn === '' && typedAr === '')) return { ...row, name_en: '', name_ar: '' };
    const en = typedEn || now.name_en.trim();
    const ar = typedAr || now.name_ar.trim();
    if (en === now.name_en.trim() && ar === now.name_ar.trim()) return { ...row, name_en: '', name_ar: '' };
    return { ...row, name_en: en, name_ar: ar };
  });
  return { ...draft, renames };
}

/** One rename the numbers and apply steps show: "Small (4,000 IQD) → Large" (app.price_promo_numbers, 0195). */
export interface NumbersRename {
  target: 'size' | 'addon';
  id: string;
  from_en: string;
  from_ar: string;
  to_en: string;
  to_ar: string;
  /** What it sells at once applied: this change's figure, else today's price. */
  price_iqd: number | null;
}

/** `price_promo_numbers.renames`, read defensively: an older server's numbers carry none. */
export function numbersRenames(numbers: unknown): NumbersRename[] {
  const raw = numbers !== null && typeof numbers === 'object' ? (numbers as { renames?: unknown }).renames : undefined;
  if (!Array.isArray(raw)) return [];
  const out: NumbersRename[] = [];
  for (const r of raw) {
    if (r === null || typeof r !== 'object') continue;
    const o = r as Record<string, unknown>;
    if (typeof o.id !== 'string') continue;
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    out.push({
      target: o.target === 'addon' ? 'addon' : 'size',
      id: o.id,
      from_en: str(o.from_en),
      from_ar: str(o.from_ar),
      to_en: str(o.to_en),
      to_ar: str(o.to_ar),
      price_iqd: typeof o.price_iqd === 'number' && Number.isFinite(o.price_iqd) ? o.price_iqd : null,
    });
  }
  return out;
}

function promotionDraft(p: TargetPromotion | null): Draft {
  if (!p) return { ...emptyDraft(PROMOTION_FIELDS), type: 'percent' };
  return draftFromRecord(PROMOTION_FIELDS, {
    name_en: p.name_en,
    name_ar: p.name_ar,
    type: p.type,
    value: p.value,
    starts_at: p.starts_at,
    ends_at: p.ends_at,
    weekdays: p.weekdays ?? [],
    hour_from: p.hour_from,
    hour_to: p.hour_to,
    scope: p.scope ?? {},
    limits: p.limits,
    auto: p.auto,
    public_code: p.public_code,
    code_single_use: p.code_single_use,
  });
}

function ruleDraft(r: TargetRule | null): Draft {
  if (!r) return { ...emptyDraft(RATE_RULE_FIELDS), is_active: true, prices: [{ minutes: '60', price: '' }] };
  return draftFromRecord(RATE_RULE_FIELDS, {
    name: r.name,
    court_id: r.court_id,
    days_of_week: r.days_of_week,
    start_time: r.start_time,
    end_time: r.end_time,
    prices: r.prices,
    priority: r.priority,
    valid_from: r.valid_from,
    valid_to: r.valid_to,
    is_active: r.is_active,
  });
}

/**
 * A price or promotion change's first form, from its kind and the target the
 * starter picked (`targetId`; for a court rate, null is a new rate; for the
 * featured discount, null keeps the featured item). New prices start blank,
 * with today's price beside each size, so only what should change is typed.
 */
export function priceProposeStart(
  change: PriceChangeKind,
  targets: PriceTargets | null | undefined,
  targetId: string | null,
): PriceProposeStart {
  const fields = stepForm('price_promo', 'propose', { change })?.fields ?? [];
  const draft: Draft = { ...emptyDraft(fields), change };
  const fixed: PriceProposeStart['fixed'] = {};
  const hidden = [...PRICE_PROPOSE_HIDDEN];
  const items = targets?.items ?? [];
  switch (change) {
    case 'price':
    case 'shop_launch': {
      const item = items.find((i) => i.menu_item_id === targetId);
      draft.menu_item_id = targetId ?? '';
      if (item) {
        draft.prices = item.sizes.map((s) => ({ variant_id: s.variant_id, price_iqd: '' }));
        fixed.prices = { key: 'variant_id', rows: sizeRows(item) };
        // A new size is a cafe item's only: a shop size carries its own stock row (§2.8).
        if (change === 'shop_launch' || item.category_kind === 'shop') hidden.push('new_sizes');
        // Its sizes may be renamed with it (wave 5 §2.2, #9); a shop size's stock row follows.
        if (change === 'price') {
          fixed.renames = { key: 'variant_id', rows: sizeRenameRows(item) };
          draft.renames = renameDraft('variant_id', fixed.renames.rows);
        }
      }
      break;
    }
    case 'featured_discount': {
      const itemId = targetId ?? (typeof targets?.featured_item_id === 'string' ? targets.featured_item_id : '');
      draft.menu_item_id = itemId;
      const pct = targets?.featured_discount_pct;
      draft.discount_pct = typeof pct === 'number' ? String(pct) : '';
      break;
    }
    case 'addon_price': {
      const addons: TargetAddon[] = targets?.addons ?? [];
      draft.addons = addons.map((a) => ({ modifier_id: a.modifier_id, price_delta_iqd: '' }));
      fixed.addons = {
        key: 'modifier_id',
        rows: addons.map((a) => ({
          id: a.modifier_id,
          name_en: a.name_en,
          name_ar: a.name_ar,
          group_en: a.group_name_en,
          group_ar: a.group_name_ar,
          current: a.price_delta_iqd,
        })),
      };
      fixed.renames = { key: 'modifier_id', rows: addonRenameRows(addons) };
      draft.renames = renameDraft('modifier_id', fixed.renames.rows);
      break;
    }
    case 'promotion':
      draft.promotion = promotionDraft(null);
      break;
    case 'promotion_edit': {
      draft.promotion_id = targetId ?? '';
      draft.promotion = promotionDraft((targets?.promotions ?? []).find((p) => p.promotion_id === targetId) ?? null);
      break;
    }
    case 'promotion_enable':
      draft.promotion_id = targetId ?? '';
      break;
    case 'rate': {
      draft.rule_id = targetId ?? '';
      draft.rule = ruleDraft((targets?.rules ?? []).find((r) => r.rule_id === targetId) ?? null);
      break;
    }
  }
  return { draft, fixed, hidden };
}

/**
 * The fixed rows of a resubmitted proposal: its own sizes or add-ons, from the
 * targets list (the run keeps its target, §2.8), so the send-back's form reads
 * like the first one.
 */
export function priceProposeResubmit(
  record: Record<string, unknown>,
  targets: PriceTargets | null | undefined,
): Pick<PriceProposeStart, 'fixed' | 'hidden'> & { change: PriceChangeKind | null; draft: Draft } {
  const change = typeof record.change === 'string' ? (record.change as PriceChangeKind) : null;
  const fields = change ? (stepForm('price_promo', 'propose', { change })?.fields ?? []) : [];
  const draft = draftFromRecord(fields, record);
  const fixed: PriceProposeStart['fixed'] = {};
  const hidden = [...PRICE_PROPOSE_HIDDEN];
  if (change === 'price' || change === 'shop_launch') {
    const item = (targets?.items ?? []).find((i) => i.menu_item_id === record.menu_item_id);
    if (item) {
      const sent = new Map(
        (Array.isArray(record.prices) ? record.prices : []).map((p) => {
          const row = p as { variant_id?: string; price_iqd?: number };
          return [row.variant_id, row.price_iqd] as const;
        }),
      );
      draft.prices = item.sizes.map((s) => ({
        variant_id: s.variant_id,
        price_iqd: sent.has(s.variant_id) ? String(sent.get(s.variant_id)) : '',
      }));
      fixed.prices = { key: 'variant_id', rows: sizeRows(item) };
      if (change === 'shop_launch' || item.category_kind === 'shop') hidden.push('new_sizes');
      if (change === 'price') {
        fixed.renames = { key: 'variant_id', rows: sizeRenameRows(item) };
        draft.renames = renameDraft('variant_id', fixed.renames.rows, record);
      }
    }
  }
  if (change === 'addon_price') {
    const addons = targets?.addons ?? [];
    const sent = new Map(
      (Array.isArray(record.addons) ? record.addons : []).map((a) => {
        const row = a as { modifier_id?: string; price_delta_iqd?: number };
        return [row.modifier_id, row.price_delta_iqd] as const;
      }),
    );
    draft.addons = addons.map((a) => ({
      modifier_id: a.modifier_id,
      price_delta_iqd: sent.has(a.modifier_id) ? String(sent.get(a.modifier_id)) : '',
    }));
    fixed.addons = {
      key: 'modifier_id',
      rows: addons.map((a) => ({
        id: a.modifier_id,
        name_en: a.name_en,
        name_ar: a.name_ar,
        group_en: a.group_name_en,
        group_ar: a.group_name_ar,
        current: a.price_delta_iqd,
      })),
    };
    fixed.renames = { key: 'modifier_id', rows: addonRenameRows(addons) };
    draft.renames = renameDraft('modifier_id', fixed.renames.rows, record);
  }
  return { change, draft, fixed, hidden };
}

/**
 * The manager's `numbers` form, prefilled with the standing figures
 * (`price_promo_numbers`: the proposal's, or the last numbers sent), so a
 * "go" with no change is one tap.
 */
export function priceNumbersStart(change: PriceChangeKind, numbers: PriceNumbers | null | undefined): PriceProposeStart {
  const fields = stepForm('price_promo', 'numbers', { change })?.fields ?? [];
  const draft: Draft = { ...emptyDraft(fields), recommendation: 'go' };
  const fixed: PriceProposeStart['fixed'] = {};
  const hidden = ['prices.variant_id', 'addons.modifier_id'];
  if (!numbers) return { draft, fixed, hidden };
  const text = (n: number | null | undefined) => (typeof n === 'number' ? String(n) : '');
  if (change === 'price' || change === 'shop_launch') {
    const standing = numbers.sizes.filter((s) => s.variant_id !== null);
    draft.prices = standing.map((s) => ({ variant_id: s.variant_id as string, price_iqd: text(s.new_price_iqd) }));
    fixed.prices = {
      key: 'variant_id',
      rows: standing.map((s) => ({ id: s.variant_id as string, name_en: s.name_en, name_ar: s.name_ar, current: s.current_price_iqd })),
    };
    if (change === 'price') {
      draft.new_sizes = numbers.sizes
        .filter((s) => s.variant_id === null)
        .map((s) => ({ name_en: s.name_en ?? '', name_ar: s.name_ar ?? '', price_iqd: text(s.new_price_iqd) }));
    }
  }
  if (change === 'addon_price') {
    draft.addons = numbers.addons.map((a) => ({ modifier_id: a.modifier_id, price_delta_iqd: text(a.new_delta_iqd) }));
    fixed.addons = {
      key: 'modifier_id',
      rows: numbers.addons.map((a) => ({
        id: a.modifier_id,
        name_en: a.name_en,
        name_ar: a.name_ar,
        group_en: a.group_name_en,
        group_ar: a.group_name_ar,
        current: a.current_delta_iqd,
      })),
    };
  }
  if ((change === 'promotion' || change === 'promotion_edit') && numbers.promotion) {
    draft.promotion_value = text(numbers.promotion.new_value);
  }
  if (change === 'rate' && numbers.rate) {
    draft.rule_prices = numbers.rate.durations.map((d) => ({ minutes: String(d.duration_min), price: text(d.new_price_iqd) }));
  }
  if (change === 'featured_discount' && numbers.featured) {
    draft.discount_pct = text(numbers.featured.new_pct);
  }
  return { draft, fixed, hidden };
}

// ── The court desk's windows (tournament `courts`, §2.11) ───────────────────

type Raw = Record<string, unknown>;

function obj(v: unknown): Raw {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Raw) : {};
}
function list(v: unknown): Raw[] {
  return Array.isArray(v) ? v.map(obj) : [];
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v !== '' ? v : null;
}

export interface EventBlock {
  reservationId: string;
  courtId: string;
  startAt: string;
  endAt: string;
}

export interface TournamentContext {
  name: { en: string; ar: string };
  tournamentClass: string | null;
  format: string | null;
  capacity: { unit: 'players' | 'pairs'; count: number } | null;
  ranges: { courtIds: string[]; courtNames: { en: string; ar: string }[]; from: string; to: string }[];
  blocked: EventBlock[];
}

function readBlock(r: Raw): EventBlock | null {
  const reservationId = str(r.reservation_id);
  const courtId = str(r.court_id);
  const startAt = str(r.start_at);
  const endAt = str(r.end_at);
  return reservationId && courtId && startAt && endAt ? { reservationId, courtId, startAt, endAt } : null;
}

/** `app.tournament_context`, read defensively: a field it lacks is empty, never invented. */
export function readTournamentContext(payload: unknown): TournamentContext {
  const p = obj(payload);
  const cap = obj(p.capacity);
  const unit = cap.unit === 'players' || cap.unit === 'pairs' ? cap.unit : null;
  const count = typeof cap.count === 'number' ? cap.count : null;
  return {
    name: { en: str(p.name_en) ?? '', ar: str(p.name_ar) ?? '' },
    tournamentClass: str(p.class),
    format: str(p.format),
    capacity: unit && count !== null ? { unit, count } : null,
    ranges: list(p.ranges)
      .map((r) => ({
        courtIds: Array.isArray(r.court_ids) ? r.court_ids.filter((x): x is string => typeof x === 'string') : [],
        courtNames: list(r.court_names).map((n) => ({ en: str(n.en) ?? '', ar: str(n.ar) ?? '' })),
        from: str(r.from) ?? '',
        to: str(r.to) ?? '',
      }))
      .filter((r) => r.courtIds.length > 0 && r.from !== '' && r.to !== ''),
    blocked: list(p.blocked)
      .map(readBlock)
      .filter((b): b is EventBlock => b !== null),
  };
}

export interface PlannedWindow {
  key: string;
  courtId: string;
  courtName: { en: string; ar: string };
  from: string;
  to: string;
  /** The run's live block of exactly this court and window; null while it is still to block. */
  reservationId: string | null;
}

function sameInstant(a: string, b: string): boolean {
  const x = Date.parse(a);
  const y = Date.parse(b);
  return Number.isFinite(x) && x === y;
}

/** Every (range, court) window of the plan, each once, matched to the run's block of it. */
export function plannedWindows(ctx: TournamentContext): PlannedWindow[] {
  const out: PlannedWindow[] = [];
  const seen = new Set<string>();
  for (const range of ctx.ranges) {
    range.courtIds.forEach((courtId, i) => {
      const key = `${courtId}|${Date.parse(range.from)}|${Date.parse(range.to)}`;
      if (seen.has(key)) return;
      seen.add(key);
      const block = ctx.blocked.find(
        (b) => b.courtId === courtId && sameInstant(b.startAt, range.from) && sameInstant(b.endAt, range.to),
      );
      out.push({
        key,
        courtId,
        courtName: range.courtNames[i] ?? { en: '', ar: '' },
        from: range.from,
        to: range.to,
        reservationId: block?.reservationId ?? null,
      });
    });
  }
  return out;
}

/** `p_blocks` for the windows still to block. */
export function blocksToSend(windows: readonly PlannedWindow[]): { court_id: string; start_at: string; end_at: string }[] {
  return windows
    .filter((w) => w.reservationId === null)
    .map((w) => ({ court_id: w.courtId, start_at: w.from, end_at: w.to }));
}

export interface BlockConflict {
  reservationId: string;
  courtId: string;
  startAt: string;
  endAt: string;
  kind: string;
}

/** `app.block_courts_for_event`: what was blocked, or what is in the way. */
export function readBlockAnswer(payload: unknown): { blocked: EventBlock[]; conflicts: BlockConflict[] } {
  const p = obj(payload);
  return {
    blocked: list(p.blocked)
      .map(readBlock)
      .filter((b): b is EventBlock => b !== null),
    conflicts: list(p.conflicts)
      .map((c) => ({
        reservationId: str(c.reservation_id) ?? '',
        courtId: str(c.court_id) ?? '',
        startAt: str(c.start_at) ?? '',
        endAt: str(c.end_at) ?? '',
        kind: str(c.kind) ?? '',
      }))
      .filter((c) => c.reservationId !== ''),
  };
}

/**
 * The courts step's record: the run's blocks of the plan's windows, and the
 * optional note. A live block of no planned window is not sent: the server
 * counts only the passed plan's (§2.11).
 */
export function courtsRecord(ctx: TournamentContext, movedNote: string): { reservation_ids: string[]; moved_note?: string } {
  const note = movedNote.trim();
  return {
    reservation_ids: plannedWindows(ctx).flatMap((w) => (w.reservationId ? [w.reservationId] : [])),
    ...(note ? { moved_note: note } : {}),
  };
}

// ── Hiring ──────────────────────────────────────────────────────────────────

/** The interviews record: every candidate of the run, and the one picked. */
export function interviewsRecord(candidates: readonly { id: string; picked: boolean }[]): {
  candidate_ids: string[];
  picked_id: string | null;
} {
  return {
    candidate_ids: candidates.map((c) => c.id),
    picked_id: candidates.find((c) => c.picked)?.id ?? null,
  };
}

// ── Queries ─────────────────────────────────────────────────────────────────

/** The `staffKeys` families a protocol write can change: refreshed together after one. */
const PROTOCOL_FAMILIES = new Set([
  'work',
  'runs',
  'run',
  'step',
  'context',
  'candidates',
  'review',
  'ideas',
  'ideasToReview',
  'notes',
  'itemNotes',
]);

export function isProtocolQueryKey(key: readonly unknown[]): boolean {
  return key[0] === 'staff' && typeof key[1] === 'string' && PROTOCOL_FAMILIES.has(key[1]);
}
