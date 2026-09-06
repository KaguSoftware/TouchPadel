/**
 * Font-stack tokens.
 *
 * ┌─────────────────────────────────────────────────────────────────────────────┐
 * │  ONE FAMILY, BOTH SCRIPTS: **Lama Sans**                                    │
 * │                                                                             │
 * │  Touch delivered Lama Sans (docs/brand/lama-sans/) and it carries Latin     │
 * │  AND Arabic in the same faces — 97 Arabic codepoints with real init/medi/   │
 * │  fina/rlig shaping, Arabic-Indic and extended Arabic-Indic digits, all      │
 * │  nine weights. `fsType` is 0 (installable embedding), so it ships inside    │
 * │  the app binary and the web bundle.                                         │
 * │                                                                             │
 * │  That retires the whole two-script apparatus this file used to carry:       │
 * │  Poppins/Montserrat for Latin, Cairo for Arabic, with a `[dir='rtl']`       │
 * │  family fork to switch between them. Both stacks below now lead with the    │
 * │  same face; they stay as SEPARATE tokens only so the ~200 call sites that   │
 * │  say `var(--tp-font-arabic)` keep working and so the fallbacks can differ   │
 * │  (an Arabic-capable tail behind the Arabic token, for the one frame where   │
 * │  the webfont has not arrived).                                              │
 * │                                                                             │
 * │  The faces are registered by `fontFaceCss` (../fontFace.ts), which every    │
 * │  web surface injects. Nothing in the codebase names a font family outside   │
 * │  this file — everything goes through these tokens / the --tp-font-* vars.   │
 * └─────────────────────────────────────────────────────────────────────────────┘
 */

export type FontVars = Readonly<Record<`--tp-font-${string}`, string>>;

/** The registered family name. Must match `fontFaceCss`'s `font-family`. */
export const BRAND_FAMILY = 'Lama Sans';

/**
 * Last-resort tail, used when the webfont has not painted yet (or failed).
 * `system-ui` first so each OS picks its own text face; Tahoma and Segoe UI
 * are in here because they are the two Windows faces that cover Arabic — the
 * operator runs on Windows and its receipts render in Chromium.
 */
const SYSTEM_TAIL =
  "system-ui, -apple-system, 'Segoe UI', Tahoma, 'Noto Sans Arabic', Arial, sans-serif";

/** Latin display: headings, the wordmark, section words, buttons. */
export const latinDisplayStack = `'${BRAND_FAMILY}', ${SYSTEM_TAIL}`;

/** Arabic: identical face, same tail (which is already Arabic-capable). */
export const arabicStack = `'${BRAND_FAMILY}', ${SYSTEM_TAIL}`;

/** Body text. One family covers mixed EN/AR body copy with no fork. */
export const bodyStack = latinDisplayStack;

/** Monospace for order refs, idempotency keys, debug panes. Not a brand face. */
export const monoStack = "'Cascadia Code', 'SF Mono', Consolas, 'Roboto Mono', monospace";

/**
 * Numerals + Latin micro-labels. Prices sat in a separate token because the
 * menu design set them in Poppins inside otherwise-Arabic rows; with one
 * family that distinction is gone, but the token stays — `font-variant-numeric:
 * tabular-nums` on top of it now resolves to Lama Sans's real `tnum` feature.
 */
export const numericStack = latinDisplayStack;

export const fontVars = {
  '--tp-font-display': latinDisplayStack,
  '--tp-font-arabic': arabicStack,
  '--tp-font-body': bodyStack,
  '--tp-font-numeric': numericStack,
  '--tp-font-mono': monoStack,
} as const satisfies FontVars;
