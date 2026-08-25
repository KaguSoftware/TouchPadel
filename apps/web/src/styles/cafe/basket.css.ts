/** Fixed basket bar, pay-at-desk notice, basket lines. */
export const basketCss = `
.tp-paynotice { text-align: center; font-size: 0.8rem; background: var(--tp-accent-2); color: var(--tp-accent-2-contrast);
  padding-block: 0.35rem; padding-inline: var(--tp-space-4); }
.tp-basketbar { position: fixed; inset-block-end: 0; inset-inline: 0; z-index: var(--tp-z-fab);
  background: var(--tp-bg); border-block-start: 1px solid var(--tp-border); padding-block: 0.6rem;
  padding-block-end: calc(0.6rem + env(safe-area-inset-bottom)); }
.tp-basketbar__inner { display: flex; align-items: center; gap: var(--tp-space-3); }
.tp-basket-btn { position: relative; }
.tp-basket-btn__count { display: inline-grid; place-items: center; min-inline-size: 1.4rem; block-size: 1.4rem; border-radius: var(--tp-radius-pill);
  background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast); font-size: var(--tp-fs-xs); font-weight: 800; padding-inline: 0.35rem; }
.tp-basket-line { display: flex; gap: var(--tp-space-3); align-items: flex-start; padding-block: var(--tp-space-3); border-block-end: 1px solid var(--tp-border); }
.tp-basket-line__body { flex: 1; min-inline-size: 0; }
.tp-basket-line__sub { color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); }
.tp-basket-line__note { color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); font-style: italic; }
.tp-basket-line__total { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--tp-cafe-brown); }
.tp-basket-totals { margin-block-start: var(--tp-space-4); display: grid; gap: var(--tp-space-1); font-variant-numeric: tabular-nums; }
.tp-basket-totals__row { display: flex; justify-content: space-between; gap: var(--tp-space-3); }
.tp-basket-totals__row--total { font-weight: 800; font-size: var(--tp-fs-lg); color: var(--tp-cafe-brown); }
.tp-basket-totals__row--promo { color: var(--tp-success); }
.tp-basket-empty { text-align: center; padding-block: var(--tp-space-6); color: var(--tp-muted-fg); }
.tp-sending { position: absolute; inset: 0; display: grid; place-items: center; background: var(--tp-bg); opacity: 0.92; border-radius: inherit; }
`;
