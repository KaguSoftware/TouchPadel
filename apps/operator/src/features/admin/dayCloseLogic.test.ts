import { describe, it, expect } from 'vitest';
import {
  closeBlock,
  dayCloseCsv,
  deriveDayCloseState,
  describeAdjustmentKind,
  knownReason,
  queueErrorCode,
  queueWriteKey,
  tillShiftCsvRows,
  tillShiftRows,
  varianceMagnitude,
  varianceSign,
  unpaidPlayedRows,
  unfinishedChecklists,
  isMatchUnpaid,
  crossDayKey,
  LESSON_DAY_KEYS,
  onlineGroupTitleKey,
  onlineIsEmpty,
  onlineLabelKey,
  onlineMoneyOf,
  readDayCloseOnline,
  unpaidMatchLabel,
  unpaidSeats,
  type CsvLabels,
  type DayAdjustmentRow,
  type ShiftCsvLabels,
  QUEUE_WRITE_KEY,
} from './dayCloseLogic';
import { readShiftList } from '../tillShift/tillShiftLogic';
import { MUTATION_TYPES } from '@touch/core/schemas/mutations';
import { COACHING_SHAPES } from '@touch/core';

const base = { dayLoaded: true, dayOpen: true, openTabCount: 0, queuedCount: 0, busy: false, closed: false, error: null };

describe('deriveDayCloseState', () => {
  it('walks the spec states in precedence order', () => {
    expect(deriveDayCloseState({ ...base, dayLoaded: false })).toBe('loading');
    expect(deriveDayCloseState({ ...base, dayOpen: false })).toBe('noOpenDay');
    expect(deriveDayCloseState(base)).toBe('ready');
    expect(deriveDayCloseState({ ...base, busy: true })).toBe('busy');
    expect(deriveDayCloseState({ ...base, closed: true })).toBe('closed');
  });

  it('blocks on open tabs before anything else the manager could fix later', () => {
    // The day CANNOT close while a tab is open on the floor (spec 06.22). The
    // block must show even while a server error from a previous attempt is set.
    expect(deriveDayCloseState({ ...base, openTabCount: 2, error: new Error('DAY_OPEN_TABS') })).toBe('blockedByOpenTabs');
    expect(deriveDayCloseState({ ...base, openTabCount: 1, queuedCount: 3 })).toBe('blockedByOpenTabs');
  });

  it('blocks on unsynced queue rows', () => {
    expect(deriveDayCloseState({ ...base, queuedCount: 1 })).toBe('blockedByUnsyncedQueue');
  });

  it('shows an error only when nothing else explains it', () => {
    expect(deriveDayCloseState({ ...base, error: new Error('x') })).toBe('error');
  });

  it('closed wins over everything, including a stale error', () => {
    expect(deriveDayCloseState({ ...base, closed: true, error: new Error('x'), openTabCount: 1 })).toBe('closed');
  });
});

describe('variance wording', () => {
  it('names the sign of the server variance and shows its magnitude', () => {
    expect(varianceSign(2500)).toBe('over');
    expect(varianceSign(-2500)).toBe('short');
    expect(varianceSign(0)).toBe('exact');
    expect(varianceMagnitude(-2500)).toBe(2500);
    expect(varianceMagnitude(2500)).toBe(2500);
  });
});

