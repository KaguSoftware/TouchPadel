import { describe, expect, it } from 'vitest';
import {
  activeVouchers,
  formatCountdown,
  parseMyRewardVouchers,
  parseRedeemResult,
  parseRewardVoucher,
  voucherFraction,
  voucherPhase,
} from '../vouchers';

const row = (over: Record<string, unknown> = {}) => ({
  id: 'v-1',
  code: 'TPV-8F3K2QXM9ABC',
  reward_id: 'r-1',
  name_en: 'Americano',
  name_ar: 'أمريكانو',
  kind: 'item',
  points: 60,
  status: 'active',
  created_at: '2026-11-13T12:00:00Z',
  expires_at: '2026-11-13T12:15:00Z',
  ended_at: null,
  ...over,
});

describe('reward vouchers (0415)', () => {
  it('parses a row and drops a malformed one', () => {
    expect(parseRewardVoucher(row())).toMatchObject({ id: 'v-1', points: 60, status: 'active' });
    expect(parseRewardVoucher(row({ code: 'TP-1234' }))).toBeNull();
    expect(parseRewardVoucher(row({ status: 'lost' }))).toBeNull();
    expect(parseRewardVoucher(null)).toBeNull();
    const all = parseMyRewardVouchers({ now: '2026-11-13T12:01:00Z', vouchers: [row(), row({ id: '' })] });
    expect(all.vouchers).toHaveLength(1);
    expect(parseMyRewardVouchers('nope').vouchers).toEqual([]);
  });

  it('reads a redeem answer, and refuses one with no voucher', () => {
    expect(parseRedeemResult({ ...row(), balance: 40, now: '2026-11-13T12:00:00Z' })).toMatchObject({
      balance: 40,
      code: 'TPV-8F3K2QXM9ABC',
    });
    expect(() => parseRedeemResult({ balance: 40 })).toThrow('VOUCHER_MALFORMED');
  });

  it('turns status and time into what the screen shows', () => {
    expect(voucherPhase('active', 10 * 60_000)).toBe('active');
    expect(voucherPhase('active', 2 * 60_000)).toBe('urgent');
    expect(voucherPhase('active', 0)).toBe('expired');
    expect(voucherPhase('used', 0)).toBe('collected');
    expect(voucherPhase('cancelled', 5_000)).toBe('cancelled');
    expect(voucherPhase('expired', 5_000)).toBe('expired');
  });

  it('counts down in minutes and seconds, rounded up', () => {
    expect(formatCountdown(15 * 60_000)).toBe('15:00');
    expect(formatCountdown(14 * 60_000 + 31_200)).toBe('14:32');
    expect(formatCountdown(400)).toBe('0:01');
    expect(formatCountdown(-5)).toBe('0:00');
    expect(voucherFraction(7.5 * 60_000, 15 * 60_000)).toBe(0.5);
    expect(voucherFraction(-1, 15 * 60_000)).toBe(0);
  });

  it('lists the vouchers still to collect, soonest first, on the server clock', () => {
    const data = parseMyRewardVouchers({
      now: '2026-11-13T12:10:00Z',
      vouchers: [
        row({ id: 'late', expires_at: '2026-11-13T12:20:00Z' }),
        row({ id: 'soon', expires_at: '2026-11-13T12:12:00Z' }),
        row({ id: 'gone', expires_at: '2026-11-13T12:05:00Z' }),
        row({ id: 'used', status: 'used' }),
      ],
    });
    // the phone's clock is an hour behind; it does not matter
    const readAt = Date.parse('2026-11-13T11:10:00Z');
    const list = activeVouchers(data, readAt, readAt + 60_000);
    expect(list.map((v) => v.id)).toEqual(['soon', 'late']);
    expect(list[0]!.msLeft).toBe(60_000);
  });
});
