/**
 * The app band (option E, 2026-09-25): on a wide screen the words in one column (the
 * two-weight title, the three screens as a list, how to book until then, the store
 * badges) and one phone in the other, shown whole in a CSS phone frame. The phone shows the real app screen for the promise picked; the screens cross-fade.
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
  position: relative;
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
.tp-appband__tab[aria-selected='true'] { color: var(--tp-fg); }
/* Each promise's edge line shows the time, driven by animations only (no transitions), so
   the timing is exact: "run" fills the line over one screen's time (the same time as the
   timer in AppScreens), "full" is full, and "drain" empties it, all lines as one movement
   from the last back to the first (each takes its share of the drain time, the last going
   first). The edge retreats upward as it drains. */
.tp-appband__tab::before {
  content: '';
  position: absolute;
  inset-block: 0;
  inset-inline-start: -2px;
  inline-size: 2px;
  background: var(--tp-site-green-text);
  transform: scaleY(0);
  transform-origin: top;
}
.tp-appband__tab[data-line='full']::before { transform: scaleY(1); }
.tp-appband__tab[data-line='run']::before { animation: tp-appband-fill var(--tp-appband-ms, 5000ms) linear both; }
.tp-appband__tab[data-line='drain']::before {
  animation: tp-appband-drain calc(var(--tp-appband-drain) / var(--tp-appband-n)) linear
    calc((var(--tp-appband-n) - 1 - var(--tp-appband-i)) * var(--tp-appband-drain) / var(--tp-appband-n)) both;
}
@keyframes tp-appband-fill { from { transform: scaleY(0); } to { transform: scaleY(1); } }
@keyframes tp-appband-drain { from { transform: scaleY(1); } to { transform: scaleY(0); } }
.tp-appband__tab[aria-selected='true'] .tp-appband__tab-eyebrow { color: var(--tp-site-green-text); }

/* The phone: a CSS frame (metal rail, black bezel, side buttons) round the screens, which
   are stacked in one box and cross-fade. The whole phone shows, nothing cut off. */
.tp-appband__phone {
  position: relative;
  justify-self: center;
  inline-size: min(17rem, 100%);
  margin-block: 2.5rem 4rem;
}
.tp-appband__device {
  position: relative;
  padding: 3px;
  border-radius: 2.9rem;
  background: linear-gradient(145deg, var(--tp-brand-white), var(--tp-brand-gray) 30%, color-mix(in srgb, var(--tp-brand-gray) 45%, var(--tp-brand-black)) 55%, var(--tp-brand-gray) 80%, var(--tp-brand-white));
  /* A smooth, layered shadow: tight at the phone, growing softer and longer below it. */
  box-shadow:
    0 2px 4px color-mix(in srgb, var(--tp-brand-black) 10%, transparent),
    0 8px 16px color-mix(in srgb, var(--tp-brand-black) 12%, transparent),
    0 20px 36px color-mix(in srgb, var(--tp-brand-black) 14%, transparent),
    0 42px 72px color-mix(in srgb, var(--tp-brand-black) 18%, transparent);
}
.tp-appband__device::before, .tp-appband__device::after {
  content: '';
  position: absolute;
  inline-size: 3px;
  background: var(--tp-brand-gray);
}
.tp-appband__device::before {
  inset-inline-start: -3px;
  inset-block-start: 17%;
  block-size: 6%;
  border-start-start-radius: 2px;
  border-end-start-radius: 2px;
  box-shadow: 0 3.2rem 0 var(--tp-brand-gray), 0 7.4rem 0 var(--tp-brand-gray);
}
.tp-appband__device::after {
  inset-inline-end: -3px;
  inset-block-start: 27%;
  block-size: 12%;
  border-start-end-radius: 2px;
  border-end-end-radius: 2px;
}
/* Light mode: the frame is a dark brand blue instead of metal. */
.tp-site[data-mode='light'] .tp-appband__device {
  background: linear-gradient(145deg, color-mix(in srgb, var(--tp-brand-blue) 62%, var(--tp-brand-black)), color-mix(in srgb, var(--tp-brand-blue) 45%, var(--tp-brand-black)) 30%, color-mix(in srgb, var(--tp-brand-blue) 28%, var(--tp-brand-black)) 55%, color-mix(in srgb, var(--tp-brand-blue) 45%, var(--tp-brand-black)) 80%, color-mix(in srgb, var(--tp-brand-blue) 62%, var(--tp-brand-black)));
}
.tp-site[data-mode='light'] .tp-appband__device::before {
  background: color-mix(in srgb, var(--tp-brand-blue) 45%, var(--tp-brand-black));
  box-shadow: 0 3.2rem 0 color-mix(in srgb, var(--tp-brand-blue) 45%, var(--tp-brand-black)), 0 7.4rem 0 color-mix(in srgb, var(--tp-brand-blue) 45%, var(--tp-brand-black));
}
.tp-site[data-mode='light'] .tp-appband__device::after { background: color-mix(in srgb, var(--tp-brand-blue) 45%, var(--tp-brand-black)); }
.tp-appband__bezel {
  position: relative;
  padding: 5px;
  border-radius: 2.7rem;
  background: var(--tp-brand-black);
  aspect-ratio: 1206 / 2622;
  box-sizing: content-box;
}
.tp-appband__screen {
  position: absolute;
  inset: 5px;
  inline-size: calc(100% - 10px);
  block-size: calc(100% - 10px);
  border-radius: 2.45rem;
  object-fit: cover;
  opacity: 0;
  /* A true cross-fade: the incoming screen fades in ON TOP while the outgoing one stays
     fully opaque beneath it, and only then drops out, so the phone never goes
     see-through halfway. */
  transition: opacity 700ms ease-in-out 700ms;
}
.tp-appband__screen[data-on] { z-index: 1; opacity: 1; transition-delay: 0ms; }

@media (min-width: 60rem) {
  .tp-appband__inner { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .tp-appband__copy { padding-block: clamp(4rem, 7vw, 6rem); }
  .tp-appband__phone { align-self: center; }
}

@media (prefers-reduced-motion: reduce) {
  .tp-appband__tab, .tp-appband__screen { transition: none; }
  .tp-appband__tab[data-line]::before { animation: none; }
}

/* The official store badges: a link once its listing exists, else dimmed and tagged. */
.tp-stores { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-block-start: 0.25rem; }
.tp-store { position: relative; display: inline-flex; border-radius: 14px; text-decoration: none; }
.tp-store__badge { display: block; block-size: 2.75rem; inline-size: auto; }
/* Google's PNG carries a clear margin baked into the artwork (the badge is 564 x 168 of
   646 x 250, 41 px on every side), so at the same box height it read a third smaller than
   Apple's edge-to-edge SVG. Scale the image so the badge itself is 2.75rem tall, and pull
   the margin back in with a negative one so the box hugs the badge. */
.tp-store--google-play .tp-store__badge { block-size: calc(2.75rem * 250 / 168); margin: calc(2.75rem * -41 / 168); }
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
