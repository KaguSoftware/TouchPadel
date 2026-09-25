/**
 * The Protocols page's logic, kept out of the components so node tests can
 * reach it (apps/operator/CLAUDE.md "Tests"): reading the engine's payloads
 * defensively (build-contracts-2026-09-23 §2.7 "Shared JSON shapes"), the
 * cards, the step timeline, and the rules of the owner's two editors — How it
 * works (app.save_protocol_template) and one run's own steps
 * (app.add_run_step).
 *
 * Nothing here decides what a person may do: every button follows the `can`
 * the engine returns, and the RPCs check again.
 */
import {
  PROTOCOL_KINDS,
  type Can,
  type ItemRow,
  type ProtocolKind,
  type RunRow,
  type StepBrief,
  type StepRow,
  type SubmissionRow,
  type TournamentVariant,
} from '@touch/core/protocols';
import { HIREABLE_ROLES, STAFF_ROLES, type StaffRole } from '@touch/core/staff/roles';
import type { Locale } from '@touch/i18n';
import { can } from '../../lib/auth';

// ── Small readers ──────────────────────────────────────────────────────────

type Obj = Record<string, unknown>;

export function isObj(v: unknown): v is Obj {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number(v) || 0);
const bool = (v: unknown): boolean => v === true;
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strs = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

const KINDS: readonly string[] = PROTOCOL_KINDS;
const ROLES: readonly string[] = STAFF_ROLES;

function kindOf(v: unknown): ProtocolKind {
  return (typeof v === 'string' && KINDS.includes(v) ? v : 'product_release') as ProtocolKind;
}
function variantOf(v: unknown): TournamentVariant | null {
  return v === 'type1' || v === 'type2' || v === 'type3' ? v : null;
}
function rolesOf(v: unknown): StaffRole[] {
  return strs(v).filter((r): r is StaffRole => ROLES.includes(r));
}

export function readStepBrief(raw: unknown): StepBrief {
  const o = isObj(raw) ? raw : {};
  return {
    id: str(o.id) ?? '',
    position: num(o.position),
    step_key: str(o.step_key),
    name_en: str(o.name_en) ?? '',
    name_ar: str(o.name_ar) ?? '',
    status: (str(o.status) ?? 'waiting') as StepBrief['status'],
    round: num(o.round) || 1,
  };
}

export function readRunRow(raw: unknown): RunRow {
  const o = isObj(raw) ? raw : {};
  return {
    id: str(o.id) ?? '',
    kind: kindOf(o.kind),
    variant: variantOf(o.variant),
    title_en: str(o.title_en),
    title_ar: str(o.title_ar),
    status: (str(o.status) ?? 'active') as RunRow['status'],
    started_by: str(o.started_by) ?? '',
    started_by_name: str(o.started_by_name),
    started_at: str(o.started_at) ?? '',
    finished_at: str(o.finished_at),
    scheduled_for: str(o.scheduled_for),
    live_at: str(o.live_at),
    menu_item_id: str(o.menu_item_id),
    promotion_id: str(o.promotion_id),
    current_steps: arr(o.current_steps).map(readStepBrief),
    waiting_on_me: bool(o.waiting_on_me),
  };
}

function readItem(raw: unknown): ItemRow {
  const o = isObj(raw) ? raw : {};
  return {
    id: str(o.id) ?? '',
    position: num(o.position),
    text_en: str(o.text_en) ?? '',
    text_ar: str(o.text_ar) ?? '',
    done_by: str(o.done_by),
    done_by_name: str(o.done_by_name),
    done_at: str(o.done_at),
  };
}

function readSubmission(raw: unknown): SubmissionRow {
  const o = isObj(raw) ? raw : {};
  const decision = str(o.decision);
  return {
    id: str(o.id) ?? '',
    round: num(o.round) || 1,
    submitted_by: str(o.submitted_by) ?? '',
    submitted_by_name: str(o.submitted_by_name),
    submitted_at: str(o.submitted_at) ?? '',
    record: isObj(o.record) ? o.record : null,
    photos: Array.isArray(o.photos) ? strs(o.photos) : null,
    withdrawn_at: str(o.withdrawn_at),
    superseded_at: str(o.superseded_at),
    decision: decision === 'approve' || decision === 'auto' || decision === 'send_back' || decision === 'stop' ? decision : null,
    decided_by: str(o.decided_by),
    decided_by_name: str(o.decided_by_name),
    decided_at: str(o.decided_at),
    decision_note: str(o.decision_note),
    send_back_to: str(o.send_back_to),
  };
}

