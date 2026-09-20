/**
 * The devices behind offline (degraded) mode — 0118 / C2.
 *
 * Every till, desk and kitchen screen that has ever called app.heartbeat has a
 * row here, and app.is_degraded reasons over those rows: "a till exists and no
 * till is fresh". A till that was renamed, replaced or set up against the wrong
 * project therefore keeps the venue offline until somebody removes its row,
 * and until 0118 nobody could. The owner retires it here; the server sweeps the
 * degraded period in the same transaction and says whether the venue is still
 * offline (another silent till). A retired device that beats again re-registers
 * on its own, so retiring is never destructive.
 *
 * Managers see the list read-only: knowing WHICH till went quiet is most of the
 * diagnosis. "Silent" is computed with the same threshold the server uses
 * (heartbeat_stale_seconds), passed in by the tab so the two cannot disagree.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber } from '@touch/i18n';
import { appRpc } from '../../../lib/appRpc';
import { can, useAuth } from '../../../lib/auth';
import { useLocale } from '../../../lib/i18n';
import { QK } from '../../../lib/queries';
import { useConfirm } from '../../../components/ConfirmDialog';
import { useToast } from '../../../components/toast';
import { Button } from '../../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, Panel, StatusBadge, TableSkeleton, asyncStatus, type Column } from '../../../components/kit';
import { DEVICES_KEY, fetchDevices, isStaleDevice, isTillDevice, type DeviceRow } from './venueQueries';

interface RetireResult {
  device_id: string;
  was_till: boolean;
  degraded: boolean;
}

export function DevicesPanel({ staleSeconds }: { staleSeconds: number }) {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const canRetire = can(staff?.role, 'editVenueDetails');
  const toast = useToast();
  const qc = useQueryClient();
  const confirm = useConfirm();

  // The list is a diagnosis surface; refetch on the heartbeat cadence so
  // "Silent" flips without a reload.
  const devicesQ = useQuery({ queryKey: DEVICES_KEY, queryFn: fetchDevices, refetchInterval: 15_000 });

  const retire = useMutation({
    mutationFn: (deviceId: string) => appRpc<RetireResult>('retire_device', { p_device_id: deviceId }),
    onSuccess: (out) => {
      toast.ok(tr(out.degraded ? 'ws.owner.settings.details.retiredDegraded' : 'ws.owner.settings.details.retired', { device: out.device_id }));
      void qc.invalidateQueries({ queryKey: DEVICES_KEY });
      // The degraded flag every screen polls may have just flipped.
      void qc.invalidateQueries({ queryKey: QK.venueSettings });
    },
    onError: (e) => toast.err(e),
  });

  async function onRetire(d: DeviceRow) {
    const ok = await confirm({
      title: tr('ws.owner.settings.details.retireTitle'),
      body: tr('ws.owner.settings.details.retireBody', { device: d.device_id }),
      confirmLabel: tr('ws.owner.settings.details.retire'),
      kind: 'danger',
    });
    if (ok) retire.mutate(d.device_id);
  }

  const columns: Column<DeviceRow>[] = [
    { key: 'device', header: tr('ws.owner.settings.details.deviceId'), render: (d) => <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{d.device_id}</span> },
    {
      key: 'kind',
      header: tr('ws.owner.settings.details.deviceKind'),
      render: (d) => (isTillDevice(d) ? tr('ws.owner.settings.details.deviceTill') : tr('ws.owner.settings.details.deviceOther')),
    },
    {
      key: 'status',
      header: tr('ws.owner.settings.details.deviceLastSeen'),
      render: (d) => {
        const stale = isStaleDevice(d, staleSeconds);
        return (
          <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-2)', alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusBadge tone={stale ? 'warn' : 'success'} size="sm" label={tr(stale ? 'ws.owner.settings.details.deviceStale' : 'ws.owner.settings.details.deviceFresh')} />
            <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{formatDateTime(new Date(d.last_seen_at), locale)}</span>
          </span>
        );
      },
    },
    { key: 'queue', header: tr('ws.owner.settings.details.deviceQueue'), align: 'end', render: (d) => formatNumber(d.queue_depth, locale) },
    { key: 'version', header: tr('ws.owner.settings.details.deviceVersion'), render: (d) => <span dir="ltr">{d.app_version ?? '—'}</span> },
    ...(canRetire
      ? [
          {
            key: 'retire',
            header: '',
            align: 'end' as const,
            render: (d: DeviceRow) => (
              <Button kind="ghost" icon="trash" busy={retire.isPending && retire.variables === d.device_id} disabled={retire.isPending} onClick={() => void onRetire(d)}>
                {tr('ws.owner.settings.details.retire')}
              </Button>
            ),
          },
        ]
      : []),
  ];

  return (
    <Panel title={tr('ws.owner.settings.details.devicesTitle')}>
      <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('ws.owner.settings.details.devicesLead')}</p>
      <AsyncStateWrapper
        status={asyncStatus(devicesQ, (rows) => rows.length === 0)}
        error={devicesQ.error}
        onRetry={() => void devicesQ.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={3} />}
        emptyContent={<EmptyState icon="wifiOff" title={tr('ws.owner.settings.details.devicesNone')} compact titleAs="h3" />}
      >
        {devicesQ.data && <DataTable columns={columns} rows={devicesQ.data} rowKey={(d) => d.device_id} />}
      </AsyncStateWrapper>
    </Panel>
  );
}
