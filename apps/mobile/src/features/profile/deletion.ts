/**
 * SEC-16 — the account-deletion sequence, as a pure function.
 *
 * The screen owns the form; this owns the ORDER, because the order is the part
 * that is easy to get wrong and impossible to notice being wrong. It takes its
 * effects as arguments (no expo / react-native / supabase imports) so the whole
 * sequence — including every failure path — is exercised under the plain-node
 * vitest setup rather than being trusted by inspection.
 *
 * ---------------------------------------------------------------------------
 * THE ORDER, AND WHY IT IS THIS ONE
 * ---------------------------------------------------------------------------
 *
 * 1. THE SERVER DELETE GOES FIRST (after Apple's step 0, below). Every local step is destructive and none of
 *    them is undoable: unregistering the push token silently ends notifications,
 *    purging the keychain ends the session. Do any of that before the server
 *    call and a deletion that fails on a flaky connection leaves the guest with
 *    an account they still own, signed out of it, no longer receiving their
 *    booking reminders, and no error that explains why. Server first means a
 *    failure at step 1 leaves the device EXACTLY as it was and the user can
 *    simply press the button again.
 *
 * 2. EVERY LOCAL STEP AFTER IT IS BEST-EFFORT AND UNCONDITIONAL. Once the RPC
 *    returns, the account is gone — that transaction has committed and there is
 *    no undo. From that instant the only correct behaviour is to finish tearing
 *    the device down and land the user on a signed-out app. So each remaining
 *    step is wrapped: one failing keychain delete must not skip the cache wipe,
 *    and nothing may propagate an exception that would leave the screen showing
 *    an error beside an account that no longer exists.
 *
 * 3. THE PUSH TOKEN IS SURRENDERED LOCALLY EVEN THOUGH THE RPC CLEARED IT.
 *    0077 nulls `profiles.expo_push_token`, which stops OUR server addressing
 *    the handset. It cannot touch the token Expo's push service still holds for
 *    this installation. Both halves or neither.
 *
 * 0. SIGN IN WITH APPLE IS REVOKED BEFORE ANY OF IT (App Store Guideline
 *    5.1.1(v)). The apple-revoke edge function authenticates with the session
 *    JWT, which dies with the account, so this cannot come after step 1. For an
 *    account with an Apple identity, on a device that can re-authenticate
 *    natively (iOS), the Apple sheet is shown for a fresh authorizationCode and
 *    the server revokes the grant with it. Two rules:
 *      - The guest CANCELS the Apple sheet -> nothing happens at all; the
 *        deletion is abandoned (DeletionCancelledError) and can be retried.
 *      - Anything else fails (Apple sheet error, network, 501 while the key is
 *        unconfigured, a 5xx from Apple) -> the account is deleted anyway.
 *        Deletion is never held hostage to Apple; delete_my_account records
 *        apple_revoke_pending on its audit row for every Apple account.
 *    Android cannot show the Apple sheet (Apple is iOS-only, D2): revocation is
 *    skipped there and the pending flag on the audit row is the record.
 *
 * Failures are reported, not thrown: `outcome.failures` names the steps that
 * did not complete so the caller can send them to the tracker. The user is not
 * shown them — there is no action attached to "the keychain refused one delete
 * after your account was destroyed", and the quiet-error rule (SEC-36) says a
 * message with no action behind it is noise.
 */

/** The steps that can fail without changing the result. */
export type DeletionStep = 'push' | 'secure-store' | 'caches';

/** What happened to the Sign in with Apple grant. */
export type AppleRevokeStatus =
  /** The account has no Apple identity. */
  | 'not-needed'
  /** Apple confirmed the revocation. */
  | 'revoked'
  /** Re-auth or the revoke call failed; the account was deleted regardless. */
  | 'failed'
  /** This device cannot re-authenticate with Apple (Android). */
  | 'unsupported';

/** The Apple sheet's answer: a one-time code, or the guest backed out. Throw for anything else. */
export type AppleReauth = { status: 'code'; authorizationCode: string } | { status: 'cancelled' };

/**
 * The guest dismissed the Apple confirmation. Nothing — server or device — has
 * been touched; the screen says so and the button can be pressed again.
 */
export class DeletionCancelledError extends Error {
  constructor() {
    super('account deletion cancelled at the Apple confirmation');
    this.name = 'DeletionCancelledError';
  }
}

/** The shape of a Supabase user this module needs, without importing supabase-js. */
export interface IdentityBearer {
  identities?: readonly { provider?: string | null }[] | null;
  app_metadata?: { provider?: unknown; providers?: unknown } | null;
}

/**
 * Does this account carry a Sign in with Apple identity? `identities` is the
 * direct answer; app_metadata.providers is GoTrue's own summary and survives a
 * session restored without identities.
 */
export function hasAppleIdentity(user: IdentityBearer | null | undefined): boolean {
  if (!user) return false;
  if (user.identities?.some((i) => i.provider === 'apple')) return true;
  const meta = user.app_metadata;
  if (Array.isArray(meta?.providers) && meta.providers.includes('apple')) return true;
  return meta?.provider === 'apple';
}

