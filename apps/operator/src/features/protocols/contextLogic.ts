/**
 * What each step form reads besides its own step (build-contracts-2026-09-23
 * §2.9-§2.13, §5.4 "its context read"), read defensively, and what a form
 * opens with and sends that the field list alone cannot say:
 *
 *  - release `test`: the draft's recipe per size (app.release_test_context);
 *  - release `analysis`: what each size costs to make (app.release_cost), and
 *    the proposal's names to start from;
 *  - release `launch`: the readiness checks (app.release_readiness);
 *  - tournament `feasibility`: the bookings in the plan's windows
 *    (app.tournament_feasibility); `courts` and `marketing`: the plan the desk
 *    and marketing may see (app.tournament_context);
 *  - price/promo `numbers` and `apply`: cost, margin and the last 30 days'
 *    sales of what the change touches (app.price_promo_numbers, MGMT only).
 */
import type { PriceChangeKind } from '@touch/core/protocols';
import type { Obj } from './formModel';
import { isObj } from './protocolLogic';
import { finalizeRenames, readNumbersRenames, type NumbersRename } from './renames';
import type { AddonRow, SizeRow } from './StepForm';

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const objs = (v: unknown): Obj[] => arr(v).filter(isObj);

export interface TestContext {
  sizes: { variant_id: string; name_en: string; name_ar: string; lines: { name_en: string; name_ar: string; qty: number; unit: string }[] }[];
}

export function readTestContext(raw: unknown): TestContext {
  return {
    sizes: objs(isObj(raw) ? raw.sizes : null)
      .filter((s) => typeof s.variant_id === 'string')
      .map((s) => ({
        variant_id: s.variant_id as string,
        name_en: str(s.name_en) ?? '',
        name_ar: str(s.name_ar) ?? '',
        lines: objs(s.lines).map((l) => ({ name_en: str(l.name_en) ?? '', name_ar: str(l.name_ar) ?? '', qty: num(l.qty) ?? 0, unit: str(l.unit) ?? '' })),
      })),
  };
}

export interface CostContext {
  sizes: { variant_id: string; name_en: string; name_ar: string; cost_iqd: number | null; cost_known: boolean }[];
  unknown_lines: string[];
}

export function readCost(raw: unknown): CostContext {
  const o = isObj(raw) ? raw : {};
  return {
    sizes: objs(o.sizes)
      .filter((s) => typeof s.variant_id === 'string')
      .map((s) => ({
        variant_id: s.variant_id as string,
        name_en: str(s.name_en) ?? '',
        name_ar: str(s.name_ar) ?? '',
        cost_iqd: num(s.cost_iqd),
        cost_known: s.cost_known === true,
      })),
    unknown_lines: arr(o.unknown_lines).filter((x): x is string => typeof x === 'string'),
  };
}

export const READINESS_KEYS = ['names', 'prices', 'photo', 'recipe', 'category'] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];

export interface Readiness {
  ready: boolean;
  checks: { key: ReadinessKey; ok: boolean }[];
  warnings: ('allergens' | 'serve_temp')[];
}

export function readReadiness(raw: unknown): Readiness {
  const o = isObj(raw) ? raw : {};
  return {
    ready: o.ready === true,
    checks: objs(o.checks)
      .filter((c) => (READINESS_KEYS as readonly unknown[]).includes(c.key))
      .map((c) => ({ key: c.key as ReadinessKey, ok: c.ok === true })),
    warnings: objs(o.warnings)
      .map((w) => w.key)
      .filter((k): k is 'allergens' | 'serve_temp' => k === 'allergens' || k === 'serve_temp'),
  };
}

export interface Feasibility {
  ranges: { court_name_en: string; court_name_ar: string; from: string; to: string; bookings: number; guests: number }[];
}

export function readFeasibility(raw: unknown): Feasibility {
  return {
    ranges: objs(isObj(raw) ? raw.ranges : null).map((r) => ({
      court_name_en: str(r.court_name_en) ?? '',
      court_name_ar: str(r.court_name_ar) ?? '',
      from: str(r.from) ?? '',
      to: str(r.to) ?? '',
      bookings: num(r.bookings) ?? 0,
      guests: num(r.guests) ?? 0,
    })),
  };
}

export interface TournamentContext {
  name_en: string;
  name_ar: string;
  class: string | null;
  format: string | null;
  capacity: { unit: string; count: number } | null;
  ranges: { courts: { en: string; ar: string }[]; from: string; to: string }[];
  blocked: number;
}

