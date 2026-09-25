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
.tp-lessons__head { --tp-fit: 12.8; --tp-cap: 6.25rem; }
[dir='rtl'] .tp-lessons__head { --tp-fit: 13; }
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
.tp-cafe-table { position: relative; inline-size: 11rem; aspect-ratio: 1; border-radius: var(--tp-site-radius-pill); background: var(--tp-site-block); }
.tp-cafe-table__no { position: absolute; inset-block-end: 2.6rem; inset-inline-start: 2.1rem; font-size: 0.75rem; font-weight: var(--tp-site-fw-display); letter-spacing: 0.1em; color: var(--tp-brand-white); }
.tp-cafe-table__cup {
  position: absolute;
  inset-block-start: 1.6rem;
  inset-inline-start: 2rem;
  inline-size: 3rem;
  aspect-ratio: 1;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-brand-white);
  box-shadow: inset 0 0 0 0.55rem var(--tp-site-block-muted);
}
.tp-cafe-table__cup::after {
  content: '';
  position: absolute;
  inset-block-start: 50%;
  inset-inline-end: -0.8rem;
  inline-size: 0.9rem;
  block-size: 0.5rem;
  border-start-end-radius: 0.3rem;
  border-end-end-radius: 0.3rem;
  background: var(--tp-site-block-muted);
}
.tp-cafe-table__tent { position: absolute; inset-block-end: 1.6rem; inset-inline-end: 1.8rem; padding: 4px; border-radius: 6px; background: var(--tp-brand-white); }

.tp-cafe-phone { inline-size: 8.5rem; block-size: 13.5rem; padding: 0.45rem; border-radius: 1.4rem; background: var(--tp-site-poster); }
.tp-cafe-phone__screen {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 100%;
  block-size: 100%;
  overflow: clip;
  border-radius: 1rem;
  background: var(--tp-site-navy);
  color: var(--tp-brand-white);
}
.tp-cafe-phone__mark { inline-size: 3.5rem; block-size: 3.5rem; }
.tp-cafe-scan { position: relative; display: grid; place-items: center; inline-size: 5.5rem; aspect-ratio: 1; }
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
.tp-cafe-scan .tp-cafe-qr { inline-size: 3.9rem; padding: 3px; border-radius: 4px; background: var(--tp-brand-white); }
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
.tp-cafe-phone__cap { position: absolute; inset-block-end: 0.7rem; inset-inline: 0; text-align: center; font-size: 0.6rem; font-weight: var(--tp-site-fw-label); letter-spacing: 0.1em; text-transform: uppercase; color: var(--tp-site-block-muted); }
.tp-cafe-phone__screen--menu { place-items: stretch; align-content: start; gap: 0.35rem; padding: 0.6rem 0.5rem; }
.tp-cafe-phone__bar { display: flex; justify-content: space-between; gap: 0.5rem; padding-inline: 0.15rem; font-size: 0.55rem; font-weight: var(--tp-site-fw-label); letter-spacing: 0.08em; text-transform: uppercase; color: var(--tp-brand-gray); }
.tp-cafe-phone__bar > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.tp-cafe-phone__row { display: flex; align-items: center; gap: 0.35rem; padding: 0.35rem 0.4rem; border-radius: 0.5rem; background: var(--tp-site-navy-card); font-size: 0.62rem; line-height: 1.2; }
.tp-cafe-phone__row > span { min-inline-size: 0; }
.tp-cafe-phone__row b { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: var(--tp-site-fw-label); }
.tp-cafe-phone__row span span { color: var(--tp-brand-gray); }
.tp-cafe-phone__row i {
  display: grid;
  place-items: center;
  flex: none;
  margin-inline-start: auto;
  inline-size: 1.1rem;
  block-size: 1.1rem;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-brand-white);
  color: var(--tp-brand-blue);
  font-style: normal;
  font-weight: var(--tp-site-fw-display);
  font-size: 0.7rem;
}
.tp-cafe-phone__basket {
  position: absolute;
  inset-inline: 0.45rem;
  inset-block-end: 0.45rem;
  display: flex;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.45rem 0.55rem;
  border-radius: 0.6rem;
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-size: 0.6rem;
  font-weight: var(--tp-site-fw-display);
}
@media (prefers-reduced-motion: reduce) {
  .tp-cafe-scan__line { animation: none; }
}
`;
