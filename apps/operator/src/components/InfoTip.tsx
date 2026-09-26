/**
 * InfoTip: the kit's one explanatory popover. Hover, focus and tap all reach
 * it, which is why `title=` is banned in ui.tsx: a native tooltip answers the
 * mouse only. The panel is ALWAYS in the DOM (`role="tooltip"`, hidden with
 * visibility + opacity) so the trigger's `aria-describedby` resolves whether
 * or not the tip is open; a screen reader hears the explanation from the
 * button itself without ever opening anything.
 *
 * Behaviour:
 * - pointer enter opens after 120ms (cancelled by an early leave); pointer
 *   leave closes 80ms later unless the pointer moved into the panel;
 * - focus opens, blur closes (unless pinned);
 * - click / tap toggles PINNED: it stays open until Escape, an outside
 *   pointerdown, or a second click. Escape returns focus to the trigger and
 *   stops propagation so a parent Modal does not close with it;
 * - the geometry is measured once on open (`position: fixed` from
 *   `getBoundingClientRect`, same as RowActions); scroll or resize closes it
 *   rather than chasing.
 *
 * The only thing that animates is the panel's opacity at --tp-dur-fast (see
 * `.tp-infotip` in GlobalStyles): DESIGN.md forbids layout motion on anything
 * the operator caused, and reduced-motion collapses even that.
 *
 * Custom trigger: pass one `children` element and it is cloned with the same
 * handlers plus `aria-describedby` / `aria-expanded`. It MUST be focusable
 * (a button, a link, or an element with `tabIndex`), otherwise the keyboard
 * path is silently gone; its own handlers still run first.
 */
