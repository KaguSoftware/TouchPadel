import { z } from 'zod';
import { ulid } from 'ulid';

/**
 * MutationEnvelope — the unit stored in the till's durable SQLite queue and replayed through
 * the server RPCs (design-arch.md 2.1/2.2). Shared by the Electron main process (validate
 * before INSERT), the replay path, and tests.
 *
 * Resolved plan overrides (win over any contrary doc text):
 * - idempotency key format:  "{station}:{mutation_type}:{ulid}"
 * - client entity refs:      "{station}-{ulid}"
 *
 * SECURITY: payloads NEVER carry prices. Prices are snapshotted server-side from the DB at
 * send/settle time — a queued mutation that could name its own price would be a forgery path.
 */

export const MUTATION_TYPES = [
  'order.create',
  'order.add_items',
  'ticket.status',
  'payment.record',
  'reservation.create',
  'reservation.update',
  'waiter_call.action',
  'stock.waste',
  'tab.open',
  'tab.settle',
  'adjustment.apply',
] as const;

export type MutationType = (typeof MUTATION_TYPES)[number];

/** Crockford base32, 26 chars (no I, L, O, U). */
const ULID_SRC = '[0-9A-HJKMNP-TV-Z]{26}';
/** Station / device id, e.g. 'TILL-01', 'DESK-01', 'KDS-01'. */
const STATION_SRC = '[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*';

const MUTATION_TYPE_ALT = MUTATION_TYPES.map((t) => t.replace(/\./g, '\\.')).join('|');

export const stationRegex = new RegExp(`^${STATION_SRC}$`);
export const clientRefRegex = new RegExp(`^${STATION_SRC}-${ULID_SRC}$`);
export const idempotencyKeyRegex = new RegExp(
  `^${STATION_SRC}:(?:${MUTATION_TYPE_ALT}):${ULID_SRC}$`,
);

export const stationSchema = z.string().regex(stationRegex, 'expected a station id like TILL-01');
export const clientRefSchema = z
  .string()
  .regex(clientRefRegex, 'expected a client ref "{station}-{ulid}"');
export const idempotencyKeySchema = z
  .string()
  .regex(idempotencyKeyRegex, 'expected an idempotency key "{station}:{mutation_type}:{ulid}"');

/** Build "{station}:{type}:{ulid}" with a fresh ULID. */
export function makeIdempotencyKey(station: string, type: MutationType): string {
  stationSchema.parse(station);
  if (!MUTATION_TYPES.includes(type)) {
    throw new RangeError(`unknown mutation type '${String(type)}'`);
  }
  return `${station}:${type}:${ulid()}`;
}

/** Build a client entity ref "{station}-{ulid}" (stored server-side as client_ref). */
export function makeClientRef(station: string): string {
  stationSchema.parse(station);
  return `${station}-${ulid()}`;
}

// ---------------------------------------------------------------------------
// Per-type payload schemas
// ---------------------------------------------------------------------------

const uuid = z.string().uuid();
const isoDateTime = z.string().datetime({ offset: true });
/** Integer IQD amount — money is never fractional. */
const intIqd = z.number().int().nonnegative();

export const orderCreatePayloadSchema = z
  .object({
    /** Client-generated id for the order row; server assigns the canonical UUID. */
    clientRef: clientRefSchema,
    /** Exactly one of: server tab UUID, or the client ref of a tab queued in the same batch. */
    tabId: uuid.optional(),
    tabClientRef: clientRefSchema.optional(),
    tableId: uuid.optional(),
    items: z
      .array(
        z
          .object({
            clientRef: clientRefSchema,
            menuItemId: uuid,
            variantId: uuid,
            qty: z.number().int().positive(),
            notes: z.string().max(500).optional(),
            modifiers: z
              .array(
                z
                  .object({
                    modifierId: uuid,
                    /** double shot = qty 2 */
                    qty: z.number().int().positive().default(1),
                  })
                  .strict(),
              )
              .default([]),
          })
          .strict(),
      )
      .min(1),
    // NOTE: no price fields — unit_price_iqd / line_total_iqd are DB snapshots at send time.
  })
  .strict()
  .refine((p) => (p.tabId !== undefined) !== (p.tabClientRef !== undefined), {
    message: 'exactly one of tabId or tabClientRef is required',
    path: ['tabId'],
  });

export type OrderCreatePayload = z.infer<typeof orderCreatePayloadSchema>;

