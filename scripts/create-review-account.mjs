/**
 * App Store / Play review: provision the reviewer's GUEST account on the hosted
 * project the store build points at (eas.json production → lczijabnorujcgmbuqlw).
 *
 * The reviewer cannot receive a WhatsApp code, and the app signs a phone
 * account in with a ONE-TIME CODE, not a password (apps/mobile/app/sign-in.tsx,
 * owner 2026-10-11). So the owner adds a fixed test code for the printed number
 * in Supabase (hosted) → Authentication → Sign In / Providers → Phone → Test
 * phone numbers and OTPs, and the reviewer types that code: no message is sent
 * (docs/store/app-store-submission.md §0 item 3a). This script creates:
 *
 *   1. auth.users row   Auth admin API, phone confirmed, user_metadata the same
 *                       shape signUpWithPhone sends (app.handle_new_user reads it)
 *   2. a future booking signed in AS the reviewer, through the app's own RPCs
 *                       (hold_slot → confirm_booking), ~60 days out so it is
 *                       still upcoming through a re-review — My Bookings is
 *                       not empty and the cancel flow is reachable
 *
 * The account also gets a random password, used ONLY by this script to sign in
 * as the reviewer and book through the RPCs. It is never given to Apple and the
 * app has no phone + password sign-in. The number is generated at run time and
 * printed ONCE; it is never committed: the store-review pair in
 * supabase/config.toml is public, and the security audit (M8) refuses it on
 * hosted.
 *
 * Tagged `user_metadata.app_review = true`, which is how re-runs find it.
 * Idempotent: a re-run reuses the account and only books if there is no
 * upcoming booking.
 *
 * Open matches (docs/design/open-matches/guest.md §4.26, DF-19). Version 1.1.0
 * has no online payment and no tickets: open-match seats are paid at the desk
 * (0370/0371), so nothing below involves Qi.
 *   --sandbox  sets `profiles.payment_sandbox = true` on the account, so it only
 *              ever sees and joins sandbox matches, which never book a real
 *              court. (The name is from when it also meant Qi's sandbox.) The
 *              0259 guard refuses the flip while the account holds live tickets.
 *   --partner  works on a SECOND account, "Review Partner" (tagged
 *              `user_metadata.app_review_partner = true`), instead of the
 *              reviewer's. The owner signs in as it on a test phone (its own
 *              test code) and starts the public, open-join sandbox match
 *              "Me + 1" the reviewer joins. Its login never goes to Apple.
 * So the owner runs this twice before submitting: once as below with
 * `--sandbox`, once with `--partner --sandbox --no-booking`.
 *
 * Reads SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY from the environment, falling
 * back to scripts/.env.local (same as create-operator-owner.mjs).
 *
 *   node scripts/create-review-account.mjs                 # create / refresh
 *   node scripts/create-review-account.mjs --phone +9647...  # choose the number (first run only)
 *   node scripts/create-review-account.mjs --no-booking    # account only
 *   node scripts/create-review-account.mjs --sandbox       # sandbox matches only (open matches)
 *   node scripts/create-review-account.mjs --partner ...   # the same, for the partner account
 *   node scripts/create-review-account.mjs --delete        # after approval: cancel + delete
 *
 * Tell the desk: bookings under "App Review" are test bookings.
 */
import { existsSync, readFileSync } from 'node:fs';
import { randomInt } from 'node:crypto';

const BOOK_DAYS_AHEAD = 60;
/** Quiet afternoon starts first, venue-local (Baghdad, UTC+3, no DST). */
const CANDIDATE_HOURS = [14, 15, 13, 16, 12, 11];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

/** Which of the two accounts this run is about, and how it is tagged and named. */
const PARTNER = flag('--partner');
const ACCOUNT = PARTNER
  ? { tag: 'app_review_partner', name: 'Review Partner', given: 'Review', family: 'Partner', label: 'Partner account' }
  : { tag: 'app_review', name: 'App Review', given: 'App', family: 'Review', label: 'Review account' };

