/**
 * Expiry (spec 06.37) — expired and expiring-soon stock. Batches render
 * individually with their own expiry dates, never as one pile; consumption
 * takes the first-expiring batch first. Write-off is PIN-gated with its OWN
 * reason (app.write_off_expired, reason 'expired'), kept apart from spill and
 * spoilage in the variance report.
 *
 * Reads report_stock (0068) rather than the two views: it carries the same
 * batches plus what each is worth, rounded on the server, which is the number
 * that makes "throw this out" concrete. The screen used to crash twice over:
 * On hand cached the views' key with bare ids, and the cost column handed a
 * fractional per-gram cost to `Money`.
 *
 * The 7 / 14 / 30-day chips are gone: the expiring list is already cut at the
 * venue's window (three days by default, venue_settings.expiring_soon_days),
 * so every chip showed the same rows. The subtitle says the window instead.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { usePermissions } from '../../lib/auth';
import { useToast } from '../../components/toast';
import { Button, PinReasonModal } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, ExportButton, Money, PageHeader, Panel, StatusBadge, TableSkeleton, asyncStatus, type Column } from '../../components/kit';
import { downloadCsv, toCsv } from '../analytics/csv';
import { dateOnlyCell, dayCell } from '../analytics/csvFormat';
import { CardTitle } from '../ops/OpsVisuals';
import { useStockFormat } from './stockUi';
import { SK, fetchExpiryWindow, fetchSummary, type SummaryBatch } from './stockKeys';

export function Expiry() {
  const { tr, locale } = useLocale();
  const fmt = useStockFormat();
  const queryClient = useQueryClient();
  const toast = useToast();
  const can = usePermissions();
  const [writeOff, setWriteOff] = useState<SummaryBatch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const summaryQ = useQuery({ queryKey: SK.summary, queryFn: fetchSummary });
  const windowQ = useQuery({ queryKey: SK.expiryWindow, queryFn: fetchExpiryWindow, staleTime: 5 * 60_000 });
  const expired = summaryQ.data?.expired ?? [];
  const expiring = summaryQ.data?.expiringSoon ?? [];
  const nameOf = (b: SummaryBatch) => pickName(locale, { name_en: b.nameEn, name_ar: b.nameAr });
  const dateOf = (b: SummaryBatch) => formatDate(new Date(`${b.expiryDate}T00:00:00`), locale);

  async function submitWriteOff(pin: string, reasonCode: string) {
    if (!writeOff) return;
    setBusy(true);
    setError(null);
    try {
      await appRpc('write_off_expired', { p_batch_id: writeOff.batchId, p_pin: pin, p_reason_code: reasonCode });
      toast.ok(tr('ws.manager.stock.expiry.written', { name: nameOf(writeOff) }));
      setWriteOff(null);
      void queryClient.invalidateQueries({ queryKey: ['stock'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  function exportCsv() {
    const headers = [
      tr('op.stock.ingredient'),
      tr('ws.manager.stock.expiry.remaining'),
      tr('op.stock.unitLabel'),
      tr('ws.manager.stock.expiry.expiryDate'),
      tr('ws.manager.stock.expiry.worth'),
      tr('ws.manager.stock.expiry.state'),
    ];
    const rows = [
      ...expired.map((b) => [nameOf(b), b.qtyRemaining, fmt.unit(b.unit), dateOnlyCell(b.expiryDate), b.valueIqd, tr('ws.manager.stock.expiry.stateExpired')]),
      ...expiring.map((b) => [nameOf(b), b.qtyRemaining, fmt.unit(b.unit), dateOnlyCell(b.expiryDate), b.valueIqd, tr('ws.manager.stock.expiry.stateExpiring')]),
    ];
    // The day it was taken, so two exports a week apart are not the same file.
    downloadCsv(`expiry-${dayCell(new Date().toISOString())}.csv`, toCsv(headers, rows));
  }

  /** "today" / "tomorrow" / "in 3 days" — relative words read faster than a date. */
  const whenLeft = (days: number) =>
    days <= 0 ? tr('ws.manager.stock.expiry.today') : days === 1 ? tr('ws.manager.stock.expiry.tomorrow') : tr('ws.manager.stock.expiry.inDays', { days: fmt.num(days) });
  const whenGone = (days: number) =>
    days <= 1 ? tr('ws.manager.stock.expiry.yesterday') : tr('ws.manager.stock.expiry.daysAgo', { days: fmt.num(days) });

  const base: Column<SummaryBatch>[] = [
    { key: 'ingredient', header: tr('op.stock.ingredient'), render: (b) => <bdi style={{ fontWeight: 600 }}>{nameOf(b)}</bdi> },
    { key: 'left', header: tr('ws.manager.stock.expiry.remaining'), numeric: true, render: (b) => <bdi>{fmt.qty(b.qtyRemaining, b.unit)}</bdi> },
    { key: 'worth', header: tr('ws.manager.stock.expiry.worth'), numeric: true, render: (b) => <Money amount={b.valueIqd} /> },
  ];

  const expiredColumns: Column<SummaryBatch>[] = [
    ...base,
    {
      key: 'expiry',
      header: tr('ws.manager.stock.expiry.expiredOn'),
      render: (b) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi>{dateOf(b)}</bdi>
          <StatusBadge size="sm" tone="danger" label={whenGone(b.daysExpired ?? 0)} />
        </span>
      ),
    },
    {
      key: 'writeOff',
      header: '',
      align: 'end',
      render: (b) => (
        <Button kind="danger" size="sm" icon="ban" disabled={busy || !can.adjustStock} onClick={() => setWriteOff(b)}>
          {tr('ws.manager.stock.expiry.writeOff')}
        </Button>
      ),
    },
  ];

  const expiringColumns: Column<SummaryBatch>[] = [
    ...base,
    {
      key: 'expiry',
      header: tr('ws.manager.stock.expiry.expiresOn'),
      render: (b) => (
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1-5)', alignItems: 'center', flexWrap: 'wrap' }}>
          <bdi>{dateOf(b)}</bdi>
          <StatusBadge size="sm" tone="warn" label={whenLeft(b.daysLeft ?? 0)} />
        </span>
      ),
    },
  ];

  const status = asyncStatus(summaryQ, () => false);

  return (
    <div>
      <PageHeader
        title={tr('op.stockNav.expiry')}
        subtitle={
          windowQ.data != null
            ? tr('ws.manager.stock.expiry.lead', { days: fmt.num(windowQ.data) })
            : tr('ws.manager.stock.expiry.leadNoWindow')
        }
        actions={<ExportButton onExport={exportCsv} disabled={expired.length + expiring.length === 0} />}
      />

      <AsyncStateWrapper
        status={status}
        error={summaryQ.error}
        onRetry={() => void summaryQ.refetch()}
        skeleton={<TableSkeleton columns={expiredColumns} rows={4} />}
      >
        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <Panel
            title={<CardTitle icon="ban">{tr('ws.manager.stock.expiry.expiredTitle')}</CardTitle>}
            padded={false}
          >
            {expired.length === 0 ? (
              <div style={{ padding: 'var(--tp-sp-3)' }}>
                <EmptyState compact kind="nothingToDo" icon="checkCircle" title={tr('ws.manager.stock.expiry.noneExpired')} />
              </div>
            ) : (
              <>
                <p style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {can.adjustStock ? tr('ws.manager.stock.expiry.expiredHint') : tr('ws.manager.stock.expiry.writeOffNotAllowed')}
                </p>
                <DataTable columns={expiredColumns} rows={expired} rowKey={(b) => b.batchId} aria-label={tr('ws.manager.stock.expiry.expiredTitle')} />
              </>
            )}
          </Panel>

          <Panel title={<CardTitle icon="hourglass">{tr('ws.manager.stock.expiry.expiringTitle')}</CardTitle>} padded={false}>
            {expiring.length === 0 ? (
              <div style={{ padding: 'var(--tp-sp-3)' }}>
                <EmptyState compact kind="nothingToDo" icon="checkCircle" title={tr('ws.manager.stock.expiry.noneExpiring')} />
              </div>
            ) : (
              <>
                <p style={{ paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                  {tr('ws.manager.stock.expiry.expiringHint')}
                </p>
                <DataTable columns={expiringColumns} rows={expiring} rowKey={(b) => b.batchId} aria-label={tr('ws.manager.stock.expiry.expiringTitle')} />
              </>
            )}
          </Panel>
        </div>
      </AsyncStateWrapper>

      {writeOff && (
        <PinReasonModal
          title={tr('ws.manager.stock.expiry.writeOffTitle', { name: nameOf(writeOff) })}
          reasons={['expired']}
          busy={busy}
          error={error}
          onSubmit={(pin, reason) => void submitWriteOff(pin, reason)}
          onClose={() => {
            setWriteOff(null);
            setError(null);
          }}
        >
          <p style={{ fontSize: 'var(--tp-fs-sm)', marginBlockEnd: 'var(--tp-sp-2-5)' }}>
            <bdi>{tr('ws.manager.stock.expiry.writeOffBody', { qty: fmt.qty(writeOff.qtyRemaining, writeOff.unit), date: dateOf(writeOff) })}</bdi>
          </p>
        </PinReasonModal>
      )}
    </div>
  );
}

/** Route alias for the spec name. */
export const ExpiryScreen = Expiry;
