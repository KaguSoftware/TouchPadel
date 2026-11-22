/**
 * A typed name and number become a customer (Majed, 2026-11-21: "any customer
 * that does anything, even if they don't have the mobile app, they are added
 * to our customer database"; migration 0448).
 *
 * Every desk screen that takes a customer (a booking, a repeat booking, an
 * open-match seat, a lesson place, a cafe or shop order) lets the clerk pick an
 * account or type a name and a phone number. A typed pair used to stay a name
 * on that one row. Now, just before the row is written, the screen asks
 * `desk-customer-create` (`ifExists: 'return'`) for the account holding that
 * number: the one already there, or a new one made from the name and number
 * alone. The row is then written against that account, exactly as if the clerk
 * had picked it from the search, so the person is in the Customers list with
 * their bookings, bills and points. On their own phone, signing in with that
 * number opens Create account with it filled in; the code that confirms the
 * number claims this record (0307).
 *
 * A NAME ALONE is a customer too (Majed, the same day: "it saves that name
 * with their purchase as a customer with an incomplete account"): with no
 * number the function makes a customer from the name, with no phone. They are
 * shown as Incomplete wherever they appear, and the number is added later from
 * the picked customer or their record (completeDeskAccount), which is what
 * lets the person claim the account on their phone. Nothing is matched by
 * name: two people called Ali are two records unless the clerk picks one.
 *
 * NEVER IN THE WAY. The account is a by-product of the booking, never a
 * condition of it: a station that is offline, a slow or failing function all
 * answer null, and the screen writes the row with the typed name as it always
 * did. Nothing here throws.
 */
import { useCallback } from 'react';
import { isolate, type Locale } from '@touch/i18n';
import { callEdge, EdgeError } from '../../../lib/edge';
import { isStationOffline } from '../../../lib/connectivity';
import { useLocale } from '../../../lib/i18n';
import { useToast, type ToastApi } from '../../../components/toast';
import type { PickedCustomer } from './CustomerPicker';

/** A gender as an answer carries it, narrowed to the two a court or a match compares (CustomerPicker.customerGenderOf's twin, kept here so the two files do not import each other at run time). */
function customerGenderOf(v: unknown): 'female' | 'male' | null {
  return v === 'female' || v === 'male' ? v : null;
}

/** profiles.full_name's bound in app.desk_register_customer (NAME_LENGTH, 1-80). */
export const DESK_ACCOUNT_NAME_MAX = 80;
/** 7-15 digits is a phone number (desk-customer-create/phone.ts, app.phone_digits). */
export const DESK_ACCOUNT_PHONE_MIN = 7;
export const DESK_ACCOUNT_PHONE_MAX = 15;
/** A booking does not wait longer than this for the account; past it the typed name is used. */
export const DESK_ACCOUNT_TIMEOUT_MS = 6_000;

const EASTERN_DIGITS = /[٠-٩۰-۹]/g;

/** How many digits a typed phone holds, Arabic-Indic ones counted (the server folds them too). */
export function deskPhoneDigits(phone: string): number {
  return phone.replace(EASTERN_DIGITS, '0').replace(/\D/g, '').length;
}

/** Every desk-made record without a real mailbox lives under this domain (desk-customer-create/phone.ts). */
export const GUEST_EMAIL_DOMAIN = 'guest.touch.local';

/** An address a person can be written to: never the placeholder a desk-made record carries. */
export function realEmail(email: string | null | undefined): string | null {
  const e = (email ?? '').trim();
  return e === '' || e.toLowerCase().endsWith(`@${GUEST_EMAIL_DOMAIN}`) ? null : e;
}

/**
 * A customer the desk saved by name alone: no number, under the placeholder
 * address a name-only record is given (`name-<uuid>@guest.touch.local`). A
 * Google or Apple account that never gave a number is NOT one: it has a real
 * address, and only its owner can add its number.
 */
export function isIncompleteCustomer(c: { phone?: string | null; email?: string | null }): boolean {
  if ((c.phone ?? '').trim() !== '') return false;
  const e = (c.email ?? '').trim().toLowerCase();
  return e.startsWith('name-') && e.endsWith(`@${GUEST_EMAIL_DOMAIN}`);
}

