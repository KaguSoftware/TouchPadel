/**
 * Telegram staff-group outbox + callback write-back (0032).
 *
 * The edge functions are NOT exercised here — only the DB contract they rely
 * on: enqueue-on-order / enqueue-on-call (render snapshot, one row per ref),
 * the service-role claim, app.telegram_apply_action's state machine + ledger,
 * the owner RPCs, and the "disabled => silent" posture.
 *
 * Runs against the live local stack; skips itself when the stack is down.
 * Settings flipped here are restored in afterAll.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  stackAvailable,
  serviceClient,
  signedInClient,
  appRpc,
  testIdemKey,
  outcome,
  SEED_STAFF,
  createTestMenuItem,
  addModifierToItem,
  createTestCafeTable,
  openGuestSession,
  ensureOpenDay,
  ensureTillFresh,
  setCafeSetting,
  snapshotCafeSettings,
  type GuestSession,
} from './helpers';

const up = await stackAvailable();

const CHAT_ID = '-1001234567890';
const AHMED = { tg_user_id: 4242, first_name: 'Ahmed', username: 'ahmed_tp' };
const NIL_UUID = '00000000-0000-4000-8000-000000000000';

type OutboxRow = {
  id: number;
  kind: string;
  ref_id: string | null;
  chat_id: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  last_error: string | null;
  scheduled_for: string;
};

describe.skipIf(!up)('telegram outbox + callback write-back (0032)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  let manager: SupabaseClient;
  let cashier: SupabaseClient;
  let restoreSettings: () => Promise<void>;

  let tableId: string;
  let tableNumber: string;
  let guest: GuestSession;
  let tea: { itemId: string; variantId: string };
  let cake: { itemId: string; variantId: string };
  let mintId: string;

  let orderId: string;
  let tabId: string;
  let ticketId: string;
  let orderTotal: number;
  let idemKey: string;
  let callId: string;
  let outboxOrderId: number;
  let outboxCallId: number;
  let testOutboxId: number;

  const applyAction = (action: string, refId: string, actor: Record<string, unknown> = AHMED) =>
    svc
      .schema('app')
      .rpc('telegram_apply_action', { p_action: action, p_ref_id: refId, p_actor: actor })
      .then(outcome);

  const outboxFor = async (kind: string, refId: string) => {
    const { data, error } = await svc
      .from('telegram_outbox')
      .select('id, kind, ref_id, chat_id, payload, status, attempts, last_error, scheduled_for')
      .eq('kind', kind)
      .eq('ref_id', refId);
    if (error) throw new Error(error.message);
    return data as OutboxRow[];
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);
    manager = await signedInClient(SEED_STAFF.manager);
    cashier = await signedInClient(SEED_STAFF.cashier);

    restoreSettings = await snapshotCafeSettings(svc, owner);
    await ensureTillFresh(svc);
    await ensureOpenDay(manager, svc);

    tea = await createTestMenuItem(svc, 'tg-tea', 2_000);
    await svc.from('menu_items').update({ name_ar: 'شاي عراقي', name_en: 'Iraqi Tea' }).eq('id', tea.itemId);
    const mint = await addModifierToItem(svc, tea.itemId, 'نعناع', 250);
    mintId = mint.modifierId;
    cake = await createTestMenuItem(svc, 'tg-cake', 5_500);
    await svc.from('menu_items').update({ name_ar: 'كيكة التمر', name_en: 'Date Cake' }).eq('id', cake.itemId);

    tableId = await createTestCafeTable(svc, 'TG');
    const { data: t } = await svc.from('cafe_tables').select('table_number').eq('id', tableId).single();
    tableNumber = (t as { table_number: string }).table_number;
    guest = await openGuestSession(owner, tableId);

    await setCafeSetting(owner, 'telegram_enabled', true);
    await setCafeSetting(owner, 'telegram_chat_id', CHAT_ID);
  });

  afterAll(async () => {
    await restoreSettings?.();
  });

  it('guest order enqueues exactly ONE order_new row with a bilingual render snapshot', async () => {
    idemKey = testIdemKey('order.create');
    const res = await appRpc(guest.client, 'create_guest_order', {
      p_items: [
        { variant_id: tea.variantId, qty: 2, modifiers: [{ modifier_id: mintId, qty: 1 }], notes: 'بدون سكر' },
        { variant_id: cake.variantId, qty: 1 },
      ],
      p_idempotency_key: idemKey,
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const d = res.data as { order_id: string; tab_id: string; ticket_id: string; total_iqd: number };
    orderId = d.order_id;
    tabId = d.tab_id;
    ticketId = d.ticket_id;
    orderTotal = Number(d.total_iqd);
    expect(orderTotal).toBe((2_000 + 250) * 2 + 5_500);

    const rows = await outboxFor('order_new', orderId);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    outboxOrderId = row.id;
    expect(row.status).toBe('queued');
    expect(row.attempts).toBe(0);
    expect(row.chat_id).toBe(CHAT_ID); // chat id snapshot at enqueue time

    const p = row.payload as {
      order_id: string;
      short_id: string;
      table_number: string;
      source: string;
      total_iqd: number;
      items: {
        qty: number;
        name_en: string;
        name_ar: string;
        variant_count: number;
        notes: string | null;
        modifiers: { name_en: string; name_ar: string; qty: number }[];
        line_total_iqd: number;
        discount_pct: number;
      }[];
    };
    expect(p.order_id).toBe(orderId);
    expect(p.short_id).toBe(orderId.slice(0, 8).toUpperCase());
    expect(p.table_number).toBe(tableNumber);
    expect(p.source).toBe('guest_web');
    expect(Number(p.total_iqd)).toBe(orderTotal);
    expect(p.items).toHaveLength(2);
    const teaLine = p.items.find((i) => i.name_en === 'Iraqi Tea')!;
    expect(teaLine.name_ar).toBe('شاي عراقي');
    expect(teaLine.qty).toBe(2);
    expect(teaLine.notes).toBe('بدون سكر');
    expect(teaLine.modifiers).toEqual([{ name_en: expect.any(String), name_ar: 'نعناع', qty: 1 }]);
    expect(Number(teaLine.line_total_iqd)).toBe(4_500);
    expect(teaLine.discount_pct).toBe(0);
    const cakeLine = p.items.find((i) => i.name_en === 'Date Cake')!;
    expect(cakeLine.name_ar).toBe('كيكة التمر');
    expect(cakeLine.modifiers).toEqual([]);
    for (const i of p.items) {
      expect(i.name_en.length).toBeGreaterThan(0);
      expect(i.name_ar.length).toBeGreaterThan(0);
    }
  });

  it('idempotent replay of create_guest_order does not double-enqueue', async () => {
    const replay = await appRpc(guest.client, 'create_guest_order', {
      p_items: [{ variant_id: tea.variantId, qty: 1 }],
      p_idempotency_key: idemKey,
    }).then(outcome);
    expect(replay.ok, replay.errorMessage).toBe(true);
    expect(replay.duplicate).toBe(true);
    expect((replay.data as { order_id: string }).order_id).toBe(orderId);

    expect(await outboxFor('order_new', orderId)).toHaveLength(1);
    const { count } = await svc
      .from('telegram_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('ref_id', orderId);
    expect(count).toBe(1);
  });

  it('waiter call enqueues a waiter_call row with table + reason', async () => {
    const raised = await appRpc(guest.client, 'raise_waiter_call', { p_reason: 'bill' }).then(outcome);
    expect(raised.ok, raised.errorMessage).toBe(true);
    callId = (raised.data as { call_id: string }).call_id;

    const rows = await outboxFor('waiter_call', callId);
    expect(rows).toHaveLength(1);
    outboxCallId = rows[0]!.id;
    const p = rows[0]!.payload as { call_id: string; table_number: string; reason: string; raised_at: string };
    expect(p.call_id).toBe(callId);
    expect(p.table_number).toBe(tableNumber);
    expect(p.reason).toBe('bill');
    expect(p.raised_at).toBeTruthy();
  });

  it('claim_due_telegram (service role) returns due rows and bumps attempts; an immediate second claim is empty; clients denied', async () => {
    const first = await svc.schema('app').rpc('claim_due_telegram', { p_limit: 50 });
    expect(first.error, first.error?.message).toBeNull();
    const claimed = first.data as OutboxRow[];
    const ours = claimed.filter((r) => r.id === outboxOrderId || r.id === outboxCallId);
    expect(ours).toHaveLength(2);
    for (const r of ours) {
      expect(r.attempts).toBe(1);
      expect(r.status).toBe('queued');
    }

    // Claimed rows are no longer due until their retry backoff elapses — two
    // overlapping senders (nudge + 10 s cron sweep) never double-send.
    const second = await svc.schema('app').rpc('claim_due_telegram', { p_limit: 50 });
    expect(second.error).toBeNull();
    expect(second.data).toEqual([]);

    const { data: after } = await svc
      .from('telegram_outbox')
      .select('id, attempts, scheduled_for')
      .in('id', [outboxOrderId, outboxCallId]);
    for (const r of after as { attempts: number; scheduled_for: string }[]) {
      expect(r.attempts).toBe(1);
      expect(new Date(r.scheduled_for).getTime()).toBeGreaterThan(Date.now() - 1_000);
    }

    for (const [label, client] of [
      ['guest', guest.client],
      ['cashier', cashier],
      ['manager', manager],
      ['owner', owner],
    ] as const) {
      const { error } = await appRpc(client, 'claim_due_telegram', { p_limit: 1 });
      expect(error?.message, label).toMatch(/permission denied/i);
      const apply = await appRpc(client, 'telegram_apply_action', {
        p_action: 'o:seen',
        p_ref_id: orderId,
        p_actor: AHMED,
      });
      expect(apply.error?.message, label).toMatch(/permission denied/i);
    }
  });

  it('o:seen -> ticket preparing with last_actor_label; a repeat tap is a duplicate', async () => {
    const seen = await applyAction('o:seen', orderId);
    expect(seen.ok, seen.errorMessage).toBe(true);
    const r = seen.data as { result: string; status: string; keyboard: string; actor_label: string };
    expect(r.result).toBe('applied');
    expect(r.status).toBe('preparing');
    expect(r.keyboard).toBe('order_seen');
    expect(r.actor_label).toBe('Telegram: Ahmed');

    const { data: t } = await svc
      .from('tickets')
      .select('status, started_at, last_actor_label')
      .eq('id', ticketId)
      .single();
    const tt = t as { status: string; started_at: string | null; last_actor_label: string | null };
    expect(tt.status).toBe('preparing');
    expect(tt.started_at).not.toBeNull();
    expect(tt.last_actor_label).toBe('Telegram: Ahmed');
    const { data: o } = await svc.from('orders').select('status').eq('id', orderId).single();
    expect((o as { status: string }).status).toBe('preparing');

    const again = await applyAction('o:seen', orderId, { tg_user_id: 7, first_name: 'Sara' });
    expect(again.ok, again.errorMessage).toBe(true);
    const r2 = again.data as { result: string; keyboard: string };
    expect(r2.result).toBe('duplicate');
    expect(r2.keyboard).toBe('unchanged');

    const missing = await applyAction('o:seen', NIL_UUID);
    expect((missing.data as { result: string }).result).toBe('not_found');
  });

  it('o:served -> ticket completed, order served (ready_at stamped on the way)', async () => {
    const served = await applyAction('o:served', orderId);
    expect(served.ok, served.errorMessage).toBe(true);
    const r = served.data as { result: string; status: string; keyboard: string };
    expect(r.result).toBe('applied');
    expect(r.status).toBe('completed');
    expect(r.keyboard).toBe('order_final');

    const { data: t } = await svc
      .from('tickets')
      .select('status, ready_at, completed_at, actual_prep_seconds, last_actor_label')
      .eq('id', ticketId)
      .single();
    const tt = t as { status: string; ready_at: string | null; completed_at: string | null; actual_prep_seconds: number | null };
    expect(tt.status).toBe('completed');
    expect(tt.ready_at).not.toBeNull();
    expect(tt.completed_at).not.toBeNull();
    expect(Number.isInteger(tt.actual_prep_seconds)).toBe(true);
    const { data: o } = await svc.from('orders').select('status').eq('id', orderId).single();
    expect((o as { status: string }).status).toBe('served');
    const { data: items } = await svc.from('order_items').select('ready_at').eq('order_id', orderId);
    expect((items as { ready_at: string | null }[]).every((i) => i.ready_at !== null)).toBe(true);

    const dup = await applyAction('o:served', orderId);
    expect((dup.data as { result: string }).result).toBe('duplicate');
  });

  it('w:ack / w:done stamp labels while acknowledged_by / resolved_by stay NULL', async () => {
    const ack = await applyAction('w:ack', callId);
    expect(ack.ok, ack.errorMessage).toBe(true);
    const a = ack.data as { result: string; status: string; keyboard: string };
    expect(a.result).toBe('applied');
    expect(a.status).toBe('acknowledged');
    expect(a.keyboard).toBe('call_acked');

    const { data: c1 } = await svc
      .from('waiter_calls')
      .select('status, acknowledged_by, acknowledged_label, acknowledged_at')
      .eq('id', callId)
      .single();
    const w1 = c1 as { status: string; acknowledged_by: string | null; acknowledged_label: string | null; acknowledged_at: string | null };
    expect(w1.status).toBe('acknowledged');
    expect(w1.acknowledged_by).toBeNull();
    expect(w1.acknowledged_label).toBe('Telegram: Ahmed');
    expect(w1.acknowledged_at).not.toBeNull();

    const ackAgain = await applyAction('w:ack', callId);
    expect((ackAgain.data as { result: string }).result).toBe('duplicate');

    const done = await applyAction('w:done', callId, { tg_user_id: 99, first_name: 'Noor' });
    expect(done.ok, done.errorMessage).toBe(true);
    const d = done.data as { result: string; status: string; keyboard: string; actor_label: string };
    expect(d.result).toBe('applied');
    expect(d.status).toBe('resolved');
    expect(d.keyboard).toBe('call_final');
    expect(d.actor_label).toBe('Telegram: Noor');

    const { data: c2 } = await svc
      .from('waiter_calls')
      .select('status, resolved_by, resolved_label, acknowledged_label')
      .eq('id', callId)
      .single();
    const w2 = c2 as { status: string; resolved_by: string | null; resolved_label: string | null; acknowledged_label: string };
    expect(w2.status).toBe('resolved');
    expect(w2.resolved_by).toBeNull();
    expect(w2.resolved_label).toBe('Telegram: Noor');
    expect(w2.acknowledged_label).toBe('Telegram: Ahmed'); // first stamp kept

    const doneAgain = await applyAction('w:done', callId);
    expect((doneAgain.data as { result: string }).result).toBe('duplicate');
    const missing = await applyAction('w:ack', NIL_UUID);
    expect((missing.data as { result: string }).result).toBe('not_found');
  });

  it('o:void on a settled tab is refused (nothing voided); the ledger records every tap', async () => {
    const settled = await appRpc(cashier, 'settle_tab', {
      p_tab_id: tabId,
      p_method: 'cash',
      p_tendered_iqd: orderTotal,
      p_idempotency_key: testIdemKey('payment.settle'),
    }).then(outcome);
    expect(settled.ok, settled.errorMessage).toBe(true);
    expect((settled.data as { status: string }).status).toBe('settled');

    const voided = await applyAction('o:void', orderId);
    expect(voided.ok, voided.errorMessage).toBe(true);
    const v = voided.data as { result: string; keyboard: string };
    expect(v.result).toBe('refused');
    expect(v.keyboard).toBe('unchanged');

    const { data: items } = await svc.from('order_items').select('voided').eq('order_id', orderId);
    expect((items as { voided: boolean }[]).every((i) => !i.voided)).toBe(true);
    const { data: t } = await svc.from('tickets').select('status').eq('id', ticketId).single();
    expect((t as { status: string }).status).toBe('completed');

    // Ledger: seen, seen(dup), served, served(dup), void(refused) for this order.
    const { data: ledger } = await svc
      .from('telegram_actions')
      .select('action, result, tg_user_id, tg_first_name, tg_username, detail')
      .eq('ref_id', orderId)
      .order('id');
    type Tap = { action: string; result: string; tg_user_id: number; tg_first_name: string; tg_username: string | null; detail: string | null };
    const taps = ledger as Tap[];
    expect(taps.map((x) => `${x.action}:${x.result}`)).toEqual([
      'o:seen:applied',
      'o:seen:duplicate',
      'o:served:applied',
      'o:served:duplicate',
      'o:void:refused',
    ]);
    expect(taps[0]!.tg_user_id).toBe(AHMED.tg_user_id);
    expect(taps[0]!.tg_first_name).toBe('Ahmed');
    expect(taps[0]!.tg_username).toBe('ahmed_tp');
    expect(taps[1]!.tg_first_name).toBe('Sara');
    expect(taps[4]!.detail).toBe('TAB_NOT_OPEN');

    // manager|owner read the ledger, cashier gets RLS silence.
    const mgr = await manager.from('telegram_actions').select('id').eq('ref_id', orderId);
    expect(mgr.error).toBeNull();
    expect(mgr.data).toHaveLength(5);
    const csh = await cashier.from('telegram_actions').select('id').eq('ref_id', orderId);
    expect(csh.error).toBeNull();
    expect(csh.data).toHaveLength(0);
    const cshOutbox = await cashier.from('telegram_outbox').select('id').eq('ref_id', orderId);
    expect(cshOutbox.error).toBeNull();
    expect(cshOutbox.data).toHaveLength(0);
  });

  it('telegram_apply_action rejects malformed input (INVALID_ACTION / REF_REQUIRED / ACTOR_REQUIRED)', async () => {
    const badAction = await applyAction('o:nope', orderId);
    expect(badAction.errorMessage).toContain('INVALID_ACTION');
    const noActor = await applyAction('o:seen', orderId, {});
    expect(noActor.errorMessage).toContain('ACTOR_REQUIRED');
    const noRef = await svc
      .schema('app')
      .rpc('telegram_apply_action', { p_action: 'o:seen', p_ref_id: null, p_actor: AHMED })
      .then(outcome);
    expect(noRef.errorMessage).toContain('REF_REQUIRED');
  });

  it('telegram_send_test: owner-only; enqueues a test row; TELEGRAM_NOT_CONFIGURED when disabled', async () => {
    const mgr = await appRpc(manager, 'telegram_send_test', {}).then(outcome);
    expect(mgr.errorMessage).toContain('FORBIDDEN');
    const csh = await appRpc(cashier, 'telegram_send_test', {}).then(outcome);
    expect(csh.errorMessage).toContain('FORBIDDEN');

    const sent = await appRpc(owner, 'telegram_send_test', {}).then(outcome);
    expect(sent.ok, sent.errorMessage).toBe(true);
    testOutboxId = Number((sent.data as { outbox_id: number }).outbox_id);
    const { data: row } = await owner
      .from('telegram_outbox')
      .select('kind, ref_id, chat_id, status, payload')
      .eq('id', testOutboxId)
      .single();
    const r = row as { kind: string; ref_id: string | null; chat_id: string; status: string; payload: { sent_by: string; at: string } };
    expect(r.kind).toBe('test');
    expect(r.ref_id).toBeNull();
    expect(r.chat_id).toBe(CHAT_ID);
    expect(r.status).toBe('queued');
    expect(r.payload.sent_by.length).toBeGreaterThan(0);
    expect(r.payload.at).toBeTruthy();

    // A second test message is allowed (no ref -> no unique clash).
    const sent2 = await appRpc(owner, 'telegram_send_test', {}).then(outcome);
    expect(sent2.ok, sent2.errorMessage).toBe(true);
    expect(Number((sent2.data as { outbox_id: number }).outbox_id)).not.toBe(testOutboxId);

    await setCafeSetting(owner, 'telegram_enabled', false);
    const off = await appRpc(owner, 'telegram_send_test', {}).then(outcome);
    expect(off.errorMessage).toContain('TELEGRAM_NOT_CONFIGURED');
    await setCafeSetting(owner, 'telegram_enabled', true);

    await setCafeSetting(owner, 'telegram_chat_id', null);
    const noChat = await appRpc(owner, 'telegram_send_test', {}).then(outcome);
    expect(noChat.errorMessage).toContain('TELEGRAM_NOT_CONFIGURED');
    await setCafeSetting(owner, 'telegram_chat_id', CHAT_ID);
  });

  it('retry_telegram_outbox resets a failed row (owner only)', async () => {
    const { error: failErr } = await svc
      .from('telegram_outbox')
      .update({ status: 'failed', attempts: 8, last_error: 'chat not found', scheduled_for: new Date(Date.now() + 3600_000).toISOString() })
      .eq('id', testOutboxId);
    expect(failErr).toBeNull();

    const mgr = await appRpc(manager, 'retry_telegram_outbox', { p_id: testOutboxId }).then(outcome);
    expect(mgr.errorMessage).toContain('FORBIDDEN');

    const retried = await appRpc(owner, 'retry_telegram_outbox', { p_id: testOutboxId }).then(outcome);
    expect(retried.ok, retried.errorMessage).toBe(true);
    const { data: row } = await svc
      .from('telegram_outbox')
      .select('status, attempts, last_error, scheduled_for')
      .eq('id', testOutboxId)
      .single();
    const r = row as { status: string; attempts: number; last_error: string | null; scheduled_for: string };
    expect(r.status).toBe('queued');
    expect(r.attempts).toBe(0);
    expect(r.last_error).toBeNull();
    expect(new Date(r.scheduled_for).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);

    // It is due again: the next claim picks it up.
    const claim = await svc.schema('app').rpc('claim_due_telegram', { p_limit: 100 });
    expect(claim.error).toBeNull();
    expect((claim.data as OutboxRow[]).some((x) => x.id === testOutboxId)).toBe(true);

    const missing = await appRpc(owner, 'retry_telegram_outbox', { p_id: -1 }).then(outcome);
    expect(missing.errorMessage).toContain('OUTBOX_NOT_FOUND');
  });

  it('with telegram_enabled=false nothing is enqueued (orders and calls still succeed)', async () => {
    await setCafeSetting(owner, 'telegram_enabled', false);

    const quietTable = await createTestCafeTable(svc, 'TG-OFF');
    const quiet = await openGuestSession(owner, quietTable);

    const res = await appRpc(quiet.client, 'create_guest_order', {
      p_items: [{ variant_id: cake.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res.ok, res.errorMessage).toBe(true);
    const quietOrder = (res.data as { order_id: string }).order_id;
    expect(await outboxFor('order_new', quietOrder)).toHaveLength(0);

    const raised = await appRpc(quiet.client, 'raise_waiter_call', { p_reason: 'water' }).then(outcome);
    expect(raised.ok, raised.errorMessage).toBe(true);
    const quietCall = (raised.data as { call_id: string }).call_id;
    expect(await outboxFor('waiter_call', quietCall)).toHaveLength(0);

    // Enabled but no chat id: also silent.
    await setCafeSetting(owner, 'telegram_enabled', true);
    await setCafeSetting(owner, 'telegram_chat_id', null);
    const res2 = await appRpc(quiet.client, 'create_guest_order', {
      p_items: [{ variant_id: tea.variantId, qty: 1 }],
      p_idempotency_key: testIdemKey('order.create'),
    }).then(outcome);
    expect(res2.ok, res2.errorMessage).toBe(true);
    expect(await outboxFor('order_new', (res2.data as { order_id: string }).order_id)).toHaveLength(0);
  });

  it('telegram_nudge is a silent no-op without pg_net / secrets (never throws); clients cannot call it', async () => {
    const nudge = await svc.schema('app').rpc('telegram_nudge', {});
    expect(nudge.error, nudge.error?.message).toBeNull();

    const client = await appRpc(owner, 'telegram_nudge', {});
    expect(client.error?.message).toMatch(/permission denied/i);
    const payload = await appRpc(owner, 'telegram_order_payload', { p_order_id: orderId });
    expect(payload.error?.message).toMatch(/permission denied/i);
  });
});
