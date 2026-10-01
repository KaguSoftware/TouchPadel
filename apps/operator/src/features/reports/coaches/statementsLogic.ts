/**
 * The pure rules behind Coach pay (`/reports/coaches`, docs/design/coaching/
 * operator.md §5.16, §5.21). No React, no fetches; every figure is the
 * server's (§5.1): nothing here adds, splits or rounds money.
 *
 * - Which statements come first, and which belong to another branch (R21).
 * - What a statement offers (`statementActions`): the status decides the
 *   actions, the detail's `can` (CM-11: all false on the caller's own
 *   statement) and `settleCoaches` decide whether they are offered, approve is
 *   a confirm (R4), voiding an approved statement takes a PIN (R59, R70), and
 *   Mark paid is off below zero (R59).
 * - The reference and void-reason guard (R49, R74, operator.md Addition 18): a
 *   run of 12 or more digits, counted across spaces, hyphens and dots, is a
 *   card or account number and is refused before anything is sent.
 * - The month stepper's bounds: never past the server's `current_month`.
 */
import { formatIQD, formatNumber, isolateLtr, type Locale, type MessageKey } from '@touch/i18n';
import type {
  MissingStatement,
  StatementCan,
  StatementLine,
  StatementRow,
  StatementTotals,
} from '../../coaching/lessonPayloads';

// ---------------------------------------------------------------------------
// Figures, as printed (display only)
// ---------------------------------------------------------------------------

/** A server figure in IQD, or "—" when it was not sent (never a made-up zero). */
export function moneyText(n: number | null, locale: Locale): string {
  if (n === null) return '—';
  return Number.isInteger(n) ? formatIQD(n, locale) : formatNumber(n, locale);
}

/** A figure that may fall below zero (a total, an adjustment line), kept left to right when it does. */
export function maybeNegativeMoneyText(n: number | null, locale: Locale): string {
  if (n === null) return '—';
  return n < 0 ? isolateLtr(moneyText(n, locale)) : moneyText(n, locale);
}

/** A signed figure (adjustments): "+5,000 IQD" / "-5,000 IQD", kept left to right in Arabic. */
export function signedMoneyText(n: number | null, locale: Locale): string {
  if (n === null) return '—';
  if (n === 0) return moneyText(0, locale);
  return isolateLtr(n > 0 ? `+${moneyText(n, locale)}` : moneyText(n, locale));
}

