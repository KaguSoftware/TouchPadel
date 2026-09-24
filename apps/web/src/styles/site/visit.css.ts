/**
 * `#visit`: the last loud block before the footer, flat Touch Blue edge to edge (the
 * deck's roll-ups with teal retired): the headline, then the address with its map link,
 * the hours and the ways to reach the desk. The picture is the court-line bands in full
 * Padel Green with the brand's ball on a crossing ("the ball marks the spot"): a band
 * across the top on phones, the section's inline end on wide screens. No text ever sits
 * on the bands.
 */
export const siteVisitCss = `
.tp-visit {
  position: relative;
  overflow: clip;
  background: var(--tp-site-block);
  padding-block-end: var(--tp-site-section-pad);
}
/* The picture is its own panel, one blue step deeper, so where the bands stop reads as
   a panel's edge and not as a crop. */
.tp-visit__art {
  position: relative;
  display: grid;
  place-items: center;
  block-size: clamp(11rem, 44vw, 16rem);
  overflow: hidden;
  background: var(--tp-site-block-deep);
}
.tp-visit__pin {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 3.25rem;
  block-size: 3.25rem;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-block);
  box-shadow: 0 0 0 3px var(--tp-brand-white);
}
.tp-visit__pin .tp-ballmark { inline-size: 2.25rem; block-size: 2.25rem; }
.tp-visit__inner {
  position: relative;
  display: grid;
  gap: clamp(2rem, 5vw, 3rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-block-start: clamp(2.5rem, 7vw, 4rem);
  padding-inline: var(--tp-site-gutter);
}
.tp-visit__head { --tp-fit: 16; --tp-cap: 7rem; }
[dir='rtl'] .tp-visit__head { --tp-fit: 19.4; }
.tp-visit__facts { display: grid; gap: 2.25rem; }
.tp-visit__block { display: grid; gap: 0.75rem; justify-items: start; align-content: start; }
.tp-visit__label {
  font-size: var(--tp-site-fs-xs);
  font-weight: var(--tp-site-fw-label);
  letter-spacing: var(--tp-site-track-label);
  text-transform: uppercase;
  color: var(--tp-muted-fg);
}
[dir='rtl'] .tp-visit__label { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-visit__address { font-size: var(--tp-site-fs-xl); font-weight: var(--tp-site-fw-label); line-height: 1.15; }
.tp-visit__hours { font-size: var(--tp-site-fs-lg); }
.tp-visit__ctas { display: flex; flex-wrap: wrap; gap: 0.75rem; }
/* The number rides the call button after its label, set apart by a hairline, and is
   never cased or tracked (it is read digit by digit). */
.tp-visit__number {
  padding-inline-start: 0.6em;
  border-inline-start: 1.5px solid currentColor;
  letter-spacing: 0.02em;
  text-transform: none;
  white-space: nowrap;
}
.tp-visit__walkin { font-weight: 600; }
.tp-visit__social {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-block-size: var(--tp-site-touch);
  font-weight: 700;
  text-underline-offset: 0.3em;
}
.tp-visit__social .tp-icon, .tp-site-footer__maps .tp-icon { inline-size: 1.1em; block-size: 1.1em; }
@media (min-width: 48rem) {
  .tp-visit__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 2.5rem; }
  .tp-visit__facts > .tp-visit__block:last-child { grid-column: 1 / -1; }
}
@media (min-width: 60rem) {
  .tp-visit { padding-block: var(--tp-site-section-pad); }
  .tp-visit__art {
    position: absolute;
    inset-block: 0;
    inset-inline-end: 0;
    inline-size: min(40vw, 38rem);
    block-size: auto;
  }
  .tp-visit__inner { padding-block-start: 0; }
  .tp-visit__head, .tp-visit__facts { max-inline-size: min(52vw, 46rem); }
}
`;
