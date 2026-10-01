/**
 * desk-customer-create — a walk-in gets a real guest account from the desk
 * (spec 06.10 CustomerCreateScreen; build plan §0 "Customer creation at the
 * desk creates a real guest account (auth user + profile) through a
 * staff-gated edge function, so the guest can later claim it").
 *
 *   POST { fullName, phone, email?, preferredLang: 'en' | 'ar' }  ->  201 { id }
 *
 * Errors (JSON `{ error, message }`):
 *   400 BAD_REQUEST      — body shape, name length, preferredLang
 *   400 INVALID_PHONE    — fewer than 7 or more than 15 digits once normalised
 *   409 DUPLICATE_PHONE  — a profile already carries the same number (canonical
 *                          form, 0065 app.phone_canon: 0770… ≡ +964770… ≡ ٠٧٧٠…)
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
 * not create them (build plan §1: /desk/customers/new is desk+manager+owner).
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { handle, json, KB, logError, pgErrorBody, readJsonBody } from '../_shared/http.ts';
import {
  isSyntheticEmail,
  isValidPhone,
  looksLikeEmail,
  MAX_PHONE_DIGITS,
  MIN_PHONE_DIGITS,
  syntheticEmail,
} from './phone.ts';

const LANGS = ['en', 'ar'] as const;
type Lang = (typeof LANGS)[number];

interface CreateBody {
  fullName: string;
  phone: string;
  email?: string | null;
  preferredLang: Lang;
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
  const caller = await requireStaffRole(req, service, ['court_desk', 'manager', 'owner']);
  if (caller instanceof Response) return caller;

  const read = await readJsonBody<CreateBody>(req, { maxBytes: MAX_BODY, badJson: () => badRequest('body must be JSON') });
  if (!read.ok) return read.response;
  const body = read.value;

  const fullName = typeof body?.fullName === 'string' ? body.fullName.trim() : '';
  const phone = typeof body?.phone === 'string' ? body.phone.trim() : '';
  const preferredLang = body?.preferredLang;
  const givenEmail =
    typeof body?.email === 'string' && body.email.trim() !== '' ? body.email.trim().toLowerCase() : null;

  if (!fullName || fullName.length > 80) return badRequest('fullName must be 1-80 characters');
  if (!LANGS.includes(preferredLang)) return badRequest(`preferredLang must be one of ${LANGS.join(', ')}`);
  if (!isValidPhone(phone)) {
    return json(
      {
        error: 'INVALID_PHONE',
        message: `phone must carry ${MIN_PHONE_DIGITS}-${MAX_PHONE_DIGITS} digits`,
      },
      400,
    );
  }
  if (givenEmail !== null && !looksLikeEmail(givenEmail)) return badRequest('email is not valid');

  // Refuse a duplicate BEFORE creating anything: a create-then-delete of an
  // auth user is a visible churn in the users list for an ordinary desk mistake.
  const dup = await service.schema('app').rpc('find_customer_by_phone', { p_phone: phone });
  if (dup.error) {
    const refused = pgErrorBody(dup.error, 'desk-customer-create');
    return json(refused.body, refused.status);
  }
  if (dup.data) {
    return json(
      { error: 'DUPLICATE_PHONE', message: DUPLICATE_MESSAGE.DUPLICATE_PHONE, id: dup.data },
      409,
    );
  }

  const email = givenEmail ?? syntheticEmail(phone);

  // user_metadata is what the 0058 signup trigger reads, so the profile row is
  // born complete; desk_register_customer then upserts the same three fields
  // so the outcome is identical even if the trigger ever ran without them.
  const created = await service.auth.admin.createUser({
    email,
    password: randomPassword(),
    email_confirm: true,
    user_metadata: { full_name: fullName, phone, preferred_lang: preferredLang, created_via: 'desk' },
  });
  if (created.error || !created.data.user) {
    const message = created.error?.message ?? 'could not create the account';
    // GoTrue says "already been registered" for a duplicate address. When the
    // address was synthesised from the phone, the collision IS a phone
    // collision (an earlier desk-created guest, possibly one who has since
    // cleared the phone from their profile), so name it as such.
    if (/already/i.test(message)) {
      const code = isSyntheticEmail(email) ? 'DUPLICATE_PHONE' : 'DUPLICATE_EMAIL';
      return json({ error: code, message: DUPLICATE_MESSAGE[code] }, 409);
    }
    logError('desk-customer-create', created.error ?? message, 'createUser failed');
    return json({ error: 'INTERNAL' }, 500);
  }

  const userId = created.data.user.id;
  const { data, error } = await service.schema('app').rpc('desk_register_customer', {
    p_customer_id: userId,
    p_full_name: fullName,
    p_phone: phone,
    p_preferred_lang: preferredLang,
    p_actor_id: caller.userId,
  });

  if (error) {
    // The auth user exists but the record was refused (a duplicate that raced
    // the pre-check, or a validation slip): roll the account back rather than
    // leave a guest who can sign in to an empty profile.
    // The admin API answers { error }, it does not throw: rollBackUser checks it.
    await rollBackUser(service, userId);
    const refused = pgErrorBody(error, 'desk-customer-create');
    const status = refused.body.error === 'DUPLICATE_PHONE' ? 409 : refused.status;
    return json(refused.body, status);
  }

  return json({ id: userId, customer: data }, 201);
}));