/** A count, or "—". */
export function countText(n: number | null, locale: Locale): string {
  return n === null ? '—' : formatNumber(n, locale);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

/** One of a bilingual pair in the screen's language, else the other one. */
export function bilingual(
  locale: Locale,
  en: string | null | undefined,
  ar: string | null | undefined,
): string {
  const first = (locale === 'ar' ? ar : en) ?? '';
  return first.trim() !== '' ? first : ((locale === 'ar' ? en : ar) ?? '');
}

export function coachOf(
  r: Pick<StatementRow, 'coach_name_en' | 'coach_name_ar'>,
  locale: Locale,
): string {
  return bilingual(locale, r.coach_name_en, r.coach_name_ar);
}

export function branchOf(
  r: Pick<StatementRow, 'venue_name_en' | 'venue_name_ar'>,
  locale: Locale,
): string {
  return bilingual(locale, r.venue_name_en, r.venue_name_ar);
}

/** A statement's badge tone (§5.16): Draft neutral, Approved info, Paid success, Void muted. */
export function statementTone(status: string): 'neutral' | 'info' | 'success' {
  if (status === 'approved') return 'info';
  if (status === 'paid') return 'success';
  return 'neutral';
}

// ---------------------------------------------------------------------------
// Branches (R21)
// ---------------------------------------------------------------------------

/**
 * A row of a branch other than the rail's: read here only, under "All
 * branches" (the detail read and every write act on the rail's branch). With
 * no rail branch known (one branch, no switcher) every row is this branch's.
 */
export function isOtherBranch(r: { venue_id: string | null }, railBranch: string | null): boolean {
  return railBranch !== null && r.venue_id !== null && r.venue_id !== railBranch;
}

/** The branch column shows only when the list reaches past the rail's branch ("All branches"). */
export function showsBranchColumn(
  rows: readonly { venue_id: string | null }[],
  railBranch: string | null,
): boolean {
  return rows.some((r) => isOtherBranch(r, railBranch));
}

// ---------------------------------------------------------------------------
// Row order
// ---------------------------------------------------------------------------

/** What waits on someone first: drafts to approve, then approved to pay, then the settled ones. */
const STATUS_ORDER: Record<string, number> = { draft: 0, approved: 1, paid: 2, void: 3 };

/**
 * The table's order: the rail branch's statements before another branch's,
 * then by status (to approve, to pay, paid, void), then by coach name; the
 * statement id last so the order never flickers between reads.
 */
export function orderStatements(
  rows: readonly StatementRow[],
  locale: Locale,
  railBranch: string | null,
): StatementRow[] {
  return [...rows].sort((a, b) => {
    const branch = Number(isOtherBranch(a, railBranch)) - Number(isOtherBranch(b, railBranch));
    if (branch !== 0) return branch;
    if (isOtherBranch(a, railBranch)) {
      const v = branchOf(a, locale).localeCompare(branchOf(b, locale), locale);
      if (v !== 0) return v;
    }
    const s = (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9);
    if (s !== 0) return s;
    const n = coachOf(a, locale).localeCompare(coachOf(b, locale), locale);
    if (n !== 0) return n;
    return a.statement_id.localeCompare(b.statement_id);
  });
}

// ---------------------------------------------------------------------------
// Totals band and the missing rows
// ---------------------------------------------------------------------------

export type TotalsFigureKey =
  'collected' | 'courtShare' | 'coachShare' | 'adjustments' | 'toPay' | 'approvedUnpaid' | 'paid';

export interface TotalsFigure {
  key: TotalsFigureKey;
  /** The server's figure, null when it did not send one ("—"). */
  value: number | null;
  /** Adjustments are signed. */
  signed?: boolean;
}

/** The band in the order of §5.16, each figure the server's `totals`. */
export function totalsFigures(t: StatementTotals): TotalsFigure[] {
  return [
    { key: 'collected', value: t.collected_iqd },
    { key: 'courtShare', value: t.court_share_iqd },
    { key: 'coachShare', value: t.coach_iqd },
    { key: 'adjustments', value: t.adjustments_iqd, signed: true },
    { key: 'toPay', value: t.total_iqd },
    { key: 'approvedUnpaid', value: t.approved_unpaid_iqd },
    { key: 'paid', value: t.paid_iqd },
  ];
}

export interface MissingRow {
  key: string;
  coach: string;
  /** "{coach}: not drafted yet" or "{coach}: waits for an older month's draft". */
  textKey: MessageKey;
}

/** The coaches with no statement for the month, as muted lines under the table. */
export function missingRows(missing: readonly MissingStatement[], locale: Locale): MissingRow[] {
  return missing.map((m, i) => ({
    key: `${m.coach_id ?? i}:${m.venue_id ?? ''}`,
    coach: bilingual(locale, m.coach_name_en, m.coach_name_ar),
    textKey:
      m.reason === 'older_draft'
        ? 'ws.coaching.coachPay.missing.older_draft'
        : 'ws.coaching.coachPay.missing.not_drafted',
  }));
}

/** The Financial card's line (§5.3.3): drafts to approve and approved statements to pay. */
export function statementCounts(rows: readonly Pick<StatementRow, 'status'>[]): {
  toApprove: number;
  toPay: number;
} {
  let toApprove = 0;
  let toPay = 0;
  for (const r of rows) {
    if (r.status === 'draft') toApprove += 1;
    else if (r.status === 'approved') toPay += 1;
  }
  return { toApprove, toPay };
}

/** No line when there is nothing to approve or pay. */
export function hasCoachPayWork(c: { toApprove: number; toPay: number }): boolean {
  return c.toApprove > 0 || c.toPay > 0;
}

// ---------------------------------------------------------------------------
// What a statement offers (R4, R21, R59, R70, CM-11)
// ---------------------------------------------------------------------------

export type StatementActionKey = 'recount' | 'approve' | 'void' | 'markPaid' | 'redraft';

export interface StatementAction {
  key: StatementActionKey;
  /** The write behind it asks a manager PIN first (Mark paid; Void from approved). */
  pin: boolean;
  /** Offered but off: a statement below zero cannot be marked paid (R59). */
  blocked: 'negative' | null;
}

export type StatementReadOnly = 'noCapability' | 'otherBranch' | 'ownStatement' | null;

export interface StatementActionPlan {
  /** Why nothing can be done to this statement here, or null. */
  readOnly: StatementReadOnly;
  actions: StatementAction[];
}

const NO_ACTIONS = (readOnly: StatementReadOnly): StatementActionPlan => ({
  readOnly,
  actions: [],
});

/**
 * The actions a statement offers, in the order they are drawn. `can` is the
 * detail's (null before it has loaded: the status alone then decides, and the
 * server still refuses what it must). Every `can` false on a draft or an
 * approved statement is the caller's own (CM-11).
 */
export function statementActions(
  input: {
    statement: Pick<StatementRow, 'status' | 'venue_id' | 'total_iqd'>;
    can: StatementCan | null;
  },
  caps: { settleCoaches: boolean },
  railBranch: string | null,
): StatementActionPlan {
  const { statement: s, can } = input;
  if (!caps.settleCoaches) return NO_ACTIONS('noCapability');
  if (isOtherBranch(s, railBranch)) return NO_ACTIONS('otherBranch');
  const live = s.status === 'draft' || s.status === 'approved';
  if (can && live && !can.refresh && !can.approve && !can.void && !can.mark_paid) {
    return NO_ACTIONS('ownStatement');
  }
  const allowed = (flag: keyof StatementCan) => (can ? can[flag] : true);
  const actions: StatementAction[] = [];
  const add = (key: StatementActionKey, flag: keyof StatementCan, pin = false) => {
    if (!allowed(flag)) return;
    const blocked =
      key === 'markPaid' && s.total_iqd !== null && s.total_iqd < 0 ? 'negative' : null;
    actions.push({ key, pin, blocked });
  };
  switch (s.status) {
    case 'draft':
      add('recount', 'refresh');
      add('approve', 'approve');
      add('void', 'void');
      break;
    case 'approved':
      add('markPaid', 'mark_paid', true);
      add('void', 'void', true);
      break;
    case 'void':
      add('redraft', 'refresh');
      break;
    default:
      break;
  }
  return { readOnly: null, actions };
}

// ---------------------------------------------------------------------------
// The reference and the void reason (R49, R74)
// ---------------------------------------------------------------------------

export const REFERENCE_MAX = 80;
export const VOID_REASON_MAX = 200;

/**
 * Spaces, hyphens (and the Unicode dashes a keyboard may type) and dots
 * between digits, as a card typed in groups ("4111 1111 1111 1111").
 */
const DIGIT_GAPS = /[\s\-.‐-―−]/g;
/** ASCII, Arabic-Indic and Eastern Arabic-Indic digits. */
const DIGIT_RUN = /[0-9٠-٩۰-۹]{12,}/;

/** True when the text holds a run of 12 or more digits once its gaps are taken out (R74). */
export function looksLikeCardNumber(text: string): boolean {
  return DIGIT_RUN.test(text.replace(DIGIT_GAPS, ''));
}

export type TextError = 'required' | 'tooLong' | 'cardNumber';

function textErrors(text: string, max: number): TextError | null {
  const t = text.trim();
  if (t === '') return 'required';
  if (t.length > max) return 'tooLong';
  if (looksLikeCardNumber(t)) return 'cardNumber';
  return null;
}

/** Mark paid's reference: 1..80 characters, never a card or account number. */
export function referenceErrors(text: string): TextError | null {
  return textErrors(text, REFERENCE_MAX);
}

/** A void's reason: 1..200 characters, with the same guard. */
export function voidReasonErrors(text: string): TextError | null {
  return textErrors(text, VOID_REASON_MAX);
}

const PIN_CODES: ReadonlySet<string> = new Set([
  'PIN_INVALID',
  'PIN_LOCKED',
  'PIN_GRANT_REQUIRED',
  'PIN_REQUIRED',
]);

/** A refusal of the PIN itself: the PIN prompt keeps it; any other refusal goes back to the form. */
export function isPinRefusal(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && PIN_CODES.has(code);
}

/** A field error's words. */
export function textErrorKey(error: TextError, field: 'reference' | 'reason'): MessageKey {
  if (error === 'cardNumber') return 'ws.coaching.errors.cardNumber';
  if (error === 'tooLong') return 'ws.coaching.coachPay.fieldErrors.tooLong';
  return field === 'reference'
    ? 'ws.coaching.coachPay.fieldErrors.referenceRequired'
    : 'ws.coaching.coachPay.fieldErrors.reasonRequired';
}

// ---------------------------------------------------------------------------
// The month stepper
// ---------------------------------------------------------------------------

const MONTH = /^(\d{4})-(\d{2})-01$/;

/** A `?month=` value the stepper accepts: the first of a month, 'YYYY-MM-01'. */
export function monthParam(v: unknown): string | null {
  return typeof v === 'string' && MONTH.test(v) ? v : null;
}

/** A month moved by whole months, no timezone involved. */
export function addMonths(month: string, by: number): string {
  const m = MONTH.exec(month);
  if (!m) return month;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1 + by, 1));
  return d.toISOString().slice(0, 10);
}

