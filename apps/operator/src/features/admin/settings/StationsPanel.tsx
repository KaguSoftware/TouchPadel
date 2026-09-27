/**
 * Stations of the branch in scope (multi-venue slice 4, 0222).
 *
 * Until 0222 a station existed once its first heartbeat registered it, at
 * whatever branch the signed-in person resolved to. Now a manager or owner
 * registers this machine at the branch on purpose (app.register_station), with
 * what it is (till, desk, kitchen screen), and retires a station that is gone
 * (app.retire_station: the row stays stamped, its heartbeat goes). A new
 * branch's readiness checklist waits for its first registered till.
 *
 * The name is this machine's station id from its setup (station.json); it is
 * not typed here, because a different name would register a station no machine
 * is.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime } from '@touch/i18n';
import type { MessageKey } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { appRpc } from '../../../lib/appRpc';
import { can, useAuth } from '../../../lib/auth';
import { useLocale, pickName } from '../../../lib/i18n';
import { station } from '../../../lib/idem';
import { useVenue } from '../../../lib/venue';
import { touch } from '../../../ipc/bridge';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/toast';
import { Button, ErrorText } from '../../../components/ui';
import { EmptyState, Panel, StatusBadge } from '../../../components/kit';

interface StationRow {
  id: string;
  venue_id: string;
  mode: 'till' | 'desk' | 'kds' | null;
  is_till: boolean;
  retired_at: string | null;
  registered_at: string;
}

export const STATIONS_KEY = ['stations', 'branch'] as const;

export function StationsPanel() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const { branchId, current, stationBranchId } = useVenue();
  const canManage = can(staff?.role, 'editVenueDetails') || staff?.role === 'manager';
  const here = station();
  const hereMode = touch.getStation().mode;

  const stationsQ = useQuery({
    queryKey: [...STATIONS_KEY, branchId],
    enabled: Boolean(branchId),
    queryFn: async (): Promise<StationRow[]> => {
      // RLS narrows stations to the branch in scope (0226).
      const { data, error } = await supabase
        .from('stations')
        .select('id, venue_id, mode, is_till, retired_at, registered_at')
        .order('id');
      if (error) throw error;
      return ((data ?? []) as unknown as StationRow[]).filter((s) => s.venue_id === branchId);
    },
  });

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: STATIONS_KEY });
    void qc.invalidateQueries({ queryKey: ['venues'] });
    void qc.invalidateQueries({ queryKey: ['branches'] });
  };

  const register = useMutation({
    mutationFn: () =>
      appRpc('register_station', {
        p_id: here,
        p_venue_id: branchId,
        p_mode: hereMode === 'desk' || hereMode === 'kds' ? hereMode : 'till',
      }),
    onSuccess: () => {
      toast.ok(tr('ws.branches.stations.register'));
      refresh();
    },
    onError: (e) => toast.err(e),
  });

  const retire = useMutation({
    mutationFn: (id: string) => appRpc('retire_station', { p_id: id }),
    onSuccess: refresh,
    onError: (e) => toast.err(e),
  });

  const live = (stationsQ.data ?? []).filter((s) => !s.retired_at);
  const thisRegisteredHere = stationBranchId === branchId && live.some((s) => s.id === here);

  return (
    <Panel title={tr('ws.branches.stations.title')} data-testid="stations-panel">
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        <p style={{ margin: 0, fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.branches.stations.intro')}</p>
        {canManage && !thisRegisteredHere && branchId && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
            <span dir="ltr" style={{ fontWeight: 600 }}>{here}</span>
            <span style={{ color: 'var(--tp-muted-fg)' }}>
              {tr(`ws.branches.stations.modes.${hereMode === 'desk' || hereMode === 'kds' ? hereMode : 'till'}` as MessageKey)}
              {current ? ` · ${pickName(locale, current)}` : ''}
            </span>
            <Button kind="primary" size="sm" busy={register.isPending} onClick={() => register.mutate()} data-testid="station-register">
              {tr('ws.branches.stations.register')}
            </Button>
          </div>
        )}
        {stationsQ.error ? (
          <ErrorText error={stationsQ.error} />
        ) : live.length === 0 ? (
          <EmptyState compact title={tr('ws.branches.stations.never')} />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
            {live.map((s) => (
              <li key={s.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                  <strong dir="ltr">{s.id}</strong>
                  <StatusBadge
                    size="sm"
                    dot={false}
                    label={tr(`ws.branches.stations.modes.${s.mode ?? (s.is_till ? 'till' : 'desk')}` as MessageKey)}
                  />
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>
                    {formatDateTime(new Date(s.registered_at), locale)}
                  </span>
                </span>
                {canManage && (
                  <Button
                    size="sm"
                    kind="ghost"
                    busy={retire.isPending && retire.variables === s.id}
                    onClick={async () => {
                      const yes = await confirm({
                        title: tr('ws.branches.stations.retire'),
                        body: tr('ws.branches.stations.retireConfirm', { name: s.id }),
                        kind: 'danger',
                      });
                      if (yes) retire.mutate(s.id);
                    }}
                  >
                    {tr('ws.branches.stations.retire')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}
