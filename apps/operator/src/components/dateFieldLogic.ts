/**
 * What a native date box is allowed to hand upward.
 *
 * `<input type="date">` is not a text box with a mask: Chromium's spinner
 * accepts up to SIX year digits, and it emits the whole malformed value as one
 * change. Typing a year and then one more key used to send '20285-09-23' into
 * screen state, where `wallTimeToUtc` (which requires exactly 4-2-2) threw
 * during render and took the route down to the crash panel.
 *
 * So the rule is: a keystroke reaches the screen only once it spells a real
 * calendar date. Anything else is held, the box keeps the value it had, and the
 * person carries on typing.
 *
 * Bounds are deliberately NOT applied here. `min`/`max` grey the picker and
 * stop the spinner running away, but a date typed outside them still belongs to
 * the screen's own validation (SeriesCreate reports a past first date that way,
 * and clamping would silently rewrite what the clerk meant).
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The widest year the pickers may reach: four digits, and no more. */
export const MAX_ISO_DATE = '9999-12-31';

/**
 * A complete 'YYYY-MM-DD' naming a date that exists.
 *
 * The round-trip through `Date.UTC` is what rejects 2026-02-31 and 2026-13-01,
 * which match the shape but are not days; UTC is used only because this is
 * calendar arithmetic with no instant involved.
 */
export function isIsoDate(value: string): boolean {
  const m = ISO_DATE.exec(value);
  if (!m) return false;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1) return false;
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/**
 * The value a date box's change should publish, or `null` to publish nothing
 * and leave the field as it was.
 */
export function dateKeystroke(raw: string): string | null {
  return isIsoDate(raw) ? raw : null;
}