export const paymentRecordPayloadSchema = z
  .object({
    clientRef: clientRefSchema,
    tabId: uuid.optional(),
    tabClientRef: clientRefSchema.optional(),
    method: z.enum(['cash', 'card']),
    amountIqd: intIqd,
    /** Cash only: what the guest handed over / what the drawer returned. */
    tenderedIqd: intIqd.optional(),
    changeIqd: intIqd.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.tabId !== undefined) === (p.tabClientRef !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one of tabId or tabClientRef is required',
        path: ['tabId'],
      });
    }
    if (p.method === 'card') {
      if (p.tenderedIqd !== undefined || p.changeIqd !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tenderedIqd/changeIqd are cash-only fields',
          path: ['tenderedIqd'],
        });
      }
      return;
    }
    // cash
    if (p.changeIqd !== undefined && p.tenderedIqd === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'changeIqd requires tenderedIqd',
        path: ['changeIqd'],
      });
    }
    if (p.tenderedIqd !== undefined) {
      if (p.tenderedIqd < p.amountIqd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'tenderedIqd must be >= amountIqd',
          path: ['tenderedIqd'],
        });
      } else if (p.changeIqd !== undefined && p.changeIqd !== p.tenderedIqd - p.amountIqd) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: 'changeIqd must equal tenderedIqd - amountIqd exactly',
          path: ['changeIqd'],
        });
      }
    }
  });

export type PaymentRecordPayload = z.infer<typeof paymentRecordPayloadSchema>;

export const reservationCreatePayloadSchema = z
  .object({
    clientRef: clientRefSchema,
    courtId: uuid,
    kind: z.enum(['booking', 'hold', 'maintenance']),
    startAt: isoDateTime,
    endAt: isoDateTime,
    guestId: uuid.optional(),
    guestName: z.string().min(1).max(200).optional(),
    guestPhone: z.string().min(3).max(30).optional(),
    notes: z.string().max(1000).optional(),
    // NOTE: no rate_rule_id / price_iqd — the server prices the slot and stamps provenance.
  })
  .strict()
  .superRefine((p, ctx) => {
    if (Date.parse(p.endAt) <= Date.parse(p.startAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'endAt must be after startAt',
        path: ['endAt'],
      });
    }
    if (p.kind === 'booking' && p.guestId === undefined && p.guestName === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'a booking needs guestId or guestName',
        path: ['guestName'],
      });
    }
  });

export type ReservationCreatePayload = z.infer<typeof reservationCreatePayloadSchema>;

// TODO(core): tighten the remaining payloads as their RPCs land (W2-W3):
// order.add_items, ticket.status, reservation.update, waiter_call.action, stock.waste,
// tab.open, tab.settle, adjustment.apply currently accept z.unknown().
const todoPayload = z.unknown();

// ---------------------------------------------------------------------------
// Envelope
// ---------------------------------------------------------------------------

const baseFields = {
  /** Client-generated envelope id, "{station}-{ulid}" (station may differ from deviceId when
   *  the till enqueues on the KDS's behalf — single-writer stays with the till). */
  localId: clientRefSchema,
  idempotencyKey: idempotencyKeySchema,
  createdAt: isoDateTime,
  staffId: uuid,
  /** The station that owns the durable queue, e.g. 'TILL-01'. */
  deviceId: stationSchema,
} as const;

const envelopeVariants = z.discriminatedUnion('mutationType', [
  z
    .object({
      ...baseFields,
      mutationType: z.literal('order.create'),
      payload: orderCreatePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('payment.record'),
      payload: paymentRecordPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('reservation.create'),
      payload: reservationCreatePayloadSchema,
    })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('order.add_items'), payload: todoPayload })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('ticket.status'), payload: todoPayload })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('reservation.update'), payload: todoPayload })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('waiter_call.action'), payload: todoPayload })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('stock.waste'), payload: todoPayload })
    .strict(),
  z.object({ ...baseFields, mutationType: z.literal('tab.open'), payload: todoPayload }).strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('tab.settle'), payload: todoPayload })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('adjustment.apply'), payload: todoPayload })
    .strict(),
]);

/**
 * Full envelope schema. Beyond per-field shape it enforces internal consistency:
 * the idempotency key's station segment must equal deviceId (the queue owner mints the key)
 * and its type segment must equal mutationType.
 */
export const mutationEnvelopeSchema = envelopeVariants.superRefine((env, ctx) => {
  const segments = env.idempotencyKey.split(':');
  if (segments[0] !== env.deviceId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `idempotencyKey station '${segments[0] ?? ''}' does not match deviceId '${env.deviceId}'`,
      path: ['idempotencyKey'],
    });
  }
  if (segments[1] !== env.mutationType) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: `idempotencyKey type '${segments[1] ?? ''}' does not match mutationType '${env.mutationType}'`,
      path: ['idempotencyKey'],
    });
  }
});

export type MutationEnvelope = z.infer<typeof mutationEnvelopeSchema>;
