/**
 * Status state machines matching the design-data.md enums. The DB RPCs enforce these
 * server-side; clients use the same tables to enable/disable buttons and to fail fast
 * before enqueueing an impossible transition.
 *
 * Transitions are the LEGAL EDGES only — initial states are set at insert, not transitioned
 * into. Forward "skip" edges (sent->ready, queued->ready) are allowed for one-tap KDS bumps.
 */

export type OrderStatus = 'sent' | 'preparing' | 'ready' | 'served' | 'voided';
export type TicketStatus = 'queued' | 'preparing' | 'ready' | 'completed' | 'voided';
export type ReservationStatus =
  | 'pending'
  | 'confirmed'
  | 'arrived'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'expired';
export type TabStatus = 'open' | 'awaiting_payment' | 'settled' | 'void';

export type StatusEntity = 'order' | 'ticket' | 'reservation' | 'tab';

export class TransitionError extends Error {
  readonly code = 'INVALID_TRANSITION' as const;
  readonly entity: StatusEntity;
  readonly from: string;
  readonly to: string;

  constructor(entity: StatusEntity, from: string, to: string) {
    super(`invalid ${entity} transition: '${from}' -> '${to}'`);
    this.name = 'TransitionError';
    this.entity = entity;
    this.from = from;
    this.to = to;
  }
}

export interface StatusMachine<S extends string> {
  readonly entity: StatusEntity;
  readonly states: readonly S[];
  readonly transitions: Readonly<Record<S, readonly S[]>>;
  canTransition(from: S, to: S): boolean;
  /** Throws TransitionError when the edge is not in the table. */
  assertTransition(from: S, to: S): void;
  isTerminal(state: S): boolean;
}

function makeMachine<S extends string>(
  entity: StatusEntity,
  transitions: Readonly<Record<S, readonly S[]>>,
): StatusMachine<S> {
  const states = Object.keys(transitions) as S[];
  return {
    entity,
    states,
    transitions,
    canTransition(from, to) {
      const outgoing = transitions[from] as readonly S[] | undefined;
      return outgoing !== undefined && outgoing.includes(to);
    },
    assertTransition(from, to) {
      if (!this.canTransition(from, to)) throw new TransitionError(entity, from, to);
    },
    isTerminal(state) {
      return ((transitions[state] as readonly S[] | undefined) ?? []).length === 0;
    },
  };
}

export const orderStatusMachine: StatusMachine<OrderStatus> = makeMachine<OrderStatus>('order', {
  sent: ['preparing', 'ready', 'voided'],
  preparing: ['ready', 'voided'],
  ready: ['served', 'voided'],
  served: [], // corrections after service are refunds, never status edits
  voided: [],
});

export const ticketStatusMachine: StatusMachine<TicketStatus> = makeMachine<TicketStatus>('ticket', {
  queued: ['preparing', 'ready', 'voided'],
  preparing: ['ready', 'voided'],
  ready: ['completed', 'voided'],
  completed: [],
  voided: [],
});

export const reservationStatusMachine: StatusMachine<ReservationStatus> = makeMachine<ReservationStatus>(
  'reservation',
  {
    pending: ['confirmed', 'cancelled', 'expired'],
    confirmed: ['arrived', 'completed', 'cancelled', 'no_show'],
    arrived: ['completed'],
    completed: [],
    cancelled: [],
    no_show: [],
    expired: [],
  },
);

export const tabStatusMachine: StatusMachine<TabStatus> = makeMachine<TabStatus>('tab', {
  open: ['awaiting_payment', 'settled', 'void'],
  awaiting_payment: ['open', 'settled', 'void'], // 'open' = guest changed their mind pre-payment
  settled: [],
  void: [],
});
