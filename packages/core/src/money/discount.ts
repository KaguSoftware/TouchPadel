import { iqd, MoneyError, type IQD } from './iqd';

/**
 * Percent discount on a list price, integer half-up — the TS twin of the SQL helper
 * `app.apply_pct_discount(p_list bigint, p_pct int)` (migration 0030):
 *
 *   unit = (list * (100 - pct) + 50) / 100      (integer division)
 *
 * The server snapshot written by `app.add_order_items` is the pricing authority for every
 * order source; this helper only lets basket previews (web / till) show the same figure the
 * server will stamp. The two implementations MUST agree bit-for-bit.
 *
 * `pct` is a whole number in [0, 99] (a RangeError otherwise — same contract as the SQL
 * `INVALID_PCT`); `list` must already be valid integer IQD (MoneyError otherwise).
 */
export function applyPctDiscountIqd(list: number, pct: number): IQD {
  const l = iqd(list);
  if (typeof pct !== 'number' || !Number.isInteger(pct) || pct < 0 || pct > 99) {
    throw new RangeError(`pct must be an integer in [0, 99], got ${String(pct)}`);
  }
  const scaled = l * (100 - pct);
  if (!Number.isSafeInteger(scaled)) {
    throw new MoneyError('UNSAFE_AMOUNT', `discount computation overflowed: ${l} * ${100 - pct}`);
  }
  return iqd(Math.floor((scaled + 50) / 100));
}
