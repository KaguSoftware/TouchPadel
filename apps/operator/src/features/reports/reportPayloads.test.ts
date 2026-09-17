import { describe, expect, it } from 'vitest';
import { bucketRange, cafeIsEmpty, courtsIsEmpty, dayClosesOf, num, readCafe, readCompared, readCourts, readDrill, readRevenue, readStaff, readStock, sortBy } from './reportPayloads';

// The payloads below are cut from the local stack's real responses (migrations
// 0068 / 0096 / 0097 / 0099). The screens used to read snake_case keys these
// payloads never carry; these tests pin the keys the SQL actually writes.

describe('num', () => {
  it('reads numbers and numeric strings, and never turns a missing figure into 0', () => {
    expect(num(5)).toBe(5);
    expect(num('1633337')).toBe(1633337);
    expect(num(null)).toBeNull();
    expect(num(undefined)).toBeNull();
    expect(num('')).toBeNull();
    expect(num('n/a')).toBeNull();
  });
});

describe('readRevenue', () => {
  const payload = {
    group: 'day',
    rows: [{ orders: 0, period: '2026-09-11', taxIqd: 0, cafeIqd: 0, cardIqd: 0, cashIqd: 0, bookings: 1, padelIqd: 40000, totalIqd: 40000, voidsIqd: 0, cafeNetIqd: 0, refundsIqd: 0, discountsIqd: 0 }],
    totals: { orders: 414, taxIqd: 14454, cafeIqd: 1947119, cardIqd: 71298, cashIqd: 986900, bookings: 15, padelIqd: 670000, totalIqd: 2548219, voidsIqd: 91000, cafeNetIqd: 1878219, refundsIqd: 69400, discountsIqd: 53902 },
    columns: [{ key: 'period', kind: 'date' }],
    comparison: null,
  };
  it('reads every per-period figure by its camelCase key', () => {
    const r = readRevenue(payload);
    expect(r.group).toBe('day');
    expect(r.rows).toEqual([
      { period: '2026-09-11', padelIqd: 40000, cafeIqd: 0, cafeNetIqd: 0, totalIqd: 40000, cashIqd: 0, cardIqd: 0, discountsIqd: 0, voidsIqd: 0, refundsIqd: 0, taxIqd: 0, orders: 0, bookings: 1 },
    ]);
    expect(r.totals?.totalIqd).toBe(2548219);
    expect(r.totals?.cafeNetIqd).toBe(1878219);
  });
  it('survives a missing or malformed payload', () => {
    expect(readRevenue(null)).toEqual({ group: null, rows: [], totals: null });
    expect(readRevenue({ rows: [{ padelIqd: 1 }] }).rows).toEqual([]);
  });
});

describe('readCourts', () => {
  const payload = {
    rows: [
      { courtId: 'c1', noShows: 0, bookings: 0, isActive: true, revenueIqd: 0, courtNameAr: 'ملعب ١', courtNameEn: 'C1', occupancyPct: 0, peakBookings: 0, bookedMinutes: 0, cancellations: 0, noShowRatePct: null, offPeakBookings: 0, availableMinutes: 17340, cancellationRatePct: null, revenuePerAvailableHourIqd: 0 },
    ],
    trend: [{ date: '2026-09-11', bookings: 1, revenueIqd: 40000 }],
    byHour: [{ hour: 0, bookings: 2 }, { hour: 1, bookings: 0 }],
    totals: { noShows: 6, bookings: 15, revenueIqd: 670000, occupancyPct: 0, peakBookings: 0, bookedMinutes: 930, cancellations: 6, offPeakBookings: 15, availableMinutes: 3057600 },
  };
  it('reads courts, the by-hour list and the daily trend', () => {
    const r = readCourts(payload);
    expect(r.rows[0]).toMatchObject({ courtId: 'c1', name: { en: 'C1', ar: 'ملعب ١' }, availableMinutes: 17340, revenuePerOpenHourIqd: 0, cancellationRatePct: null });
    expect(r.byHour).toEqual([{ hour: 0, bookings: 2 }, { hour: 1, bookings: 0 }]);
    expect(r.trend).toEqual([{ date: '2026-09-11', bookings: 1, revenueIqd: 40000 }]);
    expect(r.totals).toMatchObject({ bookings: 15, bookedMinutes: 930, noShows: 6 });
  });
  it('is empty when nothing was booked, cancelled or missed — not when courts merely exist', () => {
    expect(courtsIsEmpty(readCourts(payload))).toBe(false);
    expect(courtsIsEmpty(readCourts({ ...payload, totals: { bookings: 0, cancellations: 0, noShows: 0 } }))).toBe(true);
    expect(courtsIsEmpty(readCourts({ ...payload, totals: { bookings: 0, cancellations: 1, noShows: 0 } }))).toBe(false);
    expect(courtsIsEmpty(readCourts({ rows: [] }))).toBe(true);
  });
});

