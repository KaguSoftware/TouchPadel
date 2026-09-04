/**
 * Theme stylesheet generated from the token maps (single source of truth:
 * `tokens/palette.ts` + `tokens/typography.ts`). No build step — apps either
 * inject `themeCss` at runtime (ThemeProvider does this) or write it to a
 * static .css at their own build time.
 *
 * Activation is attribute-driven:
 *   <html data-theme="padel" dir="ltr">  or  data-theme="cafe" dir="rtl"
 *
 * RTL NOTE: there are deliberately NO left/right overrides here. All layout
 * uses CSS logical properties (margin-inline-*, inset-inline-*, text-align:
 * start/end — lint-enforced), so flipping the document is ONLY `dir="rtl"`
 * plus the Arabic font token; no [dir='rtl'] color/layout forks exist.
 */
import { palettes, type ThemeName } from './tokens/palette';
import { fontVars } from './tokens/typography';
import { cafeBrandVars, dirVars, statusVars } from './tokens/cafeBrand';
import { operatorVars } from './tokens/operator';

function varsBlock(vars: Readonly<Record<string, string>>, indent = '  '): string {
  return Object.entries(vars)
    .map(([name, value]) => `${indent}${name}: ${value};`)
    .join('\n');
}

function themeBlock(name: ThemeName): string {
  // :root[data-theme=…] for the document; bare [data-theme=…] also matches
  // scoped sub-trees (e.g. a cafe-branded embed inside the padel site).
  // Semantic status tokens ride along in BOTH themes; the cafe brand extras
  // (radii, shadows, type scale, motion, z-index, swoosh/bean tiles) only in cafe.
  // `statusVars` is the CAFE status vocabulary (--tp-warn-bg, --tp-error-bg,
  // --tp-backdrop …). The operator has its own, four rungs deep and OKLCH
  // (--tp-warn-soft / -mark / -fg, --tp-overlay), so emitting both inside one
  // theme block gave the operator two names for every status and six raw cafe
  // hexes it never meant to have. It leaked: an admin chip rendered in cafe
  // yellow off --tp-warn-bg. The operator block now carries one vocabulary.
  const vars: Readonly<Record<string, string>> = {
    ...palettes[name],
    ...(name === 'operator' ? {} : statusVars),
    ...(name === 'cafe' ? cafeBrandVars : {}),
    ...(name === 'operator' ? operatorVars : {}),
  };
  return `:root[data-theme='${name}'],\n[data-theme='${name}'] {\n${varsBlock(vars)}\n}`;
}

export const themeCss: string = [
  `/* Generated from @touch/ui tokens — do not edit by hand. */`,
  // Base block: fonts plus the direction sign. --tp-dir-sign MUST live here and
  // not in a theme block — `:root[data-theme='cafe']` (0,2,0) would out-specify
  // the `[dir='rtl']` override below (0,1,0) and pin the sign to +1.
  `:root {\n${varsBlock({ ...fontVars, ...dirVars })}\n}`,
  themeBlock('padel'),
  themeBlock('cafe'),
  themeBlock('operator'),
  // Base ground: paint from tokens so an unthemed flash never shows raw UA colors.
  // Fallbacks are tokens, not raw #fff / #000: DESIGN.md forbids both, and an
  // unthemed flash is exactly the moment a raw value would be visible.
  `body {\n  background: var(--tp-bg, #FBFBFD);\n  color: var(--tp-fg, #0B0F17);\n  font-family: var(--tp-font-body);\n}`,
  // Arabic rendering: same tokens; the arabic-capable body stack already leads.
  // dir='rtl' needs no per-property overrides (logical properties only).
  `[dir='rtl'] {\n  font-family: var(--tp-font-arabic);\n}`,
  // The single direction-aware token: marquee/travel animations multiply by it.
  `[dir='rtl'] {\n  --tp-dir-sign: -1;\n}`,
].join('\n\n');

/** id of the <style> element ThemeProvider injects (idempotent). */
export const THEME_STYLE_ID = 'touch-theme-tokens';
