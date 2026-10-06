/**
 * Owner → Settings → Venue details: tournaments at this branch
 * (docs/design/tournaments/build-contracts-2026-10-03.md §1.6
 * set_tournaments_enabled, TD-3). The coaching panel's pattern
 * (CoachingSettingsPanel.tsx), one switch: it reads
 * `venue_settings.tournaments_enabled` for the branch the rail shows and
 * writes app.set_tournaments_enabled (p_venue_id = currentBranchId()).
 *
 * The owner edits (`editVenueDetails`; the RPC is owner-only); a manager reads
 * the switch as Facts with "Only the owner can change this." A server without
 * the column shows nothing. Saving is online only.
 */
import { useQueryClient } from '@tanstack/react-query';
import { appRpc } from '../../../lib/appRpc';
import { useLocale } from '../../../lib/i18n';
import { QK } from '../../../lib/queryKeys';
import { useStationReach } from '../../../lib/stationReach';
import { currentBranchId } from '../../../lib/venueScope';
import { useToast } from '../../../components/toast';
import { Switch } from '../../../components/Switch';
import { Skeleton } from '../../../components/ui';
import { MessagePresenter, Panel } from '../../../components/kit';
import { tournamentErrorText } from '../../tournaments/tournamentLogic';
import { invalidateTournament, useTournamentsSwitch } from '../../tournaments/useTournaments';
import { Facts } from './settingsFields';

const K = 'ws.tournaments.settings';

export function TournamentsSettingsPanel({ canEdit }: { canEdit: boolean }) {
  const { tr } = useLocale();
  const qc = useQueryClient();
  const toast = useToast();
  const { reachable } = useStationReach();
  const branch = currentBranchId();
  const q = useTournamentsSwitch(branch);

  if (q.data === null) return null;

  async function save(next: boolean) {
    // A refusal throws: Switch reverts and toasts the catalogue's line.
    await appRpc('set_tournaments_enabled', { p_venue_id: currentBranchId(), p_enabled: next });
    qc.setQueryData(QK.tournaments.settings(branch), next);
    invalidateTournament(qc);
    toast.ok(tr(`${K}.saved`));
  }

  return (
    <Panel title={tr(`${K}.title`)} data-testid="tournaments-settings">
      {q.data === undefined && !q.isError && <Skeleton lines={2} />}
      {q.isError && q.data === undefined && (
        <MessagePresenter
          tone="refused"
          icon="wifiOff"
          message={tournamentErrorText(q.error, tr)}
        />
      )}
      {typeof q.data === 'boolean' &&
        (canEdit ? (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
            <Switch
              checked={q.data}
              onChange={save}
              label={tr(`${K}.enabled`)}
              disabled={!reachable}
            />
            <p style={{ margin: 0, fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
              {tr(q.data ? `${K}.onHint` : `${K}.offHint`)}
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <MessagePresenter tone="info" icon="lock" message={tr(`${K}.ownerOnly`)} />
            <Facts
              rows={[
                {
                  label: tr(`${K}.enabled`),
                  value: tr(q.data ? `${K}.on` : `${K}.off`),
                  hint: tr(q.data ? `${K}.onHint` : `${K}.offHint`),
                },
              ]}
            />
          </div>
        ))}
    </Panel>
  );
}