describe('dayCloseCsv', () => {
  const labels: CsvLabels = {
    tabFigures: 'Day close', figure: 'Figure', value: 'Value', count: 'Count', authorisers: 'Authorised by', note: 'Note', partOf: 'Part of the line above',
    cashExpected: 'Cash expected', cashCounted: 'Cash counted', variance: 'Variance',
    cardExpected: 'Card expected', cardBatch: 'Card batch', discounts: 'Discounts', voids: 'Voids',
    refunds: 'Refunds', waste: 'Waste', openingFloat: 'Float', cashPayments: 'Cash in', cardPayments: 'Card in',
    deskCash: 'Desk cash', deskCard: 'Desk card',
    adjustments: 'Adjustments', date: 'Date', time: 'Time', what: 'What', appliesTo: 'Applies to',
    reason: 'Reason', amount: 'Amount', appliedBy: 'Applied by', authorisedBy: 'Authorised by', tab: 'Tab id',
  };
  const words = {
    what: (a: DayAdjustmentRow) => `words for ${a.kind}`,
    scope: (a: DayAdjustmentRow) => (a.order_item_id ? 'One item' : 'The whole bill'),
    reason: (a: DayAdjustmentRow) => a.reason_code,
  };
  const summary = {
    day_session_id: 'd1', business_date: '2026-09-03', status: 'closed', opening_float_iqd: 50000,
    cash_payments_iqd: 120000, card_payments_iqd: 80000, cash_expected_iqd: 170000, cash_counted_iqd: 168000,
    cash_variance_iqd: -2000, card_expected_iqd: 80000, card_terminal_batch_iqd: 80000,
    discounts_iqd: 15000, adjustment_count: 2, authorizer_names: ['Dev Manager', 'Dev Owner'],
    voided_lines_iqd: 4000, voided_line_count: 1, refunds_iqd: 0, refund_count: 0, waste_cost_iqd: 2500,
    desk_cash_iqd: 30000, desk_card_iqd: 0,
  };
  const close = {
    day_session_id: 'd1', business_date: '2026-09-03', cash_expected_iqd: 170000, cash_counted_iqd: 168000,
    cash_variance_iqd: -2000, card_expected_iqd: 80000, card_terminal_batch_iqd: 80000,
  };
  const figuresOf = (bundle: ReturnType<typeof dayCloseCsv>) => bundle[0]!;
  const adjustmentsOf = (bundle: ReturnType<typeof dayCloseCsv>) => bundle[1]!;

  const adjustment: DayAdjustmentRow = {
    adjustment_id: 'a1', tab_id: '9f8e7d6c-1111-4222-8333-444455556666', kind: 'discount', value: 10, amount_iqd: 5000,
    reason_code: 'comp', created_at: '2026-09-03T18:42:00', applied_by_name: 'Sara', authorized_by_name: 'Dev Manager',
  };

  it('is two tables, not one: the figures, then the adjustments, each its own sheet', () => {
    const bundle = dayCloseCsv(labels, close, summary, [adjustment], (names) => names.join(', '), words);
    expect(bundle.map((t) => t.name)).toEqual(['Day close', 'Adjustments']);
  });

  it('lays out the server figures with the authorisers', () => {
    const { name, columns, rows } = figuresOf(dayCloseCsv(labels, close, summary, [], (names) => names.join(', '), words));
    expect(name).toBe('Day close');
    expect(columns).toEqual(['Figure', { header: 'Value', type: 'money' }, { header: 'Count', type: 'number' }, 'Authorised by', 'Note']);
    expect(rows).toContainEqual(['Cash expected', 170000, null, null, null]);
    expect(rows).toContainEqual(['Variance', -2000, null, null, null]);
    expect(rows).toContainEqual(['Discounts', 15000, 2, 'Dev Manager, Dev Owner', null]);
  });

  it('gives each adjustment its own row with the date, the time and each fact in a column', () => {
    const { name, columns, rows } = adjustmentsOf(dayCloseCsv(labels, close, summary, [adjustment], (n) => n.join(', '), words));
    expect(name).toBe('Adjustments');
    expect(columns).toEqual(['Date', 'Time', 'What', 'Applies to', 'Reason', { header: 'Amount', type: 'money' }, 'Applied by', 'Authorised by', 'Tab id']);
    // No sentence crammed into the figure column, and the uuid is the short form.
    expect(rows).toEqual([['2026-09-03', '18:42', 'words for discount', 'The whole bill', 'comp', 5000, 'Sara', 'Dev Manager', '9f8e7d6c']]);
  });

  it('lists the court desk’s cash and card right after the totals they are part of, and says they are part of them', () => {
    const { rows } = figuresOf(dayCloseCsv(labels, null, summary, [], (n) => n.join(', '), words));
    const names = rows.map((r) => r[0]);
    expect(rows).toContainEqual(['Desk cash', 30000, null, null, 'Part of the line above']);
    expect(rows).toContainEqual(['Desk card', 0, null, null, 'Part of the line above']);
    expect(names.indexOf('Desk cash')).toBe(names.indexOf('Cash in') + 1);
    expect(names.indexOf('Desk card')).toBe(names.indexOf('Card in') + 1);
  });

  it('leaves the desk lines out when the server did not send them', () => {
    const older = { ...summary, desk_cash_iqd: undefined, desk_card_iqd: undefined };
    const { rows } = figuresOf(dayCloseCsv(labels, null, older, [], (n) => n.join(', '), words));
    expect(rows.some((r) => r[0] === 'Desk cash' || r[0] === 'Desk card')).toBe(false);
  });

  it('exports what it has before the close (no close figures yet)', () => {
    const { rows } = figuresOf(dayCloseCsv(labels, null, summary, [], (n) => n.join(', '), words));
    expect(rows.some((r) => r[0] === 'Cash expected')).toBe(false);
    expect(rows.some((r) => r[0] === 'Cash in')).toBe(true);
  });
});

