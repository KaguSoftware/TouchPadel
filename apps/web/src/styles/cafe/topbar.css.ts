/** Blue top bar + wordmark + swoosh band + bean pattern layer. */
export const topbarCss = `
.tp-cafe__topbar { position: sticky; inset-block-start: 0; z-index: var(--tp-z-topbar); background: var(--tp-accent); color: var(--tp-accent-contrast);
  padding-block-start: env(safe-area-inset-top); min-block-size: var(--tp-topbar-h); }
.tp-cafe__topbar-inner { display: flex; align-items: center; gap: var(--tp-space-3); min-block-size: var(--tp-topbar-h); }
.tp-cafe__table { font-weight: 800; font-size: var(--tp-fs-sm); padding-block: 0.2rem; padding-inline: 0.6rem; border-radius: var(--tp-radius-pill);
  background: var(--tp-brand-white); color: var(--tp-accent); white-space: nowrap; }
.tp-cafe__table[data-state='binding'] { background: transparent; color: var(--tp-accent-contrast); border: 1px solid var(--tp-brand-white); opacity: 0.85; }
.tp-cafe__topbar a { color: var(--tp-accent-contrast); text-decoration: underline; font-size: var(--tp-fs-sm); margin-inline-start: auto; }
.tp-cafe__topbar a.tp-btn { text-decoration: none; }
.tp-topbar__band { position: relative; block-size: 1.1rem; background: var(--tp-accent); }
.tp-topbar__band .tp-swoosh { position: absolute; inset: 0; inline-size: 100%; block-size: 100%; }

/* wordmark: "T" + bean + "uch" · "Cafe" + smile */
.tp-wordmark { position: relative; display: inline-flex; align-items: baseline; font-family: var(--tp-font-display); font-weight: var(--tp-fw-display);
  font-size: 1.35rem; letter-spacing: -0.02em; line-height: 1; white-space: nowrap; padding-block-end: 0.28em; }
.tp-wordmark__word { display: inline-flex; align-items: baseline; }
.tp-wordmark__gap { inline-size: 0.28em; }
.tp-wordmark__bean { display: inline-block; vertical-align: -0.05em; margin-inline: 0.01em; }
.tp-wordmark__smile { position: absolute; inset-inline-start: 0.55em; inset-inline-end: 2.45em; inset-block-end: 0; block-size: 0.34em; }
.tp-wordmark[data-tone='onLight'] { color: var(--tp-accent); }
.tp-wordmark[data-tone='onLight'] .tp-wordmark__smile { color: var(--tp-cafe-brown); }
.tp-wordmark[data-tone='onBlue'] { color: var(--tp-brand-white); }
.tp-wordmark[data-tone='onBlue'] .tp-wordmark__bean { color: var(--tp-cafe-blue); }
.tp-wordmark[data-tone='onBrown'] { color: var(--tp-brand-white); }
.tp-wordmark[data-tone='onBrown'] .tp-wordmark__bean { color: var(--tp-cafe-brown); }
.tp-wordmark--lg { font-size: var(--tp-fs-display); }

/* swoosh: mirrored in RTL so the sweep still rises toward the trailing edge */
.tp-swoosh { display: block; inline-size: 100%; block-size: 100%; }
[dir='rtl'] .tp-swoosh[data-mirror='true'] { transform: scale(-1, 1); }

/* bean pattern layer */
.tp-beans { position: absolute; inset: 0; pointer-events: none; background-size: var(--tp-cafe-bean-tile-w) var(--tp-cafe-bean-tile-h); }
.tp-beans[data-tone='brown'] { background-image: var(--tp-cafe-beans-brown); opacity: var(--tp-beans-opacity, var(--tp-beans-opacity-brown)); }
.tp-beans[data-tone='white'] { background-image: var(--tp-cafe-beans-white); opacity: var(--tp-beans-opacity, var(--tp-beans-opacity-white)); }
`;
