/**
 * The transactions behind a figure (report_drill), in words: when, what, who,
 * amount. Shared by every report, the management panel and analytics, so one
 * figure opens the same window wherever it is clicked. Kept free of the report
 * frame and the router so any screen can import it.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatDateTime, formatIQD, formatNumber, type Locale } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import { AsyncStateWrapper, DataTable, EmptyState, SegmentedControl, asyncStatus, type Column } from '../../components/kit';
import { readDrill, type DrillTransaction } from './reportPayloads';
import { drillWords } from './drillWords';

function day(iso: string, locale: Locale): string {
  return formatDate(new Date(`${iso}T12:00:00Z`), locale, 'UTC');
}

function money(n: number | null, locale: Locale): string {
  if (n === null) return '—';
  return Number.isInteger(n) ? formatIQD(n, locale) : formatNumber(n, locale);
}

/**
 * What to open: a figure (`bookings`, `refunds`…) and/or a scope
 * (`court:<id>`, `item:<id>`, `staff:<id>`), over some dates. With several
 * figures the dialog offers a switch between them — the Given away row opens
 * on discounts, and voids and refunds are one click away.
 */
export interface DrillRequest {
  what: string;
  figures: readonly { key: string | null; label: string }[];
  scope: string | null;
  from: string;
  to: string;
  note?: string;
}

const DRILL_KINDS = ['reservation', 'tab', 'payment', 'refund', 'adjustment', 'waste'] as const;
const DRILL_CAP = 500;

export function DrillDialog({ request, onClose }: { request: DrillRequest; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const [index, setIndex] = useState(0);
  const figure = request.figures[index] ?? request.figures[0];
  // A scope on its own is the figure argument ('court:<id>'); a figure with a
  // scope sends the scope as p_key (report_drill, 0099).
  const args = figure?.key
    ? { p_figure: figure.key, p_key: request.scope, p_from: request.from, p_to: request.to }
    : { p_figure: request.scope, p_key: null, p_from: request.from, p_to: request.to };
  const q = useQuery({
    queryKey: ['reports', 'drill', args],
    queryFn: async () => readDrill(await appRpc<unknown>('report_drill', args)),
  });
  const range = request.from === request.to ? day(request.from, locale) : tr('ws.reports.frame.period', { from: day(request.from, locale), to: day(request.to, locale) });
  const columns: Column<DrillTransaction>[] = [
    { key: 'at', header: tr('ws.reports.drill.when'), render: (t) => (t.at ? <bdi>{formatDateTime(new Date(t.at), locale)}</bdi> : '—') },
    {
      key: 'what',
      header: tr('ws.reports.drill.what'),
      truncate: true,
      // The server's label carries the table, court or item name; 24ch cut most of them off.
      width: '44ch',
      truncateTitle: (t) => drillWords(t, tr, locale).text ?? '',
      render: (t) => {
        const w = drillWords(t, tr, locale);
        const kind = w.kind ?? (t.kind && (DRILL_KINDS as readonly string[]).includes(t.kind) ? tr(`ws.reports.drill.kinds.${t.kind as (typeof DRILL_KINDS)[number]}`) : (t.kind ?? '—'));
        return (
          <span>
            <span style={{ fontWeight: 600 }}>{kind}</span>
            {w.text && (
              <span style={{ color: 'var(--tp-muted-fg)' }}>
                {' · '}
                <bdi>{w.text}</bdi>
              </span>
            )}
          </span>
        );
      },
    },
    { key: 'by', header: tr('ws.reports.drill.by'), render: (t) => (t.staffName ? <bdi>{t.staffName}</bdi> : '—') },
    { key: 'amount', header: tr('ws.reports.drill.amount'), numeric: true, render: (t) => money(t.amountIqd, locale) },
  ];
  const rows = q.data ?? [];
  // One Modal per request. The screens render a single <DrillDialog> slot and
  // swap its request, so React reused the Modal still fading out from the last
  // drill: open another figure inside that fade and the old exit timer fired
  // onClose, shutting the new one. A new request now mounts a fresh Modal, and
  // unmounting the old one clears its timer.
  const requestKey = [request.what, request.scope ?? '', request.from, request.to, ...request.figures.map((f) => f.key ?? '')].join('|');
  return (
    <Modal
      key={requestKey}
      title={tr('ws.reports.drill.title', { what: request.what, range })}
      onClose={onClose}
      size="lg"
      footer={(close) => (<Button onClick={close}>{tr('ws.kit.drill.close')}</Button>)}
    >
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)' }}>
        {request.figures.length > 1 && (
          <SegmentedControl<string>
            aria-label={tr('ws.reports.drill.figure')}
            size="sm"
            value={String(index)}
            onChange={(v) => setIndex(Number(v))}
            options={request.figures.map((f, i) => ({ value: String(i), label: f.label }))}
          />
        )}
        {request.note && <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{request.note}</p>}
        <AsyncStateWrapper
          status={asyncStatus(q, (d) => d.length === 0)}
          error={q.error}
          onRetry={() => void q.refetch()}
          emptyContent={<EmptyState compact icon="receipt" title={tr('ws.kit.drill.empty')} />}
        >
          {rows.length >= DRILL_CAP && <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.reports.drill.capped')}</p>}
          <DataTable columns={columns} rows={rows} rowKey={(t, i) => `${t.id}-${i}`} dense maxBlockSize="60vh" aria-label={request.what} />
        </AsyncStateWrapper>
      </div>
    </Modal>
  );
}
