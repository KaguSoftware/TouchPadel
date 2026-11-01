/**
 * Coaching on the site (docs/design/coaching/guest.md §4.14): the `/coaching` page (the head,
 * the per-branch heading, the coach cards, the lesson types by kind, the sessions with places,
 * the app block and the WhatsApp ask) and the landing's coaches strip inside `#lessons`.
 *
 * - Coach cards: one column on a phone, two from 40rem (the photo's `sizes` says the same);
 *   the photo on top at 4:3, or the coach's first letter on the tint; the bio clamped to four
 *   lines; the lesson types as small pills; "Book in the app" in the green.
 * - Sessions: a row each, the time and places left reading first; the whole row is the coach's
 *   link. No transition anywhere, so no reduced-motion block is needed.
 *
 * Guarded with the other site modules by site-css.test.ts: logical properties only, colours
 * only through `var(--tp-*)`.
 */
export const siteCoachingCss = `
.tp-coaching {
  display: grid;
  gap: clamp(2.5rem, 6vw, 4rem);
  inline-size: 100%;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-block: calc(var(--tp-site-header-h) + clamp(2rem, 6vw, 4.5rem)) clamp(4rem, 9vw, 7rem);
  padding-inline: var(--tp-site-gutter);
}
.tp-coaching__head { display: grid; gap: clamp(1.25rem, 3vw, 1.75rem); }
.tp-coaching__title { --tp-fit: 18; --tp-cap: 6.25rem; }
[dir='rtl'] .tp-coaching__title { --tp-fit: 24; }
/* In Black, tracked tight, the word space all but closes and "AT TOUCH" read as one word.
   Line one ("COACHING") stays the longest, so the fit is unchanged. Arabic is untracked. */
.tp-coaching__title .tp-display__l2 { word-spacing: 0.25em; }
[dir='rtl'] .tp-coaching__title .tp-display__l2 { word-spacing: normal; }
.tp-coaching__intro, .tp-coaching__ask-body, .tp-coaching__app-body {
  max-inline-size: 44ch;
  font-size: var(--tp-site-fs-lg);
  line-height: 1.55;
  color: var(--tp-site-ink-2);
  text-wrap: pretty;
}
.tp-coaching__branch { display: grid; gap: clamp(2rem, 5vw, 3rem); }
.tp-coaching__branch-name, .tp-coaching__h {
  font-family: var(--tp-font-display);
  font-weight: var(--tp-site-fw-display);
  line-height: 1.1;
  color: var(--tp-site-display-1);
}
.tp-coaching__branch-name { font-size: var(--tp-site-fs-2xl); padding-block-end: 0.75rem; border-block-end: 1px solid var(--tp-border); }
.tp-coaching__h { font-size: var(--tp-site-fs-xl); }
[dir='rtl'] .tp-coaching__branch-name, [dir='rtl'] .tp-coaching__h { line-height: 1.4; }
.tp-coaching__part { display: grid; gap: clamp(1.25rem, 3vw, 1.75rem); }

.tp-coach-cards { display: grid; gap: 0.75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
@media (min-width: 48rem) { .tp-coach-cards { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.25rem; } }
@media (max-width: 22.49rem) { .tp-coach-cards { grid-template-columns: minmax(0, 20rem); justify-content: center; } }
/* The app's coach card (CoachCard): a bordered card, the photo or the brand-blue tile across the
   top, then the name and "From {price}". The whole card is the link. */
.tp-coach-card {
  display: block;
  overflow: clip;
  border: 1px solid var(--tp-border);
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-surface);
  color: var(--tp-fg);
  text-decoration: none;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--tp-site-header-day-fg) 12%, transparent);
}
.tp-site[data-mode='night'] .tp-coach-card { box-shadow: none; }
.tp-coach-card__photo {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 3 / 2;
  overflow: clip;
  background: var(--tp-site-block);
}
.tp-coach-card__photo img { object-fit: cover; }
.tp-coach-card__photo[data-letter] { isolation: isolate; }
.tp-coach-card .tp-coach-card__pattern { z-index: var(--tp-site-z-below); opacity: 0.16; }
.tp-coach-card__pattern .tp-pattern__bands { stroke: var(--tp-brand-white); }
/* No photo: the initial alone, big and bold in brand green on the blue tile. */
.tp-coach-photo__initial { display: inline-grid; place-items: center; }
.tp-coach-card__photo[data-letter] .tp-coach-photo__initial {
  position: absolute;
  inset: 0;
  color: var(--tp-site-green);
  font-family: var(--tp-font-display);
  font-size: 6rem;
  font-weight: 900;
  line-height: 1;
  /* Trim the line box to the letter itself so its visible centre is the tile's centre. */
  text-box: trim-both cap alphabetic;
}
.tp-coach-card__body { display: grid; grid-template-rows: auto 1.25rem; align-content: start; gap: 0.375rem; padding: 0.75rem; }
.tp-coach-card__name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--tp-font-display);
  font-size: 0.9375rem;
  font-weight: var(--tp-site-fw-display);
  line-height: 1.3;
  color: var(--tp-fg);
}
.tp-coach-card__price {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-block-size: 1.2em;
  font-size: 0.75rem;
  font-weight: 700;
  color: var(--tp-site-green-text);
}
.tp-coach-face-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }

/* The lesson cards: one grid across the kinds (the groups and lists dissolve, the kind's own
   heading stays for screen readers and each card names its kind in the band). A card is a
   band with the kind and the name (Touch Blue in light mode, brand green in night), then the duration, the description and the
   price on a single line. */
.tp-coach-types { display: grid; gap: 0.75rem; grid-template-columns: repeat(2, minmax(0, 1fr)); }
/* Under 22.5rem (360px) two would be too narrow for the price: one card, the same width as ever, centred. */
@media (max-width: 22.49rem) { .tp-coach-types { grid-template-columns: minmax(0, 20rem); justify-content: center; } }
@media (min-width: 48rem) { .tp-coach-types { grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 1.25rem; } }
@media (min-width: 64rem) { .tp-coach-types { grid-template-columns: repeat(4, minmax(0, 1fr)); } }
.tp-coach-types__group, .tp-coach-types__list { display: contents; }
.tp-coach-types__kind {
  position: absolute;
  inline-size: 1px;
  block-size: 1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.tp-coach-type {
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: clip;
  border: 1px solid var(--tp-border);
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-surface);
  list-style: none;
  container-type: inline-size;
}
.tp-coach-type__band {
  display: grid;
  align-content: space-between;
  gap: 1.5rem;
  min-block-size: 8.5rem;
  padding: 0.875rem;
  background: var(--tp-site-block);
  color: var(--tp-brand-white);
}
.tp-site[data-mode='night'] .tp-coach-type__band { background: var(--tp-site-green); color: var(--tp-site-green-ink); }
.tp-coach-type__kind { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; }
[dir='rtl'] .tp-coach-type__kind { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-coach-type__name { font-size: clamp(0.9375rem, 8.5cqi, 1.45rem); font-weight: 800; line-height: 1.15; }
.tp-coach-type__body { display: grid; align-content: space-between; gap: 0.625rem; padding: 0.75rem 0.875rem 0.875rem; }
.tp-coach-type__line { font-size: var(--tp-site-fs-sm); font-weight: 600; color: var(--tp-fg); }
.tp-coach-type__desc { font-size: var(--tp-site-fs-sm); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-coach-type__price { font-size: clamp(0.8125rem, 8cqi, 1.375rem); font-weight: 800; white-space: nowrap; color: var(--tp-site-green-text); }
.tp-coach-type__unit { font-size: 0.72em; font-weight: 600; }

.tp-coach-sessions { display: grid; gap: 0.75rem; }
.tp-coach-session {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 0.25rem 1.5rem;
  min-block-size: var(--tp-site-touch);
  padding-block: 1rem;
  padding-inline: 1.25rem;
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-site-band-bg);
  color: var(--tp-fg);
  text-decoration: none;
}
@media (hover: hover) { .tp-coach-session:hover { background: var(--tp-site-tint); } }
@media (min-width: 48rem) {
  .tp-coach-session { grid-template-columns: minmax(0, 1fr) auto; }
  .tp-coach-session__places, .tp-coach-session__price { grid-column: 2; text-align: end; }
  .tp-coach-session__places { grid-row: 1; }
  .tp-coach-session__price { grid-row: 2; }
}
.tp-coach-session__when { font-size: var(--tp-site-fs-sm); font-weight: var(--tp-site-fw-label); color: var(--tp-site-green-text); }
.tp-coach-session__what { font-size: 1.125rem; font-weight: var(--tp-site-fw-label); line-height: 1.3; }
.tp-coach-session__who { font-size: var(--tp-site-fs-sm); color: var(--tp-site-ink-2); }
.tp-coach-session__places { font-weight: 700; }
.tp-coach-session__price { font-size: var(--tp-site-fs-sm); color: var(--tp-site-ink-2); }

.tp-coaching__app, .tp-coaching__ask { display: grid; justify-items: start; gap: 1.5rem; }
.tp-coaching__app { padding-block-start: clamp(2rem, 5vw, 3rem); border-block-start: 1px solid var(--tp-border); }
.tp-coaching__ctas, .tp-lessons__ctas { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.tp-coaching__error {
  max-inline-size: 44ch;
  padding-block: 0.875rem;
  padding-inline: 1.125rem;
  border: 1px solid var(--tp-site-error-border);
  border-radius: var(--tp-site-radius-sm);
  background: var(--tp-site-error-bg);
  color: var(--tp-site-error-fg);
  font-weight: 700;
}

/* The landing's coaches strip inside #lessons: up to four faces, each its coach's link. */
.tp-lessons__coaches { display: grid; gap: 0.75rem; }
.tp-lessons__coaches-label { font-size: var(--tp-site-fs-xs); font-weight: var(--tp-site-fw-label); letter-spacing: var(--tp-site-track-label); text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-lessons__coaches-label { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-coach-face {
  display: inline-flex;
  align-items: center;
  gap: 0.625rem;
  min-block-size: var(--tp-site-touch);
  padding-block: 0.25rem;
  padding-inline: 0.25rem 1rem;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-tint);
  color: var(--tp-fg);
  font-weight: 700;
  text-decoration: none;
}
.tp-coach-face__photo {
  position: relative;
  display: grid;
  place-items: center;
  inline-size: 2.75rem;
  block-size: 2.75rem;
  overflow: clip;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-band-bg);
}
.tp-coach-face__photo img { object-fit: cover; }
.tp-coach-face__photo[data-letter] { font-family: var(--tp-font-display); font-weight: var(--tp-site-fw-display); color: var(--tp-site-display-2); }
`;
