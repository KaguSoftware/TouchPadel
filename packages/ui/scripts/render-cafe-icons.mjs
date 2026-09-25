#!/usr/bin/env node
/**
 * Render the Touch Cafe brand assets for apps/web: the icons from the single
 * SVG source (`packages/ui/src/brand/cafe-mark.svg`), and the share card from
 * the approved menu lockup (`apps/web/public/brand/cafe/wordmark.png`, the
 * image the menu header paints), with Playwright's cached Chromium.
 *
 *   node packages/ui/scripts/render-cafe-icons.mjs
 *   (also run by render-site-assets.mjs, which renders the site set with it)
 *
 * Outputs (apps/web/public/brand/cafe/):
 *   favicon.svg                copy of the mark
 *   icon-192.png               192x192 rounded tile, transparent corners (manifest, purpose any)
 *   icon-512.png               512x512 the same
 *   icon-512-maskable.png      512x512 full-bleed blue, mark inside the 80 % safe zone
 *   apple-icon-180.png         180x180 full-bleed and opaque (iOS masks it; a transparent
 *                              corner would be filled black)
 *   og-touch-cafe-1200x630.png blue field, white bean pattern, the lockup in white with its
 *                              green bean and smile, "المنيو · MENU"
 *   og-1200x630.png            the same card under its old name, so a page that still points
 *                              at it stops showing the retired brown; nothing new links it
 *
 * Brown is retired (style reference 2.5, 3.1): no colour here is outside the
 * five, and the recolour below maps the raster's blue to white and its green
 * to the exact Padel Green.
 */
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { ROOT, C, BRAND_FAMILY, fontFaceCss, svgDataUri, svgPage, withBrowser } from './brand-render-kit.mjs';

const SRC = path.join(ROOT, 'packages', 'ui', 'src', 'brand', 'cafe-mark.svg');
export const CAFE_OUT = path.join(ROOT, 'apps', 'web', 'public', 'brand', 'cafe');
const WORDMARK = path.join(CAFE_OUT, 'wordmark.png');

/**
 * The masthead word, as the menu page prints it: `cafe.hero.menuWord` in
 * packages/i18n/src/catalogs/ar.ts (en.ts carries "THE MENU"; the card sets the
 * bare noun so both halves are one word). Literal because the catalog barrels
 * import a directory, which plain Node ESM cannot resolve.
 */
const MENU_AR = 'المنيو';
const MENU_EN = 'Menu';

/** The coffee-bean tile from packages/ui/src/tokens/cafeBrand.ts (beanTile(null, WHITE)). */
const beanTile = `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='48' viewBox='0 0 40 48'><g transform='rotate(-28 20 24)'><ellipse cx='20' cy='24' rx='9.5' ry='14' fill='none' stroke='${C.white}' stroke-width='1.6'/><path d='M20 10.5 C 14.5 18, 25.5 30, 20 37.5' fill='none' stroke='${C.white}' stroke-width='1.8' stroke-linecap='round'/></g></svg>`;

/** The café swoosh band from cafeBrand.ts (SWOOSH_SVG), the menu header's closing sweep. */
const swooshSvg = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1000 120' preserveAspectRatio='none'><path d='M0 120 L0 92 C 220 140, 520 30, 1000 4 L1000 120 Z' fill='${C.white}'/></svg>`;

function ogPage({ fonts, wordmarkUri }) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  ${fonts}
  html,body{margin:0}
  body{width:1200px;height:630px;overflow:hidden;position:relative;background:${C.blue};font-family:'${BRAND_FAMILY}',sans-serif;color:${C.white}}
  .beans{position:absolute;inset:0;opacity:.1;background-image:url("${svgDataUri(beanTile)}");background-size:40px 48px}
  .sweep{position:absolute;inset-inline:0;inset-block-end:0;block-size:150px;opacity:.14;background:url("${svgDataUri(swooshSvg)}") 0 0/100% 100% no-repeat}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:34px;padding-block-end:36px}
  canvas{display:block;inline-size:900px;block-size:auto}
  .word{display:flex;align-items:center;gap:28px;font-size:46px;line-height:1}
  .word .en{font-weight:800;letter-spacing:.18em;text-transform:uppercase;margin-inline-end:-.18em}
  .word .ar{font-weight:800;line-height:1.3}
  .dot{inline-size:12px;block-size:12px;border-radius:50%;background:${C.green}}
