/**
 * The tournament page (`app/[locale]/events/[id]/page.tsx`, T-8; build contracts §1.11): the
 * lockup bar, the "Americano · Open to all" eyebrow, one heading (the tournament's name, or the
 * state), the branch and the time, the facts (fee, points, places, prize), the cancelled notice,
 * the app buttons, then the schedule (a round per block, a match per row) and the standings table,
 * and a foot with Support.
 *
 * Like the coach link (coachLink.css.ts) it ships WITHOUT the site sheet: the link is shared on
 * WhatsApp and opened in an in-app browser, often courtside on a phone, and the visitor should
 * not download the landing page's whole stylesheet to read a schedule. It depends on nothing but
 * the theme tokens (the `data-theme="padel"` subtree) and `siteTokensBridgeCss`.
 *
 * The lockup rules repeat base.css's, as the coach link's do. Guarded with the other site modules
 * by site-css.test.ts: logical properties only, colours only through `var(--tp-*)`, a
 * reduced-motion block because the button fades. The standings table scrolls inside its own box
 * on a narrow phone, so the page itself never scrolls sideways.
 */
export const siteTournamentPageCss = `
.tp-tpage { display: flex; flex-direction: column; min-block-size: 100svh; background: var(--tp-site-hero-bg); color: var(--tp-fg); font-family: var(--tp-font-body); }
.tp-tpage, .tp-tpage *, .tp-tpage *::before, .tp-tpage *::after { box-sizing: border-box; }
.tp-tpage :where(h1, h2, h3, p, ul, ol, dl, dd) { margin: 0; }
.tp-tpage :where(ul, ol) { padding: 0; list-style: none; }
.tp-tpage :where(a):focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-tpage__bar, .tp-tpage__foot { inline-size: 100%; max-inline-size: var(--tp-site-max); margin-inline: auto; padding-inline: var(--tp-site-gutter); }
.tp-tpage__bar { display: flex; align-items: center; justify-content: space-between; gap: 1rem; block-size: var(--tp-site-header-h); }
.tp-tpage__home { display: flex; align-items: center; block-size: 2.25rem; border-radius: var(--tp-site-radius-sm); }
.tp-tpage .tp-lockup { display: block; block-size: 100%; inline-size: auto; aspect-ratio: 72.55 / 26.78; overflow: visible; }
.tp-tpage .tp-lockup__stop-start { stop-color: var(--tp-brand-green); }
.tp-tpage .tp-lockup__stop-end { stop-color: var(--tp-site-lockup-swoosh-end); }
.tp-tpage .tp-lockup__word { fill: var(--tp-site-lockup-ink); }
.tp-tpage .tp-ball__seam { fill: var(--tp-brand-white); }
.tp-tpage .tp-ball__felt { fill: var(--tp-brand-green); }
.tp-tpage__sr { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tp-tpage__lang { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); padding-inline: 0.75rem; border-radius: var(--tp-site-radius-pill); color: var(--tp-site-ink-2); font-size: var(--tp-site-fs-sm); font-weight: var(--tp-site-fw-label); text-decoration: none; }
.tp-tpage__main { flex: 1 0 auto; display: grid; align-content: start; gap: 1.25rem; inline-size: 100%; max-inline-size: 48rem; margin-inline: auto; padding-block: 2rem 4rem; padding-inline: var(--tp-site-gutter); }
.tp-tpage__head { display: grid; gap: 0.5rem; }
.tp-tpage__eyebrow { color: var(--tp-site-green-text); font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; }
[dir='rtl'] .tp-tpage__eyebrow { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-tpage__title { font-size: var(--tp-site-fs-xl); font-weight: var(--tp-site-fw-label); line-height: 1.2; color: var(--tp-site-display-1); text-wrap: balance; }
[dir='rtl'] .tp-tpage__title { line-height: var(--tp-site-lh-display-ar); }
.tp-tpage__at { font-size: var(--tp-site-fs-md); font-weight: 700; color: var(--tp-fg); }
.tp-tpage__when { font-size: var(--tp-site-fs-md); color: var(--tp-site-ink-2); }
.tp-tpage__facts { display: grid; gap: 0.25rem 1.5rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 12rem), 1fr)); }
.tp-tpage__fact { display: grid; gap: 0.125rem; padding-block: 0.625rem; border-block-start: 1px solid var(--tp-border); }
.tp-tpage__fact dt { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); color: var(--tp-muted-fg); }
.tp-tpage__fact dd { font-weight: 700; color: var(--tp-fg); }
.tp-tpage__notice { padding-block: 0.875rem; padding-inline: 1rem; border-radius: var(--tp-site-radius-md); border: 1.5px solid var(--tp-border); background: var(--tp-site-tint); font-weight: var(--tp-site-fw-label); color: var(--tp-fg); }
.tp-tpage__ctas { display: grid; justify-items: start; gap: 0.25rem; }
.tp-tpage__open {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: min(100%, 24rem);
  min-block-size: 3.5rem;
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
  .tp-tpage__open:hover { background: var(--tp-site-green-hover); }
}
.tp-tpage__get, .tp-tpage__all { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-fg); font-size: var(--tp-site-fs-sm); font-weight: 700; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.25em; }
.tp-tpage__all { color: var(--tp-site-ink-2); font-weight: var(--tp-site-fw-label); }
.tp-tpage__live { font-size: var(--tp-site-fs-sm); color: var(--tp-site-ink-2); }
.tp-tpage__section { display: grid; gap: 0.75rem; margin-block-start: 1rem; }
.tp-tpage__h2 { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-tpage__h2 { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-tpage__empty { color: var(--tp-site-ink-2); }
.tp-tpage__rounds { display: grid; gap: 1rem; }
.tp-tpage__round { display: grid; gap: 0.25rem; }
.tp-tpage__round-title { font-size: 1.125rem; font-weight: var(--tp-site-fw-label); color: var(--tp-fg); }
.tp-tpage__match {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'court score' 'a score' 'b score';
  gap: 0.125rem 1rem;
  align-items: center;
  padding-block: 0.75rem;
  border-block-start: 1px solid var(--tp-border);
}
.tp-tpage__court { grid-area: court; font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); color: var(--tp-muted-fg); }
.tp-tpage__team--a { grid-area: a; }
.tp-tpage__team--b { grid-area: b; }
.tp-tpage__team { font-weight: 700; color: var(--tp-fg); }
.tp-tpage__vs { font-weight: 400; color: var(--tp-site-ink-2); }
.tp-tpage__score { grid-area: score; font-size: 1.25rem; font-weight: var(--tp-site-fw-label); color: var(--tp-fg); }
.tp-tpage__score[data-played='false'] { font-size: var(--tp-site-fs-sm); font-weight: 400; color: var(--tp-site-ink-2); }
.tp-tpage__sitout { font-size: var(--tp-site-fs-sm); color: var(--tp-site-ink-2); }
.tp-tpage__table-box { inline-size: 100%; overflow-x: auto; }
.tp-tpage__table { inline-size: 100%; border-collapse: collapse; font-size: var(--tp-site-fs-sm); }
.tp-tpage__table :where(th, td) { padding-block: 0.625rem; padding-inline: 0.5rem; border-block-end: 1px solid var(--tp-border); text-align: start; }
.tp-tpage__table th { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); color: var(--tp-muted-fg); }
.tp-tpage__table td { color: var(--tp-fg); }
.tp-tpage__table :where(.tp-tpage__num) { text-align: end; }
.tp-tpage__table .tp-tpage__rank { font-weight: var(--tp-site-fw-label); }
.tp-tpage__foot { display: flex; flex-wrap: wrap; align-items: center; gap: 0.25rem 1.25rem; padding-block: 0.5rem 1rem; border-block-start: 1px solid var(--tp-border); font-size: var(--tp-site-fs-sm); }
.tp-tpage__foot a { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-site-ink-2); }
@media (prefers-reduced-motion: reduce) {
  .tp-tpage__open { transition: none; }
}
`;
