/**
 * The app band (option E, 2026-09-25): on a wide screen the words in one column (the
 * two-weight title, the three promises as a list, how to book until then, the store
 * badges) and one phone in the other, standing on the band's bottom edge and cut off by
 * it. The phone shows the real app screen for the promise picked; the screens cross-fade.
 * Narrower, the phone follows the words.
 */
export const siteAppBandCss = `
.tp-appband {
  overflow: hidden;
  background: var(--tp-site-band-bg);
  border-block: 1px solid var(--tp-border);
}
.tp-appband__inner {
  display: grid;
  column-gap: clamp(2rem, 5vw, 4.5rem);
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-appband__copy {
  display: grid;
  gap: 1.5rem;
  justify-items: start;
  align-content: center;
  padding-block: clamp(3.5rem, 8vw, 6rem) 2.5rem;
}
.tp-appband__title { font-size: clamp(2.25rem, 1.4rem + 3.2vw, 3.5rem); }
.tp-appband__body { max-inline-size: 52ch; color: var(--tp-site-ink-2); text-wrap: pretty; }
.tp-appband__ctas { display: flex; flex-wrap: wrap; gap: 0.75rem; }

/* The promises: a vertical list, the picked one marked by its green edge. */
.tp-appband__tabs { display: grid; gap: 0.25rem; inline-size: 100%; max-inline-size: 30rem; }
.tp-appband__tab {
  display: grid;
  gap: 0.125rem;
  padding-block: 0.625rem;
  padding-inline: 1.125rem 0;
  border: 0;
  border-inline-start: 2px solid var(--tp-border);
  background: none;
  color: var(--tp-site-ink-2);
  font: inherit;
  text-align: start;
  cursor: pointer;
  transition: border-color var(--tp-site-dur-fast) var(--tp-site-ease-out), color var(--tp-site-dur-fast) var(--tp-site-ease-out);
}
.tp-appband__tab-eyebrow {
  font-size: var(--tp-site-fs-xs);
  font-weight: var(--tp-site-fw-label);
  letter-spacing: var(--tp-site-track-label);
  text-transform: uppercase;
  color: var(--tp-muted-fg);
}
[dir='rtl'] .tp-appband__tab-eyebrow { letter-spacing: 0; text-transform: none; font-size: var(--tp-site-fs-sm); }
.tp-appband__tab-title {
  font-family: var(--tp-font-display);
  font-size: 1.1875rem;
  font-weight: var(--tp-site-fw-display);
  line-height: 1.2;
}
@media (hover: hover) { .tp-appband__tab:hover { color: var(--tp-fg); } }
.tp-appband__tab[aria-selected='true'] { border-inline-start-color: var(--tp-site-green-text); color: var(--tp-fg); }
.tp-appband__tab[aria-selected='true'] .tp-appband__tab-eyebrow { color: var(--tp-site-green-text); }

/* The phone: its screens stacked in one box, the box shorter than the phone so the
   band's bottom edge cuts it. */
.tp-appband__phone {
  position: relative;
  justify-self: center;
  inline-size: min(20rem, 100%);
  block-size: 26rem;
}
.tp-appband__screen {
  position: absolute;
  inset-block-start: 1rem;
  inset-inline-start: 0;
  inline-size: 100%;
  block-size: auto;
  opacity: 0;
  filter: drop-shadow(var(--tp-site-shadow-lift));
  /* A true cross-fade: the incoming screen fades in ON TOP while the outgoing one stays
     fully opaque beneath it, and only then drops out, so the phone never goes
     see-through halfway. */
  transition: opacity 700ms ease-in-out 700ms;
}
.tp-appband__screen[data-on] { z-index: 1; opacity: 1; transition-delay: 0ms; }

@media (min-width: 60rem) {
  .tp-appband__inner { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .tp-appband__copy { padding-block: clamp(4rem, 7vw, 6rem); }
  .tp-appband__phone { align-self: end; block-size: 37.5rem; }
  .tp-appband__screen { inset-block-start: 3.75rem; }
}

@media (prefers-reduced-motion: reduce) {
  .tp-appband__tab, .tp-appband__screen { transition: none; }
}

/* The official store badges: a link once its listing exists, else dimmed and tagged. */
.tp-stores { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-block-start: 0.25rem; }
.tp-store { position: relative; display: inline-flex; border-radius: 14px; text-decoration: none; }
.tp-store__badge { display: block; block-size: 2.75rem; inline-size: auto; }
.tp-store--soon .tp-store__badge { opacity: 0.5; filter: grayscale(1); }
.tp-store__soon {
  position: absolute;
  inset-block-start: -0.5rem;
  inset-inline-end: -0.5rem;
  padding-block: 0.125rem;
  padding-inline: 0.5rem;
  border-radius: var(--tp-site-radius-pill);
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-size: 0.625rem;
  font-weight: var(--tp-site-fw-display);
  letter-spacing: 0.08em;
  line-height: 1.4;
  text-transform: uppercase;
}
[dir='rtl'] .tp-store__soon { letter-spacing: 0; font-size: 0.75rem; }
`;
