import { describe, expect, it } from 'vitest';
import {
  TransitionError,
  orderStatusMachine,
  reservationStatusMachine,
  tabStatusMachine,
  ticketStatusMachine,
} from './machines';

describe('order status machine', () => {
  it('allows the happy path and the one-tap bump', () => {
    expect(orderStatusMachine.canTransition('sent', 'preparing')).toBe(true);
    expect(orderStatusMachine.canTransition('preparing', 'ready')).toBe(true);
    expect(orderStatusMachine.canTransition('ready', 'served')).toBe(true);
    expect(orderStatusMachine.canTransition('sent', 'ready')).toBe(true); // skip
  });

  it('allows void only before service', () => {
    expect(orderStatusMachine.canTransition('sent', 'voided')).toBe(true);
    expect(orderStatusMachine.canTransition('ready', 'voided')).toBe(true);
    expect(orderStatusMachine.canTransition('served', 'voided')).toBe(false); // refunds, not voids
  });

  it('never goes backwards and terminals are dead ends', () => {
    expect(orderStatusMachine.canTransition('ready', 'preparing')).toBe(false);
    expect(orderStatusMachine.canTransition('served', 'sent')).toBe(false);
    expect(orderStatusMachine.isTerminal('served')).toBe(true);
    expect(orderStatusMachine.isTerminal('voided')).toBe(true);
    expect(orderStatusMachine.isTerminal('sent')).toBe(false);
  });
});

describe('ticket status machine', () => {
  it('mirrors the KDS flow', () => {
    expect(ticketStatusMachine.canTransition('queued', 'preparing')).toBe(true);
    expect(ticketStatusMachine.canTransition('queued', 'ready')).toBe(true); // one-tap bump
    expect(ticketStatusMachine.canTransition('preparing', 'ready')).toBe(true);
    expect(ticketStatusMachine.canTransition('ready', 'completed')).toBe(true);
    expect(ticketStatusMachine.canTransition('completed', 'ready')).toBe(false);
    expect(ticketStatusMachine.canTransition('queued', 'completed')).toBe(false);
  });
});

describe('reservation status machine', () => {
  it('holds: pending -> confirmed | expired | cancelled', () => {
    expect(reservationStatusMachine.canTransition('pending', 'confirmed')).toBe(true);
    expect(reservationStatusMachine.canTransition('pending', 'expired')).toBe(true);
    expect(reservationStatusMachine.canTransition('pending', 'cancelled')).toBe(true);
    expect(reservationStatusMachine.canTransition('pending', 'arrived')).toBe(false);
  });

  it('bookings: confirmed -> arrived/no_show/cancelled/completed; arrived -> completed', () => {
    expect(reservationStatusMachine.canTransition('confirmed', 'arrived')).toBe(true);
    expect(reservationStatusMachine.canTransition('confirmed', 'no_show')).toBe(true);
    expect(reservationStatusMachine.canTransition('confirmed', 'cancelled')).toBe(true);
    expect(reservationStatusMachine.canTransition('confirmed', 'completed')).toBe(true);
    expect(reservationStatusMachine.canTransition('arrived', 'completed')).toBe(true);
    expect(reservationStatusMachine.canTransition('arrived', 'no_show')).toBe(false);
  });

  it('terminal statuses free the slot and never come back', () => {
    for (const s of ['completed', 'cancelled', 'no_show', 'expired'] as const) {
      expect(reservationStatusMachine.isTerminal(s)).toBe(true);
      expect(reservationStatusMachine.canTransition(s, 'confirmed')).toBe(false);
    }
  });
});

describe('tab status machine', () => {
  it('open <-> awaiting_payment, then settled or void', () => {
    expect(tabStatusMachine.canTransition('open', 'awaiting_payment')).toBe(true);
    expect(tabStatusMachine.canTransition('awaiting_payment', 'open')).toBe(true);
    expect(tabStatusMachine.canTransition('awaiting_payment', 'settled')).toBe(true);
    expect(tabStatusMachine.canTransition('open', 'settled')).toBe(true);
    expect(tabStatusMachine.canTransition('settled', 'open')).toBe(false);
    expect(tabStatusMachine.isTerminal('settled')).toBe(true);
    expect(tabStatusMachine.isTerminal('void')).toBe(true);
  });
});

describe('assertTransition', () => {
  it('passes silently on legal edges', () => {
    expect(() => orderStatusMachine.assertTransition('sent', 'preparing')).not.toThrow();
  });

  it('throws a typed TransitionError on illegal edges', () => {
    try {
      ticketStatusMachine.assertTransition('completed', 'queued');
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(TransitionError);
      const err = e as TransitionError;
      expect(err.code).toBe('INVALID_TRANSITION');
      expect(err.entity).toBe('ticket');
      expect(err.from).toBe('completed');
      expect(err.to).toBe('queued');
      expect(err.message).toContain('ticket');
    }
  });

  it('unknown states are rejected, not silently allowed', () => {
    // simulate bad data arriving from outside TS
    expect(
      orderStatusMachine.canTransition('draft' as never, 'sent' as never),
    ).toBe(false);
  });
});