export function readStepRow(raw: unknown): StepRow {
  const o = isObj(raw) ? raw : {};
  return {
    ...readStepBrief(o),
    actor_roles: rolesOf(o.actor_roles),
    assigned_to: str(o.assigned_to),
    assigned_to_name: str(o.assigned_to_name),
    needs_owner_ok: bool(o.needs_owner_ok),
    optional: bool(o.optional),
    after_keys: strs(o.after_keys),
    opened_at: str(o.opened_at),
    passed_at: str(o.passed_at),
    skip_note: str(o.skip_note),
    skipped_by_name: str(o.skipped_by_name),
    skipped_at: str(o.skipped_at),
    items: arr(o.items).map(readItem),
    submissions: arr(o.submissions).map(readSubmission),
  };
}

const NO_CAN: Can = {
  submit: false,
  withdraw_submission_id: null,
  decide_submission_id: null,
  send_back_targets: [],
  skip: false,
  tick: false,
  edit_items: false,
  add_step: false,
  stop: false,
  withdraw_run: false,
  cancel_schedule: false,
};

export function readCan(raw: unknown): Can {
  if (!isObj(raw)) return { ...NO_CAN };
  return {
    submit: bool(raw.submit),
    withdraw_submission_id: str(raw.withdraw_submission_id),
    decide_submission_id: str(raw.decide_submission_id),
    send_back_targets: strs(raw.send_back_targets),
    skip: bool(raw.skip),
    tick: bool(raw.tick),
    edit_items: bool(raw.edit_items),
    add_step: bool(raw.add_step),
    stop: bool(raw.stop),
    withdraw_run: bool(raw.withdraw_run),
    cancel_schedule: bool(raw.cancel_schedule),
  };
}

/** One built-in step's definition as app.protocol_step_defs returns it (§2.6). */
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

export function readDef(raw: unknown): StepDef | null {
  if (!isObj(raw) || typeof raw.step_key !== 'string') return null;
  const fixed = raw.fixed === 'first' || raw.fixed === 'last' ? raw.fixed : null;
  return {
    step_key: raw.step_key,
    name_en: str(raw.name_en) ?? '',
    name_ar: str(raw.name_ar) ?? '',
    actor_roles: rolesOf(raw.actor_roles),
    assign_to_starter: bool(raw.assign_to_starter),
    needs_owner_ok: bool(raw.needs_owner_ok),
    ok_fixed: bool(raw.ok_fixed),
    optional: bool(raw.optional),
    after: strs(raw.after),
    fixed,
    photo_folder: str(raw.photo_folder),
    photos_min: num(raw.photos_min),
    photos_max: num(raw.photos_max),
    record_visibility: raw.record_visibility === 'mgmt' ? 'mgmt' : 'run',
  };
}

// ── The engine's reads ───────────────────────────────────────────────────────

export interface OverviewTemplate {
  template_id: string;
  kind: ProtocolKind;
  variant: TournamentVariant | null;
  name_en: string;
  name_ar: string;
  version: number;
  running: number;
  waiting_on_me: number;
  finished_30d: number;
}

export function readOverview(raw: unknown): OverviewTemplate[] {
  const list = isObj(raw) ? arr(raw.templates) : [];
  return list.filter(isObj).map((t) => ({
    template_id: str(t.template_id) ?? '',
    kind: kindOf(t.kind),
    variant: variantOf(t.variant),
    name_en: str(t.name_en) ?? '',
    name_ar: str(t.name_ar) ?? '',
    version: num(t.version),
    running: num(t.running),
    waiting_on_me: num(t.waiting_on_me),
    finished_30d: num(t.finished_30d),
  }));
}

/** One card on the page: a kind, with its template (a tournament has three, one per type). */
export interface ProtocolCard {
  kind: ProtocolKind;
  templates: OverviewTemplate[];
  running: number;
  waiting: number;
  finished30d: number;
}

