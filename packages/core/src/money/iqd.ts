/**
 * Branded integer IQD money type.
 *
 * IQD is a zero-decimal currency: every amount that reaches a bill, a report line, or the
 * day close is a whole number of dinars. In SQL this is the `iqd` bigint domain; in TS it is
 * a number branded as `IQD` and asserted to be a non-negative safe integer at every boundary.
 * NO floats ever represent money — fractional internal figures (per-gram unit costs) must be
 * rounded through `toIqdHalfUp` (see ./tax.ts) at computation time, in this package only.
 */
declare const IqdBrand: unique symbol;
export type IQD = number & { readonly [IqdBrand]: 'IQD' };

export type MoneyErrorCode =
  | 'NOT_AN_INTEGER'
  | 'NEGATIVE_AMOUNT'
  | 'UNSAFE_AMOUNT'
  | 'INVALID_ARGUMENT'
  | 'SPLIT_MISMATCH';

export class MoneyError extends Error {
  readonly code: MoneyErrorCode;

  constructor(code: MoneyErrorCode, message: string) {
    super(message);
    this.name = 'MoneyError';
    this.code = code;
  }
}

/** Type guard: non-negative safe integer. */
export function isIqd(value: unknown): value is IQD {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** Assert `value` is a valid IQD amount (non-negative safe integer) and brand it. */
export function iqd(value: number): IQD {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new MoneyError('INVALID_ARGUMENT', `money must be a finite number, got ${String(value)}`);
  }
  if (!Number.isInteger(value)) {
    throw new MoneyError('NOT_AN_INTEGER', `money must be integer IQD, got ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new MoneyError('UNSAFE_AMOUNT', `money exceeds Number.MAX_SAFE_INTEGER: ${value}`);
  }
  if (value < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `money must be >= 0, got ${value}`);
  }
  return value as IQD;
}

export const ZERO_IQD: IQD = 0 as IQD;

/** Add amounts; every operand and the result are re-asserted (overflow guard). */
export function addIqd(...amounts: readonly number[]): IQD {
  let total = 0;
  for (const a of amounts) total += iqd(a);
  return iqd(total);
}

/** Sum a list of amounts. */
export function sumIqd(amounts: readonly number[]): IQD {
  return addIqd(...amounts);
}

/** Subtract b from a; a negative result is an error (money is unsigned). */
export function subIqd(a: number, b: number): IQD {
  const result = iqd(a) - iqd(b);
  if (result < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `subtraction went negative: ${a} - ${b}`);
  }
  return iqd(result);
}

/** Multiply an amount by an integer quantity (line totals). Non-integer qty is rejected. */
export function mulIqd(amount: number, qty: number): IQD {
  const a = iqd(amount);
  if (typeof qty !== 'number' || !Number.isInteger(qty)) {
    throw new MoneyError('NOT_AN_INTEGER', `quantity must be an integer, got ${String(qty)}`);
  }
  if (qty < 0) {
    throw new MoneyError('NEGATIVE_AMOUNT', `quantity must be >= 0, got ${qty}`);
  }
  return iqd(a * qty);
}
