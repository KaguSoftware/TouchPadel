import type { CSSProperties } from 'react';

/**
 * The rail's ONE start edge (rulebook 10.8). Header, group label, link and
 * identity line all resolve to RAIL_PAD + RAIL_ITEM_PAD from the rail's inline
 * start, so nothing sits a few pixels off its neighbour. The header used to be
 * inset 0.9rem against everything else's 1.2rem, and the rhythm around it was
 * freehand — 0.9 / 0.7 / 0.6 / 0.5 / 0.45 / 0.4 / 0.2 / 0.15rem, not one of
 * them on the 4px scale.
 *
 * RAIL_ITEM_PAD is applied inline rather than in GlobalStyles because
 * .tp-nav-item's own 0.7rem is shared with consumers outside this file.
 */
export const RAIL_PAD = 'var(--tp-sp-2)';
export const RAIL_ITEM_PAD = 'var(--tp-sp-3)';
export const RAIL_EDGE = `calc(${RAIL_PAD} + ${RAIL_ITEM_PAD})`;

export const navItemStyle: CSSProperties = { paddingInline: RAIL_ITEM_PAD };
/** A rail control that is a <button>, not a <Link>: same box, no chrome. */
export const navButtonStyle: CSSProperties = {
  ...navItemStyle,
  background: 'transparent',
  border: 'none',
  inlineSize: '100%',
  cursor: 'pointer',
  // LONGHANDS, not `font: inherit`. The shorthand also resets font-weight, and
  // inline styles outrank class rules, so it silently overrode .tp-nav-item's
  // 500 and [data-active]'s 700 on every rail control that is a <button> —
  // leaving them a weight lighter than the <Link> rows beside them. Operations
  // is where that shows, because its collapsible group titles are the only
  // buttons sitting directly above links in the same list.
  fontFamily: 'inherit',
  fontSize: 'inherit',
  lineHeight: 'inherit',
  textAlign: 'start',
};
