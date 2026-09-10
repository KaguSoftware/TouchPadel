/**
 * Trading tab (spec 06.49): trading currency (set at setup; one currency,
 * explicitly no dual-currency field), tax rate per item group, and the
 * booking-policy windows. Everything here is read from `venue_settings` and
 * `tax_groups`; no RPC writes any of it yet, and the screen says so instead
 * of pretending a control exists.
 */
import { useQuery } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { useLocale, pickName } from '../../../lib/i18n';
import { Skeleton } from '../../../components/ui';
import { AsyncStateWrapper, DataTable, DescriptionList, EmptyState, MessagePresenter, Panel, StatusBadge, TableSkeleton, asyncStatus, type Column } from '../../../components/kit';
import { TAX_GROUPS_KEY, VENUE_ADMIN_KEY, bpToPercent, fetchTaxGroups, fetchVenueAdmin, type TaxGroupRow } from './venueQueries';

export function TradingTab() {
  const { tr, locale } = useLocale();
  const venueQ = useQuery({ queryKey: VENUE_ADMIN_KEY, queryFn: fetchVenueAdmin, staleTime: 60_000 });
  const taxQ = useQuery({ queryKey: TAX_GROUPS_KEY, queryFn: fetchTaxGroups, staleTime: 60_000 });

  const taxColumns: Column<TaxGroupRow>[] = [
    { key: 'name', header: tr('ws.owner.settings.trading.taxGroup'), render: (g) => <bdi>{pickName(locale, g)}</bdi> },
    { key: 'rate', header: tr('ws.owner.settings.trading.taxRate'), numeric: true, render: (g) => `${formatNumber(bpToPercent(g.rate_bp), locale)}%` },
    {
      key: 'status',
      header: tr('ws.owner.staff.columns.status'),
      render: (g) => (g.is_active ? <StatusBadge tone="success" size="sm" label={tr('ws.kit.common.on')} /> : <StatusBadge tone="neutral" size="sm" label={tr('ws.owner.settings.trading.taxInactive')} />),
    },
  ];

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', maxInlineSize: 'var(--tp-measure-wide)' }}>
      <AsyncStateWrapper status={asyncStatus(venueQ, () => false)} error={venueQ.error} onRetry={() => void venueQ.refetch()} skeleton={<Skeleton lines={6} />}>
        {venueQ.data && (
          <>
            <Panel title={tr('ws.owner.settings.trading.currency')} actions={<StatusBadge tone="neutral" size="sm" label={tr('ws.kit.common.readOnly')} />}>
              <p style={{ fontSize: 'var(--tp-fs-2xl)', fontWeight: 700 }} dir="ltr">
                {venueQ.data.currency}
              </p>
              <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.settings.trading.currencyHint')}</p>
              <DescriptionList
                style={{ marginBlockStart: 'var(--tp-sp-2-5)' }}
                items={[{ label: tr('ws.owner.settings.trading.taxInclusive'), value: venueQ.data.tax_inclusive ? tr('ws.kit.common.on') : tr('ws.kit.common.off') }]}
              />
            </Panel>

            <Panel title={tr('ws.owner.settings.trading.policyTitle')} actions={<StatusBadge tone="neutral" size="sm" label={tr('ws.kit.common.readOnly')} />}>
              <DescriptionList
                columns={2}
                items={[
                  { label: tr('ws.owner.settings.trading.cancellationWindow'), value: <Hinted value={tr('ws.owner.settings.trading.hours', { count: formatNumber(venueQ.data.cancellation_window_hours, locale) })} hint={tr('ws.owner.settings.trading.cancellationWindowHint')} /> },
                  { label: tr('ws.owner.settings.trading.holdTtl'), value: <Hinted value={tr('ws.owner.settings.trading.seconds', { count: formatNumber(venueQ.data.hold_ttl_seconds, locale) })} hint={tr('ws.owner.settings.trading.holdTtlHint')} /> },
                  { label: tr('ws.owner.settings.trading.protectedHorizon'), value: <Hinted value={tr('ws.owner.settings.trading.hours', { count: formatNumber(venueQ.data.protected_horizon_hours, locale) })} hint={tr('ws.owner.settings.trading.protectedHorizonHint')} /> },
                  { label: tr('ws.owner.settings.trading.bookingHorizon'), value: <Hinted value={tr('ws.owner.settings.trading.days', { count: formatNumber(venueQ.data.max_booking_horizon_days, locale) })} hint={tr('ws.owner.settings.trading.bookingHorizonHint')} /> },
                  { label: tr('ws.owner.settings.trading.maxHolds'), value: <Hinted value={formatNumber(venueQ.data.max_live_holds_per_guest, locale)} hint={tr('ws.owner.settings.trading.maxHoldsHint')} /> },
                  { label: tr('ws.owner.settings.trading.noShow'), value: <span style={{ fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.settings.trading.noShowBody')}</span> },
                ]}
              />
              <MessagePresenter tone="info" message={tr('ws.owner.settings.trading.readOnlyNote')} style={{ marginBlockStart: 'var(--tp-sp-3)' }} />
            </Panel>
          </>
        )}
      </AsyncStateWrapper>

      <Panel title={tr('ws.owner.settings.trading.taxTitle')} padded={false} actions={<StatusBadge tone="neutral" size="sm" label={tr('ws.kit.common.readOnly')} />}>
        <div style={{ paddingBlock: 'var(--tp-sp-3)', paddingInline: 'var(--tp-sp-3)', display: 'grid', gap: 'var(--tp-sp-2-5)' }}>
          <AsyncStateWrapper
            status={asyncStatus(taxQ, (rows) => rows.length === 0)}
            error={taxQ.error}
            onRetry={() => void taxQ.refetch()}
            compact
            skeleton={<TableSkeleton columns={taxColumns} rows={3} />}
            emptyContent={<EmptyState compact icon="tag" title={tr('ws.owner.settings.trading.taxNone')} />}
          >
            <DataTable columns={taxColumns} rows={taxQ.data ?? []} rowKey={(g) => g.id} aria-label={tr('ws.owner.settings.trading.taxTitle')} />
          </AsyncStateWrapper>
          <MessagePresenter tone="info" message={tr('ws.owner.settings.trading.taxReadOnly')} />
        </div>
      </Panel>
    </div>
  );
}

function Hinted({ value, hint }: { value: string; hint: string }) {
  return (
    <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
      <span dir="ltr" style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums', textAlign: 'start' }}>
        {value}
      </span>
      <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{hint}</span>
    </span>
  );
}
