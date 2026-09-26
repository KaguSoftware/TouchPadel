/**
 * Client-side checks for protocol forms (build-contracts-2026-09-23 §7.2): each
 * returns `[{field, code}]` with the hint name the server's check hook would use,
 * so a form marks the field before the round trip. The server stays the
 * authority; nothing here is a reason to skip it.
 *
 * Codes are the server's own (`op.errors.<CODE>` in both apps' catalogs):
 * RECORD_INVALID for a missing or malformed field, TEXT_TOO_LONG past a cap,
 * TEXT_REQUIRED / TEXT_BOTH_LANGUAGES_REQUIRED for a run's title,
 * SPONSOR_DETAILS_REQUIRED for a type 3 tournament without its sponsor, and
 * REASON_REQUIRED for a send-back, stop or skip without a note.
 */
import { isIsoDate } from '../analytics/range';
import { PROMO_CODE_ALPHABET, PROMO_CODE_LENGTH, normalizePromoCode } from '../money/promotion';
import {
  PROMOTION_FIELDS,
  RATE_RULE_FIELDS,
  RECORD_CAPS,
  TEXT_CAPS,
  decisionFields,
  firstStepKey,
  stepForm,
  type FieldDef,
  type StepForm,
  type StepFormOptions,
} from './steps';
import { PRICE_CHANGE_KINDS, type DecisionChoice, type PriceChangeKind, type ProtocolKind } from './types';

export type FieldIssueCode =
  | 'RECORD_INVALID'
  | 'TEXT_TOO_LONG'
  | 'TEXT_REQUIRED'
  | 'TEXT_BOTH_LANGUAGES_REQUIRED'
  | 'SPONSOR_DETAILS_REQUIRED'
  | 'REASON_REQUIRED'
  | 'SEND_BACK_TARGET_INVALID';

export interface FieldIssue {
  /** The server's hint: `name`, `promotion.public_code`, `rule.end_time`, `photos`, `title`. */
  field: string;
  code: FieldIssueCode;
  /** For a field inside a list, which element (the hint names the list). */
  index?: number;
}

export interface ValidateContext {
  /** The submitter decides this step, so its submission passes at once (§2.7). */
  submitterDecides?: boolean;
  /** How many photos are attached. Left out, the photo count is not checked. */
  photos?: number;
  /** Clock for the date checks; `Date.now()` when left out. */
  now?: number;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

type Obj = Record<string, unknown>;

function isObject(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '');
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** Minutes after midnight of an `HH:MM[:SS]` time, or null. */
export function timeMinutes(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const m = TIME_RE.exec(value);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3] ?? 0) / 60 : null;
}

function instant(value: unknown): number | null {
  if (typeof value !== 'string' || value.trim() === '') return null;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : t;
}

function textLength(value: string): number {
  // Code points, as Postgres's length() counts them, so an Arabic or emoji
  // string is measured the way the CHECK measures it.
  return [...value.trim()].length;
}

class Issues {
  readonly list: FieldIssue[] = [];
  add(field: string, code: FieldIssueCode, index?: number): void {
    if (this.list.some((i) => i.field === field && i.code === code && i.index === index)) return;
    this.list.push(index === undefined ? { field, code } : { field, code, index });
  }
}

// ── The walker ──────────────────────────────────────────────────────────────

function checkNumber(def: FieldDef, value: unknown, integer: boolean): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  if (integer && !Number.isSafeInteger(value)) return false;
  const min = def.min ?? (def.type === 'iqd' ? 0 : undefined);
  if (min !== undefined && (def.exclusiveMin ? value <= min : value < min)) return false;
  if (def.max !== undefined && value > def.max) return false;
  return true;
}

function checkItems(def: FieldDef, count: number): boolean {
  if (def.minItems !== undefined && count < def.minItems) return false;
  if (def.maxItems !== undefined && count > def.maxItems) return false;
  return true;
}

