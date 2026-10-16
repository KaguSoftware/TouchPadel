import { describe, it, expect } from 'vitest';
import {
  NEEDS,
  STOCK_HREF,
  auditDrillHref,
  dayCloseState,
  needsFor,
  normalizeCount,
  normalizeOverview,
  overviewNeedCounts,
  tillTabHref,
} from './opsLogic';
import { protocolsWaitingTotal, readProtocolsWaiting } from './protocolsWaiting';

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
      { id: 't1', tableNumber: null, label: 'T4', guestName: null },
      { id: 't2', tableNumber: null, label: null, guestName: null },
    ]);
  });

  // The fields 0068 actually sends beyond the contract. The first screen read
  // none of them and printed raw tab tokens where a table number was available.
  it('reads the 0068 extras: cancellations, the next court, orders, alerts, and who is on each tab', () => {
    const o = normalizeOverview({
      ...contractPayload,
      bookings: {
        ...contractPayload.bookings,
        cancelledToday: 2,
        nextArrival: { startAt: '2026-09-03T15:00:00Z', guestName: 'Ali', courtNameEn: 'Court 2', courtNameAr: 'الملعب 2' },
      },
      cafe: { ...contractPayload.cafe, ordersToday: 41 },
      stock: { ...contractPayload.stock, openAlerts: 3 },
      dayClose: { ...contractPayload.dayClose, blockingTabs: [{ id: 't1', label: 'x', tableNumber: '4', guestName: 'Sara' }] },
    });
    expect(o.bookings).toMatchObject({ cancelledToday: 2, nextArrivalCourtEn: 'Court 2', nextArrivalCourtAr: 'الملعب 2' });
    expect(o.cafe.ordersToday).toBe(41);
    expect(o.stock.openAlerts).toBe(3);
    expect(o.dayClose.blockingTabs).toEqual([{ id: 't1', tableNumber: '4', label: 'x', guestName: 'Sara' }]);
  });

  it('keeps an unreported extra as null rather than a zero the server never sent', () => {
    const o = normalizeOverview(contractPayload);
    expect(o.bookings.cancelledToday).toBeNull();
    expect(o.cafe.ordersToday).toBeNull();
    expect(o.stock.openAlerts).toBeNull();
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

describe('normalizeOverview — today', () => {
  it('reads today\'s business date by the server\'s clock, open day or not', () => {
    expect(normalizeOverview({ businessDate: '2026-10-16', dayClose: { open: false } }).today).toBe('2026-10-16');
    expect(normalizeOverview({}).today).toBeNull();
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

// The selection rules decide what "Needs you" contains, which is where the
// readability of the screen actually lives.

describe('needsFor', () => {
  const openDay = { open: true, businessDate: '2026-09-03', openedAt: '2026-09-03T06:00:00Z', blockingTabs: [] };

  it('drops every zero, so a clear floor on an open day needs nothing at all', () => {
    const o = normalizeOverview({
      bookings: { today: 12, arrived: 12, upcoming: 0, noShows: 3 },
      cafe: { openTabs: 3, ticketsQueued: 2, ticketsLate: 0, waiterCallsOpen: 0 },
      stock: { low: 0, belowPar: 5, expiringSoon: 1, expired: 0 },
      dayClose: openDay,
    });
    // Below par and expiring soon are stock to watch, and no-shows are a fact
    // about the day: none of them is something to go and do right now.
    expect(needsFor(overviewNeedCounts(o))).toEqual([]);
  });

  it('never makes the day not being open a row: that is the banner above the list', () => {
    const o = normalizeOverview({ dayClose: { ...openDay, open: false } });
    expect(needsFor(overviewNeedCounts(o))).toEqual([]);
    expect(NEEDS.map((n) => n.key)).not.toContain('dayNotOpen');
  });

  it('orders the rows by who is waiting, never by count', () => {
    const rows = needsFor({
      content: 1,
      incidents: 1,
      deductions: 1,
      protocols: 1,
      tillShifts: 1,
      purchases: 1,
      low: 40,
      expired: 1,
      matchReports: 1,
      lessonRefunds: 1,
      deposits: 1,
      ticketsLate: 597,
      waiterCalls: 2,
    });
    expect(rows.map((r) => r.key)).toEqual([
      // A guest in the building, then a guest owed money, then a complaint.
      'waiterCalls',
      'ticketsLate',
      'deposits',
      'lessonRefunds',
      'matchReports',
      // The shelves: nobody may use expired stock, before what may sell out.
      'expired',
      'low',
      // The paperwork.
      'purchases',
      'tillShifts',
      'protocols',
      'deductions',
      'incidents',
      'content',
    ]);
    expect(rows.map((r) => r.count).slice(0, 2)).toEqual([2, 597]);
  });

  it('gives each row one way to act: a screen, the queue in place, or nothing here', () => {
    const rows = needsFor({ waiterCalls: 1, ticketsLate: 1, deposits: 1, lessonRefunds: 1, matchReports: 1, expired: 1, low: 1, purchases: 1, tillShifts: 1, protocols: 1, deductions: 1, incidents: 1, content: 1 });
    expect(Object.fromEntries(rows.map((r) => [r.key, r.action]))).toEqual({
      waiterCalls: { kind: 'open', href: '/till/tabs' },
      // The kitchen cooks them; no screen in this workspace does.
      ticketsLate: { kind: 'none' },
      deposits: { kind: 'review' },
      lessonRefunds: { kind: 'review' },
      matchReports: { kind: 'review' },
      expired: { kind: 'open', href: '/stock/expiry' },
      low: { kind: 'open', href: '/stock?filter=low' },
      purchases: { kind: 'open', href: '/stock/receive' },
      tillShifts: { kind: 'open', href: '/admin/day-close' },
      protocols: { kind: 'open', href: '/protocols?filter=waiting' },
      deductions: { kind: 'open', href: '/deductions' },
      incidents: { kind: 'open', href: '/incidents' },
      content: { kind: 'open', href: '/marketing' },
    });
  });

  it('counts a read the role never made, or that has not answered, as none', () => {
    // A manager never reads content (§8 Q14) or deductions: their counts are absent.
    expect(needsFor({ protocols: 1, deductions: undefined, incidents: 0 }).map((r) => r.key)).toEqual(['protocols']);
  });

  it('lets a read lower a row from danger to warn', () => {
    expect(needsFor({ deposits: 2 })[0]!.severity).toBe('danger');
    expect(needsFor({ deposits: 2 }, { deposits: 'warn' })[0]!.severity).toBe('warn');
    expect(needsFor({ ticketsLate: 1, expired: 1, low: 1 }).map((r) => r.severity)).toEqual(['danger', 'danger', 'warn']);
  });

  it('reads its four counts from ops_overview', () => {
    const o = normalizeOverview({ cafe: { ticketsLate: 3, waiterCallsOpen: 1 }, stock: { low: 4, expired: 7 } });
    expect(overviewNeedCounts(o)).toEqual({ waiterCalls: 1, ticketsLate: 3, expired: 7, low: 4 });
  });

  it('counts the protocol steps to decide and to do as one "waiting on you"', () => {
    expect(protocolsWaitingTotal({ to_decide: 2, todo: 1 })).toBe(3);
    expect(readProtocolsWaiting({ to_decide: '4', todo: null })).toEqual({ toDecide: 4, todo: 0 });
    expect(protocolsWaitingTotal(undefined)).toBe(0);
  });
});

describe('stock hrefs', () => {
  it('opens each stock figure on the screen that lists exactly those items', () => {
    expect(STOCK_HREF).toEqual({
      out: '/stock?filter=out',
      low: '/stock?filter=low',
      belowPar: '/stock?filter=belowPar',
      expiringSoon: '/stock/expiry',
      expired: '/stock/expiry',
      alerts: '/stock/alerts',
      lastCount: '/stock/counts',
    });
  });
});

describe('dayCloseState', () => {
  const base = { open: true, businessDate: null, openedAt: null, blockingTabs: [] };

  it('is closed whenever no business day is open, whatever else is outstanding', () => {
    expect(dayCloseState(normalizeOverview({ dayClose: { ...base, open: false, blockingTabs: 3 } }).dayClose, 9)).toBe('closed');
  });

  it('ranks open tabs above a queued write — a tab needs a person, a queue needs the network', () => {
    expect(dayCloseState(normalizeOverview({ dayClose: { ...base, blockingTabs: 2 } }).dayClose, 5)).toBe('blockedByOpenTabs');
    expect(dayCloseState(normalizeOverview({ dayClose: base }).dayClose, 5)).toBe('blockedByUnsyncedQueue');
  });

  it('is ready only when both gates are clear', () => {
    expect(dayCloseState(normalizeOverview({ dayClose: base }).dayClose, 0)).toBe('ready');
  });

  // 0068 never sends a queued count; the old screen read `dayClose.queued` and
  // so always said "None". The count now comes from this station's queue.
  it('ignores a queued figure in the payload', () => {
    expect(dayCloseState(normalizeOverview({ dayClose: { ...base, queued: 7 } }).dayClose, 0)).toBe('ready');
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
    expect(normalizeCount({ count: 1, amountIqd: 10, costIqd: 99 })).toEqual({ count: 1, amountIqd: 10 });
  });
});
