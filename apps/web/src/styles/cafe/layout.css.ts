/** Page column, the one breakpoint, legacy spacing hooks. */
export const layoutCss = `
.tp-cafe { min-block-size: 100dvh; background: var(--tp-bg); color: var(--tp-fg); }
.tp-page-with-bar { padding-block-end: calc(6.5rem + env(safe-area-inset-bottom)); }
.tp-header__spacer { margin-inline-start: auto; }
.tp-section { margin-block-start: var(--tp-space-6); }
.tp-section > h2 { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); margin-block-end: var(--tp-space-3); }
.tp-stack { display: flex; flex-direction: column; gap: var(--tp-space-3); }
.tp-row { display: flex; align-items: center; gap: var(--tp-space-3); }

/* The menu column is 430 px at EVERY width (base.css .tp-app) — the design is a
   phone-width menu card, not a page that grows. The one breakpoint is therefore
   only about the ground either side of it: below it the column fills the
   viewport and the shadow only darkens the screen edges, so it is dropped. */
@media (max-width: 460px) {
  .tp-app { box-shadow: none; }
}
/* The shell's inert state must READ as inert too, not just behave that way. */
.tp-app__scroll[inert] { opacity: 0.55; }
`;
