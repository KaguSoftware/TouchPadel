/**
 * The app band: one compact band, quieter than the sections around it (its own ground,
 * a smaller headline, less air): the title, one sentence and, once a listing exists, the
 * official store badges.
 */
export const siteAppBandCss = `
.tp-appband {
  background: var(--tp-site-band-bg);
  padding-block: clamp(3.5rem, 8vw, 6rem);
  border-block: 1px solid var(--tp-border);
}
.tp-appband__inner {
  display: grid;
  gap: 1.25rem;
  justify-items: start;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-inline: var(--tp-site-gutter);
}
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

/* The official store badges, each linking to its listing. */
.tp-stores { display: flex; flex-wrap: wrap; gap: 0.75rem; margin-block-start: 0.25rem; }
.tp-store { display: inline-flex; border-radius: 14px; text-decoration: none; }
.tp-store__badge { display: block; block-size: 3.25rem; inline-size: auto; }
`;
