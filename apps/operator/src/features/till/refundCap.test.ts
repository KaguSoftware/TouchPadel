import { describe, expect, it, vi } from 'vitest';

// The cap a refund of desk lesson money carries (coaching R36, operator.md
// §5.10.10): what is left on the payment, and no more than is due back unless
// the manager marks it goodwill. ManagerActions imports the shell bridge and
// the client, which a node test does not need.
vi.mock('../../lib/supabase', () => ({ supabase: {}, supabaseUrl: '', supabaseAnonKey: '' }));
vi.mock('../../ipc/bridge', () => ({ touch: { pinObserved: () => {} } }));

const { refundCap, refundableIqd } = await import('./ManagerActions');

describe('refundCap (R36)', () => {
  const paid = { amount_iqd: 30000, refunds: [{ amount_iqd: 5000 }] };

  it('a till refund (no due): what is left on the payment', () => {
    expect(refundableIqd(paid)).toBe(25000);
    expect(refundCap(paid)).toBe(25000);
    expect(refundCap(paid, undefined, true)).toBe(25000);
  });

  it('desk lesson money: capped at the due', () => {
    expect(refundCap(paid, 15000)).toBe(15000);
    expect(refundCap(paid, 15000, false)).toBe(15000);
  });

  it('the due above what is left: capped at what is left', () => {
    expect(refundCap(paid, 40000)).toBe(25000);
  });

  it('goodwill lifts the cap to what is left on the payment', () => {
    expect(refundCap(paid, 15000, true)).toBe(25000);
  });

  it('nothing due: nothing to refund unless goodwill; never below zero', () => {
    expect(refundCap(paid, 0)).toBe(0);
    expect(refundCap(paid, -100)).toBe(0);
    expect(refundCap(paid, 0, true)).toBe(25000);
    expect(refundCap({ amount_iqd: 10000, refunds: [{ amount_iqd: 10000 }] }, 5000)).toBe(0);
  });
});