/** The four protocol cards in their fixed order, counts summed over a tournament's three types. */
export function protocolCards(templates: readonly OverviewTemplate[]): ProtocolCard[] {
  return PROTOCOL_KINDS.map((kind) => {
    const own = templates
      .filter((t) => t.kind === kind)
      .sort((a, b) => (a.variant ?? '').localeCompare(b.variant ?? ''));
    return {
      kind,
      templates: own,
      running: own.reduce((s, t) => s + t.running, 0),
      waiting: own.reduce((s, t) => s + t.waiting_on_me, 0),
      finished30d: own.reduce((s, t) => s + t.finished_30d, 0),
    };
  });
}

export function readRunsPage(raw: unknown): { runs: RunRow[]; total: number } {
  if (!isObj(raw)) return { runs: [], total: 0 };
  return { runs: arr(raw.runs).map(readRunRow), total: num(raw.total) };
}

export interface RunDetail {
  run: RunRow & { template_name_en: string | null; template_name_ar: string | null; data: Obj | null };
  steps: StepRow[];
  can: Can;
}

export function readRunDetail(raw: unknown): RunDetail {
  const o = isObj(raw) ? raw : {};
  const r = isObj(o.run) ? o.run : {};
  return {
    run: {
      ...readRunRow(r),
      template_name_en: str(r.template_name_en),
      template_name_ar: str(r.template_name_ar),
      data: isObj(r.data) ? r.data : null,
    },
    steps: arr(o.steps).map(readStepRow).sort((a, b) => a.position - b.position),
    can: readCan(o.can),
  };
}

export interface StepDetail {
  run: RunRow & { data: Obj | null };
  step: StepRow;
  can: Can;
  def: StepDef | null;
}

export function readStepDetail(raw: unknown): StepDetail {
  const o = isObj(raw) ? raw : {};
  const r = isObj(o.run) ? o.run : {};
  return {
    run: { ...readRunRow(r), data: isObj(r.data) ? r.data : null },
    step: readStepRow(o.step),
    can: readCan(o.can),
    def: readDef(o.def),
  };
}

// ── Words ─────────────────────────────────────────────────────────────────────

/**
 * A bilingual row's text in the reader's language, falling back to the other
 * (a staff-typed run title may be in one language, Q10; §4 "Bilingual data").
 */
export function pickText(locale: Locale, en: string | null | undefined, ar: string | null | undefined): string {
  const first = locale === 'ar' ? ar : en;
  const second = locale === 'ar' ? en : ar;
  if (first && first.trim() !== '') return first;
  return second && second.trim() !== '' ? second : '';
}

/**
 * The marker app.hiring_purge_due writes over decision notes, skip notes and
 * stop reasons after 90 days (§2.12); the screen says so in words instead.
 */
export const PURGE_MARKER = '[deleted after 90 days]';
export const isPurged = (text: string | null | undefined): boolean => text === PURGE_MARKER;

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info';

export function runStatusTone(status: RunRow['status']): BadgeTone {
  switch (status) {
    case 'active':
      return 'accent';
    case 'scheduled':
      return 'info';
    case 'live':
    case 'done':
      return 'success';
    case 'stopped':
      return 'danger';
    case 'withdrawn':
      return 'neutral';
  }
}

export function stepStatusTone(status: StepRow['status']): BadgeTone {
  switch (status) {
    case 'open':
      return 'accent';
    case 'submitted':
      return 'warn';
    case 'passed':
      return 'success';
    case 'skipped':
      return 'neutral';
    case 'stopped':
      return 'danger';
    case 'waiting':
      return 'neutral';
  }
}

export function decisionTone(decision: SubmissionRow['decision']): BadgeTone {
  switch (decision) {
    case 'approve':
    case 'auto':
      return 'success';
    case 'send_back':
      return 'warn';
    case 'stop':
      return 'danger';
    default:
      return 'neutral';
  }
}

/** Whether a run is finished (done, stopped or withdrawn): nothing on it changes any more. */
export const isFinished = (status: RunRow['status']): boolean => status === 'done' || status === 'stopped' || status === 'withdrawn';

