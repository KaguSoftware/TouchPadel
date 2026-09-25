/**
 * The keystroke filter of Goods in's number boxes (the typed delivery and the
 * driver's purchase): quantities and costs are numbers, so the box keeps
 * nothing else.
 *
 * - Arabic-Indic (٠-٩) and Persian (۰-۹) digits from an Arabic keyboard become
 *   0-9, and the Arabic decimal separator (٫) becomes a point, as the admin
 *   money boxes already do for digits (components/inputs.tsx digitsOnly).
 * - One decimal point survives; later points are dropped.
 * - The run stops at ten digits: past that it is a typo (an extra zero), not a
 *   delivery, and the server would refuse it anyway (INVALID_QTY at 1e9).
 */
export const MAX_DECIMAL_DIGITS = 10;

export function decimalKeystroke(raw: string, maxDigits: number = MAX_DECIMAL_DIGITS): string {
  const kept = raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/٫/g, '.')
    .replace(/[^0-9.]/g, '');
  const dot = kept.indexOf('.');
  const once = dot === -1 ? kept : `${kept.slice(0, dot + 1)}${kept.slice(dot + 1).replace(/\./g, '')}`;
  let digits = 0;
  let out = '';
  for (const ch of once) {
    if (ch === '.') out += ch;
    else if (digits < maxDigits) {
      out += ch;
      digits += 1;
    }
  }
  return out;
}
