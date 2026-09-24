/**
 * The two photo-and-words sections. With the court (#club), the poster photo (events) and
 * the app screen all standing at the inline end, these two put their photo on the
 * reading-start side, so the photographs alternate as the page scrolls: court at the end,
 * lessons at the start, the poster at the end, the café at the start, the app screen at
 * the end.
 *
 * - Lessons: the photo runs to the screen's edge on the reading-start side for the
 *   section's full height; the words sit in the other half, the action under them. Side
 *   by side only from 60rem: a half-width column on a tablet is too narrow to hold both
 *   the player's face and the ball. Narrower it stacks WORDS FIRST, because #club ends on
 *   its court photo and two photographs must not meet across the section edge.
 * - Touch Cafe: the photo first, the café's mark set flat on its corner nearest the words
 *   (never rotated, never shadowed: logo rules §2.4), then the words (stacked the same way
 *   on phones: it follows the events words).
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
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'art' 'copy';
  gap: clamp(3.5rem, 9vw, 5rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-cafe-handoff__copy { grid-area: copy; display: grid; gap: clamp(1.5rem, 3vw, 2rem); justify-items: start; align-content: center; }
.tp-cafe-handoff__head { justify-self: stretch; --tp-fit: 10.3; --tp-cap: 6.25rem; }
[dir='rtl'] .tp-cafe-handoff__head { --tp-fit: 19.8; }
.tp-cafe-handoff__art { grid-area: art; position: relative; }
.tp-cafe-handoff__photo { aspect-ratio: 4 / 3; }
.tp-cafe-handoff__mark {
  position: absolute;
  inset-block-end: calc(-1 * clamp(1.75rem, 5vw, 2.75rem));
  inset-inline-start: clamp(1rem, 4vw, 2.5rem);
  inline-size: clamp(5.5rem, 17vw, 9.5rem);
  block-size: auto;
  aspect-ratio: 1;
  border-radius: 22%;
}
@media (min-width: 48rem) {
  .tp-cafe-handoff__inner {
    grid-template-columns: minmax(0, 1.1fr) minmax(0, 0.9fr);
    grid-template-areas: 'art copy';
    align-items: center;
    column-gap: clamp(3rem, 7vw, 7rem);
  }
  .tp-cafe-handoff__photo { aspect-ratio: 5 / 4; }
  .tp-cafe-handoff__mark { inset-inline-start: auto; inset-inline-end: clamp(1rem, 4vw, 2.5rem); }
}
`;
