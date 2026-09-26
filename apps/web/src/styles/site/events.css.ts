/**
 * Events: the PLAY / SMASH / WIN poster, a full-bleed block of the poster black
 * (full-brand2.pdf p13), then the tournaments announcement under it on the page's band
 * ground: a headline and the entry pass (EventsTicket.tsx, styles at the end).
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
/* The photo carries the words' knockout: a ring of the poster black the same width as
   theirs at each step (8, 11, 16px), so the bands stop short of its edges too. */
.tp-events__photo {
  grid-area: photo;
  justify-self: center;
  inline-size: min(88%, 30rem);
  aspect-ratio: 4 / 5;
  box-shadow: 0 0 0 8px var(--tp-site-poster);
}
@media (min-width: 30rem) { .tp-events__photo { box-shadow: 0 0 0 11px var(--tp-site-poster); } }
@media (min-width: 48rem) { .tp-events__photo { box-shadow: 0 0 0 16px var(--tp-site-poster); } }
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

@media (min-width: 60rem) {
  .tp-events__poster {
    grid-template-columns: minmax(0, 1.6fr) minmax(0, 1fr);
    grid-template-areas: 'words photo';
    align-items: center;
    column-gap: clamp(2rem, 5vw, 5rem);
  }
  .tp-events__photo { inline-size: 100%; }
}

.tp-events__note {
  position: relative;
  display: grid;
  gap: clamp(2rem, 5vw, 3rem);
  justify-items: center;
  text-align: center;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  margin-block-start: clamp(3rem, 8vw, 5rem);
  padding-inline: var(--tp-site-gutter);
  color: var(--tp-fg);
}
.tp-events__intro { display: grid; gap: 0.875rem; justify-items: center; }
.tp-events__eyebrow {
  font-size: var(--tp-site-fs-xs);
  font-weight: var(--tp-site-fw-label);
  letter-spacing: var(--tp-site-track-label);
  text-transform: uppercase;
  color: var(--tp-site-green-text);
}
[dir='rtl'] .tp-events__eyebrow { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
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

/* The entry pass. Sized to its own box (container units), so it lays out the same in
   any column: stacked with a horizontal tear line up to 45rem, the stub beside the ticket
   from there. The two halves are separate blocks, each with half-circle notches cut out
   of its side of the perforation by a mask (the page shows through, in either mode),
   which is why the green and the corner radii sit on the halves and not on the ticket.
   Ink is the brand navy and the handwriting the deep blue in both modes: the ticket is
   green in both. Tearing (data-torn) moves the stub away and draws the perforation on
   both torn edges; EventsTicket waits for the stub's transform to end before it leaves
   for WhatsApp. It tilts only where a pointer can hover to straighten it. */
.tp-ticket-box { container-type: inline-size; inline-size: min(100%, 57.5rem); }
.tp-ticket {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  color: var(--tp-site-navy);
  text-align: start;
  transition: transform 300ms var(--tp-site-ease-out), margin 500ms var(--tp-site-ease-out);
}
.tp-ticket[data-torn] { margin-block-end: 1.5rem; }
.tp-ticket__main, .tp-ticket__stub {
  position: relative;
  background: var(--tp-brand-green);
  transition: transform 700ms cubic-bezier(0.2, 0.9, 0.25, 1.15), border-color 250ms ease;
}
.tp-ticket__main {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: clamp(1rem, 2.6cqi, 1.625rem);
  padding: clamp(1.375rem, 4cqi, 2.5rem);
  overflow: hidden;
  border-block-end: 3px dashed transparent;
  border-start-start-radius: 18px;
  border-start-end-radius: 18px;
  -webkit-mask: radial-gradient(circle at 0 100%, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 100%, transparent 11px, var(--tp-brand-black) 11.5px); -webkit-mask-composite: source-in; mask: radial-gradient(circle at 0 100%, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 100%, transparent 11px, var(--tp-brand-black) 11.5px); mask-composite: intersect;
}
/* A faint court-line ring, the brand's ball path, behind the fields. */
.tp-ticket__main::after {
  content: '';
  position: absolute;
  inset-block-end: -120px;
  inset-inline-end: -60px;
  inline-size: 300px;
  block-size: 300px;
  border: 26px solid color-mix(in srgb, var(--tp-site-navy) 8%, transparent);
  border-radius: 50%;
  pointer-events: none;
}
.tp-ticket__row {
  display: flex;
  justify-content: space-between;
  gap: 0.75rem;
  font-size: 0.6875rem;
  font-weight: var(--tp-site-fw-label);
  letter-spacing: 0.18em;
  text-transform: uppercase;
}
.tp-ticket__title {
  font-family: var(--tp-font-display);
  font-size: clamp(2.125rem, 5.6cqi, 4.25rem);
  font-weight: var(--tp-site-fw-display);
  line-height: 0.86;
  letter-spacing: -0.02em;
  text-transform: uppercase;
}
.tp-ticket__fields {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1.125rem clamp(1.5rem, 4cqi, 2.5rem);
}
.tp-ticket__field, .tp-ticket__name { display: grid; gap: 0.5rem; }
.tp-ticket__label {
  font-size: 0.625rem;
  font-weight: var(--tp-site-fw-label);
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--tp-site-navy) 75%, transparent);
}
.tp-ticket__value {
  display: flex;
  align-items: flex-end;
  min-block-size: 1.875rem;
  padding-block-end: 0.25rem;
  overflow: hidden;
  border-block-end: 2px solid var(--tp-site-navy);
  font-size: 1.125rem;
  font-weight: var(--tp-site-fw-display);
  white-space: nowrap;
  text-overflow: ellipsis;
}
.tp-ticket__value--hand, .tp-ticket__input {
  font-family: var(--tp-font-hand);
  font-weight: 400;
  font-synthesis: none;
  color: var(--tp-site-block-deep);
}
.tp-ticket__value--hand { font-size: 1.5rem; }