// ── The timeline ─────────────────────────────────────────────────────────────

/** A step's submissions grouped by round, the latest round first, each round oldest first. */
export function submissionRounds(step: Pick<StepRow, 'submissions'>): { round: number; submissions: SubmissionRow[] }[] {
  const byRound = new Map<number, SubmissionRow[]>();
  for (const s of step.submissions) {
    const list = byRound.get(s.round) ?? [];
    list.push(s);
    byRound.set(s.round, list);
  }
  return [...byRound.entries()]
    .sort(([a], [b]) => b - a)
    .map(([round, submissions]) => ({ round, submissions: [...submissions].sort((a, b) => a.submitted_at.localeCompare(b.submitted_at)) }));
}

/** The submission a step's current round stands on: not withdrawn or set aside, the newest. */
export function standingSubmission(step: Pick<StepRow, 'submissions' | 'round'>): SubmissionRow | null {
  const live = step.submissions.filter((s) => s.withdrawn_at === null && s.superseded_at === null);
  if (live.length === 0) return null;
  return [...live].sort((a, b) => b.round - a.round || b.submitted_at.localeCompare(a.submitted_at))[0] ?? null;
}

/**
 * What a form opens with when the step comes back (a send-back, a withdrawal,
 * a later round): the newest record this person can see on the step, so a
 * resubmission changes what was wrong instead of starting over. Its photos
 * come too: the engine re-claims them for the new submission (§2.3).
 */
export function resubmitPrefill(step: Pick<StepRow, 'submissions'>): { record: Obj; photos: string[] } | null {
  const seen = step.submissions.filter((s) => s.record !== null);
  if (seen.length === 0) return null;
  const last = [...seen].sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))[0]!;
  return { record: last.record ?? {}, photos: last.photos ?? [] };
}

/**
 * The standing record of a built-in step elsewhere in the run: the proposal a
 * price step prices, the plan the courts step blocks. A record a caller may not
 * see is null (§2.7 visibility), and the forms then fall back to their own
 * context read.
 */
export function standingRecord(steps: readonly StepRow[], stepKey: string): Obj | null {
  const step = steps.find((s) => s.step_key === stepKey);
  if (!step) return null;
  const sub = step.submissions
    .filter((s) => s.withdrawn_at === null && s.superseded_at === null && s.decision !== 'send_back' && s.decision !== 'stop')
    .sort((a, b) => b.round - a.round || b.submitted_at.localeCompare(a.submitted_at))[0];
  return sub?.record ?? null;
}

/**
 * The photos a launch may put on the menu: every photo sent with the release's
 * test or marketing step and still standing (§2.8 release `launch`
 * `photo_path`: "a `tests` or `marketing` photo of this run").
 */
export function launchPhotoChoices(steps: readonly StepRow[]): string[] {
  const out: string[] = [];
  for (const step of steps) {
    if (step.step_key !== 'test' && step.step_key !== 'marketing') continue;
    for (const s of step.submissions) {
      if (s.withdrawn_at !== null || s.superseded_at !== null || s.decision === 'send_back' || s.decision === 'stop') continue;
      for (const p of s.photos ?? []) if (!out.includes(p)) out.push(p);
    }
  }
  return out;
}

/**
 * The step a run sheet opens on when the link names none: the first one
 * moving (open or sent), else the last one that moved, so a finished run opens
 * on how it ended (the launch, the stop) and not on its first step.
 */
export function defaultStep(steps: readonly Pick<StepRow, 'id' | 'position' | 'status'>[]): string | null {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const moving = sorted.find((s) => s.status === 'open' || s.status === 'submitted');
  const moved = [...sorted].reverse().find((s) => s.status !== 'waiting');
  return (moving ?? moved ?? sorted[0])?.id ?? null;
}

/** "Opens after": the built-in steps a waiting step depends on, by name, for the timeline. */
export function waitsFor(step: Pick<StepRow, 'after_keys'>, steps: readonly StepRow[]): StepRow[] {
  return step.after_keys.map((k) => steps.find((s) => s.step_key === k)).filter((s): s is StepRow => s !== undefined);
}

// ── How it works (app.save_protocol_template) ─────────────────────────────────

