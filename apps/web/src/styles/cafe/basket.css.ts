/** Fixed basket bar, basket lines. */
export const basketCss = `
.tp-basketbar { position: fixed; inset-block-end: 0; inset-inline: 0; z-index: var(--tp-z-fab);
  background: var(--tp-bg); border-block-start: 1px solid var(--tp-border); padding-block: 0.6rem;
  padding-block-end: calc(0.6rem + env(safe-area-inset-bottom)); }
.tp-basketbar__inner { display: flex; align-items: center; gap: var(--tp-space-3); }
.tp-basket-btn { position: relative; }
.tp-basket-btn__count { display: inline-grid; place-items: center; min-inline-size: 1.4rem; block-size: 1.4rem; border-radius: var(--tp-radius-pill);
  background: var(--tp-cafe-brown); color: var(--tp-accent-2-contrast); font-size: var(--tp-fs-xs); font-weight: 800; padding-inline: 0.35rem; }
/* Keeps tp-counter's own size and colour — only the alignment and the spacing
   change, so it sits tight under the heading instead of end-aligned under the
   CTA. The negative top margin absorbs the scroll container's leading. */
.tp-basket-keep { margin-block: calc(-1 * var(--tp-space-2)) var(--tp-space-3); text-align: start; }

.tp-basket-line { display: flex; gap: var(--tp-space-3); align-items: flex-start; padding-block: var(--tp-space-3); border-block-end: 1px solid var(--tp-border); }
/* Removal: the row fades and slides out, then collapses the space it held so
   the lines below rise into the gap. overflow:hidden keeps the content from
   spilling once the box starts shrinking. */
.tp-basket-line[data-removing='true'] { overflow: hidden; pointer-events: none;
  animation: tp-row-out var(--tp-dur-base) var(--tp-ease-out) both; }
.tp-basket-line__body { flex: 1; min-inline-size: 0; }
.tp-basket-line__name { font-weight: 700; }
.tp-basket-line__sub { color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); }
.tp-basket-line__note { color: var(--tp-muted-fg); font-size: var(--tp-fs-sm); font-style: italic; }
.tp-basket-line__total { white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 700; color: var(--tp-cafe-brown); }
.tp-basket-line__controls { display: flex; align-items: center; gap: var(--tp-space-3); margin-block-start: var(--tp-space-2); }
/* Remove is an icon button: no word to translate or wrap, and it stays clear of
   the line total above it. The word survives as the aria-label. It sits quiet
   in muted grey and only commits to red on press, so a row of them does not
   read as a row of warnings. The box is larger than the glyph so the tap target
   stays comfortable. */
.tp-basket-line__remove { inline-size: 2.25rem; block-size: 2.25rem; border-radius: 50%; border: none; padding: 0;
  display: grid; place-items: center; background: transparent; color: var(--tp-cafe-ink-soft);
  /* The round tap target is wider than the glyph; nudge it out so the icon,
     not the button's padding, lines up with the total's right edge. */
  margin-inline-end: -0.5rem;
  transition: background var(--tp-dur-fast) var(--tp-ease-out), color var(--tp-dur-fast) var(--tp-ease-out); }
.tp-basket-line__remove:active:not(:disabled) { background: var(--tp-error-bg); color: var(--tp-danger); }
@media (hover: hover) {
  .tp-basket-line__remove:hover:not(:disabled) { background: var(--tp-error-bg); color: var(--tp-danger); }
}
.tp-basket-line__remove:disabled { color: var(--tp-border); }
/* The total pinned to the top of the row, Remove to the bottom so it lands
   level with the stepper and directly under the price. align-self: stretch
   makes the column as tall as the row's text side, which is what lets the two
   split apart instead of bunching at the top. */
.tp-basket-line__aside { display: flex; flex-direction: column; align-items: flex-end;
  justify-content: space-between; align-self: stretch; gap: var(--tp-space-2); }
.tp-basket-totals { margin-block-start: var(--tp-space-4); display: grid; gap: var(--tp-space-1); font-variant-numeric: tabular-nums; }
.tp-basket-totals__row { display: flex; justify-content: space-between; gap: var(--tp-space-3); }
.tp-basket-totals__row--total { font-weight: 800; font-size: var(--tp-fs-lg); color: var(--tp-cafe-brown); }
.tp-basket-totals__row--promo { color: var(--tp-success); }
/* When the last line is on its way out the basket is about to be empty, so the
   note, the totals, the banners and the footer fade with it. Without this they
   all disappear in the single frame the row unmounts, which is the jump that
   reads as the sheet snapping from a full basket to nothing. */
.tp-basket-tail[data-emptying='true'],
.tp-sheet__foot[data-emptying='true'] { animation: tp-fade-out var(--tp-dur-base) var(--tp-ease-out) both; pointer-events: none; }

/* The empty state arrives the moment the last row has finished collapsing, so
   it rises in rather than appearing in the hole the row just left. */
/* The empty sheet has no rows, note field or totals to fill it, so its own
   padding is what decides how tall the sheet sits. Keep it compact — a short
   panel that fits its message, rather than a tall one mostly made of gap. */
.tp-basket-empty { text-align: center; padding-block: var(--tp-space-4); display: grid; gap: var(--tp-space-3); justify-items: center; color: var(--tp-muted-fg);
  animation: tp-slide-up var(--tp-dur-base) var(--tp-ease-out) both; }
/* Matches the sheet's own "Your basket" h2: same face and --tp-fs-lg, and no
   uppercase or tracking, which is what made it read a size larger than the
   heading above it despite both being lg. */
.tp-basket-empty h3 { font-family: var(--tp-font-display); font-size: var(--tp-fs-lg); color: var(--tp-fg); }
.tp-sending { position: absolute; inset: 0; display: grid; place-items: center; background: var(--tp-bg); opacity: 0.92; border-radius: inherit; z-index: var(--tp-z-sticky); }
`;
