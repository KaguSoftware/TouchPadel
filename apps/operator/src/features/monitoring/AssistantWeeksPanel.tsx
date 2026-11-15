/**
 * The Monitoring page's one quiet "Assistant" table (assistant_weekly_page,
 * 0420-0422): a row per complete week, newest first, three shown and the rest
 * behind View more. No cards, no chart, no hero number (the owner: "make sure
 * it's low-key"). It does not follow the page's filters. A week the server
 * marks `warn` carries the page's own Warning badge beside the date, never a
 * row fill. Nothing in it is interactive but the Failed cell's tooltip.
 */
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatNumber } from '@touch/i18n';
import { useLocale } from '../../lib/i18n';
import { formatUsd } from '../../lib/assistantPricing';
import { AsyncStateWrapper, DataTable, Panel, StatusBadge, TableSkeleton, ViewMore, useListCap, type Column } from '../../components/kit';
import { MK, fetchAssistantWeeks } from './api';
import { REFRESH_MS, assistantWeekRows, noAssistantQuestions, type AssistantWeekRow } from './monitoringLogic';

const iso = (s: string) => `⁨${s}⁩`;

export function AssistantWeeksPanel() {
  const { tr, locale } = useLocale();
  const weeks = useQuery({ queryKey: MK.assistantWeeks, queryFn: fetchAssistantWeeks, refetchInterval: REFRESH_MS });
  const rows = weeks.data
    ? assistantWeekRows(weeks.data, {
        number: (n) => formatNumber(n, locale),
        date: (d) => formatDate(d, locale),
        usd: (micros) => iso(formatUsd(micros)),
        thumbsOf: (n, rated) => tr('ws.monitoring.assistant.thumbsOf', { n, rated }),
        range: (from, to) => tr('ws.monitoring.assistant.weekRange', { from, to }),
      })
    : [];
  const cap = useListCap(rows);

  const columns: Column<AssistantWeekRow>[] = [
    {
      key: 'week',
      header: tr('ws.monitoring.assistant.week'),
      width: '12rem',
      truncateTitle: (r) => r.weekTitle,
      render: (r) => (
        <span title={r.weekTitle} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>{r.week}</span>
          {r.warn && <StatusBadge size="sm" tone="warn" label={tr('ws.monitoring.levels.warn')} />}
        </span>
      ),
    },
    { key: 'questions', header: tr('ws.monitoring.assistant.questions'), numeric: true, render: (r) => r.questions },
    {
      key: 'failed',
      header: tr('ws.monitoring.assistant.failed'),
      numeric: true,
      render: (r) => <span title={r.failedTitle || undefined}>{r.failed}</span>,
    },
    { key: 'notSaved', header: tr('ws.monitoring.assistant.notSaved'), numeric: true, render: (r) => r.notSaved },
    { key: 'marked', header: tr('ws.monitoring.assistant.marked'), numeric: true, render: (r) => r.marked },
    { key: 'thumbsDown', header: tr('ws.monitoring.assistant.thumbsDown'), numeric: true, render: (r) => r.thumbsDown },
    { key: 'median', header: tr('ws.monitoring.assistant.median'), numeric: true, render: (r) => r.median },
    { key: 'costPerQuestion', header: tr('ws.monitoring.assistant.costPerQuestion'), numeric: true, render: (r) => r.costPerQuestion },
  ];

  return (
    <Panel title={tr('ws.monitoring.assistant.title')} data-testid="monitoring-assistant">
      <AsyncStateWrapper
        status={weeks.isError && !weeks.data ? 'error' : !weeks.data ? 'loading' : noAssistantQuestions(weeks.data) ? 'empty' : 'ready'}
        error={weeks.error}
        onRetry={() => void weeks.refetch()}
        skeleton={<TableSkeleton columns={columns} rows={3} dense />}
        emptyContent={<p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.monitoring.assistant.empty')}</p>}
      >
        <DataTable columns={columns} rows={cap.shown} rowKey={(r) => r.key} dense aria-label={tr('ws.monitoring.assistant.title')} />
        <ViewMore hidden={cap.hidden} open={cap.open} onToggle={cap.toggle} />
      </AsyncStateWrapper>
    </Panel>
  );
}
