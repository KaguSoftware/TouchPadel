import { describe, expect, it } from 'vitest';
import { ulid } from 'ulid';
import {
  MUTATION_TYPES,
  adjustmentApplyPayloadSchema,
  clientRefRegex,
  idempotencyKeyRegex,
  makeClientRef,
  makeIdempotencyKey,
  mutationEnvelopeSchema,
  orderAddItemsPayloadSchema,
  orderCreatePayloadSchema,
  orderItemVoidPayloadSchema,
  paymentRecordPayloadSchema,
  paymentRefundPayloadSchema,
  reservationCreatePayloadSchema,
  stockWastePayloadSchema,
  tabCancelPayloadSchema,
  tabOpenPayloadSchema,
  tabSettlePayloadSchema,
  tabSettleZeroPayloadSchema,
  ticketStatusPayloadSchema,
  type MutationEnvelope,
} from './mutations';

const STATION = 'TILL-01';
const UUID_A = '5c9f1f1e-2b3a-4c4d-8e9f-000000000001';
const UUID_B = '5c9f1f1e-2b3a-4c4d-8e9f-000000000002';
const UUID_STAFF = '5c9f1f1e-2b3a-4c4d-8e9f-0000000000aa';

function validEnvelope(): MutationEnvelope {
  return mutationEnvelopeSchema.parse({
    localId: makeClientRef(STATION),
    idempotencyKey: makeIdempotencyKey(STATION, 'order.create'),
    mutationType: 'order.create',
    payload: {
      clientRef: makeClientRef(STATION),
      tabClientRef: makeClientRef(STATION),
      items: [
        {
          clientRef: makeClientRef(STATION),
          menuItemId: UUID_A,
          variantId: UUID_B,
          qty: 2,
          modifiers: [{ modifierId: UUID_A, qty: 2 }],
        },
      ],
    },
    createdAt: new Date().toISOString(),
    staffId: UUID_STAFF,
    deviceId: STATION,
  });
}

describe('key formats (plan override: "{station}:{type}:{ulid}", refs "{station}-{ulid}")', () => {
  it('makeIdempotencyKey produces the exact format for every mutation type', () => {
    for (const type of MUTATION_TYPES) {
      const key = makeIdempotencyKey(STATION, type);
      expect(key).toMatch(idempotencyKeyRegex);
      expect(key.startsWith(`${STATION}:${type}:`)).toBe(true);
      expect(key.split(':')[2]).toHaveLength(26);
    }
  });

  it('makeClientRef produces "{station}-{ulid}"', () => {
    const ref = makeClientRef('KDS-01');
    expect(ref).toMatch(clientRefRegex);
    expect(ref.startsWith('KDS-01-')).toBe(true);
  });

  it('rejects malformed stations', () => {
    expect(() => makeIdempotencyKey('till 01', 'order.create')).toThrow();
    expect(() => makeIdempotencyKey('', 'order.create')).toThrow();
    expect(() => makeClientRef('lower-case')).toThrow();
  });

  it('regex rejects non-Crockford ulids and unknown types', () => {
    const badUlid = 'I'.repeat(26); // I is not in the Crockford alphabet
    expect(`${STATION}:order.create:${badUlid}`).not.toMatch(idempotencyKeyRegex);
    expect(`${STATION}:order.destroy:${ulid()}`).not.toMatch(idempotencyKeyRegex);
    expect(`${STATION}:order.create:${ulid().toLowerCase()}`).not.toMatch(idempotencyKeyRegex);
  });
});

