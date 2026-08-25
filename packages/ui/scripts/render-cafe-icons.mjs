#!/usr/bin/env node
/**
 * Render the Touch Cafe brand assets for apps/web from the single SVG source
 * (`packages/ui/src/brand/cafe-mark.svg`) using Playwright's bundled Chromium.
 *
 *   node packages/ui/scripts/render-cafe-icons.mjs
 *
 * Outputs (apps/web/public/brand/cafe/):
 *   favicon.svg            copy of the mark
 *   icon-192.png           192×192 (manifest, purpose any)
 *   icon-512.png           512×512 (manifest, purpose any)
 *   icon-512-maskable.png  512×512 with the mark inside the 80 % safe zone on a blue field
 *   apple-icon-180.png     180×180 (apple-touch-icon, square — iOS rounds it)
 *   og-1200x630.png        blue field, white wordmark + smile, "Menu · القائمة"
 *
 * Padel PNGs in apps/web/public/brand/ are never touched. `playwright` resolves
 * from the repo root (e2e devDependency).
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..', '..');
const SRC = path.join(root, 'packages', 'ui', 'src', 'brand', 'cafe-mark.svg');
const OUT = path.join(root, 'apps', 'web', 'public', 'brand', 'cafe');

const BLUE = '#3360AB';
const BROWN = '#603813';
const WHITE = '#FFFFFF';

const svg = await fs.readFile(SRC, 'utf8');
const svgDataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'favicon.svg'), svg);

/** Full-bleed mark at `size`. */
const markPage = (size) => `<!doctype html><html><head><style>
  html,body{margin:0;background:transparent}
  body{width:${size}px;height:${size}px;overflow:hidden}
  img{display:block;width:${size}px;height:${size}px}
</style></head><body><img src="${svgDataUri}"></body></html>`;

/** Maskable: solid blue field; mark scaled to the 80 % safe zone (never clipped by any mask). */
const maskablePage = (size) => {
  const inner = Math.round(size * 0.8);
  const pad = Math.round((size - inner) / 2);
  return `<!doctype html><html><head><style>
  html,body{margin:0}
  body{width:${size}px;height:${size}px;overflow:hidden;background:${BLUE}}
  img{display:block;width:${inner}px;height:${inner}px;margin:${pad}px}
</style></head><body><img src="${svgDataUri}"></body></html>`;
};

/**
 * Open Graph card: Touch Blue field, white outline-bean pattern, white
 * wordmark "T[bean]uch Cafe" + brown smile, subtitle "Menu · القائمة".
 * Montserrat is fetched from Google Fonts (rendering only; nothing ships).
 */
const ogPage = `<!doctype html><html><head>
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Montserrat:wght@700;800&family=IBM+Plex+Sans+Arabic:wght@500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0}
  body{width:1200px;height:630px;overflow:hidden;background:${BLUE};position:relative;font-family:'Montserrat',sans-serif;color:${WHITE}}
  .beans{position:absolute;inset:0;opacity:.10;background-image:url("data:image/svg+xml;utf8,${encodeURIComponent(
    `<svg xmlns='http://www.w3.org/2000/svg' width='40' height='48' viewBox='0 0 40 48'><g transform='rotate(-28 20 24)'><ellipse cx='20' cy='24' rx='9.5' ry='14' fill='none' stroke='${WHITE}' stroke-width='1.6'/><path d='M20 10.5 C 14.5 18, 25.5 30, 20 37.5' fill='none' stroke='${WHITE}' stroke-width='1.8' stroke-linecap='round'/></g></svg>`,
  )}");background-size:40px 48px}
  .swoosh{position:absolute;left:0;right:0;bottom:0;height:150px}
  .wrap{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px}
  .word{display:flex;align-items:baseline;font-weight:800;font-size:168px;letter-spacing:-.02em;line-height:1;position:relative}
  .word .bean{display:inline-block;width:.82em;height:.82em;vertical-align:-.05em;margin:0 .01em}
  .smile{position:absolute;left:.60em;right:2.55em;bottom:-.20em;height:.42em}
  .sub{font-size:44px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;font-family:'Montserrat','IBM Plex Sans Arabic',sans-serif}
</style></head><body>
<div class="beans"></div>
<svg class="swoosh" viewBox="0 0 1000 120" preserveAspectRatio="none"><path d="M0 120 L0 92 C 220 140, 520 30, 1000 4 L1000 120 Z" fill="${WHITE}" fill-opacity=".16"/></svg>
<div class="wrap">
  <div class="word" lang="en">T<svg class="bean" viewBox="0 0 100 100"><g transform="rotate(-28 50 50)"><ellipse cx="50" cy="50" rx="30" ry="44" fill="${BROWN}"/><path d="M50 8 C 32 30, 68 70, 50 92" fill="none" stroke="${WHITE}" stroke-width="7" stroke-linecap="round"/></g></svg>uch&nbsp;Cafe
    <svg class="smile" viewBox="0 0 300 60" preserveAspectRatio="none"><path d="M6 8 C 80 66, 220 66, 294 8" fill="none" stroke="${BROWN}" stroke-width="12" stroke-linecap="round"/></svg>
  </div>
  <div class="sub">Menu · <span lang="ar" dir="rtl">القائمة</span></div>
</div>
</body></html>`;

const browser = await chromium.launch();
try {
  async function shot(html, width, height, file, omitBackground) {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle' });
    await page.evaluate(() => document.fonts?.ready);
    await page.screenshot({
      path: path.join(OUT, file),
      clip: { x: 0, y: 0, width, height },
      omitBackground: Boolean(omitBackground),
      type: 'png',
    });
    await page.close();
    console.log('wrote', path.relative(root, path.join(OUT, file)));
  }
  await shot(markPage(192), 192, 192, 'icon-192.png', true);
  await shot(markPage(512), 512, 512, 'icon-512.png', true);
  await shot(maskablePage(512), 512, 512, 'icon-512-maskable.png', false);
  await shot(markPage(180), 180, 180, 'apple-icon-180.png', true);
  await shot(ogPage, 1200, 630, 'og-1200x630.png', false);
} finally {
  await browser.close();
}
console.log('wrote', path.relative(root, path.join(OUT, 'favicon.svg')));