.tp-ticket__stub {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 1.75rem;
  align-content: space-between;
  padding: clamp(1.375rem, 4cqi, 2.125rem);
  border-block-start: 3px dashed color-mix(in srgb, var(--tp-site-navy) 35%, transparent);
  border-end-start-radius: 18px;
  border-end-end-radius: 18px;
  transform-origin: 0 0;
  -webkit-mask: radial-gradient(circle at 0 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 0, transparent 11px, var(--tp-brand-black) 11.5px); -webkit-mask-composite: source-in; mask: radial-gradient(circle at 0 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 0, transparent 11px, var(--tp-brand-black) 11.5px); mask-composite: intersect;
}
.tp-ticket__name { text-align: start; }
.tp-ticket__input {
  inline-size: 100%;
  padding-block: 0.125rem 0.375rem;
  padding-inline: 0;
  border: 0;
  border-block-end: 2px solid var(--tp-site-navy);
  border-radius: 0;
  background: transparent;
  font-size: 1.625rem;
}
/* The field's focus is its line thickening, not the site's ring, which would box the
   handwriting (the button keeps a ring, in the ticket's navy: white on green is faint). */
.tp-site .tp-ticket__input:focus-visible { outline: none; box-shadow: 0 2px 0 var(--tp-site-navy); }
.tp-site .tp-ticket__go:focus-visible { outline-color: var(--tp-site-navy); }
.tp-ticket__input::placeholder { color: color-mix(in srgb, var(--tp-site-block-deep) 45%, transparent); }
.tp-ticket__input[readonly] { cursor: default; border-block-end-color: color-mix(in srgb, var(--tp-site-navy) 35%, transparent); }
.tp-ticket__name[data-nudge] .tp-ticket__input { animation: tp-ticket-nudge 400ms ease; }
@keyframes tp-ticket-nudge { 20%, 60% { transform: translateX(-6px); } 40%, 80% { transform: translateX(6px); } }
.tp-ticket__note { font-size: 0.75rem; line-height: 1.4; color: color-mix(in srgb, var(--tp-site-navy) 80%, transparent); }
.tp-ticket__send { display: grid; gap: 0.875rem; justify-items: center; text-align: center; }
.tp-ticket__go {
  background: var(--tp-site-navy);
  color: var(--tp-brand-white);
  --tp-btn-hover: var(--tp-site-block-deep);
  padding-inline: 1.125rem;
  font-size: 0.8125rem;
  letter-spacing: 0.06em;
  white-space: nowrap;
}
[dir='rtl'] .tp-ticket__go { font-size: 1rem; letter-spacing: 0; }
.tp-ticket__go[aria-disabled='true'] { opacity: 0.4; cursor: not-allowed; }
.tp-ticket__go[aria-disabled='true']::before { display: none; }
.tp-ticket__tear {
  font-size: 0.6875rem;
  font-weight: var(--tp-site-fw-label);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: color-mix(in srgb, var(--tp-site-navy) 75%, transparent);
}
.tp-ticket__barcode { display: block; inline-size: 100%; max-inline-size: 13.75rem; block-size: 2.75rem; fill: var(--tp-site-navy); }

