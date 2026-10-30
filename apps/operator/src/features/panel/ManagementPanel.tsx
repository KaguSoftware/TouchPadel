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
 *
 * Open matches (docs/design/open-matches/operator.md §5.19): a fourth panel,
 * "Online money and open matches", holds panel_headline's seven online keys
 * (deposits, ticket sales, refunds, forfeits and liability, written-off match
 * shares) and is left out when the server sent none (before 0265). The ticket
 * sales, refunds and liability are counted at every branch whatever the scope,
 * and say so. A row opens its report: report_drill has no transactions for
 * these, so they are never drilled.
 *
 * Coaching (docs/design/coaching/operator.md §5.18.4, C-18): a "Lessons" panel
 * holds panel_headline's two lesson keys (lesson revenue, owed to coaches),
 * left out when the server sent neither (before 0288). Like the online group,
 * a row opens its report (revenue; Coach pay) and is never drilled.
 */
import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
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
  DateRangeControl,
  EmptyState,
  ExportButton,
  HeadlineFigure,
  PageHeader,
  Toolbar,
  asyncStatus,
  presetPeriod,
  type ComparisonMode,
  type Period,
} from '../../components/kit';
import { downloadWorkbook } from '../analytics/exportTables';
import { DrillDialog } from '../reports/DrillDialog';
import { FigureGroup } from '../reports/FigureGroup';
import { readDrill } from '../reports/reportPayloads';
import { PanelNeedsYou } from './PanelNeedsYou';
import { LiveFloor } from '../floor/LiveFloor';
import { FIGURES, figuresIn, hasLessonFigures, hasOnlineFigures, mapFigures, panelIsEmpty, type FigureKey, type FigureMeta, type HeadlineFigureRow, type PanelGroup, type PanelHeadline } from './figures';
import { DRILLABLE_FIGURES, buildPanelExport, fetchAllTransactions, type DrillRange } from './exportAll';
import { WagesDueCard } from '../wages/WagesDueCard';
import { BreakdownCard, BreakdownFrame, BreakdownRows, type BreakdownItem } from '../../components/BreakdownCards';
import { Notices } from '../analytics/Notices';
import { legacyNotices, parseLegacyHistory } from '../analytics/legacyHistory';