export const TEMPLATE_CAPS = { steps: 20, items: 12, name: 120, item: 200 } as const;

export interface DraftItem {
  key: string;
  text_en: string;
  text_ar: string;
}

export interface DraftStep {
  key: string;
  /** Null for the owner's own step. */
  step_key: string | null;
  name_en: string;
  name_ar: string;
  actor_roles: StaffRole[];
  needs_owner_ok: boolean;
  optional: boolean;
  items: DraftItem[];
}

export interface TemplateDraft {
  name_en: string;
  name_ar: string;
  steps: DraftStep[];
}

export interface TemplateDetail {
  template: {
    id: string;
    kind: ProtocolKind;
    variant: TournamentVariant | null;
    name_en: string;
    name_ar: string;
    version: number;
    updated_at: string | null;
    updated_by_name: string | null;
  };
  steps: TemplateStep[];
  defs: StepDef[];
}

export interface TemplateStep {
  step_key: string | null;
  name_en: string;
  name_ar: string;
  actor_roles: StaffRole[];
  needs_owner_ok: boolean;
  optional: boolean;
  items: { text_en: string; text_ar: string }[];
}

export function readTemplateDetail(raw: unknown): TemplateDetail {
  const o = isObj(raw) ? raw : {};
  const t = isObj(o.template) ? o.template : {};
  return {
    template: {
      id: str(t.id) ?? '',
      kind: kindOf(t.kind),
      variant: variantOf(t.variant),
      name_en: str(t.name_en) ?? '',
      name_ar: str(t.name_ar) ?? '',
      version: num(t.version),
      updated_at: str(t.updated_at),
      updated_by_name: str(t.updated_by_name),
    },
    steps: arr(o.steps)
      .filter(isObj)
      .sort((a, b) => num(a.position) - num(b.position))
      .map((s) => ({
        step_key: str(s.step_key),
        name_en: str(s.name_en) ?? '',
        name_ar: str(s.name_ar) ?? '',
        actor_roles: rolesOf(s.actor_roles),
        needs_owner_ok: bool(s.needs_owner_ok),
        optional: bool(s.optional),
        items: arr(s.items)
          .filter(isObj)
          .map((i) => ({ text_en: str(i.text_en) ?? '', text_ar: str(i.text_ar) ?? '' })),
      })),
    defs: arr(o.defs).map(readDef).filter((d): d is StepDef => d !== null),
  };
}

let keySeq = 0;
/** A local row key; crypto.randomUUID where the runtime has it. */
export function localKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  keySeq += 1;
  return `k${keySeq}`;
}

export function draftFromTemplate(detail: TemplateDetail): TemplateDraft {
  return {
    name_en: detail.template.name_en,
    name_ar: detail.template.name_ar,
    steps: detail.steps.map((s) => ({
      key: localKey(),
      step_key: s.step_key,
      name_en: s.name_en,
      name_ar: s.name_ar,
      actor_roles: [...s.actor_roles],
      needs_owner_ok: s.needs_owner_ok,
      optional: s.optional,
      items: s.items.map((i) => ({ key: localKey(), text_en: i.text_en, text_ar: i.text_ar })),
    })),
  };
}

/** The owner's own step as the editor starts it: named by the owner, done by a manager. */
export function newOwnerStep(): DraftStep {
  return { key: localKey(), step_key: null, name_en: '', name_ar: '', actor_roles: ['manager'], needs_owner_ok: false, optional: false, items: [] };
}

/** The order rules a list of steps must keep (Q7): first first, last last, every built-in step below what it depends on. */
export function orderHolds(steps: readonly Pick<DraftStep, 'step_key'>[], defs: readonly StepDef[]): boolean {
  const pos = new Map<string, number>();
  steps.forEach((s, i) => {
    if (s.step_key) pos.set(s.step_key, i);
  });
  for (const d of defs) {
    const p = pos.get(d.step_key);
    if (p === undefined) return false;
    if (d.fixed === 'first' && p !== 0) return false;
    if (d.fixed === 'last' && p !== steps.length - 1) return false;
    for (const a of d.after) {
      const q = pos.get(a);
      if (q === undefined || q >= p) return false;
    }
  }
  return true;
}

