/**
 * Events: the PLAY / SMASH / WIN poster, a full-bleed block of the poster black
 * (full-brand2.pdf p13), then the "coming soon" announcement under it on the page's band
 * ground.
 *
 * The court-line bands, in full Padel Green, fill the WHOLE poster block (a phone, a
 * tablet and a desktop crop per language, Events.tsx), so they only stop at the block's
 * own edges, which are the page's (brand §5.1: bands run off the edge, the crop does the
 * framing). They used to fill only the poster's grid box inside a taller black section
 * and stopped along flat lines in open black. Each crop keeps the green SMASH line clear
 * of bands, as the deck does; bands cross the white words and the photo. Paint order is
 * the DOM's: bands, photo, words.
 *
 * The words step down the page on a diagonal (start, middle, end) like a ball's path,
 * sized to their column in container units. "SMASH" is 3.57 em wide in Lama Sans Black,
 * and 23.5 cqi leaves it room for 0.12 em of added tracking per letter (WCAG 1.4.12 text
 * spacing: 4.17 em still fits the column, where 27 cqi clipped the H). Every letter
 * carries a knockout: a ring of the poster black about 0.1 em wide, drawn by the SVG
 * filter in Events.tsx (the glyphs' own alpha, dilated), so where a band meets a glyph the
 * edge is straight and clean. A -webkit-text-stroke did this before, and its mitred joins
 * left sawtooth spikes at every sharp corner of the letters. The filter's radius is in
 * CSS px, so it steps with the type: 8px on phones, 11px on large phones, 16px from
 * tablets up (the words' size at each step times 0.1).
 */
export const siteEventsCss = `
.tp-events { background: var(--tp-site-band-bg); padding-block-end: var(--tp-site-section-pad); }
.tp-events__stage {
  position: relative;
  overflow: clip;
  background: var(--tp-site-poster);
  padding-block: clamp(3.5rem, 9vw, 7.5rem);
}
.tp-events__poster {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'words' 'photo';
  row-gap: clamp(2rem, 6vw, 3rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-events__photo { grid-area: photo; justify-self: end; inline-size: min(72%, 24rem); aspect-ratio: 4 / 5; }
/* The whole poster block, edge to edge: the base .tp-pattern box (absolute, inset 0). */
.tp-events__pattern--mid, .tp-events__pattern--wide, .tp-events__pattern--xwide { display: none; }
@media (min-width: 48rem) {
  .tp-events__pattern--tall { display: none; }
  .tp-events__pattern--mid { display: block; }
}
@media (min-width: 60rem) {
  .tp-events__pattern--mid { display: none; }
  .tp-events__pattern--wide { display: block; }
}
@media (min-width: 80rem) {
  .tp-events__pattern--wide { display: none; }
  .tp-events__pattern--xwide { display: block; }
}
.tp-events__words {
  grid-area: words;
  position: relative;
  display: grid;
  container-type: inline-size;
  font-family: var(--tp-font-display);
  font-weight: var(--tp-site-fw-display);
  line-height: 0.86;
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  color: var(--tp-brand-white);
}
.tp-events__word {
  display: block;
  font-size: min(23.5cqi, 26svh, 17rem);
  filter: url(#tp-knockout-s);
}
@media (min-width: 30rem) { .tp-events__word { filter: url(#tp-knockout-m); } }
@media (min-width: 48rem) { .tp-events__word { filter: url(#tp-knockout-l); } }
.tp-events__defs { position: absolute; inline-size: 0; block-size: 0; overflow: hidden; pointer-events: none; }
.tp-events__word--play { justify-self: start; }
.tp-events__word--hit { justify-self: center; color: var(--tp-brand-green); }
.tp-events__word--win { justify-self: end; }
[dir='rtl'] .tp-events__words { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
[dir='rtl'] .tp-events__word { font-size: min(27cqi, 20svh, 15rem); }

.tp-events__note {
  position: relative;
  display: grid;
  gap: 1.25rem;
  justify-items: start;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  margin-block-start: clamp(3rem, 8vw, 5rem);
  padding-inline: var(--tp-site-gutter);
  color: var(--tp-fg);
}
.tp-events__soon {
  display: inline-flex;
  align-items: center;
  min-block-size: 2rem;
  padding-inline: 0.875rem;
  border: 1.5px solid var(--tp-fg);
  border-radius: var(--tp-site-radius-pill);
  font-size: var(--tp-site-fs-xs);
  font-weight: var(--tp-site-fw-label);
  letter-spacing: var(--tp-site-track-label);
  text-transform: uppercase;
}
[dir='rtl'] .tp-events__soon { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-events__title {
  max-inline-size: 16ch;
  font-family: var(--tp-font-display);
  font-size: var(--tp-site-fs-2xl);
  font-weight: var(--tp-site-fw-display);
  line-height: 0.98;
  letter-spacing: var(--tp-site-track-display);
  text-transform: uppercase;
  text-wrap: balance;
  color: var(--tp-site-display-1);
}
[dir='rtl'] .tp-events__title { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
.tp-events__body {
  max-inline-size: 42ch;
  font-size: var(--tp-site-fs-lg);
  line-height: 1.55;
  color: var(--tp-site-ink-2);
  text-wrap: pretty;
}

@media (min-width: 60rem) {
  .tp-events__poster {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    grid-template-areas: 'words photo';
    align-items: center;
    column-gap: clamp(2rem, 5vw, 5rem);
  }
  .tp-events__photo { inline-size: 100%; }
  .tp-events__note {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    grid-template-rows: auto auto 1fr;
    column-gap: clamp(2rem, 5vw, 5rem);
    align-items: start;
  }
  .tp-events__soon, .tp-events__title { grid-column: 1; }
  .tp-events__body { grid-column: 2; grid-row: 1 / span 2; align-self: end; }
  .tp-events__note > .tp-site-btn { grid-column: 2; grid-row: 3; }
}
`;