function checkMembers(
  fields: readonly FieldDef[],
  oneOf: readonly string[] | undefined,
  value: Obj,
  prefix: string | null,
  issues: Issues,
  ctx: ValidateContext,
  index?: number,
): void {
  for (const child of fields) {
    // Inside a list element the hint names the list (with its index); inside
    // an object it names the member (`promotion.public_code`).
    const field = prefix === null ? child.name : index === undefined ? `${prefix}.${child.name}` : prefix;
    checkField(child, value[child.name], field, issues, ctx, index);
  }
  if (oneOf && oneOf.every((name) => isBlank(value[name]))) {
    const first = oneOf[0]!;
    issues.add(prefix === null ? first : index === undefined ? `${prefix}.${first}` : prefix, 'RECORD_INVALID', index);
  }
}

function checkField(
  def: FieldDef,
  value: unknown,
  field: string,
  issues: Issues,
  ctx: ValidateContext,
  index?: number,
): void {
  const required = def.required || (def.deciderOnly === true && ctx.submitterDecides === true);
  if (isBlank(value)) {
    if (required) issues.add(field, 'RECORD_INVALID', index);
    return;
  }
  const bad = () => issues.add(field, 'RECORD_INVALID', index);
  switch (def.type) {
    case 'text':
    case 'longText':
    case 'url': {
      if (typeof value !== 'string') return bad();
      if (def.max !== undefined && textLength(value) > def.max) issues.add(field, 'TEXT_TOO_LONG', index);
      if (def.type === 'url') {
        const v = value.trim();
        let ok = /^https:\/\//i.test(v);
        try {
          new URL(v);
        } catch {
          ok = false;
        }
        if (!ok) bad();
      }
      return;
    }
    case 'enum':
      if (typeof value !== 'string' || !(def.options ?? []).includes(value)) bad();
      return;
    case 'int':
    case 'iqd':
      if (!checkNumber(def, value, true)) bad();
      return;
    case 'number':
      if (!checkNumber(def, value, false)) bad();
      return;
    case 'uuid':
      if (!isUuid(value)) bad();
      return;
    case 'uuids':
      if (!Array.isArray(value) || !value.every(isUuid) || new Set(value).size !== value.length) return bad();
      if (!checkItems(def, value.length)) bad();
      return;
    case 'ints':
      if (
        !Array.isArray(value) ||
        !value.every((v) => checkNumber({ ...def, type: 'int', required: true }, v, true)) ||
        new Set(value).size !== value.length ||
        !checkItems(def, value.length)
      ) {
        bad();
      }
      return;
    case 'date':
      if (!isIsoDate(value)) bad();
      return;
    case 'datetime':
      if (instant(value) === null) bad();
      return;
    case 'time':
      if (timeMinutes(value) === null) bad();
      return;
    case 'bool':
      if (typeof value !== 'boolean') bad();
      return;
    case 'priceMap': {
      if (!isObject(value)) return bad();
      const entries = Object.entries(value);
      const ok =
        checkItems(def, entries.length) &&
        entries.every(([k, v]) => {
          if (!/^\d+$/.test(k)) return false;
          const minutes = Number(k);
          return (
            minutes >= 15 && minutes <= 480 && minutes % 5 === 0 && typeof v === 'number' && Number.isSafeInteger(v) && v > 0
          );
        });
      if (!ok) bad();
      return;
    }
    case 'list':
      if (!Array.isArray(value)) return bad();
      if (!checkItems(def, value.length)) bad();
      value.forEach((element, i) => {
        if (!isObject(element)) return issues.add(field, 'RECORD_INVALID', i);
        checkMembers(def.fields ?? [], def.oneOf, element, field, issues, ctx, i);
      });
      return;
    case 'object':
      if (!isObject(value)) return bad();
      checkMembers(def.fields ?? [], def.oneOf, value, field, issues, ctx);
      return;
  }
}

// ── Cross-field rules ───────────────────────────────────────────────────────

