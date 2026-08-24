import { iqd, MoneyError, type IQD } from './iqd';

/**
 * Tax in integer basis points (1000 bp = 10%), matching tax_groups.rate_bp.
 *
 * tax = round_half_up(subtotal * rate_bp / 10000) — computed ONCE at settle and stamped on the
 * tab (tabs.tax_iqd); never recomputed line-by-line afterwards. Implemented in pure integer
 * arithmetic so no float ever touches the figure.
 */
export function calcTaxIqd(subtotal: number, rateBp: number): IQD {
  const s = iqd(subtotal);
  if (typeof rateBp !== 'number' || !Number.isInteger(rateBp) || rateBp < 0 || rateBp > 10000) {
    throw new MoneyError(
      'INVALID_ARGUMENT',
      `rateBp must be an integer in [0, 10000], got ${String(rateBp)}`,
    );
  }
  const product = s * rateBp;
  if (!Number.isSafeInteger(product)) {
    throw new MoneyError('UNSAFE_AMOUNT', `tax computation overflowed: ${s} * ${rateBp}`);
  }
  // round half-up on a non-negative value: floor((x + 5000) / 10000)
  return iqd(Math.floor((product + 5000) / 10000));
}

/**
 * The ONE sanctioned float→IQD conversion, for internal fractional figures (e.g. per-gram unit
 * costs numeric(14,4)) that must land on a report line as whole dinars. Half-up, non-negative.
 * Never use this on values that were already money.
 */
export function toIqdHalfUp(value: number): IQD {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError('INVALID_ARGUMENT', `expected a finite number, got ${String(value)}`);
  }
  if (value < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `expected a non-negative value, got ${value}`);
  }
  return iqd(Math.round(value)); // Math.round is half-up for non-negative input
}
