import { cafeCss } from '@/styles/cafe';

/**
 * The café's stylesheet, inlined into the pages that render the café's own UI (the menu
 * at /{locale}/menu and the staff download page) and nowhere else. It used to be inlined
 * by the root layout into EVERY page, so the landing and the legal pages carried about
 * 66 KB of café rules none of their elements used (perf finding P3, 2026-09-24); the
 * site's pages carry their own sheet (`SiteStyles`), and the layout keeps only the theme
 * tokens and the brand faces every page needs.
 *
 * Inline for the reason the layout gives: a phone that has just scanned a table's QR code
 * on venue wifi should not wait for a render-blocking request. It carries the request's
 * CSP nonce like every inline <style> of ours.
 */
export function CafeStyles({ nonce }: { nonce: string | undefined }) {
  return <style nonce={nonce} data-tp-cafe="" dangerouslySetInnerHTML={{ __html: cafeCss }} />;
}
