/**
 * The "More" disclosure of the analytics bar: the settings an owner touches
 * once a month (business-day start, auto-refresh, covers multiplier, excluded
 * items) live behind one button instead of standing on the filter row all
 * day. An anchored panel, not a modal: it opens under its trigger, stays open
 * while a control inside it is used (a venue-wide setting write reports its
 * error in place), and closes on Escape, an outside press, scroll or resize.
 * Positioning follows the RowActions menu (kit.tsx): `position: fixed` from
 * the trigger's rect, logical insets so Arabic mirrors for free.
 *
 * PORTALLED to <body> for the same reason SelectMenu is: the analytics bar
 * carries backdrop-filter, and a filtered element is a CONTAINING BLOCK for
 * its fixed-position descendants. Rendered in place, this panel's viewport
 * coordinates resolved against the bar and it hung ~16px low, detached from
 * its trigger and floating over the cards below.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../../lib/i18n';

export function MorePanel({
  id,
  open,
  anchorRef,
  onClose,
  label,
  children,
}: {
  id: string;
  open: boolean;
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  children: ReactNode;
}) {
  const { dir } = useLocale();
  const panelRef = useRef<HTMLDivElement>(null);
  const rect = open ? anchorRef.current?.getBoundingClientRect() : undefined;

  useEffect(() => {
    if (!open) return;
    const close = () => onClose();
    const onPointerDown = (e: PointerEvent) => {
      const t = e.target as Node;
      // A menu opened from inside this panel renders in a portal on <body>,
      // so it is not `contains`-ed by either ref — pressing one of its options
      // would otherwise read as a press outside and close the panel.
      if (t instanceof Element && t.closest('[data-menu-portal]')) return;
      if (!panelRef.current?.contains(t) && !anchorRef.current?.contains(t)) close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, onClose, anchorRef]);

  useEffect(() => {
    if (!open) return;
    // The first CONTROL, not simply the first button. This used to read
    // 'select, button, input': once the dropdowns stopped being <select> and
    // became buttons, the first match was the label's InfoTip — so opening
    // Settings focused the tooltip, which opens on focus and covered the very
    // control the panel exists for. InfoTip's trigger already carries
    // .tp-infotip-trigger, so it is skipped by name rather than by DOM order.
    const control = panelRef.current?.querySelector<HTMLElement>(
      '[role="combobox"], input, button:not(.tp-infotip-trigger)',
    );
    control?.focus();
  }, [open]);

  if (!open || !rect) return null;
  // Clamped at both ends. Math.max(8, …) alone only held the panel off the
  // START edge, so a trigger near the end of the bar — which Settings always
  // is, it is the last control on the row — pushed a 22rem panel off screen
  // and the settings inside it were simply unreachable.
  const PANEL_MAX = 22 * 16; // --tp-sp scale is rem; maxInlineSize below in sync
  const GUTTER = 8;
  const raw = dir === 'rtl' ? window.innerWidth - rect.right : rect.left;
  const inlineStart = Math.min(Math.max(GUTTER, raw), Math.max(GUTTER, window.innerWidth - PANEL_MAX - GUTTER));
  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      // The same frosted pane as the dropdowns it contains (.tp-menu-glass):
      // it was the one popover left on an opaque 6px surface.
      className="tp-menu-glass tp-rise"
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }}
      style={{
        position: 'fixed',
        insetInlineStart: `${inlineStart}px`,
        insetBlockStart: `${rect.bottom}px`,
        marginBlockStart: 'var(--tp-sp-1)',
        // The popover rung, deliberately BELOW --tp-z-menu: a dropdown opened
        // from inside this panel has to paint over it, and at the same value
        // the two were settled by DOM order alone.
        zIndex: 'var(--tp-z-popover)',
        display: 'grid',
        gap: 'var(--tp-sp-3)',
        minInlineSize: '16rem',
        maxInlineSize: '22rem',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-3)',
      }}
    >
      {children}
    </div>,
    document.body,
  );
}
