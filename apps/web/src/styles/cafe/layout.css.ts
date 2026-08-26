/** Page column, the one breakpoint, bean-pattern gutters, legacy spacing hooks. */
export const layoutCss = `
.tp-cafe { min-block-size: 100dvh; background: var(--tp-bg); color: var(--tp-fg); }
.tp-page-with-bar { padding-block-end: calc(6.5rem + env(safe-area-inset-bottom)); }
.tp-header__spacer { margin-inline-start: auto; }
.tp-section { margin-block-start: var(--tp-space-6); }
.tp-section > h2 { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); margin-block-end: var(--tp-space-3); }
.tp-stack { display: flex; flex-direction: column; gap: var(--tp-space-3); }
.tp-row { display: flex; align-items: center; gap: var(--tp-space-3); }

@media (min-width: 640px) {
  /* Centred 44rem column; the gutters carry the brown bean pattern (brand p14). */
  .tp-app__scroll, .tp-cafe { background-color: var(--tp-cafe-cream); background-image: var(--tp-cafe-beans-brown); background-size: var(--tp-cafe-bean-tile-w) var(--tp-cafe-bean-tile-h); }
  .tp-app__scroll > .tp-container, .tp-cafe > main.tp-container { background: var(--tp-bg); min-block-size: 100%; box-shadow: var(--tp-shadow-card); }
  /* The crown, the pill rail and the footer are full-bleed but stay on the column. */
  .tp-app__scroll > .tp-crown, .tp-app__scroll > .tp-cattabs, .tp-app__scroll > .tp-footer {
    max-inline-size: var(--tp-column-w); margin-inline: auto; }
}
/* The shell's inert state must READ as inert too, not just behave that way. */
.tp-app__scroll[inert] { opacity: 0.55; }
`;
