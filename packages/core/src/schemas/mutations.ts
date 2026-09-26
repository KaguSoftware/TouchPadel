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
  // Item 9 / C3 (0120): the till's money corrections, queued like everything else.
  // Appended in this order in EVERY copy (the shell's test compares arrays).
  'tab.cancel',
  'tab.settle_zero',
  'payment.refund',
  'order_item.void',
] as const;

export type MutationType = (typeof MUTATION_TYPES)[number];

/**
 * RPCs that take a manager PIN. Since migration 0115 they do not check the PIN
 * themselves: the caller proves it to app.verify_manager_pin first (its own
 * transaction, so the attempt persists and the lockout can engage) and the RPC
 * consumes the single-use grant that verification minted. Every transport that
 * calls one of these must verify first — apps/operator/src/lib/appRpc.ts,
 * packages/db/tests/helpers.ts and functions/replay/index.ts do. The list is
 * mirrored in functions/_shared/mutation-types.json for Deno; a test holds
 * them equal.
 */
export const PIN_GATED_RPCS = [
  'apply_discount',
  'override_price',
  'refund',
  'void_after_send',
  'write_off_expired',
] as const;
export const PIN_GATED_RPC_SET: ReadonlySet<string> = new Set(PIN_GATED_RPCS);

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

/**
 * 0147 dropped the group size (padel is always four). A payload queued by a
 * till on an older build may still carry `players`; it is removed here before
 * the strict shape check, so that row drains instead of being refused. Every
 * other unknown key (a price, a rate id) is still refused by `.strict()`.
 */
function dropLegacyPlayers(raw: unknown): unknown {
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw) && 'players' in raw) {
    const { players: _legacy, ...rest } = raw as Record<string, unknown>;
    return rest;
  }
  return raw;
}

const reservationCreateShape = z
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

export const reservationCreatePayloadSchema = z.preprocess(dropLegacyPlayers, reservationCreateShape);

export type ReservationCreatePayload = z.infer<typeof reservationCreatePayloadSchema>;

/**
 * order.add_items — replayed through app.till_add_items. The replay mapper reads
 * variantId/qty/notes/modifiers per item (menuItemId/clientRef are order.create-only,
 * where the client names rows it created offline).
 *
 * tabIdemKey is the OFFLINE tab reference: a tab opened while disconnected has no
 * server id yet, but its tab.open envelope's idempotency key is unique on `tabs`
 * and strictly precedes this row in the queue — replay resolves it server-side.
 */
export const orderAddItemsPayloadSchema = z
  .object({
    tabId: uuid.optional(),
    tabIdemKey: idempotencyKeySchema.optional(),
    items: z
      .array(
        z
          .object({
            variantId: uuid,
            qty: z.number().int().positive(),
            notes: z.string().max(500).optional(),
            modifiers: z
              .array(z.object({ modifierId: uuid, qty: z.number().int().positive().default(1) }).strict())
              .default([]),
          })
          .strict(),
      )
      .min(1),
    /**
     * 0146: every line is a Touch Shop item. The server decides this from the
     * rows (no ticket for a shop order); the flag only tells the till's LAN KDS
     * fallback, which knows nothing of the menu, not to show a racket to the kitchen.
     */
    shop: z.literal(true).optional(),
    // NOTE: no price fields — unit_price_iqd / line_total_iqd are DB snapshots at send time.
  })
  .strict()
  .refine((p) => (p.tabId !== undefined) !== (p.tabIdemKey !== undefined), {
    message: 'exactly one of tabId or tabIdemKey is required',
    path: ['tabId'],
  });

export type OrderAddItemsPayload = z.infer<typeof orderAddItemsPayloadSchema>;

/**
 * ticket.status — app.set_ticket_status; transition-idempotent server-side.
 * ticketIdemKey references a ticket whose order was itself queued offline (the
 * order envelope's key) — replay resolves it via orders.idempotency_key →
 * tickets.order_id, strictly after the order row lands.
 */
export const ticketStatusPayloadSchema = z
  .object({
    ticketId: uuid.optional(),
    ticketIdemKey: idempotencyKeySchema.optional(),
    status: z.enum(['queued', 'preparing', 'ready', 'completed', 'voided']),
  })
  .strict()
  .refine((p) => (p.ticketId !== undefined) !== (p.ticketIdemKey !== undefined), {
    message: 'exactly one of ticketId or ticketIdemKey is required',
    path: ['ticketId'],
  });

