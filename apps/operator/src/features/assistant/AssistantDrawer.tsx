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
  const allowed = canAccess(staff?.role, '/assistant');
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

export function AssistantDrawer() {
  const drawer = useAssistantDrawerOrNull();
  if (!drawer?.open) return null;
  return <DrawerSheet onClose={drawer.closeDrawer} />;
}

function DrawerSheet({ onClose }: { onClose: () => void }) {
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
      <div onClick={onClose} aria-hidden="true" style={{ position: 'fixed', inset: 0, background: 'var(--tp-scrim, rgba(0,0,0,0.25))', zIndex: 'var(--tp-z-overlay)' as CSSProperties['zIndex'] }} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={tr('ws.owner.assistant.title')}
        tabIndex={-1}
        onKeyDown={onKeyDown}
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
