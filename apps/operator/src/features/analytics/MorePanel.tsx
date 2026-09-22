/**
 * The "More" disclosure of the analytics bar: the settings an owner touches
 * once a month (business-day start, auto-refresh, covers multiplier, excluded
 * items) live behind one button instead of standing on the filter row all
 * day. An anchored panel, not a modal: it opens under its trigger, stays open
 * while a control inside it is used (a venue-wide setting write reports its
 * error in place), and closes on Escape, an outside press, scroll or resize.
 * Positioning follows the RowActions menu (kit.tsx): `position: fixed` from
 * the trigger's rect, logical insets so Arabic mirrors for free.
 */
import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
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
    if (open) panelRef.current?.querySelector<HTMLElement>('select, button, input')?.focus();
  }, [open]);

  if (!open || !rect) return null;
  const inlineStart = dir === 'rtl' ? window.innerWidth - rect.right : rect.left;
  return (
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      onKeyDown={(e) => {
        if (e.key !== 'Escape') return;
        e.stopPropagation();
        onClose();
        anchorRef.current?.focus();
      }}
      style={{
        position: 'fixed',
        insetInlineStart: `${Math.max(8, inlineStart)}px`,
        insetBlockStart: `${rect.bottom}px`,
        marginBlockStart: 'var(--tp-sp-1)',
        zIndex: 'var(--tp-z-popover)',
        display: 'grid',
        gap: 'var(--tp-sp-3)',
        minInlineSize: '16rem',
        maxInlineSize: '22rem',
        background: 'var(--tp-surface)',
        border: '1px solid var(--tp-border)',
        borderRadius: 'var(--tp-radius-ctl)',
        boxShadow: 'var(--tp-shadow-popover)',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-3)',
      }}
    >
      {children}
    </div>
  );
}
