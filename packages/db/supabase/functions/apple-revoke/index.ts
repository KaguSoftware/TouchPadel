/**
 * apple-revoke — Apple's half of account deletion. NOT IMPLEMENTED YET, on
 * purpose, and this file is the record of why.
 *
 *   POST { authorizationCode }  ->  200 { revoked: true }
 *                               ->  501 { error: 'NOT_CONFIGURED' }   ← today
 *
 * WHAT APPLE REQUIRES. An app that offers Sign in with Apple must call
 * POST https://appleid.apple.com/auth/revoke when the user deletes their
 * account. `auth.admin.deleteUser` does not do it, and neither does migration
 * 0077 — App Review rejects for this specifically, so it is a store blocker, not
 * a nicety (docs/design/social-signin-2026-09-01.md §306).
 *
 * WHY IT CANNOT BE WRITTEN YET. The id-token grant Supabase uses yields no
 * refresh token to revoke, so the deletion flow has to re-authenticate with
 * Apple for a fresh `authorizationCode`, exchange it for a token, and revoke
 * that — server-side, signing a client-secret JWT (ES256) with a Sign in with
 * Apple **.p8 key**. That key does not exist: it needs Apple Developer
 * enrolment, which is days of identity verification and is blocked on a human
 * (HANDOFF-security.md §4). Writing the signing and exchange now would mean
 * shipping a few hundred lines that have never once run against Apple.
 *
 * SO WHAT HAPPENS TODAY. Deletion is NOT held hostage to a missing credential —
 * a guest who asks to be deleted is deleted. app.delete_my_account (0077)
 * instead records `apple_revoke_pending: true` on its audit row whenever the
 * account carried an Apple identity, so the outstanding obligation is queryable
 * rather than merely remembered:
 *
 *   select count(*) from audit_log
 *    where action = 'account.delete' and (after->>'apple_revoke_pending')::bool;
 *
 * HOW THIS STOPS BEING FORGOTTEN. tests/apple-revoke.test.ts is armed, not
 * merely skipped: it goes RED the moment either the Apple secrets are configured
 * (someone has the key — finish the job) or an Apple identity appears in
 * auth.identities (a real user can now sign in with Apple, so the obligation is
 * live and being breached). Until one of those is true nothing is owed, and a
 * permanently red gate would only teach people to ignore it.
 *
 * TO FINISH IT: set APPLE_TEAM_ID, APPLE_KEY_ID, APPLE_CLIENT_ID and
 * APPLE_PRIVATE_KEY_P8, then replace the block below with — sign a client-secret
 * JWT (ES256, aud https://appleid.apple.com, iss = team id, sub = client id),
 * POST it with the authorizationCode to /auth/token, then POST the returned
 * refresh token to /auth/revoke with token_type_hint=refresh_token.
 */
import { createServiceClient, getCallerUserId } from '../_shared/supabase.ts';
import { json } from '../_shared/http.ts';

/** Every secret the real implementation needs. Absent = not configured. */
const REQUIRED_SECRETS = [
  'APPLE_TEAM_ID',
  'APPLE_KEY_ID',
  'APPLE_CLIENT_ID',
  'APPLE_PRIVATE_KEY_P8',
] as const;

export function missingSecrets(env: { get(k: string): string | undefined }): string[] {
  return REQUIRED_SECRETS.filter((k) => !(env.get(k) ?? '').trim());
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return json({ error: 'METHOD_NOT_ALLOWED' }, 405);

  const service = createServiceClient();
  const userId = await getCallerUserId(req, service);
  if (!userId) return json({ error: 'AUTH_REQUIRED' }, 401);

  let body: { authorizationCode?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'expected a JSON body' }, 400);
  }
  if (!body.authorizationCode?.trim()) {
    return json({ error: 'BAD_REQUEST', message: 'authorizationCode is required' }, 400);
  }

  const missing = missingSecrets(Deno.env);
  if (missing.length > 0) {
    // Deliberate, and reported rather than swallowed: the caller must be able to
    // tell "Apple was revoked" from "Apple was not reachable and nobody noticed".
    return json(
      {
        error: 'NOT_CONFIGURED',
        message:
          'Sign in with Apple token revocation is not configured. Missing: ' +
          `${missing.join(', ')}. Account deletion still proceeds; the outstanding ` +
          'revocation is recorded on the audit row as apple_revoke_pending.',
        missing,
      },
      501,
    );
  }

  // Unreachable until the secrets above exist. Left as an explicit failure
  // rather than a silent success, so a half-finished deploy cannot look green.
  return json(
    {
      error: 'NOT_IMPLEMENTED',
      message:
        'Apple credentials are present but the revocation exchange has not been ' +
        'written. See the header of this file for the four steps.',
    },
    501,
  );
});
