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

.tp-coach-cards { display: grid; gap: 1.25rem; grid-template-columns: minmax(0, 1fr); }
@media (min-width: 40rem) { .tp-coach-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
.tp-coach-card {
  display: grid;
  grid-template-rows: auto 1fr;
  overflow: clip;
  border-radius: var(--tp-site-radius-md);
  background: var(--tp-site-band-bg);
}
.tp-coach-card__photo {
  position: relative;
  display: grid;
  place-items: center;
  aspect-ratio: 4 / 3;
  overflow: clip;
  background: var(--tp-site-tint);
}
.tp-coach-card__photo img { object-fit: cover; }
.tp-coach-card__photo[data-letter] {
  font-family: var(--tp-font-display);
  font-size: clamp(3.5rem, 10vw, 5rem);
  font-weight: var(--tp-site-fw-display);
  color: var(--tp-site-display-2);
}
.tp-coach-card__body { display: grid; align-content: start; justify-items: start; gap: 0.875rem; padding: clamp(1.25rem, 3vw, 1.75rem); }
.tp-coach-card__name { font-family: var(--tp-font-display); font-size: 1.5rem; font-weight: var(--tp-site-fw-display); line-height: 1.15; color: var(--tp-fg); }
[dir='rtl'] .tp-coach-card__name { line-height: 1.4; }
.tp-coach-card__bio {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 4;
  line-clamp: 4;
  overflow: hidden;
  max-inline-size: 60ch;
  line-height: var(--tp-site-lh-body);
  color: var(--tp-site-ink-2);
}
.tp-coach-card__types, .tp-coach-face-list { display: flex; flex-wrap: wrap; gap: 0.5rem; }
.tp-coach-card__types li {
  display: inline-flex;
  align-items: center;
  min-block-size: 2rem;
  padding-inline: 0.75rem;
  border: 1.5px solid var(--tp-border);
  border-radius: var(--tp-site-radius-pill);
  font-size: var(--tp-site-fs-sm);
  font-weight: 700;
  line-height: 1.2;
}
.tp-coach-card__price { font-weight: 700; color: var(--tp-fg); }
.tp-coach-card__book { margin-block-start: 0.25rem; }

.tp-coach-types { display: grid; gap: clamp(1.5rem, 4vw, 2.5rem); grid-template-columns: repeat(auto-fit, minmax(min(100%, 18rem), 1fr)); }
.tp-coach-types__group { display: grid; align-content: start; gap: 0.5rem; }
.tp-coach-types__kind {
  font-size: var(--tp-site-fs-xs);
  font-weight: var(--tp-site-fw-label);
  letter-spacing: var(--tp-site-track-label);
  text-transform: uppercase;
  color: var(--tp-site-green-text);
}
[dir='rtl'] .tp-coach-types__kind { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-coach-types__list { display: grid; }
.tp-coach-type { display: grid; gap: 0.25rem; padding-block: 0.875rem; border-block-start: 1px solid var(--tp-border); }
.tp-coach-type__name { font-size: 1.125rem; font-weight: var(--tp-site-fw-label); line-height: 1.3; color: var(--tp-fg); }
.tp-coach-type__line { font-size: var(--tp-site-fs-sm); color: var(--tp-site-ink-2); }
.tp-coach-type__desc { max-inline-size: 60ch; font-size: var(--tp-site-fs-sm); line-height: var(--tp-site-lh-body); color: var(--tp-site-ink-2); }
.tp-coach-type__price { font-weight: 700; color: var(--tp-fg); }

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