function envFromFile(url) {
  const out = {};
  if (!existsSync(url)) return out;
  for (const line of readFileSync(url, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

// Not apps/web/.env.local: the service-role key never reaches the web package
// (apps/web/CLAUDE.md, "Data"). scripts/.env.local is git-ignored (`.env.*`).
const fileEnv = envFromFile(new URL('./.env.local', import.meta.url));
const URL_ = process.env.SUPABASE_URL ?? fileEnv.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? fileEnv.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !KEY) {
  throw new Error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or put them in scripts/.env.local)');
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

/** app.* RPC as the signed-in reviewer (schema app is exposed; the mobile app calls it the same way). */
const appRpc = (name, params, token) =>
  call(`/rest/v1/rpc/${name}`, { method: 'POST', body: params, token, headers: { 'Content-Profile': 'app' } });

/** Unambiguous characters only: the reviewer types this by hand. */
function makePassword(length = 14) {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[randomInt(alphabet.length)];
  return out;
}

/** Iraqi mobile in the 0770 000 xxxx block the local test number already uses. */
function makePhone() {
  return `+9647700${String(randomInt(100000, 1000000))}`;
}

async function findReviewUser() {
  for (let page = 1; page < 50; page++) {
    const { users } = await call(`/auth/v1/admin/users?page=${page}&per_page=200`);
    const hit = users.find((u) => u.user_metadata?.[ACCOUNT.tag] === true);
    if (hit) return hit;
    if (users.length < 200) return null;
  }
  return null;
}

async function signInAs(phone, password) {
  const session = await call('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: { phone, password },
  });
  return session.access_token;
}

/**
 * `profiles.payment_sandbox = true` (0241), with the service role. The column has no
 * RPC: it is the owner's switch. A flip while the account holds live tickets is refused
 * by the 0259 guard (`INVALID_TRANSITION`, detail `live_tickets`); that account needs its
 * tickets used or cashed out first, or a fresh account.
 */
async function setPaymentSandbox(userId) {
  try {
    const rows = await call(`/rest/v1/profiles?id=eq.${userId}&select=id,payment_sandbox`, {
      method: 'PATCH',
      body: { payment_sandbox: true },
      headers: { Prefer: 'return=representation' },
    });
    if (!Array.isArray(rows) || rows[0]?.payment_sandbox !== true) {
      throw new Error(`no profile row for ${userId}`);
    }
  } catch (err) {
    if (/INVALID_TRANSITION/.test(err.message)) {
      throw new Error(
        'This account holds live open-match tickets, so it cannot move to the sandbox. ' +
          'Use or cash out its tickets first, or delete it (--delete) and run again.',
      );
    }
    throw err;
  }
}

async function upcomingBookings(token) {
  const now = new Date().toISOString();
  return call(
    `/rest/v1/reservations?select=id,status,start_at,court_id&status=in.(confirmed,held)&start_at=gt.${encodeURIComponent(now)}&order=start_at`,
    { token },
  );
}

function baghdadDate(daysAhead) {
  const d = new Date(Date.now() + 3 * 3600_000 + daysAhead * 86400_000);
  return d.toISOString().slice(0, 10);
}

async function seedBooking(token) {
  const courts = await call('/rest/v1/courts?select=id,name_en,duration_options,sort_order&is_active=eq.true&order=sort_order');
  if (!courts.length) throw new Error('No active courts on this project.');
  const failures = new Map();
  for (let day = BOOK_DAYS_AHEAD; day < BOOK_DAYS_AHEAD + 14; day++) {
    const date = baghdadDate(day);
    for (const hour of CANDIDATE_HOURS) {
      // Last court first: leave Court 1, the one guests reach for, alone.
      for (const court of [...courts].reverse()) {
        const duration = court.duration_options?.includes(60) ? 60 : court.duration_options?.[0];
        const startAt = new Date(`${date}T${String(hour).padStart(2, '0')}:00:00+03:00`);
        try {
          const hold = await appRpc(
            'hold_slot',
            { p_court_id: court.id, p_start_at: startAt.toISOString(), p_duration_min: duration },
            token,
          );
          const confirmed = await appRpc('confirm_booking', { p_hold_id: hold.reservation_id }, token);
          return { court: court.name_en, startAt, duration, id: confirmed.reservation_id ?? hold.reservation_id };
        } catch (err) {
          const code = /"message"\s*:\s*"([A-Z_]+)"/.exec(err.message)?.[1] ?? 'ERROR';
          failures.set(code, (failures.get(code) ?? 0) + 1);
          // Anything but "this slot is not bookable" is a real problem: stop.
          if (!['SLOT_TAKEN', 'NO_RATE', 'OUTSIDE_HOURS', 'CLOSED_DATE'].includes(code)) throw err;
        }
      }
    }
  }
  throw new Error(`No bookable slot found ${BOOK_DAYS_AHEAD}-${BOOK_DAYS_AHEAD + 14} days out: ${JSON.stringify([...failures])}`);
}

console.log(`Project: ${URL_}\n`);
let user = await findReviewUser();

// ── --delete: cancel upcoming bookings, then the app's own deletion path ────
if (flag('--delete')) {
  if (!user) {
    console.log(`No ${ACCOUNT.label.toLowerCase()} found. Nothing to delete.`);
    process.exit(0);
  }
  const password = makePassword(24);
  await call(`/auth/v1/admin/users/${user.id}`, { method: 'PUT', body: { password } });
  const token = await signInAs(`+${user.phone}`, password);
  for (const r of await upcomingBookings(token)) {
    const rpc = r.status === 'held' ? 'release_hold' : 'cancel_reservation';
    await appRpc(rpc, { p_reservation_id: r.id }, token);
    console.log(`  ${rpc} ${r.id} (${r.start_at})`);
  }
  // Its open matches and unused tickets are the deletion's own business (DF-20).
  await appRpc('delete_my_account', { p_confirm: 'DELETE' }, token);
  console.log(`\nDeleted ${ACCOUNT.label.toLowerCase()} +${user.phone} (${user.id}).`);
  process.exit(0);
}

// ── Create or refresh ───────────────────────────────────────────────────────
const password = makePassword();
let phone;
if (user) {
  phone = `+${user.phone}`;
  console.log(`${ACCOUNT.label} already exists (${phone}). Setting a new password.`);
  user = await call(`/auth/v1/admin/users/${user.id}`, {
    method: 'PUT',
    body: { password, phone_confirm: true },
  });
} else {
  phone = option('--phone') ?? makePhone();
  if (!/^\+964\d{10}$/.test(phone)) throw new Error(`--phone must look like +9647XXXXXXXXX, got ${phone}`);
  console.log(`Creating ${ACCOUNT.label.toLowerCase()} ${phone} ...`);
  user = await call('/auth/v1/admin/users', {
    method: 'POST',
    body: {
      phone,
      password,
      phone_confirm: true,
      user_metadata: {
        [ACCOUNT.tag]: true,
        full_name: ACCOUNT.name,
        given_name: ACCOUNT.given,
        family_name: ACCOUNT.family,
        phone,
        preferred_lang: 'en',
      },
    },
  });
}

const token = await signInAs(phone, password);
console.log('Signed in (script only) and ready: OK');

if (flag('--sandbox')) {
  await setPaymentSandbox(user.id);
  console.log('Sandbox profile (profiles.payment_sandbox): ON');
}

let booking = null;
if (!flag('--no-booking')) {
  const upcoming = await upcomingBookings(token);
  if (upcoming.length) {
    console.log(`Upcoming booking already there: ${upcoming[0].start_at}`);
  } else {
    booking = await seedBooking(token);
    console.log(`Booked ${booking.court}, ${booking.startAt.toISOString()} (${booking.duration} min)`);
  }
}

const national = phone.replace(/^\+964/, '');
const where = PARTNER
  ? 'Sign in as it on a test phone and start the partner match (never give it to Apple):'
  : 'Paste into App Store Connect → App Review Information → Sign-in required:';
console.log(`
${ACCOUNT.label} ready. ${where}

  User name: ${phone}
  Password:  <the six-digit test code you set for ${phone.replace(/^\+/, '')} in Supabase>

Set that code first: Supabase → Authentication → Sign In / Providers → Phone →
Test phone numbers and OTPs (digits without '+'). The app signs in with a code,
not a password: country Iraq (+964), phone ${national}, then the code.
${booking ? `\nTell the desk: "${ACCOUNT.name}" has a test booking on ${booking.court}, ${booking.startAt.toISOString()}.` : ''}`);