export type TicketStatusPayload = z.infer<typeof ticketStatusPayloadSchema>;

/**
 * tab.open — app.open_tab(p_table_id, p_label, p_reservation_id, ...).
 *
 * The anchor is a SEAT: a table, or a reservation (which carries its own
 * court). `label` is the tab's display name and is NOT an anchor — a tab with
 * nothing but a name is unfindable by anyone who did not open it, and the
 * untrimmed version let a single space stand in for one. `.trim()` runs before
 * `.min(1)`, so whitespace fails the length check instead of passing it.
 * Mirrored by app.open_tab (migration 0084) and by the till's new-tab dialog.
 */
export const tabOpenPayloadSchema = z
  .object({
    tableId: uuid.optional(),
    label: z.string().trim().min(1).max(200).optional(),
    reservationId: uuid.optional(),
    /** 0145: a Touch Shop counter sale — the one tab that needs no table or booking, only a label. */
    kind: z.enum(['cafe', 'shop']).optional(),
  })
  .strict()
  .refine(
    (p) =>
      p.tableId !== undefined ||
      p.reservationId !== undefined ||
      (p.kind === 'shop' && p.label !== undefined),
    {
      message: 'a tab needs a table or a reservation (a shop counter sale needs a label)',
      path: ['tableId'],
    },
  );

export type TabOpenPayload = z.infer<typeof tabOpenPayloadSchema>;

/**
 * tab.settle — app.settle_tab. amountIqd/tenderedIqd optional (the server computes
 * the due total from its own rows; the tender is cash bookkeeping only).
 */
export const tabSettlePayloadSchema = z
  .object({
    tabId: uuid.optional(),
    /** Offline tab reference — see orderAddItemsPayloadSchema. */
    tabIdemKey: idempotencyKeySchema.optional(),
    method: z.enum(['cash', 'card']),
    amountIqd: intIqd.optional(),
    tenderedIqd: intIqd.optional(),
    /**
     * The bill total the clerk was shown (0106). When present, settle_tab
     * refuses with TOTAL_CHANGED if the server's total differs, so a card
     * amount keyed into the terminal can never silently disagree with the bill.
     */
    expectedTotalIqd: intIqd.optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if ((p.tabId !== undefined) === (p.tabIdemKey !== undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one of tabId or tabIdemKey is required',
        path: ['tabId'],
      });
    }
    if (p.method === 'card' && p.tenderedIqd !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tenderedIqd is a cash-only field',
        path: ['tenderedIqd'],
      });
    }
    if (p.tenderedIqd !== undefined && p.amountIqd !== undefined && p.tenderedIqd < p.amountIqd) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'tenderedIqd must be >= amountIqd',
        path: ['tenderedIqd'],
      });
    }
  });

export type TabSettlePayload = z.infer<typeof tabSettlePayloadSchema>;

/**
 * adjustment.apply — kind discriminates app.override_price vs app.apply_discount
 * (adjustment_kind enum, 0002). The PIN rides in the payload because the server
 * re-verifies it at replay — the queue never becomes a PIN bypass. Discount value
 * for discount_percent is basis points (25% = 2500).
 */
export const adjustmentApplyPayloadSchema = z
  .discriminatedUnion('kind', [
    // zod v3 discriminatedUnion members must be plain ZodObjects — cross-field
    // refinements live on the union below.
    z
      .object({
        kind: z.literal('price_override'),
        orderItemId: uuid,
        newUnitPriceIqd: intIqd,
        pin: z.string().regex(/^\d{4,12}$/, 'pin must be 4-12 digits'),
        reasonCode: z.string().min(1).max(64),
      })
      .strict(),
    z
      .object({
        kind: z.enum(['discount_percent', 'discount_amount']),
        tabId: uuid,
        value: z.number().int().positive(),
        pin: z.string().regex(/^\d{4,12}$/, 'pin must be 4-12 digits'),
        reasonCode: z.string().min(1).max(64),
        orderItemId: uuid.optional(),
      })
      .strict(),
  ])
  .superRefine((p, ctx) => {
    if (p.kind === 'discount_percent' && p.value > 10_000) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'discount_percent value is basis points, max 10000 (=100%)',
        path: ['value'],
      });
    }
  });

export type AdjustmentApplyPayload = z.infer<typeof adjustmentApplyPayloadSchema>;

