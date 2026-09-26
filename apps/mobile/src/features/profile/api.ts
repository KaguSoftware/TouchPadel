import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@touch/db';
import type { Locale } from '@touch/i18n';

type Client = SupabaseClient<Database>;

/**
 * expo_push_token is deliberately ABSENT. Migration 0077 narrowed the profiles
 * SELECT grant to exclude it (SEC-21) — the column is write-only to clients now,
 * exactly as staff.pin_hash is — so selecting it here would fail with
 * `permission denied`. No consumer ever read the value; only registerPushToken
 * writes it.
 */
export interface ProfileRow {
  id: string;
  full_name: string;
  phone: string | null;
  preferred_lang: string;
}

export async function fetchOwnProfile(client: Client): Promise<ProfileRow | null> {
  const { data: userData } = await client.auth.getUser();
  const uid = userData.user?.id;
  if (!uid) return null;
  const { data, error } = await client
    .from('profiles')
    .select('id, full_name, phone, preferred_lang')
    .eq('id', uid)
    .maybeSingle();
  if (error) throw error;
  return data as ProfileRow | null;
}

export async function updatePreferredLang(client: Client, uid: string, lang: Locale) {
  const { error } = await client.from('profiles').update({ preferred_lang: lang }).eq('id', uid);
  if (error) throw error;
}

export async function updatePushToken(client: Client, uid: string, token: string) {
  const { error } = await client.from('profiles').update({ expo_push_token: token }).eq('id', uid);
  if (error) throw error;
}

/**
 * SEC-21 — drop the push token when this device stops being the guest's.
 *
 * The token is a live capability: whoever holds it can push a notification to
 * this handset. Leaving it on the row after sign-out means the next person to
 * use the phone keeps receiving the previous guest's booking reminders, and the
 * row still names a device that is no longer theirs.
 *
 * Never throws. A failure here must not strand somebody in a signed-in state —
 * the sign-out itself is the thing that has to happen.
 */
export async function clearPushToken(client: Client, uid: string): Promise<void> {
  try {
    await client.from('profiles').update({ expo_push_token: null }).eq('id', uid);
  } catch {
    /* best effort: sign-out proceeds regardless */
  }
}

/**
 * Settings > "Send a test notification": app.send_test_push (migration 0070)
 * queues a real push for the caller's own token and nudges the sender. Raises
 * NO_PUSH_TOKEN / RATE_LIMITED / AUTH_REQUIRED as P0001 — mapped by the screen.
 */
export async function sendTestPush(client: Client): Promise<{ queued: boolean; id: number }> {
  const { data, error } = await client.schema('app').rpc('send_test_push');
  if (error) throw error;
  return data as { queued: boolean; id: number };
}

/** Own contact details (design 2026-08-31: Edit profile). RLS: own row only. */
export async function updateOwnProfile(
  client: Client,
  uid: string,
  fields: { full_name?: string; phone?: string | null; preferred_lang?: Locale },
) {
  const { error } = await client.from('profiles').update(fields).eq('id', uid);
  if (error) throw error;
}

/**
 * Both stores require account deletion to be reachable from INSIDE the app.
 * app.delete_my_account (migration 0077) does the whole thing server-side:
 * it anonymises the profile, scrubs the identity off the bookings, deletes the
 * staff notes and queued pushes, and destroys the auth user — which cascades
 * every session and refresh token, so this is also the global sign-out.
 *
 * The confirmation token is required by the RPC and is deliberately not
 * optional here: it is what stops a bare zero-argument call — a stray retry, a
 * mis-wired button — from spending somebody's account.
 *
 * Errors arrive as P0001 message codes:
 *   ACCOUNT_REQUIRED       an anonymous cafe session has no account to delete
 *   FORBIDDEN              a staff account: those are deactivated, not deleted
 *   ALREADY_DELETED        the tombstone is already stamped
 *   CONFIRMATION_REQUIRED  should be unreachable from this function
 *
 * `apple_revoke_pending` comes back true whenever the account carried a Sign in
 * with Apple identity. The RPC has no way to know that revokeAppleAuthorization
 * (below) already ran, so its audit row says pending for every Apple account;
 * the deletion flow (deletion.ts) revokes BEFORE this call, while the session
 * JWT that apple-revoke authenticates with still exists.
 */
export async function deleteAccount(
  client: Client,
): Promise<{ deleted: boolean; apple_revoke_pending: boolean }> {
  const { data, error } = await client
    .schema('app')
    .rpc('delete_my_account', { p_confirm: 'DELETE' });
  if (error) throw error;

  // The server-side session is already gone with the auth user, so a normal
  // signOut() would post to /logout with a token GoTrue no longer knows and
  // fail. 'local' just clears the stored session, which is all that is left.
  await client.auth.signOut({ scope: 'local' });

  return data as { deleted: boolean; apple_revoke_pending: boolean };
}

/**
 * Sign in with Apple token revocation (App Store Guideline 5.1.1(v)). Posts a
 * fresh authorizationCode to the apple-revoke edge function, which exchanges it
 * with Apple and revokes the grant. MUST run before deleteAccount: the function
 * authenticates with the session JWT that dies with the account.
 *
 * Throws on any non-2xx (501 NOT_CONFIGURED, 502 APPLE_*, network). The thrown
 * message names the function's error code when the body can be read — for
 * telemetry only; it never contains the code sent.
 */
export async function revokeAppleAuthorization(client: Client, authorizationCode: string): Promise<void> {
  const { data, error } = await client.functions.invoke<{ revoked?: boolean }>('apple-revoke', {
    body: { authorizationCode },
  });
  if (error) {
    let code: string | null = null;
    // FunctionsHttpError carries the raw Response as `context`.
    const context = (error as { context?: { json?: () => Promise<unknown> } }).context;
    if (context && typeof context.json === 'function') {
      try {
        const body = (await context.json()) as { error?: unknown } | null;
        if (body && typeof body.error === 'string') code = body.error;
      } catch {
        // not JSON — keep the client's message
      }
    }
    throw new Error(`apple-revoke failed: ${code ?? error.message}`); // QUIET-ERROR-OK: caught in deletion.ts, sent to captureException only, never rendered
  }
  if (!data?.revoked) throw new Error('apple-revoke failed: no revoked flag');
}

/** Change password for the signed-in guest (design 2026-08-31). */
export async function changePassword(client: Client, newPassword: string) {
  const { error } = await client.auth.updateUser({ password: newPassword });
  if (error) throw error;
}
