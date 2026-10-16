import { describe, it, expect } from 'vitest';
import {
  dayBoxesKey,
  defaultHandIn,
  handInBlock,
  handInPayload,
  handInRows,
  handInTotal,
  handInView,
  hasPendingHandIn,
  keptBoxes,
  newHandInKey,
  readDayBoxes,
  type DayBox,
} from './handInLogic';

const box = (b: Partial<DayBox> & Pick<DayBox, 'box'>): DayBox => ({
  cash_in_iqd: 0,
  cash_out_iqd: 0,
  net_iqd: 0,
  handed_in_iqd: null,
  ...b,
});

const day = (boxes: DayBox[], status = 'closed') => ({ boxes, status });

describe('readDayBoxes', () => {
  it('reads the payload and drops unknown boxes', () => {
    const d = readDayBoxes({
      day_session_id: 'ds1',
      business_date: '2026-10-15',
      status: 'closed',
      opening_float_iqd: 50000,
      boxes: [
        { box: 'cafe', cash_in_iqd: 1250000, cash_out_iqd: 20000, net_iqd: 1230000, handed_in_iqd: null },
        { box: 'garage', cash_in_iqd: 1 },
        { box: 'desk', cash_in_iqd: 90000, cash_out_iqd: 0, net_iqd: 90000, handed_in_iqd: 90000 },
      ],
    });
    expect(d?.boxes.map((b) => b.box)).toEqual(['cafe', 'desk']);
    expect(d?.boxes[0]?.handed_in_iqd).toBeNull();
    expect(d?.boxes[1]?.handed_in_iqd).toBe(90000);
  });

  it('is null for something that is not the payload', () => {
    expect(readDayBoxes(null)).toBeNull();
    expect(readDayBoxes({ boxes: [] })).toBeNull();
  });
});

describe('handInRows', () => {
  it('prefills each open box with its net cash, never below 0', () => {
    expect(defaultHandIn({ net_iqd: 1230000 })).toBe(1230000);
    expect(defaultHandIn({ net_iqd: -5000 })).toBe(0);
    const rows = handInRows(
      day([
        box({ box: 'cafe', cash_in_iqd: 1250000, cash_out_iqd: 20000, net_iqd: 1230000 }),
        box({ box: 'desk', cash_in_iqd: 90000, net_iqd: 90000 }),
      ]),
      {},
    );
    expect(rows.map((r) => [r.box, r.state, r.amount])).toEqual([
      ['cafe', 'open', 1230000],
      ['desk', 'open', 90000],
    ]);
    expect(handInTotal(rows)).toBe(1320000);
    expect(handInPayload(rows)).toEqual([
      { box: 'cafe', amount_iqd: 1230000 },
      { box: 'desk', amount_iqd: 90000 },
    ]);
    expect(handInBlock(rows)).toBeNull();
  });

  it('takes the typed amount over the default, and flags one above the net', () => {
    const rows = handInRows(day([box({ box: 'cafe', cash_in_iqd: 100000, net_iqd: 100000 })]), { cafe: 150000 });
    expect(rows[0]?.amount).toBe(150000);
    expect(rows[0]?.overNet).toBe(true);
    const cleared = handInRows(day([box({ box: 'cafe', cash_in_iqd: 100000, net_iqd: 100000 })]), { cafe: null });
    expect(cleared[0]?.amount).toBe(0);
    expect(handInBlock(cleared)).toBe('zero');
    expect(handInPayload(cleared)).toEqual([]);
    expect(keptBoxes(cleared)).toEqual(['cafe']);
  });

  it('shows a handed-in box as done, an untouched box as idle, and a skipped one as kept', () => {
    const rows = handInRows(
      day([
        box({ box: 'cafe', cash_in_iqd: 50000, net_iqd: 50000, handed_in_iqd: 50000 }),
        box({ box: 'desk' }),
        box({ box: 'shop', cash_in_iqd: 7000, net_iqd: 7000 }),
      ]),
      {},
      { handed: {}, kept: ['shop'] },
    );
    expect(rows.map((r) => r.state)).toEqual(['done', 'idle', 'kept']);
    expect(rows[0]?.handedIn).toBe(50000);
    expect(handInTotal(rows)).toBe(0);
    expect(handInView(rows)).toBe('done');
  });

  it('lays what this panel just handed in over the server rows', () => {
    const rows = handInRows(day([box({ box: 'cafe', cash_in_iqd: 50000, net_iqd: 50000 })]), {}, { handed: { cafe: 40000 }, kept: [] });
    expect(rows[0]?.state).toBe('done');
    expect(rows[0]?.handedIn).toBe(40000);
  });
});

describe('handInView', () => {
  it('is empty when no box took cash and none was handed in', () => {
    expect(handInView(handInRows(day([box({ box: 'cafe' }), box({ box: 'desk' })]), {}))).toBe('empty');
    // Refunds alone leave nothing to hand in.
    expect(handInView(handInRows(day([box({ box: 'cafe', cash_out_iqd: 5000, net_iqd: -5000 })]), {}))).toBe('empty');
  });

  it('is the form while a box waits for an amount', () => {
    expect(handInView(handInRows(day([box({ box: 'cafe', cash_in_iqd: 1, net_iqd: 1 }), box({ box: 'desk' })]), {}))).toBe('form');
  });
});

describe('hasPendingHandIn', () => {
  it('is true only for a closed day with a box that took cash and has no hand-in', () => {
    expect(hasPendingHandIn(day([box({ box: 'cafe', cash_in_iqd: 10, net_iqd: 10 })]))).toBe(true);
    expect(hasPendingHandIn(day([box({ box: 'cafe', cash_in_iqd: 10, net_iqd: 10, handed_in_iqd: 10 })]))).toBe(false);
    expect(hasPendingHandIn(day([box({ box: 'cafe', cash_out_iqd: 10, net_iqd: -10 })]))).toBe(false);
    expect(hasPendingHandIn(day([box({ box: 'cafe', cash_in_iqd: 10, net_iqd: 10 })], 'open'))).toBe(false);
    expect(hasPendingHandIn(null)).toBe(false);
  });
});

describe('keys', () => {
  it('files the boxes under main-cash and makes a fresh idempotency key each time', () => {
    expect(dayBoxesKey('ds1')).toEqual(['main-cash', 'day-boxes', 'ds1']);
    const a = newHandInKey();
    expect(a).toMatch(/^safe\.handin:[0-9a-f-]{36}$/);
    expect(newHandInKey()).not.toBe(a);
  });
});