export function readTournamentContext(raw: unknown): TournamentContext {
  const o = isObj(raw) ? raw : {};
  const cap = isObj(o.capacity) ? o.capacity : null;
  return {
    name_en: str(o.name_en) ?? '',
    name_ar: str(o.name_ar) ?? '',
    class: str(o.class),
    format: str(o.format),
    capacity: cap && typeof cap.unit === 'string' && num(cap.count) !== null ? { unit: cap.unit, count: num(cap.count)! } : null,
    ranges: objs(o.ranges).map((r) => ({
      courts: objs(r.court_names).map((c) => ({ en: str(c.en) ?? '', ar: str(c.ar) ?? '' })),
      from: str(r.from) ?? '',
      to: str(r.to) ?? '',
    })),
    blocked: arr(o.blocked).length,
  };
}

export interface NumbersSize {
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
}

export interface NumbersAddon {
  modifier_id: string;
  group_name_en: string;
  group_name_ar: string;
  name_en: string;
  name_ar: string;
  current_delta_iqd: number | null;
  new_delta_iqd: number | null;
  count_30d: number;
  revenue_30d_iqd: number;
}

export interface PriceNumbers {
  change: PriceChangeKind | null;
  sizes: NumbersSize[];
  addons: NumbersAddon[];
  /** Wave 5 (§2.2, #9): the renames riding on the change; [] for every other change. */
  renames: NumbersRename[];
  promotion: { current_value: number | null; new_value: number | null; discount_cost_30d_iqd: number; units_30d: number; revenue_30d_iqd: number } | null;
  rate: { durations: { duration_min: number; current_price_iqd: number | null; new_price_iqd: number | null }[]; bookings_30d: number; revenue_30d_iqd: number } | null;
  featured: { current_pct: number | null; new_pct: number | null; units_30d: number; discount_cost_30d_iqd: number } | null;
}

export function readNumbers(raw: unknown): PriceNumbers {
  const o = isObj(raw) ? raw : {};
  const p = isObj(o.promotion) ? o.promotion : null;
  const r = isObj(o.rate) ? o.rate : null;
  const f = isObj(o.featured) ? o.featured : null;
  return {
    change: (str(o.change) as PriceChangeKind | null) ?? null,
    sizes: objs(o.sizes).map((s) => ({
      variant_id: str(s.variant_id),
      name_en: str(s.name_en) ?? '',
      name_ar: str(s.name_ar) ?? '',
      current_price_iqd: num(s.current_price_iqd),
      new_price_iqd: num(s.new_price_iqd),
      cost_iqd: num(s.cost_iqd),
      cost_known: s.cost_known === true,
      margin_before_iqd: num(s.margin_before_iqd),
      margin_after_iqd: num(s.margin_after_iqd),
      units_30d: num(s.units_30d) ?? 0,
      revenue_30d_iqd: num(s.revenue_30d_iqd) ?? 0,
    })),
    addons: objs(o.addons)
      .filter((a) => typeof a.modifier_id === 'string')
      .map((a) => ({
        modifier_id: a.modifier_id as string,
        group_name_en: str(a.group_name_en) ?? '',
        group_name_ar: str(a.group_name_ar) ?? '',
        name_en: str(a.name_en) ?? '',
        name_ar: str(a.name_ar) ?? '',
        current_delta_iqd: num(a.current_delta_iqd),
        new_delta_iqd: num(a.new_delta_iqd),
        count_30d: num(a.count_30d) ?? 0,
        revenue_30d_iqd: num(a.revenue_30d_iqd) ?? 0,
      })),
    renames: readNumbersRenames(o.renames),
    promotion: p
      ? {
          current_value: num(p.current_value),
          new_value: num(p.new_value),
          discount_cost_30d_iqd: num(p.discount_cost_30d_iqd) ?? 0,
          units_30d: num(p.units_30d) ?? 0,
          revenue_30d_iqd: num(p.revenue_30d_iqd) ?? 0,
        }
      : null,
    rate: r
      ? {
          durations: objs(r.durations).map((d) => ({ duration_min: num(d.duration_min) ?? 0, current_price_iqd: num(d.current_price_iqd), new_price_iqd: num(d.new_price_iqd) })),
          bookings_30d: num(r.bookings_30d) ?? 0,
          revenue_30d_iqd: num(r.revenue_30d_iqd) ?? 0,
        }
      : null,
    featured: f
      ? { current_pct: num(f.current_pct), new_pct: num(f.new_pct), units_30d: num(f.units_30d) ?? 0, discount_cost_30d_iqd: num(f.discount_cost_30d_iqd) ?? 0 }
      : null,
  };
}

