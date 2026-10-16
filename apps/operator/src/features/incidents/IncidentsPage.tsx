/**
 * Incidents (/incidents): court desk, cashier, manager and owner
 * (wave5-addendum-2026-09-25 §2.6, §5.2; Majed's answer #6).
 *
 * Two pages behind one route, because the two jobs are different:
 *
 *  - **At the desk and the till** the page is the person's own reports: what
 *    they sent, waiting or reviewed, with the manager's note as a reply. The
 *    blue "Report an incident" opens the form in a dialog, so a report goes in
 *    minutes after something happened without leaving the page.
 *  - **For management** the job is the queue: Open (oldest first), Reviewed
 *    and All from app.incidents_page, each report opening a sheet with its
 *    photos and the review. "Report an incident" opens the same dialog, since
 *    managers report too.
 *
 * Which page a person gets is the capability matrix's call (reviewIncidents),
 * never a role compared here. A report is kept a year and never reaches the
 * owner assistant; a redacted one reads "Removed by the owner", never the
 * stored marker.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatDayNumber, formatMonthShort, formatNumber, formatTime, formatWeekdayShort, isolate } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { can, useAuth } from '../../lib/auth';
import { QK } from '../../lib/queryKeys';
import { useLocale } from '../../lib/i18n';
import { Button, ErrorText, Skeleton } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  PageHeader,
  Pagination,
  Panel,
  SegmentedControl,
  StatusBadge,
  TableSkeleton,
  ViewMore,
  useListCap,
  type Column,
} from '../../components/kit';
import { ChevronForward, Icon } from '../../components/icons';
import { IK, fetchIncidentsOpen, fetchMyIncidents } from './api';
import { IncidentSheet } from './IncidentSheet';
import { MyIncidentModal } from './MyIncidentModal';
import { ReportIncidentDialog } from './ReportIncidentForm';
import {
  INCIDENTS_PAGE_SIZE,
  INCIDENT_FILTERS,
  BESIDE_ICON,
  KIND_LOOK,
  MINE_FILTERS,
  filterMine,
  incidentTone,
  placeText,
  readIncidentsPage,
  readMyIncidents,
  type IncidentFilter,
  type IncidentRow,
} from './incidentsLogic';

const muted = { color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' } as const;

export function IncidentsPageScreen() {
  const { staff } = useAuth();
  return can(staff, 'reviewIncidents') ? <ReviewQueue /> : <ReportDesk />;
}

/** The desk's and the till's page: their own reports, and the form in a dialog. */
function ReportDesk() {
  const { tr } = useLocale();
  const [reporting, setReporting] = useState(false);
  return (
    <div style={{ maxInlineSize: '84rem' }}>
      <PageHeader
        title={tr('ws.incidents.mine.title')}
        subtitle={tr('ws.incidents.mine.lead')}
        actions={
          <Button kind="primary" size="lg" icon="plus" onClick={() => setReporting(true)} data-testid="incidents.report.open">
            {tr('ws.incidents.form.title')}
          </Button>
        }
      />
      <MyReports />
      {reporting && <ReportIncidentDialog onClose={() => setReporting(false)} />}
    </div>
  );
}