export const PANEL_QUERY_KEY = ['panel', 'headline'] as const;

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
      const bundle = buildPanelExport({
        period,
        compare,
        comparison: compare === 'none' ? null : (headlineQ.data?.comparison ?? null),
        figures,
        transactions,
        exportedAt: new Date(),
        tr,
        locale,
      });
      // Three tables, so three sheets in one workbook.
      downloadWorkbook(`${tr('ws.owner.panel.exportFile')}_${period.from}_${period.to}`, locale, bundle);
    } catch (error) {
      console.error('panel export failed', error);
      setExportFailed(true);
    } finally {
      setExporting(false);
    }
  }

  // Where the "Other reports" footer goes: the content column, after <main>.
  const [footerHost, setFooterHost] = useState<HTMLElement | null>(null);
  useEffect(() => setFooterHost(document.getElementById('tp-main-column')), []);
  const go = (to: FigureMeta['report']) => void navigate({ to });
  // A card's rows. A row opens its transactions; the online and lesson rows
  // open their report instead (report_drill cannot list them).
  const rowsOf = (group: PanelGroup, toReport = false, noteOf?: (meta: FigureMeta) => string | undefined): BreakdownItem[] =>
    figuresIn(group).map((meta) => {
      const f = figures.get(meta.key);
      return {
        key: meta.key,
        label: label(meta.key),
        note: noteOf?.(meta),
        value: valueOf(meta, f),
        change: compare !== 'none' && f ? f : null,
        format: meta.kind === 'money' ? money : count,
        invert: meta.invert,
        // A figure the server did not send has nothing to open.
        onOpen: f ? (toReport ? () => go(meta.report) : () => setDrill(meta.key)) : undefined,
        openTitle: toReport ? undefined : tr('ws.kit.drill.title'),
      };
    });

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
      {/* The owner's pay-day reminder (0271): hidden when nothing is due. */}
      <WagesDueCard />
      {/* Now, before the period: what waits on the owner, then the floor this
          minute, are the things on the screen the date range does not govern,
          so they sit above the range control rather than among the figures
          they would otherwise seem to belong to (owner requests, 2026-09-18;
          "Needs you" moved here from Floor now, 2026-10-17). */}
      <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', marginBlockEnd: 'var(--tp-sp-4)' }}>
        <PanelNeedsYou />
        <LiveFloor blockSize="24rem" boardLinks />
      </div>
      <hr aria-hidden="true" style={{ border: 'none', borderBlockStart: '1px solid var(--tp-border)', marginBlock: '0 var(--tp-sp-4)' }} />

      <Toolbar end={<ComparisonControl mode={compare} onChange={setCompare} disabled={headlineQ.isFetching} />}>
        <DateRangeControl period={period} onChange={setPeriod} disabled={headlineQ.isFetching} now={today} />
      </Toolbar>
      {/* 0349: says when the figures include the padel desk's monthly reports
          from before the system, and why a report month the range cuts is out. */}
      <Notices notices={legacyNotices(parseLegacyHistory(headlineQ.data?.history?.period), 'panel', tr, locale)} />

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

        <BreakdownFrame title={tr('ws.owner.panel.cardsTitle')}>
          {/* One colour per card (Sait, 2026-10-19): padel green, cafe violet,
              money out rose, online light blue, lessons teal. */}
          <BreakdownCard
            tone="green"
            title={tr('ws.owner.panel.padel')}
            action={<Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/reports/courts')}>{tr('ws.owner.panel.openCourts')}</Button>}
          >
            <BreakdownRows items={rowsOf('padel')} />
          </BreakdownCard>
          <BreakdownCard
            tone="violet"
            title={tr('ws.owner.panel.cafe')}
            action={<Button size="sm" kind="ghost" iconEnd="arrowUpRight" onClick={() => go('/reports/cafe')}>{tr('ws.owner.panel.openCafe')}</Button>}
          >
            <BreakdownRows items={rowsOf('cafe')} />
          </BreakdownCard>
          <BreakdownCard tone="rose" title={tr('ws.owner.panel.losses')}>
            <BreakdownRows items={rowsOf('losses')} />
          </BreakdownCard>
          {hasOnlineFigures(figures) && (
            <BreakdownCard tone="sky" title={tr('ws.owner.panel.online')} data-testid="panel-online">
              <BreakdownRows items={rowsOf('online', true, (meta) => (meta.chainWide ? tr('ws.matches.reports.allBranches') : undefined))} />
            </BreakdownCard>
          )}
          {hasLessonFigures(figures) && (
            <BreakdownCard tone="teal" title={tr('ws.coaching.panel.title')} data-testid="panel-lessons">
              <BreakdownRows items={rowsOf('lessons', true, (meta) => (meta.key === 'owedToCoaches' ? tr('ws.coaching.panel.owedToCoachesHint') : undefined))} />
            </BreakdownCard>
          )}
        </BreakdownFrame>

        {/* A footer under the scrolling area, so the other reports are one
            click away without scrolling past every figure (Sait, 2026-10-17).
            It is portalled into the content column after <main>, not stuck
            inside it: it runs the full width to the window's edge and the
            scrollbar ends above it, whole (Sait, 2026-10-27). */}
        {footerHost && createPortal(
          <nav
            className="tp-other-reports"
            aria-label={tr('ws.owner.panel.otherReports')}
            style={{
              flex: 'none',
              display: 'flex',
              gap: 'var(--tp-sp-2)',
              flexWrap: 'wrap',
              alignItems: 'center',
              paddingBlock: 'var(--tp-sp-3)',
              paddingInline: 'var(--tp-sp-5)',
              borderBlockStart: '1px solid var(--tp-border)',
              background: 'var(--tp-surface)',
            }}
          >
            <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)', fontWeight: 600 }}>{tr('ws.owner.panel.otherReports')}</span>
            <Button size="sm" icon="chart" onClick={() => go('/reports/revenue')}>{tr('ws.owner.panel.openRevenue')}</Button>
            <Button size="sm" icon="box" onClick={() => go('/reports/stock')}>{tr('ws.owner.panel.openStock')}</Button>
            <Button size="sm" icon="users" onClick={() => go('/reports/staff')}>{tr('ws.owner.panel.openStaff')}</Button>
          </nav>,
          footerHost,
        )}
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
