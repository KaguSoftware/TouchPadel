/**
 * Standing customer discounts (0342), the pure half: what the server sends,
 * the editor's draft and its checks, and the calls a bill's discount dialog
 * makes. Every figure in IQD is the server's; this only formats a customer's
 * own settings (a percent or an amount) and builds RPC arguments.
 *
 * A customer may carry two parts, each a percent or a fixed IQD amount: one on
 * café and shop goods (a whole-bill tab_adjustments row, reason_code
 * 'customer_discount' or 'customer_discount_once') and one on the court fee of
 * their bookings. Percents travel as BASIS POINTS (20% = 2000), as the manager
 * discount's do (TabDetailPanel `discountValue * 100`). No manager PIN: the
 * server records who set it and why instead (0342 header).
 */
import { asciiDigits, formatIQD, formatNumber, type Locale } from '@touch/i18n';

export type DiscountKind = 'percent' | 'amount';

/** One part of a discount: a percent in basis points (1..10000), or IQD. */
export interface DiscountPart {
  kind: DiscountKind;
  value: number;
}

export const DISCOUNT_REASONS = ['sponsored', 'family', 'coach', 'staff', 'other'] as const;
export type DiscountReason = (typeof DISCOUNT_REASONS)[number];

/** The server's caps (customer_discounts constraints): a note of 120, an amount of 100,000,000. */
export const NOTE_MAX = 120;
export const AMOUNT_MAX = 100_000_000;

/** app.customer_discount_json: the customer's standing discount. */
export interface CustomerDiscount {
  cafe: DiscountPart | null;
  court: DiscountPart | null;
  reason: DiscountReason;
  note: string | null;
  set_by: { id: string | null; name: string | null } | null;
  set_at: string | null;
}

/** The café discount a tab carries (bill_customer_discount.cafe). */
export interface BillCafeDiscount extends DiscountPart {
  adjustment_id: string | null;
  amount_iqd: number;
  /** From the customer's standing discount (true) or given at this bill only. */
  standing: boolean;
}

/** The court discount a booking carries (bill_customer_discount.court). */
export interface BillCourtDiscount extends DiscountPart {
  amount_iqd: number;
  standing: boolean;
  /** The reason it was given with (a one-off keeps its own; a café one-off stores none). */
  reason: DiscountReason | null;
  /** A bill of the booking settled with it: fixed now (COURT_BILL_CLOSED). */
  closed: boolean;
}

/** app.bill_customer_discount: who is on the bill, what they have, what the bill carries. */
export interface BillDiscountState {
  customer: { id: string; name: string | null } | null;
  standing: CustomerDiscount | null;
  cafe: BillCafeDiscount | null;
  court: BillCourtDiscount | null;
  cafe_needs_refresh: boolean;
  court_needs_refresh: boolean;
  court_allowed: boolean;
  /**
   * "Remove from this bill" waived the standing discount for this bill
   * (customer_discount_waivers): a refresh on any station leaves it at full
   * price, and the needs_refresh flags stay false, until a discount is given
   * there again.
   */
  cafe_waived: boolean;
  court_waived: boolean;
}

/** The two reason codes the server writes on a tab's customer discount row. */
export const CUSTOMER_DISCOUNT_REASON_CODES = ['customer_discount', 'customer_discount_once'] as const;

export function isCustomerDiscountAdjustment(a: { reason_code?: string | null }): boolean {
  return (CUSTOMER_DISCOUNT_REASON_CODES as readonly string[]).includes(a.reason_code ?? '');
}

export function isDiscountReason(v: unknown): v is DiscountReason {
  return (DISCOUNT_REASONS as readonly unknown[]).includes(v);
}

// ---------------------------------------------------------------------------
// Reading the server's answers (whatever came back: an older server, a mock)
// ---------------------------------------------------------------------------

function readPart(raw: unknown): DiscountPart | null {
  const r = raw as { kind?: unknown; value?: unknown } | null | undefined;
  if (!r || (r.kind !== 'percent' && r.kind !== 'amount')) return null;
  const value = Number(r.value);
  return Number.isFinite(value) && value > 0 ? { kind: r.kind, value } : null;
}

