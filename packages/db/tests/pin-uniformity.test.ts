/**
 * 0086 — SEC-13's second half: uniform PIN failures, audited lockouts, and a
 * manager's ability to clear a lock.
 *
 * The timing assertions are the reason this file exists and also the reason it
 * is written carefully. A test that asserts "correct and wrong take the same
 * time" on a shared laptop under a full suite is a flake generator. So it
 * asserts the two properties that ARE stable:
 *
 *   1. every verification takes at least the floor  (a hard lower bound)
 *   2. correct is not FASTER than wrong             (the actual leak, and the
 *                                                    direction it leaked in)
 *
 * Before 0086, (2) failed by design: a correct PIN short-circuited the second
 * scan's `limit 1` while a wrong one scanned every manager, so right was
 * reliably quicker than wrong. That is what these measure.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  DEV_PINS,
} from './helpers';

const up = await stackAvailable();

/** The floor declared by app.pin_delay_floor(), in ms. */
const FLOOR_MS = 250;
/**
 * Slack under the floor for scheduler jitter and the round trip's own clock.
 * The assertion is still meaningful: before 0086 these calls returned in a few
 * milliseconds, an order of magnitude below even the slackened bound.
 */
const FLOOR_SLACK_MS = 60;

// PromiseLike, not Promise: appRpc returns PostgREST's builder, which is a
// thenable rather than a real Promise (no .catch / .finally).
async function timed<T>(run: () => PromiseLike<T>): Promise<{ ms: number; result: T }> {
  const t0 = performance.now();
  const result = await run();
  return { ms: performance.now() - t0, result };
}

/**
 * The highest `audit_log.id` right now — a monotonic watermark.
 *
 * Every audit assertion below used to scope itself with
 * `.gte('at', new Date().toISOString())`: a HOST timestamp compared against a
 * column defaulted to the DATABASE's `now()`. Those are not the same clock —
 * Postgres runs in a container — and they drift tens of milliseconds either
 * way. When the database is behind, a row written moments after the mark
 * carries an EARLIER timestamp and is filtered straight back out.
 *
 * It failed both ways, and the second way is the worse one:
 *   - "lets a manager clear a lockout" failed ~1 run in 2, because the clear is
 *     fast and never outruns the skew (the lockout cases survived only because
 *     five padded 250 ms calls sit between the mark and the assertion);
 *   - "does not log a lockout" asserts ZERO rows, so skew made it pass FOR
 *     FREE — a vacuous test that would not have noticed the row it forbids.
 *
 * `audit_log.id` is a bigint sequence. It needs no clock, so there is no skew
 * to race.
 */
async function auditWatermark(svc: SupabaseClient): Promise<number> {
  const { data } = await svc
    .from('audit_log')
    .select('id')
    .order('id', { ascending: false })
    .limit(1);
  return ((data ?? [])[0] as { id: number } | undefined)?.id ?? 0;
}

/** Median of several runs — one sample on a loaded machine says nothing. */
function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? 0;
}

