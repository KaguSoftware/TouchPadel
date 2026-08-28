/**
 * staff-admin — create a staff account, and reset a staff password.
 *
 * SOW L234: "Staff accounts created and managed by the owner role", and L997
 * makes the role matrix a phase-acceptance condition. Everything about a staff
 * member that is only a row change lives in migration 0051 as an owner-gated
 * RPC. The two things here need the GoTrue **admin** API, which is service-role
 * only and therefore cannot be an RPC:
 *
 *   POST { action: 'create',         email, password, display_name, role }
 *   POST { action: 'reset_password', staff_id, password }
 *
 * WHY A PASSWORD AND NOT AN EMAIL INVITE. `inviteUserByEmail` needs working
 * SMTP, and the venue is a padel club in Iraq whose staff are onboarded in
 * person during training week (SOW L766). The owner sets an opening password
 * and hands it over; the staff member changes it from the sign-in screen. An
 * invite that lands in an inbox nobody checks is not onboarding.
 *
 * The caller must be an active OWNER — checked against the `staff` table by
 * `requireStaffRole`, not against a claim in the token.
 */
import { createServiceClient } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { json, mapPgError } from '../_shared/http.ts';

const ROLES = ['cashier', 'prep', 'court_desk', 'manager', 'owner'] as const;
type Role = (typeof ROLES)[number];

/** Long enough to be worth typing once, short enough to read aloud accurately. */
const MIN_PASSWORD = 10;
const MAX_PASSWORD = 72; // bcrypt truncates beyond this; refuse rather than silently cut.

interface CreateBody {
  action: 'create';
  email: string;
  password: string;
  display_name: string;
  role: Role;
}

interface ResetBody {
  action: 'reset_password';
  staff_id: string;
  password: string;
}

function badRequest(message: string): Response {
  return json({ error: 'BAD_REQUEST', message }, 400);
}

function validPassword(password: unknown): string | null {
  if (typeof password !== 'string') return null;
  if (password.length < MIN_PASSWORD || password.length > MAX_PASSWORD) return null;
  return password;
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const service = createServiceClient();
  const caller = await requireStaffRole(req, service, ['owner']);
  if (caller instanceof Response) return caller;

  let body: CreateBody | ResetBody;
  try {
    body = (await req.json()) as CreateBody | ResetBody;
  } catch {
    return badRequest('body must be JSON');
  }

  if (body?.action === 'create') {
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const displayName = typeof body.display_name === 'string' ? body.display_name.trim() : '';
    const role = body.role;
    const password = validPassword(body.password);

    if (!email.includes('@')) return badRequest('a valid email is required');
    if (!displayName) return badRequest('display_name is required');
    if (!ROLES.includes(role)) return badRequest(`role must be one of ${ROLES.join(', ')}`);
    if (!password) {
      return badRequest(`password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`);
    }

    // email_confirm: staff are onboarded in person, and there is no guarantee
    // the address can receive mail at all — an unconfirmed account simply
    // cannot sign in, which would look like a broken app on training day.
    const created = await service.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (created.error || !created.data.user) {
      const message = created.error?.message ?? 'could not create the account';
      // GoTrue says "already been registered" for a duplicate; that is an
      // ordinary owner mistake, not a server fault.
      const duplicate = /already/i.test(message);
      return json(
        { error: duplicate ? 'EMAIL_IN_USE' : 'INTERNAL', message },
        duplicate ? 409 : 500,
      );
    }

    const userId = created.data.user.id;
    const { data, error } = await service.schema('app').rpc('register_staff', {
      p_staff_id: userId,
      p_display_name: displayName,
      p_role: role,
      p_actor_id: caller.userId,
    });

    if (error) {
      // The auth user exists but has no staff row: it would be an account that
      // can sign in and then be told it is not staff. Roll it back rather than
      // leave that behind.
      await service.auth.admin.deleteUser(userId).catch(() => undefined);
      const mapped = mapPgError(error);
      return json({ error: mapped.code, message: mapped.message }, mapped.status);
    }

    return json({ result: 'created', staff: data }, 201);
  }

  if (body?.action === 'reset_password') {
    const staffId = typeof body.staff_id === 'string' ? body.staff_id : '';
    const password = validPassword(body.password);
    if (!staffId) return badRequest('staff_id is required');
    if (!password) {
      return badRequest(`password must be ${MIN_PASSWORD}-${MAX_PASSWORD} characters`);
    }

    // Only ever reset a password for someone who is actually staff here: the
    // service role can otherwise change ANY account in the project, guests
    // included.
    const { data: row, error: lookupError } = await service
      .from('staff')
      .select('id, display_name')
      .eq('id', staffId)
      .maybeSingle();
    if (lookupError) return json({ error: 'INTERNAL', message: lookupError.message }, 500);
    if (!row) return json({ error: 'STAFF_NOT_FOUND', message: 'no such staff member' }, 404);

    const updated = await service.auth.admin.updateUserById(staffId, { password });
    if (updated.error) {
      return json({ error: 'INTERNAL', message: updated.error.message }, 500);
    }

    // Audit the change, never the password. Not `write_audit_external`: that one
    // writes actor_id = null by design (right for Telegram, where the tapper is
    // not an auth user), and a password reset must name the owner who did it.
    await service.schema('app').rpc('audit_staff_password_reset', {
      p_staff_id: staffId,
      p_actor_id: caller.userId,
    });

    return json({ result: 'reset' }, 200);
  }

  return badRequest("action must be 'create' or 'reset_password'");
});
