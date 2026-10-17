import { describe, expect, it } from 'vitest';
import {
  EMPTY_MOVE,
  EMPTY_PAY,
  barShare,
  canStepForward,
  canVoid,
  entryTone,
  filterEntries,
  moveArgs,
  moveBlock,
  moveKind,
  partiesFor,
  payArgs,
  payBlock,
  payeesFor,
  readOverview,
  shiftMonth,
  takesSafeBelowZero,
  type SafeEntry,
} from './safeLogic';

const entry = (over: Partial<SafeEntry>): SafeEntry => ({
  id: 'e',
  kind: 'payment',
  amountIqd: 1000,
  deltaIqd: -1000,
  paidFrom: 'safe',
  category: 'shopping',
  payee: null,
  payeeHidden: false,
  note: null,
  box: null,
  source: 'manual',
  occurredOn: '2026-10-16',
  loggedAt: '2026-10-16T10:00:00Z',
  loggedByName: 'Ali',
  voidedAt: null,
  voidedByName: null,
  voidReason: null,
  balanceAfterIqd: 0,
  ...over,
});

describe('readOverview', () => {
  it('reads the server shape and keeps absent figures absent', () => {
    const ov = readOverview({
      month: '2026-10-01',
      current_month: '2026-10-01',
      balance_iqd: 1195000,
      today_figures: { in_iqd: 1300000, out_iqd: 100000 },
      last_count: { counted_iqd: 1145000, difference_iqd: -5000, at: '2026-10-16T09:00:00Z', by_name: 'Maha' },
      costs: [{ category: 'supplier', total_iqd: 200000, count: 1, from_bank_iqd: 200000 }],
      costs_total_iqd: 200000,
      entries: [{ id: 'a', kind: 'hand_in', amount_iqd: 300000, delta_iqd: 300000, box: 'desk', source: 'day_close', balance_after_iqd: 300000 }, { bad: true }],
      payees: [{ category: 'supplier', payee: 'Ice' }],
      boxes: ['cafe', 'desk', 'bar'],
      is_owner: true,
    });
    expect(ov.balanceIqd).toBe(1195000);
    expect(ov.lastCount).toEqual({ countedIqd: 1145000, differenceIqd: -5000, at: '2026-10-16T09:00:00Z', byName: 'Maha' });
    expect(ov.entries).toHaveLength(1);
    expect(ov.entries[0]).toMatchObject({ kind: 'hand_in', box: 'desk', source: 'day_close', balanceAfterIqd: 300000 });
    expect(ov.boxes).toEqual(['cafe', 'desk']);
    expect(ov.isOwner).toBe(true);
  });

  it('answers nothing as absent, with the café till as the one box', () => {
    const ov = readOverview(null);
    expect(ov.balanceIqd).toBeNull();
    expect(ov.lastCount).toBeNull();
    expect(ov.entries).toEqual([]);
    expect(ov.boxes).toEqual(['cafe']);
  });
});

describe('the pay form', () => {
  it('names the first thing missing', () => {
    expect(payBlock(EMPTY_PAY)).toBe('amount');
    expect(payBlock({ ...EMPTY_PAY, amount: 5000 })).toBe('category');
    expect(payBlock({ ...EMPTY_PAY, amount: 5000, category: 'rent' })).toBeNull();
    expect(payBlock({ ...EMPTY_PAY, amount: 5000, category: 'rent', payee: 'x'.repeat(81) })).toBe('payeeLong');
  });

  it('sends trimmed text, null for nothing typed', () => {
    expect(payArgs({ amount: 5000, category: 'bills', payee: '  Power  ', paidFrom: 'bank', note: ' ' }, 'k')).toEqual({
      p_amount_iqd: 5000,
      p_category: 'bills',
      p_payee: 'Power',
      p_paid_from: 'bank',
      p_note: null,
      p_idempotency_key: 'k',
    });
  });

  it('warns only when the safe pays more than it shows', () => {
    expect(takesSafeBelowZero({ amount: 2000, paidFrom: 'safe' }, 1000)).toBe(true);
    expect(takesSafeBelowZero({ amount: 2000, paidFrom: 'bank' }, 1000)).toBe(false);
    expect(takesSafeBelowZero({ amount: 1000, paidFrom: 'safe' }, 1000)).toBe(false);
    expect(takesSafeBelowZero({ amount: 2000, paidFrom: 'safe' }, null)).toBe(false);
  });

  it('offers each name typed before once, for the chosen category', () => {
    const payees = [
      { category: 'supplier' as const, payee: 'Ice' },
      { category: 'bills' as const, payee: 'Power' },
      { category: 'supplier' as const, payee: 'Ice' },
      { category: 'supplier' as const, payee: 'Gas' },
    ];
    expect(payeesFor(payees, 'supplier')).toEqual(['Ice', 'Gas']);
    expect(payeesFor(payees, null)).toEqual(['Ice', 'Power', 'Gas']);
  });
});

