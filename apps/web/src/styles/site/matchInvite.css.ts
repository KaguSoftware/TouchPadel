/**
 * The open-match invite page (`app/[locale]/m/[token]/page.tsx`): the lockup bar, the
 * "Open match" eyebrow, one heading (the day and time, or the state), the match's lines,
 * the big Open in the app button and the quiet way out, then a foot with Support.
 *
 * Like the payment return page (payReturn.css.ts) it ships WITHOUT the site sheet: the
 * link is opened from WhatsApp, often in an in-app browser, and the visitor should not
 * download the landing page's whole stylesheet to read four lines. It depends on nothing
 * but the theme tokens (the `data-theme="padel"` subtree) and `siteTokensBridgeCss`.
 *
 * The lockup rules repeat base.css's, as the payment return page's do. Guarded with the
 * other site modules by site-css.test.ts: logical properties only, colours only through
 * `var(--tp-*)`, a reduced-motion block because the button fades.
 */
export const siteMatchInviteCss = `
.tp-minv { display: flex; flex-direction: column; min-block-size: 100svh; background: var(--tp-site-hero-bg); color: var(--tp-fg); font-family: var(--tp-font-body); }
.tp-minv, .tp-minv *, .tp-minv *::before, .tp-minv *::after { box-sizing: border-box; }
.tp-minv :where(h1, p, ul) { margin: 0; }
.tp-minv :where(a):focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-minv__bar, .tp-minv__foot { inline-size: 100%; max-inline-size: var(--tp-site-max); margin-inline: auto; padding-inline: var(--tp-site-gutter); }
.tp-minv__bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; block-size: var(--tp-site-header-h); }
.tp-minv__home { display: flex; align-items: center; block-size: 2.25rem; border-radius: var(--tp-site-radius-sm); }
.tp-minv .tp-lockup { display: block; block-size: 100%; inline-size: auto; aspect-ratio: 72.55 / 26.78; overflow: visible; }
.tp-minv .tp-lockup__stop-start { stop-color: var(--tp-brand-green); }
.tp-minv .tp-lockup__stop-end { stop-color: var(--tp-site-lockup-swoosh-end); }
.tp-minv .tp-lockup__word { fill: var(--tp-site-lockup-ink); }
.tp-minv .tp-ball__seam { fill: var(--tp-brand-white); }
.tp-minv .tp-ball__felt { fill: var(--tp-brand-green); }
.tp-minv__sr { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tp-minv__lang { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); padding-inline: 0.75rem; border-radius: var(--tp-site-radius-pill); color: var(--tp-site-ink-2); font-size: var(--tp-site-fs-sm); font-weight: var(--tp-site-fw-label); text-decoration: none; }
.tp-minv__main { flex: 1 0 auto; display: grid; align-content: center; justify-items: start; gap: 1rem; inline-size: 100%; max-inline-size: 36rem; margin-inline: auto; padding-block: 2rem 4rem; padding-inline: var(--tp-site-gutter); }
.tp-minv__eyebrow { color: var(--tp-site-green-text); font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; }
[dir='rtl'] .tp-minv__eyebrow { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-minv__title { font-size: var(--tp-site-fs-xl); font-weight: var(--tp-site-fw-label); line-height: 1.2; color: var(--tp-site-display-1); text-wrap: balance; }
[dir='rtl'] .tp-minv__title { line-height: var(--tp-site-lh-display-ar); }
.tp-minv__facts { display: grid; gap: 0.375rem; padding: 0; list-style: none; font-size: var(--tp-site-fs-md); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-minv__status { font-size: var(--tp-site-fs-md); font-weight: 700; color: var(--tp-fg); }
.tp-minv__note { max-inline-size: 40ch; font-size: var(--tp-site-fs-sm); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-minv__open {
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
  .tp-minv__open:hover { background: var(--tp-site-green-hover); }
}
.tp-minv__get { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-fg); font-size: var(--tp-site-fs-sm); font-weight: 700; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.25em; }
.tp-minv__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1.25rem; padding-block: 0.5rem 1rem; border-block-start: 1px solid var(--tp-border); font-size: var(--tp-site-fs-sm); }
.tp-minv__foot a { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-site-ink-2); }
@media (prefers-reduced-motion: reduce) {
  .tp-minv__open { transition: none; }
}
`;
