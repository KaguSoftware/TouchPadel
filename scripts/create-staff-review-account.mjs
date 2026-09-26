/**
 * App Store / Play review: provision the reviewer's STAFF account on the hosted
 * project the store build points at (eas.json production → lczijabnorujcgmbuqlw),
 * so the reviewer can see the staff area of the app (Apple 2.1: every feature
 * must be reviewable). The guest account is scripts/create-review-account.mjs.
 *
 * The account is a DRIVER at the real venue (plan §9, contracts §8.3 item 12):
 * after 0157 the driver is the role with the least access — no prices, no order
 * lines, no other person's data. It sees the venue's real shopping list and
 * records its own purchases, so anything the reviewer records reaches the
 * manager like any driver's work. Tell the manager.
 *
 * It is made the way the operator's Staff page makes one (staff-admin):
 *
 *   1. auth.users row   Auth admin API, email confirmed (staff sign in with
 *                       email + password only, contracts §6.6)
 *   2. staff row        app.register_staff (0051), which audits the creation in
 *                       the owner's name; the 0123 trigger files the membership
 *                       at the venue (never written by hand here)
 *
 * The password is generated at run time and printed ONCE. It is never
 * committed. Tagged `app_metadata.app_review_staff = true`, which only the
 * service role can write: user_metadata is the account holder's own to edit
 * (auth.updateUser), so a guest could tag themselves and be made staff. A
 * re-run finds the account by that tag AND its email (the default, or --email
 * on every run), refuses when more than one account carries the tag, and never
 * promotes an account this script did not create. Idempotent: a re-run reuses
 * the account, sets a NEW password and switches it back on if --deactivate
 * switched it off.
 *
 * --deactivate, after the decision: the account is switched off the way a
 * leaver's is (app.set_staff_active, 0081 + staff_push) — staff row inactive,
 * PIN cleared, push token cleared — and banned in Auth so neither a refresh nor
 * a new sign-in works, with one audit row in the owner's name. It is kept, not
 * deleted, so its records keep their name. (set_staff_active itself needs an
 * owner's session, which a service-role script does not have.)
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment, falling
 * back to apps/web/.env.local (same as create-review-account.mjs). The owner
 * named in the audit rows is the only active owner, or --actor <staff id>.
 *
 *   node scripts/create-staff-review-account.mjs                        # create / refresh
 *   node scripts/create-staff-review-account.mjs --email you@example.com  # another email (then on every run)
 *   node scripts/create-staff-review-account.mjs --actor <owner staff id> # when there is more than one owner
 *   node scripts/create-staff-review-account.mjs --deactivate           # after the decision
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const DISPLAY_NAME = 'App Review';
const ROLE = 'driver';
const DEFAULT_EMAIL = 'app-review-driver@touch-padel.com';
/** The app_metadata key that marks the account. Never user_metadata (see the header). */
const TAG = 'app_review_staff';
/** A ban GoTrue keeps until someone lifts it (a re-run of this script does). */
const BAN = '876000h';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

function envFromFile(url) {
  const out = {};
  if (!existsSync(url)) return out;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

const fileEnv = envFromFile(new URL('../apps/web/.env.local', import.meta.url));
const URL_ = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or put them in apps/web/.env.local)');
}

