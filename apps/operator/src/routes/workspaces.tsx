/**
 * WorkspaceSwitcherScreen (spec §05): presented when a staff account holds
 * more than one role, and reachable thereafter from the rail.
 */
import { createRoute, useNavigate } from '@tanstack/react-router';
import { rootRoute, RequireRole, useWorkspace } from './__root';
import { useLocale } from '../lib/i18n';
import { WORKSPACES } from '../lib/workspaces';
import { PageHeader, StatusBadge } from '../components/kit';
import { Icon } from '../components/icons';

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
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: '0.75rem' }}>
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
                paddingBlock: '1rem',
                paddingInline: '1rem',
                display: 'grid',
                gap: '0.5rem',
                minBlockSize: '8rem',
              }}
            >
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ display: 'inline-flex', inlineSize: '2.25rem', blockSize: '2.25rem', alignItems: 'center', justifyContent: 'center', borderRadius: '50%', background: 'var(--tp-rail)', color: 'var(--tp-rail-green)' }}>
                  <Icon name={ws.icon} size={18} />
                </span>
                {current && <StatusBadge tone="accent" label={tr('ws.shell.switcher.current')} size="sm" />}
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
