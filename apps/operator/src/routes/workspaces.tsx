/**
 * WorkspaceSwitcherScreen (spec §05): presented when a staff account holds
 * more than one workspace, and reachable thereafter from the rail.
 *
 * Redesigned 2026-10-19 (Majed): the tiles fill the screen instead of a 64rem
 * column. Each one has a head in the rail's colour with a line drawing of what
 * that workspace actually runs at the club (components/WorkspaceArt), and a
 * body with its name and one line. The workspace you are in turns its head
 * Padel Green, the rail's own "you are here". Layout: lib/workspaceGrid.
 *
 * Every tile carries its number and the digit key opens it, so a cashier can
 * switch without reaching for the mouse. Choosing a tile goes straight there,
 * with no "Switch to …?" question (owner call, 2026-10-16): opening a
 * workspace loses nothing, and the way back is this same screen.
 */
import { useEffect } from 'react';
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute, RequireRole, useWorkspace } from './__root';
import { useLocale } from '../lib/i18n';
import { WORKSPACES, workspaceHome, type WorkspaceKey } from '../lib/workspaces';
import { canAccess, useAuth } from '../lib/auth';
import { pickerIndexForKey, pickerLayout, PICKER_TRACKS } from '../lib/workspaceGrid';
import { PageHeader } from '../components/kit';
import { ChevronForward, Icon } from '../components/icons';
import { WorkspaceArt } from '../components/WorkspaceArt';
import { isTypingTarget } from '../features/kds/kdsKeyboard';
import { touch } from '../ipc/bridge';

export const workspacesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/workspaces',
  component: () => (
    <RequireRole route="/workspaces">
      <WorkspaceSwitcherScreen />
    </RequireRole>
  ),
});

function WorkspaceSwitcherScreen() {
  const { tr } = useLocale();
  const { active, available, setActive } = useWorkspace();
  const { staff } = useAuth();
  const navigate = useNavigate();
  const station = touch.getStation();
  const { rows, spans } = pickerLayout(available.length);

  /* A workspace's home can depend on who opens it (Management opens on the
     panel for the owner and on Today for a manager), so ask which of its
     homes this person may open rather than taking the first. */
  const open = (key: WorkspaceKey) => {
    setActive(key);
    void navigate({ to: workspaceHome(WORKSPACES[key], (p) => canAccess(staff, p)) });
  };

  /* 1 to 9 open the tile with that number. Not while typing (Go to, a PIN
     prompt), not with a modifier held (Ctrl+1 belongs to the shell), and not
     on a key something else already handled. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTypingTarget(e.target)) return;
      const index = pickerIndexForKey(e.key, available.length);
      if (index === null) return;
      e.preventDefault();
      open(available[index]!);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    /* A full-height column: the header, the grid taking whatever height is
       left, and the build line at the foot. <main> owns its padding, so 100%
       here is its content box. Each row keeps at least 14rem, so a short
       window scrolls rather than squashing the drawings. */
    <div style={{ minBlockSize: '100%', display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-5)' }}>
      <PageHeader
        title={tr('ws.shell.switcher.title')}
        subtitle={tr('ws.shell.switcher.lead')}
        actions={
          available.length > 1 ? (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-md)' }}>
              {tr('ws.shell.switcher.keys', { last: String(Math.min(available.length, 9)) })}
            </span>
          ) : undefined
        }
        style={{ marginBlockEnd: 0 }}
      />
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: `repeat(${PICKER_TRACKS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(14rem, 1fr))`,
          gap: 'var(--tp-sp-4)',
        }}
      >
        {available.map((key, i) => {
          const ws = WORKSPACES[key];
          const current = key === active;
          const number = i < 9 ? String(i + 1) : null;
          return (
            <button
              key={key}
              type="button"
              className="tp-ws-tile"
              data-current={current ? 'true' : undefined}
              aria-current={current ? 'true' : undefined}
              aria-keyshortcuts={number ?? undefined}
              onClick={() => open(key)}
              style={{ gridColumn: `span ${spans[i]}` }}
            >
              <span className="tp-ws-head">
                <WorkspaceArt workspace={key} />
                {current && (
                  <span className="tp-ws-here">
                    <Icon name="check" size={14} strokeWidth={2.4} />
                    {tr('ws.shell.switcher.current')}
                  </span>
                )}
                {number && <span className="tp-ws-key" aria-hidden="true">{number}</span>}
                <span className="tp-ws-icon">
                  <Icon name={ws.icon} size={56} strokeWidth={1.5} />
                </span>
              </span>
              <span className="tp-ws-body">
                <span style={{ flex: 1, minInlineSize: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
                  <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-3xl)', lineHeight: 1.15, color: 'var(--tp-heading)' }}>
                    {tr(`ws.shell.workspace.${key}`)}
                  </span>
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-lg)', lineHeight: 1.4 }}>
                    {tr(`ws.shell.workspaceLead.${key}`)}
                  </span>
                </span>
                <ChevronForward size={24} style={{ color: 'var(--tp-heading)', flex: 'none' }} />
              </span>
            </button>
          );
        })}
      </div>
      {/* The shell build, so "which version is that till on" is answerable
          from the till itself. Centred at the foot of the screen: it belongs
          to the station, not to any one workspace. U+2068/U+2069 isolate the
          Latin version so the Arabic line does not flip its two halves. */}
      <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
        {tr('ws.shell.nav.version', { version: `⁨${station.appVersion}⁩` })}
      </p>
    </div>
  );
}
