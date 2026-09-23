/**
 * The assistant on every owner page (plan §5.1): a sheet on the inline-end
 * side, opened from the rail footer or Ctrl/⌘ K, so "where is …" can be
 * asked from anywhere and the answer's page links keep the section rail.
 *
 * Mounted once in the shell. The open conversation lives in sessionStorage
 * so a reload lands on the same chat; the scopes a new chat starts with are
 * the page's own scope plus Pages and how-to on top of the owner's last set.
 * Owner only — `canAccess('/assistant')` decides, same as the route.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import { Link, useRouterState } from '@tanstack/react-router';
import type { AssistantScope } from '@touch/core/assistant/tools';
import { canAccess, useAuth } from '../../lib/auth';
import { useLocale } from '../../lib/i18n';
import { Button, trapTab } from '../../components/ui';
import { Kbd } from '../../components/kit';
import { Icon } from '../../components/icons';
import { useOwnsScreen } from '../../lib/screenOwner';
import { Thread } from './Thread';
import { initialScopes, loadSessionConversation, saveSessionConversation } from './scopes';

interface DrawerContextValue {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
  toggleDrawer: () => void;
  /** Whether this station's signed-in person may use the assistant at all. */
  allowed: boolean;
}

/** TEMP under-construction: no ⌘K, no drawer, no More-menu row while the assistant is greyed out. */
const DRAWER_UNDER_CONSTRUCTION = true;

const DrawerContext = createContext<DrawerContextValue | null>(null);

export function useAssistantDrawer(): DrawerContextValue {
  const ctx = useContext(DrawerContext);
  if (!ctx) throw new Error('useAssistantDrawer outside AssistantDrawerProvider');
  return ctx;
}

export function useAssistantDrawerOrNull(): DrawerContextValue | null {
  return useContext(DrawerContext);
}

export function AssistantDrawerProvider({ children }: { children: ReactNode }) {
  const { staff } = useAuth();
  const allowed = !DRAWER_UNDER_CONSTRUCTION && canAccess(staff?.role, '/assistant'); // TEMP under-construction
  const [open, setOpen] = useState(false);
  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const toggleDrawer = useCallback(() => setOpen((o) => !o), []);

  // Ctrl/⌘ K anywhere. Not while typing into a field with its own Ctrl+K.
  useEffect(() => {
    if (!allowed) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [allowed]);

  useEffect(() => {
    if (!allowed) setOpen(false);
  }, [allowed]);

  const value = useMemo(() => ({ open: open && allowed, openDrawer, closeDrawer, toggleDrawer, allowed }), [open, allowed, openDrawer, closeDrawer, toggleDrawer]);
  return <DrawerContext.Provider value={value}>{children}</DrawerContext.Provider>;
}

/** The rail footer row. Renders nothing for a role that may not open it. */
export function AssistantRailButton({ style }: { style?: CSSProperties }) {
  const { tr } = useLocale();
  const drawer = useAssistantDrawerOrNull();
  if (!drawer?.allowed) return null;
  return (
    <button type="button" className="tp-nav-item" style={style} onClick={drawer.toggleDrawer} aria-pressed={drawer.open} aria-keyshortcuts="Control+K Meta+K">
      <Icon name="spark" size={16} />
      <span style={{ flex: 1 }}>{tr('ws.shell.nav.assistant')}</span>
      <Kbd>⌘K</Kbd>
    </button>
  );
}

/**
 * Longest we wait for the exit animation's `animationend` before dropping the
 * sheet anyway. Past --tp-dur-fast (160ms) with room to spare.
 */
const EXIT_FALLBACK_MS = 320;

export function AssistantDrawer() {
  const drawer = useAssistantDrawerOrNull();
  const open = drawer?.open ?? false;
  // The sheet outlives `open` by one animation: unmounting the moment the
  // context flips would rip the node out before a single frame of the exit
  // ran, which is why closing used to be instant while opening was not.
  const [mounted, setMounted] = useState(open);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);
  if (!mounted || !drawer) return null;
  return <DrawerSheet open={open} onClose={drawer.closeDrawer} onExited={() => setMounted(false)} />;
}

