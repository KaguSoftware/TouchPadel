/**
 * Menu rows, exactly as the design lists them:
 *
 *   لاتيه              [حار]      3000
 *                     [بارد]
 *   ├ name ┤   ├ temps ┤  ├ price ┤
 *
 * Every item is sold in one size, so a row prints ONE price. Its cell is a
 * fixed 66 px at the end of the row and the number is set flush to that edge,
 * so every price in the menu stacks in one straight vertical line no matter
 * how long the names, chips or descriptions beside them run. There are no size
 * headers over a section for the same reason. The cell is brand blue.
 *
 * The serve-temp chips sit in a 54 px column of their own between the name and
 * the prices, so they line up down the section instead of trailing names of
 * every different length.
 *
 * Every row leads with a 66 px thumbnail on the section band's own tint: the
 * item's photo when it has one, otherwise the section's icon (MenuCard). The
 * full photo still lives in the sheet the row opens. A row stays tappable:
 * `role="button"` is set only while the item is orderable, so a sold-out row
 * never opens a sheet with a dead CTA.
 */
export const cardCss = `
.tp-menu-item { display: flex; align-items: center; gap: 8px; padding-block: 13px; padding-inline: 6px; margin-inline: -6px;
  border-block-end: 1px solid var(--tp-cafe-rule); position: relative;
  transition: background var(--tp-dur-fast); }
.tp-menu-item:last-child { border-block-end: 0; }
.tp-menu-item[role='button'] { cursor: pointer; }
.tp-menu-item[role='button']:active { background: var(--tp-cafe-blue-tint); border-radius: var(--tp-radius-xs); }
.tp-menu-item--off, .tp-menu-item[data-unavailable='true'] { opacity: 0.45; }
.tp-menu-item[data-highlight='blue'] { background: var(--tp-highlight-blue-bg); box-shadow: var(--tp-highlight-ring-blue); border-radius: var(--tp-radius-sm); }
.tp-menu-item[data-highlight='brown'] { background: var(--tp-highlight-green-bg); box-shadow: var(--tp-highlight-ring-green); border-radius: var(--tp-radius-sm); }

/* Thumbnail: the band's tint under the section icon, or the item's photo
   cropped to fill. Square and flex: none, so a long name never squeezes it. */
.tp-menu-item__thumb { flex: none; inline-size: 66px; block-size: 66px; border-radius: var(--tp-radius-sm);
  background: var(--tp-cafe-blue-tint); overflow: hidden; display: flex; align-items: center; justify-content: center; }
.tp-menu-item__thumb[data-tone='green'] { background: var(--tp-cafe-green-tint); }
.tp-menu-item__thumb img { inline-size: 100%; block-size: 100%; object-fit: cover; }
.tp-menu-item__thumb-icon { inline-size: 48px; block-size: 48px; }

.tp-menu-item__body { flex: 1; min-inline-size: 0; }
.tp-menu-item__head { display: flex; align-items: center; gap: 5px 8px; flex-wrap: wrap; }
.tp-menu-item__name { flex: 1 0 100%; font-weight: 700; font-size: 21px; line-height: 1.2; color: var(--tp-cafe-ink); }
/* Latin item names (V60, Kit Kat) are set in the Latin face even in Arabic. */
.tp-menu-item__name[data-latin='true'] { font-family: var(--tp-font-display); }
/* The row's serve-temp chips scale with its 21px name. Scoped, because the
   same .tp-temp also draws the section badge, which keeps its own size. */
.tp-menu-item .tp-temp { font-size: 14px; padding-block: 2px; padding-inline: 0.7rem; }
.tp-menu-item__desc { font-size: 17px; color: var(--tp-cafe-ink-soft); margin-block-start: -2px; }
.tp-menu-item__hook { font-size: 15px; text-transform: uppercase; letter-spacing: var(--tp-tracking-eyebrow); color: var(--tp-cafe-green); font-weight: 700; margin-block-start: 0.15rem; }

.tp-menu-item__price { flex: none; inline-size: 66px; text-align: end; font-family: var(--tp-font-numeric);
  font-weight: 600; font-size: 21px; font-variant-numeric: tabular-nums; line-height: 1.15;
  color: var(--tp-accent); }
/* A discounted row stacks the promo over the struck list price instead of
   setting them side by side, so its column stays the same width as every
   other row's and the vertical line of prices holds. */
.tp-menu-item__price .tp-price--promo,
.tp-menu-item__price .tp-price--struck { display: block; margin-inline-end: 0; }
.tp-menu-item__price .tp-price--struck { font-size: 15px; }

/* Serve-temp chips get a fixed column of their own, immediately before the
   price cells, so every row's chips land in the same place no matter how long
   its name runs. The column is a stack — an item served both ways prints حار
   over بارد — and each chip fills its width so the two read as one block. */
.tp-menu-item__temps { flex: none; inline-size: 54px; display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
.tp-menu-item .tp-menu-item__temps .tp-temp { font-size: 13px; padding-inline: 0.25rem; justify-content: center; }

.tp-price--struck { text-decoration: line-through; color: var(--tp-muted-fg); font-weight: 400; margin-inline-end: 0.4rem; }
.tp-price--promo { color: var(--tp-accent); font-weight: 800; }

.tp-stamp { position: absolute; inset-block-start: 50%; inset-inline-start: 50%; translate: -50% -50%; rotate: -12deg; font-size: 20px; padding-block: 0.3rem; padding-inline: 1rem;
  border: 3px solid var(--tp-danger); color: var(--tp-danger); border-radius: var(--tp-radius-xs); font-family: var(--tp-font-display); font-weight: 800; text-transform: uppercase;
  letter-spacing: var(--tp-tracking-caps); background: var(--tp-bg); animation: tp-stamp-slam var(--tp-dur-slow) var(--tp-ease-out) both; pointer-events: none; }
[dir='rtl'] .tp-stamp { rotate: 12deg; }
`;