import {
  cloneElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { useLocale } from '../lib/i18n';
import { Icon } from './icons';

const OPEN_DELAY_MS = 120;
const CLOSE_DELAY_MS = 80;
/** Breathing room between trigger and panel, and the viewport clamp. */
const GAP_PX = 6;
const VIEWPORT_GUTTER_PX = 8;

export type InfoTipPlacement = 'block-end' | 'block-start';

/** Handlers the trigger receives; a custom child may declare any of them. */
interface TriggerProps {
  onPointerEnter?: (e: PointerEvent<HTMLElement>) => void;
  onPointerLeave?: (e: PointerEvent<HTMLElement>) => void;
  onFocus?: (e: FocusEvent<HTMLElement>) => void;
  onBlur?: (e: FocusEvent<HTMLElement>) => void;
  onClick?: (e: MouseEvent<HTMLElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  'aria-describedby'?: string;
  'aria-expanded'?: boolean;
}

export interface InfoTipProps {
  /** The explanation. Plain text or small markup; never a control. */
  content: ReactNode;
  /** Accessible name of the default trigger. Defaults to "More about this". */
  label?: string;
  /** Custom trigger; must be focusable. Omit for the default info icon button. */
  children?: ReactElement<TriggerProps>;
  /** Block side the panel opens on; flips at the viewport edge. */
  placement?: InfoTipPlacement;
  /** Panel width cap. */
  maxInlineSize?: string;
  /** Applied to the DEFAULT trigger only (a custom child keeps its own style). */
  style?: CSSProperties;
}

interface Geometry {
  inlineStart: number;
  blockStart: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function InfoTip({
  content,
  label,
  children,
  placement = 'block-end',
  maxInlineSize = '20rem',
  style,
}: InfoTipProps) {
  const { tr, dir } = useLocale();
  const id = useId();
  const triggerRef = useRef<HTMLElement | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [geometry, setGeometry] = useState<Geometry | null>(null);

  const clearTimers = useCallback(() => {
    if (openTimer.current !== null) window.clearTimeout(openTimer.current);
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const measure = useCallback((): Geometry | null => {
    const trigger = triggerRef.current;
    const panel = panelRef.current;
    if (!trigger || !panel) return null;
    const rect = trigger.getBoundingClientRect();
    const size = panel.getBoundingClientRect();
    const viewportInline = window.innerWidth;
    const viewportBlock = window.innerHeight;

    const below = rect.bottom + GAP_PX;
    const above = rect.top - size.height - GAP_PX;
    const fitsBelow = rect.bottom + size.height + VIEWPORT_GUTTER_PX <= viewportBlock;
    const fitsAbove = above >= VIEWPORT_GUTTER_PX;
    let blockStart: number;
    if (placement === 'block-start') blockStart = fitsAbove || !fitsBelow ? above : below;
    else blockStart = fitsBelow || !fitsAbove ? below : above;

    // Logical inset: in Arabic inset-inline-start resolves to the RIGHT edge,
    // so the distance is taken from the trigger's right edge to the viewport's.
    const inlineStart = dir === 'rtl' ? viewportInline - rect.right : rect.left;

    return {
      inlineStart: clamp(inlineStart, VIEWPORT_GUTTER_PX, viewportInline - size.width - VIEWPORT_GUTTER_PX),
      blockStart: clamp(blockStart, VIEWPORT_GUTTER_PX, viewportBlock - size.height - VIEWPORT_GUTTER_PX),
    };
  }, [dir, placement]);

  const show = useCallback(() => {
    clearTimers();
    setGeometry(measure());
    setOpen(true);
  }, [clearTimers, measure]);

  const hide = useCallback(() => {
    clearTimers();
    setOpen(false);
    setPinned(false);
  }, [clearTimers]);

  const scheduleClose = useCallback(() => {
    if (openTimer.current !== null) {
      window.clearTimeout(openTimer.current);
      openTimer.current = null;
    }
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      setOpen(false);
    }, CLOSE_DELAY_MS);
  }, []);

  // Pinned: the operator asked for it to stay, so only an explicit gesture
  // outside takes it away. Any open tip dies on scroll / resize because the
  // measured rect no longer describes where the trigger is.
  useEffect(() => {
    if (!open) return;
    const close = () => hide();
    const onPointerDown = (e: globalThis.PointerEvent) => {
      const t = e.target as Node;
      if (!panelRef.current?.contains(t) && !triggerRef.current?.contains(t)) hide();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    if (pinned) document.addEventListener('pointerdown', onPointerDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open, pinned, hide]);

  function remember(e: { currentTarget: EventTarget & HTMLElement }) {
    triggerRef.current = e.currentTarget;
  }

  const handlers: Required<Pick<TriggerProps, 'onPointerEnter' | 'onPointerLeave' | 'onFocus' | 'onBlur' | 'onClick' | 'onKeyDown'>> = {
    onPointerEnter(e) {
      remember(e);
      if (closeTimer.current !== null) {
        window.clearTimeout(closeTimer.current);
        closeTimer.current = null;
      }
      if (open || openTimer.current !== null) return;
      openTimer.current = window.setTimeout(() => {
        openTimer.current = null;
        show();
      }, OPEN_DELAY_MS);
    },
    onPointerLeave(e) {
      if (openTimer.current !== null) {
        window.clearTimeout(openTimer.current);
        openTimer.current = null;
      }
      // A focused trigger keeps its tip: the keyboard opened it, the keyboard closes it.
      if (pinned || document.activeElement === e.currentTarget) return;
      scheduleClose();
    },
    onFocus(e) {
      remember(e);
      show();
    },
    onBlur(e) {
      if (pinned) return;
      if (e.relatedTarget && panelRef.current?.contains(e.relatedTarget as Node)) return;
      hide();
    },
    onClick(e) {
      remember(e);
      if (pinned) {
        hide();
        return;
      }
      setPinned(true);
      show();
    },
    onKeyDown(e) {
      if (e.key !== 'Escape' || !open) return;
      e.stopPropagation();
      e.preventDefault();
      hide();
      triggerRef.current?.focus();
    },
  };

  const trigger = children ? (
    cloneElement(children, {
      onPointerEnter: chain(children.props.onPointerEnter, handlers.onPointerEnter),
      onPointerLeave: chain(children.props.onPointerLeave, handlers.onPointerLeave),
      onFocus: chain(children.props.onFocus, handlers.onFocus),
      onBlur: chain(children.props.onBlur, handlers.onBlur),
      onClick: chain(children.props.onClick, handlers.onClick),
      onKeyDown: chain(children.props.onKeyDown, handlers.onKeyDown),
      'aria-describedby': id,
      'aria-expanded': pinned,
    })
  ) : (
    // Not the kit Button: it forwards none of aria-describedby, aria-expanded,
    // onPointerEnter or onBlur, and every one of them is the point here.
    <button
      type="button"
      className="tp-btn tp-iconbtn tp-infotip-trigger"
      data-kind="ghost"
      data-size="sm"
      aria-label={label ?? tr('ws.kit.infoTip.label')}
      aria-describedby={id}
      aria-expanded={pinned}
      style={style}
      {...handlers}
    >
      <Icon name="info" size={14} />
    </button>
  );

  return (
    <>
      {trigger}
      {/* Portalled for the same reason SelectMenu and MorePanel are: this is
          position:fixed, and both the frosted analytics bar (backdrop-filter)
          and the portalled Settings panel are containing blocks for fixed
          descendants. Rendered in place, the bubble's viewport coordinates
          resolved against them — inside Settings it landed off-screen, so the
          button lit up and nothing appeared. */}
      {createPortal(
      <div
        ref={panelRef}
        id={id}
        role="tooltip"
        className="tp-infotip tp-menu-glass"
        data-open={open ? 'true' : 'false'}
        onPointerEnter={() => {
          if (closeTimer.current !== null) {
            window.clearTimeout(closeTimer.current);
            closeTimer.current = null;
          }
        }}
        onPointerLeave={() => {
          if (!pinned) scheduleClose();
        }}
        onKeyDown={handlers.onKeyDown}
        style={{
          insetInlineStart: geometry ? `${geometry.inlineStart}px` : undefined,
          insetBlockStart: geometry ? `${geometry.blockStart}px` : undefined,
          maxInlineSize,
          color: 'var(--tp-fg)',
          fontSize: 'var(--tp-fs-sm)',
          lineHeight: 1.45,
          paddingBlock: 'var(--tp-sp-2)',
          paddingInline: 'var(--tp-sp-2-5)',
        }}
      >
        {content}
      </div>,
      document.body,
      )}
    </>
  );
}

/** The child's own handler runs first; ours never swallows it. */
function chain<E>(theirs: ((e: E) => void) | undefined, ours: (e: E) => void): (e: E) => void {
  if (!theirs) return ours;
  return (e) => {
    theirs(e);
    ours(e);
  };
}