describe('readCafe', () => {
  const payload = {
    rows: [{ qty: 11, itemId: 'i1', nameAr: 'قهوة', nameEn: 'Coffee', orders: 6, cogsIqd: null, marginPct: null, categoryId: 'k1', revenueIqd: 100000, categoryNameAr: 'مشروبات', categoryNameEn: 'Drinks', grossProfitIqd: null }],
    summary: { qty: 132, orders: 414, cogsIqd: 28696, marginPct: 86.1, itemsTotal: 58, revenueIqd: 793198, itemsWithCogs: 21, grossProfitIqd: 177304, cogsCoveragePct: 26, avgOrderValueIqd: 1916 },
    byCategory: [{ qty: 11, items: 1, cogsIqd: null, marginPct: null, categoryId: 'k1', revenueIqd: 100000, categoryNameAr: 'مشروبات', categoryNameEn: 'Drinks', grossProfitIqd: null }],
    wasteByReason: [{ qty: 30, count: 3, reason: 'waste_spill', costIqd: 15000 }],
    prepTimes: { count: 18, avgSeconds: 240, p90Seconds: 600 },
  };
  it('reads items, categories, the summary, waste by reason and prep times', () => {
    const r = readCafe(payload);
    expect(r.items[0]).toMatchObject({ itemId: 'i1', name: { en: 'Coffee', ar: 'قهوة' }, category: { en: 'Drinks', ar: 'مشروبات' }, cogsIqd: null, grossProfitIqd: null });
    expect(r.categories[0]).toMatchObject({ categoryId: 'k1', items: 1, revenueIqd: 100000 });
    expect(r.summary).toMatchObject({ itemsWithCogs: 21, itemsTotal: 58, marginPct: 86.1, avgOrderValueIqd: 1916 });
    expect(r.waste).toEqual([{ reason: 'waste_spill', count: 3, costIqd: 15000 }]);
    expect(r.prep).toEqual({ count: 18, avgSeconds: 240, p90Seconds: 600 });
    expect(cafeIsEmpty(r)).toBe(false);
  });
  it('is not empty when the period only wrote stock off', () => {
    expect(cafeIsEmpty(readCafe({ rows: [], summary: { orders: 0 }, wasteByReason: [{ reason: 'expired_writeoff', count: 1, costIqd: 5 }] }))).toBe(false);
    expect(cafeIsEmpty(readCafe({ rows: [], summary: { orders: 0 }, wasteByReason: [] }))).toBe(true);
  });
});

describe('readStock', () => {
  it('reads the named lists — report_stock sends no rows at all', () => {
    const r = readStock({
      stockValueIqd: 1633337,
      lowStock: [{ unit: 'g', nameAr: 'حليب', nameEn: 'Milk', onHand: 0, parLevel: 5000, threshold: 1000, ingredientId: 'm1' }],
      belowPar: [{ unit: 'g', nameEn: 'Milk', nameAr: 'حليب', onHand: 0, parLevel: 5000, shortfall: 5000, ingredientId: 'm1' }],
      expiringSoon: [{ unit: 'g', nameEn: 'Fruit', nameAr: 'فواكه', batchId: 'b1', valueIqd: 20000, expiryDate: '2026-09-17', daysLeft: 0, ingredientId: 'f1', qtyRemaining: 4000 }],
      expired: [{ unit: 'pc', nameEn: 'Buns', nameAr: 'خبز', batchId: 'b2', valueIqd: 11000, expiryDate: '2026-09-15', daysExpired: 2, ingredientId: 'b', qtyRemaining: 22 }],
      consumption: [{ unit: 'g', nameEn: 'Beans', nameAr: 'بن', costIqd: 5550, consumedQty: 222, ingredientId: 'e1' }],
      variance: [{ unit: 'pc', nameEn: 'Patty', nameAr: 'قرص', countId: 'k', periodEnd: '2026-09-17T00:10:10Z', countedQty: 1039, varianceQty: 0, ingredientId: 'p1', theoreticalQty: 1039 }],
    });
    expect(r.valueIqd).toBe(1633337);
    expect(r.low[0]).toMatchObject({ name: { en: 'Milk', ar: 'حليب' }, unit: 'g', threshold: 1000, parLevel: 5000 });
    expect(r.belowPar[0]?.shortfall).toBe(5000);
    // Days left and days past share one field; which it is depends on the list.
    expect(r.expiringSoon[0]).toMatchObject({ batchId: 'b1', days: 0, valueIqd: 20000 });
    expect(r.expired[0]).toMatchObject({ batchId: 'b2', days: 2, qtyRemaining: 22 });
    expect(r.consumption[0]).toMatchObject({ consumedQty: 222, costIqd: 5550 });
    expect(r.variance[0]).toMatchObject({ countedAt: '2026-09-17T00:10:10Z', theoreticalQty: 1039, countedQty: 1039, varianceQty: 0 });
  });
  it('keeps an unreported stock value as null', () => {
    expect(readStock({}).valueIqd).toBeNull();
  });
});

