import { describe, expect, it } from 'vitest';
import { TABLE_SLOTS } from '../floor/floorModel';
import { LOCAL_TAB_PREFIX, type OfflineTab } from '../../lib/offlineTabs';
import { CAFE_SPOTS, CAFE_VIEW, courtBoards, courtTabCount, otherOpenTabs, placeCafe, spotPosition, type CourtBookingRow } from './floorPlan';
import type { TabListRow } from './tillData';

const tab = (id: string, table: string | null, over: Partial<TabListRow> = {}): TabListRow => ({
  id,
  status: 'open',
  label: null,
  opened_at: '2026-09-22T18:00:00Z',
  total_iqd: null,
  table: table ? { table_number: table } : null,
  reservation: null,
  orders: [],
  tab_adjustments: [],
  payments: [],
  ...over,
});

const offline = (key: string, tableNumber: string | null, over: Partial<OfflineTab> = {}): OfflineTab => ({
  idemKey: key,
  localId: `l-${key}`,
  label: null,
  tableNumber,
  openedAt: '2026-09-22T18:30:00Z',
  lines: [],
  settled: false,
  ...over,
});

const tables = ['T10', 'T2', 'T1', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9'].map((n) => ({ id: `id-${n}`, table_number: n }));

describe('the room', () => {
  it('draws the same nine spots as the live floor', () => {
    expect(CAFE_SPOTS).toHaveLength(TABLE_SLOTS);
  });

  it('every spot sits inside the drawn part of the room', () => {
    for (const s of CAFE_SPOTS) {
      const p = spotPosition(s);
      expect(p.inline).toBeGreaterThan(0);
      expect(p.inline).toBeLessThan(1);
      expect(p.block).toBeGreaterThan(0);
      expect(p.block).toBeLessThan(1);
    }
    expect(spotPosition({ x: CAFE_VIEW.x, z: CAFE_VIEW.z })).toEqual({ inline: 0, block: 0 });
  });
});

describe('placeCafe', () => {
  it('takes tables in table-number order, and a tenth table has no spot but is still listed', () => {
    const spots = placeCafe(tables, [], []);
    expect(spots.map((s) => s.table.table_number)).toEqual(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T8', 'T9', 'T10']);
    expect(spots[0]!.slot).toBe(0);
    expect(spots[8]!.slot).toBe(8);
    expect(spots[9]!.slot).toBeNull();
  });

  it('a table with a live tab is open, and one awaiting payment is paying', () => {
    const spots = placeCafe(tables, [tab('a', 'T1'), tab('b', 'T2', { status: 'awaiting_payment' })], []);
    const by = (n: string) => spots.find((s) => s.table.table_number === n)!;
    expect(by('T1').status).toBe('open');
    expect(by('T2').status).toBe('paying');
    expect(by('T3').status).toBe('free');
    expect(by('T3').tabs).toEqual([]);
  });

  it('says how many items each tab holds, voids excluded, so two tabs on one table can be told apart', () => {
    const t = tab('a', 'T1', {
      orders: [
        { source: 'till', status: 'sent', order_items: [{ line_total_iqd: 1, voided: false, menu_item: null }, { line_total_iqd: 1, voided: true, menu_item: null }] },
        { source: 'guest_web', status: 'sent', order_items: [{ line_total_iqd: 1, voided: false, menu_item: null }] },
      ],
    });
    const [t1] = placeCafe(tables, [t], []);
    expect(t1!.tabs[0]).toMatchObject({ items: 2, web: true });
  });

  it('counts every tab on a shared table, oldest first, never folding them into one', () => {
    const spots = placeCafe(tables, [tab('late', 'T4', { opened_at: '2026-09-22T19:00:00Z' }), tab('early', 'T4')], []);
    expect(spots.find((s) => s.table.table_number === 'T4')!.tabs.map((t) => t.id)).toEqual(['early', 'late']);
  });

  it('an offline tab turns its table green under its local id; a settled one does not', () => {
    const spots = placeCafe(tables, [], [offline('k1', 'T5'), offline('k2', 'T6', { settled: true })]);
    const t5 = spots.find((s) => s.table.table_number === 'T5')!;
    expect(t5.status).toBe('open');
    expect(t5.tabs[0]).toMatchObject({ id: `${LOCAL_TAB_PREFIX}k1`, offline: true, items: 0 });
    expect(spots.find((s) => s.table.table_number === 'T6')!.status).toBe('free');
  });

  it('marks a table calling only while a call on it is raised', () => {
    const spots = placeCafe(tables, [], [], [
      { status: 'raised', table: { table_number: 'T7' } },
      { status: 'acknowledged', table: { table_number: 'T8' } },
    ]);
    expect(spots.find((s) => s.table.table_number === 'T7')!.calling).toBe(true);
    expect(spots.find((s) => s.table.table_number === 'T8')!.calling).toBe(false);
  });
});

describe('courtBoards', () => {
  const now = Date.parse('2026-09-22T19:00:00Z');
  const courts = [
    { id: 'c2', name_en: 'Court 2', name_ar: 'ملعب ٢', sort_order: 2 },
    { id: 'c1', name_en: 'Court 1', name_ar: 'ملعب ١', sort_order: 1 },
  ];
  const booking = (id: string, court: string, start: string, end: string, tabs: CourtBookingRow['tabs'] = []): CourtBookingRow => ({
    id,
    court_id: court,
    start_at: `2026-09-22T${start}:00Z`,
    end_at: `2026-09-22T${end}:00Z`,
    status: 'confirmed',
    guest_name: id,
    tabs,
  });

  it('boards follow rail order', () => {
    expect(courtBoards(courts, [], now).map((b) => b.court.id)).toEqual(['c1', 'c2']);
  });

  it('lists what is playing or still to come, and an ended booking only while its tab is open', () => {
    const boards = courtBoards(
      courts,
      [
        booking('ended', 'c1', '16:00', '17:30'),
        booking('endedWithTab', 'c1', '17:30', '18:30', [{ id: 'tab1', status: 'open' }]),
        booking('next', 'c1', '20:00', '21:30'),
        booking('now', 'c1', '18:30', '20:00'),
      ],
      now,
    );
    const c1 = boards[0]!;
    expect(c1.bookings.map((b) => b.booking.id)).toEqual(['endedWithTab', 'now', 'next']);
    expect(c1.featured?.booking.id).toBe('now');
    expect(c1.bookings[0]!.liveTab?.id).toBe('tab1');
    expect(c1.bookings.map((b) => b.phase)).toEqual(['ended', 'playing', 'upcoming']);
  });

  it('a settled tab does not count as live, and with nothing playing the next booking is featured', () => {
    const [c1] = courtBoards(courts, [booking('later', 'c1', '21:00', '22:00', [{ id: 'old', status: 'settled' }])], now);
    expect(c1!.bookings[0]!.liveTab).toBeNull();
    expect(c1!.featured?.booking.id).toBe('later');
    expect(courtTabCount(courtBoards(courts, [booking('x', 'c2', '18:00', '20:00', [{ id: 't', status: 'awaiting_payment' }])], now))).toBe(1);
  });
});

describe('otherOpenTabs', () => {
  it('keeps every live tab reachable: what no table or court shows is listed', () => {
    const tabs = [tab('onTable', 'T1'), tab('retiredTable', 'T99'), tab('booking', null), tab('noAnchor', null)];
    const spots = placeCafe(tables, tabs, [offline('k1', null), offline('k2', 'T2')]);
    const boards = courtBoards(
      [{ id: 'c1', name_en: 'Court 1', name_ar: '', sort_order: 1 }],
      [{ id: 'b', court_id: 'c1', start_at: '2026-09-22T18:00:00Z', end_at: '2026-09-22T23:00:00Z', status: 'arrived', guest_name: null, tabs: [{ id: 'booking', status: 'open' }] }],
      Date.parse('2026-09-22T19:00:00Z'),
    );
    expect(otherOpenTabs(tabs, [offline('k1', null), offline('k2', 'T2')], spots, boards)).toEqual(['retiredTable', 'noAnchor', `${LOCAL_TAB_PREFIX}k1`]);
  });
});
