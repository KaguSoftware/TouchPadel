/** Brown footer: hours (today bold), phone, pay-at-desk, credit. */
export const footerCss = `
.tp-footer { margin-block-start: var(--tp-space-6); padding-block: var(--tp-space-6); padding-inline: var(--tp-space-4); background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast); font-size: var(--tp-fs-sm); position: relative; overflow: hidden; }
.tp-footer a { color: inherit; }
.tp-footer__inner { position: relative; display: grid; gap: var(--tp-space-4); max-inline-size: var(--tp-column-w); margin-inline: auto; }
.tp-footer__title { font-family: var(--tp-font-display); font-weight: var(--tp-fw-display); text-transform: uppercase; letter-spacing: var(--tp-tracking-caps); font-size: var(--tp-fs-sm); opacity: 0.85; }
.tp-hours { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 1.25rem; }
.tp-hours dt { font-weight: 600; }
.tp-hours dd { margin-inline-start: 0; text-align: end; font-variant-numeric: tabular-nums; }
.tp-hours [data-today='true'] { font-weight: 800; }
.tp-footer__phone { direction: ltr; unicode-bidi: isolate; font-variant-numeric: tabular-nums; }
.tp-footer__credit { opacity: 0.7; font-size: var(--tp-fs-xs); }
.tp-fixture { color: var(--tp-muted-fg); font-style: italic; }
`;
