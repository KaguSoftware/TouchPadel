/**
 * Hero. Mode "none" is the design's masthead: a 320 px white panel carrying the
 * three-stroke brand sweep, the word المنيو and the JUST ONE TOUCH strapline.
 * Modes "media" and "featured" stay operator-selectable and render their own
 * card on the same white column.
 *
 * Collapse is unchanged and CSS-only: `[data-collapsed]` animates
 * grid-template-rows 1fr → 0fr on the inner row, so nothing unmounts and
 * scrolling back up restores the panel without a re-layout jump.
 */
export const heroCss = `
.tp-hero { position: relative; display: flex; flex-direction: column; background: var(--tp-bg); }
.tp-hero__collapse { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--tp-dur-slow) var(--tp-ease-out); }
.tp-hero[data-collapsed='true'] .tp-hero__collapse { grid-template-rows: 0fr; }
.tp-hero__collapse > * { min-block-size: 0; overflow: hidden; }

/* ---- mode "none": the design's masthead ---- */
.tp-hero__brand { position: relative; block-size: 320px; overflow: hidden; }
/* The sweep is a decorative background. It is drawn for the Arabic reading
   direction (strokes rising toward the trailing edge), so it mirrors in LTR to
   keep the headline sitting in the open half of the composition. */
.tp-hero__art { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; }
[dir='ltr'] .tp-hero__art { transform: scaleX(-1); }
/* Design: 30 px in from the leading-most edge of the sweep, 64 px down. */
.tp-hero__headline-wrap { position: absolute; inset-inline-end: 30px; inset-block-start: 64px; text-align: start; }
.tp-hero__headline { font-family: var(--tp-font-arabic); font-weight: 900; font-size: 44px;
  line-height: 1.05; color: var(--tp-accent); }
[dir='ltr'] .tp-hero__headline { font-family: var(--tp-font-display); font-weight: 800; text-transform: uppercase; letter-spacing: var(--tp-tracking-caps); }
.tp-hero__strapline { font-family: var(--tp-font-display); font-weight: 600; font-size: 12px;
  letter-spacing: 0.16em; color: var(--tp-cafe-green); margin-block-start: 6px; }

/* ---- modes "media" / "featured" ---- */
.tp-hero__media { position: relative; aspect-ratio: 16 / 9; background: var(--tp-surface); overflow: hidden; }
.tp-hero__media img, .tp-hero__media video { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
.tp-hero__featured { position: relative; margin: var(--tp-space-4); border-radius: var(--tp-radius-lg); overflow: hidden; background: var(--tp-bg); box-shadow: var(--tp-shadow-card); }
.tp-hero__badge { position: absolute; inset-block-start: var(--tp-space-3); inset-inline-start: var(--tp-space-3); background: var(--tp-cafe-green); color: var(--tp-accent-2-contrast);
  border-radius: var(--tp-radius-pill); padding-block: 0.25rem; padding-inline: 0.7rem; font-size: var(--tp-fs-xs); font-weight: 800; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); }
.tp-price--struck { text-decoration: line-through; color: var(--tp-muted-fg); font-weight: 400; margin-inline-end: 0.4rem; }
.tp-price--promo { color: var(--tp-accent); font-weight: 800; }

button.tp-hero__featured { display: block; inline-size: calc(100% - 2 * var(--tp-space-4)); border: 0; padding: 0; text-align: start; color: inherit; }
.tp-hero__featured-photo { position: relative; display: block; inline-size: 100%; aspect-ratio: 16 / 9; background: var(--tp-cafe-blue-tint); }
.tp-hero__featured-photo img { object-fit: cover; }
.tp-hero__featured-body { display: flex; align-items: baseline; justify-content: space-between; gap: var(--tp-space-3);
  padding-block: var(--tp-space-3); padding-inline: var(--tp-space-4); }
.tp-hero__featured-name { font-family: var(--tp-font-arabic); font-weight: 800; font-size: var(--tp-fs-lg); line-height: var(--tp-lh-tight); }
[dir='ltr'] .tp-hero__featured-name { font-family: var(--tp-font-display); text-transform: uppercase; letter-spacing: var(--tp-tracking-caps); }
.tp-hero__featured-price { white-space: nowrap; font-family: var(--tp-font-numeric); font-variant-numeric: tabular-nums; font-weight: 600; color: var(--tp-accent); }
.tp-hero__discount { position: absolute; inset-block-start: var(--tp-space-3); inset-inline-end: var(--tp-space-3);
  background: var(--tp-accent); color: var(--tp-accent-contrast); border-radius: var(--tp-radius-pill);
  padding-block: 0.25rem; padding-inline: 0.7rem; font-size: var(--tp-fs-xs); font-weight: 800; font-variant-numeric: tabular-nums; }

/* Green marquee under the featured card — same --tp-dir-sign trick as the ticker. */
.tp-hero__marquee { display: block; overflow: hidden; background: var(--tp-cafe-green); color: var(--tp-accent-2-contrast); block-size: 1.75rem; }
.tp-hero__marquee-track { display: inline-flex; gap: var(--tp-space-6); white-space: nowrap; padding-inline-start: var(--tp-space-6);
  line-height: 1.75rem; animation: tp-tick var(--tp-ticker-dur) linear infinite; }
.tp-hero__marquee-item { font-size: var(--tp-fs-xs); font-weight: 700; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); }
@media (prefers-reduced-motion: reduce) { .tp-hero__marquee-track { animation: none; translate: 0 0; } }

/* Hero sentinel: a zero-height probe read by useHeroCollapse. */
[data-hero-sentinel] { block-size: 1px; }
`;