/**
 * A promotion as `upsert_promotion` would take it (0067:291-420), with every
 * refusal as RECORD_INVALID and the hint `<prefix>.<field>` — never 0067's own
 * NAME_REQUIRED, INVALID_VALUE, INVALID_RANGE, INVALID_WEEKDAYS or CODE_TAKEN,
 * which belong to the Promotions screen (§2.8). Whether a code is still free is
 * the server's to say.
 */
export function validatePromotion(value: unknown, prefix = 'promotion'): FieldIssue[] {
  const issues = new Issues();
  if (!isObject(value)) {
    issues.add(prefix, 'RECORD_INVALID');
    return issues.list;
  }
  for (const def of PROMOTION_FIELDS) checkField(def, value[def.name], `${prefix}.${def.name}`, issues, {});
  const v = value;
  if (v.type === 'percent' && typeof v.value === 'number' && v.value > 99) {
    issues.add(`${prefix}.value`, 'RECORD_INVALID');
  }
  const starts = instant(v.starts_at);
  const ends = instant(v.ends_at);
  if (starts !== null && ends !== null && starts >= ends) issues.add(`${prefix}.ends_at`, 'RECORD_INVALID');
  // Both hours or neither; equal hours are an empty window (from > to crosses midnight).
  const from = timeMinutes(v.hour_from);
  const to = timeMinutes(v.hour_to);
  if (isBlank(v.hour_from) !== isBlank(v.hour_to) || (from !== null && from === to)) {
    issues.add(`${prefix}.hour_to`, 'RECORD_INVALID');
  }
  for (const [key, allowed] of [
    ['scope', ['courtIds', 'categoryIds', 'itemIds']],
    ['limits', ['total', 'perCustomer', 'minSpendIqd']],
  ] as const) {
    const o = v[key];
    if (isObject(o) && Object.keys(o).some((k) => !(allowed as readonly string[]).includes(k))) {
      issues.add(`${prefix}.${key}`, 'RECORD_INVALID');
    }
  }
  const code = typeof v.public_code === 'string' ? normalizePromoCode(v.public_code) : null;
  if (code !== null && !/^[A-Z0-9]{4,16}$/.test(code)) issues.add(`${prefix}.public_code`, 'RECORD_INVALID');
  return issues.list;
}

/**
 * A court rate as `upsert_rate_rule` would take it (0071:175-221), refused as
 * RECORD_INVALID with the hint `<prefix>.<field>` — never the rate screen's
 * INVALID_DAYS, INVALID_TIME_RANGE, INVALID_PRICES or INVALID_DURATION. An
 * overnight window is two rules.
 */
export function validateRateRule(value: unknown, prefix = 'rule'): FieldIssue[] {
  const issues = new Issues();
  if (!isObject(value)) {
    issues.add(prefix, 'RECORD_INVALID');
    return issues.list;
  }
  for (const def of RATE_RULE_FIELDS) checkField(def, value[def.name], `${prefix}.${def.name}`, issues, {});
  const start = timeMinutes(value.start_time);
  const end = timeMinutes(value.end_time);
  if (start !== null && end !== null && start >= end) issues.add(`${prefix}.end_time`, 'RECORD_INVALID');
  return issues.list;
}

