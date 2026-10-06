/**
 * The tournament start's plan, as the section-menu sheet edits it
 * (TournamentStartSheet, 2026-10-05 redesign "C + D"). PURE.
 *
 * The sheet keeps plain strings and the court-hour cells picked on its
 * timeline; this module turns them into the `tournament.plan` record the
 * server validates (`TOURNAMENT_PLAN_SHORT` / `_FULL` in
 * @touch/core/protocols): `ranges` from the picked cells, `capacity`, and the
 * full plan's money, risks and sponsor. A field left empty is left out, as
 * the generic forms do (tasks/formModel.ts `toRecord`).
 */
import { wallTimeToUtc } from '@touch/core';
import type { FieldIssue, TournamentVariant } from '@touch/core/protocols';

export type PlanSection = 'type' | 'name' | 'courts' | 'players' | 'notes' | 'sponsor';
export const PLAN_SECTIONS: readonly PlanSection[] = [
  'type',
  'name',
  'courts',
  'players',
  'notes',
  'sponsor',
];

export type PlanClass = 'A' | 'B' | 'C';
export type PlanFormat = 'americano' | 'mexicano' | 'knockout' | 'league';
export type PlanUnit = 'players' | 'pairs';

export interface PlanSponsor {
  name: string;
  contact: string;
  contribution: string;
  branding: string;
  invoice: boolean;
}

export interface PlanState {
  variant: TournamentVariant;
  cls: PlanClass | null;
  nameEn: string;
  nameAr: string;
  format: PlanFormat | null;
  /** Picked timeline cells, `cellKey(date, courtId, startMin)`. */
  picks: readonly string[];
  unit: PlanUnit;
  count: string;
  expected: string;
  fee: string;
  prizeText: string;
  prizeIqd: string;
  budget: string;
  risks: string;
  notes: string;
  sponsor: PlanSponsor;
}

export function emptyPlan(variant: TournamentVariant = 'type1'): PlanState {
  return {
    variant,
    cls: null,
    nameEn: '',
    nameAr: '',
    format: null,
    picks: [],
    unit: 'players',
    count: '',
    expected: '',
    fee: '',
    prizeText: '',
    prizeIqd: '',
    budget: '',
    risks: '',
    notes: '',
    sponsor: { name: '', contact: '', contribution: '', branding: '', invoice: false },
  };
}

/** Type 2 is the short plan: no format, money, risks or sponsor. */
export function isFullPlan(variant: TournamentVariant): boolean {
  return variant !== 'type2';
}

// ── Timeline cells ──────────────────────────────────────────────────────────

/** One hour on the timeline: an hour block, venue-local minutes past midnight (may pass 1440). */
export const CELL_MIN = 60;

export function cellKey(date: string, courtId: string, startMin: number): string {
  return `${date}|${courtId}|${startMin}`;
}

export function parseCell(key: string): { date: string; courtId: string; startMin: number } | null {
  const [date, courtId, min] = key.split('|');
  const startMin = Number(min);
  if (!date || !courtId || !Number.isInteger(startMin)) return null;
  return { date, courtId, startMin };
}

/** The hour columns between the venue's opening and closing (whole hours around them). */
export function hourColumns(openMin: number, closeMin: number): number[] {
  if (closeMin <= openMin) return [];
  const start = Math.floor(openMin / CELL_MIN) * CELL_MIN;
  const end = Math.ceil(closeMin / CELL_MIN) * CELL_MIN;
  const out: number[] = [];
  for (let m = start; m < end; m += CELL_MIN) out.push(m);
  return out;
}

export interface PlanSlot {
  date: string;
  startMin: number;
  endMin: number;
  courtIds: string[];
  /** The cells the slot is made of, to take it off again. */
  keys: string[];
}

/**
 * The picked cells as court time slots: each court's unbroken run of hours on
 * a day is one stretch, and courts sharing the same stretch become one slot
 * (the record's `ranges` entry), in day and start order.
 */
export function slotsOf(picks: readonly string[], courtOrder: readonly string[] = []): PlanSlot[] {
  const byCourt = new Map<string, { date: string; courtId: string; mins: number[] }>();
  for (const key of picks) {
    const c = parseCell(key);
    if (!c) continue;
    const id = `${c.date}|${c.courtId}`;
    const entry = byCourt.get(id) ?? { date: c.date, courtId: c.courtId, mins: [] };
    if (!entry.mins.includes(c.startMin)) entry.mins.push(c.startMin);
    byCourt.set(id, entry);
  }
  const runs = new Map<string, PlanSlot>();
  for (const { date, courtId, mins } of byCourt.values()) {
    mins.sort((a, b) => a - b);
    let start = mins[0]!;
    let prev = start;
    const flush = (end: number) => {
      const id = `${date}|${start}|${end}`;
      const slot = runs.get(id) ?? { date, startMin: start, endMin: end, courtIds: [], keys: [] };
      slot.courtIds.push(courtId);
      for (let m = start; m < end; m += CELL_MIN) slot.keys.push(cellKey(date, courtId, m));
      runs.set(id, slot);
    };
    for (const m of mins.slice(1)) {
      if (m !== prev + CELL_MIN) {
        flush(prev + CELL_MIN);
        start = m;
      }
      prev = m;
    }
    flush(prev + CELL_MIN);
  }
  const rank = (id: string) => {
    const i = courtOrder.indexOf(id);
    return i === -1 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...runs.values()]
    .map((s) => ({
      ...s,
      courtIds: [...s.courtIds].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)),
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.startMin - b.startMin || a.endMin - b.endMin);
}