describe('mutationEnvelopeSchema', () => {
  it('accepts a fully valid envelope', () => {
    const env = validEnvelope();
    expect(env.mutationType).toBe('order.create');
    if (env.mutationType === 'order.create') {
      expect(env.payload.items[0]?.qty).toBe(2);
    }
  });

  it('rejects a key whose type segment does not match mutationType', () => {
    const env = validEnvelope();
    const tampered = { ...env, idempotencyKey: makeIdempotencyKey(STATION, 'tab.settle') };
    expect(mutationEnvelopeSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects a key minted by a different station than deviceId', () => {
    const env = validEnvelope();
    const tampered = { ...env, idempotencyKey: makeIdempotencyKey('TILL-02', 'order.create') };
    expect(mutationEnvelopeSchema.safeParse(tampered).success).toBe(false);
  });

  it('rejects unknown mutation types and extra keys', () => {
    const env = validEnvelope();
    expect(
      mutationEnvelopeSchema.safeParse({ ...env, mutationType: 'order.destroy' }).success,
    ).toBe(false);
    expect(mutationEnvelopeSchema.safeParse({ ...env, extra: true }).success).toBe(false);
  });

  it('has an envelope variant for EVERY registered type — the sixth copy of the contract', () => {
    // envelopeVariants is the one copy of the six with no other gate: a type
    // appended to MUTATION_TYPES without a variant would fail at the
    // discriminator, not on its payload, and the queue would refuse the write.
    for (const type of MUTATION_TYPES) {
      const result = mutationEnvelopeSchema.safeParse({
        localId: makeClientRef(STATION),
        idempotencyKey: makeIdempotencyKey(STATION, type),
        mutationType: type,
        payload: {},
        createdAt: new Date().toISOString(),
        staffId: UUID_STAFF,
        deviceId: STATION,
      });
      if (result.success) continue; // a permissive (still-TODO) payload is fine
      // Only the ENVELOPE discriminator: a payload's own inner union
      // (adjustment.apply's `kind`) may fail on the empty payload, and should.
      const discriminator = result.error.issues.filter((i) => i.path.length === 1 && i.path[0] === 'mutationType');
      expect(discriminator, `${type} has no envelope variant`).toEqual([]);
    }
    // The gate itself: an unregistered type IS a discriminator failure.
    const unknown = mutationEnvelopeSchema.safeParse({
      localId: makeClientRef(STATION),
      idempotencyKey: `${STATION}:order.destroy:${ulid()}`,
      mutationType: 'order.destroy',
      payload: {},
      createdAt: new Date().toISOString(),
      staffId: UUID_STAFF,
      deviceId: STATION,
    });
    expect(unknown.success).toBe(false);
    expect(!unknown.success && unknown.error.issues.some((i) => i.path.length === 1 && i.path[0] === 'mutationType')).toBe(true);
  });

  it('still-TODO types accept any payload for now', () => {
    const result = mutationEnvelopeSchema.safeParse({
      localId: makeClientRef(STATION),
      idempotencyKey: makeIdempotencyKey(STATION, 'reservation.update'),
      mutationType: 'reservation.update',
      payload: { anything: 'goes — TODO schema' },
      createdAt: new Date().toISOString(),
      staffId: UUID_STAFF,
      deviceId: STATION,
    });
    expect(result.success).toBe(true);
  });

  it('drill-critical types now refuse junk payloads', () => {
    const result = mutationEnvelopeSchema.safeParse({
      localId: makeClientRef(STATION),
      idempotencyKey: makeIdempotencyKey(STATION, 'ticket.status'),
      mutationType: 'ticket.status',
      payload: { anything: 'goes' },
      createdAt: new Date().toISOString(),
      staffId: UUID_STAFF,
      deviceId: STATION,
    });
    expect(result.success).toBe(false);
  });

  it('stock.waste is no longer a TODO: a junk payload is refused at enqueue (item 9)', () => {
    const envelope = (payload: unknown) => ({
      localId: makeClientRef(STATION),
      idempotencyKey: makeIdempotencyKey(STATION, 'stock.waste'),
      mutationType: 'stock.waste',
      payload,
      createdAt: new Date().toISOString(),
      staffId: UUID_STAFF,
      deviceId: STATION,
    });
    expect(mutationEnvelopeSchema.safeParse(envelope({ anything: 'goes' })).success).toBe(false);
    const ok = mutationEnvelopeSchema.safeParse(envelope({ ingredientId: UUID_A, qty: 2.5, reasonCode: 'dropped a tray' }));
    expect(ok.success).toBe(true);
    // zod applied the default: the PARSED payload rides the queue with it.
    expect((ok.data as { payload: { movementType: string } }).payload.movementType).toBe('waste_spill');
  });

  it('requires ISO createdAt and uuid staffId', () => {
    const env = validEnvelope();
    expect(mutationEnvelopeSchema.safeParse({ ...env, createdAt: 'today' }).success).toBe(false);
    expect(mutationEnvelopeSchema.safeParse({ ...env, staffId: 'staff-1' }).success).toBe(false);
  });
});

describe('order.create payload', () => {
  const valid = () => ({
    clientRef: makeClientRef(STATION),
    tabId: UUID_A,
    items: [{ clientRef: makeClientRef(STATION), menuItemId: UUID_A, variantId: UUID_B, qty: 1 }],
  });

  it('requires exactly one of tabId / tabClientRef', () => {
    expect(orderCreatePayloadSchema.safeParse(valid()).success).toBe(true);
    expect(
      orderCreatePayloadSchema.safeParse({ ...valid(), tabClientRef: makeClientRef(STATION) })
        .success,
    ).toBe(false);
    const { tabId: _drop, ...neither } = valid();
    expect(orderCreatePayloadSchema.safeParse(neither).success).toBe(false);
  });

  it('requires at least one item with a positive integer qty', () => {
    expect(orderCreatePayloadSchema.safeParse({ ...valid(), items: [] }).success).toBe(false);
    const bad = valid();
    bad.items[0]!.qty = 0;
    expect(orderCreatePayloadSchema.safeParse(bad).success).toBe(false);
    bad.items[0]!.qty = 1.5;
    expect(orderCreatePayloadSchema.safeParse(bad).success).toBe(false);
  });

  it('REFUSES price fields — prices are server snapshots, never client input', () => {
    const forged = {
      ...valid(),
      items: [{ ...valid().items[0], unitPriceIqd: 1 }],
    };
    expect(orderCreatePayloadSchema.safeParse(forged).success).toBe(false);
  });

  it('modifier qty defaults to 1', () => {
    const parsed = orderCreatePayloadSchema.parse({
      ...valid(),
      items: [{ ...valid().items[0], modifiers: [{ modifierId: UUID_A }] }],
    });
    expect(parsed.items[0]?.modifiers[0]?.qty).toBe(1);
  });
});

describe('payment.record payload', () => {
  const cash = () => ({
    clientRef: makeClientRef(STATION),
    tabId: UUID_A,
    method: 'cash' as const,
    amountIqd: 26000,
    tenderedIqd: 30000,
    changeIqd: 4000,
  });

  it('accepts exact cash math and integer amounts', () => {
    expect(paymentRecordPayloadSchema.safeParse(cash()).success).toBe(true);
  });

  it('rejects wrong change and short tenders', () => {
    expect(paymentRecordPayloadSchema.safeParse({ ...cash(), changeIqd: 3999 }).success).toBe(
      false,
    );
    expect(paymentRecordPayloadSchema.safeParse({ ...cash(), tenderedIqd: 20000 }).success).toBe(
      false,
    );
  });

  it('rejects fractional money', () => {
    expect(paymentRecordPayloadSchema.safeParse({ ...cash(), amountIqd: 26000.5 }).success).toBe(
      false,
    );
  });

  it('card payments cannot carry tendered/change', () => {
    const card = { ...cash(), method: 'card' as const };
    expect(paymentRecordPayloadSchema.safeParse(card).success).toBe(false);
    const { tenderedIqd: _t, changeIqd: _c, ...clean } = card;
    expect(paymentRecordPayloadSchema.safeParse(clean).success).toBe(true);
  });

  it('changeIqd without tenderedIqd is rejected', () => {
    const { tenderedIqd: _t, ...noTender } = cash();
    expect(paymentRecordPayloadSchema.safeParse(noTender).success).toBe(false);
  });
});

describe('order.add_items payload', () => {
  const valid = () => ({
    tabId: UUID_A,
    items: [{ variantId: UUID_B, qty: 1 }],
  });

  it('accepts the lean till shape (no menuItemId/clientRef needed)', () => {
    expect(orderAddItemsPayloadSchema.safeParse(valid()).success).toBe(true);
  });

  it('requires at least one item and refuses price fields', () => {
    expect(orderAddItemsPayloadSchema.safeParse({ ...valid(), items: [] }).success).toBe(false);
    expect(
      orderAddItemsPayloadSchema.safeParse({
        ...valid(),
        items: [{ variantId: UUID_B, qty: 1, unitPriceIqd: 1 }],
      }).success,
    ).toBe(false);
  });

  it('modifier qty defaults to 1', () => {
    const parsed = orderAddItemsPayloadSchema.parse({
      ...valid(),
      items: [{ variantId: UUID_B, qty: 1, modifiers: [{ modifierId: UUID_A }] }],
    });
    expect(parsed.items[0]?.modifiers[0]?.qty).toBe(1);
  });

  it('takes exactly one of tabId / tabIdemKey — the offline tab reference', () => {
    const idemKey = makeIdempotencyKey(STATION, 'tab.open');
    const { tabId: _drop, ...rest } = valid();
    expect(orderAddItemsPayloadSchema.safeParse({ ...rest, tabIdemKey: idemKey }).success).toBe(
      true,
    );
    expect(orderAddItemsPayloadSchema.safeParse(rest).success).toBe(false);
    expect(
      orderAddItemsPayloadSchema.safeParse({ ...valid(), tabIdemKey: idemKey }).success,
    ).toBe(false);
    expect(
      tabSettlePayloadSchema.safeParse({ tabIdemKey: idemKey, method: 'card' }).success,
    ).toBe(true);
  });
});

describe('ticket.status payload', () => {
  it('accepts the five ticket_status enum values only', () => {
    for (const status of ['queued', 'preparing', 'ready', 'completed', 'voided'] as const) {
      expect(ticketStatusPayloadSchema.safeParse({ ticketId: UUID_A, status }).success).toBe(true);
    }
    expect(
      ticketStatusPayloadSchema.safeParse({ ticketId: UUID_A, status: 'burnt' }).success,
    ).toBe(false);
  });

  it('takes exactly one of ticketId / ticketIdemKey — the LAN bump reference', () => {
    const orderKey = makeIdempotencyKey(STATION, 'order.add_items');
    expect(
      ticketStatusPayloadSchema.safeParse({ ticketIdemKey: orderKey, status: 'ready' }).success,
    ).toBe(true);
    expect(ticketStatusPayloadSchema.safeParse({ status: 'ready' }).success).toBe(false);
    expect(
      ticketStatusPayloadSchema.safeParse({ ticketId: UUID_A, ticketIdemKey: orderKey, status: 'ready' })
        .success,
    ).toBe(false);
  });
});

describe('tab.open payload', () => {
  it('needs a table or a reservation — a seat, not just a name', () => {
    expect(tabOpenPayloadSchema.safeParse({ tableId: UUID_A }).success).toBe(true);
    expect(tabOpenPayloadSchema.safeParse({ reservationId: UUID_B }).success).toBe(true);
    expect(tabOpenPayloadSchema.safeParse({ tableId: UUID_A, label: 'Walk-in' }).success).toBe(true);
    expect(tabOpenPayloadSchema.safeParse({ label: 'Walk-in' }).success).toBe(false);
    expect(tabOpenPayloadSchema.safeParse({}).success).toBe(false);
  });

  it('does not accept whitespace as a label', () => {
    expect(tabOpenPayloadSchema.safeParse({ tableId: UUID_A, label: '   ' }).success).toBe(false);
    // …and a label that survives is stored trimmed.
    const parsed = tabOpenPayloadSchema.safeParse({ tableId: UUID_A, label: '  Ali  ' });
    expect(parsed.success && parsed.data.label).toBe('Ali');
  });
});

describe('tab.settle payload', () => {
  it('card settles cannot carry a cash tender', () => {
    expect(
      tabSettlePayloadSchema.safeParse({ tabId: UUID_A, method: 'card' }).success,
    ).toBe(true);
    expect(
      tabSettlePayloadSchema.safeParse({ tabId: UUID_A, method: 'card', tenderedIqd: 1000 })
        .success,
    ).toBe(false);
  });

  it('cash tender must cover the amount when both are present', () => {
    expect(
      tabSettlePayloadSchema.safeParse({
        tabId: UUID_A,
        method: 'cash',
        amountIqd: 26000,
        tenderedIqd: 30000,
      }).success,
    ).toBe(true);
    expect(
      tabSettlePayloadSchema.safeParse({
        tabId: UUID_A,
        method: 'cash',
        amountIqd: 26000,
        tenderedIqd: 20000,
      }).success,
    ).toBe(false);
  });
});

describe('adjustment.apply payload', () => {
  const discount = () => ({
    kind: 'discount_percent' as const,
    tabId: UUID_A,
    value: 2500,
    pin: '1234',
    reasonCode: 'staff_meal',
  });

  it('accepts a discount and a price override, each in its own shape', () => {
    expect(adjustmentApplyPayloadSchema.safeParse(discount()).success).toBe(true);
    expect(
      adjustmentApplyPayloadSchema.safeParse({
        kind: 'price_override',
        orderItemId: UUID_B,
        newUnitPriceIqd: 5000,
        pin: '1234',
        reasonCode: 'damaged_item',
      }).success,
    ).toBe(true);
  });

  it('caps discount_percent at 10000 basis points and requires a digits-only pin', () => {
    expect(adjustmentApplyPayloadSchema.safeParse({ ...discount(), value: 10_001 }).success).toBe(
      false,
    );
    expect(adjustmentApplyPayloadSchema.safeParse({ ...discount(), pin: '12a4' }).success).toBe(
      false,
    );
  });

  it('a price override must not carry a tabId — the item names the tab', () => {
    expect(
      adjustmentApplyPayloadSchema.safeParse({
        kind: 'price_override',
        orderItemId: UUID_B,
        newUnitPriceIqd: 5000,
        pin: '1234',
        reasonCode: 'damaged_item',
        tabId: UUID_A,
      }).success,
    ).toBe(false);
  });
});

describe('reservation.create payload', () => {
  const valid = () => ({
    clientRef: makeClientRef('DESK-01'),
    courtId: UUID_A,
    kind: 'booking' as const,
    startAt: '2026-09-07T15:00:00.000Z',
    endAt: '2026-09-07T16:00:00.000Z',
    guestName: 'Walk-in',
  });

  it('accepts booking/hold/maintenance kinds (plan enum)', () => {
    expect(reservationCreatePayloadSchema.safeParse(valid()).success).toBe(true);
    expect(
      reservationCreatePayloadSchema.safeParse({ ...valid(), kind: 'maintenance' }).success,
    ).toBe(true);
    expect(reservationCreatePayloadSchema.safeParse({ ...valid(), kind: 'lesson' }).success).toBe(
      false,
    );
  });

  it('requires endAt > startAt', () => {
    expect(
      reservationCreatePayloadSchema.safeParse({ ...valid(), endAt: valid().startAt }).success,
    ).toBe(false);
  });

  it('a booking needs guestId or guestName; maintenance does not', () => {
    const { guestName: _g, ...anonymous } = valid();
    expect(reservationCreatePayloadSchema.safeParse(anonymous).success).toBe(false);
    expect(
      reservationCreatePayloadSchema.safeParse({ ...anonymous, kind: 'maintenance' }).success,
    ).toBe(true);
    expect(
      reservationCreatePayloadSchema.safeParse({ ...anonymous, guestId: UUID_B }).success,
    ).toBe(true);
  });

  it('a legacy players field from an older till is stripped, never refused (0147)', () => {
    for (const players of [4, 1, 0, 9, 2.5, null, 'four']) {
      const r = reservationCreatePayloadSchema.safeParse({ ...valid(), players });
      expect(r.success).toBe(true);
      expect(r.success && 'players' in r.data).toBe(false);
    }
    // Stripping players does not loosen the shape: other unknown keys still fail.
    expect(
      reservationCreatePayloadSchema.safeParse({ ...valid(), players: 4, extra: 1 }).success,
    ).toBe(false);
  });

  it('refuses price/rate fields — the server prices the slot', () => {
    expect(
      reservationCreatePayloadSchema.safeParse({ ...valid(), priceIqd: 1 }).success,
    ).toBe(false);
    expect(
      reservationCreatePayloadSchema.safeParse({ ...valid(), rateRuleId: UUID_B }).success,
    ).toBe(false);
  });
});

describe('item 9 / C3 payloads (0120)', () => {
  it('tab.cancel and tab.settle_zero: a tab id and a non-blank reason, nothing else', () => {
    expect(tabCancelPayloadSchema.safeParse({ tabId: UUID_A, reasonCode: 'duplicate: opened twice' }).success).toBe(true);
    expect(tabCancelPayloadSchema.safeParse({ tabId: UUID_A, reasonCode: '   ' }).success).toBe(false);
    expect(tabCancelPayloadSchema.safeParse({ tabId: UUID_A, reasonCode: 'x', extra: 1 }).success).toBe(false);
    expect(tabSettleZeroPayloadSchema.safeParse({ tabId: UUID_A, reasonCode: 'booking_no_show' }).success).toBe(true);
    expect(tabSettleZeroPayloadSchema.safeParse({ tabId: 'not-a-uuid', reasonCode: 'x' }).success).toBe(false);
  });

  it('payment.refund: a positive integer amount, a 4-12 digit pin, optional non-empty items, no prices', () => {
    const base = { paymentId: UUID_A, amountIqd: 5000, pin: '1234', reasonCode: 'wrong_item' };
    expect(paymentRefundPayloadSchema.safeParse(base).success).toBe(true);
    expect(paymentRefundPayloadSchema.safeParse({ ...base, items: [{ orderItemId: UUID_B, qty: 1 }] }).success).toBe(true);
    expect(paymentRefundPayloadSchema.safeParse({ ...base, items: [] }).success).toBe(false);
    expect(paymentRefundPayloadSchema.safeParse({ ...base, amountIqd: 1.5 }).success).toBe(false);
    expect(paymentRefundPayloadSchema.safeParse({ ...base, amountIqd: 0 }).success).toBe(false);
    expect(paymentRefundPayloadSchema.safeParse({ ...base, pin: '12a4' }).success).toBe(false);
    expect(paymentRefundPayloadSchema.safeParse({ ...base, unitPriceIqd: 1 }).success).toBe(false);
  });

  it('order_item.void: the line, the pin and the reason', () => {
    expect(orderItemVoidPayloadSchema.safeParse({ orderItemId: UUID_B, pin: '123456', reasonCode: 'dropped' }).success).toBe(true);
    expect(orderItemVoidPayloadSchema.safeParse({ orderItemId: UUID_B, reasonCode: 'dropped' }).success).toBe(false);
  });

  it('stock.waste: a positive numeric quantity, the two waste movements only, spill by default', () => {
    const ok = stockWastePayloadSchema.safeParse({ ingredientId: UUID_A, qty: 0.25, reasonCode: 'spilled' });
    expect(ok.success && ok.data.movementType).toBe('waste_spill');
    expect(stockWastePayloadSchema.safeParse({ ingredientId: UUID_A, qty: 0, reasonCode: 'x' }).success).toBe(false);
    expect(stockWastePayloadSchema.safeParse({ ingredientId: UUID_A, qty: 1, movementType: 'expired_writeoff', reasonCode: 'x' }).success).toBe(false);
  });

  it('stock.waste: the store is optional, one of the two, and left out when absent (wave 5 §2.8.6)', () => {
    const bakery = stockWastePayloadSchema.safeParse({ ingredientId: UUID_A, qty: 1, reasonCode: 'x', location: 'bakery' });
    expect(bakery.success && bakery.data.location).toBe('bakery');
    const none = stockWastePayloadSchema.safeParse({ ingredientId: UUID_A, qty: 1, reasonCode: 'x' });
    expect(none.success && 'location' in none.data).toBe(false);
    expect(stockWastePayloadSchema.safeParse({ ingredientId: UUID_A, qty: 1, reasonCode: 'x', location: 'kitchen' }).success).toBe(false);
    expect(stockWastePayloadSchema.safeParse({ ingredientId: UUID_A, qty: 1, reasonCode: 'x', location: null }).success).toBe(false);
  });

  it('an envelope of each new type is minted and accepted with a matching key', () => {
    const cases = [
      ['tab.cancel', { tabId: UUID_A, reasonCode: 'duplicate' }],
      ['tab.settle_zero', { tabId: UUID_A, reasonCode: 'nothing_owed' }],
      ['payment.refund', { paymentId: UUID_A, amountIqd: 5000, pin: '1234', reasonCode: 'goodwill' }],
      ['order_item.void', { orderItemId: UUID_B, pin: '1234', reasonCode: 'dropped' }],
    ] as const;
    for (const [type, payload] of cases) {
      const env = {
        localId: makeClientRef(STATION),
        idempotencyKey: makeIdempotencyKey(STATION, type),
        mutationType: type,
        payload,
        createdAt: new Date().toISOString(),
        staffId: UUID_STAFF,
        deviceId: STATION,
      };
      expect(mutationEnvelopeSchema.safeParse(env).success, type).toBe(true);
      expect(mutationEnvelopeSchema.safeParse({ ...env, payload: { anything: 'goes' } }).success, type).toBe(false);
    }
  });
});
