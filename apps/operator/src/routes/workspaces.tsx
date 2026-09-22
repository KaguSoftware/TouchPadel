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
  const navigate = useNavigate();
  const station = touch.getStation();
  return (
    /* A full-height column so the build line can sit at the FOOT of the
       screen rather than 2rem under the last tile. <main> is a flex item with
       its own padding, so 100% here is the content box it owns; the version's
       `auto` top margin eats whatever is left over. With enough workspaces to
       scroll, there is nothing left over and the line simply follows the
       tiles, which is the same place it would have been anyway.

       The 64rem measure is on the header and the grid, NOT here. It used to
       cap the whole page, which also capped the version line — so "centred"
       centred it in the column of tiles and left it sitting visibly left of
       the middle of the white area it appears to be standing in. */
    <div style={{ minBlockSize: '100%', display: 'flex', flexDirection: 'column' }}>
      <div style={{ maxInlineSize: '64rem' }}>
        <PageHeader title={tr('ws.shell.switcher.title')} subtitle={tr('ws.shell.switcher.lead')} />
      </div>
      <div style={{ maxInlineSize: '64rem', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(15rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
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
      {/* The shell build, so "which version is that till on" is answerable
          from the till itself and not only from device_heartbeats. It used to
          be a third muted line under the rail's identity block, in front of
          every shift all day to answer a question asked about twice a year.
          Here it is out of the way and still somewhere a person on the phone
          can be told to go and read it from.

          Centred, and at the bottom of the screen rather than trailing the
          last tile: it belongs to the station, not to any one workspace, so
          sitting against the grid would read as a caption on the tile above
          it. The page is a column and this has `margin-block-start: auto`,
          which is what carries it down there.

          The centre it takes is the middle of the WHITE area, not of the
          window: this stretches to <main>, which begins where the rail ends,
          so the navy panel is not part of the measure. That is also why it
          escapes the 64rem cap the header and the grid keep.

          U+2068/U+2069 isolate the Latin version inside either direction, the
          same way the rail's line did — without them the Arabic
          "الإصدار dev" flips its two halves. */}
      <p
        style={{
          marginBlockStart: 'auto',
          paddingBlockStart: 'var(--tp-sp-6)',
          textAlign: 'center',
          fontSize: 'var(--tp-fs-xs)',
          color: 'var(--tp-muted-fg)',
        }}
      >
        {tr('ws.shell.nav.version', { version: `\u2068${station.appVersion}\u2069` })}
      </p>
    </div>
  );
}
