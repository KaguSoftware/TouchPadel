import { describe, it, expect } from 'vitest';
import { auditDrillHref, normalizeCount, normalizeOverview, tillTabHref } from './opsLogic';

// The overview renders server figures only. These tests pin the two things
// the screen depends on: the contract shape (build plan §4, 0068) parses, and
// a sparse or malformed payload degrades to zeros / nulls instead of throwing
// or inventing a number.

const contractPayload = {
  bookings: { today: 12, arrived: 4, upcoming: 7, noShows: 1 },
  cafe: { openTabs: 3, ticketsQueued: 2, ticketsLate: 1, waiterCallsOpen: 0 },
  stock: { low: 2, belowPar: 5, expiringSoon: 1, expired: 0, lastCountAt: '2026-09-02T20:00:00Z' },
  staffActivity: [{ staffId: 's1', name: 'Noor', ordersTaken: 9, bookingsCreated: 2 }],
  exceptions: {
    discounts: { count: 2, amountIqd: 15000 },
    voids: { count: 1, amountIqd: 4000 },
    refunds: { count: 0, amountIqd: 0 },
  },
  dayClose: { open: true, businessDate: '2026-09-03', openedAt: '2026-09-03T06:00:00Z', blockingTabs: 3, queued: 0 },
};

describe('normalizeOverview', () => {
  it('parses the contract shape', () => {
    const o = normalizeOverview(contractPayload);
    expect(o.bookings).toMatchObject({ today: 12, arrived: 4, upcoming: 7, noShows: 1 });
    expect(o.cafe).toMatchObject({ openTabs: 3, ticketsQueued: 2, ticketsLate: 1, waiterCallsOpen: 0 });
    expect(o.cafe.ticketsPreparing).toBeNull();
    expect(o.stock.lastCountAt).toBe('2026-09-02T20:00:00Z');
    expect(o.staffActivity).toEqual([
      { staffId: 's1', name: 'Noor', role: null, ordersTaken: 9, bookingsCreated: 2, paymentsTaken: null },
    ]);
    expect(o.exceptions.discounts).toEqual({ count: 2, amountIqd: 15000 });
    expect(o.exceptions.waste).toBeNull();
    // A bare count for blockingTabs is kept as a count with no rows to link.
    expect(o.dayClose.blockingCount).toBe(3);
    expect(o.dayClose.blockingTabs).toEqual([]);
    expect(o.dayClose.open).toBe(true);
  });

  it('accepts the richer optional fields when the server sends them', () => {
    const o = normalizeOverview({
      ...contractPayload,
      bookings: { ...contractPayload.bookings, nextArrival: { startAt: '2026-09-03T15:00:00Z', guestName: 'Ali' } },
      cafe: { ...contractPayload.cafe, ticketsPreparing: 4 },
      staffActivity: [{ staffId: 's1', name: 'Noor', role: 'cashier', ordersTaken: 9, bookingsCreated: 2, paymentsTaken: 5 }],
      exceptions: { ...contractPayload.exceptions, waste: { count: 3, amountIqd: 2500 } },
      dayClose: { ...contractPayload.dayClose, blockingTabs: [{ id: 't1', label: 'T4' }, 't2'] },
    });
    expect(o.bookings.nextArrivalAt).toBe('2026-09-03T15:00:00Z');
    expect(o.bookings.nextArrivalLabel).toBe('Ali');
    expect(o.cafe.ticketsPreparing).toBe(4);
    expect(o.staffActivity[0]).toMatchObject({ role: 'cashier', paymentsTaken: 5 });
    expect(o.exceptions.waste).toEqual({ count: 3, amountIqd: 2500 });
    expect(o.dayClose.blockingCount).toBe(2);
    expect(o.dayClose.blockingTabs).toEqual([
      { id: 't1', label: 'T4' },
      { id: 't2', label: null },
    ]);
  });

  it('degrades a sparse or malformed payload to zeros and nulls, never throws', () => {
    for (const bad of [null, undefined, 'x', 42, [], { bookings: 'nope', staffActivity: 'nope' }]) {
      const o = normalizeOverview(bad);
      expect(o.bookings.today).toBe(0);
      expect(o.cafe.openTabs).toBe(0);
      expect(o.stock.lastCountAt).toBeNull();
      expect(o.staffActivity).toEqual([]);
      expect(o.exceptions.discounts).toEqual({ count: 0, amountIqd: null });
      expect(o.dayClose.open).toBe(false);
    }
  });
});

describe('normalizeCount', () => {
  it('reads count + amount under either key style', () => {
    expect(normalizeCount({ count: 2, amountIqd: 100 })).toEqual({ count: 2, amountIqd: 100 });
    expect(normalizeCount({ count: 2, amount_iqd: 100 })).toEqual({ count: 2, amountIqd: 100 });
    expect(normalizeCount({ count: 2, amount: 100 })).toEqual({ count: 2, amountIqd: 100 });
  });
  it('treats a bare number as a count with no amount', () => {
    expect(normalizeCount(5)).toEqual({ count: 5, amountIqd: null });
  });
});

describe('drill hrefs', () => {
  it('sends each exception to the audit log filtered on its action', () => {
    expect(auditDrillHref('discounts')).toBe('/admin/audit?q=discount.apply');
    expect(auditDrillHref('voids')).toBe('/admin/audit?q=order_item.void');
    expect(auditDrillHref('refunds')).toBe('/admin/audit?q=payment.refund');
    expect(auditDrillHref('waste')).toBe('/admin/audit?q=stock.record_waste');
  });
  it('links a blocking tab straight into the till', () => {
    expect(tillTabHref('abc 123')).toBe('/till?tab=abc%20123');
  });
});
