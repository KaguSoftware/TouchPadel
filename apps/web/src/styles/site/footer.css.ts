/**
 * Site footer, on the brand navy in both modes (one step deeper at night): the white
 * lockup (42px tall) and the tagline; where the club is, the hours and the front desk
 * (not on the home page, whose #visit block has just said them: the `--short` grid);
 * two link lists; then the base line with the year, the language and the vendor credit.
 * Links are full touch targets.
 */
export const siteFooterCss = `
.tp-site-footer { background: var(--tp-site-footer-bg); font-size: var(--tp-site-fs-sm); }
.tp-site-footer__inner {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 2.75rem 1.5rem;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-block: clamp(3rem, 7vw, 5rem) 2.5rem;
  padding-inline: var(--tp-site-gutter);
}
.tp-site-footer__brand, .tp-site-footer__facts { grid-column: 1 / -1; }
.tp-site-footer__brand { display: grid; gap: 1rem; justify-items: start; align-content: start; }
.tp-site-footer__home { display: flex; block-size: 2.625rem; border-radius: var(--tp-site-radius-sm); }
.tp-site-footer__tagline {
  font-family: var(--tp-font-display);
  font-size: 1.0625rem;
  font-weight: var(--tp-site-fw-display);
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--tp-brand-green);
}
[dir='rtl'] .tp-site-footer__tagline { text-transform: none; letter-spacing: 0; }
.tp-site-footer__facts { display: grid; gap: 2rem 1.5rem; align-content: start; }
.tp-site-footer__block { display: grid; gap: 0.25rem; align-content: start; justify-items: start; }
.tp-site-footer__title {
  margin-block-end: 0.375rem;
  font-size: 0.8125rem;
  font-weight: var(--tp-site-fw-label);
  letter-spacing: var(--tp-site-track-label);
  text-transform: uppercase;
  color: var(--tp-muted-fg);
}
[dir='rtl'] .tp-site-footer__title { letter-spacing: 0; font-size: 0.875rem; text-transform: none; }
.tp-site-footer__address, .tp-site-footer__hours { font-size: var(--tp-site-fs-md); font-weight: 700; }
.tp-site-footer__contact { display: grid; }
.tp-site-footer__phone,
.tp-site-footer__chat,
.tp-site-footer__maps,
.tp-site-footer__nav a,
.tp-site-footer__lang {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  min-block-size: var(--tp-site-touch);
  font-size: var(--tp-site-fs-md);
  font-weight: 600;
  text-decoration: none;
}
.tp-site-footer__phone { font-weight: 700; unicode-bidi: isolate; }
.tp-site-footer__chat .tp-icon { color: var(--tp-brand-green); }
.tp-site-footer__maps { color: var(--tp-site-block-muted); }
.tp-site-footer__maps .tp-icon { inline-size: 1.1em; block-size: 1.1em; }
.tp-site-footer__nav ul { display: grid; }
.tp-site-footer__nav a[aria-current='page'] { color: var(--tp-brand-green); }
@media (hover: hover) {
  .tp-site-footer__nav a:hover,
  .tp-site-footer__lang:hover,
  .tp-site-footer__phone:hover,
  .tp-site-footer__chat:hover,
  .tp-site-footer__maps:hover { text-decoration-line: underline; text-underline-offset: 0.3em; }
}
.tp-site-footer__base {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 0.25rem 1.5rem;
  max-inline-size: var(--tp-site-max);
  margin-inline: auto;
  padding-block: 1rem 1.75rem;
  padding-inline: var(--tp-site-gutter);
  border-block-start: 1px solid color-mix(in srgb, var(--tp-brand-white) 16%, transparent);
  color: var(--tp-muted-fg);
}
.tp-site-footer__lang { font-family: var(--tp-font-arabic); color: var(--tp-fg); }
.tp-site-footer__credit { font-size: var(--tp-site-fs-xs); }
@media (min-width: 40rem) {
  .tp-site-footer__facts { grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); }
}
@media (min-width: 64rem) {
  .tp-site-footer__inner { grid-template-columns: minmax(0, 1fr) minmax(0, 2.4fr) minmax(0, 0.8fr) minmax(0, 0.8fr); column-gap: clamp(2rem, 4vw, 3.5rem); }
  .tp-site-footer__brand, .tp-site-footer__facts { grid-column: auto; }
  .tp-site-footer__inner--short { grid-template-columns: minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr); }
}
`;
