/** Menu item rows/cards: photo, name, hook, description, allergens, prices, highlight + sold-out. */
export const cardCss = `
.tp-menu-item { display: flex; gap: var(--tp-space-3); align-items: flex-start; padding-block: 0.85rem; border-block-end: 1px solid var(--tp-border); position: relative;
  border-radius: var(--tp-radius-sm); transition: background var(--tp-dur-fast); }
.tp-menu-item[role='button'] { cursor: pointer; }
.tp-menu-item[role='button']:active { background: var(--tp-surface); }
.tp-menu-item--off, .tp-menu-item[data-unavailable='true'] { opacity: 0.45; }
.tp-menu-item[data-highlight='blue'] { background: var(--tp-highlight-blue-bg); box-shadow: var(--tp-highlight-ring-blue); padding-inline: var(--tp-space-3); }
.tp-menu-item[data-highlight='brown'] { background: var(--tp-highlight-brown-bg); box-shadow: var(--tp-highlight-ring-brown); padding-inline: var(--tp-space-3); }
.tp-menu-item__photo { flex: none; inline-size: 7rem; block-size: 7rem; border-radius: var(--tp-radius-sm); overflow: hidden; background: var(--tp-cafe-brown-tint); position: relative; }
.tp-menu-item__photo img { inline-size: 100%; block-size: 100%; object-fit: cover; display: block; }
.tp-menu-item__body { flex: 1; min-inline-size: 0; }
.tp-menu-item__name { font-weight: 700; }
.tp-menu-item__hook { font-size: 11px; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); color: var(--tp-cafe-brown); font-weight: 700; margin-block-start: 0.15rem; }
.tp-menu-item__desc { color: var(--tp-muted-fg); font-size: 0.875rem; margin-block-start: 0.15rem; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.tp-menu-item__prices { text-align: end; white-space: nowrap; font-variant-numeric: tabular-nums; color: var(--tp-cafe-brown); font-weight: 700; }
.tp-menu-item__price-size { color: var(--tp-muted-fg); font-size: 0.8rem; font-weight: 400; }
.tp-stamp { position: absolute; inset-block-start: 50%; inset-inline-start: 50%; translate: -50% -50%; rotate: -12deg; padding-block: 0.2rem; padding-inline: 0.7rem;
  border: 3px solid var(--tp-danger); color: var(--tp-danger); border-radius: var(--tp-radius-xs); font-family: var(--tp-font-display); font-weight: 800; text-transform: uppercase;
  letter-spacing: var(--tp-tracking-caps); background: var(--tp-bg); animation: tp-stamp-slam var(--tp-dur-slow) var(--tp-ease-out) both; pointer-events: none; }
[dir='rtl'] .tp-stamp { rotate: 12deg; }
/* next/image 'fill' needs an explicitly positioned box (the photo well is
   already position: relative) and must cover it. */
.tp-menu-item__photo img { object-fit: cover; }
.tp-menu-item[data-sold-out='true'] .tp-menu-item__photo { opacity: 0.55; }
.tp-menu-item__prices { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; }
`;
