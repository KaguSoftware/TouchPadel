/**
 * apple-revoke — Apple's half of account deletion (App Store Review Guideline
 * 5.1.1(v)): revoke the user's Sign in with Apple grant BEFORE their account is
 * deleted.
 *
 *   POST { authorizationCode }   (Authorization: Bearer <the guest's session JWT>)
 *     -> 200 { revoked: true, tokenTypeHint, identityMatched }
 *     -> 400 { error: 'BAD_REQUEST' }
 *     -> 401 { error: 'AUTH_REQUIRED' }
 *     -> 405 { error: 'METHOD_NOT_ALLOWED' }
 *     -> 409 { error: 'APPLE_IDENTITY_MISMATCH' }       the code belonged to a different Apple ID
 *     -> 500 { error: 'APPLE_KEY_INVALID' }             the .p8 secret will not import / sign
 *     -> 501 { error: 'NOT_CONFIGURED', missing }       one of the four secrets is unset
 *     -> 502 { error: 'APPLE_TOKEN_EXCHANGE_FAILED' | 'APPLE_REVOKE_FAILED', appleStatus, appleError }
 *
 * WHY THE DEVICE SENDS A FRESH CODE. Supabase's native Apple sign-in is an
 * id-token grant: it never receives a refresh token, so there is nothing stored
 * to revoke. The deletion flow (apps/mobile/app/delete-account.tsx ->
 * features/profile/deletion.ts) therefore re-runs the Apple sheet for a fresh
 * one-time `authorizationCode` and posts it here. This function (apple.ts):
 *
 *   1. signs a client-secret JWT — ES256 with the Sign in with Apple .p8 key,
 *      header { alg, kid: APPLE_KEY_ID }, claims { iss: APPLE_TEAM_ID, iat,
 *      exp: iat + 5 min, aud: https://appleid.apple.com, sub: APPLE_CLIENT_ID };
 *   2. POST https://appleid.apple.com/auth/token (grant_type=authorization_code)
 *      -> refresh_token (access_token when Apple returns no refresh token);
 *   3. POST https://appleid.apple.com/auth/revoke with that token and the
 *      matching token_type_hint. HTTP 200 = revoked.
 *
 * ORDER. This must run while the account still exists: the caller's JWT dies
 * with app.delete_my_account (0077), and verify_jwt = true (config.toml) plus
 * getCallerUserId below refuse anything else. Only a signed-in user can spend a
 * code here, and the id_token's `sub` is compared with that user's own Apple
 * identity so a code from some other Apple ID is reported rather than counted.
 *
 * DELETION IS NEVER HELD HOSTAGE. Any non-2xx here (including 501 while the
 * secrets are unset) and the app deletes the account anyway. app.delete_my_account
 * has no parameter for "revocation succeeded", so its audit row keeps recording
 * `apple_revoke_pending: true` for every account that carried an Apple identity,
 * whether or not this call succeeded; the success is visible in this function's
 * logs (`[apple-revoke] revoked`) and in the app's account.delete breadcrumb.
 *
 *   select count(*) from audit_log
 *    where action = 'account.delete' and (after->>'apple_revoke_pending')::bool;
 *
 * NEVER LOGGED OR ECHOED: the authorizationCode, the client secret, the tokens,
 * the key. Apple's short `error` token (e.g. invalid_grant) is.
 *
 * SECRETS (hosted: `pnpm exec supabase secrets set NAME=value`):
 *   APPLE_TEAM_ID         10-character Team ID            BR42V976FS
 *   APPLE_KEY_ID          10-character Key ID of the Sign in with Apple key
 *   APPLE_CLIENT_ID       the native app's bundle id      com.kagu.touchpadel
 *   APPLE_PRIVATE_KEY_P8  the whole AuthKey_<KEYID>.p8 including the BEGIN/END
 *                         lines; real newlines or literal \n both accepted
 *
 * DEPLOY: `pnpm exec supabase functions deploy apple-revoke` (from packages/db;
 * config.toml already pins verify_jwt = true for it).
 *
 * covered by packages/db/tests/apple-revoke.test.ts
 */
import { createServiceClient, getCallerUserId } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';
import { appleConfigFromEnv, missingSecrets, revokeWithAuthorizationCode } from './apple.ts';

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const service = createServiceClient();
  const userId = await getCallerUserId(req, service);
  if (!userId) return json({ error: 'AUTH_REQUIRED' }, 401);

  let body: { authorizationCode?: unknown };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'expected a JSON body' }, 400);
  }
  const authorizationCode = typeof body.authorizationCode === 'string' ? body.authorizationCode.trim() : '';
  if (!authorizationCode) {
    return json({ error: 'BAD_REQUEST', message: 'authorizationCode is required' }, 400);
  }

  const config = appleConfigFromEnv(Deno.env);
  if (!config) {
    const missing = missingSecrets(Deno.env);
    // Reported rather than swallowed: the caller must be able to tell "Apple was
    // revoked" from "Apple was never asked".
    return json(
      {
        error: 'NOT_CONFIGURED',
        message:
          'Sign in with Apple token revocation is not configured. Missing: ' +
          `${missing.join(', ')}. Account deletion still proceeds; the audit row ` +
          'records apple_revoke_pending.',
        missing,
      },
      501,
    );
  }

  let result;
  try {
    result = await revokeWithAuthorizationCode({ config, authorizationCode, fetch: (url, init) => fetch(url, init) });
  } catch (err) {
    // Only signing can throw: the .p8 secret is malformed. Never echo it.
    console.error(`[apple-revoke] client secret signing failed: ${err instanceof Error ? err.name : 'error'}`);
    return json({ error: 'APPLE_KEY_INVALID', message: 'APPLE_PRIVATE_KEY_P8 could not be used to sign.' }, 500);
  }

  if (!result.ok) {
    console.warn(`[apple-revoke] ${result.code} status=${result.status ?? 'unreachable'} apple_error=${result.appleError ?? '-'}`);
    return json({ error: result.code, appleStatus: result.status, appleError: result.appleError }, 502);
  }

  // Did the code belong to THIS account's Apple identity? Best-effort: a lookup
  // failure leaves identityMatched null rather than failing a completed revoke.
  let identityMatched: boolean | null = null;
  if (result.sub) {
    const { data, error } = await service.auth.admin.getUserById(userId);
    if (!error && data.user) {
      const subs = (data.user.identities ?? [])
        .filter((i) => i.provider === 'apple')
        .map((i) => (i.identity_data?.sub as string | undefined) ?? i.id);
      identityMatched = subs.includes(result.sub);
    }
  }
  if (identityMatched === false) {
    // The token we just minted for that other Apple ID is revoked too, but this
    // account's own grant is not proven gone — say so.
    console.warn('[apple-revoke] APPLE_IDENTITY_MISMATCH');
    return json({ error: 'APPLE_IDENTITY_MISMATCH' }, 409);
  }

  console.log(`[apple-revoke] revoked token_type_hint=${result.tokenTypeHint} identity_matched=${identityMatched}`);
  return json({ revoked: true, tokenTypeHint: result.tokenTypeHint, identityMatched });
});
