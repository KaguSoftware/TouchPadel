/** Tunables for the item sheet (UpperDeck Part B §1.3 parity). */

/** Header drag: pointer travel before the gesture commits to an axis. */
export const DRAG_INTENT_PX = 8;
/** Header drag: downward travel that closes the sheet. */
export const DRAG_CLOSE_PX = 80;
/** Travel over which the backdrop fades out while dragging. */
export const DRAG_FADE_PX = 320;

/** Lightbox pinch bounds + double-tap target. */
export const MIN_SCALE = 1;
export const MAX_SCALE = 5;
export const DOUBLE_TAP_SCALE = 2.5;
/** Lightbox drag-to-dismiss distance (either axis). */
export const LIGHTBOX_DISMISS_PX = 100;
/** Two taps closer than this (ms) count as a double tap. */
export const DOUBLE_TAP_MS = 300;

/** Sold-out stamp slams in this long after the sheet opens. */
export const STAMP_DELAY_MS = 300;

/** Kitchen note cap on the item line. */
export const ITEM_NOTE_MAX = 280;
/** Quantity stepper bounds (buildLine rejects anything outside). */
export const QTY_MIN = 1;
export const QTY_MAX = 99;
