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
import { fontFaceCss } from './fontFace';
import { cafeBrandVars, dirVars, statusVars } from './tokens/cafeBrand';
import { operatorPalette, operatorVars } from './tokens/operator';
import { OPERATOR_BLUE_MODE, operatorBlueVars } from './tokens/operatorBlue';
import { SITE_NIGHT_MODE, siteLightVars, siteNightVars, siteScaleVars } from './tokens/site';

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
    // The public site (tokens/site.ts): light extras + the shared scale. Its night mode
    // is a separate block below, keyed like the operator's blue mode.
    ...(name === 'padel' ? { ...siteLightVars, ...siteScaleVars } : {}),
    ...(name === 'operator' ? operatorVars : {}),
  };
  return `:root[data-theme='${name}'],\n[data-theme='${name}'] {\n${varsBlock(vars)}\n}`;
}

/**
 * The operator's blue mode (tokens/operatorBlue.ts): the same theme with the
 * brand blue moved into the ground. Keyed by a SECOND attribute on the same
 * element rather than a fourth theme name, so every `[data-theme='operator']`
 * rule in the app keeps matching and only the colours it names are replaced.
 * Two attributes (0,3,0) out-specify the theme block (0,2,0) by construction.
 */
function operatorBlueBlock(): string {
  const sel = `[data-theme='operator'][data-mode='${OPERATOR_BLUE_MODE}']`;
  return `:root${sel},\n${sel} {\n  color-scheme: dark;\n${varsBlock(operatorBlueVars)}\n}`;
}

/**
 * The operator's CROSS SCOPES (round 3, 2026-10-18): where one mode borrows the
 * other's colour as a solid ground, the content on that ground takes the other
 * mode's palette too. In blue mode a white panel title band and a white
 * selected row hold paper-coloured links, grey text, buttons and badges; on
 * paper a solid Touch Blue selected row holds blue-mode ones. Without this a
 * blue-mode link (white) on a white band, or a paper link (#3360AB) on a
 * Touch Blue row, simply disappears.
 *
 * The scope re-declares every colour token blue mode overrides, with the
 * other mode's value, on the scoped element; descendants inherit those. The
 * ground tokens themselves are left out, so the band and the row keep their
 * own mode's colour.
 */
export const OPERATOR_SCOPE_GROUNDS = [
  '--tp-panel-head',
  '--tp-panel-head-fg',
  '--tp-selected',
  '--tp-selected-fg',
] as const;

/** What a selected row is, everywhere the operator draws one. */
const SELECTED_ROWS = [
  ".tp-table tbody tr[data-selected='true']",
  ".tp-row[data-selected='true']",
  ".tp-goto-option[aria-selected='true']",
];

function operatorCrossScopes(): string {
  const grounds = new Set<string>(OPERATOR_SCOPE_GROUNDS);
  const paperAll: Readonly<Record<string, string>> = { ...operatorPalette, ...operatorVars };
  const paper: Record<string, string> = {};
  const blue: Record<string, string> = {};
  for (const [name, value] of Object.entries(operatorBlueVars)) {
    if (grounds.has(name)) continue;
    const paperValue = paperAll[name];
    if (paperValue !== undefined) paper[name] = paperValue;
    blue[name] = value;
  }
  const blueRoot = `[data-theme='operator'][data-mode='${OPERATOR_BLUE_MODE}']`;
  const paperRoot = `[data-theme='operator']:not([data-mode='${OPERATOR_BLUE_MODE}'])`;
  // `.tp-band` (the panel title band) crosses in BOTH modes: Touch Blue on
  // paper, white in blue mode. The selected row is Padel Green in both modes
  // (Sait, 2026-10-19), a light ground, so it takes the paper palette in blue
  // mode and keeps its own on paper.
  const toPaper = ['.tp-paper', '.tp-band', ...SELECTED_ROWS].map((s) => `${blueRoot} ${s}`).join(',\n');
  const toBlue = ['.tp-blue', '.tp-band'].map((s) => `${paperRoot} ${s}`).join(',\n');
  // Nothing on the green turns grey or link-blue: secondary text and accent
  // ink take the row's own navy. Listed after the cross scopes, at the same
  // specificity, so it wins over the paper values they set.
  const onSelected = SELECTED_ROWS.flatMap((s) => [`${blueRoot} ${s}`, `${paperRoot} ${s}`]).join(',\n');
  return [
    `${toPaper} {
  color-scheme: light;
${varsBlock(paper)}
}`,
    `${toBlue} {
  color-scheme: dark;
${varsBlock(blue)}
}`,
    `${onSelected} {
  --tp-muted-fg: var(--tp-selected-fg);
  --tp-accent: var(--tp-selected-fg);
}`,
  ].join('\n\n');
}

/**
 * The public site's night mode (tokens/site.ts) — the guest app's blue mode on the web.
 * Same two-attribute mechanism as the operator's: `[data-theme='padel'][data-mode='night']`
 * (0,3,0) out-specifies the padel block (0,2,0), so only the colours it names change.
 */
function siteNightBlock(): string {
  const sel = `[data-theme='padel'][data-mode='${SITE_NIGHT_MODE}']`;
  return `:root${sel},\n${sel} {\n  color-scheme: dark;\n${varsBlock(siteNightVars)}\n}`;
}

export const themeCss: string = [
  `/* Generated from @touch/ui tokens — do not edit by hand. */`,
  // The brand faces ride with the tokens, so every surface that inlines
  // themeCss gets Lama Sans registered without remembering to. Files are served
  // from /fonts/lama in both apps (see fontFace.ts); a surface with no origin
  // — the Electron receipt — builds its own rules with fontFaceCssFrom.
  fontFaceCss(),
  // Base block: fonts plus the direction sign. --tp-dir-sign MUST live here and
  // not in a theme block — `:root[data-theme='cafe']` (0,2,0) would out-specify
  // the `[dir='rtl']` override below (0,1,0) and pin the sign to +1.
  `:root {\n${varsBlock({ ...fontVars, ...dirVars })}\n}`,
  themeBlock('padel'),
  siteNightBlock(),
  themeBlock('cafe'),
  themeBlock('operator'),
  operatorBlueBlock(),
  operatorCrossScopes(),
  // Base ground: paint from tokens so an unthemed flash never shows raw UA colors.
  // Fallbacks are tokens, not raw #fff / #000: DESIGN.md forbids both, and an
  // unthemed flash is exactly the moment a raw value would be visible.
  `body {\n  background: var(--tp-bg, #FBFBFD);\n  color: var(--tp-fg, #0B0F17);\n  font-family: var(--tp-font-body);\n}`,
  // Arabic rendering. Lama Sans carries both scripts, so this now resolves to
  // the SAME face as the body stack and the rule is a no-op — kept because the
  // token is what ~200 call sites name, and because the two stacks' FALLBACK
  // tails are allowed to diverge again. dir='rtl' needs no per-property
  // overrides beyond it (logical properties only).
  `[dir='rtl'] {\n  font-family: var(--tp-font-arabic);\n}`,
  // The single direction-aware token: marquee/travel animations multiply by it.
  `[dir='rtl'] {\n  --tp-dir-sign: -1;\n}`,
].join('\n\n');

/** id of the <style> element ThemeProvider injects (idempotent). */
export const THEME_STYLE_ID = 'touch-theme-tokens';