describe('plain words for stored codes', () => {
  it('names the adjustment kind and reads a percentage from basis points', () => {
    expect(describeAdjustmentKind({ kind: 'discount_percent', value: 1000 })).toEqual({ kind: 'percent', percent: 10 });
    expect(describeAdjustmentKind({ kind: 'discount_percent', value: 750 })).toEqual({ kind: 'percent', percent: 7.5 });
    expect(describeAdjustmentKind({ kind: 'discount_amount', value: 1500 })).toEqual({ kind: 'amount', percent: null });
    expect(describeAdjustmentKind({ kind: 'price_override', value: 9000 })).toEqual({ kind: 'override', percent: null });
    expect(describeAdjustmentKind({ kind: 'something_new', value: 1 })).toEqual({ kind: 'other', percent: null });
  });

  it('recognises the reason codes staff pick from and nothing else', () => {
    expect(knownReason('comp')).toBe('comp');
    expect(knownReason('customer_request')).toBe('customer_request');
    expect(knownReason('replay-test')).toBeNull();
    expect(knownReason(null)).toBeNull();
  });

  it('maps queue mutation types to a word, with a fallback for new ones', () => {
    expect(queueWriteKey('payment.record')).toBe('payment');
    expect(queueWriteKey('order.add_items')).toBe('order');
    expect(queueWriteKey('reservation.update')).toBe('booking');
    expect(queueWriteKey('future.thing')).toBe('other');
  });

  it('has a word for EVERY queued mutation type — the sixth copy of the contract (item 9)', () => {
    expect(Object.keys(QUEUE_WRITE_KEY).sort()).toEqual([...MUTATION_TYPES].sort());
  });

  it('pulls the error code off a queue row error, leading or after the worker’s HTTP status', () => {
    expect(queueErrorCode('ITEM_UNAVAILABLE: the item is sold out')).toBe('ITEM_UNAVAILABLE');
    // sync-worker.ts markFailed stores `${status}: ${detail}`; the code sits after the status.
    expect(queueErrorCode('400: TAB_NOT_EMPTY')).toBe('TAB_NOT_EMPTY');
    expect(queueErrorCode('400: the server said no')).toBeNull();
    expect(queueErrorCode('network down')).toBeNull();
    expect(queueErrorCode('HTTP 503 gateway')).toBeNull();
    expect(queueErrorCode(null)).toBeNull();
  });
});

describe('closeBlock', () => {
  it('names the first step still holding the close, tabs before sync before the count', () => {
    expect(closeBlock('blockedByOpenTabs', null)).toBe('openTabs');
    expect(closeBlock('blockedByUnsyncedQueue', 100000)).toBe('unsynced');
    expect(closeBlock('ready', null)).toBe('noCount');
    expect(closeBlock('ready', 125000)).toBeNull();
  });

  it('treats a count of zero as a count, not as missing', () => {
    expect(closeBlock('ready', 0)).toBeNull();
  });
});

