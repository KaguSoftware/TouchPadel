/**
 * Incidents (/incidents): court desk, cashier, manager and owner
 * (wave5-addendum-2026-09-25 §2.6, §5.2; Majed's answer #6).
 *
 * Two pages behind one route, because the two jobs are different:
 *
 *  - **At the desk and the till** the job is to get a report in, minutes after
 *    something happened. The form IS the page, with the person's own reports
 *    beside it: what they sent, and the manager's note once it is reviewed.
 *  - **For management** the job is the queue: Open (oldest first), Reviewed
 *    and All from app.incidents_page, each report opening a sheet with its
 *    photos and the review. "Report an incident" opens the same form inline
 *    above the list, since managers report too.
 *
 * Which page a person gets is the capability matrix's call (reviewIncidents),
 * never a role compared here. A report is kept a year and never reaches the
 * owner assistant; a redacted one reads "Removed by the owner", never the
 * stored marker.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDateTime, formatNumber, isolate } from '@touch/i18n';
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
  type Column,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { CardTitle } from '../ops/OpsVisuals';
import { PhotoViewer, StaffPhotoThumb } from '../checklists/StaffPhoto';
import { IK, fetchIncidentsOpen, fetchMyIncidents } from './api';
import { IncidentSheet } from './IncidentSheet';
import { ReportIncidentForm } from './ReportIncidentForm';
import {
  INCIDENTS_PAGE_SIZE,
  INCIDENT_FILTERS,
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
  return can(staff?.role, 'reviewIncidents') ? <ReviewQueue /> : <ReportDesk />;
}

/** The desk's and the till's page: the form, and what this person reported. */
function ReportDesk() {
  const { tr } = useLocale();
  return (
    <div style={{ maxInlineSize: '84rem' }}>
      <PageHeader title={tr('ws.incidents.title')} subtitle={tr('ws.incidents.leadStation')} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-5)', alignItems: 'flex-start' }}>
        <Panel title={<CardTitle icon="alert">{tr('ws.incidents.form.title')}</CardTitle>} style={{ flex: '1 1 30rem', maxInlineSize: '42rem' }} data-testid="incidents.report">
          <ReportIncidentForm />
        </Panel>
        <MyReports />
      </div>
    </div>
  );
}

/** "My reports": the reporter's own, with the review note once there is one (app.my_incidents). */
function MyReports() {
  const { tr, locale } = useLocale();
  const q = useQuery({ queryKey: IK.mine, queryFn: fetchMyIncidents, refetchInterval: 60_000 });
  const rows = readMyIncidents(q.data);
  const [photos, setPhotos] = useState<readonly string[] | null>(null);

  return (
    <Panel title={<CardTitle icon="fileText">{tr('ws.incidents.mine.title')}</CardTitle>} style={{ flex: '1 1 22rem' }} data-testid="incidents.mine">
      {q.isError ? (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', justifyItems: 'start' }}>
          <ErrorText error={q.error} style={{ marginBlock: 0 }} />
          <Button size="sm" icon="refresh" onClick={() => void q.refetch()}>
            {tr('common.retry')}
          </Button>
        </div>
      ) : q.isPending ? (
        <Skeleton lines={3} />
      ) : rows.length === 0 ? (
        <p style={muted}>{tr('ws.incidents.mine.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-3)' }}>
          {rows.map((r, i) => (
            <li
              key={r.id}
              data-testid={`incidents.mine.${r.id}`}
              // A hairline between reports, none under the last.
              style={{ display: 'grid', gap: 'var(--tp-sp-1)', paddingBlockEnd: i < rows.length - 1 ? 'var(--tp-sp-3)' : undefined, borderBlockEnd: i < rows.length - 1 ? '1px solid var(--tp-border)' : undefined }}
            >
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                <strong>{tr(`work.incident.kind.${r.kind}`)}</strong>
                <bdi style={muted}>{placeText(r, locale, (p) => tr(`work.incident.place.${p}`))}</bdi>
                <span style={{ marginInlineStart: 'auto' }}>
                  <StatusBadge size="sm" tone={incidentTone(r.status)} label={tr(`work.incident.status.${r.status}`)} />
                </span>
              </span>
              {r.occurredAt && <span style={muted}>{tr('ws.incidents.happenedAt', { time: formatDateTime(new Date(r.occurredAt), locale) })}</span>}
              {r.redacted ? (
                <p style={{ ...muted, fontStyle: 'italic' }}>{tr('ws.incidents.redactedText')}</p>
              ) : (
                <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                  {r.description}
                </p>
              )}
              {r.photos.length > 0 && !r.redacted && (
                <span style={{ display: 'flex', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
                  {r.photos.map((p, i) => (
                    <StaffPhotoThumb key={p} path={p} label={tr('ws.incidents.sheet.photoAlt', { n: formatNumber(i + 1, locale) })} onClick={() => setPhotos(r.photos)} />
                  ))}
                </span>
              )}
              {r.status === 'reviewed' && (
                <div style={{ display: 'grid', gap: 'var(--tp-sp-0)', paddingBlock: 'var(--tp-sp-2)', paddingInline: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-ctl)', background: 'var(--tp-surface-2)' }}>
                  <span style={{ ...muted, fontWeight: 600 }}>
                    {tr('ws.incidents.reviewedBy', { name: isolate(r.reviewedByName ?? '—'), time: r.reviewedAt ? formatDateTime(new Date(r.reviewedAt), locale) : '' })}
                  </span>
                  {r.reviewNote && (
                    <p dir="auto" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                      {r.reviewNote}
                    </p>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {photos && <PhotoViewer title={tr('ws.incidents.sheet.photos', { count: formatNumber(photos.length, locale) })} paths={photos} onClose={() => setPhotos(null)} />}
    </Panel>
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
          can(staff?.role, 'reportIncidents') && !reporting ? (
            <Button kind="primary" icon="plus" onClick={() => setReporting(true)} data-testid="incidents.report.open">
              {tr('ws.incidents.form.title')}
            </Button>
          ) : undefined
        }
      />
      {reporting && (
        <Panel title={<CardTitle icon="alert">{tr('ws.incidents.form.title')}</CardTitle>} style={{ maxInlineSize: '42rem', marginBlockEnd: 'var(--tp-sp-4)' }} data-testid="incidents.report">
          <ReportIncidentForm onSent={() => setReporting(false)} onCancel={() => setReporting(false)} />
        </Panel>
      )}
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
