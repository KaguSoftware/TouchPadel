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
 * Latin display stack. Free stand-in: Montserrat (geometric, closest free
 * neighbour to Next Art), then a system geometric-ish fallback chain.
 * SWAP: prepend `'Next Art', ` when licensed files land.
 */
export const latinDisplayStack =
  "'Montserrat', 'Segoe UI', system-ui, -apple-system, 'Helvetica Neue', Arial, sans-serif";

/**
 * Arabic stack. Free stand-ins: IBM Plex Sans Arabic, then Noto Sans Arabic,
 * then system Arabic-capable faces.
 * SWAP: prepend `'Frutiger LT Arabic', ` when licensed files land.
 */
export const arabicStack =
  "'IBM Plex Sans Arabic', 'Noto Sans Arabic', 'Segoe UI', Tahoma, system-ui, sans-serif";

/** Body text: Arabic-capable first so mixed EN/AR body copy stays consistent. */
export const bodyStack = `${arabicStack}`;

/** Monospace for order refs, idempotency keys, debug panes. */
export const monoStack = "'Cascadia Code', 'SF Mono', Consolas, 'Roboto Mono', monospace";

export const fontVars = {
  '--tp-font-display': latinDisplayStack,
  '--tp-font-arabic': arabicStack,
  '--tp-font-body': bodyStack,
  '--tp-font-mono': monoStack,
} as const satisfies FontVars;