// ---------------------------------------------------------------------------
// Item 9 / C3 (0120): the till's remaining money corrections join the queue.
// The PIN rides in the payload where the RPC takes one (refund, void): the
// replay function proves it to verify_manager_pin first and the RPC spends the
// grant (0115). Reason codes may carry a typed note ("code: note"; the prompt
// caps the note at 200 characters).
// ---------------------------------------------------------------------------

const pinSchema = z.string().regex(/^\d{4,12}$/, 'pin must be 4-12 digits');
const reasonCodeSchema = z.string().trim().min(1).max(300);

/** tab.cancel — app.cancel_tab: an OPEN tab with nothing on it goes, with a reason. */
export const tabCancelPayloadSchema = z.object({ tabId: uuid, reasonCode: reasonCodeSchema }).strict();
export type TabCancelPayload = z.infer<typeof tabCancelPayloadSchema>;

/** tab.settle_zero — app.settle_zero_tab: a tab that owes nothing closes as settled, no payment row. */
export const tabSettleZeroPayloadSchema = z
  .object({ tabId: uuid, reasonCode: reasonCodeSchema })
  .strict();
export type TabSettleZeroPayload = z.infer<typeof tabSettleZeroPayloadSchema>;

/**
 * payment.refund — app.refund (manager PIN). amountIqd is what goes back, never
 * a price: the server checks it against what is left on the payment. Naming
 * lines is what restocks them (refund_items_restock); absent = money only.
 */
export const paymentRefundPayloadSchema = z
  .object({
    paymentId: uuid,
    amountIqd: z.number().int().positive(),
    pin: pinSchema,
    reasonCode: reasonCodeSchema,
    items: z
      .array(z.object({ orderItemId: uuid, qty: z.number().int().positive() }).strict())
      .min(1)
      .optional(),
  })
  .strict();
export type PaymentRefundPayload = z.infer<typeof paymentRefundPayloadSchema>;

/** order_item.void — app.void_after_send (manager PIN): a sent line is voided as waste. */
export const orderItemVoidPayloadSchema = z
  .object({ orderItemId: uuid, pin: pinSchema, reasonCode: reasonCodeSchema })
  .strict();
export type OrderItemVoidPayload = z.infer<typeof orderItemVoidPayloadSchema>;

/**
 * stock.waste — app.record_waste. qty is numeric on the server (grams may be fractional).
 * location (wave 5 §2.8.6) is the store the waste came from; absent, the server takes the
 * caller's home store, and the mappers send p_location only when it is present, so a queue
 * written before the stores replays unchanged.
 */
export const stockWastePayloadSchema = z
  .object({
    ingredientId: uuid,
    qty: z.number().positive().finite(),
    movementType: z.enum(['waste_spill', 'waste_spoilage']).default('waste_spill'),
    reasonCode: reasonCodeSchema,
    location: z.enum(['cafe', 'bakery']).optional(),
  })
  .strict();
export type StockWastePayload = z.infer<typeof stockWastePayloadSchema>;

// TODO(core): tighten the remaining payloads as their call sites move onto the queue:
// reservation.update and waiter_call.action currently accept z.unknown().
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
  /**
   * The branch the screens showed when the write was queued (multi-venue audit,
   * 0228): replay sends it as x-venue-scope, so a write from a machine that is
   * not a registered station lands at that branch, not wherever the replay-time
   * scope points. Absent on rows queued before it existed, and on a station
   * (whose own branch always wins on the server).
   */
  venueScope: uuid.nullable().optional(),
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
    .object({
      ...baseFields,
      mutationType: z.literal('order.add_items'),
      payload: orderAddItemsPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('ticket.status'),
      payload: ticketStatusPayloadSchema,
    })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('reservation.update'), payload: todoPayload })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('waiter_call.action'), payload: todoPayload })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('stock.waste'),
      payload: stockWastePayloadSchema,
    })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('tab.open'), payload: tabOpenPayloadSchema })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('tab.settle'),
      payload: tabSettlePayloadSchema,
    })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('adjustment.apply'),
      payload: adjustmentApplyPayloadSchema,
    })
    .strict(),
  z
    .object({ ...baseFields, mutationType: z.literal('tab.cancel'), payload: tabCancelPayloadSchema })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('tab.settle_zero'),
      payload: tabSettleZeroPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('payment.refund'),
      payload: paymentRefundPayloadSchema,
    })
    .strict(),
  z
    .object({
      ...baseFields,
      mutationType: z.literal('order_item.void'),
      payload: orderItemVoidPayloadSchema,
    })
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
