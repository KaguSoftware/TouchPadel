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
.tp-download__install { display: flex; flex-direction: column; align-items: center; gap: var(--tp-space-3); inline-size: 100%; }
.tp-download__install-title { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); }
.tp-download__cmd { display: flex; flex-direction: column; align-items: stretch; gap: var(--tp-space-2); inline-size: 100%; max-inline-size: 36rem; }
.tp-download__code { display: block; direction: ltr; text-align: start; font-family: var(--tp-font-mono); font-size: var(--tp-fs-sm); color: var(--tp-fg); background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: var(--tp-radius-ctl); padding-block: var(--tp-space-3); padding-inline: var(--tp-space-3); overflow-wrap: anywhere; user-select: all; }
.tp-download__copy { align-self: center; display: inline-grid; min-inline-size: 8rem; }
.tp-download__copy-label { grid-area: 1 / 1; visibility: hidden; }
.tp-download__copy-label[data-on='true'] { visibility: visible; }
.tp-download__sr { position: absolute; inline-size: 1px; block-size: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.tp-download__alt { font-size: var(--tp-fs-sm); color: var(--tp-muted-fg); }
`;