describe('readStaff / dayClosesOf', () => {
  const payload = {
    rows: [
      { name: 'Dev Cashier', role: 'cashier', voids: { count: 0, amountIqd: 0 }, refunds: { count: 0, amountIqd: 0 }, staffId: 's1', isActive: true, dayCloses: [], discounts: { count: 37, amountIqd: 49802 }, ordersTaken: 292, shiftContext: { daysWorked: 3, busiestDayOrders: 192 }, paymentsTaken: 80, bookingsCreated: 0, waiterCallResponse: { count: 6, avgSeconds: 300 } },
      { name: 'Dev Manager', role: 'manager', staffId: 's2', isActive: false, dayCloses: [{ businessDate: '2026-09-01', cashVarianceIqd: -188000 }, { businessDate: '2026-09-03', cashVarianceIqd: 0 }], waiterCallResponse: { count: 0, avgSeconds: null } },
    ],
  };
  it('flattens the nested figures, keeping unreported ones null', () => {
    const [a, b] = readStaff(payload);
    expect(a).toMatchObject({ staffId: 's1', role: 'cashier', discounts: { count: 37, amountIqd: 49802 }, callsAnswered: 6, avgAnswerSeconds: 300, daysActive: 3, busiestDayOrders: 192 });
    expect(b).toMatchObject({ isActive: false, ordersTaken: null, voids: { count: null, amountIqd: null }, avgAnswerSeconds: null });
  });
  it('lists every day close newest first, with who closed it', () => {
    expect(dayClosesOf(readStaff(payload))).toEqual([
      { staffId: 's2', closedBy: 'Dev Manager', businessDate: '2026-09-03', cashVarianceIqd: 0 },
      { staffId: 's2', closedBy: 'Dev Manager', businessDate: '2026-09-01', cashVarianceIqd: -188000 },
    ]);
  });
});

describe('readDrill', () => {
  it('reads transactions and drops nothing the dialog shows', () => {
    expect(readDrill({ transactions: [{ id: 't1', at: '2026-09-01T10:00:00Z', kind: 'refund', label: 'refund · spill · cash', amountIqd: 5000, staffId: 's', staffName: 'Dev', reference: 'x' }] })).toEqual([
      { id: 't1', at: '2026-09-01T10:00:00Z', kind: 'refund', label: 'refund · spill · cash', amountIqd: 5000, staffName: 'Dev', detail: null },
    ]);
    // 0102: the structured detail passes through for the dialog to word.
    expect(readDrill({ transactions: [{ id: 't2', detail: { sub: 'refund', reason: 'spill', method: 'cash' } }] })[0]!.detail).toEqual({ sub: 'refund', reason: 'spill', method: 'cash' });
    expect(readDrill(undefined)).toEqual([]);
  });
});

describe('sortBy', () => {
  const rows = [
    { name: 'B', n: 2 },
    { name: 'A', n: null },
    { name: 'C', n: 1 },
  ];
  it('sorts numbers with nulls last in either direction, and strings by locale', () => {
    expect(sortBy(rows, (r) => r.n, 'asc').map((r) => r.name)).toEqual(['C', 'B', 'A']);
    expect(sortBy(rows, (r) => r.n, 'desc').map((r) => r.name)).toEqual(['B', 'C', 'A']);
    expect(sortBy(rows, (r) => r.name, 'asc').map((r) => r.name)).toEqual(['A', 'B', 'C']);
  });
  it('keeps server order, in a new array, when unsorted', () => {
    const out = sortBy(rows, null, 'asc');
    expect(out).toEqual(rows);
    expect(out).not.toBe(rows);
  });
});

describe('bucketRange', () => {
  const period = { from: '2026-09-03', to: '2026-09-17' };
  it('is the day itself for a day', () => {
    expect(bucketRange('2026-09-11', 'day', period)).toEqual({ from: '2026-09-11', to: '2026-09-11' });
  });
  it('runs a week to its Sunday and a month to its last day, cut to the period', () => {
    expect(bucketRange('2026-09-07', 'week', period)).toEqual({ from: '2026-09-07', to: '2026-09-13' });
    expect(bucketRange('2026-09-14', 'week', period)).toEqual({ from: '2026-09-14', to: '2026-09-17' });
    expect(bucketRange('2026-08-31', 'week', period)).toEqual({ from: '2026-09-03', to: '2026-09-06' });
    expect(bucketRange('2026-09-01', 'month', period)).toEqual({ from: '2026-09-03', to: '2026-09-17' });
    expect(bucketRange('2026-02-01', 'month', { from: '2026-01-01', to: '2026-12-31' })).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });
});

describe('readCompared', () => {
  it('keeps the current report and the server-worked changes, and nothing else', () => {
    const out = readCompared(
      { current: { n: 1 }, previous: { n: 0 }, changes: { totalIqd: { previous: '2000', changeAbs: 500, changePct: 25 }, bad: 'x' }, comparison: { mode: 'previousPeriod', from: '2026-08-01', to: '2026-08-31' } },
      (raw) => raw as { n: number },
    );
    expect(out).toEqual({ current: { n: 1 }, changes: { totalIqd: { previous: 2000, changeAbs: 500, changePct: 25 } }, period: { from: '2026-08-01', to: '2026-08-31' } });
  });
});
