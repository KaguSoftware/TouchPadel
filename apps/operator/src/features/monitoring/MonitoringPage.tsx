/**
 * Monitoring (/monitoring, 0393; Majed 2026-11-01, F-15/F-26): the developer's
 * view of what went wrong anywhere in the system. The dev role's page; the
 * owner may open it too (ROUTE_ROLES).
 *
 * Top: the filters (period, app, level, kind, "reported by a person"), then
 * the period's totals and a bar per hour (24 hours) or per day (longer), and
 * the most frequent kinds. Below: the events, newest first, 50 at a time; a
 * row opens its detail in a dialog. Everything refreshes every minute
 * (REFRESH_MS) and on demand.
 */
import { useState, type CSSProperties } from 'react';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, formatTime } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { Button, Modal, Select, Skeleton } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, PageHeader, Panel, SegmentedControl, StatusBadge, type Column } from '../../components/kit';
import { MK, fetchEvents, fetchSummary } from './api';
import {
  DEFAULT_FILTERS,
  LEVELS,
  PERIODS,
  REFRESH_MS,
  SOURCES,
  barShare,
  detailEntries,
  fillBuckets,
  levelTone,
  type Filters,
  type MonitorEvent,
  type Summary,
} from './monitoringLogic';

const muted: CSSProperties = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' };

