#!/usr/bin/env node
/**
 * Render the mobile app's launcher + notification art with Playwright's
 * bundled Chromium — the route apps/operator-shell/scripts/make-icon.mjs and
 * packages/ui/scripts/render-cafe-icons.mjs already take, so the brand files
 * are the only art the repo carries by hand and the PNGs are derived.
 *
 *   pnpm --filter @touch/mobile icons
 *
 * Outputs (apps/mobile/assets/):
 *   icon.png                     1024x1024 opaque   app.config.ts `icon` (iOS + Android fallback)
 *   adaptive-icon.png            1024x1024 alpha    android.adaptiveIcon.foregroundImage
 *   adaptive-icon-monochrome.png 1024x1024 alpha    android.adaptiveIcon.monochromeImage
 *   notification-icon.png          96x96   alpha    expo-notifications plugin `icon`
 *
 * The launcher icons are the full-colour Touch Padel lockup
 * (docs/brand/touch_padel_logo_transparent.png) on white — owner decision
 * 2026-09-12, replacing the padel-ball placeholder. The notification glyph stays
 * the ball (brand/notification.svg): a wordmark is illegible at 24 dp.
 * The splash image is assets/logo-white.png, not rendered here.
 *
 * Icons are native — an OTA update does not carry them; the next EAS build does.
 *
 * `playwright` resolves from the repo root (the e2e devDependency); run
 * `pnpm e2e:install` once if Chromium is missing.
 */
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

const here = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.resolve(here, '..', 'assets');
const BRAND = path.join(ASSETS, 'brand');
const LOGO = path.resolve(here, '..', '..', '..', 'docs', 'brand', 'touch_padel_logo_transparent.png');

const dataUri = async (file, mime) =>
  `data:${mime};base64,${(await fs.readFile(file)).toString('base64')}`;

// Logo width as a share of the canvas. The iOS icon keeps a margin clear of
// the squircle mask. The adaptive layers keep the lockup's diagonal inside
// Android's safe circle (66 dp of 108 dp ≈ 61 % of the canvas), so every
// launcher mask keeps the whole mark.
const ICON_LOGO_WIDTH = 0.84;
const ADAPTIVE_LOGO_WIDTH = 0.56;

/** [output png, size, html body background, <img> markup] */
const logoJob = (out, background, width, filter = 'none') => async () => {
  const src = await dataUri(LOGO, 'image/png');
  return [out, 1024, background,
    `<img src="${src}" style="width:${Math.round(1024 * width)}px;filter:${filter}">`];
};
const svgJob = (svg, out, size) => async () => {
  const src = await dataUri(path.join(BRAND, svg), 'image/svg+xml');
  return [out, size, 'transparent', `<img src="${src}" style="width:${size}px;height:${size}px">`];
};

const JOBS = [
  logoJob('icon.png', '#FFFFFF', ICON_LOGO_WIDTH),
  logoJob('adaptive-icon.png', 'transparent', ADAPTIVE_LOGO_WIDTH),
  logoJob('adaptive-icon-monochrome.png', 'transparent', ADAPTIVE_LOGO_WIDTH, 'brightness(0) invert(1)'),
  svgJob('notification.svg', 'notification-icon.png', 96),
];

const page = (size, background, img) => `<!doctype html><html><head><style>
  html,body{margin:0;background:${background}}
  body{width:${size}px;height:${size}px;overflow:hidden;display:flex;align-items:center;justify-content:center}
  img{display:block}
</style></head><body>${img}</body></html>`;

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error('Chromium is not installed for Playwright: run `pnpm e2e:install` first.');
  throw error;
}
try {
  for (const job of JOBS) {
    const [out, size, background, img] = await job();
    const transparent = background === 'transparent';
    const tab = await browser.newPage({ viewport: { width: size, height: size }, deviceScaleFactor: 1 });
    await tab.setContent(page(size, background, img), { waitUntil: 'networkidle' });
    await tab.screenshot({
      path: path.join(ASSETS, out),
      clip: { x: 0, y: 0, width: size, height: size },
      omitBackground: transparent,
      type: 'png',
    });
    await tab.close();
    console.log('wrote', path.relative(process.cwd(), path.join(ASSETS, out)));
  }
} finally {
  await browser.close();
}
