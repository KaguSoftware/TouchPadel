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
  paymentRecordPayloadSchema,
  reservationCreatePayloadSchema,
  tabOpenPayloadSchema,
  tabSettlePayloadSchema,
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
});

describe('tab.open payload', () => {
  it('needs at least a table, a label or a reservation', () => {
    expect(tabOpenPayloadSchema.safeParse({ tableId: UUID_A }).success).toBe(true);
    expect(tabOpenPayloadSchema.safeParse({ label: 'Walk-in' }).success).toBe(true);
    expect(tabOpenPayloadSchema.safeParse({ reservationId: UUID_B }).success).toBe(true);
    expect(tabOpenPayloadSchema.safeParse({}).success).toBe(false);
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

  it('refuses price/rate fields — the server prices the slot', () => {
    expect(
      reservationCreatePayloadSchema.safeParse({ ...valid(), priceIqd: 1 }).success,
    ).toBe(false);
    expect(
      reservationCreatePayloadSchema.safeParse({ ...valid(), rateRuleId: UUID_B }).success,
    ).toBe(false);
  });
});
