/**
 * 0395 — a save queued offline applies exactly once (F-23).
 *
 * app.queued_rpc runs one allowlisted RPC as the caller, under the queued
 * envelope's key, claimed in the same transaction as the write. The pure part
 * holds the three copies of the allowlist equal; the stack part replays the
 * same key and asserts the EFFECT (the audit row the RPC writes) happened once.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { QUEUEABLE_RPCS } from '../../core/src/schemas/mutations';
import shared from '../supabase/functions/_shared/mutation-types.json';
import {
  VENUE_A_ID,
  anonymousSessionClient,
  appRpc,
  outcome,
  serviceClient,
  signedInClient,
  stackAvailable,
  testIdemKey,
  SEED_STAFF,
} from './helpers';

const MIGRATION = path.resolve(import.meta.dirname, '../supabase/migrations/20261101000395_queued_rpc.sql');

function sqlAllowlist(): string[] {
  const sql = readFileSync(MIGRATION, 'utf8');
  const body = sql.split('create or replace function app.queueable_rpcs()')[1]!.split(']::text[]')[0]!;
  return [...body.matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]!);
}

describe('0395 queueable allowlist', () => {
  it('is one list in core, the replay JSON and the SQL function', () => {
    expect([...shared.queueableRpcs]).toEqual([...QUEUEABLE_RPCS]);
    expect(sqlAllowlist()).toEqual([...QUEUEABLE_RPCS]);
  });

  it('holds no secret setter and no day, shift or branch boundary', () => {
    for (const fn of ['set_staff_pin', 'open_day', 'close_day', 'open_till_shift', 'close_till_shift', 'close_branch', 'register_station']) {
      expect(sqlAllowlist()).not.toContain(fn);
    }
  });
});

const up = await stackAvailable();

describe.skipIf(!up)('0395 queued_rpc', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let owner: SupabaseClient;
  let before: number | null = null;

  const audits = async () => {
    const { count } = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'settings.waiter_cooldown');
    return count ?? 0;
  };

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    owner = await signedInClient(SEED_STAFF.owner);
    const { data } = await svc.from('venue_settings').select('waiter_call_cooldown_seconds').eq('venue_id', VENUE_A_ID).single();
    before = (data as { waiter_call_cooldown_seconds: number } | null)?.waiter_call_cooldown_seconds ?? null;
  });

  afterAll(async () => {
    if (before !== null) {
      await svc.from('venue_settings').update({ waiter_call_cooldown_seconds: before }).eq('venue_id', VENUE_A_ID);
    }
  });

  it('applies the queued save once, however often the same key is replayed', async () => {
    const key = testIdemKey('rpc.queued');
    const args = { p_fn: 'set_waiter_call_cooldown', p_args: { p_seconds: 77, p_venue_id: VENUE_A_ID }, p_idempotency_key: key };
    const n0 = await audits();
    const first = await appRpc(manager, 'queued_rpc', args).then(outcome);
    expect(first.ok, first.errorMessage).toBe(true);
    const second = await appRpc(manager, 'queued_rpc', args).then(outcome);
    expect(second.ok, second.errorMessage).toBe(true);
    expect((second.data as { duplicate?: boolean }).duplicate).toBe(true);
    expect(await audits()).toBe(n0 + 1);
    const { data } = await svc.from('venue_settings').select('waiter_call_cooldown_seconds').eq('venue_id', VENUE_A_ID).single();
    expect((data as { waiter_call_cooldown_seconds: number }).waiter_call_cooldown_seconds).toBe(77);
  });

  it('a refusal rolls the claim back with it: the same key may be sent again', async () => {
    const key = testIdemKey('rpc.queued');
    const bad = await appRpc(manager, 'queued_rpc', {
      p_fn: 'set_waiter_call_cooldown', p_args: { p_seconds: 5 }, p_idempotency_key: key,
    }).then(outcome);
    expect(bad.errorMessage).toBe('INVALID_COOLDOWN');
    const good = await appRpc(manager, 'queued_rpc', {
      p_fn: 'set_waiter_call_cooldown', p_args: { p_seconds: 90, p_venue_id: VENUE_A_ID }, p_idempotency_key: key,
    }).then(outcome);
    expect(good.ok, good.errorMessage).toBe(true);
  });

  it("runs as the caller: the RPC's own role guard holds", async () => {
    const cashier = await signedInClient(SEED_STAFF.cashier);
    const res = await appRpc(cashier, 'queued_rpc', {
      p_fn: 'set_waiter_call_cooldown', p_args: { p_seconds: 60 }, p_idempotency_key: testIdemKey('rpc.queued'),
    }).then(outcome);
    expect(res.errorMessage).toBe('FORBIDDEN');
  });

  it('refuses a name off the allowlist, an unknown argument and a malformed key', async () => {
    const off = await appRpc(owner, 'queued_rpc', {
      p_fn: 'set_staff_pin', p_args: {}, p_idempotency_key: testIdemKey('rpc.queued'),
    }).then(outcome);
    expect(off.errorMessage).toBe('FORBIDDEN');
    const unknownArg = await appRpc(owner, 'queued_rpc', {
      p_fn: 'set_waiter_call_cooldown', p_args: { p_nope: 1 }, p_idempotency_key: testIdemKey('rpc.queued'),
    }).then(outcome);
    expect(unknownArg.errorMessage).toBe('INVALID_ARGUMENT');
    const badKey = await appRpc(owner, 'queued_rpc', {
      p_fn: 'set_waiter_call_cooldown', p_args: { p_seconds: 60 }, p_idempotency_key: 'TEST1:tab.open:0123456789ABCDEFGHJKMNPQRS',
    }).then(outcome);
    expect(badKey.errorMessage).toBe('INVALID_ARGUMENT');
  });

  it("another person replaying someone's key gets IDEMPOTENCY_CONFLICT, never their result", async () => {
    const key = testIdemKey('rpc.queued');
    const args = { p_fn: 'set_waiter_call_cooldown', p_args: { p_seconds: 120, p_venue_id: VENUE_A_ID }, p_idempotency_key: key };
    expect((await appRpc(manager, 'queued_rpc', args).then(outcome)).ok).toBe(true);
    const other = await appRpc(owner, 'queued_rpc', args).then(outcome);
    expect(other.errorMessage).toBe('IDEMPOTENCY_CONFLICT');
  });

  it('a guest is refused at the claim', async () => {
    const guest = await anonymousSessionClient();
    const res = await appRpc(guest, 'queued_rpc', {
      p_fn: 'set_waiter_call_cooldown', p_args: { p_seconds: 60 }, p_idempotency_key: testIdemKey('rpc.queued'),
    }).then(outcome);
    expect(res.errorMessage).toBe('FORBIDDEN');
  });

  it('casts each argument to its declared type: a uuid[] and a jsonb patch', async () => {
    const { data: courts } = await svc
      .from('courts')
      .select('id')
      .eq('venue_id', VENUE_A_ID)
      .eq('is_active', true)
      .order('sort_order')
      .order('id');
    const ids = (courts ?? []).map((c: { id: string }) => c.id);
    const reorder = await appRpc(owner, 'queued_rpc', {
      p_fn: 'reorder_courts', p_args: { p_ids: ids }, p_idempotency_key: testIdemKey('rpc.queued'),
    }).then(outcome);
    expect(reorder.ok, reorder.errorMessage).toBe(true);

    const { data: vs } = await svc.from('venue_settings').select('offline_mode_enabled').eq('venue_id', VENUE_A_ID).single();
    const current = (vs as { offline_mode_enabled: boolean }).offline_mode_enabled;
    const details = await appRpc(owner, 'queued_rpc', {
      p_fn: 'set_venue_details',
      p_args: { p_patch: { offline_mode_enabled: current }, p_venue_id: VENUE_A_ID },
      p_idempotency_key: testIdemKey('rpc.queued'),
    }).then(outcome);
    expect(details.ok, details.errorMessage).toBe(true);
  });
});