export function MonitoringPageScreen() {
  const { tr, locale } = useLocale();
  const qc = useQueryClient();
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [open, setOpen] = useState<MonitorEvent | null>(null);
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((f) => ({ ...f, [key]: value }));

  const summary = useQuery({
    queryKey: MK.summary(filters),
    queryFn: () => fetchSummary(filters),
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const events = useInfiniteQuery({
    queryKey: MK.events(filters),
    queryFn: ({ pageParam }) => fetchEvents(filters, pageParam),
    initialPageParam: null as number | null,
    getNextPageParam: (last) => last.nextBeforeId,
    refetchInterval: REFRESH_MS,
    placeholderData: keepPreviousData,
  });
  const rows = events.data?.pages.flatMap((p) => p.rows) ?? [];
  const filtered =
    filters.source !== 'all' || filters.level !== 'all' || filters.kind !== 'all' || filters.userReported;
  const updatedAt = Math.max(summary.dataUpdatedAt, events.dataUpdatedAt);

  const columns: Column<MonitorEvent>[] = [
    {
      key: 'at',
      header: tr('ws.monitoring.list.when'),
      width: '11rem',
      render: (e) => formatDateTime(new Date(e.at), locale),
      truncateTitle: (e) => e.at,
    },
    { key: 'source', header: tr('ws.monitoring.list.source'), width: '9rem', render: (e) => tr(`ws.monitoring.sources.${e.source}`) },
    {
      key: 'level',
      header: tr('ws.monitoring.list.level'),
      width: '7rem',
      render: (e) => <StatusBadge size="sm" tone={levelTone(e.level)} label={tr(`ws.monitoring.levels.${e.level}`)} />,
    },
    { key: 'kind', header: tr('ws.monitoring.list.kind'), width: '9rem', render: (e) => <code dir="ltr">{e.kind}</code> },
    {
      key: 'message',
      header: tr('ws.monitoring.list.message'),
      truncate: true,
      truncateTitle: (e) => e.message,
      render: (e) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
          {e.userReported && <StatusBadge size="sm" tone="accent" icon="user" label={tr('ws.monitoring.list.userReported')} />}
          <span dir="auto" style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.message}</span>
        </span>
      ),
    },
  ];

  return (
    <div style={{ maxInlineSize: '96rem', display: 'grid', gap: 'var(--tp-sp-5)' }}>
      <PageHeader
        title={tr('ws.monitoring.title')}
        subtitle={tr('ws.monitoring.lead')}
        actions={
          <Button icon="refresh" data-testid="monitoring-refresh" onClick={() => void qc.invalidateQueries({ queryKey: MK.all })}>
            {tr('ws.monitoring.refresh')}
          </Button>
        }
      />

      <FiltersBar filters={filters} set={set} kinds={summary.data?.kinds.map((k) => k.kind) ?? []} />

      <p style={{ ...muted, margin: 0 }} role="status">
        {updatedAt > 0 && tr('ws.monitoring.updated', { time: formatTime(new Date(updatedAt), locale) })}
        {' · '}
        {summary.data?.cronCheckedAt
          ? tr('ws.monitoring.cronChecked', { time: formatDateTime(new Date(summary.data.cronCheckedAt), locale) })
          : tr('ws.monitoring.cronNever')}
      </p>

      <AsyncStateWrapper
        status={summary.isError && !summary.data ? 'error' : summary.data ? 'ready' : 'loading'}
        error={summary.error}
        onRetry={() => void summary.refetch()}
        skeleton={<Skeleton lines={3} blockSize="4rem" />}
      >
        {summary.data && <SummaryPanels summary={summary.data} filters={filters} onKind={(k) => set('kind', k)} />}
      </AsyncStateWrapper>

      <Panel title={tr('ws.monitoring.list.title')} data-testid="monitoring-events">
        <AsyncStateWrapper
          status={events.isError && !events.data ? 'error' : !events.data ? 'loading' : rows.length === 0 ? 'empty' : 'ready'}
          error={events.error}
          onRetry={() => void events.refetch()}
          skeleton={<Skeleton lines={6} blockSize="2.5rem" />}
          emptyContent={
            filtered ? (
              <EmptyState icon="search" title={tr('ws.monitoring.list.filteredTitle')} body={tr('ws.monitoring.list.filteredBody')} />
            ) : (
              <EmptyState icon="checkCircle" title={tr('ws.monitoring.list.emptyTitle')} body={tr('ws.monitoring.list.emptyBody')} />
            )
          }
        >
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(e) => String(e.id)}
            onRowClick={setOpen}
            selectedKey={open ? String(open.id) : null}
            dense
            aria-label={tr('ws.monitoring.list.title')}
          />
          {events.hasNextPage && (
            <div style={{ display: 'grid', justifyItems: 'center', paddingBlockStart: 'var(--tp-sp-3)' }}>
              <Button
                icon="chevronDown"
                busy={events.isFetchingNextPage}
                data-testid="monitoring-older"
                onClick={() => void events.fetchNextPage()}
              >
                {tr('ws.monitoring.list.older')}
              </Button>
            </div>
          )}
        </AsyncStateWrapper>
      </Panel>

      {open && <EventDetail event={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function FiltersBar({
  filters,
  set,
  kinds,
}: {
  filters: Filters;
  set: <K extends keyof Filters>(key: K, value: Filters[K]) => void;
  kinds: readonly string[];
}) {
  const { tr } = useLocale();
  const kindOptions = [...new Set([...kinds, ...(filters.kind === 'all' ? [] : [filters.kind])])];
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-3)' }}>
      <SegmentedControl
        aria-label={tr('ws.monitoring.filters.period')}
        value={filters.period}
        onChange={(v) => set('period', v)}
        options={PERIODS.map((p) => ({ value: p, label: tr(`ws.monitoring.periods.${p}`), testId: `monitoring-period-${p}` }))}
      />
      <Select
        aria-label={tr('ws.monitoring.filters.source')}
        value={filters.source}
        onChange={(v) => set('source', v)}
        options={[
          { value: 'all' as const, label: tr('ws.monitoring.filters.allSources') },
          ...SOURCES.map((s) => ({ value: s, label: tr(`ws.monitoring.sources.${s}`) })),
        ]}
        style={{ inlineSize: '12rem' }}
      />
      <Select
        aria-label={tr('ws.monitoring.filters.level')}
        value={filters.level}
        onChange={(v) => set('level', v)}
        options={[
          { value: 'all' as const, label: tr('ws.monitoring.filters.allLevels') },
          ...LEVELS.map((l) => ({ value: l, label: tr(`ws.monitoring.levels.${l}`) })),
        ]}
        style={{ inlineSize: '10rem' }}
      />
      <Select
        aria-label={tr('ws.monitoring.filters.kind')}
        value={filters.kind}
        onChange={(v) => set('kind', v)}
        options={[{ value: 'all', label: tr('ws.monitoring.filters.allKinds') }, ...kindOptions.map((k) => ({ value: k, label: k }))]}
        style={{ inlineSize: '12rem' }}
      />
      <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', cursor: 'pointer' }}>
        <input
          type="checkbox"
          data-testid="monitoring-user-reported"
          checked={filters.userReported}
          onChange={(e) => set('userReported', e.target.checked)}
        />
        {tr('ws.monitoring.filters.userReported')}
      </label>
    </div>
  );
}

function SummaryPanels({ summary, filters, onKind }: { summary: Summary; filters: Filters; onKind: (kind: string) => void }) {
  const { tr, locale } = useLocale();
  const buckets = fillBuckets(summary.counts, filters.period, new Date());
  const max = Math.max(0, ...buckets.map((b) => b.total));
  const totals: { key: 'total' | 'error' | 'warn' | 'userReported'; value: number }[] = [
    { key: 'total', value: summary.totals.total },
    { key: 'error', value: summary.totals.error },
    { key: 'warn', value: summary.totals.warn },
    { key: 'userReported', value: summary.totals.userReported },
  ];
  const whenOf = (iso: string) =>
    summary.bucket === 'hour' ? formatTime(new Date(iso), locale) : formatDateTime(new Date(iso), locale).split(locale === 'ar' ? '،' : ',')[0]!;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(10rem, 1fr))', gap: 'var(--tp-sp-3)' }}>
        {totals.map((t) => (
          <Panel key={t.key} data-testid={`monitoring-total-${t.key}`}>
            <div style={muted}>{tr(`ws.monitoring.totals.${t.key}`)}</div>
            <div style={{ fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
              {formatNumber(t.value, locale)}
            </div>
          </Panel>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 'var(--tp-sp-4)' }}>
        <Panel title={tr(summary.bucket === 'hour' ? 'ws.monitoring.chart.titleHour' : 'ws.monitoring.chart.titleDay')}>
          {max === 0 ? (
            <p style={{ ...muted, margin: 0 }}>{tr('ws.monitoring.chart.empty')}</p>
          ) : (
            <div
              role="list"
              data-testid="monitoring-chart"
              style={{ display: 'flex', alignItems: 'flex-end', gap: '2px', blockSize: '8rem' }}
            >
              {buckets.map((b) => {
                const label = tr('ws.monitoring.chart.bar', { when: whenOf(b.bucket), count: formatNumber(b.total, locale) });
                return (
                  <div
                    key={b.bucket}
                    role="listitem"
                    aria-label={label}
                    title={label}
                    style={{
                      flex: '1 1 0',
                      minInlineSize: 0,
                      blockSize: `${barShare(b.total, max) * 100}%`,
                      background: b.error > 0 ? 'var(--tp-danger-mark)' : b.warn > 0 ? 'var(--tp-warn-mark)' : 'var(--tp-accent)',
                      borderRadius: 'var(--tp-radius-sm)',
                      opacity: b.total === 0 ? 0 : 1,
                    }}
                  />
                );
              })}
            </div>
          )}
        </Panel>
        <Panel title={tr('ws.monitoring.kinds.title')}>
          {summary.kinds.length === 0 ? (
            <p style={{ ...muted, margin: 0 }}>{tr('ws.monitoring.chart.empty')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
              {summary.kinds.slice(0, 8).map((k) => (
                <li key={k.kind}>
                  <Button
                    kind="ghost"
                    size="sm"
                    data-testid={`monitoring-kind-${k.kind}`}
                    onClick={() => onKind(k.kind)}
                    style={{ inlineSize: '100%', justifyContent: 'space-between' }}
                  >
                    <code dir="ltr">{k.kind}</code>
                    <span style={muted}>{tr('ws.monitoring.kinds.count', { count: formatNumber(k.count, locale) })}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

function EventDetail({ event, onClose }: { event: MonitorEvent; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const none = tr('ws.monitoring.detail.none');
  const facts: { label: string; value: string }[] = [
    { label: tr('ws.monitoring.detail.when'), value: formatDateTime(new Date(event.at), locale) },
    { label: tr('ws.monitoring.detail.source'), value: tr(`ws.monitoring.sources.${event.source}`) },
    { label: tr('ws.monitoring.detail.level'), value: tr(`ws.monitoring.levels.${event.level}`) },
    { label: tr('ws.monitoring.detail.kind'), value: event.kind },
    { label: tr('ws.monitoring.detail.version'), value: event.appVersion ?? none },
    { label: tr('ws.monitoring.detail.branch'), value: event.venueName ?? none },
    { label: tr('ws.monitoring.detail.staff'), value: event.staffName ?? none },
    {
      label: tr('ws.monitoring.detail.account'),
      value: tr(event.signedIn ? 'ws.monitoring.detail.accountYes' : 'ws.monitoring.detail.accountNo'),
    },
  ];
  const entries = detailEntries(event.detail);
  const pre: CSSProperties = {
    margin: 0,
    whiteSpace: 'pre-wrap',
    wordBreak: 'break-word',
    fontSize: 'var(--tp-fs-xs)',
    background: 'var(--tp-surface-3)',
    borderRadius: 'var(--tp-radius-ctl)',
    padding: 'var(--tp-sp-2)',
    textAlign: 'start',
  };
  return (
    <Modal
      title={tr('ws.monitoring.detail.title', { id: String(event.id) })}
      onClose={onClose}
      wide
      footer={<Button onClick={onClose}>{tr('ws.monitoring.detail.close')}</Button>}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }} data-testid="monitoring-detail">
        {event.userReported && <StatusBadge tone="accent" icon="user" label={tr('ws.monitoring.list.userReported')} />}
        <dl style={{ display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: 'var(--tp-sp-1-5) var(--tp-sp-4)', margin: 0 }}>
          {facts.map((f) => (
            <div key={f.label} style={{ display: 'contents' }}>
              <dt style={muted}>{f.label}</dt>
              <dd style={{ margin: 0 }} dir="auto">{f.value}</dd>
            </div>
          ))}
        </dl>
        <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-md)' }}>{tr('ws.monitoring.detail.message')}</h3>
          <p style={{ margin: 0 }} dir="auto">{event.message}</p>
        </section>
        <section style={{ display: 'grid', gap: 'var(--tp-sp-1-5)' }}>
          <h3 style={{ margin: 0, fontSize: 'var(--tp-fs-md)' }}>{tr('ws.monitoring.detail.details')}</h3>
          {entries.length === 0 ? (
            <p style={{ ...muted, margin: 0 }}>{tr('ws.monitoring.detail.noDetails')}</p>
          ) : (
            entries.map((e) => (
              <div key={e.key} style={{ display: 'grid', gap: 'var(--tp-sp-1)' }}>
                <code dir="ltr" style={muted}>{e.key}</code>
                <pre dir="ltr" style={pre}>{e.value}</pre>
              </div>
            ))
          )}
        </section>
      </div>
    </Modal>
  );
}
