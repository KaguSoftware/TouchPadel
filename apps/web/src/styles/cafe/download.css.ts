/** Staff download page (/download): a centred single column on the boot ground. */
export const downloadCss = `
.tp-download { gap: var(--tp-space-5); text-align: center; padding-block: var(--tp-space-6); }
.tp-download__title { font-family: var(--tp-font-display); font-size: var(--tp-fs-xl); }
.tp-download__buttons { display: flex; flex-wrap: wrap; justify-content: center; gap: var(--tp-space-3); inline-size: 100%; }
.tp-download__btn { min-inline-size: 14rem; }
.tp-download__btn--soon { opacity: 0.55; cursor: default; pointer-events: none; }
.tp-download__meta { font-size: var(--tp-fs-sm); color: var(--tp-muted-fg); max-inline-size: 36ch; }
.tp-download__meta a { color: inherit; }
.tp-download__note { font-size: var(--tp-fs-sm); color: var(--tp-fg); background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl); padding-block: var(--tp-space-2); padding-inline: var(--tp-space-3); max-inline-size: 36ch; }
`;