/** Whether a typed phone can be a number: 7-15 digits. */
export function isDeskPhone(phone: string): boolean {
  const digits = deskPhoneDigits(phone.trim());
  return digits >= DESK_ACCOUNT_PHONE_MIN && digits <= DESK_ACCOUNT_PHONE_MAX;
}

/**
 * What the function is asked with, or null when there is no name to save. A
 * name with a number that can be one asks for that number's account; a name
 * alone (or with something that is not a number) is saved by name only, as an
 * INCOMPLETE customer (`phone: null`). A name longer than the profile's bound
 * is cut to it (the booking keeps the whole typed name).
 */
export function deskAccountInput(name: string, phone: string): { fullName: string; phone: string | null } | null {
  const fullName = name.trim().slice(0, DESK_ACCOUNT_NAME_MAX).trim();
  if (fullName === '') return null;
  const number = phone.trim();
  return { fullName, phone: isDeskPhone(number) ? number : null };
}

interface EnsureBody {
  fullName: string;
  phone?: string;
  preferredLang: Locale;
  ifExists: 'return';
}

interface EnsureAnswer {
  id?: unknown;
  existing?: unknown;
  claimed?: unknown;
  incomplete?: unknown;
  customer?: { id?: unknown; full_name?: unknown; phone?: unknown; gender?: unknown } | null;
}

export interface DeskAccount {
  customer: PickedCustomer;
  /** True when the number already had an account; false when this call made it. */
  existing: boolean;
  /**
   * True when somebody has signed in to the account: a person using the app,
   * not the desk's own record of a walk-in. The lesson screens leave such a
   * student typed (the server links a typed number to an app account only
   * after its owner confirms, coaching C-21 / R44).
   */
  claimed: boolean;
  /**
   * Saved by name alone: a customer with no number yet. Shown as Incomplete
   * wherever they appear, until a number is added (completeDeskAccount).
   */
  incomplete: boolean;
  /**
   * The number already belongs to an account under ANOTHER name than the one
   * typed. The screen shows whose it is and waits for a second press before
   * it writes anything against that account: a mistyped digit must not put a
   * stranger's name on a booking.
   */
  check: boolean;
}

const fold = (s: string) => s.normalize('NFKC').toLocaleLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Are the typed name and the account's name the same person's? Equal once
 * case and spacing are folded, or one is the other's first words ("Ali" typed
 * for "Ali Hassan"). Anything else is a different name.
 */
export function sameCustomerName(typed: string, account: string): boolean {
  const a = fold(typed);
  const b = fold(account);
  if (a === '' || b === '') return false;
  return a === b || b.startsWith(`${a} `) || a.startsWith(`${b} `);
}

/** The function's answer as the dialogs hold a picked customer; null when it is not one. */
export function deskAccountOf(answer: unknown, typed: { fullName: string; phone: string | null }): DeskAccount | null {
  const a = answer as EnsureAnswer | null;
  if (!a || typeof a.id !== 'string' || a.id === '') return null;
  const brief = a.customer ?? null;
  const name = typeof brief?.full_name === 'string' && brief.full_name.trim() !== '' ? brief.full_name : typed.fullName;
  const phone = typeof brief?.phone === 'string' && brief.phone.trim() !== '' ? brief.phone : typed.phone;
  const existing = a.existing === true;
  const incomplete = !existing && (a.incomplete === true || phone === null);
  return {
    customer: { id: a.id, name, phone, flags: [], gender: customerGenderOf(brief?.gender), ...(incomplete ? { incomplete: true } : {}) },
    existing,
    // A missing flag on an existing account reads as claimed: the careful side.
    claimed: existing && a.claimed !== false,
    incomplete,
    check: existing && !sameCustomerName(typed.fullName, name),
  };
}

/**
 * The account holding the typed number, made now if there is none; with no
 * number, a new customer saved by name alone. Null when there is no name or
 * the function could not answer: the caller then writes its row with the
 * typed name. Never throws.
 */
export async function ensureDeskAccount(name: string, phone: string, lang: Locale): Promise<DeskAccount | null> {
  const typed = deskAccountInput(name, phone);
  if (!typed || isStationOffline()) return null;
  try {
    const answer = await callEdge<EnsureBody, EnsureAnswer>(
      'desk-customer-create',
      { fullName: typed.fullName, ...(typed.phone ? { phone: typed.phone } : {}), preferredLang: lang, ifExists: 'return' },
      { ttlMs: 0, retry: false, timeoutMs: DESK_ACCOUNT_TIMEOUT_MS },
    );
    return deskAccountOf(answer, typed);
  } catch {
    return null;
  }
}

