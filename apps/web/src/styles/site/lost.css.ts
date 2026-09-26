/**
 * The 404 ("Out of bounds": the ball has landed outside the court's lines) and the error
 * boundary ("This page did not load."). Both are one screen: the headline, one plain
 * sentence and the ways back.
 *
 * Two 404s share these rules. An unknown address (`[locale]/[...rest]`) gets the full site
 * shell and the site sheet. Every OTHER `notFound()` in the segment falls back to
 * `[locale]/not-found.tsx`, and Next serialises that component into the RSC payload of
 * every route in the segment, the café menu's included, so it is kept as small as the
 * error boundary: `siteLostCss` plus `siteLostFrameCss` (a bare bar with the lockup and a
 * row of plain links), no site sheet, no client components.
 *
 * `siteLostCss` is also the WHOLE sheet the error boundary ships: that component is a
 * client component inside every route of the segment, so it must not carry the full site
 * sheet into the menu's JavaScript. It therefore depends on nothing but the theme tokens
 * and this module.
 */
export const siteLostCss = `
.tp-lost {
  display: grid;
  align-content: center;
  gap: clamp(1.5rem, 4vw, 2.25rem);
  min-block-size: 78svh;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-block: calc(var(--tp-site-header-h) + 2.5rem) 4rem;
  padding-inline: var(--tp-site-gutter);
  color: var(--tp-fg);
}
.tp-lost--bare { min-block-size: 100svh; padding-block-start: 3rem; background: var(--tp-site-hero-bg); font-family: var(--tp-font-body); }
/* The bare page frame (the error boundary, the fallback 404): its own ground, and the
   document margin the café sheet no longer resets on a page that does not carry it. */
body:has(> .tp-lost-page) { margin: 0; }
/* No page sheet resets these here (the site's and the café's are not on these pages). */
.tp-lost-page, .tp-lost-page *, .tp-lost-page *::before, .tp-lost-page *::after { box-sizing: border-box; }
.tp-lost-page :where(h1, p) { margin: 0; }
.tp-lost__court { inline-size: min(100%, 22rem); block-size: auto; overflow: visible; }
.tp-lost__lines { fill: none; stroke: var(--tp-accent); stroke-width: 3; }
.tp-lost__net { fill: none; stroke: var(--tp-site-green); stroke-width: 4; }
.tp-lost__ball-seam { fill: var(--tp-brand-white); }
.tp-lost__ball-felt { fill: var(--tp-brand-green); }
.tp-lost__trace { fill: none; stroke: var(--tp-site-green); stroke-width: 2.5; stroke-linecap: round; stroke-dasharray: 2 9; }
.tp-lost__copy { display: grid; gap: 1rem; justify-items: start; --tp-fit: 12.4; --tp-cap: 7rem; }
[dir='rtl'] .tp-lost__copy { --tp-fit: 18; }
.tp-lost__title {
  font-family: var(--tp-font-display);
  font-weight: var(--tp-site-fw-display);
  line-height: var(--tp-site-lh-display);
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  color: var(--tp-site-display-1);
  text-wrap: balance;
}
.tp-lost__title--sized { font-size: clamp(2.5rem, 1.5rem + 5vw, 5.5rem); }
[dir='rtl'] .tp-lost__title { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
.tp-lost__body { max-inline-size: 40ch; font-size: var(--tp-site-fs-lg); line-height: 1.5; color: var(--tp-site-ink-2); }
.tp-lost__actions { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-block-start: 0.5rem; }
.tp-lost__btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-block-size: var(--tp-site-touch);
  padding-inline: 1.5rem;
  border: 1.5px solid var(--tp-muted-fg);
  border-radius: var(--tp-site-radius-btn);
  background: transparent;
  color: var(--tp-fg);
  font: inherit;
  font-size: 0.9375rem;
  font-weight: var(--tp-site-fw-label);
  letter-spacing: 0.07em;
  text-transform: uppercase;
  text-decoration: none;
  cursor: pointer;
}
.tp-lost__btn--go { border-color: var(--tp-site-green); background: var(--tp-site-green); color: var(--tp-site-green-ink); }
[dir='rtl'] .tp-lost__btn { text-transform: none; letter-spacing: 0; font-size: 1rem; }
.tp-lost__btn:focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
@media (min-width: 48rem) {
  .tp-lost { grid-template-columns: minmax(0, 0.8fr) minmax(0, 1.2fr); align-items: center; column-gap: clamp(2rem, 6vw, 5rem); }
}
`;

/**
 * The fallback 404's frame (never the error boundary's, which has no bar): a bar with the
 * lockup linking home, then the page, then one row of plain links and the other language.
 * The lockup rules repeat base.css's, because this page carries no site sheet.
 */
export const siteLostFrameCss = `
.tp-lost-page { display: flex; flex-direction: column; min-block-size: 100svh; background: var(--tp-site-hero-bg); color: var(--tp-fg); font-family: var(--tp-font-body); }
.tp-lost-page .tp-lost--bare { flex: 1 0 auto; min-block-size: 0; padding-block: 1.5rem 3rem; }
.tp-lost-page a { color: inherit; }
.tp-lost-page a:focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-lost-bar, .tp-lost-foot { inline-size: 100%; max-inline-size: var(--tp-site-max); margin-inline: auto; padding-inline: var(--tp-site-gutter); }
.tp-lost-bar { display: flex; align-items: center; block-size: var(--tp-site-header-h); }
.tp-lost-bar__home { display: flex; align-items: center; block-size: 2.25rem; border-radius: var(--tp-site-radius-sm); }
.tp-lost-page .tp-lockup { display: block; block-size: 100%; inline-size: auto; aspect-ratio: 72.55 / 26.78; overflow: visible; }
.tp-lost-page .tp-lockup__stop-start { stop-color: var(--tp-brand-green); }
.tp-lost-page .tp-lockup__stop-end { stop-color: var(--tp-site-lockup-swoosh-end); }
.tp-lost-page .tp-lockup__word { fill: var(--tp-site-lockup-ink); }
.tp-lost-page .tp-ball__seam { fill: var(--tp-brand-white); }
.tp-lost-page .tp-ball__felt { fill: var(--tp-brand-green); }
.tp-lost-foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1.25rem; padding-block: 1rem 1.5rem; border-block-start: 1px solid var(--tp-border); font-size: var(--tp-site-fs-sm); }
.tp-lost-foot a { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-site-ink-2); }
`;
