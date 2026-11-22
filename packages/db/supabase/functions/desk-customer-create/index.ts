/**
 * desk-customer-create — a walk-in gets a real guest account from the desk
 * (spec 06.10 CustomerCreateScreen; build plan §0 "Customer creation at the
 * desk creates a real guest account (auth user + profile) through a
 * staff-gated edge function, so the guest can later claim it").
 *
 *   POST { fullName, phone, email?, preferredLang: 'en' | 'ar', gender?: 'female' | 'male',
 *          ageBand?, playLevel?, ifExists?: 'return' }
 *     ->  201 { id, customer }                             a new account
 *     ->  200 { id, existing: true, claimed, customer }    ifExists 'return' and the number is held
 *
 * `ifExists: 'return'` (0448, Majed 2026-11-21: every customer a desk writes
 * down is in the customer database). A booking, an open-match seat, a lesson
 * place or a cafe order taken with a typed name and number calls this first:
 * the answer is the account that already holds the number (never a 409), or a
 * new one made from the name and the number alone. The row is then written
 * against that account, and the person finishes it on their own phone: the
 * code that confirms the number there claims this record (0307). In this mode
 * the cashier and the shop assistant may ask too, and the work is the booking
 * dialogs' and the till's, not only the Customers page's. `customer` is
 * { id, full_name, phone, gender } either way. `claimed` says whether anybody
 * has ever signed in to the account: false is still the desk's own record of
 * a walk-in, true is a person using the app (the lesson screens link a typed
 * number to those only after the person confirms it, coaching C-21 / R44, so
 * they leave such a student typed).
 *
 * A NAME WITH NO NUMBER (0448, Majed the same day: "it saves that name with
 * their purchase as a customer with an incomplete account"). In the same mode
 * `phone` may be left out: the name alone becomes a customer,
 *     ->  201 { id, incomplete: true, customer }
 * under `name-<uuid>@guest.touch.local`, with no phone and no key. Nothing is
 * ever matched by name, so two people with one first name are two records.
 * The number is added later with
 *   POST { customerId, phone, ifExists: 'return' }
 *     ->  200 { id, completed: true, customer }
 *     ->  409 DUPLICATE_PHONE { id, customer }   the number already has its customer: use that one
 *     ->  409 CUSTOMER_NOT_INCOMPLETE            not the desk's own unfinished record
 * which makes the record an ordinary desk walk-in (app.desk_complete_customer).
 *
 * gender (0353): the operator asks for it on every new customer, so women's
 * and men's hours can hold. Optional here only so a station still on an older
 * build can register a walk-in; when given it must be female or male.
 *
 * Errors (JSON `{ error, message }`):
 *   400 BAD_REQUEST      — body shape, name length, preferredLang, gender, ageBand, playLevel
 *   400 INVALID_PHONE    — fewer than 7 or more than 15 digits once normalised
 *   409 DUPLICATE_PHONE  — a live profile already holds the number's key (canonical
 *                          form, 0065 app.phone_canon: 0770… ≡ +964770… ≡ ٠٧٧٠…;
 *                          0307: a verified owner or a desk walk-in, never a
 *                          guest who only typed the number)
 *   409 DUPLICATE_EMAIL  — GoTrue already has that address
 *   401 AUTH_REQUIRED / 403 FORBIDDEN — from requireStaffRole
 *
 * WHY AN EDGE FUNCTION. An account is an auth.users row, and only the GoTrue
 * admin API creates one — the same reason staff-admin (0051) exists. Every
 * row-level rule lives in migration 0065 (`app.find_customer_by_phone`,
 * `app.desk_register_customer`, both service-role only); this file only
 * sequences the two calls around `auth.admin.createUser`.
 *
 * THE PASSWORD. Random, 32 bytes of entropy, never returned and never shown:
 * the guest claims the account later through "forgot password" (real email)
 * or through a future phone-based claim flow — spec 06.10 gives the desk no
 * password field, and a password the operator can read aloud is a password
 * the operator knows.
 *
 * THE EMAIL. Optional at the desk (spec 06.10 lists it as a field, the SOW
 * makes the phone the identity). When absent the account is created under
 * `<digits>@guest.touch.local` — see phone.ts — with `email_confirm: true`,
 * because nothing can receive a confirmation there and an unconfirmed account
 * cannot sign in. A real email is also confirmed on creation: the operator
 * has the guest in front of them, and a confirmation mail that never gets
 * clicked would leave the record half-made.
 *
 * The caller must be active staff with role court_desk, manager or owner,
 * checked against the `staff` table by `requireStaffRole`, not against a
 * claim in the token. Cashiers can search and read customers (0065) but do
 * not open the Customers page's form (build plan §1: /desk/customers/new is
 * desk+manager+owner); with `ifExists: 'return'` a cashier and a shop
 * assistant are let in as well (0448), since their own screens take a name
 * and a number.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { handle, isUuid, json, KB, logError, pgErrorBody, readJsonBody } from '../_shared/http.ts';
import {
  isSyntheticEmail,
  GUEST_EMAIL_DOMAIN,
  isValidPhone,
  looksLikeEmail,
  MAX_PHONE_DIGITS,
  MIN_PHONE_DIGITS,
  syntheticEmail,
} from './phone.ts';

const LANGS = ['en', 'ar'] as const;
const GENDERS = ['female', 'male'] as const;
// 0368 (customers contracts §5): the desk asks a walk-in what the app asks.
const AGE_BANDS = ['u18', '18_24', '25_34', '35_44', '45_54', '55_plus'] as const;
const PLAY_LEVELS = ['new', 'beginner', 'intermediate', 'advanced'] as const;
type Lang = (typeof LANGS)[number];

interface CreateBody {
  fullName: string;
  phone: string;
  email?: string | null;
  preferredLang: Lang;
  gender?: 'female' | 'male' | null;
  ageBand?: string | null;
  playLevel?: string | null;
  /** 0448: 'return' answers with the account already holding the number instead of DUPLICATE_PHONE. */
  ifExists?: 'return' | null;
  /** 0448: with `phone` and `ifExists: 'return'`, the name-only customer the number completes. */
  customerId?: string | null;
}