function refine(kind: ProtocolKind, stepKey: string, record: Obj, opts: StepFormOptions, issues: Issues, now: number): void {
  const key = `${kind}.${stepKey}`;
  if (key === 'product_release.launch' || key === 'price_promo.apply') {
    if (record.when === 'date') {
      const at = instant(record.at);
      if (at === null || at <= now) issues.add('at', 'RECORD_INVALID');
      else if (key === 'product_release.launch' && at > now + RECORD_CAPS.launchDaysAhead * DAY_MS) {
        issues.add('at', 'RECORD_INVALID');
      }
    }
  }
  if (key === 'tournament.plan') {
    if (opts.variant !== 'type2' && isBlank(record.format)) issues.add('format', 'RECORD_INVALID');
    if (opts.variant === 'type3' && !isObject(record.sponsor)) issues.add('sponsor', 'SPONSOR_DETAILS_REQUIRED');
    if (Array.isArray(record.ranges)) {
      record.ranges.forEach((range, i) => {
        if (!isObject(range)) return;
        const from = instant(range.from);
        const to = instant(range.to);
        if (from !== null && to !== null && to <= from) issues.add('ranges', 'RECORD_INVALID', i);
      });
    }
  }
  if (key === 'hiring.interviews') {
    const ids = Array.isArray(record.candidate_ids) ? record.candidate_ids : [];
    if (isUuid(record.picked_id) && !ids.includes(record.picked_id)) issues.add('picked_id', 'RECORD_INVALID');
  }
  if (key === 'price_promo.propose') {
    const change = record.change as PriceChangeKind;
    const count = (value: unknown) => (Array.isArray(value) ? value.length : 0);
    // Something to do: a price, a new size or a rename; an add-on price or a
    // rename (#9). Whether a name is new is the server's to say.
    if (change === 'price' && count(record.prices) + count(record.new_sizes) + count(record.renames) === 0) {
      issues.add('prices', 'RECORD_INVALID');
    }
    if (change === 'addon_price' && count(record.addons) + count(record.renames) === 0) {
      issues.add('addons', 'RECORD_INVALID');
    }
    if (change === 'promotion' || change === 'promotion_edit') {
      for (const issue of validatePromotion(record.promotion)) issues.add(issue.field, issue.code, issue.index);
    }
    if (change === 'rate') {
      for (const issue of validateRateRule(record.rule)) issues.add(issue.field, issue.code, issue.index);
    }
  }
}

// ── Entry points ────────────────────────────────────────────────────────────

/**
 * Check one step's record against its form. An unknown step key is one
 * RECORD_INVALID on `record`. A price or promotion change reads its kind from
 * `record.change` when `opts.change` is left out.
 */
export function validateStep(
  kind: ProtocolKind,
  stepKey: string | null,
  record: unknown,
  opts: StepFormOptions = {},
  ctx: ValidateContext = {},
): FieldIssue[] {
  const issues = new Issues();
  if (!isObject(record)) {
    issues.add('record', 'RECORD_INVALID');
    return issues.list;
  }
  const change =
    opts.change ??
    (kind === 'price_promo' && (PRICE_CHANGE_KINDS as readonly unknown[]).includes(record.change)
      ? (record.change as PriceChangeKind)
      : null);
  const withChange = { ...opts, change };
  const form: StepForm | null = stepForm(kind, stepKey, withChange);
  if (!form) {
    issues.add('record', 'RECORD_INVALID');
    return issues.list;
  }
  checkMembers(form.fields, undefined, record, null, issues, ctx);
  for (const group of form.oneOf) {
    if (group.every((name) => isBlank(record[name]))) issues.add(group[0]!, 'RECORD_INVALID');
  }
  if (ctx.photos !== undefined && (ctx.photos < form.photosMin || ctx.photos > form.photosMax)) {
    issues.add('photos', 'RECORD_INVALID');
  }
  if (stepKey !== null) refine(kind, stepKey, record, withChange, issues, ctx.now ?? Date.now());
  return issues.list;
}

/**
 * A run's title. The owner types both languages (TEXT_BOTH_LANGUAGES_REQUIRED);
 * anyone else may type one (TEXT_REQUIRED when both are blank, Q10). Either is
 * at most 120 characters.
 */
export function validateTitles(
  titleEn: string | null | undefined,
  titleAr: string | null | undefined,
  byOwner: boolean,
): FieldIssue[] {
  const issues = new Issues();
  const en = isBlank(titleEn);
  const ar = isBlank(titleAr);
  if (byOwner && (en || ar)) issues.add('title', 'TEXT_BOTH_LANGUAGES_REQUIRED');
  else if (en && ar) issues.add('title', 'TEXT_REQUIRED');
  for (const t of [titleEn, titleAr]) {
    if (typeof t === 'string' && textLength(t) > TEXT_CAPS.title) issues.add('title', 'TEXT_TOO_LONG');
  }
  return issues.list;
}

