/**
 * The Start dialog's rules (docs/design/open-matches/operator.md §5.11), pure:
 * what blocks Start, the arguments app.desk_start_match gets, and the price
 * preview. No React, no fetches.
 *
 * Every rule here is a mirror; app.desk_start_match decides (db.md §4.7.4).
 * The mirrors exist so the desk sees why before pressing, not after: the
 * OM-43 lead time against the server's clock, an organiser named or linked,
 * "ask to join" only for someone with the app, the category against a linked
 * customer's declared gender, and a ban.
 */
import { splitEvenly } from '@touch/core';
import { formatNumber, type Locale } from '@touch/i18n';
import { AppRpcError } from '../../lib/appRpc';
import { MATCH_SEATS, type Tr } from './matchLogic';

export type MatchCategory = 'open' | 'women' | 'men';
export type MatchJoinPolicy = 'open' | 'approve';
export type MatchVisibility = 'public' | 'link';
export type ExtraSeats = 0 | 1 | 2;

export const MATCH_CATEGORIES: readonly MatchCategory[] = ['open', 'women', 'men'];
export const JOIN_POLICIES: readonly MatchJoinPolicy[] = ['open', 'approve'];
export const VISIBILITIES: readonly MatchVisibility[] = ['public', 'link'];
export const EXTRA_SEATS: readonly ExtraSeats[] = [0, 1, 2];

/**
 * The organiser the desk picked. Shaped like the picker's PickedCustomer;
 * `gender` is the profile's declared one when the search row carries it
 * (customer_search re-issue, 0262), and absent on an older server.
 */
export interface StartOrganiser {
  id: string;
  flags: readonly { type: string }[];
  gender?: string | null;
}

export interface StartDraft {
  courtId: string;
  /** ISO instant. */
  startAt: string;
  durationMin: number;
  category: MatchCategory;
  joinPolicy: MatchJoinPolicy;
  visibility: MatchVisibility;
  extraSeats: ExtraSeats;
  /** A linked customer, or null for a typed walk-in. */
  customer: StartOrganiser | null;
  guestName: string;
  guestPhone: string;
}

/**
 * A typed player's name and phone, as app.desk_start_match and
 * app.desk_add_seat take them (0262, db.md §4.7.4): the trimmed name at most
 * 80 characters, the phone (optional) 7 to 15 digits once the punctuation is
 * dropped. Otherwise INVALID_ARGUMENT, detail `p_guest_name` / `p_guest_phone`.
 */
export const GUEST_NAME_MAX = 80;
export const GUEST_PHONE_MIN_DIGITS = 7;
export const GUEST_PHONE_MAX_DIGITS = 15;

/** A typed name longer than the server takes (the box caps typing; a name filled from a search can still run over). */
export function guestNameTooLong(name: string): boolean {
  return name.trim().length > GUEST_NAME_MAX;
}

/** A typed phone the server would refuse: not empty, and not 7 to 15 digits. An empty box is fine (the phone is optional). */
export function guestPhoneInvalid(phone: string): boolean {
  const trimmed = phone.trim();
  if (trimmed === '') return false;
  const digits = trimmed.replace(/\D/g, '').length;
  return digits < GUEST_PHONE_MIN_DIGITS || digits > GUEST_PHONE_MAX_DIGITS;
}

export type GuestField = 'name' | 'phone';

/**
 * The typed-player field a desk_start_match / desk_add_seat refusal belongs
 * on (operator.md §5.7: field errors in the dialog): INVALID_ARGUMENT with
 * detail `p_guest_name` or `p_guest_phone`. null for anything else.
 */
export function guestFieldOf(error: unknown): GuestField | null {
  if (!(error instanceof AppRpcError) || error.code !== 'INVALID_ARGUMENT') return null;
  const detail = error.details?.trim();
  return detail === 'p_guest_name' ? 'name' : detail === 'p_guest_phone' ? 'phone' : null;
}

/** The words under a typed-player field, the limits through formatNumber (Latin digits, R38). */
export function guestFieldText(field: GuestField, tr: Tr, locale: Locale): string {
  return field === 'name'
    ? tr('ws.matches.errors.guestName', { max: formatNumber(GUEST_NAME_MAX, locale) })
    : tr('ws.matches.errors.guestPhone', { min: formatNumber(GUEST_PHONE_MIN_DIGITS, locale), max: formatNumber(GUEST_PHONE_MAX_DIGITS, locale) });
}

/** Why Start is disabled, in the order the dialog says them. */
export type StartBlock = 'organiserRequired' | 'nameTooLong' | 'phoneInvalid' | 'banned' | 'genderMismatch' | 'approveNeedsCustomer' | 'tooLate';

export interface StartContext {
  /** desk_open_matches.server_now: the clock OM-43 is measured on (§5.1). */
  serverNow: string | null | undefined;
  /** desk_open_matches.earliest_start_minutes (fill deadline + 60). */
  earliestStartMinutes: number | null | undefined;
  /** Time since that payload was fetched, so an open dialog does not wait for the next poll. */
  elapsedMs?: number;
}

