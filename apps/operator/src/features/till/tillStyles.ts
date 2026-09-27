/** Small shared style atoms for the till modules. Logical properties only. */
import type { CSSProperties } from 'react';

/**
 * A section heading inside a till panel. It was 12px all-caps with tracking —
 * the same treatment the table heads were just taken OFF, and for the same
 * reason: all-caps at the bottom of the type scale is the worst case for
 * reading at arm's length under cafe lighting (rulebook 6.2 and 11.7). Size
 * and weight carry the hierarchy now; the shape of the word carries the word.
 */
export const sectionTitle: CSSProperties = {
  fontSize: 'var(--tp-fs-sm)',
  fontWeight: 600,
  color: 'var(--tp-muted-fg)',
};

export const kvRow: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'baseline',
  gap: 'var(--tp-sp-2)',
  paddingBlock: 'var(--tp-sp-0)',
};

export const numeric: CSSProperties = {
  fontVariantNumeric: 'tabular-nums',
  fontFamily: 'var(--tp-font-numeric)',
};

export const muted: CSSProperties = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' };

/** 44px minimum touch target on the till (DESIGN.md density). */
export const touchTarget: CSSProperties = { minBlockSize: 'var(--tp-touch)', minInlineSize: 'var(--tp-touch)' };

/**
 * The basket's reserved height. A cashier aims at the item grid without
 * looking; if the basket grew a row every time a line landed, the grid moved
 * under the finger already travelling towards it (rulebook 11.5). The basket
 * therefore claims its space before the first line exists and scrolls inside
 * it — the grid above never resizes for the length of a shift.
 */
export const BASKET_BLOCK_SIZE = '8.5rem';

/** Lines the open basket shows before it starts scrolling. */
export const BASKET_LIST_ROWS = 4;

/**
 * How tall the OPEN list is: exactly BASKET_LIST_ROWS lines and the gaps
 * between them, so the fifth line is the one that starts the scroll.
 *
 * Measured from the line's own controls rather than a round number — a line
 * carries ghost buttons at the 44px touch floor, plus the card's padding and
 * its 1px border on each edge, so a hand-typed height would show four lines
 * and a sliver of a fifth.
 *
 * This is the height of the list ALONE. The basket around it is pinned to the
 * pane's bottom edge by its caller, so a longer list moves the TOP of the
 * basket up and never the bottom — which is what keeps the estimate and Send
 * on a fixed line.
 */
export const BASKET_LIST_OPEN = `calc(${BASKET_LIST_ROWS} * (var(--tp-touch) + 2 * var(--tp-sp-1) + 2px) + ${BASKET_LIST_ROWS - 1} * var(--tp-sp-1))`;

/*
 * What the two numbers buy, at the default density: the header, the reserved
 * status line, the estimate row and the xl Send button take ~8.5rem between
 * them. Closed, that IS the basket — no lines are drawn, and the heading's
 * count says what is in it. Open, 20rem leaves about five lines and the list
 * scrolls past that.
 */

/**
 * The single status line the basket keeps between its list and its Send
 * button: error, then "sending", then why Send is unusable. It is reserved
 * whether or not anything is in it, because the alternative is the Send
 * target sliding down the moment an error arrives.
 */
export const reservedStatusLine: CSSProperties = {
  minBlockSize: 'var(--tp-sp-5)',
  display: 'flex',
  alignItems: 'center',
};

/**
 * A dialog footer whose primary control can grow a `disabledReason` line
 * without moving anything: the row reserves the taller height up front and
 * pins the buttons to its start edge. Modal's own footer is a stretch flex
 * row, so without this wrapper a reason line under one button stretches its
 * neighbour to match.
 */
export const reasonedFooter: CSSProperties = {
  flex: 1,
  display: 'flex',
  gap: 'var(--tp-sp-2)',
  justifyContent: 'flex-end',
  alignItems: 'flex-start',
  flexWrap: 'wrap',
  minBlockSize: '4rem',
};

/**
 * One action button in the tab panel's three-across grid.
 *
 * The buttons carry labels of very different lengths ("Bill" beside "Charge to
 * booking"), so left to themselves they sized to their text and the grid read
 * as a ragged pile rather than a block of equal choices. Filling the cell also
 * keeps each button on the coordinates the cashier last saw it on when one
 * appears or drops out with the tab's state.
 */
export const actionButton: CSSProperties = {
  inlineSize: '100%',
  /* Set here rather than with size="lg" so the label keeps its ordinary
     weight and only the box grows. */
  minBlockSize: '2.5rem',
  /* Bigger than the default control text: these are the panel's main choices,
     pressed with a thumb mid-service. "Charge to booking" — the longest label
     — no longer needs the small size to fit, because it spans two columns. */
  fontSize: 'var(--tp-fs-lg)',
};