export function moveStep<T>(list: readonly T[], index: number, dir: 'up' | 'down'): T[] {
  const to = dir === 'up' ? index - 1 : index + 1;
  if (to < 0 || to >= list.length) return [...list];
  const next = [...list];
  [next[index], next[to]] = [next[to]!, next[index]!];
  return next;
}

/** Whether one step may move one place: the result must keep the order rules. */
export function canMoveStep(steps: readonly DraftStep[], defs: readonly StepDef[], index: number, dir: 'up' | 'down'): boolean {
  const to = dir === 'up' ? index - 1 : index + 1;
  if (to < 0 || to >= steps.length) return false;
  return orderHolds(moveStep(steps, index, dir), defs);
}

/**
 * Where an owner's new step goes: just above the last step, the one place
 * that always keeps the order (the terminal step waits for everything).
 */
export function insertOwnerStep(steps: readonly DraftStep[], step: DraftStep): DraftStep[] {
  const at = Math.max(0, steps.length - 1);
  return [...steps.slice(0, at), step, ...steps.slice(at)];
}

export type DraftProblem = 'both' | 'tooLong' | 'actors';

export interface DraftProblems {
  name: DraftProblem | null;
  /** By step key: the step's name or actors. */
  steps: Map<string, DraftProblem>;
  /** By item key. */
  items: Map<string, DraftProblem>;
  tooManySteps: boolean;
  /** Step keys whose list is over the cap. */
  tooManyItems: Set<string>;
  order: boolean;
}

function textProblem(en: string, ar: string, max: number): DraftProblem | null {
  if (en.trim() === '' || ar.trim() === '') return 'both';
  if ([...en.trim()].length > max || [...ar.trim()].length > max) return 'tooLong';
  return null;
}

/** What save would refuse, found before the round trip (TEXT_BOTH_LANGUAGES_REQUIRED, LIST_TOO_LONG, INVALID_ROLE, PROTOCOL_ORDER_INVALID). */
export function draftProblems(draft: TemplateDraft, defs: readonly StepDef[]): DraftProblems {
  const out: DraftProblems = {
    name: textProblem(draft.name_en, draft.name_ar, TEMPLATE_CAPS.name),
    steps: new Map(),
    items: new Map(),
    tooManySteps: draft.steps.length > TEMPLATE_CAPS.steps,
    tooManyItems: new Set(),
    order: !orderHolds(draft.steps, defs),
  };
  for (const s of draft.steps) {
    const p = textProblem(s.name_en, s.name_ar, TEMPLATE_CAPS.name);
    if (p) out.steps.set(s.key, p);
    else if (s.step_key === null && (s.actor_roles.length === 0 || s.actor_roles.some((r) => !HIREABLE_ROLES.includes(r)))) {
      out.steps.set(s.key, 'actors');
    }
    const kept = s.items.filter((i) => i.text_en.trim() !== '' || i.text_ar.trim() !== '');
    if (kept.length > TEMPLATE_CAPS.items) out.tooManyItems.add(s.key);
    for (const i of kept) {
      const ip = textProblem(i.text_en, i.text_ar, TEMPLATE_CAPS.item);
      if (ip) out.items.set(i.key, ip);
    }
  }
  return out;
}

export function hasDraftProblems(p: DraftProblems): boolean {
  return p.name !== null || p.steps.size > 0 || p.items.size > 0 || p.tooManySteps || p.tooManyItems.size > 0 || p.order;
}

/** The body of save_protocol_template: built-in steps send no actors or optional (the def owns them); blank item lines are dropped. */
export function templatePayload(draft: TemplateDraft): {
  p_name_en: string;
  p_name_ar: string;
  p_steps: Obj[];
} {
  return {
    p_name_en: draft.name_en.trim(),
    p_name_ar: draft.name_ar.trim(),
    p_steps: draft.steps.map((s) => {
      const items = s.items
        .filter((i) => i.text_en.trim() !== '' || i.text_ar.trim() !== '')
        .map((i) => ({ text_en: i.text_en.trim(), text_ar: i.text_ar.trim() }));
      const base = { step_key: s.step_key, name_en: s.name_en.trim(), name_ar: s.name_ar.trim(), needs_owner_ok: s.needs_owner_ok, items };
      return s.step_key === null ? { ...base, actor_roles: s.actor_roles, optional: s.optional } : base;
    }),
  };
}