function ms(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : t;
}

/** The profile gender a gendered category needs, or null for an open match. */
export function genderOfCategory(category: string): 'female' | 'male' | null {
  return category === 'women' ? 'female' : category === 'men' ? 'male' : null;
}

/** A `match_ban` flag on the customer (R35): Start is disabled. */
export function isMatchBanned(customer: Pick<StartOrganiser, 'flags'> | null | undefined): boolean {
  return !!customer && customer.flags.some((f) => f.type === 'match_ban');
}

/**
 * A linked customer whose declared gender is the other one. An undeclared
 * customer passes: the server stamps the category's gender on the seat
 * (`p_gender`).
 */
export function genderMismatch(category: string, customer: Pick<StartOrganiser, 'gender'> | null | undefined): boolean {
  const needs = genderOfCategory(category);
  const has = customer?.gender;
  return needs !== null && (has === 'female' || has === 'male') && has !== needs;
}

/**
 * The earliest start the server will take (OM-43): its `server_now` plus the
 * lead in minutes. null when the envelope did not say (the server still
 * refuses MATCH_TOO_LATE, with the time).
 */
export function earliestStartAt(ctx: StartContext): string | null {
  const now = ms(ctx.serverNow);
  const lead = ctx.earliestStartMinutes;
  if (now === null || typeof lead !== 'number' || !Number.isFinite(lead)) return null;
  return new Date(now + (ctx.elapsedMs ?? 0) + lead * 60_000).toISOString();
}

/** Everything that blocks Start now, in the order the dialog shows them. */
export function startDraftErrors(draft: StartDraft, ctx: StartContext): StartBlock[] {
  const out: StartBlock[] = [];
  if (!draft.customer && draft.guestName.trim() === '') out.push('organiserRequired');
  // A linked customer sends neither: their name and phone come from the profile.
  if (!draft.customer && guestNameTooLong(draft.guestName)) out.push('nameTooLong');
  if (!draft.customer && guestPhoneInvalid(draft.guestPhone)) out.push('phoneInvalid');
  if (isMatchBanned(draft.customer)) out.push('banned');
  if (genderMismatch(draft.category, draft.customer)) out.push('genderMismatch');
  // Someone with the app answers the requests; a typed walk-in cannot.
  if (draft.joinPolicy === 'approve' && !draft.customer) out.push('approveNeedsCustomer');
  const earliest = ms(earliestStartAt(ctx));
  const start = ms(draft.startAt);
  if (earliest !== null && start !== null && start < earliest) out.push('tooLate');
  return out;
}

/**
 * app.desk_start_match's arguments (build contracts §1.7). A linked customer
 * is sent alone (their name and phone come from the profile); a typed
 * organiser by name and phone. `p_gender` is the category's for every seat
 * the desk adds (a typed organiser, an undeclared customer, the extras);
 * `p_venue_id` stays null so the tapped court names the branch.
 */
export function startArgs(draft: StartDraft, idempotencyKey: string) {
  const name = draft.guestName.trim();
  const phone = draft.guestPhone.trim();
  return {
    p_start_at: draft.startAt,
    p_duration_min: draft.durationMin,
    p_category: draft.category,
    p_visibility: draft.visibility,
    p_join_policy: draft.joinPolicy,
    p_customer_id: draft.customer?.id ?? null,
    p_guest_name: draft.customer ? null : name || null,
    p_guest_phone: draft.customer ? null : phone || null,
    p_gender: genderOfCategory(draft.category),
    p_extra_seats: draft.extraSeats,
    p_court_id: draft.courtId,
    p_venue_id: null,
    p_idempotency_key: idempotencyKey,
  };
}

/**
 * The shares a court price splits into (DF-3): the same exact split the
 * server stamps with (core `splitEvenly`, the first shares one dinar more).
 * null for no price.
 */
export function previewShares(priceIqd: number | null | undefined): number[] | null {
  if (typeof priceIqd !== 'number' || !Number.isInteger(priceIqd) || priceIqd < 0) return null;
  return splitEvenly(priceIqd, MATCH_SEATS);
}

/** The share quoted as "each player pays": the largest, so nobody is told less than they pay. */
export function quotedShare(shares: readonly number[] | null | undefined): number | null {
  return shares && shares.length > 0 ? Math.max(...shares) : null;
}

/**
 * Did the server stamp a different price from the preview? Then the toast
 * says the new one. An unknown preview is not a change.
 */
export function stampedPriceDiffers(previewIqd: number | null | undefined, stampedIqd: number | null | undefined): boolean {
  return typeof previewIqd === 'number' && typeof stampedIqd === 'number' && previewIqd !== stampedIqd;
}

/**
 * The names of the seats the start takes: the organiser, then "+1", "+2"
 * after the same name (the caller isolates them).
 */
export function startSeatLabels(name: string, extraSeats: ExtraSeats): { name: string; plus: number | null }[] {
  return [{ name, plus: null }, ...Array.from({ length: extraSeats }, (_, i) => ({ name, plus: i + 1 }))];
}
