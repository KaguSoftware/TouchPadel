/**
 * Expiry (spec 06.37) — expiring-soon and expired stock. Batches render
 * individually with their own expiry dates, never as one pile; consumption
 * takes the first-expiring batch first. Write-off is PIN-gated with its OWN
 * reason (app.write_off_expired, reason 'expired'), kept apart from spill and
 * spoilage in the variance report. v_expiring_soon uses the venue-configured
 * window; the day chips narrow the view further by the server's `days_left`.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate, formatNumber } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { usePermissions, requiredRoleFor } from '../../lib/auth';
import { useToast } from '../../components/toast';
import { Button, PinReasonModal } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, ExportButton, Money, PageHeader, Panel, PermissionRefusedNotice, SegmentedControl, StatusBadge, asyncStatus, type Column } from '../../components/kit';
import { downloadCsv, toCsv } from '../analytics/csv';
import { SK } from './stockKeys';

interface BatchRow {
  batch_id: string;
  ingredient_id: string;
  name_en: string;
  name_ar: string;
  unit: string;
  qty_remaining: number;
  unit_cost_iqd: number;
  expiry_date: string;
  days_left?: number;
  days_expired?: number;
}

type Window = 'all' | '7' | '14' | '30';

export function Expiry() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const toast = useToast();
  const can = usePermissions();
  const [window, setWindow] = useState<Window>('all');
  const [writeOff, setWriteOff] = useState<BatchRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const expiringQ = useQuery({
    queryKey: SK.expiring,
    queryFn: async (): Promise<BatchRow[]> => {
      const { data, error: err } = await supabase.from('v_expiring_soon').select('*').order('expiry_date');
      if (err) throw err;
      return data as BatchRow[];
    },
  });
  const expiredQ = useQuery({
    queryKey: SK.expired,
    queryFn: async (): Promise<BatchRow[]> => {
      const { data, error: err } = await supabase.from('v_expired').select('*').order('expiry_date');
      if (err) throw err;
      return data as BatchRow[];
    },
  });

  async function submitWriteOff(pin: string, reasonCode: string) {
    if (!writeOff) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('write_off_expired', { p_batch_id: writeOff.batch_id, p_pin: pin, p_reason_code: reasonCode });
      toast.ok(tr('op.toast.saved'));
      setWriteOff(null);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const expiring = (expiringQ.data ?? []).filter((b) => window === 'all' || (b.days_left ?? 0) <= Number(window));
  const expired = expiredQ.data ?? [];

  function exportCsv() {
    const headers = [tr('op.stock.ingredient'), tr('ws.manager.stock.expiry.batch'), tr('ws.manager.stock.expiry.remaining'), tr('op.stock.unit'), tr('ws.manager.stock.expiry.unitCost'), tr('op.stock.expiry'), tr('ws.manager.stock.overview.status')];
    const rows = [
      ...expired.map((b) => [b.name_en, b.batch_id, b.qty_remaining, b.unit, b.unit_cost_iqd, b.expiry_date, 'expired']),
      ...expiring.map((b) => [b.name_en, b.batch_id, b.qty_remaining, b.unit, b.unit_cost_iqd, b.expiry_date, 'expiring']),
    ];
    downloadCsv('expiry.csv', toCsv(headers, rows));
  }

  const baseColumns = (tone: 'warn' | 'danger'): Column<BatchRow>[] => [
    {
      key: 'ingredient',
      header: tr('op.stock.ingredient'),
      render: (b) => (
        <span>
          <strong>
            <bdi>{pickName(locale, b)}</bdi>
          </strong>{' '}
          <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }} dir="ltr">
            {b.batch_id.slice(0, 8)}
          </span>
        </span>
      ),
    },
    { key: 'remaining', header: tr('ws.manager.stock.expiry.remaining'), numeric: true, render: (b) => <span dir="ltr">{b.qty_remaining} {b.unit}</span> },
    { key: 'cost', header: tr('ws.manager.stock.expiry.unitCost'), numeric: true, render: (b) => <Money amount={b.unit_cost_iqd} /> },
    {
      key: 'expiry',
      header: tone === 'danger' ? tr('ws.manager.stock.expiry.expiredOn') : tr('ws.manager.stock.expiry.expiresOn'),
      render: (b) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center' }}>
          <bdi>{formatDate(new Date(`${b.expiry_date}T00:00:00`), locale)}</bdi>
          <StatusBadge
            size="sm"
            tone={tone}
            label={tone === 'danger' ? tr('op.stock.daysExpired', { days: formatNumber(b.days_expired ?? 0, locale) }) : tr('op.stock.daysLeft', { days: formatNumber(b.days_left ?? 0, locale) })}
          />
        </span>
      ),
    },
  ];

  const expiredColumns: Column<BatchRow>[] = [
    ...baseColumns('danger'),
    {
      key: 'writeOff',
      header: '',
      align: 'end',
      render: (b) => (
        <Button kind="danger" size="sm" icon="ban" disabled={busy || !can.adjustStock} onClick={() => setWriteOff(b)}>
          {tr('op.stock.writeOff')}
        </Button>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('op.stockNav.expiry')}
        subtitle={tr('ws.manager.stock.expiry.lead')}
        actions={<ExportButton onExport={exportCsv} disabled={expired.length + expiring.length === 0} />}
      >
        {!can.adjustStock && <PermissionRefusedNotice action={tr('op.stock.writeOff')} requiredRole={requiredRoleFor('adjustStock')} />}
      </PageHeader>

      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
        <Panel title={tr('op.stock.expiredTitle')} padded={false} actions={<StatusBadge size="sm" tone={expired.length > 0 ? 'danger' : 'neutral'} label={formatNumber(expired.length, locale)} />}>
          <p style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.expiry.writeOffLead')}</p>
          <AsyncStateWrapper
            compact
            status={asyncStatus(expiredQ, (d) => d.length === 0)}
            error={expiredQ.error}
            onRetry={() => void expiredQ.refetch()}
            emptyContent={
              <div style={{ padding: 'var(--tp-sp-3)' }}>
                <EmptyState compact icon="checkCircle" title={tr('ws.manager.stock.expiry.noneExpired')} />
              </div>
            }
          >
            <DataTable columns={expiredColumns} rows={expired} rowKey={(b) => b.batch_id} aria-label={tr('op.stock.expiredTitle')} />
          </AsyncStateWrapper>
        </Panel>

        <Panel
          title={tr('op.stock.expiringTitle')}
          padded={false}
          actions={
            <>
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.stock.expiry.window')}</span>
              <SegmentedControl<Window>
                size="sm"
                value={window}
                onChange={setWindow}
                options={[
                  { value: 'all', label: tr('ws.kit.common.all') },
                  { value: '7', label: tr('ws.manager.stock.expiry.days', { days: 7 }) },
                  { value: '14', label: tr('ws.manager.stock.expiry.days', { days: 14 }) },
                  { value: '30', label: tr('ws.manager.stock.expiry.days', { days: 30 }) },
                ]}
              />
            </>
          }
        >
          <AsyncStateWrapper
            compact
            status={expiringQ.data && expiring.length === 0 ? 'empty' : asyncStatus(expiringQ, (d) => d.length === 0)}
            error={expiringQ.error}
            onRetry={() => void expiringQ.refetch()}
            emptyContent={
              <div style={{ padding: 'var(--tp-sp-3)' }}>
                <EmptyState compact icon="checkCircle" title={tr('ws.manager.stock.expiry.noneExpiring')} />
              </div>
            }
          >
            <DataTable columns={baseColumns('warn')} rows={expiring} rowKey={(b) => b.batch_id} aria-label={tr('op.stock.expiringTitle')} />
          </AsyncStateWrapper>
        </Panel>
      </div>

      {writeOff && (
        <PinReasonModal
          title={`${tr('op.stock.writeOff')} — ${pickName(locale, writeOff)}`}
          reasons={['expired']}
          busy={busy}
          error={error}
          onSubmit={(pin, reason) => void submitWriteOff(pin, reason)}
          onClose={() => {
            setWriteOff(null);
            setError(null);
          }}
        >
          <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', marginBlockEnd: 'var(--tp-sp-2-5)' }}>
            <bdi>
              {writeOff.qty_remaining} {writeOff.unit} · {formatDate(new Date(`${writeOff.expiry_date}T00:00:00`), locale)}
            </bdi>
          </p>
        </PinReasonModal>
      )}
    </div>
  );
}

/** Route alias for the spec name. */
export const ExpiryScreen = Expiry;
