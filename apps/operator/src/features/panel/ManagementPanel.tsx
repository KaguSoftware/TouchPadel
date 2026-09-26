/**
 * ManagementPanelScreen (spec 06.39) — the owner's landing screen. Reads
 * `panel_headline` for the period and comparison, renders the figures the
 * server sends (nothing estimated, nothing editable), and opens every figure
 * down to its transactions through `report_drill`.
 *
 * The default window is the one Analytics opens on: the last 30 days, ending
 * on the venue's business day (a 01:00 visit still belongs to the evening
 * before), compared with the 30 days before that. So the owner lands on the
 * same numbers in both places.
 *
 * Layout: a headline band in two labelled halves — what was EARNED (revenue)
 * and what was TAKEN in payments (cash, card) — then three columns of figure
 * rows: padel, cafe, and the money given away or thrown out.
 *
 * Why the halves are labelled: revenue counts a booking on the day it is
 * played and the cafe after refunds, while cash and card count money on the day
 * it was received. The band used to print the three side by side, so cash plus
 * card never came to the revenue beside them and nothing said why. Each half
 * now says what it counts.
 *
 * The subtitle is the period itself and, when comparing, the window the
 * changes are measured against — `panel_headline` returns it and the screen
 * used to drop it, so a "+25%" never said "against when".
 *
 * Export CSV writes everything the panel was given for the period: the
 * window, the figures, and every transaction behind every figure (the drill
 * rows, read in full — see exportAll.ts). It used to write the thirteen
 * totals and nothing else.
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { businessTodayISO, normalizeBusinessDayStart, resolveRange } from '@touch/core';
import { VENUE_TZ, formatDate, formatIQD, formatNumber, type Locale } from '@touch/i18n';
import { appRpc } from '../../lib/appRpc';
import { useLocale } from '../../lib/i18n';
import { useCafeSettings } from '../../lib/settings';
import { Button, Skeleton } from '../../components/ui';
import {
  AsyncStateWrapper,
  ComparisonControl,
  ComparisonDelta,
  DateRangeControl,
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
import { downloadCsv, toCsvSections } from '../analytics/csv';
import { DrillDialog } from '../reports/DrillDialog';
import { FigureGroup } from '../reports/FigureGroup';
import { readDrill } from '../reports/reportPayloads';
import { LiveFloor } from '../floor/LiveFloor';
import { FIGURES, figuresIn, mapFigures, panelIsEmpty, type FigureKey, type FigureMeta, type HeadlineFigureRow, type PanelHeadline } from './figures';
import { DRILLABLE_FIGURES, buildPanelExport, fetchAllTransactions, type DrillRange } from './exportAll';

export const PANEL_QUERY_KEY = ['panel', 'headline'] as const;

/** The coloured strip on a figure panel; inline because Panel's own inline border would win over a class. */
const FIGURE_PANEL_STRIP: CSSProperties = { borderBlockStart: '3px solid var(--tp-tone)' };

