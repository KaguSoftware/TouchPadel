import { describe, it, expect } from 'vitest';
import {
  alertsFor,
  auditDrillHref,
  dayCloseState,
  exceptionBasis,
  normalizeCount,
  normalizeOverview,
  tillTabHref,
  worstSeverity,
} from './opsLogic';

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
  dayClose: {
    open: true,
    businessDate: '2026-09-03',
    openedAt: '2026-09-03T06:00:00Z',
    blockingTabs: 3,
    queued: 0,
  },
};

describe('normalizeOverview', () => {
  it('parses the contract shape', () => {
    const o = normalizeOverview(contractPayload);
    expect(o.bookings).toMatchObject({ today: 12, arrived: 4, upcoming: 7, noShows: 1 });
    expect(o.cafe).toMatchObject({
      openTabs: 3,
      ticketsQueued: 2,
      ticketsLate: 1,
      waiterCallsOpen: 0,
    });
    expect(o.cafe.ticketsPreparing).toBeNull();
    expect(o.stock.lastCountAt).toBe('2026-09-02T20:00:00Z');
    expect(o.staffActivity).toEqual([
      {
        staffId: 's1',
        name: 'Noor',
        role: null,
        ordersTaken: 9,
        bookingsCreated: 2,
        paymentsTaken: null,
      },
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
      bookings: {
        ...contractPayload.bookings,
        nextArrival: { startAt: '2026-09-03T15:00:00Z', guestName: 'Ali' },
      },
      cafe: { ...contractPayload.cafe, ticketsPreparing: 4 },
      staffActivity: [
        {
          staffId: 's1',
          name: 'Noor',
          role: 'cashier',
          ordersTaken: 9,
          bookingsCreated: 2,
          paymentsTaken: 5,
        },
      ],
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

// The grouping helpers decide what the screen's three tiers contain. They only
// select, order and scale figures normalizeOverview already produced — so what
// these pin is the SELECTION rules, which is where the readability of the screen
// actually lives.

describe('alertsFor', () => {
  it('drops every zero, so a clear floor produces no alerts at all', () => {
    const o = normalizeOverview({
      bookings: { today: 12, arrived: 12, upcoming: 0, noShows: 0 },
      cafe: { openTabs: 3, ticketsQueued: 2, ticketsLate: 0, waiterCallsOpen: 0 },
      stock: { low: 0, belowPar: 5, expiringSoon: 1, expired: 0 },
    });
    // belowPar 5 and expiringSoon 1 are deliberately NOT alarms: they belong to
    // the stock cluster, and promoting them would put the band back to noise.
    expect(alertsFor(o)).toEqual([]);
    expect(worstSeverity(alertsFor(o))).toBeNull();
  });

  it('returns the non-zero alarms in table order, worst first', () => {
    const o = normalizeOverview({
      bookings: { today: 12, arrived: 4, upcoming: 6, noShows: 2 },
      cafe: { openTabs: 3, ticketsQueued: 2, ticketsLate: 3, waiterCallsOpen: 1 },
      stock: { low: 4, belowPar: 5, expiringSoon: 1, expired: 7 },
    });
    expect(alertsFor(o).map((a) => a.key)).toEqual([
      'ticketsLate',
      'expired',
      'low',
      'noShows',
      'waiterCalls',
    ]);
    // The order is the table's, never the counts': expired is 7 and late is 3,
    // and late still leads because a guest is waiting on it.
    expect(alertsFor(o).map((a) => a.count)).toEqual([3, 7, 4, 2, 1]);
  });

  it('carries each alarm to the screen that owns it', () => {
    const o = normalizeOverview({
      cafe: { ticketsLate: 1, waiterCallsOpen: 1 },
      stock: { low: 1, expired: 1 },
      bookings: { noShows: 1 },
    });
    expect(Object.fromEntries(alertsFor(o).map((a) => [a.key, a.href]))).toEqual({
      ticketsLate: '/till/tabs',
      expired: '/stock',
      low: '/stock',
      noShows: '/desk',
      waiterCalls: '/till/tabs',
    });
  });

  it('reports the loudest severity present, for the band ground', () => {
    const warnOnly = normalizeOverview({ cafe: { waiterCallsOpen: 2 } });
    expect(worstSeverity(alertsFor(warnOnly))).toBe('warn');
    const withDanger = normalizeOverview({ cafe: { waiterCallsOpen: 2, ticketsLate: 1 } });
    expect(worstSeverity(alertsFor(withDanger))).toBe('danger');
  });
});

describe('dayCloseState', () => {
  const base = { open: true, businessDate: null, openedAt: null, blockingTabs: [], queued: 0 };

  it('is closed whenever no business day is open, whatever else is outstanding', () => {
    expect(
      dayCloseState(
        normalizeOverview({ dayClose: { ...base, open: false, blockingTabs: 3, queued: 9 } })
          .dayClose,
      ),
    ).toBe('closed');
  });

  it('ranks open tabs above a queued write — a tab needs a person, a queue needs the network', () => {
    expect(
      dayCloseState(
        normalizeOverview({ dayClose: { ...base, blockingTabs: 2, queued: 5 } }).dayClose,
      ),
    ).toBe('blockedByOpenTabs');
    expect(
      dayCloseState(
        normalizeOverview({ dayClose: { ...base, blockingTabs: [], queued: 5 } }).dayClose,
      ),
    ).toBe('blockedByUnsyncedQueue');
  });

  it('is ready only when both gates are clear', () => {
    expect(dayCloseState(normalizeOverview({ dayClose: base }).dayClose)).toBe('ready');
  });
});

describe('exceptionBasis', () => {
  it('scales on money when every figure carries money', () => {
    expect(
      exceptionBasis([
        { count: 2, amountIqd: 15000 },
        { count: 1, amountIqd: 3000 },
      ]),
    ).toEqual({ by: 'amount', max: 15000 });
  });

  it('falls back to counts when any figure has no amount, so one scale never mixes units', () => {
    expect(
      exceptionBasis([
        { count: 2, amountIqd: 15000 },
        { count: 9, amountIqd: null },
      ]),
    ).toEqual({ by: 'count', max: 9 });
  });

  it('has no basis at all when there is nothing to draw', () => {
    expect(exceptionBasis([{ count: 0, amountIqd: 0 }])).toBeNull();
    expect(exceptionBasis([])).toBeNull();
  });
});

describe('normalizeCount — the waste spelling', () => {
  it('reads costIqd, which is how ops_overview spells the waste amount', () => {
    // Verified against the local stack: exceptions.waste is {count, costIqd}
    // while the other three are {count, amountIqd}. Reading only amount* here
    // dropped waste's money and printed a bare count beside three IQD figures.
    expect(normalizeCount({ count: 3, costIqd: 2500 })).toEqual({ count: 3, amountIqd: 2500 });
    expect(normalizeCount({ count: 3, cost_iqd: 2500 })).toEqual({ count: 3, amountIqd: 2500 });
  });
  it('still prefers an explicit amount when both are present', () => {
    expect(normalizeCount({ count: 1, amountIqd: 10, costIqd: 99 })).toEqual({
      count: 1,
      amountIqd: 10,
    });
  });
});
