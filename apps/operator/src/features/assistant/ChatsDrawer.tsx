/**
 * The chat list as a drawer (owner call 2026-10-20): "Chats" slides the list
 * in from the inline-start edge of the PAGE (never over the rail: it lives in
 * a clipped layer the page positions), with a scrim over the page only; picking a chat,
 * New chat, the close button, the scrim or Escape puts it away. Tab stays
 * inside while it is open, and focus goes back where it was when it closes.
 *
 * Always mounted (`.tp-drawer-start`, GlobalStyles): the list is fetched with
 * the page and the slide is a transform transition, so opening it does no
 * mount, fetch or layout mid-animation. Shut, it is `inert` and hidden.
 *
 * It owns its open state and is opened through `ref.current.open()`: when the
 * page held the flag, every press re-rendered the whole thread on the frame
 * the slide began, and that was the lag. The list itself is memoised, so a
 * press re-renders only this shell.
 */
import { useCallback, useEffect, useImperativeHandle, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type Ref } from 'react';
import { Button, trapTab } from '../../components/ui';

export interface ChatsDrawerHandle {
  open: () => void;
  close: () => void;
}

/**
 * The shell only (2026-10-20): the page hands in the list, the paid chats
 * (ConversationList) or the free AI's (FreeChatList), so the two stay apart
 * and share one drawer. The page's list element keeps its identity across a
 * press, so opening re-renders this shell and not the list.
 */
export function ChatsDrawer({
  ref,
  title,
  count,
  actions,
  header,
  closeLabel,
  children,
}: {
  ref: Ref<ChatsDrawerHandle>;
  title: string;
  /** Shown after the title, muted: "Chats · 12" (design L1). */
  count?: number;
  /** Before the hide button on the title line (the "+ New" button). */
  actions?: ReactNode;
  /** Takes the title's place on the line, before "+ New" and hide (the archived view's "Back to chats"). */
  header?: ReactNode;
  closeLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const onClose = useCallback(() => setOpen(false), []);
  useImperativeHandle(ref, () => ({ open: () => setOpen(true), close: () => setOpen(false) }), []);
  const panel = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      returnTo.current = document.activeElement as HTMLElement | null;
      panel.current?.focus({ preventScroll: true });
    } else if (returnTo.current) {
      returnTo.current.focus?.({ preventScroll: true });
      returnTo.current = null;
    }
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      trapTab(e, panel.current);
    }
  };

  return (
    // The page's own layer: it clips the slide to the page and lets presses
    // through while the drawer is shut. The page is `position: relative`; the
    // layer reaches out over #tp-main's padding (routes/__root.tsx: sp-4 block,
    // sp-5 inline) so the drawer sits flush against the rail and the status
    // strip instead of floating inside the page's margin.
    <div
      data-chats-layer=""
      style={{
        position: 'absolute',
        insetBlock: 'calc(-1 * var(--tp-sp-4))',
        insetInline: 'calc(-1 * var(--tp-sp-5))',
        overflow: 'hidden',
        pointerEvents: 'none',
        zIndex: 'var(--tp-z-popover)' as CSSProperties['zIndex'],
      }}
    >
      <div
        className="tp-drawer-scrim"
        data-open={open ? '' : undefined}
        onClick={onClose}
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, background: 'var(--tp-scrim, rgba(0,0,0,0.25))' }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        aria-hidden={!open}
        inert={!open}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="tp-drawer-start"
        data-open={open ? '' : undefined}
        data-chats-drawer=""
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineStart: 0,
          inlineSize: 'min(22rem, 100%)',
          pointerEvents: 'auto',
          background: 'var(--tp-surface)',
          borderInlineEnd: '1px solid var(--tp-border)',
          boxShadow: 'var(--tp-shadow-lg, 0 0 2rem rgba(0,0,0,0.2))',
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--tp-sp-2-5)',
          paddingBlock: 'var(--tp-sp-3)',
          paddingInline: 'var(--tp-sp-3)',
          outline: 'none',
          contain: 'layout',
        }}
      >
        {/* The title, then the hide button at the far end of the same line (Sait, 2026-10-20). */}
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2-5)' }}>
          {header ? (
            <div style={{ flex: 1, minInlineSize: 0, display: 'flex' }}>{header}</div>
          ) : (
            <h2 style={{ margin: 0, flex: 1, fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
              {title}
              {count !== undefined && <span style={{ fontWeight: 400, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}> · {`⁨${count}⁩`}</span>}
            </h2>
          )}
          {actions}
          <Button kind="default" icon="panelClose" onClick={onClose} aria-label={closeLabel} title={closeLabel} />
        </header>
        <div style={{ flex: 1, minBlockSize: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      </div>
    </div>
  );
}
