import { describe, expect, it } from 'vitest';
import { MUTATION_TYPES } from '@touch/core/schemas/mutations';
import { DIRECT_RPC } from './mutate';

/**
 * DIRECT_RPC mirrors the replay function's arg mappers
 * (packages/db/supabase/functions/replay/index.ts MUTATION_RPCS) — one payload
 * shape, two transports. These golden-args tests are the drift guard: a mapper
 * change there must land here, and vice versa.
 */

const KEY = 'TILL1:order.create:01J5XABCDEFGHJKMNPQRSTVWXY';
const DEV = 'TILL1';
const UUID_A = '5c9f1f1e-2b3a-4c4d-8e9f-000000000001';
const UUID_B = '5c9f1f1e-2b3a-4c4d-8e9f-000000000002';

describe('DIRECT_RPC', () => {
  it('covers every registered mutation type', () => {
    expect(Object.keys(DIRECT_RPC).sort()).toEqual([...MUTATION_TYPES].sort());
  });

  it('order.add_items maps to till_add_items with snake_case items', () => {
    const call = DIRECT_RPC['order.add_items'](
      {
        tabId: UUID_A,
        items: [
          { variantId: UUID_B, qty: 2, notes: 'no ice', modifiers: [{ modifierId: UUID_A, qty: 1 }] },
          { variantId: UUID_B, qty: 1, modifiers: [] },
        ],
      },
      KEY,
      DEV,
    );
    expect(call.fn).toBe('till_add_items');
    expect(call.args).toEqual({
      p_tab_id: UUID_A,
      p_items: [
        { variant_id: UUID_B, qty: 2, notes: 'no ice', modifiers: [{ modifier_id: UUID_A, qty: 1 }] },
        { variant_id: UUID_B, qty: 1, modifiers: [] },
      ],
      p_idempotency_key: KEY,
      p_device_id: DEV,
    });
  });

  it('ticket.status declares NO idempotency key — the RPC is transition-idempotent', () => {
    const call = DIRECT_RPC['ticket.status']({ ticketId: UUID_A, status: 'ready' }, KEY, DEV);
    expect(call.fn).toBe('set_ticket_status');
    expect(call.args).toEqual({ p_ticket_id: UUID_A, p_status: 'ready', p_device_id: DEV });
    expect('p_idempotency_key' in call.args).toBe(false);
  });

  it('tab.settle maps method and cash fields, nulling absent tenders', () => {
    const call = DIRECT_RPC['tab.settle'](
      { tabId: UUID_A, method: 'cash', amountIqd: 26000, tenderedIqd: 30000 },
      KEY,
      DEV,
    );
    expect(call.fn).toBe('settle_tab');
    expect(call.args.p_tendered_iqd).toBe(30000);
    const card = DIRECT_RPC['tab.settle']({ tabId: UUID_A, method: 'card' }, KEY, DEV);
    expect(card.args.p_tendered_iqd).toBeNull();
    expect(card.args.p_amount_iqd).toBeNull();
  });

  it('adjustment.apply discriminates discount vs price override, both idempotent (0049)', () => {
    const discount = DIRECT_RPC['adjustment.apply'](
      { kind: 'discount_percent', tabId: UUID_A, value: 2500, pin: '1234', reasonCode: 'comp' },
      KEY,
      DEV,
    );
    expect(discount.fn).toBe('apply_discount');
    expect(discount.args.p_idempotency_key).toBe(KEY);
    const override = DIRECT_RPC['adjustment.apply'](
      { kind: 'price_override', orderItemId: UUID_B, newUnitPriceIqd: 5000, pin: '1234', reasonCode: 'damage' },
      KEY,
      DEV,
    );
    expect(override.fn).toBe('override_price');
    expect(override.args).toEqual({
      p_order_item_id: UUID_B,
      p_new_unit_price_iqd: 5000,
      p_pin: '1234',
      p_reason_code: 'damage',
      p_idempotency_key: KEY,
      p_device_id: DEV,
    });
  });

  it('reservation.update carries the override reason on ALL four actions (SOW L313)', () => {
    for (const [action, fn, extra] of [
      ['mark', 'mark_reservation', { status: 'arrived' }],
      ['extend', 'extend_reservation', { newEndAt: '2026-09-07T16:00:00.000Z' }],
      ['move', 'move_reservation', { courtId: UUID_B }],
      ['cancel', 'cancel_reservation', {}],
    ] as const) {
      const call = DIRECT_RPC['reservation.update'](
        { action, reservationId: UUID_A, reason: 'guest_request', ...extra },
        KEY,
        DEV,
      );
      expect(call.fn).toBe(fn);
      expect(call.args.p_reason, `${action} must carry p_reason`).toBe('guest_request');
    }
  });

  it('reservation.update refuses an unknown action', () => {
    expect(() =>
      DIRECT_RPC['reservation.update']({ action: 'upgrade', reservationId: UUID_A }, KEY, DEV),
    ).toThrow(/unknown action/);
  });

  it('reservation.create passes the client ref for replay-time dedupe', () => {
    const call = DIRECT_RPC['reservation.create'](
      {
        clientRef: 'DESK-01-01J5XABCDEFGHJKMNPQRSTVWXY',
        courtId: UUID_A,
        kind: 'booking',
        startAt: '2026-09-07T15:00:00.000Z',
        endAt: '2026-09-07T16:00:00.000Z',
        guestName: 'Walk-in',
      },
      KEY,
      DEV,
    );
    expect(call.fn).toBe('staff_create_reservation');
    expect(call.args.p_client_ref).toBe('DESK-01-01J5XABCDEFGHJKMNPQRSTVWXY');
    expect(call.args.p_guest_id).toBeNull();
  });

  it('waiter_call.action routes ack vs resolve', () => {
    expect(DIRECT_RPC['waiter_call.action']({ callId: UUID_A, action: 'ack' }, KEY, DEV).fn).toBe(
      'ack_waiter_call',
    );
    expect(
      DIRECT_RPC['waiter_call.action']({ callId: UUID_A, action: 'resolve' }, KEY, DEV).fn,
    ).toBe('resolve_waiter_call');
  });

  it('never lets a price field through — prices are server snapshots', () => {
    const call = DIRECT_RPC['order.add_items'](
      { tabId: UUID_A, items: [{ variantId: UUID_B, qty: 1, unitPriceIqd: 1 }] },
      KEY,
      DEV,
    );
    // The mapper simply does not read price fields; nothing client-side can
    // smuggle one into p_items. (The zod schema refuses them earlier anyway.)
    expect(JSON.stringify(call.args)).not.toContain('unitPriceIqd');
    expect(JSON.stringify(call.args)).not.toContain('price');
  });
});
