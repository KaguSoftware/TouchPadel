/**
 * Whether a modal dialog is open on top of the screen.
 *
 * Window-level key listeners (the kitchen board's 1–9 / S / R / C / Space,
 * the desk calendar's arrows, the shop's barcode wedge) fire no matter where
 * focus is, so without this check a key pressed inside a dialog also acted on
 * the screen behind it. Every dialog in the app is a `Modal` (components/ui)
 * or a hand-rolled panel with the same two attributes, so the DOM is the one
 * place that knows.
 */
export function isModalOpen(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}