/** The Customers page's form (06.10). */
const FORM_ROLES = ['court_desk', 'manager', 'owner'] as const;
/** 0448: every desk that writes a customer's name and number down (the bar team holds cashier, 0446). */
const DESK_ROLES = ['court_desk', 'manager', 'owner', 'cashier', 'shop_staff'] as const;
/** The pages that take a typed name and number (ACCESS_AREAS): refused only when all are blocked. */
const DESK_AREAS = ['desk', 'till', 'shop', 'customers'] as const;

/** What both answers carry, so the desk can show who the row now belongs to. */
interface CustomerBrief {
  id: string;
  full_name: string | null;
  phone: string | null;
  gender: string | null;
}

function badRequest(message: string): Response {
  return json({ error: 'BAD_REQUEST', message }, 400);
}

/** 32 random bytes as base64url: 43 characters, well inside bcrypt's 72. */
function randomPassword(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * The 409 sentences, fixed (never GoTrue's own text). An operator build that
 * predates reading `error` as the code tells the two apart by the word
 * "email" in the message (CustomerCreate.tsx fieldErrorOf), so both stay.
 */
const DUPLICATE_MESSAGE = {
  DUPLICATE_PHONE: 'a customer with this phone already exists',
  DUPLICATE_EMAIL: 'this email is already registered',
} as const;

/** A name, a phone, an email and a language: a few hundred bytes. */
const MAX_BODY = 16 * KB;

/** Delete an auth user created moments ago; the admin API reports a failure as { error }, never a throw. */
async function rollBackUser(service: ReturnType<typeof createServiceClient>, userId: string): Promise<void> {
  try {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) logError('desk-customer-create', error, `ROLLBACK FAILED: auth user ${userId} has no customer record; delete it by hand`);
  } catch (e) {
    logError('desk-customer-create', e, `ROLLBACK FAILED: auth user ${userId} has no customer record; delete it by hand`);
  }
}

Deno.serve(handle('desk-customer-create', async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const service = createServiceClient();
  // The body first (capped at 16 KB): it says which screen is asking, and so who may.
  const read = await readJsonBody<CreateBody>(req, { maxBytes: MAX_BODY, badJson: () => badRequest('body must be JSON') });
  if (!read.ok) return read.response;
  const body = read.value;
  const returnExisting = body?.ifExists === 'return';

  // The Customers page's work (ACCESS_AREAS 'customers'): blocked there = AREA_BLOCKED (0384, F-16).
  // 0448: a booking dialog or the till asking for "this number's account" is every desk's work.
  const caller = returnExisting
    ? await requireStaffRole(req, service, DESK_ROLES, { areas: DESK_AREAS })
    : await requireStaffRole(req, service, FORM_ROLES, { areas: ['customers'] });
  if (caller instanceof Response) return caller;

  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';

  // 0448: the number that completes a customer saved by name alone.
  if (returnExisting && body?.customerId != null) {
    if (!isUuid(body.customerId)) return badRequest('customerId must be a uuid');
    if (!isValidPhone(phone)) {
      return json({ error: 'INVALID_PHONE', message: `phone must carry ${MIN_PHONE_DIGITS}-${MAX_PHONE_DIGITS} digits` }, 400);
    }
    return completeCustomer(service, body.customerId, phone, caller.userId);
  }

  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  // 0448: a booking, a seat, a lesson or an order taken with a name and no number.
  const nameOnly = returnExisting && phone === '';
  const preferredLang = body?.preferredLang;
  const gender = body?.gender ?? null;
  const ageBand = body?.ageBand ?? null;
  const playLevel = body?.playLevel ?? null;
  const givenEmail =
    typeof body?.email === 'string' && body.email.trim() !== '' ? body.email.trim().toLowerCase() : null;

  if (!fullName || fullName.length > 80) return badRequest('fullName must be 1-80 characters');
  if (!LANGS.includes(preferredLang)) return badRequest(`preferredLang must be one of ${LANGS.join(', ')}`);
  if (gender !== null && !(GENDERS as readonly string[]).includes(gender)) {
    return badRequest(`gender must be one of ${GENDERS.join(', ')}`);
  }
  if (ageBand !== null && !(AGE_BANDS as readonly string[]).includes(ageBand)) {
    return badRequest(`ageBand must be one of ${AGE_BANDS.join(', ')}`);
  }
  if (playLevel !== null && !(PLAY_LEVELS as readonly string[]).includes(playLevel)) {
    return badRequest(`playLevel must be one of ${PLAY_LEVELS.join(', ')}`);
  }
  if (!nameOnly && !isValidPhone(phone)) {
    return json(
      {
        error: 'INVALID_PHONE',
        message: `phone must carry ${MIN_PHONE_DIGITS}-${MAX_PHONE_DIGITS} digits`,
      },
      400,
    );
  }
  if (givenEmail !== null && !looksLikeEmail(givenEmail)) return badRequest('email is not valid');

  if (!nameOnly) {
    // Refuse a duplicate BEFORE creating anything: a create-then-delete of an
    // auth user is a visible churn in the users list for an ordinary desk mistake.
    const dup = await service.schema('app').rpc('find_customer_by_phone', { p_phone: phone });
    if (dup.error) {
      const refused = pgErrorBody(dup.error, 'desk-customer-create');
      return json(refused.body, refused.status);
    }
    if (dup.data) {
      if (returnExisting) return existingCustomer(service, String(dup.data));
      return json(
        { error: 'DUPLICATE_PHONE', message: DUPLICATE_MESSAGE.DUPLICATE_PHONE, id: dup.data },
        409,
      );
    }
  }

  // A name alone has no number to build the address from: a random one, under
  // the same domain every desk-made record lives in.
  const email = givenEmail ?? (nameOnly ? `name-${crypto.randomUUID()}@${GUEST_EMAIL_DOMAIN}` : syntheticEmail(phone));

  // user_metadata is what the 0058 signup trigger reads, so the profile row is
  // born complete; desk_register_customer then upserts the same three fields
  // so the outcome is identical even if the trigger ever ran without them.
  const created = await service.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: nameOnly
      ? { full_name: fullName, preferred_lang: preferredLang, created_via: 'desk' }
      : { full_name: fullName, phone, preferred_lang: preferredLang, created_via: 'desk' },
  });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? 'could not create the account';
    // GoTrue says "already been registered" for a duplicate address. When the
    // address was synthesised from the phone, the collision IS a phone
    // collision (an earlier desk-created guest, possibly one who has since
    // cleared the phone from their profile), so name it as such.
    if (/already/i.test(message)) {
      const code = isSyntheticEmail(email) ? 'DUPLICATE_PHONE' : 'DUPLICATE_EMAIL';
      // 0448: another desk made this very walk-in a moment ago (the pre-check
      // and createUser are two round trips): hand that account back.
      if (returnExisting && code === 'DUPLICATE_PHONE') {
        const raced = await service.schema('app').rpc('find_customer_by_phone', { p_phone: phone });
        if (!raced.error && raced.data) return existingCustomer(service, String(raced.data));
      }
      return json({ error: code, message: DUPLICATE_MESSAGE[code] }, 409);
    }
    logError('desk-customer-create', created.error ?? message, 'createUser failed');
    return json({ error: 'INTERNAL' }, 500);
  }

  const userId = created.data.user.id;
  const { data, error } = await service.schema('app').rpc('desk_register_customer', {
    p_customer_id: userId,
    p_full_name: fullName,
    p_phone: nameOnly ? null : phone,
    p_preferred_lang: preferredLang,
    p_actor_id: caller.userId,
    p_gender: gender,
    p_age_band: ageBand,
    p_play_level: playLevel,
  });

  if (error) {
    // The auth user exists but the record was refused (a duplicate that raced
    // the pre-check, or a validation slip): roll the account back rather than
    // leave a guest who can sign in to an empty profile.
    // The admin API answers { error }, it does not throw: rollBackUser checks it.
    await rollBackUser(service, userId);
    const refused = pgErrorBody(error, 'desk-customer-create');
    // 0448: a duplicate that raced the pre-check names its holder in the detail.
    if (returnExisting && refused.body.error === 'DUPLICATE_PHONE') {
      const raced = await service.schema('app').rpc('find_customer_by_phone', { p_phone: phone });
      if (!raced.error && raced.data) return existingCustomer(service, String(raced.data));
    }
    const status = refused.body.error === 'DUPLICATE_PHONE' ? 409 : refused.status;
    return json(refused.body, status);
  }

  return json(nameOnly ? { id: userId, incomplete: true, customer: data } : { id: userId, customer: data }, 201);
}));

