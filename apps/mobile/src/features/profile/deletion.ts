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
 * 1. THE SERVER DELETE GOES FIRST. Every local step is destructive and none of
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
 * Failures are reported, not thrown: `outcome.failures` names the steps that
 * did not complete so the caller can send them to the tracker. The user is not
 * shown them — there is no action attached to "the keychain refused one delete
 * after your account was destroyed", and the quiet-error rule (SEC-36) says a
 * message with no action behind it is noise.
 */

/** The steps that can fail without changing the result. */
export type DeletionStep = 'push' | 'secure-store' | 'caches';

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
}

export interface DeletionOutcome {
  /** True when the account is gone. Local cleanup cannot make this false. */
  deleted: boolean;
  /** The account carried a Sign in with Apple identity; /auth/revoke is owed. */
  appleRevokePending: boolean;
  /** Local steps that did not complete. Telemetry only — never shown. */
  failures: DeletionStep[];
}

/**
 * Run the sequence. Throws ONLY when the server refused, in which case nothing
 * on the device has been touched and the caller should show the mapped error.
 */
export async function runAccountDeletion(fx: DeletionEffects): Promise<DeletionOutcome> {
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
    appleRevokePending: result.apple_revoke_pending,
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
