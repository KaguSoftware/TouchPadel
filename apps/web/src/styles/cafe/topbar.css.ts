/**
 * Header + wordmark + the shared bean-pattern layer rules.
 *
 * The design's header is white with the lockup centred on it — there is no
 * blue crown any more, so there is no bean field behind the bar and no swoosh
 * closing it. The bean rules stay because `BeanPattern` is still available to
 * other surfaces; nothing in the menu column uses them.
 */
export const topbarCss = `
.tp-cafe__topbar { position: sticky; inset-block-start: 0; z-index: var(--tp-z-topbar);
  background: var(--tp-bg); color: var(--tp-fg); padding-block-start: env(safe-area-inset-top); }
/* Design: 22px 24px 14px, lockup centred. Outer tracks are equal so the lockup
   sits on the true centre whatever the chip and basket are showing. */
.tp-cafe__topbar-inner { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; gap: var(--tp-space-2);
  padding-block: 22px 14px; padding-inline: 24px; }
.tp-cafe__topbar-side { display: flex; align-items: center; gap: var(--tp-space-2); min-inline-size: 0; }
.tp-cafe__topbar-side--end { justify-content: flex-end; }
.tp-cafe__lockup { inline-size: 175px; block-size: auto; display: block; }

.tp-cafe__table { font-weight: 800; font-size: var(--tp-fs-sm); padding-block: 0.2rem; padding-inline: 0.6rem; border-radius: var(--tp-radius-pill);
  background: var(--tp-cafe-blue-tint); color: var(--tp-accent); white-space: nowrap; }
.tp-cafe__table[data-state='binding'] { background: var(--tp-cafe-blue-tint); color: var(--tp-accent); opacity: 0.7; }
.tp-cafe__topbar a { color: var(--tp-accent); font-size: var(--tp-fs-sm); }
.tp-cafe__topbar a.tp-btn { text-decoration: none; }

/* wordmark: "T" + bean + "uch" · "Cafe" + smile. The header now paints the real
   lockup image instead, but the drawn mark stays available (components/cafe/brand)
   for any surface that needs a mark it can recolour. */
.tp-wordmark { position: relative; display: inline-flex; align-items: baseline; font-family: var(--tp-font-display); font-weight: var(--tp-fw-display);
  font-size: 1.35rem; letter-spacing: -0.02em; line-height: 1; white-space: nowrap; padding-block-end: 0.28em; }
.tp-wordmark__word { display: inline-flex; align-items: baseline; }
.tp-wordmark__gap { inline-size: 0.28em; }
.tp-wordmark__bean { display: inline-block; vertical-align: -0.05em; margin-inline: 0.01em; }
.tp-wordmark__smile { position: absolute; inset-inline-start: 0.55em; inset-inline-end: 2.45em; inset-block-end: 0; block-size: 0.34em; }
.tp-wordmark[data-tone='onLight'] { color: var(--tp-accent); }
.tp-wordmark[data-tone='onLight'] .tp-wordmark__smile { color: var(--tp-cafe-green-light); }
.tp-wordmark[data-tone='onBlue'] { color: var(--tp-brand-white); }
.tp-wordmark[data-tone='onBlue'] .tp-wordmark__bean { color: var(--tp-cafe-blue); }
.tp-wordmark[data-tone='onBrown'] { color: var(--tp-brand-white); }
.tp-wordmark[data-tone='onBrown'] .tp-wordmark__bean { color: var(--tp-cafe-green); }
.tp-wordmark--lg { font-size: var(--tp-fs-display); }

/* swoosh: mirrored in RTL so the sweep still rises toward the trailing edge */
.tp-swoosh { display: block; inline-size: 100%; block-size: 100%; }
[dir='rtl'] .tp-swoosh[data-mirror='true'] { transform: scale(-1, 1); }

/* bean pattern layer (available to BeanPattern; unused by the menu column) */
.tp-beans { position: absolute; inset: 0; pointer-events: none;
  background-size: var(--tp-cafe-bean-tile-w) var(--tp-cafe-bean-tile-h);
  background-position: center top; }
.tp-beans[data-tone='brown'] { background-image: var(--tp-cafe-beans-brown); opacity: var(--tp-beans-opacity, var(--tp-beans-opacity-brown)); }
.tp-beans[data-tone='white'] { background-image: var(--tp-cafe-beans-white); opacity: var(--tp-beans-opacity, var(--tp-beans-opacity-white)); }

/* Table chip states. invalid/expired render as a BUTTON (tap → re-scan sheet),
   so the element defaults have to be reset back to the chip look. */
button.tp-cafe__table { border: 1px solid var(--tp-cafe-blue-tint); font-family: inherit; }
.tp-cafe__table[data-state='invalid'], .tp-cafe__table[data-state='expired'], .tp-cafe__table[data-state='error'] {
  background: var(--tp-warn-bg); color: var(--tp-warn-fg); border-color: var(--tp-warn-border); font-size: var(--tp-fs-xs); }
.tp-cafe__table[data-state='binding'] { display: inline-flex; align-items: center; gap: 0.35rem; }

/* Locale link + basket button inside the header */
.tp-locale-switch { flex: none; white-space: nowrap; }
.tp-basket-btn { flex: none; gap: 0.4rem; padding-inline: 0.7rem; min-block-size: 2.25rem; background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-basket-btn__total { font-variant-numeric: tabular-nums; font-family: var(--tp-font-numeric); font-size: var(--tp-fs-sm); }
`;
