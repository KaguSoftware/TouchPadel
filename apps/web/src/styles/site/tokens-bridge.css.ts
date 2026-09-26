/**
 * Site tokens bridge: the ONLY site module allowed raw values (site-css.test.ts exempts
 * it), because what it paints lies OUTSIDE the `.tp-site` subtree and so cannot read the
 * padel tokens: the document ground behind an overscroll bounce and under a short page.
 *
 * The html and body grounds follow the wrapper's mode through `:has`, so the theme
 * toggle (which only flips `data-mode` on `.tp-site`) repaints the whole canvas, browser
 * scrollbars included, with no script touching <html>. The values are the site tokens'
 * own: night = `--tp-site-page` #172C4F, light = the app ground #F3F5F9.
 */
export const siteTokensBridgeCss = `
html:has(.tp-site[data-mode='night']),
html:has(.tp-site[data-mode='night']) body { background: #172C4F; color-scheme: dark; }
html:has(.tp-site[data-mode='light']),
html:has(.tp-site[data-mode='light']) body { background: #F3F5F9; color-scheme: light; }
html:has(.tp-site) { scroll-padding-block-start: 5rem; }
@media (prefers-reduced-motion: no-preference) {
  html:has(.tp-site) { scroll-behavior: smooth; }
}
`;
