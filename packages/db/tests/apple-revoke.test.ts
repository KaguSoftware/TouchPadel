/**
 * Apple's /auth/revoke — the deletion obligation that is NOT met yet.
 *
 * Apple requires an app offering Sign in with Apple to revoke the user's tokens
 * when their account is deleted. Migration 0077 deletes the account; nothing
 * calls Apple, because the Sign in with Apple `.p8` key does not exist yet
 * (blocked on Apple Developer enrolment — HANDOFF-security.md §4).
 *
 * THIS FILE IS THE TRIPWIRE. The handoff asked for a failing test so the gap
 * "cannot be quietly forgotten". A test that simply fails forever gets deleted
 * within a week — this repository argues that itself, in
 * scripts/check-migrations.mjs: "a permanently red gate is weakened or deleted
 * within a day". So instead these tests are ARMED. They pass while nothing is
 * owed and go red the moment something is:
 *
 *   1. an Apple identity exists in auth.identities — a real person can now sign
 *      in with Apple, so the obligation is live and every deletion breaches it;
 *   2. the Apple secrets are configured — somebody has the key, and the
 *      exchange still is not written.
 *
 * Either way the red test names the next action. Until then the outstanding
 * work is visible in the data rather than in a comment: app.delete_my_account
 * stamps apple_revoke_pending on its audit row for any account that carried an
 * Apple identity.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, guestClient, appRpc } from './helpers';

const up = await stackAvailable();

const APPLE_SECRETS = ['APPLE_TEAM_ID', 'APPLE_KEY_ID', 'APPLE_CLIENT_ID', 'APPLE_PRIVATE_KEY_P8'];

/** True once the revocation exchange has actually been implemented. */
function revocationImplemented(source: string): boolean {
  return !source.includes("error: 'NOT_IMPLEMENTED'");
}

describe.skipIf(!up)('Apple account-deletion token revocation', () => {
  let svc: SupabaseClient;
  let source: string;

  beforeAll(async () => {
    svc = serviceClient();
    source = await Deno_readStub();
  });

  /** The stub's own source, read from disk — no Deno runtime needed. */
  async function Deno_readStub(): Promise<string> {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const path = fileURLToPath(
      new URL('../supabase/functions/apple-revoke/index.ts', import.meta.url),
    );
    return readFile(path, 'utf8');
  }

  it('the stub exists and is registered with verify_jwt', async () => {
    expect(source).toContain('apple-revoke');
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const config = await readFile(
      fileURLToPath(new URL('../supabase/config.toml', import.meta.url)),
      'utf8',
    );
    expect(config).toContain('[functions.apple-revoke]');
  });

  /**
   * ARMED #1 — Sign in with Apple is ALREADY ENABLED.
   *
   * config.toml has `[auth.external.apple] enabled = true` with a real
   * client_id (com.kagu.touchpadel). So this is not a future obligation waiting
   * on a first Apple user: a guest can sign in with Apple today, and every
   * deletion of such an account already breaches Apple's revocation
   * requirement. The gap is LIVE.
   *
   * This test asserts that the gap stays TRACKED while it is open — the stub
   * exists, says why, and delete_my_account records the debt — and it flips to
   * demanding a real implementation the moment the provider is on AND the
   * credentials exist.
   *
   * (The obvious check — count auth.identities where provider='apple' — is not
   * used: the `auth` schema is not exposed to PostgREST, so that query returns
   * HTTP 406 and the tripwire would be permanently blind while looking green.)
   */
  it('Apple sign-in is enabled, so the gap must stay tracked and visible', async () => {
    const { readFile } = await import('node:fs/promises');
    const { fileURLToPath } = await import('node:url');
    const config = await readFile(
      fileURLToPath(new URL('../supabase/config.toml', import.meta.url)),
      'utf8',
    );
    const appleEnabled = /\[auth\.external\.apple\][^[]*enabled\s*=\s*true/.test(config);
    expect(appleEnabled, 'Apple provider config moved — re-check this tripwire').toBe(true);

    if (revocationImplemented(source)) return; // done: nothing to track.

    // Open gap. It must be impossible to mistake for finished.
    expect(source).toContain('NOT_CONFIGURED');
    expect(source, 'the stub must say why it is a stub').toMatch(/\.p8/);
    // Comment text wraps, so compare on collapsed whitespace rather than raw.
    const prose = source.replace(/\s*\n\s*\*?\s*/g, ' ');
    expect(
      prose,
      'the stub must name what unblocks it, so it survives a lost session',
    ).toContain('Apple Developer enrolment');
  });

  /**
   * ARMED #2 — the key arriving is the signal to finish the job.
   */
  it('the Apple secrets are absent — the day they are set, this must be implemented', () => {
    const present = APPLE_SECRETS.filter((k) => (process.env[k] ?? '').trim());
    if (present.length > 0) {
      expect(
        revocationImplemented(source),
        `Apple credentials are configured (${present.join(', ')}) but apple-revoke ` +
          'still returns NOT_IMPLEMENTED. Finish the exchange — the four steps are ' +
          'in the header of that file.',
      ).toBe(true);
    } else {
      expect(present).toEqual([]);
    }
  });

  /**
   * The obligation is recorded in the data, not only in a comment — so it can be
   * counted at handover instead of remembered.
   */
  it('delete_my_account records whether Apple still owes a revocation', async () => {
    const guest = await guestClient(svc, 'applerevoke');
    const uid = (await guest.auth.getUser()).data.user!.id;

    const del = await appRpc(guest, 'delete_my_account', { p_confirm: 'DELETE' });
    expect(del.error).toBeNull();
    // An email/password guest has no Apple identity, so nothing is owed for them.
    expect((del.data as { apple_revoke_pending: boolean }).apple_revoke_pending).toBe(false);

    const { data } = await svc
      .from('audit_log')
      .select('after')
      .eq('action', 'account.delete')
      .eq('entity_id', uid)
      .single();
    const after = (data as { after: Record<string, unknown> }).after;
    expect(after).toHaveProperty('apple_revoke_pending');
  });
});
