/**
 * `#club`: the words and the four facts in one column, a court photo under them; in the
 * other, the live court on its own full-bleed Touch Blue field (the court-line bands
 * inside it), "Book a court" riding the net. Phones and tablets: words, facts, the field
 * across the screen with the court in it; the photo is dropped there.
 *
 * The field is the page's blue block in LIGHT mode too, so light keeps the brand's blue
 * share without giving up the app's light ground under the words.
 */
export const siteClubCss = `
.tp-club {
  position: relative;
  overflow: clip;
  background: var(--tp-site-hero-bg);
  padding-block: var(--tp-site-section-pad);
}
.tp-club__inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-template-areas: 'copy' 'stage' 'photo';
  row-gap: clamp(2.5rem, 7vw, 4rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-club__copy { grid-area: copy; display: grid; gap: clamp(1.25rem, 3vw, 2rem); align-content: start; }
.tp-club__head { --tp-fit: 12; --tp-cap: 6.75rem; }
[dir='rtl'] .tp-club__head { --tp-fit: 17.4; }
.tp-club__body {
  max-inline-size: 44ch;
  font-size: var(--tp-site-fs-lg);
  line-height: 1.55;
  color: var(--tp-site-ink-2);
  text-wrap: pretty;
}

/* The four facts: short lines on hairlines, each marked with the brand's ball. Not
   cards, not an icon grid. */
.tp-points { display: grid; margin-block-start: 0.25rem; }
.tp-point {
  display: flex;
  align-items: center;
  gap: 0.875rem;
  min-block-size: 3.5rem;
  padding-block: 0.75rem;
  border-block-start: 1px solid var(--tp-border);
  font-weight: 700;
  line-height: 1.3;
}
.tp-point:last-child { border-block-end: 1px solid var(--tp-border); }
.tp-point__ball { flex: none; inline-size: 1.25rem; block-size: 1.25rem; }
@media (min-width: 40rem) and (max-width: 59.99rem) {
  .tp-points { grid-template-columns: repeat(2, minmax(0, 1fr)); column-gap: clamp(1.5rem, 3vw, 2.5rem); }
  .tp-point:nth-last-child(2) { border-block-end: 1px solid var(--tp-border); }
}

.tp-club__stage {
  grid-area: stage;
  position: relative;
  display: grid;
  place-items: center;
  padding-block: clamp(2rem, 7vw, 3rem);
}
.tp-club__field {
  position: absolute;
  inset-block: 0;
  inset-inline: calc(-1 * var(--tp-site-gutter));
  overflow: hidden;
  background: var(--tp-site-block);
}
.tp-club__court-box {
  position: relative;
  inline-size: min(100%, calc(70svh * 320 / 396), 30rem);
  aspect-ratio: 320 / 396;
  container-type: inline-size;
}
/* The green CTA rides the net (CourtStage anchors it on the projected tape), about as
   wide as the app's "Check availability" is on the court, never wrapped, its type and
   padding scaled to the court box (cqi) so a smaller court gets a smaller button. */
.tp-club__cta {
  min-inline-size: min(calc(var(--tp-court-net-w, 78cqi) * 0.8), 84cqi);
  padding-inline: clamp(1rem, 5.5cqi, 2rem);
  font-size: clamp(0.875rem, 4.3cqi, 1.0625rem);
  white-space: nowrap;
  box-shadow: var(--tp-site-shadow-card);
}
[dir='rtl'] .tp-club__cta { font-size: clamp(1rem, 4.8cqi, 1.1875rem); }
/* 5:4 out of the 3:2 frame, held to its first column: that crop drops exactly the
   black post at the frame's right edge (club.jpg), leaving the net and the glass. */
.tp-club__photo { grid-area: photo; aspect-ratio: 5 / 4; }
.tp-club__photo .tp-photo__img { object-position: 0% 50%; }
/* The one-column layout ends on the court's field; the photo only shows beside it. With
   no photo row the field runs to the section's end, and the section drops its bottom pad
   so no strip of page ground is left under it. */
@media (max-width: 59.99rem) {
  .tp-club { padding-block-end: 0; }
  .tp-club__inner { grid-template-areas: 'copy' 'stage'; }
  .tp-club__photo { display: none; }
}

@media (min-width: 60rem) {
  .tp-club__inner {
    grid-template-columns: minmax(0, 1.05fr) minmax(0, 0.95fr);
    grid-template-areas: 'copy stage' 'photo stage';
    grid-template-rows: auto 1fr;
    --tp-club-gap: clamp(3rem, 7vw, 7rem);
    column-gap: var(--tp-club-gap);
  }
  .tp-club__photo { align-self: end; }
  /* The words, the facts and the photo slide left, clear of the blue field that starts
     at the screen's midline (without this their column ends ~0.5gap short of it and
     reads as attached to it). Moved, not narrowed: the start margin pulls them into
     the page's side margin by as much as it shrinks the end, never closer than 1rem
     to the screen's edge (owner, 2026-09-25). */
  .tp-club__copy,
  .tp-club__photo {
    --tp-club-shift: min(
      clamp(2rem, 6vw, 6rem),
      max(0px, (100vw - var(--tp-site-max)) / 2) + var(--tp-site-gutter) - 1rem
    );
    margin-inline: calc(-1 * var(--tp-club-shift)) var(--tp-club-shift);
  }
  /* The stage is the section's full height and the court rides it: pinned in the
     middle of the screen while the words, the facts and the photo scroll past, then it
     leaves with the section (and the scroll-linked camera pitches as it goes). */
  .tp-club__stage { align-self: stretch; place-items: start center; padding-block: 0; }
  /* The field runs the section's full height and out to the screen's inline end. It
     starts on the screen's midline, where the lessons photo below ends, so the two
     edges stand in one line. The stage's start sits past the midline by
     0.025W - 0.05g + 0.475gap (W the column's width, g the gutter): the 1.05 / 0.95
     split of W - 2g - gap, plus the gap, less half of W. */
  .tp-club__stage {
    --tp-club-field-start: calc(
      0.025 * min(100vw, var(--tp-site-max)) - 0.05 * var(--tp-site-gutter) + 0.475 * var(--tp-club-gap)
    );
    --tp-club-field-end: calc(max(0px, (100vw - var(--tp-site-max)) / 2) + var(--tp-site-gutter));
  }
  .tp-club__field {
    inset-block: calc(-1 * var(--tp-site-section-pad));
    inset-inline-start: calc(-1 * var(--tp-club-field-start));
    inset-inline-end: calc(-1 * var(--tp-club-field-end));
  }
  /* The court fills its box at every pitch (features/court3d/framing.ts), so the box is
     the court's size: as wide as the whole blue FIELD allows (not just its column; the
     translate below centres it there), and as tall as the screen under the header
     allows, capped for tall monitors (owner asked for a bigger court, 2026-09-25). */
  .tp-club__court-box {
    --tp-club-court-hmax: min(88svh, 100svh - var(--tp-site-header-h) - 2rem);
    position: sticky;
    inset-block-start: calc(var(--tp-site-header-h) + max(1rem, (100svh - var(--tp-site-header-h) - var(--tp-club-court-hmax)) / 2));
    inline-size: min(
      calc(100% + var(--tp-club-field-start) + var(--tp-club-field-end) - 2rem),
      calc(var(--tp-club-court-hmax) * 320 / 396),
      48rem
    );
    /* Centred on the FIELD, not the stage: the field reaches further out at the inline
       end, so the court moves that way by half the difference (owner, 2026-09-25). */
    translate: calc((var(--tp-club-field-end) - var(--tp-club-field-start)) / 2) 0;
  }
  [dir='rtl'] .tp-club__court-box {
    translate: calc((var(--tp-club-field-start) - var(--tp-club-field-end)) / 2) 0;
  }
}
`;
