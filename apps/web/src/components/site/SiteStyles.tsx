import { FONT_BASE } from '@touch/ui/fontFace';
import { courtCss } from '@/features/court3d';
import { siteCss } from '@/styles/site';

/**
 * The site's stylesheet, inlined into THIS page only: the landing, the legal pages and
 * the 404 render it; the café menu does not, so a table guest on venue wifi never
 * downloads a byte of it. It carries the request's CSP nonce like the layout's own
 * `<style>`, and it brings Lama Sans Black (900) forward: every display line on the site
 * is set in it, and the shared layout deliberately preloads only 400/700/800
 * (`PRELOAD_FACES`, fontFace.ts), leaving 900 to "the document that already knows it
 * needs it".
 *
 * The preload is a real `<link>` ELEMENT, which React hoists into the document's <head>
 * with the layout's own preloads. It used to be `preload()` from react-dom, which in a
 * Server Component only reaches the RSC stream as a hint (`:HL[…]`), about 230 KB into
 * the HTML and after </head>, so the headline face was found late, from the CSS (perf
 * finding P2, 2026-09-24).
 */
export function SiteStyles({ nonce }: { nonce: string | undefined }) {
  return (
    <>
      <link
        rel="preload"
        as="font"
        type="font/woff2"
        href={`${FONT_BASE}/LamaSans-Black.woff2`}
        crossOrigin="anonymous"
      />
      <style
        nonce={nonce}
        data-tp-site=""
        dangerouslySetInnerHTML={{ __html: `${siteCss}\n${courtCss}` }}
      />
    </>
  );
}
