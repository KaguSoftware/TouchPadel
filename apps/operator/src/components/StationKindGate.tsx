/**
 * The refusal a screen shows on a station of the wrong kind (F-29): the shop
 * till and drawer off the shop station, the kitchen board off a kitchen
 * screen or the café till. Rules in lib/stationKind.ts.
 */
import type { ReactNode } from 'react';
import { Link } from '@tanstack/react-router';
import { homeRouteFor, useAuth } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { isElectron } from '../lib/mutate';
import { stationKindRefusal, type StationScreen } from '../lib/stationKind';
import { touch } from '../ipc/bridge';
import { EmptyState } from './kit';

export function StationKindGate({ screen, children }: { screen: StationScreen; children: ReactNode }) {
  const { tr } = useLocale();
  const { staff } = useAuth();
  const station = touch.getStation();
  const refused = stationKindRefusal(screen, { electron: isElectron(), mode: station.mode });
  if (refused === null) return <>{children}</>;
  const mode = tr(`ws.shell.stationKind.modes.${refused}`);
  return (
    <div role="alert" data-testid="station-kind-refused" style={{ maxInlineSize: 'var(--tp-measure-form)', marginInline: 'auto', paddingBlock: 'var(--tp-sp-5)' }}>
      <EmptyState
        icon="ban"
        title={tr(screen === 'shopTill' ? 'ws.shell.stationKind.shopTitle' : 'ws.shell.stationKind.kdsTitle')}
        body={tr(screen === 'shopTill' ? 'ws.shell.stationKind.shopBody' : 'ws.shell.stationKind.kdsBody', { mode })}
        action={
          staff ? (
            <Link to={homeRouteFor(staff)} className="tp-link">
              {tr('ws.shell.stationKind.home')}
            </Link>
          ) : undefined
        }
      />
    </div>
  );
}