/** "My reports": the reporter's own as cards, with the review note once there is one (app.my_incidents); a card opens the report in MyIncidentModal. */
function MyReports() {
  const { tr, locale } = useLocale();
  const q = useQuery({ queryKey: IK.mine, queryFn: fetchMyIncidents, refetchInterval: 60_000 });
  const all = readMyIncidents(q.data);
  const [filter, setFilter] = useState<IncidentFilter>('all');
  const rows = filterMine(all, filter);
  const cap = useListCap(rows);
  const [openId, setOpenId] = useState<string | null>(null);
  const opened = openId ? (all.find((r) => r.id === openId) ?? null) : null;
  const counts = { all: all.length, open: filterMine(all, 'open').length, reviewed: filterMine(all, 'reviewed').length };

  if (q.isError) {
    return (
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
        <ErrorText error={q.error} style={{ marginBlock: 0 }} />
        <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
          {tr('common.retry')}
        </Button>
      </div>
    );
  }
  if (q.isPending) return <Skeleton lines={4} />;
  if (all.length === 0) {
    return (
      <Panel data-testid="incidents.mine">
        <EmptyState kind="initial" icon="fileText" title={tr('ws.incidents.mine.emptyTitle')} body={tr('ws.incidents.mine.empty')} />
      </Panel>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }} data-testid="incidents.mine">
      <div>
        <SegmentedControl<IncidentFilter>
          aria-label={tr('ws.incidents.filterLabel')}
          value={filter}
          onChange={setFilter}
          options={MINE_FILTERS.map((f) => ({ value: f, label: `${tr(`ws.incidents.filter.${f}`)} · ${formatNumber(counts[f], locale)}` }))}
        />
      </div>
      {rows.length === 0 ? (
        <p style={muted}>{tr(`ws.incidents.empty.${filter}`)}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(20rem, 1fr))', gridAutoRows: '1fr', gap: 'var(--tp-sp-3)' }}>
          {cap.shown.map((r) => {
            const look = KIND_LOOK[r.kind];
            const at = r.occurredAt ? new Date(r.occurredAt) : null;
            return (
              // Every row is as tall as the tallest card (gridAutoRows 1fr), and every card fills its cell.
              <li key={r.id} style={{ display: 'grid', minInlineSize: 0 }}>
                {/* The whole card is one button: it opens the report in the sheet. */}
                <button
                  type="button"
                  className="tp-incident-card"
                  onClick={() => setOpenId(r.id)}
                  data-testid={`incidents.mine.${r.id}`}
                  style={{
                    display: 'grid',
                    gridTemplateRows: 'auto 1fr auto',
                    inlineSize: '100%',
                    padding: 0,
                    font: 'inherit',
                    color: 'inherit',
                    textAlign: 'start',
                    cursor: 'pointer',
                    borderRadius: 'var(--tp-radius-panel)',
                    border: '1px solid var(--tp-border)',
                    // The kind's tint runs down from the band and fades into the panel.
                    background: `linear-gradient(180deg, color-mix(in oklch, ${look.soft} 55%, var(--tp-surface)) 0%, var(--tp-surface) 70%)`,
                    boxShadow: 'var(--tp-shadow-raised)',
                    overflow: 'hidden',
                    minInlineSize: 0,
                  }}
                >
                  {/* The band: the kind; its icon repeats large and faint behind. */}
                  <span
                    style={{
                      position: 'relative',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 'var(--tp-sp-3)',
                      padding: 'var(--tp-sp-4)',
                      background: `linear-gradient(120deg, ${look.soft} 30%, color-mix(in oklch, ${look.soft} 78%, ${look.fg}))`,
                      color: look.fg,
                      overflow: 'hidden',
                    }}
                  >
                    <Icon name={look.icon} size={120} style={{ position: 'absolute', insetInlineEnd: '-1rem', insetBlockEnd: 0, transform: 'translateY(30%)', opacity: 0.1, pointerEvents: 'none' }} />
                    <span style={{ display: 'grid', placeItems: 'center', inlineSize: '2.75rem', blockSize: '2.75rem', flex: 'none', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-surface)', boxShadow: 'var(--tp-shadow-raised)' }}>
                      <Icon name={look.icon} size={22} />
                    </span>
                    <span style={{ ...BESIDE_ICON, display: 'grid', gap: 'var(--tp-sp-0)', flex: 1, minInlineSize: 0 }}>
                      <strong style={{ fontSize: 'var(--tp-fs-lg)' }}>{tr(`work.incident.kind.${r.kind}`)}</strong>
                    </span>
                  </span>
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 'var(--tp-sp-3)', padding: 'var(--tp-sp-4)', minInlineSize: 0 }}>
                    {/* What happened is read in the sheet; the card is the kind, place, time and where the review stands. */}
                    {/* The time and the place on one line; "where exactly" and the photos are in the dialog. */}
                    <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 'var(--tp-sp-2)' }}>
                      {at && (
                        <span title={tr('ws.incidents.happenedAt', { time: formatDateTime(at, locale) })} style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', fontVariantNumeric: 'tabular-nums' }}>
                          <span style={{ display: 'grid', placeItems: 'center', inlineSize: '2rem', blockSize: '2rem', flex: 'none', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)', color: 'var(--tp-muted-fg)' }}>
                            <Icon name="clock" size={16} />
                          </span>
                          <span style={{ ...BESIDE_ICON, display: 'grid' }}>
                            <span style={{ fontWeight: 700 }}>{formatTime(at, locale)}</span>
                            <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', fontWeight: 600 }}>
                              {formatWeekdayShort(at, locale)} {formatDayNumber(at, locale)} {formatMonthShort(at, locale)}
                            </span>
                          </span>
                        </span>
                      )}
                      {/* The place, built like the time: an icon square and the place, set in from the edge. */}
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-2)', marginInlineEnd: 'var(--tp-sp-4)', minInlineSize: 0 }}>
                        <span style={{ display: 'grid', placeItems: 'center', inlineSize: '2rem', blockSize: '2rem', flex: 'none', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)', color: 'var(--tp-muted-fg)' }}>
                          <Icon name="pin" size={16} />
                        </span>
                        <span style={{ ...BESIDE_ICON, display: 'grid', minInlineSize: 0 }}>
                          <bdi style={{ fontWeight: 700, overflowWrap: 'anywhere' }}>{placeText({ ...r, placeDetail: null }, locale, (p) => tr(`work.incident.place.${p}`))}</bdi>
                        </span>
                      </span>
                    </span>
                    {r.status === 'reviewed' ? (
                      // Who reviewed it; the time and the note are read in the sheet.
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', marginBlockStart: 'auto', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-panel)', background: 'var(--tp-success-soft)', color: 'var(--tp-success-fg)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
                        <Icon name="checkCircle" size={15} style={{ flex: 'none' }} />
                        <span style={BESIDE_ICON}>{tr('ws.incidents.mine.reviewedBy', { name: isolate(r.reviewedByName ?? '—') })}</span>
                      </span>
                    ) : (
                      <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', marginBlockStart: 'auto', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-panel)', border: '1px dashed var(--tp-warn-mark)', background: 'var(--tp-warn-soft)', color: 'var(--tp-warn-fg)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
                        <Icon name="hourglass" size={15} style={{ flex: 'none' }} />
                        <span style={BESIDE_ICON}>{tr('ws.incidents.mine.waiting')}</span>
                      </span>
                    )}
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', paddingBlock: 'var(--tp-sp-2-5)', paddingInline: 'var(--tp-sp-4)', borderBlockStart: '1px solid var(--tp-border)', color: 'var(--tp-accent-soft-fg)', fontSize: 'var(--tp-fs-sm)', fontWeight: 600 }}>
                    <span style={BESIDE_ICON}>{tr('ws.incidents.mine.details')}</span>
                    <ChevronForward size={16} style={{ flex: 'none' }} />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
      {opened && <MyIncidentModal row={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}

/** Management's page: the review queue, and the form on demand. */
function ReviewQueue() {
  const { tr, locale } = useLocale();
  const { staff } = useAuth();
  const [filter, setFilter] = useState<IncidentFilter>('open');
  const [page, setPage] = useState(1);
  const [reporting, setReporting] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const offset = (page - 1) * INCIDENTS_PAGE_SIZE;
  const shared = filter === 'open' && offset === 0;

  const openQ = useQuery({ queryKey: QK.incidentsOpen, queryFn: fetchIncidentsOpen, refetchInterval: 60_000 });
  const ownQ = useQuery({
    queryKey: IK.page(filter, offset),
    queryFn: () => appRpc<unknown>('incidents_page', { p_filter: filter, p_limit: INCIDENTS_PAGE_SIZE, p_offset: offset }),
    enabled: !shared,
    refetchInterval: 60_000,
  });
  const q = shared ? openQ : ownQ;
  const data = readIncidentsPage(q.data);
  const openCount = readIncidentsPage(openQ.data).openCount;
  const opened = openId ? (data.rows.find((r) => r.id === openId) ?? null) : null;
  const pageCount = Math.ceil(data.total / INCIDENTS_PAGE_SIZE);

  const columns: Column<IncidentRow>[] = [
    {
      key: 'what',
      header: tr('ws.incidents.cols.what'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <strong>{tr(`work.incident.kind.${r.kind}`)}</strong>
          <bdi style={muted}>{placeText(r, locale, (p) => tr(`work.incident.place.${p}`))}</bdi>
        </span>
      ),
      truncateTitle: (r) => tr(`work.incident.kind.${r.kind}`),
    },
    {
      key: 'when',
      header: tr('ws.incidents.cols.when'),
      render: (r) => <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.occurredAt ? formatDateTime(new Date(r.occurredAt), locale) : '—'}</span>,
      truncateTitle: (r) => (r.occurredAt ? formatDateTime(new Date(r.occurredAt), locale) : ''),
    },
    {
      key: 'summary',
      header: tr('ws.incidents.cols.summary'),
      width: '24rem',
      render: (r) =>
        r.redacted ? (
          <span style={{ ...muted, fontStyle: 'italic' }}>{tr('ws.incidents.redactedText')}</span>
        ) : (
          <span dir="auto" style={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', overflowWrap: 'anywhere' }}>
            {r.description}
          </span>
        ),
      truncateTitle: (r) => (r.redacted ? '' : r.description),
    },
    {
      key: 'reported',
      header: tr('ws.incidents.cols.reportedBy'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)' }}>
          <bdi style={{ fontWeight: 600 }}>{r.reportedByName ?? '—'}</bdi>
          {r.reportedByRole && <span style={muted}>{tr(`op.roles.${r.reportedByRole}`)}</span>}
        </span>
      ),
      truncateTitle: (r) => r.reportedByName ?? '',
    },
    {
      key: 'photos',
      header: tr('ws.incidents.cols.photos'),
      numeric: true,
      render: (r) =>
        r.photos.length > 0 ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
            <Icon name="image" size={14} style={{ color: 'var(--tp-muted-fg)' }} />
            {formatNumber(r.photos.length, locale)}
          </span>
        ) : (
          <span style={muted}>—</span>
        ),
      truncateTitle: (r) => String(r.photos.length),
    },
    {
      key: 'status',
      header: tr('ws.incidents.cols.status'),
      render: (r) => (
        <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', justifyItems: 'start' }}>
          <StatusBadge size="sm" tone={incidentTone(r.status)} label={tr(`work.incident.status.${r.status}`)} />
          {r.status === 'reviewed' && r.reviewedByName && <bdi style={muted}>{r.reviewedByName}</bdi>}
          {r.redacted && <span style={muted}>{tr('ws.incidents.redactedShort')}</span>}
        </span>
      ),
      truncateTitle: (r) => tr(`work.incident.status.${r.status}`),
    },
    {
      key: 'open',
      header: '',
      align: 'end',
      render: (r) => (
        <Button size="sm" kind={r.status === 'open' && r.canReview ? 'primary' : 'default'} onClick={() => setOpenId(r.id)} data-testid={`incidents.open.${r.id}`}>
          {tr(r.status === 'open' && r.canReview ? 'ws.incidents.review' : 'ws.incidents.view')}
        </Button>
      ),
      truncateTitle: () => '',
    },
  ];

  return (
    <div style={{ maxInlineSize: '84rem' }}>
      <PageHeader
        title={tr('ws.incidents.title')}
        subtitle={tr('ws.incidents.leadReview')}
        actions={
          can(staff, 'reportIncidents') ? (
            <Button kind="primary" icon="plus" onClick={() => setReporting(true)} data-testid="incidents.report.open">
              {tr('ws.incidents.form.title')}
            </Button>
          ) : undefined
        }
      />
      {reporting && <ReportIncidentDialog onClose={() => setReporting(false)} />}
      <div style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
        <SegmentedControl<IncidentFilter>
          aria-label={tr('ws.incidents.filterLabel')}
          value={filter}
          onChange={(f) => {
            setFilter(f);
            setPage(1);
          }}
          options={INCIDENT_FILTERS.map((f) => ({
            value: f,
            label: f === 'open' && openCount > 0 ? tr('ws.incidents.filter.openCount', { count: formatNumber(openCount, locale) }) : tr(`ws.incidents.filter.${f}`),
          }))}
        />
      </div>
      <AsyncStateWrapper
        status={q.isError && q.data === undefined ? 'error' : q.data === undefined ? 'loading' : data.rows.length === 0 ? 'empty' : 'ready'}
        error={q.error}
        onRetry={() => void q.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={4} />}
        emptyContent={
          <EmptyState
            kind={filter === 'open' ? 'nothingToDo' : 'initial'}
            icon={filter === 'open' ? 'checkCircle' : 'alert'}
            title={tr(`ws.incidents.empty.${filter}`)}
            body={filter === 'open' ? tr('ws.incidents.empty.openBody') : undefined}
          />
        }
      >
        <DataTable columns={columns} rows={data.rows} rowKey={(r) => r.id} onRowClick={(r) => setOpenId(r.id)} aria-label={tr('ws.incidents.title')} />
        {pageCount > 1 && <Pagination page={page} pageCount={pageCount} onChange={setPage} />}
      </AsyncStateWrapper>
      {opened && <IncidentSheet row={opened} onClose={() => setOpenId(null)} />}
    </div>
  );
}