/** The month on screen: the one asked for, never past the server's current month. */
export function shownMonth(asked: string | null, current: string | null): string | null {
  if (asked === null) return current;
  if (current !== null && asked > current) return current;
  return asked;
}

export function canStepForward(shown: string | null, current: string | null): boolean {
  return shown !== null && current !== null && shown < current;
}

/**
 * The `?month=` after a step: null when the step lands on (or past) the
 * current month, so the URL of "this month" carries no month.
 */
export function stepMonth(shown: string, by: number, current: string | null): string | null {
  const next = addMonths(shown, by);
  if (current !== null && next >= current) return null;
  return next;
}

// ---------------------------------------------------------------------------
// A statement line
// ---------------------------------------------------------------------------

/** The key words a line's lesson cell is built from: the kind word, and the session for a course. */
export function lineLessonParts(
  l: Pick<
    StatementLine,
    'kind' | 'type_name_en' | 'type_name_ar' | 'course_title_en' | 'course_title_ar' | 'session_no'
  >,
  locale: Locale,
): { kindKey: MessageKey | null; name: string; sessionNo: number | null } {
  const type = bilingual(locale, l.type_name_en, l.type_name_ar);
  if (l.kind === 'course') {
    const title = (locale === 'ar' ? l.course_title_ar : l.course_title_en) ?? '';
    return {
      kindKey: 'ws.coaching.common.kindShort.course',
      name: title.trim() !== '' ? title : type,
      sessionNo: l.session_no,
    };
  }
  return {
    kindKey: l.kind ? `ws.coaching.common.kindShort.${l.kind}` : null,
    name: type,
    sessionNo: null,
  };
}
