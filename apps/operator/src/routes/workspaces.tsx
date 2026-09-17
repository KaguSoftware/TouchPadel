/**
 * WorkspaceSwitcherScreen (spec §05): presented when a staff account holds
 * more than one role, and reachable thereafter from the rail.
 *
 * Each tile is a button, so each one says so with a chevron — the tiles used
 * to be flat cards with nothing marking them as the thing to press. The lead
 * explains what a workspace is instead of claiming the account "holds more
 * than one role", which is not how an owner or a manager thinks of it.
 */
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute, RequireRole, useWorkspace } from './__root';
import { useLocale } from '../lib/i18n';
import { WORKSPACES } from '../lib/workspaces';
import { PageHeader, StatusBadge } from '../components/kit';
import { ChevronForward, Icon } from '../components/icons';

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
  const navigate = useNavigate();
  return (
    <div style={{ maxInlineSize: '64rem' }}>
      <PageHeader title={tr('ws.shell.switcher.title')} subtitle={tr('ws.shell.switcher.lead')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
        {available.map((key) => {
          const ws = WORKSPACES[key];
          const current = key === active;
          return (
            <button
              key={key}
              type="button"
              className="tp-tile"
              aria-current={current ? 'true' : undefined}
              onClick={() => {
                setActive(key);
                void navigate({ to: ws.home });
              }}
              style={{
                background: 'var(--tp-surface)',
                border: `1px solid ${current ? 'var(--tp-accent)' : 'var(--tp-border)'}`,
                borderRadius: 'var(--tp-radius-panel)',
                paddingBlock: 'var(--tp-sp-4)',
                paddingInline: 'var(--tp-sp-4)',
                display: 'grid',
                gap: 'var(--tp-sp-2)',
                alignContent: 'start',
                minBlockSize: '8rem',
                textAlign: 'start',
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                <span style={{ display: 'inline-flex', inlineSize: '2.25rem', blockSize: '2.25rem', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'var(--tp-rail)', color: 'var(--tp-rail-green)' }}>
                  <Icon name={ws.icon} size={18} />
                </span>
                {current ? (
                  <StatusBadge tone="accent" label={tr('ws.shell.switcher.current')} size="sm" />
                ) : (
                  <ChevronForward size={16} style={{ color: 'var(--tp-muted-fg)' }} />
                )}
              </span>
              <span style={{ fontWeight: 700, fontSize: 'var(--tp-fs-lg)' }}>{tr(`ws.shell.workspace.${key}`)}</span>
              <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr(`ws.shell.workspaceLead.${key}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
