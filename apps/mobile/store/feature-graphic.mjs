/**
 * Google Play feature graphic: 1024x500, flat (no device frame — Play policy
 * rejects screenshots/UI chrome here), brand navy ground + wordmark.
 *
 * Usage: node store/feature-graphic.mjs [--locale en|ar]
 * Output: store/out/play-feature-graphic/<locale>.png
 */
import { chromium } from 'playwright';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { brand } from './tokens.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function fileUrl(...parts) {
  return 'file://' + path.resolve(root, ...parts).replace(/ /g, '%20');
}

const FONT_DIR = ['packages', '..', 'packages', 'ui', 'fonts', 'lama', 'woff2'];
function fontFaces() {
  const dir = path.resolve(root, '..', '..', 'packages', 'ui', 'fonts', 'lama', 'woff2');
  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.woff2'));
  return files
    .map((file) => {
      const weight = /bold/i.test(file) ? 800 : /medium/i.test(file) ? 600 : 400;
      return `@font-face{font-family:'Lama Sans';src:url('file://${path.resolve(dir, file).replace(/ /g, '%20')}') format('woff2');font-weight:${weight};font-style:normal;font-display:block;}`;
    })
    .join('\n');
}

const COPY = {
  en: { tag: 'Book a padel court in seconds' },
  ar: { tag: 'احجز ملعب البادل في ثوانٍ' },
};

function html(locale) {
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  const logo = fileUrl('assets', 'logo-white.png');
  const { tag } = COPY[locale];
  return `<!doctype html><html dir="${dir}"><head><meta charset="utf-8"><style>
${fontFaces()}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1024px;height:500px;overflow:hidden}
body{
  font-family:'Lama Sans',system-ui,sans-serif;
  background:linear-gradient(135deg, ${brand.navy} 0%, ${brand.navyCard} 100%);
  display:flex;flex-direction:column;align-items:center;justify-content:center;
  gap:28px;
}
.logo{height:132px;width:auto}
.tag{color:${brand.navyText};font-size:34px;font-weight:600;letter-spacing:0.01em}
.dot{color:${brand.green}}
</style></head><body>
  <img class="logo" src="${logo}" />
  <div class="tag">${tag}<span class="dot">.</span></div>
</body></html>`;
}

async function render(locale) {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1024, height: 500 } });
  const tmpHtml = path.resolve(root, 'store', 'out', `.feature-graphic-${locale}.html`);
  fs.writeFileSync(tmpHtml, html(locale));
  await page.goto('file://' + tmpHtml, { waitUntil: 'networkidle' });
  await page.evaluate(() => document.fonts.ready);
  const outDir = path.resolve(root, 'store', 'out', 'play-feature-graphic');
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${locale}.png`);
  await page.screenshot({ path: outFile });
  await browser.close();
  fs.unlinkSync(tmpHtml);
  console.log('wrote', outFile);
}

const localeArg = process.argv.includes('--locale')
  ? process.argv[process.argv.indexOf('--locale') + 1]
  : null;
const locales = localeArg ? [localeArg] : ['en', 'ar'];

for (const locale of locales) {
  await render(locale);
}
