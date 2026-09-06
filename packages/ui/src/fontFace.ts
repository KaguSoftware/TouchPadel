/**
 * @font-face registration for the brand family, shared by every web surface.
 *
 * The files themselves are canonical at `packages/ui/fonts/lama/` and are
 * copied into each app's static root by `scripts/sync-fonts.mjs` (run
 * `pnpm fonts:sync`; `pnpm fonts:check` fails CI on drift). Both bundlers we
 * ship serve that root at `/`:
 *
 *   apps/web/public/fonts/lama/       → Next.js  → /fonts/lama/…
 *   apps/operator/public/fonts/lama/  → Vite     → /fonts/lama/…
 *
 * Serving them from the SAME path in both is what lets one CSS string cover
 * both apps — everywhere the document has an origin. The packaged operator is
 * the third case and the one `fontFaceCss` below is shaped around: its window
 * is opened with `loadFile`, so the document is `file://` and that shared
 * leading slash addresses the filesystem root. Anything that cannot resolve a
 * path at all — the Electron receipt, which renders from a `data:text/html`
 * URL with no origin — passes its own base or inlines the faces as data URIs
 * via `fontFaceCssFrom`.
 *
 * WHY SEVEN FACES AND NOT EIGHTEEN. The drop shipped 3 widths × 9 weights ×
 * roman/italic = 54 faces per format. The UI uses six weights (400/500/600/
 * 700/800/900 — 100/200/300 appear nowhere) at the standard width, plus one
 * italic: five muted "note" lines set `font-style: italic`, all at body weight.
 * Everything else was cut. Real italic beats the synthesised oblique a missing
 * face would get, which matters more than usual here — a slanted Arabic note
 * is exactly the artefact faux-italic produces.
 */

import { BRAND_FAMILY } from './tokens/typography';

/** Where the .woff2 files are served from. Same in web and operator. */
export const FONT_BASE = '/fonts/lama';

export interface FontFaceSpec {
  /** File stem, e.g. `LamaSans-SemiBold`. */
  readonly file: string;
  readonly weight: 400 | 500 | 600 | 700 | 800 | 900;
  readonly style: 'normal' | 'italic';
}

/**
 * The shipped faces, in load order. Regular and Bold lead because they carry
 * body copy and its bold on every surface, and are the two the receipt pipeline
 * inlines.
 */
export const FONT_FACES: readonly FontFaceSpec[] = [
  { file: 'LamaSans-Regular', weight: 400, style: 'normal' },
  { file: 'LamaSans-Bold', weight: 700, style: 'normal' },
  { file: 'LamaSans-Medium', weight: 500, style: 'normal' },
  { file: 'LamaSans-SemiBold', weight: 600, style: 'normal' },
  { file: 'LamaSans-ExtraBold', weight: 800, style: 'normal' },
  { file: 'LamaSans-Black', weight: 900, style: 'normal' },
  { file: 'LamaSans-RegularItalic', weight: 400, style: 'italic' },
] as const;

/**
 * The faces worth a `<link rel="preload">`: the ones above the fold everywhere.
 *
 * 400 and 700 are body copy and its bold. 800 is `--tp-fw-display`, and the
 * cafe menu's first screen is set in it almost end to end — the wordmark in the
 * top bar, the Latin masthead, and every section band word, which is drawn as
 * an outline (`-webkit-text-stroke`) and so shows a fallback's stem widths far
 * more plainly than filled text would. Off this list a face is discovered only
 * once the parser lays out a glyph that wants it, one round trip after the
 * inlined stylesheet, over the venue wifi the whole self-hosting decision was
 * made for.
 *
 * 900 stays off it. It is a single rule — the Arabic masthead — that
 * `[dir='ltr']` overrides back to 800, so preloading Black would be a face
 * fetched and then never used on every English scan. Preloading it only where
 * it is read belongs in the document that already knows `dir`, not in a list
 * two apps share.
 */
export const PRELOAD_FACES: readonly FontFaceSpec[] = FONT_FACES.filter(
  (f) => f.style === 'normal' && (f.weight === 400 || f.weight === 700 || f.weight === 800),
);

function faceRule(face: FontFaceSpec, srcs: readonly string[]): string {
  return [
    '@font-face {',
    `  font-family: '${BRAND_FAMILY}';`,
    `  src: ${srcs.map((src) => `url('${src}') format('woff2')`).join(', ')};`,
    `  font-weight: ${face.weight};`,
    `  font-style: ${face.style};`,
    // swap, not block: a receipt or a menu must never hold blank text waiting
    // on a face. The fallback tail in tokens/typography.ts covers both scripts.
    '  font-display: swap;',
    '}',
  ].join('\n');
}

/**
 * @font-face rules, with each face's `src` resolved by `srcFor`. Use this when
 * the URLs are not paths — bundler-hashed imports, or base64 data URIs for the
 * Electron receipt's origin-less `data:` document.
 */
export function fontFaceCssFrom(srcFor: (face: FontFaceSpec) => string): string {
  return FONT_FACES.map((face) => faceRule(face, [srcFor(face)])).join('\n\n');
}

/**
 * @font-face rules pointing at `${base}/<file>.woff2`.
 *
 * A ROOT-relative base is emitted twice per face: the absolute URL first, then
 * the same path relative to the document. The absolute one is the only form
 * that can be right on the web, where a page sits at /<locale>/… and a
 * relative url would look for the faces beside it; being first it is the one
 * that loads and the twin is never fetched. In the packaged operator it is the
 * other way round — a `file://` document resolves the leading slash against
 * the filesystem root, every face fails, and the twin lands next to
 * index.html, which is where electron-builder puts the synced `fonts/`. That
 * failure is invisible without the twin: Vite forces base `/` in serve mode,
 * so the string is correct in dev and the kiosk is the only place it is not,
 * and a missing face is a silent fall through to the system tail rather than
 * an error. A base that is not root-relative is the caller resolving the URL
 * itself and gets one source.
 */
export function fontFaceCss(base: string = FONT_BASE): string {
  const documentRelative = base.startsWith('/') ? base.slice(1) : null;
  return FONT_FACES.map((face) => {
    const file = `${face.file}.woff2`;
    return faceRule(
      face,
      documentRelative === null
        ? [`${base}/${file}`]
        : [`${base}/${file}`, `${documentRelative}/${file}`],
    );
  }).join('\n\n');
}
