/**
 * `#visit`: the last loud block before the footer, flat Touch Blue edge to edge (the
 * deck's roll-ups with teal retired): the headline, then the address with its map link,
 * the hours and the ways to reach the desk.
 */
export const siteVisitCss = `
.tp-visit {
  background: var(--tp-site-block);
  padding-block: var(--tp-site-section-pad);
}
.tp-visit__inner {
  display: grid;
  gap: clamp(2rem, 5vw, 3rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
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
@media (min-width: 48rem) {
  .tp-visit__facts { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: 2.5rem; }
  .tp-visit__facts > .tp-visit__block:last-child { grid-column: 1 / -1; }
}
@media (min-width: 60rem) {
  .tp-visit__head { max-inline-size: min(52vw, 46rem); }
  .tp-visit__facts { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .tp-visit__facts > .tp-visit__block:last-child { grid-column: auto; }
}
`;
