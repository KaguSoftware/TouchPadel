/**
 * Touch Cafe brand extras + shared semantic tokens (web-slice.md §3).
 *
 * Split in two tiers so `theme.ts` can place them correctly:
 *  - `statusVars` — semantic status colours shared by BOTH themes (warn / error /
 *    success / backdrop). Components reference only these, never a hex.
 *  - `cafeBrandVars` — cafe-only brand extras (deep blue, tints, cream, swoosh
 *    and bean-pattern data-URIs), radii, shadows, type scale, layout/motion,
 *    z-index and the RTL direction sign. Emitted inside the cafe theme block.
 *
 * The bean tiles and the swoosh are the only place an SVG lives in a token:
 * they are background-image data-URIs so the CSS modules stay colour-free.
 */

export type BrandVars = Readonly<Record<`--tp-${string}`, string>>;

/** Minimal, safe data-URI encoding for inline SVG (keeps it readable in devtools). */
export function svgDataUri(svg: string): string {
  const compact = svg.replace(/\s+/g, ' ').replace(/>\s+</g, '><').trim();
  const encoded = compact
    .replace(/"/g, "'")
    .replace(/%/g, '%25')
    .replace(/#/g, '%23')
    .replace(/</g, '%3C')
    .replace(/>/g, '%3E')
    .replace(/&/g, '%26');
  return `url("data:image/svg+xml,${encoded}")`;
}

// ---------------------------------------------------------------------------
// Brand raw colours (brand deck: Touch Blue / Coffee Brown / White)
// ---------------------------------------------------------------------------
const BLUE = '#2456B4';
/**
 * The second brand colour. The approved menu design (brand/Touch Cafe Menu
 * Final) carries no brown at all — every accent, section rule and illustration
 * highlight is green — so GREEN replaces the old coffee brown here and the
 * `--tp-cafe-brown*` names below are kept only as aliases onto it.
 */
const GREEN = '#7FB05A';
const GREEN_LIGHT = '#A5CE7F';
const WHITE = '#FFFFFF';

/**
 * One coffee bean on a 40×48 tile (brand p14/p15: rows of tilted beans, the
 * centre split cut out). Tile repeats seamlessly; rotate −28° like the deck.
 */
function beanTile(fill: string | null, stroke: string): string {
  const body = fill
    ? `<ellipse cx='20' cy='24' rx='9.5' ry='14' fill='${fill}'/>`
    : `<ellipse cx='20' cy='24' rx='9.5' ry='14' fill='none' stroke='${stroke}' stroke-width='1.6'/>`;
  return `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='48' viewBox='0 0 40 48'>
  <g transform='rotate(-28 20 24)'>
    ${body}
    <path d='M20 10.5 C 14.5 18, 25.5 30, 20 37.5' fill='none' stroke='${stroke}' stroke-width='1.8' stroke-linecap='round'/>
  </g>
</svg>`;
}

/**
 * The white "swoosh" band (brand p01/p07: a wide curved white sweep across a
 * blue field). Drawn in a 1000×120 box; consumers set
 * `preserveAspectRatio="none"` semantics via background-size: 100% 100%.
 */
const SWOOSH_SVG = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 120' preserveAspectRatio='none'>
  <path d='M0 120 L0 92 C 220 140, 520 30, 1000 4 L1000 120 Z' fill='${WHITE}'/>
  <path d='M0 74 C 230 120, 540 22, 1000 -14' fill='none' stroke='${WHITE}' stroke-opacity='.45' stroke-width='3'/>
</svg>`;

// ---------------------------------------------------------------------------
// Shared semantic status tokens (both themes)
// ---------------------------------------------------------------------------
export const statusVars = {
  '--tp-warn-bg': '#FBEFC9',
  '--tp-warn-fg': '#6B4E00',
  '--tp-warn-border': '#E8CF7A',
  '--tp-error-bg': '#FBE1DF',
  '--tp-error-border': '#EAB5B0',
  '--tp-success': '#2E7D32',
  '--tp-success-bg': '#E4F2E5',
  '--tp-backdrop': 'rgba(30, 43, 69, 0.55)',
} as const satisfies BrandVars;

// ---------------------------------------------------------------------------
// Cafe-only brand extras
// ---------------------------------------------------------------------------
export const cafeColorVars = {
  '--tp-cafe-blue': BLUE,
  '--tp-cafe-blue-deep': '#1A3F87', // hover / pressed blue
  '--tp-cafe-blue-ink': '#17376F', // label on a green fill (active pill)
  '--tp-cafe-blue-tint': '#EDF2FB', // section illustration band
  '--tp-cafe-blue-tint-2': '#E9F1FC', // "بارد" chip + section badge fill
  '--tp-cafe-sky': '#7FA3E0', // middle stroke of the hero sweep
  '--tp-cafe-green': GREEN,
  '--tp-cafe-green-light': GREEN_LIGHT, // section rule + active pill fill
  '--tp-cafe-green-tint': '#F3F8EC', // green illustration band
  '--tp-cafe-ink': '#1E2B45', // item names
  '--tp-cafe-ink-soft': '#93A0B5', // the small note line under a name
  '--tp-cafe-rule': '#F0F3F8', // hairline under every menu row
  '--tp-cafe-hot-bg': '#FDEBE7', // "حار" chip
  '--tp-cafe-hot-fg': '#E8432A',
  '--tp-cafe-page': '#E7EBF1', // ground either side of the 430 px column
  // Deprecated aliases — modules not yet renamed keep rendering in palette.
  '--tp-cafe-brown': GREEN,
  '--tp-cafe-brown-tint': '#F3F8EC',
  '--tp-cafe-cream': '#E7EBF1',
  '--tp-cafe-swoosh': svgDataUri(SWOOSH_SVG),
  '--tp-cafe-beans-brown': svgDataUri(beanTile(GREEN, WHITE)),
  '--tp-cafe-beans-white': svgDataUri(beanTile(null, WHITE)),
  '--tp-cafe-bean-tile-w': '40px',
  '--tp-cafe-bean-tile-h': '48px',
} as const satisfies BrandVars;

export const radiusVars = {
  '--tp-radius-xs': '0.4rem',
  '--tp-radius-sm': '0.6rem',
  '--tp-radius-md': '1rem',
  '--tp-radius-lg': '1.25rem',
  '--tp-radius-sheet': '1.5rem',
  '--tp-radius-pill': '999px',
} as const satisfies BrandVars;

export const shadowVars = {
  // Cooled toward the blue ink to match the design's column shadow.
  '--tp-shadow-card': '0 1px 2px rgba(30, 43, 69, 0.05), 0 6px 18px rgba(30, 43, 69, 0.07)',
  '--tp-shadow-column': '0 0 60px rgba(36, 86, 180, 0.15)',
  '--tp-shadow-sheet': '0 -8px 32px rgba(30, 43, 69, 0.22)',
  '--tp-shadow-fab': '0 6px 18px rgba(36, 86, 180, 0.35), 0 2px 4px rgba(30, 43, 69, 0.15)',
} as const satisfies BrandVars;

export const typeScaleVars = {
  '--tp-fs-xs': '0.72rem',
  '--tp-fs-sm': '0.85rem',
  '--tp-fs-md': '1rem',
  '--tp-fs-lg': '1.25rem',
  '--tp-fs-xl': '1.5rem',
  '--tp-fs-display': 'clamp(1.75rem, 7vw, 2.5rem)',
  '--tp-lh-tight': '0.95',
  '--tp-tracking-caps': '0.02em',
  '--tp-tracking-eyebrow': '0.18em',
  '--tp-fw-display': '800',
} as const satisfies BrandVars;

export const layoutVars = {
  '--tp-topbar-h': '3.5rem',
  '--tp-ticker-h': '2rem',
  '--tp-space-1': '0.25rem',
  '--tp-space-2': '0.5rem',
  '--tp-space-3': '0.75rem',
  '--tp-space-4': '1rem',
  '--tp-space-5': '1.5rem',
  '--tp-space-6': '2rem',
  // The design is drawn on a 430 px phone column and centred on the page ground.
  '--tp-column-w': '430px',
} as const satisfies BrandVars;

export const motionVars = {
  '--tp-ease-out': 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  '--tp-dur-fast': '150ms',
  '--tp-dur-base': '250ms',
  '--tp-dur-slow': '400ms',
  '--tp-ticker-dur': '22s',
} as const satisfies BrandVars;

export const zIndexVars = {
  '--tp-z-sticky': '10',
  '--tp-z-topbar': '20',
  '--tp-z-fab': '30',
  '--tp-z-sheet': '40',
  '--tp-z-tutorial': '50',
  '--tp-z-lightbox': '60',
  '--tp-z-toast': '70',
  '--tp-z-offline': '80',
} as const satisfies BrandVars;

/**
 * Direction sign for the few animations that must travel "forward" (marquee):
 * `translate: calc(var(--tp-dir-sign) * -33.333%) 0`. theme.ts flips it to −1
 * under `[dir='rtl']` — the ONLY dir-scoped rule in the whole token sheet.
 *
 * It is emitted in the BASE :root block, never inside a theme block: a theme
 * block is `:root[data-theme='cafe']` (0,2,0) and would out-specify the
 * `[dir='rtl']` override (0,1,0), pinning the sign to +1 and scrolling every
 * marquee the wrong way in Arabic.
 */
export const dirVars = {
  '--tp-dir-sign': '1',
} as const satisfies BrandVars;

/** Everything emitted inside the cafe theme block (status vars go in both blocks). */
export const cafeBrandVars = {
  ...cafeColorVars,
  ...radiusVars,
  ...shadowVars,
  ...typeScaleVars,
  ...layoutVars,
  ...motionVars,
  ...zIndexVars,
} as const satisfies BrandVars;

export type CafeBrandVars = typeof cafeBrandVars;