/** The sizes a numbers step prices: the proposal's existing sizes, today's price beside each. */
export function numbersSizes(n: PriceNumbers): SizeRow[] {
  return n.sizes
    .filter((s): s is NumbersSize & { variant_id: string } => s.variant_id !== null)
    .map((s) => ({ variant_id: s.variant_id, name_en: s.name_en, name_ar: s.name_ar, current: s.current_price_iqd }));
}

export function numbersAddons(n: PriceNumbers): AddonRow[] {
  return n.addons.map((a) => ({
    modifier_id: a.modifier_id,
    name_en: a.name_en,
    name_ar: a.name_ar,
    group_en: a.group_name_en,
    group_ar: a.group_name_ar,
    current: a.current_delta_iqd,
  }));
}

// ── Prefills ────────────────────────────────────────────────────────────────

/**
 * The price step of a release opens with the proposal's names (a missing
 * language copied from the other, as the draft was made) and one blank price
 * per size of the draft.
 */
export function analysisPrefill(proposal: Obj | null, sizes: readonly { variant_id: string }[]): Obj {
  const en = str(proposal?.name_en) ?? '';
  const ar = str(proposal?.name_ar) ?? '';
  return {
    name_en: en || ar,
    name_ar: ar || en,
    prices: sizes.map((s) => ({ variant_id: s.variant_id, price_iqd: null })),
  };
}

/** The numbers step opens with the proposal's own figures, which "go" sends unchanged (the server's default). */
export function numbersPrefill(proposal: Obj | null): Obj {
  if (!proposal) return { recommendation: 'go' };
  const out: Obj = { recommendation: 'go' };
  if (Array.isArray(proposal.prices)) out.prices = proposal.prices;
  if (Array.isArray(proposal.new_sizes)) out.new_sizes = proposal.new_sizes;
  if (Array.isArray(proposal.addons)) out.addons = proposal.addons;
  if (isObj(proposal.rule) && isObj(proposal.rule.prices)) out.rule_prices = proposal.rule.prices;
  if (typeof proposal.discount_pct === 'number') out.discount_pct = proposal.discount_pct;
  if (isObj(proposal.promotion) && typeof proposal.promotion.value === 'number') out.promotion_value = proposal.promotion.value;
  return out;
}

/**
 * The hiring `interviews` record (§2.8): every candidate of the run and the one
 * picked, by id only. The names stay in the candidates list, which is deleted
 * 90 days after the decision; the step keeps none. `state` says what is still
 * missing before it can be sent.
 */
export function interviewsRecord(candidates: readonly { id: string; picked: boolean }[]): {
  record: Obj;
  state: 'none' | 'noPick' | 'ready';
} {
  const picked = candidates.find((c) => c.picked) ?? null;
  return {
    record: { candidate_ids: candidates.map((c) => c.id), picked_id: picked?.id ?? null },
    state: candidates.length === 0 ? 'none' : picked ? 'ready' : 'noPick',
  };
}

const NUMBERS_FIGURES = ['prices', 'new_sizes', 'addons', 'rule_prices', 'discount_pct', 'promotion_value'] as const;

/**
 * The last touches before a record is sent:
 *  - a price change sends only the sizes whose price changed;
 *  - a price or add-on price change sends its renames trimmed, and none when
 *    nothing is renamed (renames.ts);
 *  - the numbers step sends its figures only with the recommendation to
 *    change them (otherwise the proposal's stand).
 */
export function finalizeRecord(
  kind: string,
  stepKey: string | null,
  record: Obj,
  current: ReadonlyMap<string, number | null>,
): Obj {
  if (kind === 'price_promo' && stepKey === 'propose' && record.change === 'price' && Array.isArray(record.prices)) {
    return finalizeRenames({
      ...record,
      prices: (record.prices as Obj[]).filter((p) => !(typeof p.variant_id === 'string' && current.get(p.variant_id) === p.price_iqd)),
    });
  }
  if (kind === 'price_promo' && stepKey === 'propose' && (record.change === 'price' || record.change === 'addon_price')) {
    return finalizeRenames(record);
  }
  if (kind === 'price_promo' && stepKey === 'numbers' && record.recommendation !== 'change') {
    const out = { ...record };
    for (const k of NUMBERS_FIGURES) delete out[k];
    return out;
  }
  return record;
}
