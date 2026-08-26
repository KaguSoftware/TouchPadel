/** Hero (modes none | media | featured). Collapse via grid-template-rows on [data-collapsed]. */
export const heroCss = `
/* The hero is the lower half of the crown, closed by a single swoosh. Only
   mode "none" rides the blue — "media" and "featured" render their own card on
   the page background, so the crown ends at the bar and the swoosh closes it
   there (see .tp-hero__band order below). */
.tp-hero { position: relative; display: flex; flex-direction: column; }
/* Mode "none" continues the bar's blue; the other modes are a card on the
   page background. Both bar and panel are painted --tp-accent and share ONE
   viewport-anchored bean field (topbar.css.ts), so the seam is invisible. */
.tp-hero[data-mode='none'] { background: var(--tp-accent); }
.tp-hero:not([data-mode='none']) { background: var(--tp-bg); }
/* Collapse: 1fr -> 0fr on the INNER row only. The swoosh below is outside it,
   so it rides up against the topbar instead of collapsing away with the hero. */
.tp-hero__collapse { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--tp-dur-slow) var(--tp-ease-out); }
.tp-hero[data-collapsed='true'] .tp-hero__collapse { grid-template-rows: 0fr; }
.tp-hero__collapse > * { min-block-size: 0; overflow: hidden; }
/* The crown's bottom edge: blue behind the curve, so the sweep reads as the
   blue field ENDING rather than as a stripe floating on the page. It is
   therefore ordered (order: -1) ABOVE the content in modes "media"/"featured",
   where that content is a card on the page background and the blue field is
   the topbar alone — closing it under the card would detach the stripe from
   the only blue there is. In mode "none" the panel itself is blue, so the
   swoosh stays below it and closes the whole crown. */
.tp-hero__band { position: relative; block-size: 2rem; background: var(--tp-accent); order: -1; }
.tp-hero[data-mode='none'] .tp-hero__band { order: 0; }
.tp-hero__band .tp-swoosh { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; }
.tp-hero__brand { position: relative; color: var(--tp-accent-contrast); text-align: center;
  padding-block: var(--tp-space-6) var(--tp-space-5); padding-inline: var(--tp-space-5); }
.tp-hero__headline { position: relative; font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); font-size: var(--tp-fs-display);
  line-height: var(--tp-lh-tight); letter-spacing: var(--tp-tracking-caps); text-transform: uppercase; }
[dir='rtl'] .tp-hero__headline { font-family: var(--tp-font-arabic); font-weight: 700; }
.tp-hero__meta { position: relative; margin-block-start: var(--tp-space-3); font-size: var(--tp-fs-sm); opacity: 0.9; }
.tp-hero__media { position: relative; aspect-ratio: 16 / 9; background: var(--tp-surface); overflow: hidden; }
.tp-hero__media img, .tp-hero__media video { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
.tp-hero__featured { position: relative; margin: var(--tp-space-4); border-radius: var(--tp-radius-lg); overflow: hidden; background: var(--tp-surface); box-shadow: var(--tp-shadow-card); }
.tp-hero__badge { position: absolute; inset-block-start: var(--tp-space-3); inset-inline-start: var(--tp-space-3); background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast);
  border-radius: var(--tp-radius-pill); padding-block: 0.25rem; padding-inline: 0.7rem; font-size: var(--tp-fs-xs); font-weight: 800; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); }
.tp-price--struck { text-decoration: line-through; color: var(--tp-muted-fg); font-weight: 400; margin-inline-end: 0.4rem; }
.tp-price--promo { color: var(--tp-cafe-brown); font-weight: 800; }

/* Hero mode "featured" — the whole card is the button. */
button.tp-hero__featured { display: block; inline-size: calc(100% - 2 * var(--tp-space-4)); border: 0; padding: 0; text-align: start; color: inherit; }
.tp-hero__featured-photo { position: relative; display: block; inline-size: 100%; aspect-ratio: 16 / 9; background: var(--tp-cafe-brown-tint); }
.tp-hero__featured-photo img { object-fit: cover; }
.tp-hero__featured-body { display: flex; align-items: baseline; justify-content: space-between; gap: var(--tp-space-3);
  padding-block: var(--tp-space-3); padding-inline: var(--tp-space-4); }
.tp-hero__featured-name { font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); font-size: var(--tp-fs-lg);
  text-transform: uppercase; letter-spacing: var(--tp-tracking-caps); line-height: var(--tp-lh-tight); }
[dir='rtl'] .tp-hero__featured-name { font-family: var(--tp-font-arabic); font-weight: 700; text-transform: none; }
.tp-hero__featured-price { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 700; }
.tp-hero__discount { position: absolute; inset-block-start: var(--tp-space-3); inset-inline-end: var(--tp-space-3);
  background: var(--tp-accent); color: var(--tp-accent-contrast); border-radius: var(--tp-radius-pill);
  padding-block: 0.25rem; padding-inline: 0.7rem; font-size: var(--tp-fs-xs); font-weight: 800; font-variant-numeric: tabular-nums; }

/* Brown marquee under the featured card — same --tp-dir-sign trick as the ticker. */
.tp-hero__marquee { display: block; overflow: hidden; background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast); block-size: 1.75rem; }
.tp-hero__marquee-track { display: inline-flex; gap: var(--tp-space-6); white-space: nowrap; padding-inline-start: var(--tp-space-6);
  line-height: 1.75rem; animation: tp-tick var(--tp-ticker-dur) linear infinite; }
.tp-hero__marquee-item { font-size: var(--tp-fs-xs); font-weight: 700; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); }
@media (prefers-reduced-motion: reduce) { .tp-hero__marquee-track { animation: none; translate: 0 0; } }

/* Hero sentinel: a zero-height probe read by useHeroCollapse. */
[data-hero-sentinel] { block-size: 1px; }
`;
