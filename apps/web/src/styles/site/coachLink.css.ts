/**
 * The coach link page (`app/[locale]/c/[id]/page.tsx`, docs/design/coaching/guest.md §4.14.3):
 * the lockup bar, the coach's photo (or first letter), the "Padel coach" eyebrow, one heading
 * (the coach's name, or the state), where they teach, the bio, the lesson types they teach, the
 * big Open in the app button and the quiet ways out, then a foot with Support.
 *
 * Like the open-match invite (matchInvite.css.ts) it ships WITHOUT the site sheet: the link is
 * opened from WhatsApp, often in an in-app browser, and the visitor should not download the
 * landing page's whole stylesheet to read one card. It depends on nothing but the theme tokens
 * (the `data-theme="padel"` subtree) and `siteTokensBridgeCss`.
 *
 * The lockup rules repeat base.css's, as the invite's do. Guarded with the other site modules by
 * site-css.test.ts: logical properties only, colours only through `var(--tp-*)`, a reduced-motion
 * block because the button fades.
 */
export const siteCoachLinkCss = `
.tp-clink { display: flex; flex-direction: column; min-block-size: 100svh; background: var(--tp-site-hero-bg); color: var(--tp-fg); font-family: var(--tp-font-body); }
.tp-clink, .tp-clink *, .tp-clink *::before, .tp-clink *::after { box-sizing: border-box; }
.tp-clink :where(h1, h2, p, ul) { margin: 0; }
.tp-clink :where(ul) { padding: 0; list-style: none; }
.tp-clink :where(a):focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-clink__bar, .tp-clink__foot { inline-size: 100%; max-inline-size: var(--tp-site-max); margin-inline: auto; padding-inline: var(--tp-site-gutter); }
.tp-clink__bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; block-size: var(--tp-site-header-h); }
.tp-clink__home { display: flex; align-items: center; block-size: 2.25rem; border-radius: var(--tp-site-radius-sm); }
.tp-clink .tp-lockup { display: block; block-size: 100%; inline-size: auto; aspect-ratio: 72.55 / 26.78; overflow: visible; }
.tp-clink .tp-lockup__stop-start { stop-color: var(--tp-brand-green); }
.tp-clink .tp-lockup__stop-end { stop-color: var(--tp-site-lockup-swoosh-end); }
.tp-clink .tp-lockup__word { fill: var(--tp-site-lockup-ink); }
.tp-clink .tp-ball__seam { fill: var(--tp-brand-white); }
.tp-clink .tp-ball__felt { fill: var(--tp-brand-green); }
.tp-clink__sr { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tp-clink__lang { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); padding-inline: 0.75rem; border-radius: var(--tp-site-radius-pill); color: var(--tp-site-ink-2); font-size: var(--tp-site-fs-sm); font-weight: var(--tp-site-fw-label); text-decoration: none; }
.tp-clink__main { flex: 1 0 auto; display: grid; align-content: center; justify-items: start; gap: 1rem; inline-size: 100%; max-inline-size: 36rem; margin-inline: auto; padding-block: 2rem 4rem; padding-inline: var(--tp-site-gutter); }
.tp-clink__photo {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 8rem;
  block-size: 8rem;
  overflow: clip;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-tint);
}
.tp-clink__photo img { object-fit: cover; }
.tp-clink__photo[data-letter] { font-family: var(--tp-font-display); font-size: 3.5rem; font-weight: var(--tp-site-fw-display); color: var(--tp-site-display-2); }
.tp-clink__eyebrow { color: var(--tp-site-green-text); font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; }
[dir='rtl'] .tp-clink__eyebrow { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-clink__title { font-size: var(--tp-site-fs-xl); font-weight: var(--tp-site-fw-label); line-height: 1.2; color: var(--tp-site-display-1); text-wrap: balance; }
[dir='rtl'] .tp-clink__title { line-height: var(--tp-site-lh-display-ar); }
.tp-clink__at { font-size: var(--tp-site-fs-md); font-weight: 700; color: var(--tp-fg); }
.tp-clink__bio { max-inline-size: 60ch; font-size: var(--tp-site-fs-md); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-clink__types { display: grid; gap: 0.5rem; inline-size: 100%; }
.tp-clink__h2 { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-clink__h2 { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-clink__type { display: grid; gap: 0.125rem; padding-block: 0.75rem; border-block-start: 1px solid var(--tp-border); }
.tp-clink__type-name { font-weight: var(--tp-site-fw-label); color: var(--tp-fg); }
.tp-clink__type-line, .tp-clink__type-price { font-size: var(--tp-site-fs-sm); color: var(--tp-site-ink-2); }
.tp-clink__type-price { font-weight: 700; color: var(--tp-fg); }
.tp-clink__open {
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
  .tp-clink__open:hover { background: var(--tp-site-green-hover); }
}
.tp-clink__get, .tp-clink__all { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-fg); font-size: var(--tp-site-fs-sm); font-weight: 700; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.25em; }
.tp-clink__all { color: var(--tp-site-ink-2); font-weight: var(--tp-site-fw-label); }
.tp-clink__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1.25rem; padding-block: 0.5rem 1rem; border-block-start: 1px solid var(--tp-border); font-size: var(--tp-site-fs-sm); }
.tp-clink__foot a { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-site-ink-2); }
@media (prefers-reduced-motion: reduce) {
  .tp-clink__open { transition: none; }
}
`;
