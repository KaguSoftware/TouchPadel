/**
 * Leave the site for `url` in this tab. One seam, so a component test can watch the
 * hand-off instead of jsdom's unimplemented navigation.
 *
 * Same tab, not a new one: the events ticket leaves only after its tear has played, and a
 * browser lets a page open a new tab only within a moment of the click (Safari's window
 * is about a second), so a delayed `window.open` would be blocked as a popup.
 */
export function leaveFor(url: string): void {
  window.location.assign(url);
}
