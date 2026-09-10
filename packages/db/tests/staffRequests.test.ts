/**
 * 0072 — staff requests and the owner's decision on them.
 *
 * The suite is organised around the four claims the migration makes, because
 * they are the reasons the table exists rather than a jsonb column on staff:
 * a request is immutable, only the owner decides, nobody decides their own,
 * and a decision is final.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  outcome,
  SEED_STAFF,
  SEED_STAFF_IDS,
  anonymousSessionClient,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0072 staff requests', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);
    await svc.from('staff_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  });

  afterAll(async () => {
    await svc.from('staff_requests').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  });

  async function submit(as: SupabaseClient, args: Record<string, unknown>) {
    return outcome(await appRpc(as, 'submit_staff_request', args));
  }

  it('accepts each kind with the payload that kind requires', async () => {
    const leave = await submit(cashier, {
      p_kind: 'leave',
      p_from: '2026-10-01',
      p_to: '2026-10-03',
      p_note: 'family',
    });
    expect(leave.ok, leave.errorMessage).toBe(true);

    const advance = await submit(manager, { p_kind: 'advance', p_amount_iqd: 250_000 });
    expect(advance.ok, advance.errorMessage).toBe(true);
  });

  it('refuses a payload that does not match the kind', async () => {
    // An advance with dates, and leave with no range: both are constraint
    // violations, not RPC errors, so the table stays honest even if a future
    // RPC forgets to check.
    const bad = await submit(cashier, {
      p_kind: 'advance',
      p_from: '2026-10-01',
      p_amount_iqd: 1000,
    });
    expect(bad.ok).toBe(false);

    const noRange = await submit(cashier, { p_kind: 'leave' });
    expect(noRange.ok).toBe(false);
  });

  it('allows one pending request of a kind at a time', async () => {
    const again = await submit(manager, { p_kind: 'advance', p_amount_iqd: 10_000 });
    expect(again.ok).toBe(false);
    expect(again.errorMessage).toContain('REQUEST_ALREADY_PENDING');
  });

  it('shows a non-manager only their own requests', async () => {
    const mine = outcome(await appRpc(cashier, 'staff_requests_page', {}));
    expect(mine.ok, mine.errorMessage).toBe(true);
    const rows = (mine.data as { requests: { staff_id: string }[] }).requests;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.staff_id === SEED_STAFF_IDS.cashier)).toBe(true);
  });

  it('shows management the whole venue, pending first', async () => {
    const all = outcome(await appRpc(owner, 'staff_requests_page', {}));
    const rows = (all.data as { requests: { staff_id: string; status: string }[] }).requests;
    const authors = new Set(rows.map((r) => r.staff_id));
    expect(authors.size).toBeGreaterThan(1);
    // Pending rows sort ahead of decided ones.
    const firstDecided = rows.findIndex((r) => r.status !== 'pending');
    if (firstDecided !== -1) {
      expect(rows.slice(firstDecided).every((r) => r.status !== 'pending')).toBe(true);
    }
  });

  it('lets only the owner decide', async () => {
    const { data } = await svc
      .from('staff_requests')
      .select('id')
      .eq('staff_id', SEED_STAFF_IDS.cashier)
      .eq('status', 'pending')
      .limit(1)
      .single();
    const id = (data as { id: string }).id;

    const byManager = outcome(
      await appRpc(manager, 'decide_staff_request', { p_id: id, p_approve: true }),
    );
    expect(byManager.ok).toBe(false);
    expect(byManager.errorMessage).toContain('FORBIDDEN');

    const byOwner = outcome(
      await appRpc(owner, 'decide_staff_request', { p_id: id, p_approve: true }),
    );
    expect(byOwner.ok, byOwner.errorMessage).toBe(true);
  });

  it('will not decide the same request twice', async () => {
    const { data } = await svc
      .from('staff_requests')
      .select('id')
      .eq('status', 'approved')
      .limit(1)
      .single();
    const again = outcome(
      await appRpc(owner, 'decide_staff_request', {
        p_id: (data as { id: string }).id,
        p_approve: false,
        p_note: 'x',
      }),
    );
    expect(again.ok).toBe(false);
    expect(again.errorMessage).toContain('REQUEST_NOT_PENDING');
  });

  it('requires a reason to decline, and records it', async () => {
    const made = await submit(cashier, {
      p_kind: 'correction',
      p_from: '2026-09-01',
      p_note: 'I worked this shift',
    });
    expect(made.ok, made.errorMessage).toBe(true);
    const id = made.data as unknown as string;

    const noReason = outcome(
      await appRpc(owner, 'decide_staff_request', { p_id: id, p_approve: false }),
    );
    expect(noReason.ok).toBe(false);
    expect(noReason.errorMessage).toContain('REASON_REQUIRED');

    const withReason = outcome(
      await appRpc(owner, 'decide_staff_request', {
        p_id: id,
        p_approve: false,
        p_note: 'roster shows otherwise',
      }),
    );
    expect(withReason.ok, withReason.errorMessage).toBe(true);
    const row = withReason.data as { status: string; decision_note: string; decided_by: string };
    expect(row.status).toBe('rejected');
    expect(row.decision_note).toBe('roster shows otherwise');
    expect(row.decided_by).toBe(SEED_STAFF_IDS.owner);
  });

  it('never lets anyone decide their own request', async () => {
    const own = await submit(owner, { p_kind: 'leave', p_from: '2026-12-01', p_to: '2026-12-02' });
    expect(own.ok, own.errorMessage).toBe(true);
    const res = outcome(
      await appRpc(owner, 'decide_staff_request', {
        p_id: own.data as unknown as string,
        p_approve: true,
      }),
    );
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('CANNOT_DECIDE_OWN');
  });

  it('lets the requester withdraw, but nobody else', async () => {
    const made = await submit(cashier, {
      p_kind: 'shift_swap',
      p_from: '2026-11-01',
      p_to: '2026-11-02',
    });
    const id = made.data as unknown as string;

    const byOther = outcome(await appRpc(manager, 'withdraw_staff_request', { p_id: id }));
    expect(byOther.ok).toBe(false);

    const byOwnerOfRow = outcome(await appRpc(cashier, 'withdraw_staff_request', { p_id: id }));
    expect(byOwnerOfRow.ok, byOwnerOfRow.errorMessage).toBe(true);

    const { data } = await svc
      .from('staff_requests')
      .select('status, decided_by')
      .eq('id', id)
      .single();
    // A withdrawal is the requester's own act, so it carries no decider.
    expect(data).toMatchObject({ status: 'withdrawn', decided_by: null });
  });

  it('refuses a cafe guest before it looks a request up', async () => {
    // Regression guard: withdraw used to reach its NOT_FOUND before any role
    // check, which told an anonymous scanner which request ids exist.
    const guest = await anonymousSessionClient();
    const res = outcome(
      await appRpc(guest, 'withdraw_staff_request', { p_id: crypto.randomUUID() }),
    );
    expect(res.ok).toBe(false);
    expect(res.errorMessage).toContain('FORBIDDEN');
  });

  it('names what was not found, instead of falling back to a generic error', async () => {
    const res = outcome(
      await appRpc(owner, 'decide_staff_request', { p_id: crypto.randomUUID(), p_approve: true }),
    );
    expect(res.errorMessage).toContain('REQUEST_NOT_FOUND');
  });

  it('refuses a direct client write, so the guards cannot be bypassed', async () => {
    const insert = await cashier.from('staff_requests').insert({
      staff_id: SEED_STAFF_IDS.cashier,
      kind: 'advance',
      amount_iqd: 999,
    });
    expect(insert.error).not.toBeNull();

    const { data } = await svc.from('staff_requests').select('id').limit(1).single();
    const update = await owner
      .from('staff_requests')
      .update({ status: 'approved' })
      .eq('id', (data as { id: string }).id);
    expect(update.error).not.toBeNull();
  });
});