export interface DeletionEffects {
  /** app.delete_my_account + a local signOut. The ONE step allowed to throw. */
  deleteServerSide: () => Promise<{ deleted: boolean; apple_revoke_pending: boolean }>;
  /** Invalidate this installation's Expo push token with APNs/FCM. */
  unregisterPush: () => Promise<boolean>;
  /** Remove these keys and every chunk that could belong to them. */
  purgeSecureKeys: (keys: readonly string[]) => Promise<void>;
  /** Query cache + on-disk persister. */
  clearCaches: () => Promise<void>;
  /** Everything this app has ever written to SecureStore. */
  secureKeys: readonly string[];
  /** The signed-in account has a Sign in with Apple identity (hasAppleIdentity). */
  hasAppleIdentity?: boolean;
  /**
   * Show the Apple sheet for a fresh authorizationCode. Undefined on a device
   * that cannot (Android) — revocation is then skipped, not failed.
   */
  reauthApple?: () => Promise<AppleReauth>;
  /** POST the code to apple-revoke. Throws on any non-2xx. */
  revokeApple?: (authorizationCode: string) => Promise<void>;
}

export interface DeletionOutcome {
  /** True when the account is gone. Local cleanup cannot make this false. */
  deleted: boolean;
  /**
   * The account carried a Sign in with Apple identity and this device did NOT
   * get Apple to confirm the revocation. (The server's audit row says pending
   * for every Apple account either way — see api.ts deleteAccount.)
   */
  appleRevokePending: boolean;
  /** What happened to the Apple grant. */
  appleRevoke: AppleRevokeStatus;
  /** When appleRevoke is 'failed': the error's message, for telemetry. Never shown. */
  appleRevokeError: string | null;
  /** Local steps that did not complete. Telemetry only — never shown. */
  failures: DeletionStep[];
}

/**
 * Step 0. Returns the status; throws ONLY DeletionCancelledError.
 */
async function revokeAppleIfNeeded(
  fx: DeletionEffects,
): Promise<{ status: AppleRevokeStatus; error: string | null }> {
  if (!fx.hasAppleIdentity) return { status: 'not-needed', error: null };
  if (!fx.reauthApple || !fx.revokeApple) return { status: 'unsupported', error: null };
  const failed = (err: unknown, step: string) => ({
    status: 'failed' as const,
    error: `${step}: ${err instanceof Error ? err.message : String(err)}`, // QUIET-ERROR-OK: appleRevokeError is telemetry only (captureException in delete-account.tsx), never shown
  });

  let reauth: AppleReauth;
  try {
    reauth = await fx.reauthApple();
  } catch (err) {
    return failed(err, 'reauth');
  }
  if (reauth.status === 'cancelled') throw new DeletionCancelledError();

  try {
    await fx.revokeApple(reauth.authorizationCode);
    return { status: 'revoked', error: null };
  } catch (err) {
    return failed(err, 'revoke');
  }
}

/**
 * Run the sequence. Throws when the guest cancelled the Apple confirmation
 * (DeletionCancelledError) or the server refused — in both cases nothing on
 * the device has been touched and the account still exists.
 */
export async function runAccountDeletion(fx: DeletionEffects): Promise<DeletionOutcome> {
  // Step 0 — Apple, while the session JWT still exists. Never blocks step 1
  // except by the guest's own cancel.
  const apple = await revokeAppleIfNeeded(fx);

  // Step 1 — the only step that may throw, and the only one that matters.
  const result = await fx.deleteServerSide();

  const failures: DeletionStep[] = [];
  const attempt = async (step: DeletionStep, run: () => Promise<unknown>) => {
    try {
      await run();
    } catch {
      failures.push(step);
    }
  };

  // Steps 2-4 — the account is already gone; finish the teardown regardless.
  await attempt('push', async () => {
    if (!(await fx.unregisterPush())) throw new Error('push unregister declined');
  });
  await attempt('secure-store', () => fx.purgeSecureKeys(fx.secureKeys));
  await attempt('caches', () => fx.clearCaches());

  return {
    deleted: result.deleted,
    appleRevokePending: result.apple_revoke_pending && apple.status !== 'revoked',
    appleRevoke: apple.status,
    appleRevokeError: apple.error,
    failures,
  };
}

/**
 * Does the typed confirmation match?
 *
 * Trimmed and case-folded on purpose. The confirmation exists to make the act
 * DELIBERATE — to stop a thumb landing on a destructive button — not to test
 * whether somebody can hold shift or avoid the keyboard's trailing space. A
 * rule that rejects "delete " teaches nothing and only produces a second
 * attempt; the deliberation has already happened by then.
 *
 * `expected` is the LOCALISED word (`profile.deleteConfirmWord`), not the RPC's
 * `p_confirm => 'DELETE'` token. Those are two different things: one is a
 * human confirming in their own language, the other is a wire-level guard
 * against a bare zero-argument call. Making an Arabic-first app's guest type a
 * Latin word to close their account would be a comprehension test, not a
 * confirmation.
 *
 * `toLocaleLowerCase` without a locale argument uses the host's, which is what
 * we want: Arabic has no case, so the fold is a no-op there and cannot mangle
 * the word.
 */
export function confirmationMatches(typed: string, expected: string): boolean {
  const norm = (s: string) => s.trim().toLocaleLowerCase();
  const want = norm(expected);
  return want.length > 0 && norm(typed) === want;
}
