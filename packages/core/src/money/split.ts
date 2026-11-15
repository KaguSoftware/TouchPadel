import { iqd, MoneyError, type IQD } from './iqd';

/**
 * Even bill split — EXACT integer largest-remainder (resolved plan override; this WINS over
 * the 250-IQD "last share" scheme sketched in design-data.md section 2):
 *
 *   base = floor(total / n); the first (total mod n) shares get base + 1.
 *
 * Invariants (property-tested):
 *   - Σ shares === total, exactly. Nobody's dinar is invented or lost.
 *   - shares differ by at most 1.
 *   - NO cash rounding here: venue_settings.cash_rounding_iqd defaults to 1 (off). If the
 *     venue ever turns a rounding unit on, that is presentation/settle-time behaviour layered
 *     elsewhere — the split itself stays exact.
 */
export function splitEvenly(total: number, n: number): IQD[] {
  const t = iqd(total);
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1) {
    throw new MoneyError(
      'INVALID_ARGUMENT',
      `split count must be a positive integer, got ${String(n)}`,
    );
  }
  const base = Math.floor(t / n);
  const remainder = t % n;
  const shares: IQD[] = new Array(n);
  for (let i = 0; i < n; i++) {
    shares[i] = iqd(i < remainder ? base + 1 : base);
  }
  return shares;
}