// ── The record ──────────────────────────────────────────────────────────────

/** A typed amount or count: digits (thousands separators allowed), else NaN for the validator to refuse. */
function num(text: string): number | undefined {
  const t = text.replace(/[,\s]/g, '');
  if (t === '') return undefined;
  return /^\d+$/.test(t) ? Number(t) : Number.NaN;
}

function put(out: Record<string, unknown>, key: string, value: unknown): void {
  if (value === undefined) return;
  if (typeof value === 'string' && value.trim() === '') return;
  out[key] = typeof value === 'string' ? value.trim() : value;
}

/** The `tournament.plan` record the server validates. */
export function planRecord(
  p: PlanState,
  tz: string,
  courtOrder: readonly string[] = [],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  put(out, 'class', p.cls ?? undefined);
  put(out, 'name_en', p.nameEn);
  put(out, 'name_ar', p.nameAr);
  out.ranges = slotsOf(p.picks, courtOrder).map((s) => ({
    court_ids: s.courtIds,
    from: wallTimeToUtc(s.date, s.startMin, tz).toISOString(),
    to: wallTimeToUtc(s.date, s.endMin, tz).toISOString(),
  }));
  const capacity: Record<string, unknown> = { unit: p.unit };
  put(capacity, 'count', num(p.count));
  out.capacity = capacity;
  if (isFullPlan(p.variant)) {
    put(out, 'format', p.format ?? undefined);
    put(out, 'entry_fee_iqd', num(p.fee));
    const prize: Record<string, unknown> = {};
    put(prize, 'text', p.prizeText);
    put(prize, 'iqd', num(p.prizeIqd));
    if (Object.keys(prize).length > 0) out.prize = prize;
    put(out, 'budget_iqd', num(p.budget));
    put(out, 'expected_entries', num(p.expected));
    put(out, 'risks', p.risks);
  }
  put(out, 'notes', p.notes);
  if (p.variant === 'type3') {
    const s = p.sponsor;
    const any =
      [s.name, s.contact, s.contribution, s.branding].some((v) => v.trim() !== '') || s.invoice;
    if (any) {
      const sponsor: Record<string, unknown> = {};
      put(sponsor, 'name', s.name);
      put(sponsor, 'contact', s.contact);
      put(sponsor, 'contribution_iqd', num(s.contribution));
      put(sponsor, 'branding', s.branding);
      sponsor.invoice = s.invoice;
      out.sponsor = sponsor;
    }
  }
  return out;
}

// ── Sections ────────────────────────────────────────────────────────────────

/** Which section a validation issue belongs to (its field is the record path the server names). */
export function sectionOfIssue(issue: Pick<FieldIssue, 'field'>): PlanSection {
  const root = issue.field.split(/[.[]/)[0] ?? '';
  switch (root) {
    case 'variant':
      return 'type';
    case 'ranges':
      return 'courts';
    case 'capacity':
    case 'entry_fee_iqd':
    case 'prize':
    case 'budget_iqd':
    case 'expected_entries':
      return 'players';
    case 'risks':
    case 'notes':
      return 'notes';
    case 'sponsor':
      return 'sponsor';
    default:
      return 'name';
  }
}

/** The steps a type's plan shows: the sponsor's only on a type 3 plan. */
export function planSections(variant: TournamentVariant): PlanSection[] {
  return PLAN_SECTIONS.filter((s) => s !== 'sponsor' || variant === 'type3');
}

/** Whether a section has what it needs: the menu's tick (the validator still has the last word). */
export function sectionDone(p: PlanState, section: PlanSection): boolean {
  switch (section) {
    case 'type':
      return true;
    case 'name':
      return (
        p.cls !== null &&
        p.nameEn.trim() !== '' &&
        p.nameAr.trim() !== '' &&
        (!isFullPlan(p.variant) || p.format !== null)
      );
    case 'courts':
      return p.picks.length > 0;
    case 'players': {
      const n = num(p.count);
      return n !== undefined && Number.isInteger(n) && n >= 2;
    }
    case 'notes':
      return p.notes.trim() !== '' || (isFullPlan(p.variant) && p.risks.trim() !== '');
    case 'sponsor':
      return (
        p.variant === 'type3' &&
        p.sponsor.name.trim() !== '' &&
        p.sponsor.contact.trim() !== '' &&
        p.sponsor.contribution.trim() !== ''
      );
  }
}

/** The menu's "x of y done": every step the plan shows, the optional notes included. */
export function planProgress(p: PlanState): { done: number; total: number } {
  const steps = planSections(p.variant);
  return { done: steps.filter((s) => sectionDone(p, s)).length, total: steps.length };
}
