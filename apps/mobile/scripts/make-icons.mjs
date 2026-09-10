#!/usr/bin/env node
/**
 * Render the mobile app's launcher + notification art from assets/brand/*.svg
 * with Playwright's bundled Chromium — the route apps/operator-shell/scripts/
 * make-icon.mjs and packages/ui/scripts/render-cafe-icons.mjs already take, so
 * the SVGs are the only art the repo carries by hand and the PNGs are derived.
 *
 *   pnpm --filter @touch/mobile icons
 *
 * Outputs (apps/mobile/assets/):
 *   icon.png                     1024x1024 opaque   app.config.ts `icon` (iOS + Android fallback)
 *   adaptive-icon.png            1024x1024 alpha    android.adaptiveIcon.foregroundImage
 *   adaptive-icon-monochrome.png 1024x1024 alpha    android.adaptiveIcon.monochromeImage
 *   notification-icon.png          96x96   alpha    expo-notifications plugin `icon`
 *
 * The splash image is assets/logo-white.png (the wordmark), not rendered here.
 *
 * SWAPPING IN OFFICIAL ART: replace the SVG(s) and re-run, or drop a finished
 * 1024x1024 PNG straight onto assets/icon.png (and the two adaptive layers if
 * the shape changes). Either way the next EAS build picks it up — icons are
 * native, an OTA update does not carry them.
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

/** [source svg, output png, size, transparent] */
const JOBS = [
  ['icon.svg', 'icon.png', 1024, false],
  ['adaptive-foreground.svg', 'adaptive-icon.png', 1024, true],
  ['adaptive-monochrome.svg', 'adaptive-icon-monochrome.png', 1024, true],
  ['notification.svg', 'notification-icon.png', 96, true],
];

const page = (dataUri, size, transparent) => `<!doctype html><html><head><style>
  html,body{margin:0;background:${transparent ? 'transparent' : '#3360AB'}}
  body{width:${size}px;height:${size}px;overflow:hidden}
  img{display:block;width:${size}px;height:${size}px}
</style></head><body><img src="${dataUri}"></body></html>`;

let browser;
try {
  browser = await chromium.launch();
} catch (error) {
  console.error('Chromium is not installed for Playwright: run `pnpm e2e:install` first.');
  throw error;
}
try {
  for (const [src, out, size, transparent] of JOBS) {
    const svg = await fs.readFile(path.join(BRAND, src), 'utf8');
    const dataUri = `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
    const tab = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await tab.setContent(page(dataUri, size, transparent), { waitUntil: 'networkidle' });
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
