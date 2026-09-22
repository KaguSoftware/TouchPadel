/**
 * The monthly cap as the owner types it (USD) and as the server stores it
 * (USD micros). The bounds mirror app.assistant_set_monthly_cap (0145), so the
 * dialog refuses what the RPC would refuse before anyone presses Apply.
 */
export const CAP_MAX_MICROS = 10_000_000_000; // USD 10,000
const MICROS_PER_USD = 1_000_000;

const DIGITS: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/** `"35"`, `"1,250.5"`, `"$20"`, `"٣٥"` → micros rounded to the cent; `null` when it is not an amount in (0, 10,000]. */
export function parseCapUsd(text: string): number | null {
  const normal = text
    .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d] ?? d)
    .replace(/٫/g, '.')
    .replace(/[\s,٬$]/g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(normal)) return null;
  const micros = Math.round(Number(normal) * 100) * (MICROS_PER_USD / 100);
  if (!Number.isFinite(micros) || micros <= 0 || micros > CAP_MAX_MICROS) return null;
  return micros;
}

/** Micros → the plain figure the input starts from (`20000000` → `"20"`, `12500000` → `"12.50"`). */
export function capInputValue(micros: number | null | undefined): string {
  if (!micros || micros <= 0) return '';
  const usd = micros / MICROS_PER_USD;
  return Number.isInteger(usd) ? String(usd) : usd.toFixed(2);
}
