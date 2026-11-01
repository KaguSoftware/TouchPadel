/**
 * The coach link page (`app/[locale]/c/[id]/page.tsx`, docs/design/coaching/guest.md §4.14.3):
 * inside the site shell (the site's own header and footer), the coach's photo tile or first
 * letter, the "Padel coach" eyebrow, one heading (the coach's name, or the state), where they
 * teach, the bio, the lesson cards, the big Open in the app button and the quiet ways out.
 *
 * It rides the site sheet for the header and footer and adds only its own layout here. Guarded
 * with the other site modules by site-css.test.ts: logical properties only, colours only through
 * `var(--tp-*)`, a reduced-motion block because the button fades.
 */
export const siteCoachLinkCss = `
.tp-clink { display: flex; flex-direction: column; min-block-size: 70svh; padding-block-start: var(--tp-site-header-h); background: var(--tp-site-hero-bg); color: var(--tp-fg); font-family: var(--tp-font-body); }
.tp-clink, .tp-clink *, .tp-clink *::before, .tp-clink *::after { box-sizing: border-box; }
.tp-clink :where(h1, h2, h3, p, ul) { margin: 0; }
.tp-clink :where(ul) { padding: 0; list-style: none; }
.tp-clink :where(a):focus-visible { outline: 2px solid var(--tp-site-ring); outline-offset: 3px; }
.tp-clink__main { flex: 1 0 auto; display: grid; align-content: center; justify-items: start; gap: 1rem; inline-size: 100%; max-inline-size: 36rem; margin-inline: auto; padding-block: 2rem 4rem; padding-inline: var(--tp-site-gutter); }
.tp-clink__eyebrow { color: var(--tp-site-green-text); font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; }
[dir='rtl'] .tp-clink__eyebrow { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-clink__title { font-size: var(--tp-site-fs-xl); font-weight: var(--tp-site-fw-label); line-height: 1.2; color: var(--tp-site-display-1); text-wrap: balance; }
[dir='rtl'] .tp-clink__title { line-height: var(--tp-site-lh-display-ar); }
.tp-clink__at { margin-block-start: -0.5rem; font-size: 0.9rem; font-weight: 600; line-height: 1.3; color: var(--tp-muted-fg); }
.tp-clink__bio { max-inline-size: 60ch; font-size: var(--tp-site-fs-md); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-clink__types { display: grid; gap: 0.75rem; inline-size: 100%; }
.tp-clink__h2 { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tp-clink__group, .tp-clink__pair { display: grid; gap: 0.625rem; }
.tp-clink__pair > [data-slot='a'] { order: 1; }
.tp-clink__pair > ul[data-slot='a'] { order: 2; }
.tp-clink__pair > [data-slot='b'] { order: 3; }
.tp-clink__pair > ul[data-slot='b'] { order: 4; }
.tp-clink__pair > h3[data-slot='b'] { margin-block-start: 0.875rem; }
.tp-clink__kind-label { margin: 0; font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-clink__kind-label { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-clink__types { gap: 1.5rem; }
.tp-clink__profile, .tp-clink__sheet { display: grid; justify-items: start; gap: 0.875rem; }
.tp-clink__dock { display: grid; justify-items: start; gap: 1.25rem; inline-size: 100%; }
.tp-clink__ways { display: flex; flex-wrap: wrap; justify-content: center; gap: 0.25rem 3.5rem; inline-size: 100%; }
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
.tp-clink__get { display: inline-flex; align-items: center; min-block-size: var(--tp-site-touch); color: var(--tp-fg); font-size: var(--tp-site-fs-sm); font-weight: 700; text-decoration: underline; text-decoration-thickness: 1px; text-underline-offset: 0.25em; }
/* A found coach. Phone: the photo tile runs edge to edge, the name card rides up over it, the
   lessons stack as cards (the blue ones in light mode, green at night), and the open button is
   pinned to the foot of the screen. From 48rem: the tile and the card in a column on the
   inline start, the open button under them, the lesson cards filling the rest. */
.tp-clink[data-state='found'] .tp-clink__main { max-inline-size: none; margin-inline: 0; padding: 0; align-content: start; justify-items: stretch; gap: 0; }
.tp-clink[data-state='found'] { padding-block-start: 0; }
.tp-clink__photo {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 100%;
  aspect-ratio: 4 / 3;
  max-block-size: 22rem;
  overflow: clip;
  background: var(--tp-site-block);
  isolation: isolate;
}
.tp-clink__photo img { object-fit: cover; }
.tp-clink__pattern { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; z-index: var(--tp-site-z-below); opacity: 0.16; pointer-events: none; }
.tp-clink__pattern .tp-pattern__bands { stroke: var(--tp-brand-white); fill: none; }
.tp-clink__photo .tp-coach-photo__initial { position: absolute; inset: 0; display: grid; place-items: center; color: var(--tp-site-green); font-family: var(--tp-font-display); font-size: 7rem; font-weight: 900; line-height: 1; text-box: trim-both cap alphabetic; }
/* The name card. On a phone the profile and the sheet dissolve into the page's grid, so the open
   dock (the sheet's last child, ordered to the end of the page) can stick to the screen's foot
   and rest above the footer when the page ends; from 48rem the sheet is the frame instead. */
.tp-clink[data-state='found'] .tp-clink__profile, .tp-clink[data-state='found'] .tp-clink__sheet { display: contents; }
.tp-clink__card {
  position: relative;
  display: grid;
  gap: 0.875rem;
  align-content: start;
  justify-items: stretch;
  margin-block-start: -1.75rem;
  margin-inline: var(--tp-site-gutter);
  padding: 1.5rem 1.25rem 1.25rem;
  border-radius: 1.75rem;
  background: var(--tp-surface);
  box-shadow: 0 8px 28px color-mix(in srgb, var(--tp-site-header-day-fg) 14%, transparent);
}
.tp-clink[data-mode='night'] .tp-clink__card, .tp-clink[data-mode='night'] .tp-clink__sheet { box-shadow: none; }
.tp-clink__levels { display: grid; gap: 0.625rem; container-type: inline-size; padding-block-start: 0.875rem; border-block-start: 1px solid var(--tp-border); }
.tp-clink__levels-head { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; font-size: 0.85rem; }
.tp-clink__levels-title { font-weight: 800; color: var(--tp-fg); }
.tp-clink__taking { display: inline-flex; align-items: center; gap: 0.375rem; padding: 0.25rem 0.625rem; border: 1px solid color-mix(in srgb, var(--tp-site-coach-disc-ink) 35%, transparent); border-radius: var(--tp-site-radius-pill); background: var(--tp-site-coach-disc); color: var(--tp-site-coach-disc-ink); font-size: 0.75rem; font-weight: 800; white-space: nowrap; }
/* The app's open pill: a tinted green pill with a solid dot before the words. */
.tp-clink__taking::before { content: ''; inline-size: 0.375rem; block-size: 0.375rem; border-radius: var(--tp-site-radius-pill); background: currentColor; }
.tp-clink__level-list { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0.375rem; }
.tp-clink__level { display: grid; place-items: center; padding: 0.5rem 0.25rem; border-radius: var(--tp-site-radius-pill); background: var(--tp-site-tint); color: var(--tp-muted-fg); font-size: 0.8rem; font-weight: 900; text-align: center; white-space: nowrap; }
.tp-clink__level[data-on='true'] { background: var(--tp-site-block); color: var(--tp-brand-white); }
.tp-clink__fold { border-block-start: 1px solid var(--tp-border); }
.tp-clink__fold-row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; min-block-size: 3.5rem; font-size: var(--tp-site-fs-md); font-weight: 800; color: var(--tp-fg); cursor: pointer; list-style: none; }
.tp-clink__fold-row::-webkit-details-marker { display: none; }
.tp-clink__chev { display: grid; place-items: center; inline-size: 2.25rem; block-size: 2.25rem; border-radius: var(--tp-site-radius-pill); background: var(--tp-site-tint); color: var(--tp-site-block); transition: transform var(--tp-site-dur-fast) var(--tp-site-ease-out); }
.tp-clink__chev svg { inline-size: 1rem; block-size: 1rem; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
.tp-clink__fold[data-shown='true'] .tp-clink__chev, .tp-clink__fold[open]:not([data-js]) .tp-clink__chev { transform: rotate(180deg); }
.tp-clink__fold .tp-clink__bio { padding-block-end: 0.75rem; }
/* The bio slides open and shut (BioFold): the body's grid row goes 0fr to 1fr over 220 ms with a
   fade. Without JS (no data-js) the plain details just shows its content when open. */
.tp-clink__fold-body { display: grid; grid-template-rows: 0fr; opacity: 0; transition: grid-template-rows 220ms ease, opacity 220ms ease; }
.tp-clink__fold-inner { min-block-size: 0; overflow: hidden; }
.tp-clink__fold[data-shown='true'] .tp-clink__fold-body, .tp-clink__fold[open]:not([data-js]) .tp-clink__fold-body { grid-template-rows: 1fr; opacity: 1; }
.tp-clink[data-state='found'] .tp-clink__title { font-size: clamp(1.75rem, 1.5rem + 1.2vw, 2.25rem); font-weight: 900; line-height: 1.1; }
.tp-clink[data-state='found'] .tp-clink__title, .tp-clink[data-state='found'] .tp-clink__at { text-align: center; }
[dir='rtl'] .tp-clink[data-state='found'] .tp-clink__title { line-height: var(--tp-site-lh-display-ar); }
.tp-clink__types { padding-block: 0.5rem 1.5rem; padding-inline: var(--tp-site-gutter); }
.tp-clink__cards { display: grid; gap: 0.75rem; grid-template-columns: minmax(0, 1fr); }
.tp-clink__type {
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: clip;
  border: 1px solid var(--tp-border);
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-surface);
  container-type: inline-size;
}
.tp-clink__band { display: grid; align-content: space-between; gap: 1.5rem; min-block-size: 8.5rem; padding: 0.875rem 1rem; background: var(--tp-site-block); color: var(--tp-brand-white); }
.tp-clink[data-mode='night'] .tp-clink__band { background: var(--tp-site-green); color: var(--tp-site-green-ink); }
.tp-clink__kind { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; }
[dir='rtl'] .tp-clink__kind { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-clink__type-name { font-size: clamp(1.125rem, 7cqi, 1.45rem); font-weight: 800; line-height: 1.15; color: inherit; }
.tp-clink__type-body { display: grid; align-content: space-between; gap: 0.5rem; padding: 0.75rem 1rem 1rem; }
.tp-clink__type-desc { font-size: var(--tp-site-fs-sm); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-clink__type-line { font-weight: 600; color: var(--tp-fg); }
.tp-clink__type-price { font-size: clamp(0.8125rem, 8cqi, 1.375rem); font-weight: 800; white-space: nowrap; color: var(--tp-site-green-text); }
.tp-clink__type-unit, .tp-clink__type-price span { font-size: 0.72em; font-weight: 600; }
/* Phone: the dock is the name card's foot but sticks to the screen's, so the button is one tap
   away at any scroll. It is the last thing in the page's grid, so it rests above the footer where
   the page ends and never covers the header (it sits under the site header's layer). */
.tp-clink[data-state='found'] .tp-clink__dock {
  position: sticky;
  inset-block-end: 0;
  order: 9;
  z-index: var(--tp-site-z-raised);
  justify-items: stretch;
  margin-block-start: 1rem;
  padding: 0.75rem var(--tp-site-gutter) calc(0.75rem + env(safe-area-inset-bottom, 0px));
  border-block-start: 1px solid var(--tp-border);
  background: var(--tp-site-hero-bg);
}
.tp-clink[data-state='found'] .tp-clink__open { inline-size: 100%; margin-block-start: 0; }
.tp-clink[data-state='found'] .tp-clink__ways { justify-content: center; }
.tp-clink[data-state='found'] .tp-clink__get, .tp-clink[data-state='found'] @media (min-width: 36rem) { .tp-clink__cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
/* A kind with a single lesson stretches across the whole row. */
@media (min-width: 36rem) { .tp-clink__cards[data-count='1'] .tp-clink__type { grid-column: 1 / -1; } }
@media (min-width: 48rem) {
  /* One grid for the whole page: the photo tile in the first column's first row, the name card
     under it, and the lesson cards (the profile, the section and the list dissolve into it)
     filling the other columns from the first row, so the tile is as tall as the cards beside it. */
  .tp-clink[data-state='found'] .tp-clink__main {
    display: grid;
    grid-template-columns: minmax(0, 22rem) repeat(4, minmax(0, 1fr));
    column-gap: clamp(1rem, 2.5vw, 1.5rem);
    max-inline-size: var(--tp-site-max);
    margin-inline: auto;
    padding: calc(var(--tp-site-header-h) + 1rem) var(--tp-site-gutter) 3rem;
    align-items: stretch;
  }
  .tp-clink[data-state='found'] { padding-block-end: 0; }
  .tp-clink[data-state='found'] .tp-clink__profile,
  .tp-clink[data-state='found'] .tp-clink__types,
  .tp-clink[data-state='found'] .tp-clink__group,
  .tp-clink[data-state='found'] .tp-clink__pair,
  .tp-clink[data-state='found'] .tp-clink__cards { display: contents; }
  .tp-clink[data-state='found'] .tp-clink__pair > * { order: 0; }
  .tp-clink[data-state='found'] .tp-clink__pair > h3[data-slot='b'] { margin-block-start: 0.25rem; }
  /* Each kind's label spans the lesson columns, and so do its cards: several wrap, two to a row
     (the lesson columns are four tracks wide here); one stretches; two kinds with one lesson each
     take a half apiece. */
  .tp-clink[data-state='found'] .tp-clink__kind-label { grid-column: 2 / -1; margin-block: 0.25rem 0.5rem; }
  .tp-clink[data-state='found'] .tp-clink__kind-label[data-slot='a'] { grid-column: 2 / span 2; }
  .tp-clink[data-state='found'] .tp-clink__kind-label[data-slot='b'] { grid-column: 4 / span 2; }
  .tp-clink[data-state='found'] .tp-clink__cards[data-slot='flow'] .tp-clink__type { grid-column: span 2; }
  .tp-clink[data-state='found'] .tp-clink__cards[data-slot='flow'][data-count='1'] .tp-clink__type { grid-column: 2 / -1; }
  .tp-clink[data-state='found'] .tp-clink__cards[data-slot='a'] .tp-clink__type { grid-column: 2 / span 2; }
  .tp-clink[data-state='found'] .tp-clink__cards[data-slot='b'] .tp-clink__type { grid-column: 4 / span 2; }
  /* The tile sits level with the first row of cards, under the first label. */
  .tp-clink[data-state='found'] .tp-clink__photo { grid-column: 1; grid-row: 2; aspect-ratio: auto; min-block-size: 12rem; border-radius: var(--tp-site-radius-md); }
  /* The name card spans a run of empty rows below the tile, so its height is spread over them
     and never stretches the second row of lesson cards; the row spacing is each card's own
     margin (a row gap would pile up across the empty rows). */
  .tp-clink[data-state='found'] .tp-clink__photo,
  .tp-clink[data-state='found'] .tp-clink__type { margin-block-end: clamp(1rem, 2.5vw, 1.5rem); }
  .tp-clink[data-state='found'] .tp-clink__sheet {
    grid-column: 1;
    grid-row: 3 / span 40;
    align-self: start;
    display: grid;
    gap: 0.875rem;
    justify-items: stretch;
    padding: 1.5rem 1.25rem 1.25rem;
    border-radius: 1.75rem;
    background: var(--tp-surface);
    box-shadow: 0 8px 28px color-mix(in srgb, var(--tp-site-header-day-fg) 14%, transparent);
  }
  .tp-clink[data-mode='night'][data-state='found'] .tp-clink__sheet { box-shadow: none; }
  .tp-clink[data-state='found'] .tp-clink__card { display: contents; }
  .tp-clink[data-state='found'] .tp-clink__dock { position: static; order: 0; margin: 0; padding: 0.5rem 0 0; border: 0; background: none; }
}
@media (min-width: 64rem) {
  .tp-clink[data-state='found'] .tp-clink__main { grid-template-columns: minmax(0, 22rem) repeat(6, minmax(0, 1fr)); }
  .tp-clink[data-state='found'] .tp-clink__cards[data-slot='flow'] .tp-clink__type { grid-column: span 2; }
  .tp-clink[data-state='found'] .tp-clink__kind-label[data-slot='a'], .tp-clink[data-state='found'] .tp-clink__cards[data-slot='a'] .tp-clink__type { grid-column: 2 / span 3; }
  .tp-clink[data-state='found'] .tp-clink__kind-label[data-slot='b'], .tp-clink[data-state='found'] .tp-clink__cards[data-slot='b'] .tp-clink__type { grid-column: 5 / span 3; }
}
@media (prefers-reduced-motion: reduce) {
  .tp-clink__open { transition: none; }
  .tp-clink__fold-body, .tp-clink__chev { transition: none; }
}
`;
