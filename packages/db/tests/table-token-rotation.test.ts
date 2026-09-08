/**
 * SEC-26 (0083) — rotating the table-token secret without killing every printed
 * QR card at once.
 *
 * WHY THIS EXISTS. Table cards are laminated and glued to tables. With one
 * secret, rotating it invalidates all of them simultaneously and the café stops
 * taking orders until somebody physically replaces every card. Faced with
 * "rotate the key" or "keep trading", anybody chooses trading — so the key never
 * gets rotated and Phase 9's "rotate every key at handover" gets ticked without
 * the rotation happening. A control nobody can afford to exercise is not one.
 *
 * The overlap is deliberate and BOUNDED: every acceptance under the previous key
 * writes an audit row, so "is anybody still scanning an old card?" has an answer
 * before the old key is cleared.
 */
import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  anonymousSessionClient,
  appRpc,
  outcome,
  createTestCafeTable,
  SEED_STAFF,
} from './helpers';

const up = await stackAvailable();

describe.skipIf(!up)('0083 table token secret rotation (SEC-26)', () => {
  let svc: SupabaseClient;
  let manager: SupabaseClient;
  let tableId: string;

  beforeAll(async () => {
    svc = serviceClient();
    manager = await signedInClient(SEED_STAFF.manager);
    tableId = await createTestCafeTable(svc, `rot${Date.now() % 100000}`);
  });

  afterEach(async () => {
    await clearPrev(); // every case starts with no rotation in flight
  });

  afterAll(async () => {
    await svc.from('guest_sessions').delete().eq('table_id', tableId);
    await svc.from('cafe_tables').delete().eq('id', tableId);
    await manager.auth.signOut();
  });

  /**
   * The rotation is driven through the RPCs that exist for it, not by editing
   * the secret store. The first version of this test wrote to `app.secrets`
   * directly and quietly measured nothing: the live value lives in VAULT, which
   * takes precedence, so the "current" key never actually changed and every
   * card kept verifying under it. Driving the real operation is both a truer
   * test and the only supported way to do this in production.
   */
  const rotate = () => svc.schema('app').rpc('rotate_table_token_secret').then(outcome);
  const clearPrev = () => svc.schema('app').rpc('clear_table_token_secret_prev').then(outcome);

  const mint = async () => {
    const res = await appRpc(manager, 'generate_table_token', { p_table_id: tableId });
    if (res.error) throw new Error(`generate_table_token: ${res.error.message}`);
    return res.data as string;
  };

  /**
   * As a signed-in ANONYMOUS session — which is what a real scan is. A guest
   * scanning a card gets an anonymous Supabase session first, so the verify
   * always runs as `authenticated`; `anon` has no grant on it (0014/0071).
   */
  const verify = async (token: string) => {
    const guest = await anonymousSessionClient();
    return appRpc(guest, 'verify_table_token', { p_token: token }).then(outcome);
  };

  it('a token minted under the current secret verifies — the baseline', async () => {
    const token = await mint();
    const res = await verify(token);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.data).toBe(tableId);
  });

  /**
   * The whole point: mint a card, rotate the secret, and the card KEEPS WORKING
   * while `prev` is set.
   */
  it('a card printed under the OLD secret still works while prev is set', async () => {
    const oldCard = await mint();

    const r = await rotate();
    expect(r.ok, r.errorMessage).toBe(true);

    const res = await verify(oldCard);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.data).toBe(tableId);
  });

  it('a card minted AFTER the rotation verifies under the new secret', async () => {
    await rotate();
    const newCard = await mint();
    const res = await verify(newCard);
    expect(res.ok, res.errorMessage).toBe(true);
    expect(res.data).toBe(tableId);
  });

  /**
   * Step 4 of the rotation, and the one that gets forgotten: clearing `prev`
   * must actually kill the old cards.
   */
  it('the old card FAILS once prev is cleared', async () => {
    const oldCard = await mint();
    await rotate();
    expect((await verify(oldCard)).data).toBe(tableId); // still alive

    const c = await clearPrev();
    expect(c.ok, c.errorMessage).toBe(true);

    const after = await verify(oldCard);
    expect(after.data).toBeNull();
  });

  /**
   * Two rotations deep: a card from BEFORE the previous key is not resurrected
   * by the overlap. Only one generation back is ever accepted.
   */
  it('a card two rotations old never verifies — the overlap is one deep', async () => {
    const ancientCard = await mint();
    await rotate();          // ancientCard now signed by `prev`
    await rotate();          // …and now by nothing that is still live

    const res = await verify(ancientCard);
    expect(res.data).toBeNull();
  });

  /**
   * The overlap must be VISIBLE while it lasts, or step 4 is guesswork.
   */
  it('an acceptance under the previous secret writes an audit row', async () => {
    const oldCard = await mint();

    const before = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'table_token.accepted_prev_secret');

    await rotate();

    expect((await verify(oldCard)).data).toBe(tableId);

    const after = await svc
      .from('audit_log')
      .select('entity_id, after, reason_code', { count: 'exact' })
      .eq('action', 'table_token.accepted_prev_secret')
      .order('at', { ascending: false })
      .limit(1);

    expect((after.count ?? 0)).toBeGreaterThan(before.count ?? 0);
    const row = (after.data ?? [])[0] as { entity_id: string; reason_code: string };
    expect(row.entity_id).toBe(tableId);
    expect(row.reason_code).toBe('rotation_overlap');
  });

  /**
   * Step 4 must be a decision made against a number. Clearing while cards are
   * demonstrably still in use is a choice, not an accident.
   */
  it('clearing prev reports how many scans still arrived on the old key', async () => {
    const oldCard = await mint();
    await rotate();
    await verify(oldCard);                    // one scan on the old key

    const res = await clearPrev();
    expect(res.ok, res.errorMessage).toBe(true);
    expect((res.data as { accepted_on_prev_last_7d: number }).accepted_on_prev_last_7d)
      .toBeGreaterThan(0);
  });

  it('a card accepted under the CURRENT secret writes no rotation audit row', async () => {
    const token = await mint();
    const before = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'table_token.accepted_prev_secret');

    expect((await verify(token)).data).toBe(tableId);

    const after = await svc
      .from('audit_log')
      .select('id', { count: 'exact', head: true })
      .eq('action', 'table_token.accepted_prev_secret');
    expect(after.count ?? 0).toBe(before.count ?? 0);
  });

  it('garbage is still refused with prev set', async () => {
    await rotate();
    for (const bad of ['', 'not-a-token', 'AAAA', 'x'.repeat(600)]) {
      const res = await verify(bad);
      expect(res.data ?? null).toBeNull();
    }
  });
});
