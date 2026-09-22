/**
 * The read-only detail panel every observe board opens (owner call,
 * 2026-09-13: "read only detail panel with a go to action workspace button —
 * follow this on all").
 *
 * A side sheet, not a dialog: the board it was opened from stays in view, so
 * the owner can read one booking against the rest of the night. It carries NO
 * controls that change anything. Its single way forward is the footer button,
 * which switches the station into the workspace that does the work and opens
 * the same record there — so the switch of mode is explicit and visible, and
 * an owner can never edit a booking while believing they are only looking.
 *
 * Esc and the scrim close it; focus moves in on open and back to the opener on
 * close, the way Modal does.
 */
import { useEffect, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLocale } from '../../lib/i18n';
import { trapTab, Button } from '../../components/ui';
import { Icon } from '../../components/icons';
import { useWorkspace } from '../../routes/__root';
import { useOwnsScreen } from '../../lib/screenOwner';
import type { WorkspaceKey } from '../../lib/workspaces';

export interface WorkspaceTarget {
  workspace: Extract<WorkspaceKey, 'courtDesk' | 'cashier'>;
  /** Where to land inside it: a path plus optional search. */
  to: string;
  search?: Record<string, string>;
  params?: Record<string, string>;
}

/**
 * The panel's travel, shared by the slide in and the slide back out so the two
 * are the same gesture: a different duration or curve on the way out read as a
 * different control rather than the same drawer closing.
 */
const SLIDE_MS = 260;
const SLIDE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';

export function DetailPanel({
  eyebrow,
  title,
  status,
  onClose,
  target,
  children,
}: {
  eyebrow: string;
  title: ReactNode;
  /** A badge beside the title. */
  status?: ReactNode;
  onClose: () => void;
  target: WorkspaceTarget | null;
  children: ReactNode;
}) {
  const { tr, dir } = useLocale();
  const navigate = useNavigate();
  const { available, setActive } = useWorkspace();
  const panelRef = useRef<HTMLElement>(null);
  const backdropRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  /* Guards a second dismissal while the panel is already sliding out. */
  const closing = useRef(false);

  // Runs to the top edge, where the macOS drag strip would eat the header.
  useOwnsScreen();

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.focus();
    if (panel && typeof panel.animate === 'function' && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
      panel.animate([{ transform: `translateX(${dir === 'rtl' ? '-' : ''}100%)` }, { transform: 'translateX(0)' }], {
        duration: SLIDE_MS,
        easing: SLIDE_EASING,
      });
    }
    return () => {
      if (opener && typeof opener.focus === 'function' && opener.isConnected) opener.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  /**
   * Slide back out the way it came in, then unmount.
   *
   * The panel only ever had HALF an animation: it slid in on mount and then
   * vanished between two frames, because the X, the backdrop and Escape all
   * called the caller's `onClose`, which clears the state holding the panel.
   * The reverse keyframes run first and `onClose` waits for them.
   *
   * `animate()` is absent under jsdom and the mount effect already skips it
   * for reduced motion; both fall through to closing on the spot, which is the
   * correct behaviour in either case rather than a panel that will not shut.
   */
  function requestClose() {
    if (closing.current) return;
    const panel = panelRef.current;
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (!panel || typeof panel.animate !== 'function' || reduced) {
      onCloseRef.current();
      return;
    }
    closing.current = true;
    const out = panel.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${dir === 'rtl' ? '-' : ''}100%)` }], {
      duration: SLIDE_MS,
      easing: SLIDE_EASING,
      fill: 'forwards',
    });
    // The scrim goes with it, or the panel slides out from under a dimmed
    // screen that only clears once React unmounts the pair.
    backdropRef.current?.animate([{ opacity: 0.35 }, { opacity: 0 }], { duration: SLIDE_MS, easing: SLIDE_EASING, fill: 'forwards' });
    const done = () => onCloseRef.current();
    out.addEventListener('finish', done, { once: true });
    // A cancelled animation (the tab backgrounded mid-slide) never finishes.
    out.addEventListener('cancel', done, { once: true });
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key === 'Escape') {
      e.stopPropagation();
      requestClose();
    } else if (e.key === 'Tab') {
      trapTab(e, panelRef.current);
    }
  }

  const canGo = target !== null && (available as readonly string[]).includes(target.workspace);

  function go() {
    if (!target) return;
    setActive(target.workspace);
    void navigate({ to: target.to, search: target.search as never, params: target.params as never });
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 'var(--tp-z-overlay)' }}>
      <div ref={backdropRef} aria-hidden onClick={requestClose} style={{ position: 'absolute', inset: 0, background: 'var(--tp-overlay)', opacity: 0.35 }} />
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === 'string' ? title : eyebrow}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        style={{
          position: 'absolute',
          insetBlock: 0,
          insetInlineEnd: 0,
          inlineSize: 'min(28rem, 100vw)',
          background: 'var(--tp-surface)',
          borderInlineStart: '1px solid var(--tp-border)',
          boxShadow: 'var(--tp-shadow-dialog)',
          display: 'flex',
          flexDirection: 'column',
          outline: 'none',
        }}
      >
        <header style={{ padding: 'var(--tp-sp-4)', borderBlockEnd: '1px solid var(--tp-border)', display: 'flex', gap: 'var(--tp-sp-3)', alignItems: 'flex-start' }}>
          <div style={{ flex: 1, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, color: 'var(--tp-muted-fg)', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
              <Icon name="eye" size={13} />
              {eyebrow}
            </span>
            <h2 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700, overflowWrap: 'anywhere' }}>{title}</h2>
            {status}
          </div>
          <Button kind="ghost" size="sm" icon="x" onClick={requestClose} aria-label={tr('ws.kit.drill.close')} title={tr('ws.kit.drill.close')} />
        </header>

        <div style={{ flex: 1, minBlockSize: 0, overflow: 'auto', padding: 'var(--tp-sp-4)', display: 'grid', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
          {children}
        </div>

        <footer style={{ padding: 'var(--tp-sp-4)', borderBlockStart: '1px solid var(--tp-border)', display: 'grid', gap: 'var(--tp-sp-2)' }}>
          <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.observe.panel.readOnly')}</p>
          {canGo && target && (
            <Button kind="primary" iconEnd="arrowUpRight" onClick={go}>
              {tr(target.workspace === 'courtDesk' ? 'ws.owner.observe.panel.goCourtDesk' : 'ws.owner.observe.panel.goCashier')}
            </Button>
          )}
        </footer>
      </aside>
    </div>
  );
}

/** A labelled section inside the panel. */
export function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
      <h3 style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 700, color: 'var(--tp-muted-fg)' }}>{title}</h3>
      {children}
    </section>
  );
}