/* Torn, stacked: the stub drops and tips; both torn edges keep the perforation. */
.tp-ticket[data-torn] .tp-ticket__main { transform: translateY(-4px); border-block-end-color: color-mix(in srgb, var(--tp-site-navy) 55%, transparent); }
.tp-ticket[data-torn] .tp-ticket__stub { transform: translate(6px, 22px) rotate(3deg); border-color: color-mix(in srgb, var(--tp-site-navy) 55%, transparent); }
[dir='rtl'] .tp-ticket__stub { transform-origin: 100% 0; }
[dir='rtl'] .tp-ticket[data-torn] .tp-ticket__stub { transform: translate(-6px, 22px) rotate(-3deg); }

/* Arabic: no capitals or tracking, taller lines, the Ruqaa hand at its bold. */
[dir='rtl'] .tp-ticket__row, [dir='rtl'] .tp-ticket__label, [dir='rtl'] .tp-ticket__tear { letter-spacing: 0; text-transform: none; }
[dir='rtl'] .tp-ticket__row, [dir='rtl'] .tp-ticket__tear { font-size: 0.8125rem; }
[dir='rtl'] .tp-ticket__label { font-size: 0.75rem; }
[dir='rtl'] .tp-ticket__title { text-transform: none; letter-spacing: 0; line-height: 1.15; }
[dir='rtl'] .tp-ticket__value--hand, [dir='rtl'] .tp-ticket__input { font-weight: 700; }
[dir='rtl'] .tp-ticket__value--hand { font-size: 1.375rem; }
[dir='rtl'] .tp-ticket__value { min-block-size: 2.25rem; }

@container (min-width: 45rem) {
  .tp-ticket { grid-template-columns: minmax(0, 1fr) 20rem; }
  .tp-ticket__main {
    padding-inline-end: clamp(3rem, 7cqi, 4.5rem);
    border-block-end: 0;
    border-inline-end: 3px dashed transparent;
    border-start-end-radius: 0;
    border-end-start-radius: 18px;
    -webkit-mask: radial-gradient(circle at 100% 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 100%, transparent 11px, var(--tp-brand-black) 11.5px); -webkit-mask-composite: source-in; mask: radial-gradient(circle at 100% 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 100%, transparent 11px, var(--tp-brand-black) 11.5px); mask-composite: intersect;
  }
  .tp-ticket__stub {
    border-block-start: 0;
    border-inline-start: 3px dashed color-mix(in srgb, var(--tp-site-navy) 35%, transparent);
    border-start-end-radius: 18px;
    border-end-start-radius: 0;
    transform-origin: 0 100%;
    -webkit-mask: radial-gradient(circle at 0 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 0 100%, transparent 11px, var(--tp-brand-black) 11.5px); -webkit-mask-composite: source-in; mask: radial-gradient(circle at 0 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 0 100%, transparent 11px, var(--tp-brand-black) 11.5px); mask-composite: intersect;
  }
  .tp-ticket[data-torn] .tp-ticket__main { transform: translateX(-6px) rotate(-0.6deg); border-inline-end-color: color-mix(in srgb, var(--tp-site-navy) 55%, transparent); }
  .tp-ticket[data-torn] .tp-ticket__stub { transform: translate(34px, 10px) rotate(7deg); }
  [dir='rtl'] .tp-ticket__main { -webkit-mask: radial-gradient(circle at 0 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 0 100%, transparent 11px, var(--tp-brand-black) 11.5px); -webkit-mask-composite: source-in; mask: radial-gradient(circle at 0 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 0 100%, transparent 11px, var(--tp-brand-black) 11.5px); mask-composite: intersect; }
  [dir='rtl'] .tp-ticket__stub { transform-origin: 100% 100%; -webkit-mask: radial-gradient(circle at 100% 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 100%, transparent 11px, var(--tp-brand-black) 11.5px); -webkit-mask-composite: source-in; mask: radial-gradient(circle at 100% 0, transparent 11px, var(--tp-brand-black) 11.5px), radial-gradient(circle at 100% 100%, transparent 11px, var(--tp-brand-black) 11.5px); mask-composite: intersect; }
  [dir='rtl'] .tp-ticket[data-torn] .tp-ticket__main { transform: translateX(6px) rotate(0.6deg); }
  [dir='rtl'] .tp-ticket[data-torn] .tp-ticket__stub { transform: translate(-34px, 10px) rotate(-7deg); }
  @media (hover: hover) {
    .tp-ticket { transform: rotate(-2deg); }
    .tp-ticket:hover { transform: none; }
    [dir='rtl'] .tp-ticket { transform: rotate(2deg); }
    [dir='rtl'] .tp-ticket:hover { transform: none; }
  }
}

@media (prefers-reduced-motion: reduce) {
  .tp-ticket, .tp-ticket__main, .tp-ticket__stub { transition: none; }
  .tp-ticket__name[data-nudge] .tp-ticket__input { animation: none; }
}
`;