describe('played today, not paid', () => {
  const row = {
    reservation_id: 'r1', guest_name: 'Ali', status: 'completed', start_at: '2026-09-17T18:00:00Z', end_at: '2026-09-17T19:30:00Z',
    court_name_en: 'Court 1', court_name_ar: 'الملعب 1', price_iqd: 30000, remaining_iqd: 30000, live_tab_id: null,
  };

  it('reads the RPC payload as rows', () => {
    expect(unpaidPlayedRows([row])).toEqual([row]);
  });

  it('reads anything that is not a list of bookings as nothing to warn about', () => {
    expect(unpaidPlayedRows(null)).toEqual([]);
    expect(unpaidPlayedRows({ error: 'x' })).toEqual([]);
    expect(unpaidPlayedRows([null, { guest_name: 'no id' }, row])).toEqual([row]);
  });

  it('never holds the close: unpaid bookings are not an input to the state or the block', () => {
    // A warning, not a block (decided 2026-09-17). The state machine has no
    // input for them, so a ready day with unpaid bookings stays ready.
    expect(deriveDayCloseState(base)).toBe('ready');
    expect(closeBlock('ready', 125000)).toBeNull();
  });
});

describe('checklists not finished', () => {
  const list = (role: string, slot: string, done: number, total: number) => ({
    role,
    slot,
    name_en: 'List',
    name_ar: 'قائمة',
    done,
    total,
    open_items: total > done ? [{ text_en: 'Mop the floor', text_ar: 'امسح الأرض' }] : [],
  });

  it('lists only the lists with a line nobody ticked, in the server order', () => {
    const rows = unfinishedChecklists({
      business_date: '2026-09-25',
      lists: [list('barista', 'open', 5, 5), list('barista', 'close', 2, 4), list('driver', 'open', 0, 3)],
    });
    expect(rows.map((r) => `${r.role}.${r.slot}`)).toEqual(['barista.close', 'driver.open']);
    expect(rows[0]!.open_items).toEqual([{ text_en: 'Mop the floor', text_ar: 'امسح الأرض' }]);
  });

  it('reads anything that is not the RPC payload as nothing to warn about', () => {
    expect(unfinishedChecklists(null)).toEqual([]);
    expect(unfinishedChecklists([list('barista', 'open', 0, 1)])).toEqual([]);
    expect(unfinishedChecklists({ lists: [{ role: 'barista' }] })).toEqual([]);
  });

  // That they never hold the close is proven on the screen, where the lists
  // and the Close button meet (DayClose.test.tsx).
});

// ---------------------------------------------------------------------------
// Till shifts (wave5-addendum-2026-09-25 §5.2, V10): a warning step, never a block.
// ---------------------------------------------------------------------------