export function ManagementPanelScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Analytics' calendar: its business-day start hour decides which day "today" is.
  const settings = useCafeSettings();
  const settingsReady = settings.isSuccess || settings.isError;
  const todayISO = businessTodayISO(new Date(), normalizeBusinessDayStart(settings.settings.analytics_business_day_start_hour), VENUE_TZ);
  const today = useMemo(() => localMidnight(todayISO), [todayISO]);
  const defaultPeriod = useMemo<Period>(() => resolveRange({ range: '30d' }, todayISO).range, [todayISO]);
  const [picked, setPeriod] = useState<Period | null>(null);
  const period = picked ?? defaultPeriod;
  const [compare, setCompare] = useState<ComparisonMode>('previousPeriod');
  const [drill, setDrill] = useState<FigureKey | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportFailed, setExportFailed] = useState(false);

  const headlineQ = useQuery({
    queryKey: [...PANEL_QUERY_KEY, period.from, period.to, compare],
    queryFn: () => appRpc<PanelHeadline>('panel_headline', { p_from: period.from, p_to: period.to, p_compare: compare }),
    // Safety net under realtime: the owner reads this after hours, a minute is fine.
    refetchInterval: 60_000,
    // Until the settings settle, "today" (and so the default window) is not known yet.
    enabled: picked !== null || settingsReady,
  });
  const figures = useMemo(() => mapFigures(headlineQ.data), [headlineQ.data]);
  const status = asyncStatus(headlineQ, panelIsEmpty);

  const label = (key: FigureKey) => tr(`ws.owner.panel.figures.${key}`);
  const money = (n: number) => (Number.isInteger(n) ? formatIQD(n, locale) : formatNumber(n, locale));
  const count = (n: number) => formatNumber(n, locale);
  const valueOf = (meta: FigureMeta, f: HeadlineFigureRow | undefined) =>
    f?.value == null ? '—' : meta.kind === 'money' ? money(f.value) : count(f.value);

  // The same query key the drill dialog uses, so a window already opened is
  // not read twice; a call that fails fails the whole export, never a partial file.
  const fetchDrill = (figure: FigureKey, range: DrillRange) => {
    const args = { p_figure: figure, p_key: null, p_from: range.from, p_to: range.to };
    return queryClient.fetchQuery({ queryKey: ['reports', 'drill', args], queryFn: async () => readDrill(await appRpc<unknown>('report_drill', args)) });
  };

  async function exportCsv() {
    setExporting(true);
    setExportFailed(false);
    try {
      const transactions = await Promise.all(DRILLABLE_FIGURES.filter((k) => figures.has(k)).map((k) => fetchAllTransactions(k, period, fetchDrill)));
      const csv = toCsvSections(
        buildPanelExport({
          period,
          compare,
          comparison: compare === 'none' ? null : (headlineQ.data?.comparison ?? null),
          figures,
          transactions,
          exportedAt: new Date(),
          tr,
          locale,
        }),
      );
      downloadCsv(`${tr('ws.owner.panel.exportFile')}_${period.from}_${period.to}.csv`, csv);
    } catch (error) {
      console.error('panel export failed', error);
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  const go = (to: FigureMeta['report']) => void navigate({ to });

  return (
    <div>
      <PageHeader
        title={tr('ws.owner.panel.title')}
        subtitle={periodLine(period, compare === 'none' ? null : (headlineQ.data?.comparison ?? null), locale, tr)}
        actions={<ExportButton onExport={() => void exportCsv()} busy={exporting} disabled={status !== 'ready'} />}
      />
      {exportFailed && (
        <p role="alert" style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-danger-fg)', marginBlockEnd: 'var(--tp-sp-3)' }}>
          {tr('ws.owner.panel.csv.failed')}
        </p>
      )}
      {/* Now, before the period: the floor this minute is the one thing on the
          screen the date range does not govern, so it sits above the range
          control rather than among the figures it would otherwise seem to
          belong to (owner request, 2026-09-18). */}
      <div style={{ marginBlockEnd: 'var(--tp-sp-4)' }}>
        <LiveFloor blockSize="24rem" boardLinks />
      </div>

      <Toolbar end={<ComparisonControl mode={compare} onChange={setCompare} disabled={headlineQ.isFetching} />}>
        <DateRangeControl period={period} onChange={setPeriod} disabled={headlineQ.isFetching} now={today} />
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
            action={<WiderRange period={period} today={today} onPick={setPeriod} />}
          />
        }
      >
        <section aria-label={tr('ws.owner.panel.headline')} style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gridTemplateRows: 'auto auto', gap: 'var(--tp-sp-4)', marginBlockEnd: 'var(--tp-sp-4)' }}>
          {(
            [
              { title: 'ws.owner.panel.earned', hint: 'ws.owner.panel.earnedHint', keys: ['revenue'] },
              { title: 'ws.owner.panel.taken', hint: 'ws.owner.panel.takenHint', keys: ['cash', 'card'] },
            ] as const
          ).map((group) => (
            // The revenue report's group card, so Earned and Money taken wear
            // the same colours here as there (blue, then green).
            <FigureGroup key={group.title} title={tr(group.title)} hint={tr(group.hint)} span={group.keys.length}>
              {group.keys.map((key) => {
                const meta = FIGURES[key];
                const f = figures.get(key);
                return (
                  <HeadlineFigure
                    key={key}
                    label={label(key)}
                    value={valueOf(meta, f)}
                    comparison={compare === 'none' || !f ? null : f}
                    format={meta.kind === 'money' ? money : count}
                    invert={meta.invert}
                    drillable={Boolean(f)}
                    onDrill={() => setDrill(key)}
                    busy={headlineQ.isFetching && !headlineQ.data}
                  />
                );
              })}
            </FigureGroup>
          ))}
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(19rem, 1fr))', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
          {/* Same colour order as the cards above (blue, green, black), as a
              strip only. */}
          <Panel
            title={tr('ws.owner.panel.padel')}
            padded={false}
            className="tp-figure-panel"
            style={FIGURE_PANEL_STRIP}
            actions={<Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/reports/courts')}>{tr('ws.owner.panel.openCourts')}</Button>}
          >
            <FigureRows metas={figuresIn('padel')} figures={figures} compare={compare} label={label} valueOf={valueOf} money={money} count={count} onDrill={setDrill} />
          </Panel>
          <Panel
            title={tr('ws.owner.panel.cafe')}
            padded={false}
            className="tp-figure-panel"
            style={FIGURE_PANEL_STRIP}
            actions={<Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/reports/cafe')}>{tr('ws.owner.panel.openCafe')}</Button>}
          >
            <FigureRows metas={figuresIn('cafe')} figures={figures} compare={compare} label={label} valueOf={valueOf} money={money} count={count} onDrill={setDrill} />
          </Panel>
          <Panel title={tr('ws.owner.panel.losses')} padded={false} className="tp-figure-panel" style={FIGURE_PANEL_STRIP}>
            <FigureRows metas={figuresIn('losses')} figures={figures} compare={compare} label={label} valueOf={valueOf} money={money} count={count} onDrill={setDrill} />
          </Panel>
        </div>

        <nav aria-label={tr('ws.owner.panel.otherReports')} style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap', alignItems: 'center', marginBlockStart: 'var(--tp-sp-4)' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.owner.panel.otherReports')}</span>
          <Button size="sm" icon="chart" onClick={() => go('/reports/revenue')}>{tr('ws.owner.panel.openRevenue')}</Button>
          <Button size="sm" icon="box" onClick={() => go('/reports/stock')}>{tr('ws.owner.panel.openStock')}</Button>
          <Button size="sm" icon="users" onClick={() => go('/reports/staff')}>{tr('ws.owner.panel.openStaff')}</Button>
        </nav>
      </AsyncStateWrapper>

      {/* The same transactions window the reports open, so a figure reads the
          same here as on its report: when, what in words, who, and the amount. */}
      {drill && (
        <DrillDialog
          request={{ what: label(drill), figures: [{ key: drill, label: label(drill) }], scope: null, from: period.from, to: period.to }}
          onClose={() => setDrill(null)}
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

/** "18 Aug – 16 Sep 2026", with the comparison window when there is one. */
function periodLine(
  period: Period,
  comparison: { from: string; to: string } | null,
  locale: Locale,
  tr: ReturnType<typeof useLocale>['tr'],
): string {
  const day = (iso: string) => formatDate(new Date(`${iso}T12:00:00Z`), locale, 'UTC');
  return comparison
    ? tr('ws.owner.panel.periodCompared', { from: day(period.from), to: day(period.to), prevFrom: day(comparison.from), prevTo: day(comparison.to) })
    : tr('ws.owner.panel.period', { from: day(period.from), to: day(period.to) });
}

/** A 'YYYY-MM-DD' as a local-midnight Date, so the kit presets count from the business day. */
function localMidnight(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** The empty state's way out: the last 30 days, or last month when that is what is already showing. */
function WiderRange({ period, today, onPick }: { period: Period; today: Date; onPick: (p: Period) => void }) {
  const { tr } = useLocale();
  const last30 = presetPeriod('last30', today);
  const preset = last30.from === period.from && last30.to === period.to ? 'lastMonth' : 'last30';
  return <Button onClick={() => onPick(presetPeriod(preset, today))}>{tr(`ws.kit.dateRange.${preset}`)}</Button>;
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