function DrawerSheet({ open, onClose, onExited }: { open: boolean; onClose: () => void; onExited: () => void }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const panel = useRef<HTMLDivElement>(null);
  const [conversationId, setConversationId] = useState<string | null>(() => loadSessionConversation());
  const [newScopes, setNewScopes] = useState<AssistantScope[]>(() => initialScopes(path, staff?.id ?? ''));

  // The sheet runs to the top edge, so its header sits where the macOS drag
  // strip would be. This stands the strip down for as long as it is open.
  useOwnsScreen();

  const pick = (id: string | null) => {
    setConversationId(id);
    saveSessionConversation(id);
    if (id === null) setNewScopes(initialScopes(path, staff?.id ?? ''));
  };

  // The exit animation. `open` has already flipped false by the time we see
  // it here — AssistantDrawer holds us mounted for exactly this long — so the
  // closing flag is just `!open`, and when the sheet's own animationend lands
  // we tell it to let go.
  const closing = !open;
  // Held in a ref so a re-render underneath us (the thread streaming a reply)
  // cannot re-arm the effect and push the fallback deadline back out.
  const exitedRef = useRef(onExited);
  exitedRef.current = onExited;
  useEffect(() => {
    if (!closing) return;
    const node = panel.current;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      exitedRef.current();
    };
    // animationend bubbles, and the thread below animates rows of its own
    // (.tp-rise on each message, the skeleton sweep), so only the sheet's OWN
    // exit may end it.
    const onEnd = (e: AnimationEvent) => {
      if (e.target === node) finish();
    };
    node?.addEventListener('animationend', onEnd);
    // Reduced motion collapses the animation to 0.01ms and a backgrounded tab
    // may never fire the event, so the sheet is never stranded on screen.
    const timer = window.setTimeout(finish, EXIT_FALLBACK_MS);
    return () => {
      node?.removeEventListener('animationend', onEnd);
      window.clearTimeout(timer);
    };
  }, [closing]);

  // Focus lands on the sheet; Escape closes; Tab stays inside.
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const prev = document.activeElement as HTMLElement | null;
    el.focus();
    return () => prev?.focus?.();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
    } else if (e.key === 'Tab') {
      trapTab(e, panel.current);
    }
  };

  return (
    <>
      <div
        className="tp-sheet-scrim"
        data-closing={closing ? '' : undefined}
        onClick={onClose}
        aria-hidden="true"
        style={{ position: 'fixed', inset: 0, background: 'var(--tp-scrim, rgba(0,0,0,0.25))', zIndex: 'var(--tp-z-overlay)' as CSSProperties['zIndex'] }}
      />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={tr('ws.owner.assistant.title')}
        tabIndex={-1}
        onKeyDown={onKeyDown}
        className="tp-sheet-inline"
        data-closing={closing ? '' : undefined}
        data-assistant-drawer=""
        style={{
          position: 'fixed',
          insetBlock: 0,
          insetInlineEnd: 0,
          inlineSize: 'min(30rem, 100vw)',
          background: 'var(--tp-surface)',
          borderInlineStart: '1px solid var(--tp-border)',
          boxShadow: 'var(--tp-shadow-lg, 0 0 2rem rgba(0,0,0,0.2))',
          // One above its own scrim. A Modal opened from inside the sheet is
          // --tp-z-overlay too and later in DOM order, so it still wins.
          zIndex: 'var(--tp-z-overlay-raised)' as CSSProperties['zIndex'],
          display: 'flex',
          flexDirection: 'column',
          paddingBlock: 'var(--tp-sp-3)',
          paddingInline: 'var(--tp-sp-3)',
          gap: 'var(--tp-sp-2)',
          outline: 'none',
        }}
      >
        <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <Icon name="spark" size={18} />
          <h2 style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, margin: 0, flex: 1 }}>{tr('ws.owner.assistant.title')}</h2>
          <Button size="sm" kind="ghost" icon="plus" onClick={() => pick(null)} title={tr('ws.owner.assistant.newChat')} aria-label={tr('ws.owner.assistant.newChat')} />
          <Link
            to={conversationId ? '/assistant/$id' : '/assistant'}
            params={(conversationId ? { id: conversationId } : {}) as never}
            className="tp-link"
            onClick={onClose}
            style={{ fontSize: 'var(--tp-fs-sm)', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}
          >
            <Icon name="expand" size={14} />
            {tr('ws.owner.assistant.openFullPage')}
          </Link>
          <Button size="sm" kind="ghost" icon="x" onClick={onClose} aria-label={tr('ws.owner.assistant.close')} title={tr('ws.owner.assistant.close')} />
        </header>
        <div style={{ flex: 1, minBlockSize: 0 }}>
          <Thread conversationId={conversationId} onConversation={(id) => pick(id)} newScopes={newScopes} onNewScopesChange={setNewScopes} compact autoFocus onNavigate={onClose} />
        </div>
      </div>
    </>
  );
}
