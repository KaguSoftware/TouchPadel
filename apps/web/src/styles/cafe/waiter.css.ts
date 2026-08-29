/** Waiter bell FAB, reasons grid, scroll-top FAB, QR-required sheet art. */
export const waiterCss = `
.tp-reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-block-start: var(--tp-space-3); }
.tp-reasons button { padding-block: 0.9rem; border-radius: var(--tp-radius-sm); border: 1px solid var(--tp-border); background: var(--tp-surface);
  color: var(--tp-fg); font-weight: 600; min-block-size: 3.25rem; }
.tp-reasons button:active { background: var(--tp-cafe-blue-tint); }
.tp-fab { position: fixed; z-index: var(--tp-z-fab); inset-block-end: calc(var(--tp-space-4) + env(safe-area-inset-bottom));
  inline-size: 3.5rem; block-size: 3.5rem; border-radius: 50%; border: 0; display: grid; place-items: center; box-shadow: var(--tp-shadow-fab);
  transition: transform var(--tp-dur-base) var(--tp-ease-out), opacity var(--tp-dur-base); }
.tp-fab[data-hidden='true'] { transform: scale(0.6); opacity: 0; pointer-events: none; }
.tp-fab--bell { inset-inline-start: var(--tp-space-4); background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-fab--bell[data-cooldown='true'] { background: var(--tp-muted); color: var(--tp-fg); }
.tp-fab--top { inset-inline-end: var(--tp-space-4); background: var(--tp-bg); color: var(--tp-accent); border: 1px solid var(--tp-border); inline-size: 2.75rem; block-size: 2.75rem; }
.tp-fab__badge { position: absolute; inset-block-start: -0.3rem; inset-inline-end: -0.3rem; background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast);
  font-size: var(--tp-fs-xs); font-weight: 800; border-radius: var(--tp-radius-pill); padding-inline: 0.4rem; min-inline-size: 1.4rem; block-size: 1.4rem; display: grid; place-items: center; font-variant-numeric: tabular-nums; }
.tp-waiter-phase { text-align: center; padding-block: var(--tp-space-5); display: flex; flex-direction: column; align-items: center; gap: var(--tp-space-3); }
.tp-waiter-phase[data-phase='done'] { color: var(--tp-success); font-weight: 700; }
.tp-waiter-phase[data-phase='failed'] { color: var(--tp-danger); }
.tp-qr-art { inline-size: 7rem; block-size: 7rem; margin-inline: auto; color: var(--tp-accent); animation: tp-float 1.8s ease-in-out infinite; }
.tp-qr-required { text-align: center; display: flex; flex-direction: column; gap: var(--tp-space-3); align-items: center; }
.tp-qr-required p { color: var(--tp-muted-fg); max-inline-size: 26rem; }
`;
