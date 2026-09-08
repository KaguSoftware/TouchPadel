/**
 * ManagementPanelScreen (spec 06.39) — the owner's landing screen. Reads
 * `panel_headline` for the period and comparison, renders the figures the
 * server sends (nothing estimated, nothing editable), and opens every figure
 * down to its transactions through `report_drill`.
 *
 * Layout: a dense headline band (revenue, cash, card), then two columns —
 * padel against cafe — as figure rows, not a grid of identical cards.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD, formatNumber } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { Button, Skeleton } from '../../components/ui';
import {
  AsyncStateWrapper,
  ComparisonControl,
  ComparisonDelta,
  DateRangeControl,
  DrillThroughPanel,
  EmptyState,
  ExportButton,
  HeadlineFigure,
  PageHeader,
  Panel,
  Toolbar,
  asyncStatus,
  presetPeriod,
  type ComparisonMode,
  type Period,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { downloadCsv, toCsv } from '../analytics/csv';
import { normalizeColumns, type DrillResult, type ReportRow } from '../reports/reportTypes';
import { toDataColumns } from '../reports/columns';
import { figuresIn, figuresToCsvRows, mapFigures, panelIsEmpty, type FigureKey, type FigureMeta, type HeadlineFigureRow, type PanelHeadline } from './figures';

export const PANEL_QUERY_KEY = ['panel', 'headline'] as const;

export function ManagementPanelScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const [period, setPeriod] = useState<Period>(() => presetPeriod('thisMonth'));
  const [compare, setCompare] = useState<ComparisonMode>('previousPeriod');
  const [drill, setDrill] = useState<FigureKey | null>(null);

  const headlineQ = useQuery({
    queryKey: [...PANEL_QUERY_KEY, period.from, period.to, compare],
    queryFn: () => appRpc<PanelHeadline>('panel_headline', { p_from: period.from, p_to: period.to, p_compare: compare }),
    // Safety net under realtime: the owner reads this after hours, a minute is fine.
    refetchInterval: 60_000,
  });
  const figures = useMemo(() => mapFigures(headlineQ.data), [headlineQ.data]);
  const status = asyncStatus(headlineQ, panelIsEmpty);

  const drillQ = useQuery({
    queryKey: ['panel', 'drill', drill, period.from, period.to],
    queryFn: () => appRpc<DrillResult>('report_drill', { p_figure: drill, p_key: null, p_from: period.from, p_to: period.to }),
    enabled: drill !== null,
  });
  const transactions: ReportRow[] = useMemo(() => drillQ.data?.transactions ?? [], [drillQ.data]);
  const drillColumns = useMemo(() => toDataColumns(normalizeColumns(null, transactions), locale, tr), [transactions, locale, tr]);

  const label = (key: FigureKey) => tr(`ws.owner.panel.figures.${key}`);
  const money = (n: number) => (Number.isInteger(n) ? formatIQD(n, locale) : formatNumber(n, locale));
  const count = (n: number) => formatNumber(n, locale);
  const valueOf = (meta: FigureMeta, f: HeadlineFigureRow | undefined) =>
    f?.value == null ? '—' : meta.kind === 'money' ? money(f.value) : count(f.value);

  function exportCsv() {
    const csv = toCsv(
      [tr('ws.owner.panel.csv.figure'), tr('ws.owner.panel.csv.value'), tr('ws.owner.panel.csv.previous'), tr('ws.owner.panel.csv.changeAbs'), tr('ws.owner.panel.csv.changePct')],
      figuresToCsvRows(figures, label),
    );
    downloadCsv(`${tr('ws.owner.panel.exportFile')}_${period.from}_${period.to}.csv`, csv);
  }

  const go = (to: FigureMeta['report']) => void navigate({ to });

  return (
    <div>
      <PageHeader
        title={tr('ws.owner.panel.title')}
        subtitle={tr('ws.owner.panel.lead')}
        actions={<ExportButton onExport={exportCsv} disabled={status !== 'ready'} />}
      />
      <Toolbar end={<ComparisonControl mode={compare} onChange={setCompare} disabled={headlineQ.isFetching} />}>
        <DateRangeControl period={period} onChange={setPeriod} disabled={headlineQ.isFetching} />
      </Toolbar>

      <AsyncStateWrapper
        status={status}
        error={headlineQ.error}
        onRetry={() => void headlineQ.refetch()}
        skeleton={<PanelSkeleton />}
        emptyContent={
          <EmptyState
            icon="chart"
            title={tr('ws.owner.panel.emptyTitle')}
            body={tr('ws.owner.panel.emptyBody')}
            action={<Button onClick={() => setPeriod(presetPeriod('last30'))}>{tr('ws.kit.dateRange.last30')}</Button>}
          />
        }
      >
        <section aria-label={tr('ws.owner.panel.headline')} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--tp-sp-3)', marginBlockEnd: 'var(--tp-sp-4)' }}>
          {figuresIn('headline').map((meta) => {
            const f = figures.get(meta.key);
            return (
              <HeadlineFigure
                key={meta.key}
                label={label(meta.key)}
                value={valueOf(meta, f)}
                comparison={compare === 'none' || !f ? null : f}
                format={meta.kind === 'money' ? money : count}
                invert={meta.invert}
                drillable={Boolean(f)}
                onDrill={() => setDrill(meta.key)}
                busy={headlineQ.isFetching && !headlineQ.data}
              />
            );
          })}
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
          <Panel
            title={tr('ws.owner.panel.padel')}
            padded={false}
            actions={<Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/reports/courts')}>{tr('ws.owner.panel.openCourts')}</Button>}
          >
            <FigureRows metas={figuresIn('padel')} figures={figures} compare={compare} label={label} valueOf={valueOf} money={money} count={count} onDrill={setDrill} />
          </Panel>
          <Panel
            title={tr('ws.owner.panel.cafe')}
            padded={false}
            actions={<Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/reports/cafe')}>{tr('ws.owner.panel.openCafe')}</Button>}
          >
            <FigureRows metas={figuresIn('cafe')} figures={figures} compare={compare} label={label} valueOf={valueOf} money={money} count={count} onDrill={setDrill} />
          </Panel>
        </div>

        <nav aria-label={tr('ws.shell.nav.reports')} style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', marginBlockStart: 'var(--tp-sp-4)' }}>
          <Button size="sm" icon="chart" onClick={() => go('/reports/revenue')}>{tr('ws.owner.panel.openRevenue')}</Button>
          <Button size="sm" icon="box" onClick={() => go('/reports/stock')}>{tr('ws.owner.panel.openStock')}</Button>
          <Button size="sm" icon="users" onClick={() => go('/reports/staff')}>{tr('ws.owner.panel.openStaff')}</Button>
        </nav>
      </AsyncStateWrapper>

      {drill && (
        <DrillThroughPanel
          title={tr('ws.owner.panel.drillTitle', { figure: label(drill) })}
          status={asyncStatus(drillQ, (d) => (d?.transactions ?? []).length === 0)}
          transactions={transactions}
          columns={drillColumns}
          rowKey={(row, i) => String(row.id ?? i)}
          onClose={() => setDrill(null)}
          onRetry={() => void drillQ.refetch()}
          error={drillQ.error}
        />
      )}
    </div>
  );
}

/** Dense figure rows for the padel / cafe columns: label, value, delta, drill. */
function FigureRows({
  metas,
  figures,
  compare,
  label,
  valueOf,
  money,
  count,
  onDrill,
}: {
  metas: readonly FigureMeta[];
  figures: ReadonlyMap<FigureKey, HeadlineFigureRow>;
  compare: ComparisonMode;
  label: (key: FigureKey) => string;
  valueOf: (meta: FigureMeta, f: HeadlineFigureRow | undefined) => string;
  money: (n: number) => string;
  count: (n: number) => string;
  onDrill: (key: FigureKey) => void;
}) {
  const { tr } = useLocale();
  const row: CSSProperties = {
    display: 'grid',
    gridTemplateColumns: 'minmax(0, 1fr) auto auto',
    alignItems: 'center',
    gap: 'var(--tp-sp-3)',
    inlineSize: '100%',
    paddingBlock: 'var(--tp-sp-2-5)',
    paddingInline: 'var(--tp-sp-3)',
    background: 'transparent',
    border: 'none',
    color: 'inherit',
    textAlign: 'start',
    font: 'inherit',
  };
  return (
    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {metas.map((meta) => {
        const f = figures.get(meta.key);
        const drillable = Boolean(f);
        const body = (
          <>
            <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
              <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{label(meta.key)}</span>
              {compare !== 'none' && f && (
                <ComparisonDelta changeAbs={f.changeAbs} changePct={f.changePct} format={meta.kind === 'money' ? money : count} invert={meta.invert} />
              )}
            </span>
            <span dir="ltr" style={{ fontSize: 'var(--tp-fs-lg)', fontWeight: 700, fontVariantNumeric: 'tabular-nums', fontFamily: 'var(--tp-font-numeric)' }}>
              {valueOf(meta, f)}
            </span>
            {/* Reserved either way, so nothing shifts as figures arrive (11.5). */}
            <Icon name="arrowUpRight" size={14} style={{ color: 'var(--tp-muted-fg)', visibility: drillable ? 'visible' : 'hidden' }} />
          </>
        );
        return (
          <li key={meta.key} style={{ borderBlockEnd: '1px solid var(--tp-border)' }}>
            {/*
              A figure the server did not send has nothing to open. It used to
              render as a disabled button carrying no reason, which the rulebook
              treats as a dead end (4.3) — and there is no reason to give: the
              row already says '—' where the value would be. So it is not a
              control at all, and the keyboard walks past it instead of landing
              on something that cannot answer.
            */}
            {drillable ? (
              <button type="button" className="tp-row" data-clickable="true" onClick={() => onDrill(meta.key)} title={tr('ws.kit.drill.title')} style={{ ...row, cursor: 'pointer' }}>
                {body}
              </button>
            ) : (
              <div style={row}>{body}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function PanelSkeleton() {
  return (
    <div aria-busy="true" style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr) minmax(0, 1fr)', gap: 'var(--tp-sp-3)' }}>
        <Skeleton lines={3} blockSize="1.2rem" />
        <Skeleton lines={3} blockSize="1.2rem" />
        <Skeleton lines={3} blockSize="1.2rem" />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(20rem, 1fr))', gap: 'var(--tp-sp-4)' }}>
        <Skeleton lines={5} />
        <Skeleton lines={6} />
      </div>
    </div>
  );
}
