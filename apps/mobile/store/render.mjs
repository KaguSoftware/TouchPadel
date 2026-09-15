/**
 * Render the App Store / Play screenshot set to PNG.
 *
 *   node store/render.mjs                        all locales, iPhone 6.9"
 *   node store/render.mjs --locale ar            just the Arabic set
 *   node store/render.mjs --size play-phone      Google Play phone frames
 *   node store/render.mjs --frame 1-book         one frame, for iterating
 *   node store/render.mjs --html                 dump the HTML and stop
 *
 * Output: store/out/<size>/<locale>/<slug>.png at exactly the pixel dimensions
 * App Store Connect expects — no resampling anywhere in the pipeline, because
 * an upload that is one pixel off is rejected at the door.
 *
 * Playwright comes from the repo root (the e2e workspace already depends on
 * it); this file adds no dependency of its own.
 */
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { LOCALES, SIZES } from './frames.mjs';
import { posterHtml } from './template.mjs';

const HERE = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const OUT = path.join(HERE, 'out');
const CAPTURES = path.join(HERE, 'capture');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? fallback : (process.argv[i + 1] ?? true);
}
const has = (name) => process.argv.includes(`--${name}`);

/**
 * A real device capture wins over the recreation whenever one exists.
 * capture/<locale>/<slug>.png — see capture/README.md.
 */
async function captureFor(locale, slug) {
  const p = path.join(CAPTURES, locale, `${slug}.png`);
  try {
    await fs.access(p);
    return pathToFileURL(p).href;
  } catch {
    return null;
  }
}

async function main() {
  const sizeKey = String(arg('size', 'iphone-6.9'));
  const size = SIZES[sizeKey];
  if (!size) {
    console.error(`Unknown --size ${sizeKey}. Known: ${Object.keys(SIZES).join(', ')}`);
    process.exit(1);
  }

  const onlyLocale = arg('locale');
  const onlyFrame = arg('frame');
  const locales = onlyLocale ? [String(onlyLocale)] : Object.keys(LOCALES);

  const browser = await chromium.launch();
  let written = 0;
  const usedCaptures = [];

  for (const locale of locales) {
    const conf = LOCALES[locale];
    if (!conf) {
      console.error(`Unknown --locale ${locale}. Known: ${Object.keys(LOCALES).join(', ')}`);
      process.exit(1);
    }

    const dir = path.join(OUT, sizeKey, locale);
    await fs.mkdir(dir, { recursive: true });

    // deviceScaleFactor 1 with a viewport already at the target pixel size: the
    // page IS the screenshot, so nothing is scaled up or down on the way out.
    const page = await browser.newPage({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 1,
    });

    for (const frame of conf.frames) {
      if (onlyFrame && frame.slug !== onlyFrame) continue;

      const capture = await captureFor(locale, frame.slug);
      if (capture) usedCaptures.push(`${locale}/${frame.slug}`);

      const html = posterHtml({
        size,
        locale,
        dir: conf.dir,
        t: conf.t,
        frame,
        capture,
      });

      if (has('html')) {
        const p = path.join(dir, `${frame.slug}.html`);
        await fs.writeFile(p, html, 'utf8');
        console.log(`  html  ${path.relative(HERE, p)}`);
        continue;
      }

      // Written to disk and navigated to, NOT page.setContent: a setContent page
      // has an about:blank origin, and Chromium refuses to load file:// fonts,
      // logos and captures into it — silently, so the poster still renders and
      // just quietly loses its wordmark. Navigating to a real file:// URL puts
      // the document on the same origin as the assets it references.
      const scratch = path.join(dir, `.${frame.slug}.render.html`);
      await fs.writeFile(scratch, html, 'utf8');
      await page.goto(pathToFileURL(scratch).href, { waitUntil: 'load' });
      // Webfonts are font-display:block; without this the first frame can paint
      // the fallback face and every headline ships in the wrong typeface.
      await page.evaluate(() => document.fonts.ready);

      const file = path.join(dir, `${frame.slug}.png`);
      await page.screenshot({ path: file, type: 'png' });
      await fs.rm(scratch, { force: true });
      written += 1;
      console.log(`  ✓ ${sizeKey}/${locale}/${frame.slug}.png`);
    }

    await page.close();
  }

  await browser.close();

  if (!has('html')) {
    console.log(`\n${written} frame(s) → ${path.relative(process.cwd(), OUT)}/${sizeKey}`);
    if (usedCaptures.length) {
      console.log(`Real device captures used: ${usedCaptures.join(', ')}`);
    } else {
      console.log(
        'All frames used the HTML recreations. Drop real device captures into\n' +
          'store/capture/<locale>/<slug>.png to shoot the actual binary instead —\n' +
          'see store/capture/README.md.',
      );
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