describe('till shifts at day close', () => {
  const shift = (over: Record<string, unknown>) => ({
    id: 's1', day_session_id: 'd1', business_date: '2026-09-26', station_id: 'TILL-01', staff_id: 'maha', staff_name: 'Maha',
    opened_at: '2026-09-26T06:00:00Z', closed_at: '2026-09-26T13:00:00Z', closed_via: 'own_pin', closed_by_name: 'Maha',
    authorized_by_name: 'Maha', opening_float_iqd: 100000, handover_difference_iqd: null, cash_payments_iqd: 250000,
    cash_refunds_iqd: 0, cash_expected_iqd: 350000, cash_counted_iqd: 345000, cash_variance_iqd: -5000,
    card_payments_iqd: 80000, card_refunds_iqd: 0, payment_count: 12, refund_count: 0, drawer_open_count: 1,
    open_note: null, close_note: null, ...over,
  });
  const list = readShiftList({
    shifts: [
      shift({}),
      shift({ id: 's2', staff_name: 'Ali', staff_id: 'ali', closed_at: null, closed_via: null, cash_counted_iqd: null, cash_variance_iqd: null, authorized_by_name: null }),
      shift({ id: 's3', staff_name: 'Hussein', station_id: 'DESK-01', closed_via: 'day_close', cash_counted_iqd: null, cash_variance_iqd: null, authorized_by_name: null }),
      shift({ id: 'other-day', day_session_id: 'd0' }),
    ],
    outside: [
      { day_session_id: 'd1', business_date: '2026-09-26', station_id: 'TILL-01', cash_payments_iqd: 20000, cash_refunds_iqd: 5000, card_payments_iqd: 0, card_refunds_iqd: 0, payment_count: 1, refund_count: 1 },
      { day_session_id: 'd1', business_date: '2026-09-26', station_id: null, cash_payments_iqd: 0, cash_refunds_iqd: 0, card_payments_iqd: 0, card_refunds_iqd: 0, payment_count: 0, refund_count: 0 },
      { day_session_id: 'd0', business_date: '2026-09-25', station_id: 'TILL-01', cash_payments_iqd: 9, cash_refunds_iqd: 0, card_payments_iqd: 0, card_refunds_iqd: 0, payment_count: 1, refund_count: 0 },
    ],
    cross_day: [
      { day_session_id: 'd0', business_date: '2026-09-25', earlier_days_cash_refunds_iqd: 0, earlier_days_card_refunds_iqd: 0, later_cash_refunds_iqd: 30000, later_card_refunds_iqd: 0 },
      { day_session_id: 'd1', business_date: '2026-09-26', earlier_days_cash_refunds_iqd: 30000, earlier_days_card_refunds_iqd: 0, later_cash_refunds_iqd: 0, later_card_refunds_iqd: 0 },
    ],
  });

  it('narrows the list to the day on screen: its shifts, the money outside a shift, its cross-day refunds', () => {
    const day = tillShiftRows(list, 'd1');
    expect(day.shifts.map((s) => s.id)).toEqual(['s1', 's2', 's3']);
    // A station with nothing taken outside a shift is not a row.
    expect(day.outside.map((o) => o.station_id)).toEqual(['TILL-01']);
    expect(day.earlierDaysCashRefundsIqd).toBe(30000);
    expect(day.openCount).toBe(1);
  });

  it('reads a list that has not answered as nothing to warn about', () => {
    expect(tillShiftRows(undefined, 'd1')).toEqual({ shifts: [], outside: [], earlierDaysCashRefundsIqd: 0, openCount: 0 });
    expect(tillShiftRows(null, null).shifts).toEqual([]);
  });

  it('never holds the close: an open shift is not an input to the state or the block', () => {
    // A warning, never a block (§5.2): close_day ends an open shift uncounted
    // (TI9). Neither function takes a shift, so a ready day stays ready.
    expect(tillShiftRows(list, 'd1').openCount).toBe(1);
    expect(deriveDayCloseState(base)).toBe('ready');
    expect(closeBlock('ready', 125000)).toBeNull();
    expect(deriveDayCloseState.length).toBe(1);
    expect(closeBlock.length).toBe(2);
  });

  const labels: ShiftCsvLabels = {
    shift: (n, s) => `Shift ${n} ${s}`,
    shiftOpen: (n, s) => `Open ${n} ${s}`,
    shiftByDay: (n, s) => `By day ${n} ${s}`,
    outsideIn: (s) => `Outside in ${s}`,
    outsideOut: (s) => `Outside out ${s}`,
    crossDay: 'Cross day',
    noStation: 'No station',
  };

  it('writes a CSV row per shift with its stamped difference, then outside money, then the cross-day line', () => {
    expect(tillShiftCsvRows(tillShiftRows(list, 'd1'), labels)).toEqual([
      ['Shift Maha TILL-01', -5000, 12, 'Maha'],
      ['Open Ali TILL-01', null, 12, null],
      ['By day Hussein DESK-01', null, 12, null],
      ['Outside in TILL-01', 20000, 1, null],
      ['Outside out TILL-01', 5000, 1, null],
      ['Cross day', 30000, null, null],
    ]);
  });

  it('names a write with no station', () => {
    const day = tillShiftRows(
      readShiftList({ outside: [{ day_session_id: 'd1', station_id: null, cash_payments_iqd: 7000, payment_count: 1 }] }),
      'd1',
    );
    expect(tillShiftCsvRows(day, labels)).toEqual([['Outside in No station', 7000, 1, null]]);
  });

  it('appends the shift rows after everything the figures sheet already exports', () => {
    const labels2 = {
      tabFigures: 'Day close', figure: 'Figure', value: 'Value', count: 'Count', authorisers: 'Authorised by', note: 'Note', partOf: 'Part of the line above',
      cashExpected: 'Cash expected', cashCounted: 'Cash counted', variance: 'Variance',
      cardExpected: 'Card expected', cardBatch: 'Card batch', discounts: 'Discounts', voids: 'Voids',
      refunds: 'Refunds', waste: 'Waste', openingFloat: 'Float', cashPayments: 'Cash in', cardPayments: 'Card in',
      deskCash: 'Desk cash', deskCard: 'Desk card',
      adjustments: 'Adjustments', date: 'Date', time: 'Time', what: 'What', appliesTo: 'Applies to',
      reason: 'Reason', amount: 'Amount', appliedBy: 'Applied by', authorisedBy: 'Authorised by', tab: 'Tab id',
    } satisfies CsvLabels;
    const words = { what: () => '', scope: () => '', reason: () => null };
    const shiftRows = tillShiftCsvRows(tillShiftRows(list, 'd1'), labels);
    const [figures, adjustments] = dayCloseCsv(labels2, null, null, [], (n) => n.join(', '), words, shiftRows);
    // The figures sheet's fifth column (the note) is empty on a shift line.
    expect(figures!.rows.slice(-shiftRows.length)).toEqual(shiftRows.map((r) => [...r, null]));
    expect(adjustments!.rows).toEqual([]);
    // Without them, the export is what it was.
    expect(dayCloseCsv(labels2, null, null, [], (n) => n.join(', '), words)[0]!.rows).toEqual([]);
  });
});

