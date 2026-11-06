/**
 * Where a scroll view must go so a focused field and the `below` points that
 * follow it sit above the keyboard. Pure (no `react-native` import) so vitest
 * pins it.
 *
 * `fieldBottom` is the field's bottom edge in the scroll's CONTENT, `offset`
 * the current scroll offset, `frame` the scroll's visible height and
 * `keyboard` the part of it the keyboard covers (0 where the window itself
 * shrinks). Returns the new offset, or null when everything already shows:
 * it only ever scrolls DOWN, so a field the system placed well is left alone.
 */
export function revealOffset(a: {
  fieldBottom: number;
  below: number;
  offset: number;
  frame: number;
  keyboard: number;
}): number | null {
  const visible = a.frame - a.keyboard;
  if (visible <= 0) return null;
  const wanted = a.fieldBottom + a.below - visible;
  return wanted > a.offset + 1 ? wanted : null;
}
