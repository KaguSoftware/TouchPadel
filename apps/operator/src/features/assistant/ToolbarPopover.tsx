/**
 * A button that opens a panel under itself (owner call 2026-10-20, designs C
 * and D): "Reads" holds the scope buttons, the cost pill holds the meter, the
 * composer's model button holds the model choice. Controlled, so another
 * control can open it too. Escape and a press outside close it; Escape stops
 * here so the drawer around it stays open.
 *
 * The trigger is a plain <button> styled by the caller: each of the three is
 * drawn differently (the outlined Reads button with its count, the cost pill
 * with its dot, the composer's quiet model button).
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from '../../components/icons';

/** Past --tp-dur-fast (160ms): how long a closing panel stays for its fade. */
const EXIT_MS = 180;

export function ToolbarPopover({
  open,
  onOpenChange,
  label,
  title,
  panelLabel,
  testId,
  triggerStyle,
  align = 'end',
  side = 'below',
  chevron = true,
  ariaLabel,
  portal = false,
  panelStyle,
  disabled,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: ReactNode;
  title?: string;
  /** The panel's accessible name. */
  panelLabel: string;
  testId?: string;
  triggerStyle?: CSSProperties;
  /** Which edge of the trigger the panel lines up with. */
  align?: 'start' | 'end';
  /** Open under the trigger, or over it (the composer at the foot of a thread). */
  side?: 'below' | 'above';
  /** The open/closed chevron after the label; off for an icon-only trigger. */
  chevron?: boolean;
  /** The trigger's name when its label is only an icon. */
  ariaLabel?: string;
  /**
   * Draw the panel on the page's top layer (fixed, placed from the trigger),
   * for a trigger inside something that clips, like an answer card. Scroll or
   * resize closes it rather than chasing, as InfoTip does.
   */
  portal?: boolean;
  /** Overrides for the panel box (a panel that draws its own bands wants no padding). */
  panelStyle?: CSSProperties;
  disabled?: boolean;
  children: ReactNode;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const [place, setPlace] = useState<CSSProperties | null>(null);
  // Open and close animate (Sait, 2026-10-20): the panel mounts, shows on the
  // next frame, and on close stays mounted until its fade has run.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      // Two frames: the first paints the panel in its start state (faded,
      // nudged), the second moves it to shown, so the transition really runs.
      let second = 0;
      const first = requestAnimationFrame(() => {
        panelRef.current?.getBoundingClientRect();
        second = requestAnimationFrame(() => setShown(true));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    setShown(false);
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const inside = (n: Node) => !!wrap.current?.contains(n) || !!panelRef.current?.contains(n);
    const onDown = (e: PointerEvent) => {
      if (!inside(e.target as Node)) onOpenChange(false);
    };
    document.addEventListener('pointerdown', onDown);
    if (!portal) return () => document.removeEventListener('pointerdown', onDown);
    const onMove = (e: Event) => {
      if (e.type === 'resize' || !(e.target instanceof Node) || !panelRef.current?.contains(e.target)) onOpenChange(false);
    };
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open, onOpenChange, portal]);

  // Top-layer placement: from the trigger's box, in inline terms so Arabic lands right.
  useLayoutEffect(() => {
    if (!portal || !open) return;
    const el = wrap.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const gap = 6;
    const block = side === 'below' ? { insetBlockStart: r.bottom + gap } : { insetBlockEnd: window.innerHeight - r.top + gap };
    // Distances from the viewport's inline edges to the trigger's matching edges.
    const fromStart = rtl ? window.innerWidth - r.right : r.left;
    const fromEnd = rtl ? r.left : window.innerWidth - r.right;
    const inline = align === 'end' ? { insetInlineEnd: Math.max(8, fromEnd) } : { insetInlineStart: Math.max(8, fromStart) };
    setPlace({ position: 'fixed', ...block, ...inline });
  }, [portal, open, side, align]);

  // In place, the panel hangs off the trigger's edge and can run past the
  // window: the composer's Reads button sits right of the model button, so its
  // 27.5rem panel ran 100px off a 1280px screen and "Just help" with it. Pull
  // it back along the inline axis, never past the window's other side.
  const [nudge, setNudge] = useState(0);
  useLayoutEffect(() => {
    if (portal || !mounted) return;
    const el = wrap.current;
    const pane = panelRef.current;
    if (!el || !pane) return;
    const r = el.getBoundingClientRect();
    const rtl = getComputedStyle(el).direction === 'rtl';
    const margin = 8;
    // The panel's distance from the viewport edge it is pinned to (start or end).
    const fromPinned = align === 'end' ? (rtl ? r.left : window.innerWidth - r.right) : rtl ? window.innerWidth - r.right : r.left;
    const overflow = fromPinned + pane.offsetWidth - (window.innerWidth - margin);
    setNudge(Math.max(0, Math.min(overflow, fromPinned - margin)));
  }, [portal, mounted, align]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' && open) {
      e.stopPropagation();
      onOpenChange(false);
    }
  };

  const panel = (
    <div
      ref={panelRef}
      className="tp-pop"
      data-side={side}
      data-shown={shown ? '' : undefined}
      id={panelId}
      role="dialog"
      aria-label={panelLabel}
      onKeyDown={onKeyDown}
      style={{
        ...(portal && place
          ? { ...place, zIndex: 'var(--tp-z-menu)' as unknown as number }
          : {
              position: 'absolute',
              ...(side === 'below' ? { insetBlockStart: 'calc(100% + var(--tp-sp-1-5))' } : { insetBlockEnd: 'calc(100% + var(--tp-sp-1-5))' }),
              ...(align === 'end' ? { insetInlineEnd: 0, marginInlineEnd: -nudge } : { insetInlineStart: 0, marginInlineStart: -nudge }),
              zIndex: 'var(--tp-z-popover)' as unknown as number,
            }),
        inlineSize: 'min(24rem, calc(100vw - 2 * var(--tp-sp-4)))',
        maxBlockSize: '70vh',
        overflowY: 'auto',
        background: 'var(--tp-surface)',
        color: 'var(--tp-fg)',
        border: '1px solid var(--tp-border-strong)',
        borderRadius: 'var(--tp-radius-panel)',
        boxShadow: 'var(--tp-shadow-popover)',
        padding: 'var(--tp-sp-3)',
        ...panelStyle,
      }}
    >
      {children}
    </div>
  );

  return (
    <div ref={wrap} onKeyDown={onKeyDown} style={{ position: 'relative', display: 'inline-flex' }}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        onClick={() => onOpenChange(!open)}
        data-testid={testId}
        className="tp-hover-tint"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 'var(--tp-sp-2)',
          font: 'inherit',
          whiteSpace: 'nowrap',
          cursor: disabled ? 'default' : 'pointer',
          ...triggerStyle,
        }}
      >
        {label}
        {chevron && (
          // One chevron that turns, rather than two icons swapped.
          <span aria-hidden="true" className="tp-pop-chevron" data-flip={open === (side === 'below') ? '' : undefined} style={{ display: 'inline-flex' }}>
            <Icon name="chevronDown" size={14} />
          </span>
        )}
      </button>
      {mounted && (!portal ? panel : place && createPortal(panel, document.body))}
    </div>
  );
}
