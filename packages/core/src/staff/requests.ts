/**
 * Staff requests (migration 0072): what a request of each kind must carry, as
 * the table's CHECK constraints say it, so the phone's form (app/staff-request.tsx)
 * marks a field before the round trip. `app.submit_staff_request` and the CHECKs
 * stay the wall.
 *
 *   leave, shift_swap   first and last day, last not before first
 *   correction          the one day, and a note saying what the record gets wrong
 *   advance             an amount above 0, no dates
 *
 * Pure.
 */
import { isIsoDate } from '../analytics/range';

export const STAFF_REQUEST_KINDS = ['leave', 'shift_swap', 'advance', 'correction'] as const;
export type StaffRequestKind = (typeof STAFF_REQUEST_KINDS)[number];

export interface StaffRequestDraft {
  kind: StaffRequestKind;
  /** As typed. */
  from: string;
  to: string;
  amount: string;
  note: string;
}

export type StaffRequestField = 'from' | 'to' | 'amount' | 'note';
export type StaffRequestIssue = { field: StaffRequestField; code: 'required' | 'invalid' | 'order' };

/** The `submit_staff_request` arguments a valid draft becomes. */
export interface StaffRequestArgs {
  kind: StaffRequestKind;
  from: string | null;
  to: string | null;
  amountIqd: number | null;
  note: string;
}

/**
 * ASCII digits for Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic
 * (U+06F0–U+06F9) ones, everything else kept, so an Arabic keyboard types a
 * date or an amount too (phoneDigits folds the same way, and then strips).
 */
export function westernDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (ch) => {
    const code = ch.charCodeAt(0);
    return String(code >= 0x06f0 ? code - 0x06f0 : code - 0x0660);
  });
}

/**
 * A typed day as `YYYY-MM-DD`, or null. Takes `2026-10-05`, `2026/10/5` or
 * `2026.10.05` in either digit set; a day that does not exist is null.
 */
export function parseTypedDate(text: string): string | null {
  const m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(westernDigits(text).trim());
  if (!m) return null;
  const iso = `${m[1]}-${m[2]!.padStart(2, '0')}-${m[3]!.padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : null;
}

/** `staff_requests.amount_iqd` is an `int` (0072): past this Postgres refuses with a bare 22003. */
const INT4_MAX = 2_147_483_647;

/** A whole IQD amount above 0 that fits the column, or null. Thousands separators are allowed. */
export function parseTypedAmount(text: string): number | null {
  const digits = westernDigits(text).trim().replace(/[,\s٬]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  const n = Number(digits);
  return n > 0 && n <= INT4_MAX ? n : null;
}

/** The device's own calendar day as `YYYY-MM-DD` (not UTC: "today" is where the phone is). */
export function localIsoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** Check a draft; an empty list means it can be sent. */
export function validateStaffRequest(draft: StaffRequestDraft): StaffRequestIssue[] {
  const issues: StaffRequestIssue[] = [];
  const day = (field: 'from' | 'to', text: string) => {
    if (!text.trim()) issues.push({ field, code: 'required' });
    else if (!parseTypedDate(text)) issues.push({ field, code: 'invalid' });
  };
  switch (draft.kind) {
    case 'leave':
    case 'shift_swap': {
      day('from', draft.from);
      day('to', draft.to);
      const from = parseTypedDate(draft.from);
      const to = parseTypedDate(draft.to);
      if (from && to && to < from) issues.push({ field: 'to', code: 'order' });
      break;
    }
    case 'correction':
      day('from', draft.from);
      if (!draft.note.trim()) issues.push({ field: 'note', code: 'required' });
      break;
    case 'advance':
      if (!draft.amount.trim()) issues.push({ field: 'amount', code: 'required' });
      else if (parseTypedAmount(draft.amount) === null) issues.push({ field: 'amount', code: 'invalid' });
      break;
  }
  return issues;
}

/** The arguments of a draft that passed `validateStaffRequest`; the fields its kind does not use are null. */
export function staffRequestArgs(draft: StaffRequestDraft): StaffRequestArgs {
  const dated = draft.kind === 'leave' || draft.kind === 'shift_swap';
  return {
    kind: draft.kind,
    from: dated || draft.kind === 'correction' ? parseTypedDate(draft.from) : null,
    to: dated ? parseTypedDate(draft.to) : null,
    amountIqd: draft.kind === 'advance' ? parseTypedAmount(draft.amount) : null,
    note: draft.note.trim(),
  };
}
