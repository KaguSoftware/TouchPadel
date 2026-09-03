/**
 * The segmented control's thumb geometry, apart from the component so the one
 * piece with a direction in it can be tested without a renderer.
 *
 * `onLayout` reports a segment's PHYSICAL x within its track, while the thumb
 * is anchored to the logical `start` edge (physical inset properties are
 * lint-banned in this app — full RTL is contractual). Under LTR those agree;
 * under RTL the start edge is the right one, so the offset is measured back
 * from the track's width.
 */
export type Frame = { x: number; width: number };

export const isFrame = (f: Frame | null): f is Frame => f !== null && f.width > 0;

/** Distance from the track's logical start edge to the segment's start edge. */
export function insetStart(f: Frame, trackWidth: number, rtl: boolean): number {
  return rtl ? trackWidth - f.x - f.width : f.x;
}