/** Whether the draft differs from what is saved (the payloads compared, so a blank line or a trailing space is no change). */
export function templateChanged(draft: TemplateDraft, base: TemplateDraft): boolean {
  return JSON.stringify(templatePayload(draft)) !== JSON.stringify(templatePayload(base));
}

// ── One run's own steps (owner, Q11) ─────────────────────────────────────────

/**
 * The steps a new step may go right after (§2.7 `add_run_step`): below the
 * terminal step, which must still be waiting, and above no step that has left
 * `waiting` (the engine never takes a started step back). Right below the
 * terminal step is always a place while it waits.
 */
export function addStepAfterChoices(steps: readonly StepRow[], lastKey: string | null): StepRow[] {
  const sorted = [...steps].sort((a, b) => a.position - b.position);
  const last = lastKey ? sorted.find((s) => s.step_key === lastKey) : sorted[sorted.length - 1];
  if (!last || last.status !== 'waiting') return [];
  return sorted.filter((after) => {
    if (after.position >= last.position) return false;
    return sorted.every((s) => s.position <= after.position || s.id === last.id || s.status === 'waiting');
  });
}

/** The step a kind's defs mark last (the launch, the ready check, the hire, the apply). */
export function lastStepKey(defs: readonly StepDef[]): string | null {
  return defs.find((d) => d.fixed === 'last')?.step_key ?? null;
}

/** A step's list may be edited while it has not finished (§2.7 `edit_run_items`, STEP_CLOSED). */
export const itemsEditable = (status: StepRow['status']): boolean => status === 'waiting' || status === 'open' || status === 'submitted';

/** The roles an owner's own step may name (HIREABLE, INVALID_ROLE otherwise). */
export const OWNER_STEP_ROLES: readonly StaffRole[] = HIREABLE_ROLES;

/**
 * The engine's decider rule (§2.7 "Who decides"): the owner where the step
 * needs the owner's OK, else a manager or the owner (`decideOwnerOkSteps`,
 * `decideSteps` in CAPABILITY_ROLES). A form uses it only to ask a decider for
 * what a decision would carry (a new item's section, §2.8); who may press
 * anything is the engine's `can`, never this.
 */
export function decidesStep(role: StaffRole | null | undefined, needsOwnerOk: boolean): boolean {
  return can(role ?? undefined, needsOwnerOk ? 'decideOwnerOkSteps' : 'decideSteps');
}

/**
 * Who types a run's title in both languages: the owner (§2.7 `start_protocol`,
 * TEXT_BOTH_LANGUAGES_REQUIRED; `titleRunsInBoth`); staff may type one (Q10).
 * The server's rule, mirrored so the form asks for the right thing.
 */
export function titlesInBoth(role: StaffRole | null | undefined): boolean {
  return can(role ?? undefined, 'titleRunsInBoth');
}

/**
 * Whether step 1 of a start needs the owner's OK, from the venue's template
 * the run is snapshotted from (§2.7 `start_protocol`): the owner may turn the
 * switch on any first step but the fixed ones, so the built-in default is not
 * what a run gets. Null until that template is read.
 */
export function firstStepNeedsOk(
  template: Pick<TemplateDetail, 'template' | 'steps'> | null | undefined,
  templateId: string | null,
  firstKey: string,
): boolean | null {
  if (!template || !templateId || template.template.id !== templateId) return null;
  const step = template.steps.find((s) => s.step_key === firstKey);
  return step ? step.needs_owner_ok : null;
}

/** The venue's template a start of this kind (a tournament: this type) runs from, from protocols_overview. */
export function startTemplateId(
  templates: readonly Pick<OverviewTemplate, 'template_id' | 'kind' | 'variant'>[] | undefined,
  kind: ProtocolKind,
  variant: TournamentVariant | null,
): string | null {
  const t = (templates ?? []).find((x) => x.kind === kind && (kind !== 'tournament' || x.variant === variant));
  return t?.template_id || null;
}
