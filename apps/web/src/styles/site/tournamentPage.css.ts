/**
 * The tournament page (`app/[locale]/events/[id]/page.tsx`, T-8; build contracts §1.11): the
 * lockup bar, the cancelled notice, then the app's ticket (status and format pills, the name, date
 * / time / branch / prize cells, the fee and places line, the fill bar) with the app buttons under
 * it on a wide screen, beside a Standings | Schedule switch (a round per card, a match per row),
 * all one column on a phone (the buttons last), and the site footer (footerKit.css.ts). Owner
 * pick "D" of the 2026-11-01 options.
 *
 * Rendered inside `SiteShell`, so the site's own header, footer and tokens come from the site sheet
 * and this module holds only the page's content (it pads its first block back under the sticky
 * header). Guarded with the other site modules by site-css.test.ts: logical properties only,
 * colours only through `var(--tp-*)`, a reduced-motion block because the button and the switch
 * fade. The standings table scrolls inside its own box on a narrow phone, so the page itself
 * never scrolls sideways.
 */
export const siteTournamentPageCss = `
.tp-tpage, .tp-tpage *, .tp-tpage *::before, .tp-tpage *::after { box-sizing: border-box; }
.tp-tpage :where(h1, h2, h3, p, ul, ol, dl, dd) { margin: 0; }
.tp-tpage :where(ul, ol) { padding: 0; list-style: none; }
.tp-tpage :where(a):focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-tpage__sr { position: absolute; inline-size: 1px; block-size: 1px; margin: -1px; padding: 0; border: 0; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tp-tpage__main { flex: 1 0 auto; display: grid; align-content: start; gap: 1.25rem; inline-size: 100%; max-inline-size: 66rem; margin-inline: auto; padding-block: calc(var(--tp-site-header-h) + 2rem) 4rem; padding-inline: var(--tp-site-gutter); }
.tp-tpage__head { display: grid; gap: 0.5rem; }
.tp-tpage__eyebrow { color: var(--tp-site-green-text); font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; }
[dir='rtl'] .tp-tpage__eyebrow { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-tpage__notice { padding-block: 0.875rem; padding-inline: 1rem; border-radius: var(--tp-site-radius-md); border: 1.5px solid var(--tp-border); background: var(--tp-site-tint); font-weight: var(--tp-site-fw-label); color: var(--tp-fg); }
/* Wide: the ticket and the buttons in a left column, the switch on the right. Narrow: one column, ticket, body, buttons. */
.tp-tpage__split { display: grid; grid-template-columns: minmax(0, 21.25rem) minmax(0, 1fr); grid-template-areas: 'side body' 'ctas body'; grid-template-rows: auto 1fr; gap: 1rem 1.5rem; align-items: start; }
.tp-tpage__side { grid-area: side; }
.tp-tpage__body { grid-area: body; display: grid; gap: 1rem; min-inline-size: 0; }
.tp-tpage__ctas { grid-area: ctas; display: grid; gap: 0.125rem; }
.tp-tpage__ticket { display: grid; gap: 0.875rem; padding: 1.25rem; border-radius: 1.25rem; background: var(--tp-site-navy-card); color: var(--tp-brand-white); }
.tp-tpage__ticket-top { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
.tp-tpage__pill { display: inline-block; padding-block: 0.25rem; padding-inline: 0.625rem; border-radius: var(--tp-site-radius-pill); background: var(--tp-site-green); color: var(--tp-site-green-ink); font-size: var(--tp-site-fs-xs); font-weight: 600; }
.tp-tpage__pill[data-status='cancelled'], .tp-tpage__pill[data-status='finished'], .tp-tpage__pill--ghost { background: color-mix(in srgb, var(--tp-brand-white) 14%, transparent); color: var(--tp-brand-white); }
.tp-tpage__ticket-head { display: grid; gap: 0.25rem; }
.tp-tpage__title { font-family: var(--tp-font-display); font-size: 1.6rem; font-weight: 800; line-height: 1.15; color: var(--tp-brand-white); text-wrap: balance; }
[dir='rtl'] .tp-tpage__title { line-height: var(--tp-site-lh-display-ar); }
.tp-tpage__sub { color: var(--tp-site-block-muted); font-size: var(--tp-site-fs-sm); }
.tp-tpage__cells { display: grid; grid-template-columns: repeat(auto-fit, minmax(6.875rem, 1fr)); gap: 0.625rem; }
.tp-tpage__cell { padding-block: 0.625rem; padding-inline: 0.75rem; border-radius: 0.75rem; background: color-mix(in srgb, var(--tp-brand-white) 8%, transparent); min-inline-size: 0; }
.tp-tpage__cell dt, .tp-tpage__perf dt { color: var(--tp-site-block-muted); font-size: 0.7rem; letter-spacing: 0.06em; text-transform: uppercase; }
[dir='rtl'] .tp-tpage__cell dt, [dir='rtl'] .tp-tpage__perf dt { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-xs); }
.tp-tpage__cell dd { font-family: var(--tp-font-display); font-size: 1rem; font-weight: 700; overflow-wrap: anywhere; }
.tp-tpage__perf { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; flex-wrap: wrap; padding-block-start: 0.75rem; border-block-start: 2px dashed color-mix(in srgb, var(--tp-brand-white) 22%, transparent); }
.tp-tpage__perf dd { font-family: var(--tp-font-display); font-size: 1.3rem; font-weight: 800; }
.tp-tpage__perf-end { text-align: end; }
.tp-tpage__fill { display: grid; gap: 0.375rem; }
.tp-tpage__meter { block-size: 0.5rem; border-radius: var(--tp-site-radius-pill); background: color-mix(in srgb, var(--tp-brand-white) 16%, transparent); overflow: hidden; }
.tp-tpage__meter i { display: block; block-size: 100%; border-radius: var(--tp-site-radius-pill); background: var(--tp-site-green); }
.tp-tpage__fill-note { color: var(--tp-site-block-muted); font-size: var(--tp-site-fs-xs); }
.tp-tpage__open {
  display: flex;
  align-items: center;
  justify-content: center;
  inline-size: 100%;
  min-block-size: 3.25rem;
  padding-inline: 1.5rem;
  border-radius: var(--tp-site-radius-btn);
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-family: var(--tp-font-display);
  font-size: 1.05rem;
  font-weight: 700;
  text-decoration: none;
  transition: background-color var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
@media (hover: hover) {
  .tp-tpage__open:hover { background: var(--tp-site-green-hover); }
}
.tp-tpage__get { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-site-ink-2); font-size: var(--tp-site-fs-sm); text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.25em; }
.tp-tpage__get { justify-self: center; justify-content: center; padding-inline: 0.75rem; }
.tp-tpage__live { font-size: var(--tp-site-fs-sm); color: var(--tp-site-ink-2); }
.tp-tpage__tabs-wrap { display: grid; gap: 1rem; min-inline-size: 0; }
/* A white track in both modes, so it reads as its own component on the page ground (as the empty card does). */
.tp-tpage__tabs { position: relative; display: flex; gap: 0.25rem; padding: 0.25rem; border-radius: 0.75rem; border: 1px solid color-mix(in srgb, var(--tp-site-block) 35%, var(--tp-brand-white)); background: var(--tp-brand-white); }
/* Night: the navy of the ticket, light labels and a soft green outline. */
.tp-site[data-mode='night'] .tp-tpage__tabs { border-color: color-mix(in srgb, var(--tp-site-green) 45%, transparent); background: var(--tp-site-navy-card); }
.tp-site[data-mode='night'] .tp-tpage__tab { color: var(--tp-site-block-muted); }
@media (hover: hover) {
  .tp-site[data-mode='night'] .tp-tpage__tab[aria-selected='false']:hover { background: color-mix(in srgb, var(--tp-brand-white) 10%, transparent); }
}
.tp-site[data-mode='night'] .tp-tpage__tab[aria-selected='true'] { color: var(--tp-brand-white); }
.tp-tpage__tab { position: relative; z-index: 1; flex: 1; appearance: none; min-block-size: 2.75rem; padding: 0.625rem; border: 0; border-radius: 0.5625rem; background: transparent; color: var(--tp-site-navy); font-family: var(--tp-font-body); font-size: 0.9rem; font-weight: 600; line-height: 1.2; cursor: pointer; transition: background-color var(--tp-site-dur-fast) var(--tp-site-ease-out), color var(--tp-site-dur-fast) var(--tp-site-ease-out); }
@media (hover: hover) {
  .tp-tpage__tab[aria-selected='false']:hover { background: var(--tp-site-tint); }
}
.tp-tpage__tab[aria-selected='true'] { color: var(--tp-brand-white); }
/* The blue thumb: one box under the segments, slid to the chosen one (the other way round in Arabic). */
.tp-tpage__thumb { position: absolute; inset-block: 0.25rem; inset-inline-start: 0.25rem; inline-size: calc((100% - 0.5rem - (var(--tp-tab-n) - 1) * 0.25rem) / var(--tp-tab-n)); border-radius: 0.5625rem; background: var(--tp-site-block); transform: translateX(calc(var(--tp-tab-i) * (100% + 0.25rem))); transition: transform var(--tp-site-dur-base) var(--tp-site-ease-out); }
[dir='rtl'] .tp-tpage__thumb { transform: translateX(calc(var(--tp-tab-i) * -1 * (100% + 0.25rem))); }
.tp-tpage :where(button):focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 2px; }
.tp-tpage__panel { min-inline-size: 0; }
.tp-tpage__panel[hidden] { display: none; }
.tp-tpage__section { display: grid; gap: 0.75rem; min-inline-size: 0; }
.tp-tpage__h2 { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-tpage__h2 { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
/* Nothing to show yet: a white card with its line centred, both ways; the ticket's navy in night. */
.tp-tpage__empty { display: flex; align-items: center; justify-content: center; min-block-size: 12rem; padding: 1.5rem; border-radius: 1rem; background: var(--tp-brand-white); color: var(--tp-site-navy); font-size: var(--tp-site-fs-sm); font-weight: 600; text-align: center; text-wrap: balance; }
.tp-site[data-mode='night'] .tp-tpage__empty { background: var(--tp-site-navy-card); color: var(--tp-brand-white); }
.tp-tpage__rounds { display: grid; gap: 0.75rem; }
.tp-tpage__round { display: grid; gap: 0.625rem; padding: 0.875rem; border: 1px solid var(--tp-border); border-radius: 1rem; }
.tp-tpage__round-title { font-family: var(--tp-font-display); font-size: 1rem; font-weight: 700; color: var(--tp-fg); }
.tp-tpage__round > ul { display: grid; gap: 0.625rem; }
.tp-tpage__match {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  grid-template-areas: 'court score' 'a score' 'b score';
  gap: 0.125rem 0.75rem;
  align-items: center;
  padding-block-start: 0.625rem;
  border-block-start: 1px solid var(--tp-border);
}
.tp-tpage__match:first-child { padding-block-start: 0; border-block-start: 0; }
.tp-tpage__court { grid-area: court; font-size: 0.72rem; font-weight: 600; color: var(--tp-muted-fg); }
.tp-tpage__team--a { grid-area: a; }
.tp-tpage__team--b { grid-area: b; }
.tp-tpage__team { font-size: 0.93rem; font-weight: 600; color: var(--tp-fg); }
.tp-tpage__vs { font-weight: 400; color: var(--tp-muted-fg); }
.tp-tpage__score { grid-area: score; padding-block: 0.375rem; padding-inline: 0.75rem; border-radius: 0.625rem; background: var(--tp-site-tint); font-family: var(--tp-font-display); font-size: 1.15rem; font-weight: 800; color: var(--tp-fg); }
.tp-tpage__score[data-played='false'] { font-family: inherit; font-size: 0.75rem; font-weight: 500; color: var(--tp-muted-fg); }
.tp-tpage__sitout { font-size: 0.85rem; color: var(--tp-muted-fg); }
.tp-tpage__table-box { inline-size: 100%; overflow-x: auto; border: 1px solid var(--tp-border); border-radius: 1rem; }
.tp-tpage__table { inline-size: 100%; border-collapse: collapse; font-size: 0.95rem; }
.tp-tpage__table :where(th, td) { padding-block: 0.75rem; padding-inline: 0.875rem; border-block-start: 1px solid var(--tp-border); text-align: start; }
.tp-tpage__table thead :where(th) { border-block-start: 0; background: var(--tp-site-tint); font-size: 0.72rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-tpage__table thead :where(th) { letter-spacing: 0; text-transform: none; }
.tp-tpage__table td { color: var(--tp-fg); }
.tp-tpage__table :where(.tp-tpage__num) { text-align: end; }
.tp-tpage__badge { display: inline-grid; place-items: center; inline-size: 1.625rem; block-size: 1.625rem; border-radius: 50%; background: var(--tp-site-tint); font-family: var(--tp-font-display); font-size: 0.8rem; font-weight: 700; }
.tp-tpage__badge[data-first='true'] { background: var(--tp-site-green); color: var(--tp-site-green-ink); }
/* Night only: the standings box and the round cards take the switch's navy and soft green outline. */
.tp-site[data-mode='night'] .tp-tpage__table-box, .tp-site[data-mode='night'] .tp-tpage__round { background: var(--tp-site-navy-card); border-color: color-mix(in srgb, var(--tp-site-green) 45%, transparent); }
.tp-site[data-mode='night'] .tp-tpage__table thead :where(th) { background: color-mix(in srgb, var(--tp-brand-white) 8%, transparent); }
@media (max-width: 760px) {
  .tp-tpage__split { grid-template-columns: minmax(0, 1fr); grid-template-areas: 'side' 'body' 'ctas'; grid-template-rows: auto; }
  /* Phone, as the coach link's dock: the buttons stick to the foot of the screen so the app is one tap away at any scroll, and rest above the footer where the page ends. */
  .tp-tpage__ctas {
    position: sticky;
    inset-block-end: 0;
    z-index: var(--tp-site-z-raised);
    justify-items: stretch;
    margin-inline: calc(-1 * var(--tp-site-gutter));
    margin-block-start: 1rem;
    padding: 0.75rem var(--tp-site-gutter) calc(0.75rem + env(safe-area-inset-bottom, 0px));
    border-block-start: 1px solid var(--tp-border);
    background: var(--tp-site-hero-bg);
  }
  .tp-tpage__ctas .tp-tpage__get { justify-self: center; }
}
@media (prefers-reduced-motion: reduce) {
  .tp-tpage__open, .tp-tpage__tab, .tp-tpage__thumb { transition: none; }
}
`;