export interface StartInput {
  kind: ProtocolKind;
  variant?: StepFormOptions['variant'];
  change?: StepFormOptions['change'];
  titleEn?: string | null;
  titleAr?: string | null;
  /** The first step's record (`p_first_record`). */
  record: unknown;
  byOwner: boolean;
}

/** A whole start: the variant a tournament needs, the title, and the first step's record. */
export function validateStart(input: StartInput, ctx: ValidateContext = {}): FieldIssue[] {
  const issues: FieldIssue[] = [];
  if ((input.kind === 'tournament') !== !isBlank(input.variant)) issues.push({ field: 'variant', code: 'RECORD_INVALID' });
  issues.push(...validateTitles(input.titleEn, input.titleAr, input.byOwner));
  issues.push(
    ...validateStep(input.kind, firstStepKey(input.kind), input.record, { variant: input.variant, change: input.change }, ctx),
  );
  return issues;
}

export interface DecisionInput {
  decision: DecisionChoice;
  note?: string | null;
  /** Send back: the run step the work returns to (one of `Can.send_back_targets`). */
  sendBackTo?: string | null;
  sendBackTargets?: readonly string[];
  /** Approve: the decision data a step asks for (release `propose`: `{category_id}`). */
  data?: unknown;
}

/**
 * A decision on a submission (§2.7 `decide_step`): a reason for Send back and
 * Stop, a target for Send back, and the approval's own data where the step
 * asks for any. There is no override: the decider approves or sends back.
 */
export function validateDecision(
  kind: ProtocolKind,
  stepKey: string | null,
  input: DecisionInput,
): FieldIssue[] {
  const issues = new Issues();
  if (input.decision !== 'approve') {
    if (isBlank(input.note)) issues.add('note', 'REASON_REQUIRED');
  }
  if (typeof input.note === 'string' && textLength(input.note) > TEXT_CAPS.decisionNote) issues.add('note', 'TEXT_TOO_LONG');
  if (input.decision === 'send_back') {
    const targets = input.sendBackTargets;
    if (!isUuid(input.sendBackTo) || (targets !== undefined && !targets.includes(input.sendBackTo))) {
      issues.add('send_back_to', 'SEND_BACK_TARGET_INVALID');
    }
  }
  if (input.decision === 'approve') {
    const fields = decisionFields(kind, stepKey);
    if (fields.length > 0) {
      if (!isObject(input.data)) for (const d of fields) issues.add(d.name, 'RECORD_INVALID');
      else checkMembers(fields, undefined, input.data, null, issues, {});
    }
  }
  return issues.list;
}

/** Skipping an optional step needs a reason, like a stop (§2.7 `skip_step`). */
export function validateSkip(note: string | null | undefined): FieldIssue[] {
  if (isBlank(note)) return [{ field: 'note', code: 'REASON_REQUIRED' }];
  if (textLength(note as string) > TEXT_CAPS.decisionNote) return [{ field: 'note', code: 'TEXT_TOO_LONG' }];
  return [];
}

/**
 * A code for a promotion proposal that is not automatic: drawn from the
 * alphabet `app.generate_promo_code` uses (no 0/O/1/I), which a manager can no
 * longer call once the promotion lock lands (§2.13). 32 symbols, so `byte & 31`
 * is unbiased. The random source is injected, as `mintPairingCode` takes it, so
 * this stays free of Node and Web crypto: each app passes its CSPRNG.
 */
export function randomPromoCode(randomBytes: (n: number) => Uint8Array): string {
  const bytes = randomBytes(PROMO_CODE_LENGTH);
  let code = '';
  for (let i = 0; i < PROMO_CODE_LENGTH; i++) code += PROMO_CODE_ALPHABET[(bytes[i] ?? 0) & 31];
  return code;
}
