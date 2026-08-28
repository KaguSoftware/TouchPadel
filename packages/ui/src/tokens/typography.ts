/**
 * Font-stack tokens.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  BRAND FONTS NOT YET IN HAND — SWAP POINT                                   │
 * │                                                                             │
 * │  The licensed brand faces are:                                              │
 * │    Latin display:  **Next Art**                                             │
 * │    Arabic:         **Frutiger LT Arabic**                                   │
 * │                                                                             │
 * │  Both are commercial and Touch has not delivered files/licenses yet         │
 * │  (see HANDOFF.md scope ledger). When the files arrive, register the         │
 * │  @font-face rules in each app and change ONLY the first name in each        │
 * │  stack below — a one-line swap per token. Nothing else in the codebase      │
 * │  references font family names directly; everything goes through these       │
 * │  tokens / the --tp-font-* CSS variables.                                    │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

export type FontVars = Readonly<Record<`--tp-font-${string}`, string>>;

/**
 * Latin display stack. The approved Touch Cafe menu design sets every Latin
 * string in **Poppins** — the section words (COFFEE, SMOOTHIE…), the size
 * column headers and every price — so Poppins leads here rather than the older
 * Montserrat stand-in.
 * SWAP: prepend `'Next Art', ` when licensed files land.
 */
export const latinDisplayStack =
  "'Poppins', 'Montserrat', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/**
 * Arabic stack. The menu design sets all Arabic — headings, item names, chips —
 * in **Cairo**, so Cairo leads; IBM Plex Sans Arabic and Noto Sans Arabic stay
 * behind it as fallbacks.
 * SWAP: prepend `'Frutiger LT Arabic', ` when licensed files land.
 */
export const arabicStack =
  "'Cairo', 'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Segoe UI', Tahoma, system-ui, sans-serif";

/** Body text: Arabic-capable first so mixed EN/AR body copy stays consistent. */
export const bodyStack = `${arabicStack}`;

/** Monospace for order refs, idempotency keys, debug panes. */
export const monoStack = "'Cascadia Code', 'SF Mono', Consolas, 'Roboto Mono', monospace";

/**
 * Numerals + Latin micro-labels. The menu design prices everything in Poppins
 * even inside an otherwise Arabic row, so prices and size headers get their own
 * token instead of borrowing the display stack by accident.
 */
export const numericStack = latinDisplayStack;

export const fontVars = {
  '--tp-font-display': latinDisplayStack,
  '--tp-font-arabic': arabicStack,
  '--tp-font-body': bodyStack,
  '--tp-font-numeric': numericStack,
  '--tp-font-mono': monoStack,
} as const satisfies FontVars;