// Open matches (operator.md §5.18): the online card and the match rows of "Played, not paid".
describe('readDayCloseOnline / onlineMoneyOf / onlineIsEmpty', () => {
  const payload = {
    day_session_id: 'ds1',
    business_date: '2026-09-28',
    deposits: { received_iqd: 45000, received_count: 3, refunded_iqd: 15000, refunded_count: 1, forfeited_iqd: 0, forfeited_count: 0, refunds_waiting_iqd: 0, refunds_waiting_count: 0 },
    tickets_here: { forfeited_iqd: 10000, forfeited_count: 1, restored_count: 0, cashouts_iqd: 0, cashouts_count: 0 },
    tickets_chain: { sold_iqd: '80000', sold_tickets: 8, purchases: 3, refunded_iqd: 0, refunded_tickets: 0, refunds_waiting_iqd: 0, refunds_waiting_count: 0, liability_iqd: 60000, liability_tickets: 6 },
    matches: { bookings: 2, price_iqd: 120000, desk_paid_iqd: 90000, written_off_iqd: 30000, owed_iqd: 0, called_off: 0, no_show_seats: 1 },
    sandbox_excluded: { deposits: 0, tickets: 0 },
  };

  it('reads every figure as a number, a string number included, and a missing one as null', () => {
    const d = readDayCloseOnline(payload)!;
    expect(d.business_date).toBe('2026-09-28');
    expect(d.tickets_chain.sold_iqd).toBe(80000);
    expect(readDayCloseOnline({ deposits: {} })!.deposits.received_iqd).toBeNull();
    expect(readDayCloseOnline(null)).toBeNull();
    expect(readDayCloseOnline([])).toBeNull();
  });

  it('keeps the groups that have something, in the order of the card, and leaves test payments out when none were', () => {
    const groups = onlineMoneyOf(readDayCloseOnline(payload)!);
    expect(groups.map((g) => g.id)).toEqual(['deposits', 'ticketsHere', 'ticketsChain', 'matches']);
    expect(groups[0]!.rows.map((r) => [r.id, r.count, r.amount])).toEqual([
      ['received', 3, 45000],
      ['refunded', 1, 15000],
      ['forfeited', 0, 0],
      ['waiting', 0, 0],
    ]);
    const matches = groups.find((g) => g.id === 'matches')!;
    expect(matches.rows.map((r) => [r.id, r.shows])).toEqual([
      ['bookings', 'count'],
      ['price', 'amount'],
      ['deskPaid', 'amount'],
      ['writtenOff', 'amount'],
      ['owed', 'amount'],
      ['calledOff', 'count'],
      ['noShowSeats', 'count'],
    ]);
  });

  it('shows test payments only when some were left out', () => {
    const groups = onlineMoneyOf(readDayCloseOnline({ ...payload, sandbox_excluded: { deposits: 2, tickets: 0 } })!);
    expect(groups.at(-1)).toEqual({
      id: 'sandbox',
      rows: [
        { id: 'deposits', count: 2, amount: null, shows: 'count' },
        { id: 'tickets', count: 0, amount: null, shows: 'count' },
      ],
    });
  });

  it('is empty when every figure is zero or missing', () => {
    expect(onlineIsEmpty(readDayCloseOnline({ deposits: { received_iqd: 0 }, matches: {} }))).toBe(true);
    expect(onlineIsEmpty(null)).toBe(true);
    expect(onlineIsEmpty(readDayCloseOnline(payload))).toBe(false);
  });
});

