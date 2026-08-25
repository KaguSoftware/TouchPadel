import { describe, expect, it } from 'vitest';
import {
  mergeStatus,
  ordersPartition,
  orderStepIndex,
  orderTotal,
  SERVED_GRACE_MS,
  type GuestOrder,
} from './orders';

const NOW = Date.parse('2026-08-25T12:00:00.000Z');
const ago = (ms: number) => new Date(NOW - ms).toISOString();

const order = (over: Partial<GuestOrder> & { id: string }): GuestOrder => ({
  status: 'sent',
  placed_at: ago(60_000),
  served_at: null,
  items: [],
  ...over,
});

describe('ordersPartition', () => {
  it('keeps sent/preparing/ready live', () => {
    const { live, earlier } = ordersPartition(
      [
        order({ id: 'a', status: 'sent' }),
        order({ id: 'b', status: 'preparing' }),
        order({ id: 'c', status: 'ready' }),
      ],
      NOW,
    );
    expect(live.map((o) => o.id).sort()).toEqual(['a', 'b', 'c']);
    expect(earlier).toEqual([]);
  });

  it('keeps a just-served order live, drops it after 10 minutes', () => {
    const fresh = order({ id: 'fresh', status: 'served', served_at: ago(SERVED_GRACE_MS - 1_000) });
    const stale = order({ id: 'stale', status: 'served', served_at: ago(SERVED_GRACE_MS + 1_000) });
    const { live, earlier } = ordersPartition([fresh, stale], NOW);
    expect(live.map((o) => o.id)).toEqual(['fresh']);
    expect(earlier.map((o) => o.id)).toEqual(['stale']);
  });

  it('falls back to placed_at when served_at was never recorded', () => {
    const old = order({ id: 'old', status: 'served', placed_at: ago(SERVED_GRACE_MS + 5_000) });
    expect(ordersPartition([old], NOW).earlier.map((o) => o.id)).toEqual(['old']);
  });

  it('always files voided orders under Earlier', () => {
    const voided = order({ id: 'v', status: 'voided', placed_at: ago(1_000) });
    const { live, earlier } = ordersPartition([voided], NOW);
    expect(live).toEqual([]);
    expect(earlier.map((o) => o.id)).toEqual(['v']);
  });

  it('sorts both lists newest first', () => {
    const { live, earlier } = ordersPartition(
      [
        order({ id: 'oldLive', placed_at: ago(300_000) }),
        order({ id: 'newLive', placed_at: ago(10_000) }),
        order({ id: 'oldGone', status: 'voided', placed_at: ago(900_000) }),
        order({ id: 'newGone', status: 'voided', placed_at: ago(600_000) }),
      ],
      NOW,
    );
    expect(live.map((o) => o.id)).toEqual(['newLive', 'oldLive']);
    expect(earlier.map((o) => o.id)).toEqual(['newGone', 'oldGone']);
  });

  it('survives an unparseable timestamp', () => {
    const broken = order({ id: 'x', status: 'served', placed_at: 'not-a-date' });
    expect(ordersPartition([broken], NOW).earlier.map((o) => o.id)).toEqual(['x']);
  });
});

describe('orderStepIndex', () => {
  it('fills 1→3 segments and completes on served', () => {
    expect(orderStepIndex('sent')).toBe(1);
    expect(orderStepIndex('preparing')).toBe(2);
    expect(orderStepIndex('ready')).toBe(3);
    expect(orderStepIndex('served')).toBe(3);
    expect(orderStepIndex('voided')).toBe(0);
  });
});

describe('orderTotal', () => {
  it('excludes voided lines', () => {
    const o = order({
      id: 'o',
      items: [
        { id: '1', qty: 1, line_total_iqd: 1_000, voided: false, name_en: '', name_ar: '', variant_en: '', variant_ar: '' },
        { id: '2', qty: 2, line_total_iqd: 4_000, voided: true, name_en: '', name_ar: '', variant_en: '', variant_ar: '' },
      ],
    });
    expect(orderTotal(o)).toBe(1_000);
  });
});

describe('mergeStatus', () => {
  // Broadcasts are at-least-once and unordered, and a REST reload can carry a
  // snapshot older than a broadcast we already applied. Neither may walk the
  // guest's progress bar backwards.
  it('advances on a forward status', () => {
    expect(mergeStatus('sent', 'preparing')).toBe('preparing');
    expect(mergeStatus('preparing', 'ready')).toBe('ready');
    expect(mergeStatus('ready', 'served')).toBe('served');
  });

  it('ignores a re-delivered earlier status', () => {
    expect(mergeStatus('ready', 'preparing')).toBe('ready');
    expect(mergeStatus('served', 'sent')).toBe('served');
    expect(mergeStatus('preparing', 'sent')).toBe('preparing');
  });

  it('is idempotent', () => {
    for (const s of ['sent', 'preparing', 'ready', 'served', 'voided'] as const) {
      expect(mergeStatus(s, s)).toBe(s);
    }
  });

  it('lets voided win from anywhere, and never un-voids', () => {
    for (const s of ['sent', 'preparing', 'ready', 'served'] as const) {
      expect(mergeStatus(s, 'voided')).toBe('voided');
      expect(mergeStatus('voided', s)).toBe('voided');
    }
  });
});
