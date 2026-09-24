/**
 * The hero: a full-bleed photo in the grade's `night` exposure (photo.css.ts), and the
 * words on it on the reading-start side: the open pill, "TOUCH IS / A LIFESTYLE" sized to
 * its column, the lead, and the two ways to book. The section is a dark ground in both
 * modes (`tp-on-dark`), and the header floats over it transparent until the page scrolls.
 *
 * The crop and the words are composed per screen shape, for hero.jpg (photo-credits.md):
 * the player centre-right, his head high, the ball low on the left.
 * - Landscape: the whole width of the frame shows, so the words stand at the top, clear of
 *   the ball, which keeps the lower left to itself; the thin green line runs under it like
 *   its path. The player starts at about 47 % of the frame's width, whatever the screen
 *   (the frame fills the width, and the page's column is centred), so the copy column is
 *   capped to end at 44 % of the SCREEN's width, not the column's: the headline ends
 *   before the player at 1024, 1440 and 1920 alike (it ran into his shorts at 1440).
 *   Arabic stands its words on the right, where the player is, and the photo is not
 *   mirrored (the racket carries lettering), so the frame is widened past the left edge
 *   instead: the player slides left of the words and the crop keeps his head.
 * - Portrait: the words take the lower half; the crop slides right until the ball leaves
 *   the frame (it would sit under the words) and the player stands in the top half.
 * The line and the crop belong to the photo, so neither mirrors in Arabic. Swapping the
 * photo means re-checking these three object-positions.
 */
export const siteHeroCss = `
.tp-front {
  --tp-front-band: 10rem;
  position: relative;
  display: grid;
  min-block-size: min(100svh, 72rem);
  overflow: clip;
  background: var(--tp-site-navy);
}
.tp-front__photo { position: absolute; inset: 0; }
.tp-front__photo .tp-photo__img { object-position: 58% 15%; }
/* The line lives in the section's bottom band, which the words never enter (the inner
   block's end padding is the band's height), so it can cross under the ball but never
   under a word or a button, in either direction. */
.tp-front__line {
  display: none;
  position: absolute;
  inset-block-end: 0;
  inset-inline-start: 0;
  inline-size: 100%;
  block-size: var(--tp-front-band);
  overflow: visible;
  pointer-events: none;
}
.tp-front__line path { fill: none; stroke: var(--tp-brand-green); stroke-width: 3; vector-effect: non-scaling-stroke; }
.tp-front__inner {
  position: relative;
  display: grid;
  align-content: end;
  inline-size: 100%;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-block: calc(var(--tp-site-header-h) + 2rem) clamp(2.5rem, 8vh, 5.5rem);
  padding-inline: var(--tp-site-gutter);
}
.tp-front__copy {
  display: grid;
  gap: clamp(1rem, 2.4vw, 1.5rem);
  justify-items: start;
  max-inline-size: 48rem;
  --tp-fit: 16.8;
  --tp-cap: 8.75rem;
}
[dir='rtl'] .tp-front__copy { --tp-fit: 19.2; }
.tp-front__title { justify-self: stretch; }
.tp-front__lead {
  max-inline-size: 36ch;
  font-size: var(--tp-site-fs-lg);
  line-height: 1.5;
  color: var(--tp-fg);
  text-wrap: pretty;
}
.tp-front__ctas { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-block-start: 0.5rem; }
.tp-front .tp-site-btn--ghost { border-color: var(--tp-fg); }
@media (min-width: 48rem) and (orientation: portrait) {
  .tp-front__photo .tp-photo__img { object-position: 66% 15%; }
}
@media (min-width: 48rem) and (orientation: landscape) {
  .tp-front__photo .tp-photo__img { object-position: 50% 25%; }
  .tp-front__line { display: block; }
  .tp-front__inner { align-content: start; padding-block: calc(var(--tp-site-header-h) + 1.5rem) var(--tp-front-band); }
  .tp-front__copy {
    max-inline-size: min(42rem, calc(44vw - max(0px, (100vw - var(--tp-site-max)) / 2) - var(--tp-site-gutter)));
  }
  [dir='rtl'] .tp-front__photo { inset-inline-end: -50%; }
  [dir='rtl'] .tp-front__photo .tp-photo__img { object-position: 50% 18%; }
  /* Arabic sets taller (--tp-site-lh-display-ar, 1.45), so its headline is capped lower to keep the
     block the same height as the English one. */
  [dir='rtl'] .tp-front__copy { --tp-cap: 6.5rem; }
}
`;
