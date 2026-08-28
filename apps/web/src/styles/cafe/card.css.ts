/**
 * Menu rows, exactly as the design lists them:
 *
 *   لاتيه [حار][بارد]        3000    4000
 *   ├ name + serve-temp chips ┤ MEDIUM │ LARGE
 *
 * Two price cells of 46 px, in the same DOM order as the size headers above
 * (cheapest first). `data-tier` colours them: the base size is grey, the top
 * size is brand blue. Sections priced at a single size render one blue cell
 * that sizes to its content (`data-cols="1"`).
 *
 * The design carries no thumbnails in the list — an item's photo lives in the
 * sheet the row opens. A row stays tappable: `role="button"` is set only while
 * the item is orderable, so a sold-out row never opens a sheet with a dead CTA.
 */
export const cardCss = `
.tp-menu-item { display: flex; align-items: center; gap: 8px; padding-block: 9px; padding-inline: 4px;
  border-block-end: 1px solid var(--tp-cafe-rule); position: relative;
  transition: background var(--tp-dur-fast); }
.tp-menu-item:last-child { border-block-end: 0; }
.tp-menu-item[role='button'] { cursor: pointer; }
.tp-menu-item[role='button']:active { background: var(--tp-cafe-blue-tint); border-radius: var(--tp-radius-xs); }
.tp-menu-item--off, .tp-menu-item[data-unavailable='true'] { opacity: 0.45; }
.tp-menu-item[data-highlight='blue'] { background: var(--tp-highlight-blue-bg); box-shadow: var(--tp-highlight-ring-blue); border-radius: var(--tp-radius-sm); }
.tp-menu-item[data-highlight='brown'] { background: var(--tp-highlight-green-bg); box-shadow: var(--tp-highlight-ring-green); border-radius: var(--tp-radius-sm); }

.tp-menu-item__body { flex: 1; min-inline-size: 0; }
.tp-menu-item__head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.tp-menu-item__name { font-weight: 700; font-size: 16px; color: var(--tp-cafe-ink); }
/* Latin item names (V60, Kit Kat) are set in the Latin face even in Arabic. */
.tp-menu-item__name[data-latin='true'] { font-family: var(--tp-font-display); }
.tp-menu-item__desc { font-size: 12px; color: var(--tp-cafe-ink-soft); margin-block-start: -2px; }
.tp-menu-item__hook { font-size: 11px; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); color: var(--tp-cafe-green); font-weight: 700; margin-block-start: 0.15rem; }

.tp-menu-item__price { flex: none; inline-size: 46px; text-align: end; font-family: var(--tp-font-numeric);
  font-weight: 600; font-size: 15px; font-variant-numeric: tabular-nums; }
.tp-menu-item__price[data-tier='base'] { color: var(--tp-muted-fg); }
.tp-menu-item__price[data-tier='top'] { color: var(--tp-accent); }
.tp-menu-item[data-cols='1'] .tp-menu-item__price { inline-size: auto; }
.tp-price--struck { text-decoration: line-through; color: var(--tp-muted-fg); font-weight: 400; margin-inline-end: 0.3rem; }
.tp-price--promo { color: var(--tp-accent); font-weight: 800; }

.tp-stamp { position: absolute; inset-block-start: 50%; inset-inline-start: 50%; translate: -50% -50%; rotate: -12deg; padding-block: 0.2rem; padding-inline: 0.7rem;
  border: 3px solid var(--tp-danger); color: var(--tp-danger); border-radius: var(--tp-radius-xs); font-family: var(--tp-font-display); font-weight: 800; text-transform: uppercase;
  letter-spacing: var(--tp-tracking-caps); background: var(--tp-bg); animation: tp-stamp-slam var(--tp-dur-slow) var(--tp-ease-out) both; pointer-events: none; }
[dir='rtl'] .tp-stamp { rotate: 12deg; }
`;