async function call(path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${URL_}${path}`, {
    method,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${token ?? KEY}`,
      'Content-Type': 'application/json',
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = text;
  }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}: ${text}`);
    err.body = json;
    throw err;
  }
  return json;
}

/** app.* RPC, as the service role unless a token is given. */
const appRpc = (name, params, token) =>
  call(`/rest/v1/rpc/${name}`, { method: 'POST', body: params, token, headers: { 'Content-Profile': 'app' } });

/** Unambiguous characters only: the reviewer types this by hand. 10-72 is the staff range. */
function makePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

const EMAIL = (option('--email') ?? DEFAULT_EMAIL).trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(EMAIL)) throw new Error(`--email is not an email address: ${EMAIL}`);

/** Every auth user carrying the tag. All pages: two tagged accounts must be seen to be refused. */
async function taggedUsers() {
  const out = [];
  for (let page = 1; page <= 500; page++) {
    const { users } = await call(`/auth/v1/admin/users?page=${page}&per_page=200`);
    out.push(...users.filter((u) => u.app_metadata?.[TAG] === true));
    if (users.length < 200) return out;
  }
  throw new Error('More than 100000 auth users: cannot be sure only one carries the review tag.');
}

/** The review account: the one tagged account, and only when its email is the one asked for. */
async function findReviewUser() {
  const tagged = await taggedUsers();
  if (tagged.length > 1) {
    throw new Error(
      `${tagged.length} accounts carry app_metadata.${TAG}; there must be one. Nothing was changed.\n` +
        tagged.map((u) => `  ${u.id}  ${u.email ?? '(no email)'}`).join('\n'),
    );
  }
  const [user] = tagged;
  if (!user) return null;
  if ((user.email ?? '').toLowerCase() !== EMAIL) {
    throw new Error(`The staff review account is ${user.email}, not ${EMAIL}. Pass --email ${user.email}.`);
  }
  return user;
}

/** The owner the audit rows name: --actor, else the one active owner. */
async function actorId() {
  const chosen = option('--actor');
  const owners = await call('/rest/v1/staff?select=id,display_name&role=eq.owner&is_active=eq.true');
  if (chosen) {
    if (!owners.some((o) => o.id === chosen)) throw new Error(`--actor ${chosen} is not an active owner`);
    return chosen;
  }
  if (owners.length !== 1) {
    throw new Error(
      `${owners.length} active owners: pass --actor <staff id> to name who runs this.\n` +
        owners.map((o) => `  ${o.id}  ${o.display_name}`).join('\n'),
    );
  }
  return owners[0].id;
}

async function staffRow(id) {
  const rows = await call(`/rest/v1/staff?select=id,role,is_active&id=eq.${id}`);
  return rows[0] ?? null;
}

/** One audit row in the owner's name, the shape set_staff_active writes (0081). */
async function auditActive(id, actor, before, after) {
  await call('/rest/v1/audit_log', {
    method: 'POST',
    headers: { Prefer: 'return=minimal' },
    body: {
      actor_id: actor,
      actor_role: 'owner',
      action: 'staff.active_set',
      entity: 'staff',
      entity_id: id,
      before: { is_active: before },
      after: { is_active: after },
      reason_code: 'app_review',
    },
  });
}

async function signInAs(email, password) {
  const session = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { email, password },
  });
  return session.access_token;
}

console.log(`Project: ${URL_}\n`);
let user = await findReviewUser();

// ── --deactivate: switch it off like a leaver, and ban it in Auth ─────────────
if (flag('--deactivate')) {
  if (!user) {
    console.log('No staff review account found. Nothing to switch off.');
    process.exit(0);
  }
  const actor = await actorId();
  const row = await staffRow(user.id);
  // A fresh unknown password as well as the ban: the printed one stops working
  // even if someone lifts the ban by hand.
  await call(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: { ban_duration: BAN, password: makePassword(24) },
  });
  if (row?.is_active) {
    await call(`/rest/v1/staff?id=eq.${user.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: { is_active: false, pin_hash: null },
    });
    await auditActive(user.id, actor, true, false);
  }
  await call(`/rest/v1/profiles?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: { expo_push_token: null },
  });
  console.log(`Switched off staff review account ${user.email} (${user.id}).`);
  console.log('Its records keep their name; it can no longer sign in. The Staff page shows it as switched off.');
  process.exit(0);
}

// ── Create or refresh ─────────────────────────────────────────────────────────
const actor = await actorId();
const password = makePassword();
const email = EMAIL;
/** True only when this run made the auth user; nothing else is ever promoted. */
let created = false;
if (user) {
  console.log(`Staff review account already exists (${email}). Setting a new password.`);
  await call(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: { password, email_confirm: true, ban_duration: 'none' },
  });
} else {
  console.log(`Creating staff review account ${email} ...`);
  try {
    user = await call('/auth/v1/admin/users', {
      method: 'POST',
      body: {
        email,
        password,
        email_confirm: true,
        app_metadata: { [TAG]: true },
        user_metadata: { full_name: DISPLAY_NAME, preferred_lang: 'en' },
      },
    });
  } catch (err) {
    if (err.body?.error_code === 'email_exists') {
      throw new Error(
        `An account with ${email} already exists and this script did not make it (no app_metadata.${TAG}). ` +
          'It is not made staff and nothing was changed. Choose another --email, or check that account in the dashboard.',
      );
    }
    throw err;
  }
  created = true;
}

const row = await staffRow(user.id);
if (!row) {
  // Belt and braces: findReviewUser only returns a tagged account, and the
  // account created above carries the tag.
  if (!created && user.app_metadata?.[TAG] !== true) {
    throw new Error(`Refusing to make ${email} staff: this script did not create it.`);
  }
  try {
    await appRpc('register_staff', {
      p_staff_id: user.id,
      p_display_name: DISPLAY_NAME,
      p_role: ROLE,
      p_actor_id: actor,
    });
  } catch (err) {
    // An auth user with no staff row signs in and is told it is not staff:
    // roll back the one this run created, as staff-admin does.
    if (created) await call(`/auth/v1/admin/users/${user.id}`, { method: 'DELETE' }).catch(() => undefined);
    throw err;
  }
} else if (row.role !== ROLE) {
  throw new Error(`The account ${email} is a ${row.role}, not a ${ROLE}. Change it on the Staff page, then re-run.`);
} else if (!row.is_active) {
  await call(`/rest/v1/staff?id=eq.${user.id}`, {
    method: 'PATCH',
    headers: { Prefer: 'return=minimal' },
    body: { is_active: true },
  });
  await auditActive(user.id, actor, false, true);
  console.log('Switched it back on.');
}

const token = await signInAs(email, password);
const role = await appRpc('staff_role', {}, token);
if (role !== ROLE) throw new Error(`Signed in, but app.staff_role() says ${JSON.stringify(role)}, not ${ROLE}.`);
console.log(`Signed in with email + password as ${ROLE}: OK`);

const venues = await appRpc('staff_venue_ids', {}, token);
const names = venues.length
  ? await call(`/rest/v1/venues?select=id,name_en&id=in.(${venues.join(',')})`).catch(() => [])
  : [];
const at = names.length ? names.map((v) => v.name_en ?? v.id).join(', ') : venues.join(', ') || 'no venue';

console.log(`
Staff review account ready (${ROLE} at ${at}). Paste into the review notes, STAFF AREA
(docs/store/app-store-submission.md §5):

  Email:    ${email}
  Password: ${password}

In the app: sign out of the guest account, then sign in with email and password.
This password is not stored anywhere. Re-running this script sets a new one.
Tell the manager: shopping purchases by "${DISPLAY_NAME}" are test entries.
After the decision: node scripts/create-staff-review-account.mjs --deactivate`);