export function readCustomerDiscount(raw: unknown): CustomerDiscount | null {
  const r = raw as Partial<Record<keyof CustomerDiscount, unknown>> | null | undefined;
  if (!r || typeof r !== 'object') return null;
  const cafe = readPart(r.cafe);
  const court = readPart(r.court);
  if (!cafe && !court) return null;
  const setBy = r.set_by as { id?: unknown; name?: unknown } | null | undefined;
  return {
    cafe,
    court,
    reason: isDiscountReason(r.reason) ? r.reason : 'other',
    note: typeof r.note === 'string' && r.note.trim() ? r.note : null,
    set_by: setBy ? { id: typeof setBy.id === 'string' ? setBy.id : null, name: typeof setBy.name === 'string' ? setBy.name : null } : null,
    set_at: typeof r.set_at === 'string' ? r.set_at : null,
  };
}

export function readBillState(raw: unknown): BillDiscountState {
  const r = (raw ?? {}) as Record<string, unknown>;
  const customer = r.customer as { id?: unknown; name?: unknown } | null | undefined;
  const cafeRaw = r.cafe as Record<string, unknown> | null | undefined;
  const courtRaw = r.court as Record<string, unknown> | null | undefined;
  const cafePart = readPart(cafeRaw);
  const courtPart = readPart(courtRaw);
  return {
    customer: customer && typeof customer.id === 'string' ? { id: customer.id, name: typeof customer.name === 'string' ? customer.name : null } : null,
    standing: readCustomerDiscount(r.standing),
    cafe:
      cafeRaw && cafePart
        ? {
            ...cafePart,
            adjustment_id: typeof cafeRaw.adjustment_id === 'string' ? cafeRaw.adjustment_id : null,
            amount_iqd: Number(cafeRaw.amount_iqd ?? 0),
            standing: cafeRaw.standing === true,
          }
        : null,
    court:
      courtRaw && courtPart
        ? {
            ...courtPart,
            amount_iqd: Number(courtRaw.amount_iqd ?? 0),
            standing: courtRaw.standing === true,
            reason: isDiscountReason(courtRaw.reason) ? courtRaw.reason : null,
            closed: courtRaw.closed === true,
          }
        : null,
    cafe_needs_refresh: r.cafe_needs_refresh === true,
    court_needs_refresh: r.court_needs_refresh === true,
    court_allowed: r.court_allowed === true,
    cafe_waived: r.cafe_waived === true,
    court_waived: r.court_waived === true,
  };
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

export function percentFromBp(bp: number): number {
  return bp / 100;
}

export function bpFromPercent(percent: number): number {
  return Math.round(percent * 100);
}

/**
 * "20%" or "5,000 IQD". `percentSign` is the catalog's (ws.kit.common.percent),
 * so the sign is a translated string like every other word on screen.
 */
export function formatPart(part: DiscountPart, locale: Locale, percentSign: string): string {
  return part.kind === 'percent' ? `${formatNumber(percentFromBp(part.value), locale)}${percentSign}` : formatIQD(part.value, locale);
}

// ---------------------------------------------------------------------------
// The editor's draft
// ---------------------------------------------------------------------------

export type PartMode = 'none' | DiscountKind;

export interface PartDraft {
  mode: PartMode;
  /** What the field holds: a percent ("12.5") or IQD ("5000"), as typed. */
  text: string;
}

export interface DiscountDraft {
  cafe: PartDraft;
  court: PartDraft;
  reason: DiscountReason | null;
  note: string;
}

export function partDraftOf(part: DiscountPart | null | undefined): PartDraft {
  if (!part) return { mode: 'none', text: '' };
  return { mode: part.kind, text: String(part.kind === 'percent' ? percentFromBp(part.value) : part.value) };
}

export function draftOf(d: CustomerDiscount | null | undefined): DiscountDraft {
  return { cafe: partDraftOf(d?.cafe), court: partDraftOf(d?.court), reason: d?.reason ?? null, note: d?.note ?? '' };
}

export type PartError = 'empty' | 'percentRange' | 'amountRange';

/** The part a draft says, or why it says none. A mode of 'none' is no part and no error. */
export function parsePart(d: PartDraft): { part: DiscountPart | null; error: PartError | null } {
  if (d.mode === 'none') return { part: null, error: null };
  const t = asciiDigits(d.text).trim().replace(/[٫]/g, '.');
  if (t === '') return { part: null, error: 'empty' };
  if (d.mode === 'percent') {
    // Up to two decimals: basis points are whole.
    if (!/^\d{1,3}(\.\d{1,2})?$/.test(t)) return { part: null, error: 'percentRange' };
    const bp = bpFromPercent(Number(t));
    return bp >= 1 && bp <= 10000 ? { part: { kind: 'percent', value: bp }, error: null } : { part: null, error: 'percentRange' };
  }
  const digits = t.replace(/,/g, '');
  if (!/^\d+$/.test(digits)) return { part: null, error: 'amountRange' };
  const n = Number(digits);
  return n >= 1 && n <= AMOUNT_MAX ? { part: { kind: 'amount', value: n }, error: null } : { part: null, error: 'amountRange' };
}

/** Which parts the form shows: the record shows both; a bill shows what it has. */
export interface DraftSections {
  cafe: boolean;
  court: boolean;
}

export interface DraftCheck {
  cafe: DiscountPart | null;
  court: DiscountPart | null;
  errors: {
    cafe?: PartError;
    court?: PartError;
    /** No part set on any section shown. */
    parts?: true;
    reason?: true;
    note?: true;
  };
  ok: boolean;
}

/** The editor's rules: each part valid, at least one set, a reason with any, a note of 120 at most. */
export function checkDraft(draft: DiscountDraft, sections: DraftSections): DraftCheck {
  const errors: DraftCheck['errors'] = {};
  const cafe = sections.cafe ? parsePart(draft.cafe) : { part: null, error: null };
  const court = sections.court ? parsePart(draft.court) : { part: null, error: null };
  if (cafe.error) errors.cafe = cafe.error;
  if (court.error) errors.court = court.error;
  const anyMode = (sections.cafe && draft.cafe.mode !== 'none') || (sections.court && draft.court.mode !== 'none');
  if (!anyMode) errors.parts = true;
  if (anyMode && !draft.reason) errors.reason = true;
  if (draft.note.trim().length > NOTE_MAX) errors.note = true;
  return { cafe: cafe.part, court: court.part, errors, ok: Object.keys(errors).length === 0 };
}

// ---------------------------------------------------------------------------
// RPC arguments
// ---------------------------------------------------------------------------

export function setDiscountArgs(
  customerId: string,
  cafe: DiscountPart | null,
  court: DiscountPart | null,
  reason: DiscountReason | null,
  note: string | null,
): Record<string, unknown> {
  return {
    p_customer_id: customerId,
    p_cafe_kind: cafe?.kind ?? null,
    p_cafe_value: cafe?.value ?? null,
    p_court_kind: court?.kind ?? null,
    p_court_value: court?.value ?? null,
    p_reason: cafe || court ? reason : null,
    p_note: cafe || court ? note?.trim() || null : null,
  };
}

/** Both kinds null: set_customer_discount removes the standing discount. */
export function clearDiscountArgs(customerId: string): Record<string, unknown> {
  return setDiscountArgs(customerId, null, null, null, null);
}

/**
 * What an apply_* call does: refresh (no kind; the server works it out from the
 * customer's standing discount, and answers a refusal as data), put the
 * standing discount on ('standing': in place of a one-off, lifting a waiver),
 * take it off this bill and waive it there ('none'), or give a part on this
 * bill only.
 */
export type ApplyMode =
  | { kind: 'refresh' }
  | { kind: 'standing' }
  | { kind: 'none' }
  | { kind: 'part'; part: DiscountPart; reason: DiscountReason };

function applyModeArgs(mode: ApplyMode): Record<string, unknown> {
  if (mode.kind === 'refresh') return {};
  if (mode.kind === 'standing' || mode.kind === 'none') return { p_kind: mode.kind };
  return { p_kind: mode.part.kind, p_value: mode.part.value, p_reason: mode.reason };
}

export function cafeApplyArgs(tabId: string, mode: ApplyMode, deviceId: string | null): Record<string, unknown> {
  return { p_tab_id: tabId, ...applyModeArgs(mode), p_device_id: deviceId };
}

export function courtApplyArgs(reservationId: string, mode: ApplyMode, deviceId: string | null): Record<string, unknown> {
  return { p_reservation_id: reservationId, ...applyModeArgs(mode), p_device_id: deviceId };
}

// ---------------------------------------------------------------------------
// The bill's dialog
// ---------------------------------------------------------------------------

/** What the dialog shows: café goods when there is a tab, the court when the booking takes one. */
export function billSections(state: BillDiscountState, ids: { tabId: string | null; reservationId: string | null }): DraftSections {
  return { cafe: ids.tabId !== null, court: ids.reservationId !== null && state.court_allowed && !state.court?.closed };
}

/** The dialog opens on what the bill carries, else the customer's standing discount. */
export function billPrefill(state: BillDiscountState): DiscountDraft {
  const s = state.standing;
  return {
    cafe: partDraftOf(state.cafe ?? s?.cafe),
    court: partDraftOf(state.court ?? s?.court),
    reason: s?.reason ?? null,
    note: s?.note ?? '',
  };
}

export type BillStep =
  | { rpc: 'set_customer_discount'; args: Record<string, unknown> }
  | { rpc: 'apply_customer_discount'; target: 'cafe'; mode: ApplyMode }
  | { rpc: 'apply_customer_court_discount'; target: 'court'; mode: ApplyMode };

export type BillAction = { kind: 'keep'; check: DraftCheck; reason: DiscountReason; note: string } | { kind: 'once'; check: DraftCheck; reason: DiscountReason } | { kind: 'remove' };

/**
 * The calls one press of the dialog makes, in order.
 *
 * keep    set_customer_discount (a part the bill cannot show keeps what the
 *         customer already had), then 'standing' on each part the bill shows:
 *         the standing discount in place of a one-off, any waiver lifted.
 * once    each part shown: the part on this bill only, or, set to None, taken
 *         off this bill and waived there (when it carries one, or the standing
 *         discount would come on).
 * remove  'none' on each part the bill carries: off, and waived for this bill.
 */
export function billSteps(state: BillDiscountState, ids: { tabId: string | null; reservationId: string | null }, action: BillAction): BillStep[] {
  const sections = billSections(state, ids);
  const steps: BillStep[] = [];
  const cafeStep = (mode: ApplyMode) => steps.push({ rpc: 'apply_customer_discount', target: 'cafe', mode });
  const courtStep = (mode: ApplyMode) => steps.push({ rpc: 'apply_customer_court_discount', target: 'court', mode });

  if (action.kind === 'remove') {
    if (ids.tabId && state.cafe) cafeStep({ kind: 'none' });
    if (ids.reservationId && state.court && !state.court.closed) courtStep({ kind: 'none' });
    return steps;
  }

  if (action.kind === 'keep') {
    if (!state.customer) return steps;
    const cafe = sections.cafe ? action.check.cafe : (state.standing?.cafe ?? null);
    const court = sections.court ? action.check.court : (state.standing?.court ?? null);
    steps.push({ rpc: 'set_customer_discount', args: setDiscountArgs(state.customer.id, cafe, court, action.reason, action.note) });
    if (sections.cafe) cafeStep({ kind: 'standing' });
    if (sections.court) courtStep({ kind: 'standing' });
    return steps;
  }

  // None on a part: off this bill, and waived so the standing one stays off.
  const cafeComing = Boolean(state.standing?.cafe) && !state.cafe_waived;
  const courtComing = Boolean(state.standing?.court) && !state.court_waived;
  if (sections.cafe) {
    if (action.check.cafe) cafeStep({ kind: 'part', part: action.check.cafe, reason: action.reason });
    else if (state.cafe || cafeComing) cafeStep({ kind: 'none' });
  }
  if (sections.court) {
    if (action.check.court) courtStep({ kind: 'part', part: action.check.court, reason: action.reason });
    else if (state.court || courtComing) courtStep({ kind: 'none' });
  }
  return steps;
}

/**
 * The auto-refresh's memory of one state: what the bill looked like and what
 * the host's figures were when it last asked for a refresh. The same signature
 * twice is the same question, and is never asked again (a refresh the server
 * refused, or one that changed nothing, must not loop).
 */
export function refreshSignature(state: BillDiscountState, version: string): string {
  return JSON.stringify([
    version,
    state.customer?.id ?? null,
    state.standing,
    state.cafe,
    state.court,
    state.cafe_needs_refresh,
    state.court_needs_refresh,
    state.cafe_waived,
    state.court_waived,
  ]);
}
