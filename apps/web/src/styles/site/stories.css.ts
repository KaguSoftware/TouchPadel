/**
 * The lessons photo-and-words section and the Touch Cafe steps. With the court (#club) and
 * the poster photo (events) standing at the inline end, lessons puts its photo on the
 * reading-start side, so the photographs alternate as the page scrolls.
 *
 * - Lessons: the photo runs to the screen's edge on the reading-start side for the
 *   section's full height; the words sit in the other half, the action under them. Side
 *   by side only from 60rem: a half-width column on a tablet is too narrow to hold both
 *   the player's face and the ball. Narrower it stacks WORDS FIRST, because #club ends on
 *   its court photo and two photographs must not meet across the section edge.
 * - Touch Cafe: no photograph. The two-weight title with the words and the way in beside
 *   it, then how ordering works as three drawn steps (a table and its code, a phone
 *   scanning it, a phone showing a real menu section), side by side where they fit.
 */
export const siteStoriesCss = `
.tp-lessons {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'copy' 'photo';
  background: var(--tp-site-band-bg);
}
.tp-lessons__photo { grid-area: photo; aspect-ratio: 4 / 3; }
@media (min-width: 40rem) { .tp-lessons__photo { aspect-ratio: 3 / 2; } }
.tp-lessons__copy {
  grid-area: copy;
  display: grid;
  gap: clamp(1.5rem, 4vw, 2.5rem);
  align-content: center;
  padding-block: var(--tp-site-section-pad) clamp(2.75rem, 8vw, 4.5rem);
  padding-inline: var(--tp-site-gutter);
}
.tp-lessons__head { --tp-fit: 9.8; --tp-cap: 6.25rem; }
[dir='rtl'] .tp-lessons__head { --tp-fit: 14.2; }
.tp-lessons__act { display: grid; gap: 1.75rem; justify-items: start; }
.tp-lessons__body, .tp-cafe-handoff__body {
  max-inline-size: 40ch;
  font-size: var(--tp-site-fs-lg);
  line-height: 1.55;
  color: var(--tp-site-ink-2);
  text-wrap: pretty;
}
@media (min-width: 60rem) {
  .tp-lessons {
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-template-areas: 'photo copy';
    min-block-size: min(90svh, 50rem);
  }
  .tp-lessons__photo { aspect-ratio: auto; }
  .tp-lessons__copy {
    padding-block: var(--tp-site-section-pad);
    padding-inline-start: clamp(2rem, 6vw, 6.5rem);
    padding-inline-end: max(var(--tp-site-gutter), calc((100vw - var(--tp-site-max)) / 2 + var(--tp-site-gutter)));
  }
}

.tp-cafe-handoff { background: var(--tp-site-hero-bg); padding-block: var(--tp-site-section-pad); overflow: clip; }
.tp-cafe-handoff__inner {
  display: grid;
  gap: clamp(2.5rem, 6vw, 4.5rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-cafe-handoff__top { display: grid; gap: clamp(1.5rem, 3vw, 2rem); align-items: end; }
.tp-cafe-handoff__head { --tp-fit: 10.3; --tp-cap: 6.25rem; }
[dir='rtl'] .tp-cafe-handoff__head { --tp-fit: 19.8; }
.tp-cafe-handoff__lead { display: grid; gap: clamp(1.5rem, 3vw, 2rem); justify-items: start; }
@media (min-width: 60rem) {
  .tp-cafe-handoff__top { grid-template-columns: minmax(0, 1.2fr) minmax(0, 1fr); column-gap: clamp(3rem, 6vw, 6rem); }
}

.tp-cafe-steps { display: grid; gap: 1.25rem; grid-template-columns: repeat(auto-fit, minmax(min(100%, 16rem), 1fr)); }
.tp-cafe-step {
  display: grid;
  grid-template-rows: 15rem auto;
  gap: 1.25rem;
  padding: 1.5rem;
  border-radius: 22px;
  background: var(--tp-site-band-bg);
}
.tp-cafe-step__art { display: grid; place-items: center; overflow: clip; border-radius: var(--tp-site-radius-md); background: var(--tp-site-tint); }
.tp-cafe-step__words { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0.9rem; align-items: start; }
.tp-cafe-step__no {
  display: grid;
  place-items: center;
  inline-size: 2.25rem;
  block-size: 2.25rem;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-weight: var(--tp-site-fw-display);
}
.tp-cafe-step__title { font-size: 1.15rem; font-weight: var(--tp-site-fw-label); line-height: 1.25; color: var(--tp-fg); }
.tp-cafe-step__body { margin-block-start: 0.2rem; font-size: var(--tp-site-fs-sm); line-height: 1.5; color: var(--tp-site-ink-2); text-wrap: pretty; }

/* The drawings: brand colours in both modes (a table, a phone and a code do not change
   with the page's mode). */
.tp-cafe-qr { display: block; inline-size: 3rem; block-size: auto; aspect-ratio: 1; overflow: visible; color: var(--tp-site-navy); }
/* The table, from above: four chairs tucked under a round top with a rim, a coffee on its
   saucer, a ball, and the table's stand-up card with its number over its code. */
.tp-cafe-table { position: relative; display: grid; place-items: center; inline-size: 12.5rem; aspect-ratio: 1; }
.tp-cafe-table__chair {
  position: absolute;
  /* Centred without a side, so the turn is the same in both directions. */
  inset: 0;
  margin: auto;
  inline-size: 3.4rem;
  block-size: 2.9rem;
  border-radius: 0.6rem;
  background: color-mix(in srgb, var(--tp-brand-white) 18%, var(--tp-site-block));
  transform: rotate(var(--tp-chair)) translateY(-5.1rem);
}
/* The backrest, on the chair's outer edge. */
.tp-cafe-table__chair::before {
  content: '';
  position: absolute;
  inset-block-start: -0.35rem;
  inset-inline: -0.1rem;
  block-size: 0.75rem;
  border-radius: 0.4rem;
  background: var(--tp-site-navy);
}
.tp-cafe-table__top {
  position: relative;
  inline-size: 10rem;
  aspect-ratio: 1;
  border-radius: var(--tp-site-radius-pill);
  background: radial-gradient(circle at 35% 30%, color-mix(in srgb, var(--tp-brand-white) 12%, var(--tp-site-block)), var(--tp-site-block) 65%);
  box-shadow:
    inset 0 0 0 0.4rem color-mix(in srgb, var(--tp-brand-white) 14%, var(--tp-site-block)),
    inset 0 0 0 0.5rem color-mix(in srgb, var(--tp-site-navy) 25%, var(--tp-site-block)),
    0 0.6rem 1.2rem color-mix(in srgb, var(--tp-site-navy) 55%, transparent);
}
/* The coffee: a saucer, the handle lying on it, and the cup over both, its crema in the
   middle and a little shadow on the saucer. */
.tp-cafe-table__cup {
  position: absolute;
  inset-block-start: 1.3rem;
  inset-inline-start: 1.4rem;
  inline-size: 3.3rem;
  aspect-ratio: 1;
  border-radius: var(--tp-site-radius-pill);
  background: color-mix(in srgb, var(--tp-brand-white) 85%, var(--tp-site-block));
  box-shadow:
    inset 0 0 0 0.15rem color-mix(in srgb, var(--tp-brand-white) 65%, var(--tp-site-block)),
    0 0.2rem 0.4rem color-mix(in srgb, var(--tp-site-navy) 35%, transparent);
}
.tp-cafe-table__cup::before {
  content: '';
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: 0.08rem;
  inline-size: 0.8rem;
  block-size: 0.4rem;
  translate: 0 -50%;
  border-radius: 0.2rem;
  background: var(--tp-brand-white);
  box-shadow:
    0 0 0 1px color-mix(in srgb, var(--tp-site-navy) 18%, transparent),
    0 0.08rem 0.15rem color-mix(in srgb, var(--tp-site-navy) 30%, transparent);
}
.tp-cafe-table__cup::after {
  content: '';
  position: absolute;
  inset: 0;
  margin: auto;
  inline-size: 2.2rem;
  aspect-ratio: 1;
  border-radius: var(--tp-site-radius-pill);
  background: radial-gradient(circle, var(--tp-site-crema) 0 20%, var(--tp-site-coffee) 30%);
  box-shadow:
    inset 0 0 0 0.25rem var(--tp-brand-white),
    0 0.12rem 0.3rem color-mix(in srgb, var(--tp-site-navy) 40%, transparent);
}
.tp-cafe-table__ball {
  position: absolute;
  inset-block-end: 2.1rem;
  inset-inline-start: 2.2rem;
  inline-size: 1.4rem;
  aspect-ratio: 1;
  overflow: clip;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-green);
  box-shadow: 0 0.15rem 0.3rem color-mix(in srgb, var(--tp-site-navy) 40%, transparent);
}
/* The ball's seam. */
.tp-cafe-table__ball::before {
  content: '';
  position: absolute;
  inset-block: 0.1rem;
  inset-inline-start: -0.75rem;
  inline-size: 1.4rem;
  border: 2px solid var(--tp-brand-white);
  border-radius: var(--tp-site-radius-pill);
  opacity: 0.85;
}
.tp-cafe-table__tent {
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: 1.5rem;
  translate: 0 -50%;
  display: grid;
  justify-items: center;
  gap: 0.2rem;
  padding: 0.3rem 0.3rem 0.35rem;
  border-radius: 0.4rem;
  background: var(--tp-brand-white);
  /* The card's foot, and its shadow on the table. */
  box-shadow:
    0 0.25rem 0 color-mix(in srgb, var(--tp-site-navy) 20%, var(--tp-brand-white)),
    0 0.5rem 0.8rem color-mix(in srgb, var(--tp-site-navy) 50%, transparent);
}
.tp-cafe-table__no {
  font-size: 0.5rem;
  font-weight: var(--tp-site-fw-display);
  letter-spacing: 0.08em;
  line-height: 1;
  text-transform: uppercase;
  white-space: nowrap;
  color: var(--tp-site-navy);
}
[dir='rtl'] .tp-cafe-table__no { letter-spacing: 0; font-size: 0.6rem; }
.tp-cafe-table__tent .tp-cafe-qr { inline-size: 2.6rem; }

.tp-cafe-phone { inline-size: 7.25rem; block-size: 14.5rem; padding: 0.35rem; border-radius: 1.5rem; background: var(--tp-site-poster); }
.tp-cafe-phone__screen {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 100%;
  block-size: 100%;
  overflow: clip;
  border-radius: 1.15rem;
  background: var(--tp-site-navy);
  color: var(--tp-brand-white);
}
/* The camera: a Dynamic Island in the bezel's black at the top of the screen, its lens a
   faint ring at the island's end. Drawn over the screen's content, so content that runs
   to the top (the menu's bar) starts below it. */
.tp-cafe-phone__screen::before {
  content: '';
  position: absolute;
  z-index: 1;
  inset-block-start: 0.35rem;
  inset-inline-start: 50%;
  inline-size: 2.1rem;
  block-size: 0.6rem;
  translate: -50% 0;
  border-radius: var(--tp-site-radius-pill);
  background:
    radial-gradient(circle at calc(100% - 0.3rem) 50%, color-mix(in srgb, var(--tp-brand-blue) 45%, var(--tp-site-poster)) 0 0.07rem, color-mix(in srgb, var(--tp-brand-white) 14%, var(--tp-site-poster)) 0.08rem 0.13rem, transparent 0.14rem),
    var(--tp-site-poster);
}
[dir='rtl'] .tp-cafe-phone__screen::before { translate: 50% 0; }
.tp-cafe-phone__mark { inline-size: 3.5rem; block-size: 3.5rem; }
.tp-cafe-scan { position: relative; display: grid; place-items: center; inline-size: 5rem; aspect-ratio: 1; }
.tp-cafe-scan::before {
  content: '';
  position: absolute;
  inset: 0;
  background:
    linear-gradient(var(--tp-site-green) 0 0) top left / 1.25rem 3px no-repeat,
    linear-gradient(var(--tp-site-green) 0 0) top left / 3px 1.25rem no-repeat,
    linear-gradient(var(--tp-site-green) 0 0) top right / 1.25rem 3px no-repeat,
    linear-gradient(var(--tp-site-green) 0 0) top right / 3px 1.25rem no-repeat,
    linear-gradient(var(--tp-site-green) 0 0) bottom left / 1.25rem 3px no-repeat,
    linear-gradient(var(--tp-site-green) 0 0) bottom left / 3px 1.25rem no-repeat,
    linear-gradient(var(--tp-site-green) 0 0) bottom right / 1.25rem 3px no-repeat,
    linear-gradient(var(--tp-site-green) 0 0) bottom right / 3px 1.25rem no-repeat;
}
.tp-cafe-scan .tp-cafe-qr { inline-size: 3.5rem; padding: 3px; border-radius: 4px; background: var(--tp-brand-white); }
.tp-cafe-scan__line {
  position: absolute;
  inset-inline: 0.3rem;
  inset-block-start: 50%;
  block-size: 2px;
  background: var(--tp-site-green);
  box-shadow: 0 0 10px var(--tp-site-green);
  animation: tp-cafe-sweep 2.4s ease-in-out infinite alternate;
}
@keyframes tp-cafe-sweep { from { transform: translateY(-2rem); } to { transform: translateY(2rem); } }
.tp-cafe-phone__cap { position: absolute; inset-block-end: 0.7rem; inset-inline: 0; text-align: center; font-size: 0.55rem; font-weight: var(--tp-site-fw-label); letter-spacing: 0.1em; text-transform: uppercase; color: var(--tp-site-block-muted); }
.tp-cafe-phone__screen--menu { place-items: stretch; align-content: start; gap: 0.35rem; padding: 1.25rem 0.4rem 0.7rem; }
.tp-cafe-phone__bar { display: flex; justify-content: space-between; gap: 0.4rem; padding-inline: 0.15rem; font-size: 0.5rem; font-weight: var(--tp-site-fw-label); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tp-brand-gray); }
.tp-cafe-phone__bar > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-cafe-phone__row { display: flex; align-items: center; gap: 0.3rem; padding: 0.35rem 0.35rem; border-radius: 0.5rem; background: var(--tp-site-navy-card); font-size: 0.58rem; line-height: 1.2; }
.tp-cafe-phone__row > span { min-inline-size: 0; }
.tp-cafe-phone__row b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--tp-site-fw-label); }
.tp-cafe-phone__row span span { color: var(--tp-brand-gray); }
/* The plus is drawn, not typed: a glyph sits on the font's baseline and never centres in the circle. */
.tp-cafe-phone__row i {
  flex: none;
  margin-inline-start: auto;
  inline-size: 1rem;
  block-size: 1rem;
  border-radius: var(--tp-site-radius-pill);
  background:
    linear-gradient(var(--tp-brand-blue), var(--tp-brand-blue)) center / 0.42rem 0.1rem no-repeat,
    linear-gradient(var(--tp-brand-blue), var(--tp-brand-blue)) center / 0.1rem 0.42rem no-repeat,
    var(--tp-brand-white);
}
.tp-cafe-phone__basket {
  position: absolute;
  inset-inline: 0.35rem;
  inset-block-end: 0.35rem;
  display: flex;
  justify-content: space-between;
  gap: 0.3rem;
  padding: 0.45rem 0.4rem;
  border-radius: 0.6rem;
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-size: 0.55rem;
  font-weight: var(--tp-site-fw-display);
  white-space: nowrap;
}
@media (prefers-reduced-motion: reduce) {
  .tp-cafe-scan__line { animation: none; }
}
`;
