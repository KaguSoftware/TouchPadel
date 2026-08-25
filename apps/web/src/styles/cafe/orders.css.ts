/** Order cards, 3-step progress, live-orders strip. */
export const ordersCss = `
.tp-order { border: 1px solid var(--tp-border); border-radius: var(--tp-radius-md); padding-block: 0.85rem; padding-inline: var(--tp-space-4); margin-block-start: var(--tp-space-3); background: var(--tp-surface); }
.tp-order__head { display: flex; justify-content: space-between; gap: var(--tp-space-3); font-size: var(--tp-fs-sm); color: var(--tp-muted-fg); }
.tp-steps { display: flex; gap: 0.4rem; margin-block: 0.6rem; }
.tp-steps span { flex: 1; block-size: 0.4rem; border-radius: var(--tp-radius-pill); background: var(--tp-border); transition: background var(--tp-dur-base); }
.tp-steps span[data-on='true'] { background: var(--tp-accent-2); }
.tp-order__status { font-weight: 700; }
.tp-order__lines { margin-block-start: 0.4rem; font-size: 0.9rem; color: var(--tp-muted-fg); }
.tp-order[data-voided='true'] { opacity: 0.6; }
.tp-order[data-voided='true'] .tp-order__status { color: var(--tp-danger); }
.tp-orders-strip { display: inline-flex; align-items: center; gap: var(--tp-space-2); margin-block-start: var(--tp-space-3); padding-block: 0.4rem; padding-inline: 0.9rem;
  border-radius: var(--tp-radius-pill); background: var(--tp-cafe-blue-tint); color: var(--tp-accent); font-weight: 700; font-size: var(--tp-fs-sm); border: 0; }
.tp-orders-strip__dot { inline-size: 0.6rem; block-size: 0.6rem; border-radius: 50%; background: var(--tp-accent); animation: tp-bean-pulse 1.6s ease-in-out infinite; }
.tp-orders__earlier { margin-block-start: var(--tp-space-5); }
`;