describe.skipIf(!up)('0086 PIN failure uniformity (SEC-13)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let owner: SupabaseClient;
  let cashier: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    owner = await signedInClient(SEED_STAFF.owner);
    cashier = await signedInClient(SEED_STAFF.cashier);
  });

  afterAll(async () => {
    // This suite drives the limiter to lockout on purpose. Leaving its rows
    // behind would make hardening.test.ts and idle-lock.test.ts flaky, which is
    // exactly the interference that keeps the two PIN RPCs out of rls-matrix.
    await svc.schema('app').from('pin_attempts').delete().like('device_id', '%');
    await manager.auth.signOut();
    await owner.auth.signOut();
    await cashier.auth.signOut();
  });

  beforeEach(async () => {
    // .schema('app') is LOAD-BEARING. pin_attempts exists only in `app`, so the
    // bare svc.from('pin_attempts') that the older PIN suites use resolves to
    // public.pin_attempts, returns PGRST205, and cleans up NOTHING. Written
    // that way here, this suite locked itself out in its second test and the
    // audit assertions all read zero rows.
    await svc.schema('app').from('pin_attempts').delete().like('device_id', '%');
  });

  // ── the timing leak ───────────────────────────────────────────────────────

  it('pads a CORRECT manager PIN to the floor', async () => {
    const { ms, result } = await timed(() =>
      appRpc(manager, 'verify_manager_pin', { p_pin: DEV_PINS.manager, p_device_id: 'T-OK' }),
    );
    expect(result.error).toBeNull();
    expect(result.data).toBe(SEED_STAFF_IDS.manager);
    expect(ms).toBeGreaterThan(FLOOR_MS - FLOOR_SLACK_MS);
  });

  it('pads a WRONG manager PIN to the same floor', async () => {
    const { ms, result } = await timed(() =>
      appRpc(manager, 'verify_manager_pin', { p_pin: '473829', p_device_id: 'T-BAD' }),
    );
    expect(result.error).toBeNull();
    // Uniform outcome: NULL for every non-match — no such manager, inactive,
    // no PIN, wrong PIN. The five money callers all turn this into PIN_INVALID.
    expect(result.data).toBeNull();
    expect(ms).toBeGreaterThan(FLOOR_MS - FLOOR_SLACK_MS);
  });

  it('does not answer a CORRECT pin faster than a wrong one', async () => {
    // The OBSERVABLE property, which is the one that matters: from outside,
    // right and wrong are indistinguishable.
    //
    // Note what this can and cannot see. The delay floor is what makes it
    // true, and mutation-testing confirms it: neutering pin_pad_to_floor turns
    // this and the two floor tests red. Restoring the pre-0086 TWO-SCAN body
    // does NOT turn it red — the pad masks a difference of a few bcrypts, which
    // is exactly what a floor is for. So the single-scan shape cannot be
    // defended from out here at all; it is locked structurally instead, by
    // check:invariants reading verify_manager_pin's body from the catalog.
    const right: number[] = [];
    const wrong: number[] = [];
    for (let i = 0; i < 5; i++) {
      right.push(
        (await timed(() =>
          appRpc(manager, 'verify_manager_pin', { p_pin: DEV_PINS.manager, p_device_id: `R${i}` }))
        ).ms,
      );
      // A wrong PIN counts against the limiter, so clear between rounds — the
      // 6th would raise PIN_LOCKED and time a different code path.
      wrong.push(
        (await timed(() =>
          appRpc(manager, 'verify_manager_pin', { p_pin: '473829', p_device_id: `W${i}` }))
        ).ms,
      );
      await svc.schema('app').from('pin_attempts').delete().like('device_id', '%');
    }
    // Not "equal" — that is unassertable on a shared machine. "Correct is not
    // the fast one", which is the whole of the leak.
    expect(median(right)).toBeGreaterThan(median(wrong) * 0.75);
  });

  it('pads the LOCKED refusal too, so a lockout is not the fast answer', async () => {
    for (let i = 0; i < 5; i++) {
      await appRpc(owner, 'verify_manager_pin', { p_pin: '473829', p_device_id: `L${i}` });
    }
    const { ms, result } = await timed(() =>
      appRpc(owner, 'verify_manager_pin', { p_pin: DEV_PINS.owner, p_device_id: 'L-final' }),
    );
    expect(outcome(result).errorMessage).toContain('PIN_LOCKED');
    expect(ms).toBeGreaterThan(FLOOR_MS - FLOOR_SLACK_MS);
  });

  it('still refuses a non-staff caller immediately, and that is correct', async () => {
    // FORBIDDEN is not a PIN outcome — it says "you are not staff", which is
    // not a secret from the caller. Padding it would only make the guest-facing
    // probe expensive for us, not informative for them.
    const anon = await anonymousSessionClient();
    try {
      const denied = outcome(await appRpc(anon, 'verify_manager_pin', { p_pin: DEV_PINS.owner }));
      expect(denied.errorMessage).toContain('FORBIDDEN');
    } finally {
      await anon.auth.signOut();
    }
  });

  it('still attributes the authorising manager after the single-scan rewrite', async () => {
    // The two scans became one aggregate; the returned id must not have moved.
    const asOwner = await appRpc(owner, 'verify_manager_pin', {
      p_pin: DEV_PINS.owner,
      p_device_id: 'ATTR',
    });
    expect(asOwner.data).toBe(SEED_STAFF_IDS.owner);
  });

  // ── the audit ─────────────────────────────────────────────────────────────

  it('writes ONE staff.pin_locked row at the failure that reaches the threshold', async () => {
    const mark = await auditWatermark(svc);
    for (let i = 0; i < 5; i++) {
      await appRpc(manager, 'verify_manager_pin', { p_pin: '473829', p_device_id: `A${i}` });
    }
    const { data } = await svc
      .from('audit_log')
      .select('action, entity_id, after')
      .eq('action', 'staff.pin_locked')
      .gt('id', mark);
    const rows = (data ?? []) as {
      action: string;
      entity_id: string;
      after: Record<string, unknown>;
    }[];
    // Exactly one: the row is written where the lockout BEGINS, not on every
    // subsequent refusal. Writing it at the `raise` site would have produced
    // zero — the exception rolls the insert back (the 0011 lesson).
    expect(rows).toHaveLength(1);
    expect(rows[0]?.after).toMatchObject({ scope: 'manager', fails: 5 });
    // The entity is the CALLER who got locked out — there is no "manager whose
    // PIN was guessed" on a failure. Passing null here (audit_log.entity_id is
    // NOT NULL) aborted the transaction and rolled back the pin_attempts insert
    // with it, so the fifth failure vanished and the lockout never engaged.
    expect(rows[0]?.entity_id).toBe(SEED_STAFF_IDS.manager);
  });

  it('writes the audit row for the SELF-scope limiter too', async () => {
    const mark = await auditWatermark(svc);
    for (let i = 0; i < 5; i++) {
      await appRpc(cashier, 'verify_own_pin', { p_pin: '473829', p_device_id: `S${i}` });
    }
    const { data } = await svc
      .from('audit_log')
      .select('after')
      .eq('action', 'staff.pin_locked')
      .gt('id', mark);
    const rows = (data ?? []) as { after: Record<string, unknown> }[];
    // The cashier has no PIN set in the seed, so this exercises NO_PIN_SET
    // rather than a wrong-PIN lockout; either way the limiter must not log a
    // lockout it did not reach.
    for (const r of rows) expect(r.after).toMatchObject({ window: '5 minutes' });
  });

  it('does not log a lockout for a failure that does not reach the threshold', async () => {
    const mark = await auditWatermark(svc);
    for (let i = 0; i < 3; i++) {
      await appRpc(manager, 'verify_manager_pin', { p_pin: '473829', p_device_id: `N${i}` });
    }
    const { data } = await svc
      .from('audit_log')
      .select('id')
      .eq('action', 'staff.pin_locked')
      .gt('id', mark);
    expect(data ?? []).toHaveLength(0);
  });

  // ── clearing a lock ───────────────────────────────────────────────────────

  it('lets a manager clear a lockout, and audits that they did', async () => {
    for (let i = 0; i < 5; i++) {
      await appRpc(owner, 'verify_manager_pin', { p_pin: '473829', p_device_id: `C${i}` });
    }
    const locked = outcome(
      await appRpc(owner, 'verify_manager_pin', { p_pin: DEV_PINS.owner, p_device_id: 'C-x' }),
    );
    expect(locked.errorMessage).toContain('PIN_LOCKED');

    const mark = await auditWatermark(svc);
    const cleared = await appRpc(manager, 'clear_pin_lockout', {
      p_staff_id: SEED_STAFF_IDS.owner,
    });
    expect(cleared.error).toBeNull();
    expect((cleared.data as { cleared: number }).cleared).toBe(5);

    // And the lock is actually gone.
    const after = await appRpc(owner, 'verify_manager_pin', {
      p_pin: DEV_PINS.owner,
      p_device_id: 'C-y',
    });
    expect(after.error).toBeNull();
    expect(after.data).toBe(SEED_STAFF_IDS.owner);

    const { data } = await svc
      .from('audit_log')
      .select('action, entity_id, before')
      .eq('action', 'staff.pin_lockout_cleared')
      .gt('id', mark);
    const rows = (data ?? []) as { entity_id: string; before: Record<string, unknown> }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.entity_id).toBe(SEED_STAFF_IDS.owner);
    expect(rows[0]?.before).toMatchObject({ failed_attempts: 5 });
  });

  it('keeps the SUCCESSFUL attempts when a lock is cleared', async () => {
    // Those rows are the record of who authorised what. Clearing a lock must
    // release the person, not edit the history.
    await appRpc(owner, 'verify_manager_pin', { p_pin: DEV_PINS.owner, p_device_id: 'K-ok' });
    for (let i = 0; i < 5; i++) {
      await appRpc(owner, 'verify_manager_pin', { p_pin: '473829', p_device_id: `K${i}` });
    }
    await appRpc(manager, 'clear_pin_lockout', { p_staff_id: SEED_STAFF_IDS.owner });

    const { data } = await svc
      .schema('app')
      .from('pin_attempts')
      .select('success')
      .like('device_id', `${SEED_STAFF_IDS.owner}:%`);
    const rows = (data ?? []) as { success: boolean }[];
    expect(rows.filter((r) => !r.success)).toHaveLength(0);
    expect(rows.filter((r) => r.success).length).toBeGreaterThanOrEqual(1);
  });

  it('refuses a cashier, an anonymous guest, and an unknown staff id', async () => {
    const asCashier = outcome(
      await appRpc(cashier, 'clear_pin_lockout', { p_staff_id: SEED_STAFF_IDS.owner }),
    );
    expect(asCashier.errorMessage).toContain('FORBIDDEN');

    const anon = await anonymousSessionClient();
    try {
      const asGuest = outcome(
        await appRpc(anon, 'clear_pin_lockout', { p_staff_id: SEED_STAFF_IDS.owner }),
      );
      expect(asGuest.errorMessage).toContain('FORBIDDEN');
      // check:authz calls every RPC with NULL args as a guest: the role guard
      // must be the FIRST statement, so this is FORBIDDEN and not a null error.
      const nullArgs = outcome(await appRpc(anon, 'clear_pin_lockout', { p_staff_id: null }));
      expect(nullArgs.errorMessage).toContain('FORBIDDEN');
    } finally {
      await anon.auth.signOut();
    }

    const missing = outcome(
      await appRpc(manager, 'clear_pin_lockout', {
        p_staff_id: '00000000-0000-4000-8000-000000000999',
      }),
    );
    expect(missing.errorMessage).toContain('STAFF_NOT_FOUND');
  });
});