// Coaching (coaching operator.md §5.18.1, X27, C-31, R27): the lessons group and the cross-day sentence.
describe('day_close_online: the lessons group', () => {
  const lessons = (over: Record<string, number> = {}) => ({
    desk_paid_iqd: 0,
    desk_paid_count: 0,
    desk_refunded_iqd: 0,
    online_received_iqd: 0,
    online_received_count: 0,
    online_refunded_iqd: 0,
    online_refunded_count: 0,
    online_refunds_waiting_iqd: 0,
    online_refunds_waiting_count: 0,
    refunds_due_desk_iqd: 0,
    refunds_due_desk_count: 0,
    kept_iqd: 0,
    kept_count: 0,
    lessons: 0,
    owed_iqd: 0,
    owed_count: 0,
    owed_to_coaches_iqd: 0,
    ...over,
  });

  it("reads exactly COACHING_SHAPES.day_close_online's lessons keys", () => {
    expect([...LESSON_DAY_KEYS]).toEqual([...COACHING_SHAPES.day_close_online.nested!.lessons!]);
  });

  it('reads the block by its keys, a string number included; no block is null, not zeros', () => {
    const d = readDayCloseOnline({ lessons: lessons({ desk_paid_iqd: 30000, desk_paid_count: 1, kept_iqd: '15000' as unknown as number }) })!;
    expect(d.lessons?.desk_paid_iqd).toBe(30000);
    expect(d.lessons?.kept_iqd).toBe(15000);
    expect(readDayCloseOnline({ deposits: {} })!.lessons).toBeNull();
    expect(readDayCloseOnline({ lessons: {} })!.lessons?.owed_iqd).toBeNull();
  });

  it('adds the group after matches and before the test payments, in the order of §5.18.1', () => {
    const d = readDayCloseOnline({
      matches: { bookings: 1 },
      lessons: lessons({ online_received_iqd: 40000, online_received_count: 2, lessons: 3, owed_to_coaches_iqd: 54000 }),
      sandbox_excluded: { deposits: 1, tickets: 0 },
    })!;
    const groups = onlineMoneyOf(d);
    expect(groups.map((g) => g.id)).toEqual(['matches', 'lessons', 'sandbox']);
    const rows = groups.find((g) => g.id === 'lessons')!.rows;
    expect(rows.map((r) => [r.id, r.shows])).toEqual([
      ['onlineReceived', 'both'],
      ['onlineRefunded', 'both'],
      ['onlineWaiting', 'both'],
      ['kept', 'both'],
      ['deskPaid', 'both'],
      ['deskRefunded', 'amount'],
      ['owed', 'both'],
      ['refundsDueDesk', 'both'],
      ['owedToCoaches', 'both'],
    ]);
    expect(rows.at(-1)).toEqual({ id: 'owedToCoaches', count: 3, amount: 54000, shows: 'both' });
  });

  it('is hidden when every lesson figure is zero, and the card with it', () => {
    const d = readDayCloseOnline({ lessons: lessons() })!;
    expect(onlineMoneyOf(d).some((g) => g.id === 'lessons')).toBe(false);
    expect(onlineIsEmpty(d)).toBe(true);
  });

  it('R27 (operator half): a refund on day 2 of a day-1 payment shows on day 2, as desk_refunded_iqd', () => {
    // Day 1: the lesson was paid at the desk.
    const day1 = onlineMoneyOf(readDayCloseOnline({ business_date: '2026-10-01', lessons: lessons({ desk_paid_iqd: 30000, desk_paid_count: 1 }), refunds_dated_by_shift: true })!);
    const day1Rows = day1.find((g) => g.id === 'lessons')!.rows;
    expect(day1Rows.find((r) => r.id === 'deskPaid')).toMatchObject({ count: 1, amount: 30000 });
    expect(day1Rows.find((r) => r.id === 'deskRefunded')).toMatchObject({ amount: 0 });
    // Day 2: refunded at the desk; the day it was paid does not matter (C-31).
    const day2 = readDayCloseOnline({ business_date: '2026-10-02', lessons: lessons({ desk_refunded_iqd: 30000 }), refunds_dated_by_shift: true })!;
    const day2Rows = onlineMoneyOf(day2).find((g) => g.id === 'lessons')!.rows;
    expect(day2Rows.find((r) => r.id === 'deskRefunded')).toEqual({ id: 'deskRefunded', count: null, amount: 30000, shows: 'amount' });
    expect(day2Rows.find((r) => r.id === 'deskPaid')).toMatchObject({ amount: 0 });
    expect(day2.refunds_dated_by_shift).toBe(true);
  });

  it('words the lessons group from the coaching catalog and the others from open matches', () => {
    expect(onlineGroupTitleKey('lessons')).toBe('ws.coaching.dayClose.title');
    expect(onlineGroupTitleKey('deposits')).toBe('ws.matches.dayClose.deposits.title');
    expect(onlineLabelKey('lessons', { id: 'deskRefunded' })).toBe('ws.coaching.dayClose.rows.deskRefunded');
    expect(onlineLabelKey('matches', { id: 'owed' })).toBe('ws.matches.dayClose.matches.owed');
  });

  it('the cross-day sentence counts refunds in only on a day dated by its till shifts (C-31, R71)', () => {
    expect(readDayCloseOnline({ refunds_dated_by_shift: true })!.refunds_dated_by_shift).toBe(true);
    expect(readDayCloseOnline({ refunds_dated_by_shift: false })!.refunds_dated_by_shift).toBe(false);
    expect(readDayCloseOnline({})!.refunds_dated_by_shift).toBeNull();
    expect(crossDayKey(true)).toBe('ws.tillShift.dayClose.crossDayCounted');
    expect(crossDayKey(false)).toBe('ws.tillShift.dayClose.crossDay');
    expect(crossDayKey(null)).toBe('ws.tillShift.dayClose.crossDay');
  });
});

