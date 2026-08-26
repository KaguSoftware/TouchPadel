/** Top bar + wordmark + the shared bean-pattern layer rules. The bar's blue,
    its bean pattern and the swoosh that closes it all belong to .tp-crown /
    the hero — bar and hero are one crown; see hero.css.ts. */
export const topbarCss = `
/* Transparent: the blue AND the bean pattern are painted by the hero's shared
   crown field, which reaches up behind this bar (.tp-hero__field, hero.css.ts)
   so the pattern tiles continuously across the seam. The bar keeps its own
   --tp-z-topbar so its CONTENT stays above that layer. */
.tp-cafe__topbar { position: sticky; inset-block-start: 0; z-index: var(--tp-z-topbar); background: var(--tp-accent); color: var(--tp-accent-contrast);
  padding-block-start: env(safe-area-inset-top); min-block-size: var(--tp-topbar-h); }
.tp-cafe__topbar-inner { display: flex; align-items: center; gap: var(--tp-space-3); min-block-size: var(--tp-topbar-h); }
.tp-cafe__table { font-weight: 800; font-size: var(--tp-fs-sm); padding-block: 0.2rem; padding-inline: 0.6rem; border-radius: var(--tp-radius-pill);
  background: var(--tp-brand-white); color: var(--tp-accent); white-space: nowrap; }
.tp-cafe__table[data-state='binding'] { background: var(--tp-accent); color: var(--tp-accent-contrast); border: 1px solid var(--tp-brand-white); opacity: 0.85; }
.tp-cafe__topbar a { color: var(--tp-accent-contrast); text-decoration: underline; font-size: var(--tp-fs-sm); margin-inline-start: auto; }
.tp-cafe__topbar a.tp-btn { text-decoration: none; }

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
/* The topbar's layer and the hero's must read as ONE continuous field. They
   cannot share a DOM box (the bar lives outside the scroller, which clips its
   children), so they share a tiling ORIGIN instead: the bar's layer is
   extended downward by the bar's own height and both are anchored to the same
   inline centre, so the rows continue across the seam in phase.

   (An earlier attempt shifted the hero's origin up by the bar's height. That
   holds only while the page is at rest: the bar is pinned and the hero is not,
   so the phases drift apart the moment you scroll -- measured 0 vs 8px at
   scrollTop 40.) */
.tp-beans { position: absolute; inset: 0; pointer-events: none;
  background-size: var(--tp-cafe-bean-tile-w) var(--tp-cafe-bean-tile-h);
  background-position: center top; }
/* Both crown layers are anchored to the VIEWPORT (fixed), not to their own
   boxes. The bar is pinned while the hero scrolls, so no constant offset can
   hold them in phase -- it would only be correct at one scroll position. A
   shared viewport anchor is the one origin that stays aligned at every scroll
   position, for both elements, with no per-frame work. Inline centring keeps
   them in phase on the centred desktop column too. */
.tp-cafe__topbar > .tp-beans, .tp-hero__brand > .tp-beans { background-attachment: fixed; }
.tp-beans[data-tone='brown'] { background-image: var(--tp-cafe-beans-brown); opacity: var(--tp-beans-opacity, var(--tp-beans-opacity-brown)); }
.tp-beans[data-tone='white'] { background-image: var(--tp-cafe-beans-white); opacity: var(--tp-beans-opacity, var(--tp-beans-opacity-white)); }

/* Table chip states. invalid/expired render as a BUTTON (tap → re-scan sheet),
   so the element defaults have to be reset back to the chip look. */
button.tp-cafe__table { border: 1px solid var(--tp-brand-white); font-family: inherit; }
.tp-cafe__table[data-state='invalid'], .tp-cafe__table[data-state='expired'], .tp-cafe__table[data-state='error'] {
  background: var(--tp-warn-bg); color: var(--tp-warn-fg); border-color: var(--tp-warn-border); font-size: var(--tp-fs-xs); }
.tp-cafe__table[data-state='binding'] { display: inline-flex; align-items: center; gap: 0.35rem; }

/* Locale link + basket button inside the blue bar */
.tp-locale-switch { flex: none; white-space: nowrap; }
.tp-basket-btn { flex: none; gap: 0.4rem; padding-inline: 0.7rem; min-block-size: 2.25rem; }
.tp-basket-btn__total { font-variant-numeric: tabular-nums; font-size: var(--tp-fs-sm); }
.tp-cafe__topbar-inner > .tp-wordmark { flex: none; }
`;
