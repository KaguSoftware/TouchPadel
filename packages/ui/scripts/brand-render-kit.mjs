/**
 * Shared pieces for the brand render scripts in this folder
 * (`render-site-assets.mjs`, `render-cafe-icons.mjs`). Nothing here draws a
 * shape of its own: the lockup, the ball and the court-line pattern are read
 * from the modules that hold the brand's recovered vectors, and this file only
 * places and colours them.
 *
 *   apps/mobile/src/features/courtTransition/logoPaths.ts  wordmark + ball, 385.137 x 141.973
 *   apps/mobile/src/theme/brandPattern.ts                  the eleven court-line bands (identity.pdf p8)
 *   packages/i18n/src/catalogs/site.{en,ar}.ts             the headline words
 *
 * Those are TypeScript. Node >= 22.18 (and 23.6+) strips erasable types on
 * import, which is all these three need (`as const`, `readonly`, interfaces,
 * `import type`), so the scripts import the sources themselves instead of a
 * copy that could drift. On an older Node, run with
 * `--experimental-strip-types`.
 *
 * Playwright resolves from the repo root (the e2e devDependency) and renders
 * with its cached Chromium; the Lama Sans faces are inlined as data URIs from
 * `packages/ui/fonts/lama/woff2` so the render never depends on the fonts the
 * machine has installed or on the network.
 */
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '..', '..', '..');

const fromRoot = (...p) => path.join(ROOT, ...p);
const load = (...p) => import(pathToFileURL(fromRoot(...p)).href);

export const LOGO = await load('apps', 'mobile', 'src', 'features', 'courtTransition', 'logoPaths.ts');
export const PATTERN = await load('apps', 'mobile', 'src', 'theme', 'brandPattern.ts');

/**
 * The closed palette (style reference §3.1) and the one derived shade the site
 * uses as its night ground. Spelled out because the token modules that own
 * them (packages/ui/src/tokens/palette.ts, site.ts) are being edited by the
 * site build; keep these equal to `--tp-brand-*` and `--tp-site-navy`.
 */
export const C = Object.freeze({
  blue: '#3360AB',
  green: '#A5D06F',
  gray: '#BCBDBF',
  black: '#000000',
  white: '#FFFFFF',
  navy: '#172C4F', // #3360AB at L20: the app's blue mode page, the site's night ground
});

/** Keep equal to BRAND_FAMILY in packages/ui/src/tokens/typography.ts. */
export const BRAND_FAMILY = 'Lama Sans';

const FACE_FILES = {
  400: 'LamaSans-Regular',
  700: 'LamaSans-Bold',
  800: 'LamaSans-ExtraBold',
  900: 'LamaSans-Black',
};

/** @font-face rules for the given weights, faces inlined as data URIs. */
export async function fontFaceCss(weights) {
  const dir = fromRoot('packages', 'ui', 'fonts', 'lama', 'woff2');
  const rules = await Promise.all(
    weights.map(async (w) => {
      const b64 = (await fs.readFile(path.join(dir, `${FACE_FILES[w]}.woff2`))).toString('base64');
      return `@font-face{font-family:'${BRAND_FAMILY}';font-style:normal;font-weight:${w};font-display:block;src:url(data:font/woff2;base64,${b64}) format('woff2')}`;
    }),
  );
  return rules.join('\n');
}

// ---------------------------------------------------------------------------
// The lockup and the ball
// ---------------------------------------------------------------------------

const { width: LW, height: LH } = LOGO.LOGO_VIEWBOX;
/** Letters T u c h a d e l; the ninth string is the swoosh with the P's counter. */
const LETTERS = LOGO.LOGO_WORDMARK_PATHS.slice(0, 8);
const SWOOSH = LOGO.LOGO_WORDMARK_PATHS[8];
if (LOGO.LOGO_WORDMARK_PATHS.length !== 9) {
  throw new Error('logoPaths.ts changed shape: expected 8 letters + the swoosh');
}

/**
 * The swoosh gradient's axis, in the lockup frame. It is the approved one from
 * apps/operator/src/components/brand.tsx (x1 7.7 y1 17 -> x2 50.5 y2 9 in that
 * file's 72.55-wide frame), scaled into this 385.137-wide frame. Only the stop
 * colours change between grounds.
 */
const K = LW / 72.55;
const GRAD = { x1: 7.7 * K, y1: 17 * K, x2: 50.5 * K, y2: 9 * K };

/**
 * Swoosh stops per ground (style reference §2.3). On blue, navy or black the
 * sweep runs green into WHITE, and the deck's own blue-ground page (full-brand2
 * p7) is fully white by the stem of the "P", so the white stop lands there
 * (the stem sits ~70 % along the axis) rather than at the loop's far edge.
 */
const SWOOSH_STOPS = {
  onDark: [
    [0, C.green],
    [0.7, C.white],
  ],
  onLight: [
    [0, C.green],
    [1, C.blue],
  ],
};

const WORD_FILL = { onDark: C.white, onLight: C.blue };

