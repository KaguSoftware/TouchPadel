/**
 * The transactions behind a figure (report_drill), in words: when, what, who,
 * amount. Shared by every report, the management panel and analytics, so one
 * figure opens the same window wherever it is clicked. Kept free of the report
 * frame and the router so any screen can import it.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { formatDate, formatDayNumber, formatMonthShort, formatNumber, formatTime, formatWeekdayShort, type Locale } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, Modal } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  FilterChips,
  Money,
  ResultCount,
  SearchField,
  SegmentedControl,
  asyncStatus,
  type Column,
} from '../../components/kit';
import { readDrill } from './reportPayloads';
import { drillColumns } from './drillWords';
import { drillKindKey, drillTone, splitShares, summarizeDrill, venueDay } from './drillView';

function day(iso: string, locale: Locale): string {
  return formatDate(new Date(`${iso}T12:00:00Z`), locale, 'UTC');
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

  // Each transaction split over the table's columns once, then filtered by
  // the kind tabs, a place clicked in a row, and the search (Sait, 2026-10-19).
  const view = useMemo(
    () =>
      (q.data ?? []).map((t) => {
        const c = drillColumns(t, tr, locale);
        const key = drillKindKey(c.sub, t.kind);
        const label = c.kind ?? (t.kind && (DRILL_KINDS as readonly string[]).includes(t.kind) ? tr(`ws.reports.drill.kinds.${t.kind as (typeof DRILL_KINDS)[number]}`) : (t.kind ?? '—'));
        return { t, c, key, label, day: venueDay(t.at) };
      }),
    [q.data, tr, locale],
  );
  const [kind, setKind] = useState<string | null>(null);
  const [place, setPlace] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const needle = query.trim().toLocaleLowerCase();
  const shown = view.filter(
    (v) =>
      (!kind || v.key === kind) &&
      (!place || v.c.location === place) &&
      (!needle || [v.label, v.c.detail, v.c.location, v.c.customer, v.t.staffName].some((x) => x?.toLocaleLowerCase().includes(needle))),
  );
  const summary = summarizeDrill(shown.map((v) => ({ kind: v.key, amount: v.t.amountIqd, staff: v.t.staffName })));
  const kindLabel = (key: string) => view.find((v) => v.key === key)?.label ?? key;
  const allKinds = summarizeDrill(view.map((v) => ({ kind: v.key, amount: v.t.amountIqd, staff: null }))).kinds;
  type Row = (typeof view)[number];

  const tag = (v: Row) => {
    const tone = drillTone(v.key);
    return (
      <button
        type="button"
        onClick={() => setKind(v.key)}
        title={tr('ws.reports.drill.showOnly', { name: v.label })}
        style={{ ...tagStyle, background: `var(--tp-breakdown-${tone})`, color: `var(--tp-breakdown-${tone}-fg)` }}
      >
        {v.label}
      </button>
    );
  };
  const columns: Column<Row>[] = [
    { key: 'at', header: tr('ws.reports.drill.time'), width: '6.5rem', render: (v) => (v.t.at ? <bdi style={{ fontWeight: 600 }}>{formatTime(new Date(v.t.at), locale)}</bdi> : '—') },
    {
      key: 'what',
      header: tr('ws.reports.drill.what'),
      render: (v) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
          {tag(v)}
          {v.c.detail && (
            <bdi style={{ color: 'var(--tp-muted-fg)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.c.detail}</bdi>
          )}
        </span>
      ),
    },
    {
      key: 'location',
      header: tr('ws.reports.drill.location'),
      render: (v) =>
        v.c.location ? (
          <button type="button" onClick={() => setPlace(v.c.location)} title={tr('ws.reports.drill.showOnly', { name: v.c.location })} style={placeStyle}>
            <bdi>{v.c.location}</bdi>
          </button>
        ) : (
          <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>
        ),
    },
    {
      key: 'customer',
      header: tr('ws.reports.drill.customer'),
      truncate: true,
      width: '18ch',
      truncateTitle: (v) => v.c.customer ?? '',
      render: (v) => (v.c.customer ? <bdi>{v.c.customer}</bdi> : <span style={{ color: 'var(--tp-muted-fg)' }}>—</span>),
    },
    // One person took every row: the column folds into the figure card's "All taken by".
    ...(summary.soleStaff ? [] : [{ key: 'by', header: tr('ws.reports.drill.by'), render: (v: Row) => (v.t.staffName ? <bdi>{v.t.staffName}</bdi> : '—') }]),
    {
      key: 'amount',
      header: tr('ws.reports.drill.amountIqd'),
      numeric: true,
      render: (v) => (v.t.amountIqd ? <Money amount={v.t.amountIqd} unit={false} strong /> : <span style={{ color: 'var(--tp-muted-fg)' }}>{v.t.amountIqd === null ? '—' : '0'}</span>),
    },
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
      title={request.what}
      // The dates sit under the title in light grey, as the other windows' subtitles do.
      subtitle={range}
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
            onChange={(v) => {
              // Another figure is another list: its kinds and places start unfiltered.
              setIndex(Number(v));
              setKind(null);
              setPlace(null);
            }}
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
          <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
            <TotalCard summary={summary} label={kindLabel} />
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
              <SearchField value={query} onChange={setQuery} placeholder={tr('ws.reports.drill.search')} style={{ flex: '1 1 14rem', inlineSize: 'auto' }} />
              {allKinds.length > 1 && (
                <SegmentedControl<string>
                  aria-label={tr('ws.reports.drill.kind')}
                  size="sm"
                  value={kind ?? 'all'}
                  onChange={(v) => setKind(v === 'all' ? null : v)}
                  options={[
                    { value: 'all', label: <Counted label={tr('ws.reports.drill.all')} n={view.length} /> },
                    ...allKinds.map((k) => ({ value: k.key, label: <Counted label={kindLabel(k.key)} n={k.count} /> })),
                  ]}
                />
              )}
              <FilterChips chips={place ? [{ id: 'place', label: <bdi>{place}</bdi>, text: place, onRemove: () => setPlace(null) }] : []} />
              <ResultCount shown={shown.length} total={view.length} style={{ marginInlineStart: 'auto' }} />
            </div>
            <DataTable
              columns={columns}
              rows={shown}
              rowKey={(v, i) => `${v.t.id}-${i}`}
              dense
              maxBlockSize="55vh"
              aria-label={request.what}
              // Date style E: a Day column beside each day's rows (Sait, 2026-10-19).
              groupBy={(v) => v.day}
              groupColumn={{
                header: tr('ws.reports.drill.day'),
                width: '5.5rem',
                render: (_key, dayRows) => <DayCell at={dayRows[0]!.t.at} total={dayRows.reduce((a, v) => a + (v.t.amountIqd ?? 0), 0)} />,
              }}
              footer={
                <tr>
                  <td colSpan={columns.length}>{tr('ws.reports.drill.totalRow', { count: formatNumber(summary.count, locale) })}</td>
                  <td data-align="end">
                    <Money amount={summary.total} unit={false} />
                  </td>
                </tr>
              }
            />
          </div>
        </AsyncStateWrapper>
      </div>
    </Modal>
  );
}

const tagStyle: CSSProperties = {
  border: 'none',
  borderRadius: 'var(--tp-radius-pill)',
  paddingBlock: '0.1rem',
  paddingInline: 'var(--tp-sp-2)',
  font: 'inherit',
  fontSize: 'var(--tp-fs-xs)',
  fontWeight: 600,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
};

const placeStyle: CSSProperties = {
  border: 'none',
  background: 'none',
  padding: 0,
  font: 'inherit',
  color: 'inherit',
  fontWeight: 500,
  whiteSpace: 'nowrap',
  cursor: 'pointer',
  textDecoration: 'underline dotted',
  textDecorationColor: 'transparent',
  textUnderlineOffset: '3px',
};

function Counted({ label, n }: { label: string; n: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
      {label}
      <span className="tp-seg-n">{n}</span>
    </span>
  );
}

/** The Day column's cell: weekday, the date large, month, and the day's total. */
function DayCell({ at, total }: { at: string | null; total: number }) {
  const { locale } = useLocale();
  if (!at) return <span>—</span>;
  const d = new Date(at);
  return (
    <>
      <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, textTransform: 'uppercase' }}>{formatWeekdayShort(d, locale)}</span>
      <span style={{ fontSize: 'var(--tp-fs-2xl)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>{formatDayNumber(d, locale)}</span>
      <span style={{ fontSize: 'var(--tp-fs-xs)', fontWeight: 600, textTransform: 'uppercase' }}>{formatMonthShort(d, locale)}</span>
      <span
        style={{
          marginBlockStart: 'var(--tp-sp-1-5)',
          paddingInline: 'var(--tp-sp-2)',
          borderRadius: 'var(--tp-radius-pill)',
          background: 'var(--tp-accent-soft)',
          color: 'var(--tp-accent-soft-fg)',
          fontSize: 'var(--tp-fs-xs)',
          fontWeight: 600,
        }}
      >
        <Money amount={total} unit={false} />
      </span>
    </>
  );
}

