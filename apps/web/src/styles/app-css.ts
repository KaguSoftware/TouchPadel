/**
 * App stylesheet (inlined by the root layout after the @touch/ui token CSS).
 * CSS LOGICAL PROPERTIES ONLY — no left/right physical props anywhere; every
 * screen must mirror correctly under dir="rtl" with zero overrides.
 */
export const appCss = `
* { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; }
body { margin: 0; min-block-size: 100dvh; }
img { max-inline-size: 100%; block-size: auto; }
h1, h2, h3, p { margin-block: 0; }
button { font: inherit; cursor: pointer; }

.tp-container { inline-size: 100%; max-inline-size: 44rem; margin-inline: auto; padding-inline: 1rem; }

/* header / footer */
.tp-header { display: flex; align-items: center; gap: 0.75rem; padding-block: 0.75rem; border-block-end: 1px solid var(--tp-border); }
.tp-header__logo { block-size: 2.5rem; inline-size: auto; }
.tp-header__spacer { margin-inline-start: auto; }
.tp-header a { color: var(--tp-fg); text-decoration: none; font-weight: 600; }
.tp-header nav { display: flex; gap: 1rem; align-items: center; }
.tp-footer { margin-block-start: 3rem; padding-block: 1.5rem; border-block-start: 1px solid var(--tp-border); color: var(--tp-muted-fg); font-size: 0.85rem; }

/* buttons */
.tp-btn { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem;
  padding-block: 0.65rem; padding-inline: 1.25rem; border-radius: 999px; border: 1px solid transparent;
  font-weight: 700; text-decoration: none; min-block-size: 2.75rem; }
.tp-btn--primary { background: var(--tp-accent); color: var(--tp-accent-contrast); }
.tp-btn--secondary { background: var(--tp-accent-2); color: var(--tp-accent-2-contrast); }
.tp-btn--ghost { background: transparent; color: var(--tp-accent); border-color: var(--tp-accent); }
.tp-btn[disabled] { opacity: 0.45; cursor: not-allowed; }
.tp-btn--block { inline-size: 100%; }

/* hero */
.tp-hero { display: flex; flex-direction: column; align-items: center; text-align: center; gap: 1rem; padding-block: 2.5rem; }
.tp-hero__logo { inline-size: min(16rem, 60vw); }
.tp-hero h1 { font-family: var(--tp-font-display); font-size: clamp(1.6rem, 5vw, 2.4rem); }
.tp-hero p { color: var(--tp-muted-fg); max-inline-size: 34rem; }
.tp-hero__cta { display: flex; flex-wrap: wrap; gap: 0.75rem; justify-content: center; }

/* cards / sections */
.tp-card { background: var(--tp-surface); border: 1px solid var(--tp-border); border-radius: 1rem; padding: 1rem; }
.tp-section { margin-block-start: 2rem; }
.tp-section > h2 { font-family: var(--tp-font-display); font-size: 1.25rem; margin-block-end: 0.75rem; }
.tp-hours { display: grid; grid-template-columns: auto 1fr; gap: 0.35rem 1.25rem; }
.tp-hours dt { font-weight: 600; }
.tp-hours dd { margin-inline-start: 0; text-align: end; font-variant-numeric: tabular-nums; }
.tp-fixture { color: var(--tp-muted-fg); font-style: italic; }
.tp-badges { display: flex; flex-wrap: wrap; gap: 0.75rem; }
.tp-badge { display: inline-flex; align-items: center; padding-block: 0.5rem; padding-inline: 1rem;
  border: 1px solid var(--tp-border); border-radius: 0.6rem; background: var(--tp-fg); color: var(--tp-bg);
  font-size: 0.85rem; font-weight: 600; text-decoration: none; opacity: 0.85; }

/* menu */
.tp-menu-cat { margin-block-start: 2rem; }
.tp-menu-cat > h2 { font-family: var(--tp-font-display); font-size: 1.3rem; padding-block-end: 0.5rem; border-block-end: 2px solid var(--tp-accent-2); margin-block-end: 0.75rem; }
.tp-menu-item { display: flex; gap: 0.75rem; align-items: flex-start; padding-block: 0.85rem; border-block-end: 1px solid var(--tp-border); }
.tp-menu-item--off { opacity: 0.45; }
.tp-menu-item__body { flex: 1; min-inline-size: 0; }
.tp-menu-item__name { font-weight: 700; }
.tp-menu-item__desc { color: var(--tp-muted-fg); font-size: 0.875rem; margin-block-start: 0.15rem; }
.tp-menu-item__prices { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; }
.tp-menu-item__price-size { color: var(--tp-muted-fg); font-size: 0.8rem; }
.tp-chips { display: flex; flex-wrap: wrap; gap: 0.35rem; margin-block-start: 0.4rem; }
.tp-chip { font-size: 0.72rem; padding-block: 0.1rem; padding-inline: 0.55rem; border-radius: 999px;
  background: var(--tp-accent-2); color: var(--tp-accent-2-contrast); font-weight: 600; }
.tp-chip--muted { background: var(--tp-muted); color: var(--tp-fg); }

/* banners / notices */
.tp-banner { padding: 0.75rem 1rem; border-radius: 0.75rem; font-size: 0.9rem; margin-block: 0.75rem; }
.tp-banner--warn { background: #FBEFC9; color: #6b4e00; border: 1px solid #e8cf7a; }
.tp-banner--info { background: var(--tp-surface); border: 1px solid var(--tp-border); color: var(--tp-muted-fg); }
.tp-banner--error { background: #FBE1DF; color: var(--tp-danger); border: 1px solid #eab5b0; }

/* cafe flow */
.tp-cafe { min-block-size: 100dvh; background: var(--tp-bg); color: var(--tp-fg); }
.tp-cafe__topbar { position: sticky; inset-block-start: 0; z-index: 20; background: var(--tp-accent); color: var(--tp-accent-contrast);
  padding-block: 0.6rem; }
.tp-cafe__topbar-inner { display: flex; align-items: center; gap: 0.75rem; }
.tp-cafe__table { font-weight: 800; }
.tp-cafe__topbar a { color: var(--tp-accent-contrast); text-decoration: underline; font-size: 0.85rem; margin-inline-start: auto; }
.tp-paynotice { text-align: center; font-size: 0.8rem; background: var(--tp-accent-2); color: var(--tp-accent-2-contrast);
  padding-block: 0.35rem; padding-inline: 1rem; }
.tp-cattabs { display: flex; gap: 0.5rem; overflow-x: auto; padding-block: 0.75rem; scrollbar-width: none; }
.tp-cattabs button { flex: none; border: 1px solid var(--tp-border); background: var(--tp-surface); color: var(--tp-fg);
  border-radius: 999px; padding-block: 0.4rem; padding-inline: 0.9rem; font-weight: 600; }
.tp-cattabs button[aria-current='true'] { background: var(--tp-accent-2); color: var(--tp-accent-2-contrast); border-color: transparent; }

/* bottom basket bar */
.tp-basketbar { position: fixed; inset-block-end: 0; inset-inline: 0; z-index: 30;
  background: var(--tp-bg); border-block-start: 1px solid var(--tp-border); padding-block: 0.6rem;
  padding-block-end: calc(0.6rem + env(safe-area-inset-bottom)); }
.tp-basketbar__inner { display: flex; align-items: center; gap: 0.75rem; }
.tp-page-with-bar { padding-block-end: 6.5rem; }

/* sheets (item / basket / waiter) */
.tp-sheet-backdrop { position: fixed; inset: 0; z-index: 40; background: rgba(0,0,0,0.45); }
.tp-sheet { position: fixed; inset-inline: 0; inset-block-end: 0; z-index: 50; background: var(--tp-bg);
  border-start-start-radius: 1.25rem; border-start-end-radius: 1.25rem; max-block-size: 85dvh; overflow-y: auto;
  padding: 1.25rem; padding-block-end: calc(1.25rem + env(safe-area-inset-bottom)); max-inline-size: 44rem; margin-inline: auto; }
.tp-sheet h2 { font-family: var(--tp-font-display); font-size: 1.25rem; }
.tp-sheet__row { display: flex; align-items: center; justify-content: space-between; gap: 0.75rem; padding-block: 0.6rem; }
.tp-sheet__group { margin-block-start: 1rem; }
.tp-sheet__group > h3 { font-size: 0.95rem; margin-block-end: 0.35rem; display: flex; gap: 0.5rem; align-items: baseline; }
.tp-sheet__hint { color: var(--tp-muted-fg); font-size: 0.78rem; font-weight: 400; }
.tp-opt { display: flex; align-items: center; gap: 0.6rem; padding-block: 0.5rem; border-block-end: 1px solid var(--tp-border); }
.tp-opt input { inline-size: 1.15rem; block-size: 1.15rem; accent-color: var(--tp-accent); }
.tp-opt__price { margin-inline-start: auto; color: var(--tp-muted-fg); font-size: 0.85rem; white-space: nowrap; }
.tp-qty { display: inline-flex; align-items: center; gap: 0.75rem; }
.tp-qty button { inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; border: 1px solid var(--tp-border);
  background: var(--tp-surface); font-size: 1.1rem; font-weight: 700; color: var(--tp-fg); }
.tp-qty span { min-inline-size: 1.5rem; text-align: center; font-weight: 700; }
.tp-textarea { inline-size: 100%; border: 1px solid var(--tp-border); border-radius: 0.6rem; padding: 0.6rem;
  font: inherit; background: var(--tp-bg); color: var(--tp-fg); resize: vertical; min-block-size: 3.5rem; }

/* order status */
.tp-order { border: 1px solid var(--tp-border); border-radius: 1rem; padding: 0.85rem 1rem; margin-block-start: 0.75rem; background: var(--tp-surface); }
.tp-order__head { display: flex; justify-content: space-between; gap: 0.75rem; font-size: 0.85rem; color: var(--tp-muted-fg); }
.tp-steps { display: flex; gap: 0.4rem; margin-block: 0.6rem; }
.tp-steps span { flex: 1; block-size: 0.4rem; border-radius: 999px; background: var(--tp-border); }
.tp-steps span[data-on='true'] { background: var(--tp-accent-2); }
.tp-order__status { font-weight: 700; }
.tp-order__lines { margin-block-start: 0.4rem; font-size: 0.9rem; color: var(--tp-muted-fg); }

/* waiter */
.tp-reasons { display: grid; grid-template-columns: 1fr 1fr; gap: 0.6rem; margin-block-start: 0.75rem; }
.tp-reasons button { padding-block: 0.9rem; border-radius: 0.8rem; border: 1px solid var(--tp-border); background: var(--tp-surface);
  color: var(--tp-fg); font-weight: 600; }

/* centered boot / error states */
.tp-boot { min-block-size: 70dvh; display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 1rem; text-align: center; padding: 2rem 1.5rem; }
.tp-boot h1 { font-family: var(--tp-font-display); font-size: 1.5rem; }
.tp-boot p { color: var(--tp-muted-fg); max-inline-size: 26rem; }

@media (min-width: 640px) {
  .tp-header__logo { block-size: 3rem; }
}
`;