/**
 * 0448: the number that completes a customer the desk saved by name alone.
 * Every rule is app.desk_complete_customer's; a number that already has its
 * customer answers 409 with that customer, so the screen can offer them.
 */
async function completeCustomer(
  service: ReturnType<typeof createServiceClient>,
  customerId: string,
  phone: string,
  actorId: string,
): Promise<Response> {
  const { data, error } = await service.schema('app').rpc('desk_complete_customer', {
    p_customer_id: customerId,
    p_phone: phone,
    p_actor_id: actorId,
  });
  if (!error) return json({ id: customerId, completed: true, customer: data }, 200);
  const refused = pgErrorBody(error, 'desk-customer-create');
  if (refused.body.error === 'DUPLICATE_PHONE') {
    const holder = await service.schema('app').rpc('find_customer_by_phone', { p_phone: phone });
    if (!holder.error && holder.data) {
      const brief = await service.from('profiles').select('id, full_name, phone, gender').eq('id', String(holder.data)).maybeSingle();
      return json(
        { error: 'DUPLICATE_PHONE', message: DUPLICATE_MESSAGE.DUPLICATE_PHONE, id: holder.data, customer: brief.error ? null : brief.data },
        409,
      );
    }
    return json({ error: 'DUPLICATE_PHONE', message: DUPLICATE_MESSAGE.DUPLICATE_PHONE }, 409);
  }
  const status = refused.body.error === 'CUSTOMER_NOT_INCOMPLETE' ? 409 : refused.status;
  return json(refused.body, status);
}

/** 0448: the account that already holds the number, as the 201 describes a new one. */
async function existingCustomer(service: ReturnType<typeof createServiceClient>, id: string): Promise<Response> {
  const { data, error } = await service
    .from('profiles')
    .select('id, full_name, phone, gender')
    .eq('id', id)
    .maybeSingle();
  if (error) {
    logError('desk-customer-create', error, 'existing customer read');
    return json({ error: 'INTERNAL' }, 500);
  }
  const customer: CustomerBrief = {
    id,
    full_name: (data?.full_name as string | null) ?? null,
    phone: (data?.phone as string | null) ?? null,
    gender: (data?.gender as string | null) ?? null,
  };
  // Whether a person has ever signed in to it. Unreadable counts as claimed:
  // the careful answer for the one caller that reads it (the lesson screens).
  const user = await service.auth.admin.getUserById(id);
  const claimed = Boolean(user.error) || !user.data?.user || Boolean(user.data.user.last_sign_in_at);
  return json({ id, existing: true, claimed, customer }, 200);
}