describe('the move form', () => {
  it('maps a direction and a party to the server kind', () => {
    expect(moveKind('in', 'desk')).toBe('hand_in');
    expect(moveKind('out', 'cafe')).toBe('to_drawer');
    expect(moveKind('in', 'bank')).toBe('bank_in');
    expect(moveKind('out', 'owner')).toBe('owner_out');
  });

  it('sends a box only for a drawer', () => {
    expect(moveArgs({ direction: 'in', party: 'desk', amount: 300000, note: '' }, 'k')).toMatchObject({ p_kind: 'hand_in', p_box: 'desk' });
    expect(moveArgs({ direction: 'out', party: 'bank', amount: 300000, note: '' }, 'k')).toMatchObject({ p_kind: 'bank_out', p_box: null });
  });

  it('asks for the party first, then the amount', () => {
    expect(moveBlock(EMPTY_MOVE)).toBe('party');
    expect(moveBlock({ ...EMPTY_MOVE, party: 'owner' })).toBe('amount');
    expect(moveBlock({ ...EMPTY_MOVE, party: 'owner', amount: 1 })).toBeNull();
  });

  it('lists the branch boxes, then the bank and the owner', () => {
    expect(partiesFor(['cafe', 'desk'])).toEqual(['cafe', 'desk', 'bank', 'owner']);
  });
});

describe('the ledger', () => {
  it('takes back only its own live rows', () => {
    expect(canVoid(entry({}))).toBe(true);
    expect(canVoid(entry({ source: 'day_close', kind: 'hand_in' }))).toBe(true);
    expect(canVoid(entry({ source: 'wage' }))).toBe(false);
    expect(canVoid(entry({ voidedAt: '2026-10-16T11:00:00Z' }))).toBe(false);
  });

  it('reads which way the money went for the safe', () => {
    expect(entryTone(entry({ deltaIqd: -1000 }))).toBe('out');
    expect(entryTone(entry({ deltaIqd: 1000 }))).toBe('in');
    expect(entryTone(entry({ deltaIqd: 0, paidFrom: 'bank' }))).toBe('none');
    expect(entryTone(entry({ deltaIqd: -1000, voidedAt: 'x' }))).toBe('none');
  });

  it('filters payments from moves and counts', () => {
    const rows = [entry({ id: 'p' }), entry({ id: 'h', kind: 'hand_in' }), entry({ id: 'c', kind: 'count' })];
    expect(filterEntries(rows, 'payments').map((e) => e.id)).toEqual(['p']);
    expect(filterEntries(rows, 'moves').map((e) => e.id)).toEqual(['h', 'c']);
    expect(filterEntries(rows, 'all')).toHaveLength(3);
  });

  it('draws a visible bar for the smallest cost and none for nothing', () => {
    expect(barShare(100, 100)).toBe(1);
    expect(barShare(1, 10000)).toBe(0.02);
    expect(barShare(0, 100)).toBe(0);
  });
});

describe('the month stepper', () => {
  it('goes back freely and forward up to this month', () => {
    expect(shiftMonth('2026-01-01', -1)).toBe('2025-12-01');
    expect(shiftMonth('2026-12-01', 1)).toBe('2027-01-01');
    expect(canStepForward('2026-09-01', '2026-10-01')).toBe(true);
    expect(canStepForward('2026-10-01', '2026-10-01')).toBe(false);
  });
});
