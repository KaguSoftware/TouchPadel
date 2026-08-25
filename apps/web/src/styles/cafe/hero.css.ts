/** Hero (modes none | media | featured). Collapse via grid-template-rows on [data-collapsed]. */
export const heroCss = `
.tp-hero { display: grid; grid-template-rows: 1fr; transition: grid-template-rows var(--tp-dur-slow) var(--tp-ease-out); }
.tp-hero[data-collapsed='true'] { grid-template-rows: 0fr; }
.tp-hero > * { min-block-size: 0; overflow: hidden; }
.tp-hero__brand { position: relative; background: var(--tp-accent); color: var(--tp-accent-contrast); text-align: center;
  padding-block: var(--tp-space-6) 2.75rem; padding-inline: var(--tp-space-5); }
.tp-hero__brand .tp-swoosh { position: absolute; inset-inline: 0; inset-block-end: -1px; block-size: 2rem; }
.tp-hero__headline { position: relative; font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); font-size: var(--tp-fs-display);
  line-height: var(--tp-lh-tight); letter-spacing: var(--tp-tracking-caps); text-transform: uppercase; }
[dir='rtl'] .tp-hero__headline { font-family: var(--tp-font-arabic); font-weight: 700; }
.tp-hero__meta { position: relative; margin-block-start: var(--tp-space-3); font-size: var(--tp-fs-sm); opacity: 0.9; }
.tp-hero__media { position: relative; aspect-ratio: 16 / 9; background: var(--tp-surface); overflow: hidden; }
.tp-hero__media img, .tp-hero__media video { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
.tp-hero__featured { position: relative; margin: var(--tp-space-4); border-radius: var(--tp-radius-lg); overflow: hidden; background: var(--tp-surface); box-shadow: var(--tp-shadow-card); }
.tp-hero__badge { position: absolute; inset-block-start: var(--tp-space-3); inset-inline-start: var(--tp-space-3); background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast);
  border-radius: var(--tp-radius-pill); padding-block: 0.25rem; padding-inline: 0.7rem; font-size: var(--tp-fs-xs); font-weight: 800; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); }
.tp-price--struck { text-decoration: line-through; color: var(--tp-muted-fg); font-weight: 400; margin-inline-end: 0.4rem; }
.tp-price--promo { color: var(--tp-cafe-brown); font-weight: 800; }
`;