</style></head><body>
<div class="beans"></div>
<div class="sweep"></div>
<div class="wrap">
  <canvas id="mark" role="img" aria-label="Touch Cafe"></canvas>
  <div class="word" dir="ltr"><span class="ar" lang="ar" dir="rtl">${MENU_AR}</span><span class="dot"></span><span class="en" lang="en">${MENU_EN}</span></div>
</div>
<script>
  // The approved lockup is a raster (blue letters, green bean and smile, the
  // smile running green into blue at the "C"). Recolour it rather than retype
  // it: each pixel is placed on the line from the raster's blue to its green,
  // and redrawn at that point on the line from white to the exact Padel Green.
  // Letters go white, bean and smile go exact green, the smile's tail runs
  // green into white (the dark-ground swoosh rule), and the bean's split stays
  // transparent so the blue ground is the split, as on the deck's blue board.
  window.__ready = new Promise((done) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.getElementById('mark');
      cv.width = img.naturalWidth; cv.height = img.naturalHeight;
      const g = cv.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, cv.width, cv.height);
      const d = px.data;
      const B = [51, 87, 149], G = [156, 201, 109];           // the raster's own blue and green
      const W = [255, 255, 255], N = [165, 208, 111];          // white, Padel Green #A5D06F
      const v = [G[0]-B[0], G[1]-B[1], G[2]-B[2]];
      const vv = v[0]*v[0] + v[1]*v[1] + v[2]*v[2];
      for (let i = 0; i < d.length; i += 4) {
        if (d[i+3] === 0) continue;
        let t = ((d[i]-B[0])*v[0] + (d[i+1]-B[1])*v[1] + (d[i+2]-B[2])*v[2]) / vv;
        t = t < 0 ? 0 : t > 1 ? 1 : t;
        for (let k = 0; k < 3; k++) d[i+k] = Math.round(W[k] + (N[k]-W[k]) * t);
      }
      g.putImageData(px, 0, 0);
      done();
    };
    img.src = ${JSON.stringify(wordmarkUri)};
  });
</script>
</body></html>`;
}

/** Full-bleed page: the mark at `inner` px centred on a blue square of `size`. */
const fieldPage = (svg, size, inner) => {
  const pad = Math.round((size - inner) / 2);
  return `<!doctype html><html><head><style>
  html,body{margin:0}
  body{width:${size}px;height:${size}px;overflow:hidden;background:${C.blue}}
  img{display:block;width:${inner}px;height:${inner}px;margin:${pad}px}
</style></head><body><img src="${svgDataUri(svg)}"></body></html>`;
};

export async function renderCafe(shot) {
  const svg = await fs.readFile(SRC, 'utf8');
  if (/#603813/i.test(svg)) throw new Error('cafe-mark.svg still carries the retired brown');
  await fs.mkdir(CAFE_OUT, { recursive: true });
  await fs.writeFile(path.join(CAFE_OUT, 'favicon.svg'), svg);
  console.log('wrote', path.relative(ROOT, path.join(CAFE_OUT, 'favicon.svg')));

  const out = (f) => path.join(CAFE_OUT, f);
  await shot(svgPage(svg, 192), 192, 192, out('icon-192.png'), { transparent: true });
  await shot(svgPage(svg, 512), 512, 512, out('icon-512.png'), { transparent: true });
  // The tile's own rounded corners sit on the same blue, so the field is seamless.
  await shot(fieldPage(svg, 512, 410), 512, 512, out('icon-512-maskable.png'));
  await shot(fieldPage(svg, 180, 180), 180, 180, out('apple-icon-180.png'));

  const fonts = await fontFaceCss([800]);
  const wordmarkUri = `data:image/png;base64,${(await fs.readFile(WORDMARK)).toString('base64')}`;
  const og = ogPage({ fonts, wordmarkUri });
  await shot(og, 1200, 630, out('og-touch-cafe-1200x630.png'));
  await fs.copyFile(out('og-touch-cafe-1200x630.png'), out('og-1200x630.png'));
  console.log('wrote', path.relative(ROOT, out('og-1200x630.png')), '(copy, legacy name)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await withBrowser(renderCafe);
}
