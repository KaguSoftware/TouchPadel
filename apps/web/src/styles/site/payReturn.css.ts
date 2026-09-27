/**
 * The payment return page (`app/[locale]/pay/return/page.tsx`): the lockup bar, one
 * heading, one line, the big Open the app button and the quiet way out, then a foot with
 * Support. It ships WITHOUT the site sheet: a guest who has just paid on a phone, inside
 * the in-app browser, should not download the landing page's whole stylesheet to read two
 * lines. So it depends on nothing but the theme tokens (the `data-theme="padel"` subtree)
 * and `siteTokensBridgeCss`, which paints the canvas behind it in the page's mode.
 *
 * The lockup rules repeat base.css's, as the fallback 404's frame does (lost.css.ts).
 * Guarded with the other site modules by site-css.test.ts: logical properties only,
 * colours only through `var(--tp-*)`, a reduced-motion block because the button fades.
 */
export const sitePayReturnCss = `
.tp-payret { display: flex; flex-direction: column; min-block-size: 100svh; background: var(--tp-site-hero-bg); color: var(--tp-fg); font-family: var(--tp-font-body); }
.tp-payret, .tp-payret *, .tp-payret *::before, .tp-payret *::after { box-sizing: border-box; }
.tp-payret :where(h1, p) { margin: 0; }
.tp-payret :where(a):focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-payret__bar, .tp-payret__foot { inline-size: 100%; max-inline-size: var(--tp-site-max); margin-inline: auto; padding-inline: var(--tp-site-gutter); }
.tp-payret__bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; block-size: var(--tp-site-header-h); }
.tp-payret__home { display: flex; align-items: center; block-size: 2.25rem; border-radius: var(--tp-site-radius-sm); }
.tp-payret .tp-lockup { display: block; block-size: 100%; inline-size: auto; aspect-ratio: 72.55 / 26.78; overflow: visible; }
.tp-payret .tp-lockup__stop-start { stop-color: var(--tp-brand-green); }
.tp-payret .tp-lockup__stop-end { stop-color: var(--tp-site-lockup-swoosh-end); }
.tp-payret .tp-lockup__word { fill: var(--tp-site-lockup-ink); }
.tp-payret .tp-ball__seam { fill: var(--tp-brand-white); }
.tp-payret .tp-ball__felt { fill: var(--tp-brand-green); }
.tp-payret__sr { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tp-payret__lang { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); padding-inline: 0.75rem; border-radius: var(--tp-site-radius-pill); color: var(--tp-site-ink-2); font-size: var(--tp-site-fs-sm); font-weight: var(--tp-site-fw-label); text-decoration: none; }
.tp-payret__main { flex: 1 0 auto; display: grid; align-content: center; justify-items: start; gap: 1rem; inline-size: 100%; max-inline-size: 36rem; margin-inline: auto; padding-block: 2rem 4rem; padding-inline: var(--tp-site-gutter); }
.tp-payret__title { font-size: var(--tp-site-fs-xl); font-weight: var(--tp-site-fw-label); line-height: 1.2; color: var(--tp-site-display-1); text-wrap: balance; }
[dir='rtl'] .tp-payret__title { line-height: var(--tp-site-lh-display-ar); }
.tp-payret__body { max-inline-size: 40ch; font-size: var(--tp-site-fs-md); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-payret__open {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: min(100%, 24rem);
  min-block-size: 3.5rem;
  margin-block-start: 1rem;
  padding-inline: 1.5rem;
  border-radius: var(--tp-site-radius-btn);
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-size: 1.125rem;
  font-weight: var(--tp-site-fw-label);
  text-decoration: none;
  transition: background-color var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
@media (hover: hover) {
  .tp-payret__open:hover { background: var(--tp-site-green-hover); }
}
.tp-payret__get { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-fg); font-size: var(--tp-site-fs-sm); font-weight: 700; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.25em; }
.tp-payret__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1.25rem; padding-block: 0.5rem 1rem; border-block-start: 1px solid var(--tp-border); font-size: var(--tp-site-fs-sm); }
.tp-payret__foot a { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-site-ink-2); }
@media (prefers-reduced-motion: reduce) {
  .tp-payret__open { transition: none; }
}
`;