describe('played, not paid: open-match rows', () => {
  const row = {
    reservation_id: 'r1',
    guest_name: 'Open match',
    status: 'completed',
    start_at: '2026-09-28T17:00:00Z',
    end_at: '2026-09-28T18:30:00Z',
    court_name_en: 'Court 1',
    court_name_ar: 'ملعب 1',
    price_iqd: 40000,
    remaining_iqd: 20000,
    live_tab_id: null,
    match_id: 'm1',
    owed_by_seats_iqd: 20000,
    delta_owed_iqd: 0,
    seats_owing: [
      { seat_no: 4, label: 'Omar Khalid', owed_iqd: 10000 },
      { seat_no: 2, label: 'Ali Hasan', owed_iqd: 10000 },
    ],
  };

  it('tells a match booking from an ordinary one', () => {
    expect(isMatchUnpaid(row)).toBe(true);
    expect(isMatchUnpaid({ match_id: null })).toBe(false);
    expect(isMatchUnpaid({})).toBe(false);
    // An older server's rows parse as before.
    expect(unpaidPlayedRows([{ ...row, match_id: undefined }])).toHaveLength(1);
  });

  it("names the match from its desk state's label, never from the booking's literal name", () => {
    expect(unpaidMatchLabel({ label: 'Sara Karim' })).toBe('Sara Karim');
    expect(unpaidMatchLabel({ label: '  ' })).toBeNull();
    expect(unpaidMatchLabel({ label: null })).toBeNull();
    expect(unpaidMatchLabel(undefined)).toBeNull();
  });

  it('lists the owing seats in seat order and drops a malformed one', () => {
    expect(unpaidSeats(row).map((x) => x.seat_no)).toEqual([2, 4]);
    expect(unpaidSeats({ seats_owing: [{ seat_no: 1, label: null, owed_iqd: Number.NaN }] })).toEqual([]);
    expect(unpaidSeats({})).toEqual([]);
  });
});
