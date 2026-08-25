/** Bell tutorial: full-screen scrim with a JS-measured spotlight (--tp-spot-*) and an SVG arrow draw. */
export const tutorialCss = `
.tp-tutorial { position: fixed; inset: 0; z-index: var(--tp-z-tutorial); color: var(--tp-brand-white); animation: tp-fade-in var(--tp-dur-base) both; }
.tp-tutorial__scrim { position: absolute; inset: 0; background: var(--tp-backdrop);
  mask-image: radial-gradient(circle var(--tp-spot-r, 2.2rem) at var(--tp-spot-x, 50%) var(--tp-spot-y, 50%), transparent 98%, var(--tp-fg) 100%);
  -webkit-mask-image: radial-gradient(circle var(--tp-spot-r, 2.2rem) at var(--tp-spot-x, 50%) var(--tp-spot-y, 50%), transparent 98%, var(--tp-fg) 100%); }
.tp-tutorial__card { position: absolute; inset-inline: var(--tp-space-5); inset-block-end: calc(var(--tp-spot-y, 50%) * 0 + 9rem + env(safe-area-inset-bottom)); text-align: center; display: flex; flex-direction: column; gap: var(--tp-space-2); }
.tp-tutorial__title { font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); font-size: var(--tp-fs-xl); line-height: var(--tp-lh-tight); text-transform: uppercase; letter-spacing: var(--tp-tracking-caps); }
[dir='rtl'] .tp-tutorial__title { font-family: var(--tp-font-arabic); font-weight: 700; }
.tp-tutorial__arrow { position: absolute; inset-inline-start: var(--tp-space-5); inset-block-end: calc(5.5rem + env(safe-area-inset-bottom)); inline-size: 5rem; block-size: 4rem; }
.tp-tutorial__arrow path { stroke: currentColor; stroke-width: 3; fill: none; stroke-linecap: round; stroke-dasharray: 200; stroke-dashoffset: 200; animation: tp-arrow-draw 900ms var(--tp-ease-out) 300ms forwards; }
[dir='rtl'] .tp-tutorial__arrow { transform: scale(-1, 1); }
`;
