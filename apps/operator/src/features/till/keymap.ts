/**
 * Till keymap (spec R11 — the till is operated by people who are not looking
 * at the screen the whole time). One table drives BOTH the window-level key
 * handler and the help popover, so the two can never disagree.
 *
 *   F2   send basket            F6   new tab
 *   F4   cash pane              /    focus the filter
 *   F5   card pane              ?    keyboard help
 *   1–9  category               Esc  close sheet / dialog (Modal handles it)
 *   ↑↓   rail (roving focus)    ←→↑↓ grid (roving focus), Enter adds
 *
 * Money is NEVER confirmed by a hotkey: F4/F5 only open the pane.
 */

export type TillAction =
  | 'send'
  | 'cash'
  | 'card'
  | 'newTab'
  | 'focusFilter'
  | 'help'
  | 'quickAddFromFilter'
  | 'typeToFilter'
  | { kind: 'category'; index: number };

export interface KeyContext {
  key: string;
  /** The event target is a text-entry control (input/textarea/select). */
  inField: boolean;
  /** The event target is the till's own filter box. */
  inFilter: boolean;
  /** A modal/sheet is open — global letter/number keys must not steal focus. */
  overlayOpen: boolean;
  /** Ctrl/Meta/Alt held — leave browser/OS chords alone. */
  modifier: boolean;
}

/** The rows the help popover renders; label keys resolve under ws.cashier.till.help. */
export const TILL_KEYMAP: readonly { keys: readonly string[]; labelKey: string }[] = [
  { keys: ['F2'], labelKey: 'send' },
  { keys: ['F4'], labelKey: 'cash' },
  { keys: ['F5'], labelKey: 'card' },
  { keys: ['F6'], labelKey: 'newTab' },
  { keys: ['/'], labelKey: 'filter' },
  { keys: ['1', '…', '9'], labelKey: 'categories' },
  { keys: ['↑', '↓'], labelKey: 'rail' },
  { keys: ['←', '→', '↑', '↓', 'Enter'], labelKey: 'grid' },
  { keys: ['Enter'], labelKey: 'quickAdd' },
  { keys: ['Esc'], labelKey: 'escape' },
  { keys: ['?'], labelKey: 'help' },
];

/**
 * Resolve a key press to a till action, or null when the key is not ours.
 * Function keys work everywhere (including inside fields and dialogs — they
 * cannot type). Everything else yields to text entry and to open overlays.
 */
export function resolveTillKey(ctx: KeyContext): TillAction | null {
  if (ctx.modifier) return null;
  switch (ctx.key) {
    case 'F2':
      return 'send';
    case 'F4':
      return 'cash';
    case 'F5':
      return 'card';
    case 'F6':
      return 'newTab';
  }
  if (ctx.overlayOpen) return null;
  if (ctx.inFilter) {
    return ctx.key === 'Enter' ? 'quickAddFromFilter' : null;
  }
  if (ctx.inField) return null;
  if (ctx.key === '/') return 'focusFilter';
  if (ctx.key === '?') return 'help';
  if (/^[1-9]$/.test(ctx.key)) return { kind: 'category', index: Number(ctx.key) - 1 };
  if (ctx.key.length === 1 && /[\p{L}\p{N}]/u.test(ctx.key)) return 'typeToFilter';
  return null;
}

// ---------------------------------------------------------------------------
// Roving focus helpers for the rail (1-D) and the grid (2-D)
// ---------------------------------------------------------------------------

/** Next index in a vertical list; wraps. Home/End jump. Returns null for other keys. */
export function moveInList(key: string, index: number, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Next index in a wrapped grid of `columns` per row. Horizontal arrows follow
 * the reading direction (ArrowRight is "forward" in LTR, "backward" in RTL);
 * vertical arrows step by a whole row and clamp at the edges.
 */
export function moveInGrid(
  key: string,
  index: number,
  count: number,
  columns: number,
  dir: 'ltr' | 'rtl',
): number | null {
  if (count === 0 || columns <= 0) return null;
  const forward = dir === 'rtl' ? 'ArrowLeft' : 'ArrowRight';
  const backward = dir === 'rtl' ? 'ArrowRight' : 'ArrowLeft';
  switch (key) {
    case forward:
      return Math.min(index + 1, count - 1);
    case backward:
      return Math.max(index - 1, 0);
    case 'ArrowDown':
      return index + columns < count ? index + columns : index;
    case 'ArrowUp':
      return index - columns >= 0 ? index - columns : index;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}