/**
 * The toast is a courtesy line, never a reason to fail a screen: where no
 * provider is mounted (a screen test) there is simply nothing said. useToast
 * reads its context before it throws, so the hook order never changes.
 */
export function useToastIfMounted(): ToastApi | null {
  try {
    return useToast();
  } catch {
    return null;
  }
}

export interface DeskAccountOptions {
  /**
   * The lesson screens: an account a person already uses is left alone (the
   * student stays typed), so nothing is said about it and nothing waits on it.
   */
  walkInsOnly?: boolean;
  /** The till says its own line (it never waits for a second press): no toast from here. */
  quiet?: boolean;
}

/**
 * For a submit handler, when no customer is picked:
 *
 *   const found = await deskAccount(name, phone);
 *   if (found) {
 *     setCustomer(found.customer);
 *     if (found.check) return backToTheWhoStep();   // whose number it is, on screen
 *     who = found.customer;
 *   }
 *
 * It says in a toast what happened, so a number is never linked silently.
 * With `walkInsOnly` an account somebody has signed in to answers null.
 */
export function useDeskAccount(): (name: string, phone: string, opts?: DeskAccountOptions) => Promise<DeskAccount | null> {
  const { tr, locale } = useLocale();
  const toast = useToastIfMounted();
  return useCallback(
    async (name: string, phone: string, opts: DeskAccountOptions = {}) => {
      const account = await ensureDeskAccount(name, phone, locale);
      if (!account) return null;
      if (opts.walkInsOnly && account.claimed) return null;
      if (!opts.quiet) {
        const key = account.incomplete ? 'createdIncomplete' : !account.existing ? 'created' : account.check ? 'check' : 'linked';
        toast?.info(tr(`ws.courtDesk.deskAccount.${key}`, { name: isolate(account.customer.name) }));
      }
      return account;
    },
    [locale, toast, tr],
  );
}

/** What adding a number to a name-only customer came to. */
export type CompleteResult =
  | { ok: true; phone: string }
  /** The number already has its customer: `holder` is who, when the function said. */
  | { ok: false; code: 'DUPLICATE_PHONE'; holder: PickedCustomer | null }
  | { ok: false; code: 'INVALID_PHONE' | 'CUSTOMER_NOT_INCOMPLETE' | 'OFFLINE' | 'FAILED' };

/** A refusal's body as `{ id, customer }`, when it names the customer holding the number. */
function holderOf(body: unknown): PickedCustomer | null {
  const b = body as EnsureAnswer | null;
  if (!b || typeof b.id !== 'string') return null;
  const c = b.customer ?? null;
  return {
    id: b.id,
    name: typeof c?.full_name === 'string' ? c.full_name : '',
    phone: typeof c?.phone === 'string' ? c.phone : null,
    flags: [],
    gender: customerGenderOf(c?.gender),
  };
}

/**
 * The number that completes a customer saved by name alone. Never throws: the
 * screen shows what came back beside the box.
 */
export async function completeDeskAccount(customerId: string, phone: string): Promise<CompleteResult> {
  const number = phone.trim();
  if (!isDeskPhone(number)) return { ok: false, code: 'INVALID_PHONE' };
  if (isStationOffline()) return { ok: false, code: 'OFFLINE' };
  try {
    const answer = await callEdge<{ customerId: string; phone: string; ifExists: 'return' }, EnsureAnswer>(
      'desk-customer-create',
      { customerId, phone: number, ifExists: 'return' },
      { ttlMs: 0, retry: false },
    );
    const saved = answer?.customer?.phone;
    return { ok: true, phone: typeof saved === 'string' && saved.trim() !== '' ? saved : number };
  } catch (e) {
    const code = e instanceof EdgeError ? (e.serverCode ?? e.code) : '';
    if (code === 'DUPLICATE_PHONE') return { ok: false, code, holder: e instanceof EdgeError ? holderOf(e.body) : null };
    if (code === 'INVALID_PHONE' || code === 'CUSTOMER_NOT_INCOMPLETE') return { ok: false, code };
    return { ok: false, code: 'FAILED' };
  }
}
