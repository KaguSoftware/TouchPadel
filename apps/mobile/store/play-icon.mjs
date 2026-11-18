/**
 * Google Play's hi-res icon: 512×512 PNG, scaled from the app icon (assets/icon.png, 1024²),
 * full square (Play applies its own mask and shadow).
 *
 *   node store/play-icon.mjs
 *
 * Output: store/out/play-icon-512.png
 */
import { chromium } from 'playwright';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const icon = pathToFileURL(path.resolve(root, 'assets', 'icon.png')).href;
const outDir = path.resolve(root, 'store', 'out');
fs.mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
// A file: page, not setContent's about:blank, which may not load a file: image.
const tmp = path.join(outDir, '.play-icon.html');
fs.writeFileSync(tmp, `<html><body style="margin:0;width:512px;height:512px;overflow:hidden"><img src="${icon}" style="width:512px;height:512px;display:block"></body></html>`);
await page.goto(pathToFileURL(tmp).href, { waitUntil: 'load' });
fs.unlinkSync(tmp);
await page.waitForFunction(() => document.images[0]?.complete && document.images[0].naturalWidth > 0);
const outFile = path.join(outDir, 'play-icon-512.png');
await page.screenshot({ path: outFile });
await browser.close();
console.log('wrote', outFile);
