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
export const BASKET_BLOCK_SIZE = '12rem';

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