/**
 * The figure card over the rows: blue mode's deep panel in both modes, the
 * total large, and a bar split by kind in full-strength card colours (Sait,
 * 2026-10-19).
 */
function TotalCard({ summary, label }: { summary: ReturnType<typeof summarizeDrill>; label: (key: string) => string }) {
  const { tr, locale } = useLocale();
  const muted: CSSProperties = { color: 'var(--tp-total-card-muted)', fontSize: 'var(--tp-fs-sm)' };
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 14rem), 1fr))',
        gap: 'var(--tp-sp-3) var(--tp-sp-6)',
        alignItems: 'center',
        paddingBlock: 'var(--tp-sp-3)',
        paddingInline: 'var(--tp-sp-4)',
        background: 'var(--tp-total-card)',
        color: 'var(--tp-total-card-fg)',
        borderRadius: 'var(--tp-radius-panel)',
      }}
    >
      <div style={{ display: 'grid', gap: '2px' }}>
        <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)', fontWeight: 600 }}>{tr('ws.reports.drill.total')}</span>
        <Money amount={summary.total} strong style={{ fontSize: 'var(--tp-fs-2xl)' }} />
        <span style={muted}>
          {tr('ws.reports.drill.itemsCount', { count: formatNumber(summary.count, locale) })}
          {summary.soleStaff && (
            <>
              {' · '}
              <bdi>{tr('ws.reports.drill.allBy', { name: summary.soleStaff })}</bdi>
            </>
          )}
        </span>
      </div>
      <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', minInlineSize: 0 }}>
        <div aria-hidden="true" style={{ display: 'flex', blockSize: '10px', borderRadius: 'var(--tp-radius-pill)', overflow: 'hidden', background: 'color-mix(in oklab, var(--tp-total-card-fg) 14%, transparent)' }}>
          {splitShares(summary.kinds).map((k) => (
            <span key={k.key} style={{ inlineSize: `${k.share * 100}%`, background: `var(--tp-split-${drillTone(k.key)})` }} />
          ))}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--tp-sp-1-5) var(--tp-sp-5)', fontSize: 'var(--tp-fs-sm)' }}>
          {summary.kinds.map((k) => (
            <span key={k.key} style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)' }}>
              <span aria-hidden="true" style={{ inlineSize: '10px', blockSize: '10px', borderRadius: 'var(--tp-radius-sm)', background: `var(--tp-split-${drillTone(k.key)})` }} />
              {label(k.key)}
              <b style={{ fontVariantNumeric: 'tabular-nums' }}>{formatNumber(k.count, locale)}</b>
              <span aria-hidden="true">·</span>
              <Money amount={k.sum} unit={false} strong />
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
