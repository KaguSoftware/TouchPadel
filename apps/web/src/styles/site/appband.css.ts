/**
 * The app band: one compact band, quieter than the sections around it (its own ground,
 * a smaller headline, less air): the words and the store buttons on one side, one
 * redrawn app screen on the other.
 *
 * The screen uses the app's measurements (DayChip 12 radius / 1.5 border, SlotCell 12
 * radius / 2 border, the green CTA) at about 1.2× the app's point sizes, so it stays
 * legible at 360 px.
 */
export const siteAppBandCss = `
.tp-appband {
  background: var(--tp-site-band-bg);
  padding-block: clamp(3.5rem, 8vw, 6rem);
  border-block: 1px solid var(--tp-border);
}
.tp-appband__inner {
  display: grid;
  gap: clamp(2.5rem, 6vw, 4rem);
  align-items: center;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
.tp-appband__copy { display: grid; gap: 1.25rem; justify-items: start; }
.tp-appband__title {
  max-inline-size: 20ch;
  font-family: var(--tp-font-display);
  font-size: var(--tp-site-fs-xl);
  font-weight: var(--tp-site-fw-display);
  line-height: 1.02;
  letter-spacing: -0.01em;
  text-transform: uppercase;
  color: var(--tp-site-display-1);
  text-wrap: balance;
}
[dir='rtl'] .tp-appband__title { text-transform: none; letter-spacing: 0; line-height: var(--tp-site-lh-display-ar); }
.tp-appband__body { max-inline-size: 52ch; color: var(--tp-site-ink-2); text-wrap: pretty; }
.tp-appband__art { display: grid; justify-items: center; }
/* The screen's column never drops under 20rem: five day chips then keep about 46px of
   label room each, enough for the longest weekday the strip shows ("الخميس" at 13px is
   44px); a plain 0.75fr gave them 36px at 768px wide and cut "TODAY" to "TODA'". */
@media (min-width: 48rem) {
  .tp-appband__inner { grid-template-columns: minmax(0, 1.25fr) minmax(20rem, 0.75fr); column-gap: clamp(3rem, 7vw, 7rem); }
  .tp-appband__art { justify-items: end; }
}

/* The screen: a piece of the app on the app's own ground. */
.tp-screen {
  display: grid;
  gap: 0.75rem;
  inline-size: min(100%, 22rem);
  padding: 1.125rem;
  border: 1px solid var(--tp-border);
  border-radius: 1.75rem;
  background: var(--tp-site-hero-bg);
  box-shadow: var(--tp-site-shadow-lift);
  color: var(--tp-fg);
  font-family: var(--tp-font-body);
  line-height: 1.2;
}
.tp-v-days { display: flex; gap: 5px; }
.tp-v-day {
  display: grid;
  flex: 1 1 0;
  min-inline-size: 0;
  justify-items: center;
  align-items: center;
  min-block-size: 2.75rem;
  padding-block: 8px;
  padding-inline: 2px;
  border: 1.5px solid var(--tp-border);
  border-radius: 12px;
  background: var(--tp-surface);
}
.tp-v-day[data-selected] { border-color: var(--tp-brand-blue); background: var(--tp-brand-blue); color: var(--tp-brand-white); }
.tp-v-day__dow { max-inline-size: 100%; overflow: hidden; font-size: 0.8125rem; font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; white-space: nowrap; }
[dir='rtl'] .tp-v-day__dow { letter-spacing: 0; font-size: 0.75rem; }
.tp-v-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 7px; }
.tp-v-slot {
  display: grid;
  justify-items: center;
  gap: 3px;
  padding-block: 0.7rem;
  padding-inline: 0.25rem;
  border: 2px solid var(--tp-site-border-strong);
  border-radius: 12px;
  background: var(--tp-surface);
}
.tp-v-slot__time { font-family: var(--tp-font-display); font-size: 1.125rem; font-weight: var(--tp-site-fw-display); }
.tp-v-slot__sub { font-size: 0.8125rem; font-weight: 800; color: var(--tp-site-green-strong); }
.tp-v-slot[data-state='last'] .tp-v-slot__sub { color: var(--tp-site-warn-fg); }
.tp-v-slot[data-state='booked'] { border-color: var(--tp-site-surface-2); background: var(--tp-site-surface-2); }
.tp-v-slot[data-state='booked'] .tp-v-slot__time,
.tp-v-slot[data-state='booked'] .tp-v-slot__sub { color: var(--tp-site-faint); }
.tp-v-cta {
  display: grid;
  place-items: center;
  min-block-size: 3.25rem;
  border-radius: 14px;
  background: var(--tp-site-green);
  color: var(--tp-site-green-ink);
  font-size: 0.9375rem;
  font-weight: var(--tp-site-fw-label);
  letter-spacing: 0.07em;
  text-transform: uppercase;
}
[dir='rtl'] .tp-v-cta { letter-spacing: 0; font-size: 1rem; }

/* The store buttons: coming soon (dashed, not links) until a listing exists, then the
   official badges. */
.tp-stores { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-block-start: 0.25rem; }
.tp-store { display: inline-flex; border-radius: 14px; text-decoration: none; }
.tp-store--soon {
  flex-direction: column;
  justify-content: center;
  align-items: flex-start;
  gap: 0.125rem;
  min-block-size: 3.75rem;
  min-inline-size: 10rem;
  padding-block: 0.5rem;
  padding-inline: 1.25rem;
  border: 1.5px dashed var(--tp-muted-fg);
  background: transparent;
  color: var(--tp-fg);
  font: inherit;
  cursor: not-allowed;
}
.tp-store__soon { font-size: 0.75rem; font-weight: var(--tp-site-fw-label); letter-spacing: 0.1em; text-transform: uppercase; color: var(--tp-muted-fg); }
[dir='rtl'] .tp-store__soon { letter-spacing: 0; font-size: 0.8125rem; }
.tp-store__name { font-size: 1.25rem; font-weight: var(--tp-site-fw-display); line-height: 1.1; }
.tp-store__badge { display: block; block-size: 3.25rem; inline-size: auto; }
`;