/** The ball: the white seam disc, then the three green felt arcs over it. */
function ballPaths(seam = C.white, felt = C.green) {
  const { cx, cy, r } = LOGO.LOGO_BALL_CIRCLE;
  return (
    `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${seam}"/>` +
    LOGO.LOGO_BALL_PATHS.map((d) => `<path d="${d}" fill="${felt}"/>`).join('')
  );
}

/**
 * The full lockup as an <svg> string, sized by height (width follows the
 * artwork's ratio). `id` keeps two lockups on one page from sharing a gradient.
 */
export function lockupSvg({ tone = 'onDark', height, id = 'tp-swoosh', attrs = '' }) {
  const width = (height * LW) / LH;
  const stops = SWOOSH_STOPS[tone]
    .map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`)
    .join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${LW} ${LH}" width="${width.toFixed(2)}" height="${height}" ${attrs}>` +
    `<defs><linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${GRAD.x1}" y1="${GRAD.y1}" x2="${GRAD.x2}" y2="${GRAD.y2}">${stops}</linearGradient></defs>` +
    `<path d="${SWOOSH}" fill="url(#${id})"/>` +
    LETTERS.map((d) => `<path d="${d}" fill="${WORD_FILL[tone]}"/>`).join('') +
    ballPaths() +
    `</svg>`
  );
}

/** The lockup's ball diameter at a given lockup height (the clear-space unit). */
export const ballDiameterAt = (height) => (2 * LOGO.LOGO_BALL_CIRCLE.r * height) / LH;

/**
 * The ball drawn centred at (cx, cy) with diameter `d`, as an SVG group in the
 * caller's coordinates.
 */
export function ballGroup({ cx, cy, d }) {
  const { cx: bx, cy: by, r } = LOGO.LOGO_BALL_CIRCLE;
  const s = d / (2 * r);
  const tx = cx - bx * s;
  const ty = cy - by * s;
  return `<g transform="translate(${+tx.toFixed(4)} ${+ty.toFixed(4)}) scale(${+s.toFixed(6)})">${ballPaths()}</g>`;
}

// ---------------------------------------------------------------------------
// The court-line pattern
// ---------------------------------------------------------------------------

/**
 * A crop of the brand's eleven bands, as an <svg> of `width` x `height`.
 * The panel (239.68 x 349.46 panel units) is scaled by `scale` and its top-left
 * corner placed at (`x`, `y`) in the box; the box clips it, so the bands run
 * off every edge with flat caps. Nothing is re-traced: every band is a line of
 * PATTERN_LINES at its own angle, and the band weight is the board's own 16
 * units unless `band` asks for the thin texture.
 */
export function patternSvg({
  width,
  height,
  scale,
  x = 0,
  y = 0,
  color = C.green,
  opacity = 1,
  band = PATTERN.PATTERN_BAND_WIDTH,
  attrs = '',
}) {
  const lines = PATTERN.PATTERN_LINES.map(([x1, y1, x2, y2]) => {
    const p = (v, o) => +(o + v * scale).toFixed(2);
    return `<line x1="${p(x1, x)}" y1="${p(y1, y)}" x2="${p(x2, x)}" y2="${p(y2, y)}"/>`;
  }).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" ${attrs}>` +
    `<g stroke="${color}" stroke-width="${+(band * scale).toFixed(2)}" stroke-linecap="butt" opacity="${opacity}">${lines}</g>` +
    `</svg>`
  );
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export const svgDataUri = (svg) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;

/** A page that is exactly one image of `size` px, on a transparent ground. */
export const svgPage = (svg, width, height = width) => `<!doctype html><html><head><style>
  html,body{margin:0;background:transparent}
  body{width:${width}px;height:${height}px;overflow:hidden}
  img{display:block;width:${width}px;height:${height}px}
</style></head><body><img src="${svgDataUri(svg)}"></body></html>`;

/**
 * Open Chromium, hand `run` a `shot(html, w, h, outFile, { transparent })`,
 * close it. Every shot waits for fonts and images before the screenshot.
 */
export async function withBrowser(run) {
  const { chromium } = require('playwright');
  const browser = await chromium.launch();
  try {
    async function shot(html, width, height, outFile, { transparent = false } = {}) {
      const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'load' });
      await page.evaluate(async () => {
        await document.fonts.ready;
        await Promise.all(
          [...document.images].map((im) => (im.complete ? null : new Promise((r) => (im.onload = im.onerror = r)))),
        );
        // A page that paints from script (the cafe wordmark recolour) sets this when it is done.
        if (window.__ready) await window.__ready;
      });
      await fs.mkdir(path.dirname(outFile), { recursive: true });
      await page.screenshot({
        path: outFile,
        clip: { x: 0, y: 0, width, height },
        omitBackground: transparent,
        type: 'png',
      });
      await page.close();
      console.log('wrote', path.relative(ROOT, outFile));
    }
    await run(shot);
  } finally {
    await browser.close();
  }
}
