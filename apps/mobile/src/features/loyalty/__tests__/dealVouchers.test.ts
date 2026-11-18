import { describe, expect, it } from 'vitest';
import {
  NO_DEAL_VOUCHERS,
  liveDealVoucher,
  parseDealVoucher,
  parseMyDealVouchers,
  parseRedeemDeal,
} from '../dealVouchers';

/**
 * A deal's own QR on the phone (0445, `app.my_deal_vouchers`, `app.redeem_deal`): the rows parsed,
 * anything malformed dropped rather than drawn, and the deal's live code picked out.
 */

const NOW = '2026-11-15T12:00:00.000Z';
const row = (over: Record<string, unknown> = {}) => ({
  id: 'dv-1',
  code: 'TPD-8F3K2QXM9ABC',
  promotion_id: 'd-open',
  name_en: 'Happy hour',
  name_ar: 'ساعة السعادة',
  type: 'percent',
  value: 20,
  status: 'active',
  created_at: '2026-11-15T11:55:00.000Z',
  expires_at: '2026-11-15T12:10:00.000Z',
  ended_at: null,
  ...over,
});

describe('parseDealVoucher', () => {
  it('reads a well-formed row as it came', () => {
    expect(parseDealVoucher(row())).toEqual(row());
  });

  it('reads a numeric string value and defaults missing names to empty', () => {
    const v = parseDealVoucher(row({ value: '5000', type: 'amount', name_en: undefined, name_ar: 7 }));
    expect(v?.value).toBe(5000);
    expect(v?.type).toBe('amount');
    expect(v?.name_en).toBe('');
    expect(v?.name_ar).toBe('');
  });

  it('a value that is not a number reads as 0, never NaN', () => {
    expect(parseDealVoucher(row({ value: 'lots' }))?.value).toBe(0);
  });

  it('keeps ended_at only when it is a time', () => {
    expect(parseDealVoucher(row({ status: 'used', ended_at: NOW }))?.ended_at).toBe(NOW);
    expect(parseDealVoucher(row({ ended_at: '' }))?.ended_at).toBeNull();
  });

  it.each([
    ['not an object', null],
    ['a string', 'TPD-8F3K2QXM9ABC'],
    ['no id', row({ id: undefined })],
    ['no promotion', row({ promotion_id: '' })],
    ['a reward code', row({ code: 'TPV-8F3K2QXM9ABC' })],
    ['a code in groups', row({ code: 'TPD-8F3K-2QXM-9ABC' })],
    ['a lowercase code', row({ code: 'tpd-8f3k2qxm9abc' })],
    ['an unknown status', row({ status: 'pending' })],
    ['an unknown type', row({ type: 'points' })],
    ['no created_at', row({ created_at: null })],
    ['an expiry that is not a time', row({ expires_at: 'soon' })],
  ])('drops a row with %s', (_label, raw) => {
    expect(parseDealVoucher(raw)).toBeNull();
  });
});

describe('parseMyDealVouchers', () => {
  it('keeps the server clock and the good rows, dropping the malformed ones', () => {
    const got = parseMyDealVouchers({
      now: NOW,
      vouchers: [row(), row({ id: 'dv-bad', code: 'nope' }), 'junk', row({ id: 'dv-2', status: 'expired' })],
    });
    expect(got.now).toBe(NOW);
    expect(got.vouchers.map((v) => v.id)).toEqual(['dv-1', 'dv-2']);
  });

  it('anything unreadable is no codes', () => {
    expect(parseMyDealVouchers(null)).toBe(NO_DEAL_VOUCHERS);
    expect(parseMyDealVouchers('x')).toBe(NO_DEAL_VOUCHERS);
    expect(parseMyDealVouchers({ now: NOW, vouchers: 'x' }).vouchers).toEqual([]);
  });

  it('a missing clock falls back to a real time', () => {
    expect(Number.isFinite(Date.parse(parseMyDealVouchers({ vouchers: [] }).now))).toBe(true);
  });
});

describe('parseRedeemDeal', () => {
  it('reads the new code and the server clock', () => {
    expect(parseRedeemDeal({ now: NOW, voucher: row() })).toEqual({ now: NOW, voucher: row() });
  });

  it('a code that does not parse is a server fault', () => {
    expect(() => parseRedeemDeal({ now: NOW, voucher: row({ code: 'bad' }) })).toThrow('VOUCHER_MALFORMED');
    expect(() => parseRedeemDeal(null)).toThrow('VOUCHER_MALFORMED');
  });
});

describe('liveDealVoucher', () => {
  const codes = parseMyDealVouchers({
    now: NOW,
    vouchers: [
      row({ id: 'dv-old', status: 'cancelled', ended_at: NOW }),
      row({ id: 'dv-live' }),
      row({ id: 'dv-other', promotion_id: 'd-other', code: 'TPD-0000000000AB' }),
    ],
  });

  it('finds the deal’s active code, not its ended ones', () => {
    expect(liveDealVoucher(codes, 'd-open')?.id).toBe('dv-live');
  });

  it('is null for a deal with no active code, and for no list', () => {
    const ended = parseMyDealVouchers({ now: NOW, vouchers: [row({ status: 'used', ended_at: NOW })] });
    expect(liveDealVoucher(ended, 'd-open')).toBeNull();
    expect(liveDealVoucher(codes, 'd-none')).toBeNull();
    expect(liveDealVoucher(null, 'd-open')).toBeNull();
    expect(liveDealVoucher(undefined, 'd-open')).toBeNull();
  });
});
