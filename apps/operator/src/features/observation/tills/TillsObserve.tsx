/**
 * Tills (/observation/tills) — Management's reading of the cafe floor.
 *
 * The open-tabs board is a cashier's workstation: open a tab, merge two,
 * remove an empty one, jump into the till. This board carries none of those
 * (owner call, 2026-09-13). It says what is active, what is not, and what the
 * day adds up to:
 *
 *   * the figure strip — what the open tabs carry, what was settled, voids and
 *     (today) waiter calls. Each figure once: the count of open tabs is the
 *     heading of the open-tabs list, so it is not a tile as well, and a
 *     settled count and a settled total are one tile, not two;
 *   * the tables right now (today only) — the occupied ones as cards with
 *     their running total, the free ones as one line of table numbers (a
 *     card per free table was most of the screen on a quiet night);
 *   * the open tabs, then the settled and void ones, each opening a read-only
 *     panel whose one button moves the station into the cashier workspace.
 *
 * A DAY here is a business day (the day session the tabs were opened under),
 * which is the day the till traded against and the day close counted — not the
 * calendar date, which splits a night at midnight. "Today" is the open
 * session's business day. Tabs still open from an earlier session are shown
 * on today's board too, because they are on the floor now.
 *
 * Running totals come from the same tested mirror the till uses
 * (computeTabTotals) and are labelled as running until the server stamps them.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDateTime, formatNumber, formatTime, VENUE_TZ } from '@touch/i18n';
import { supabase } from '../../../lib/supabase';
import { useBroadcast } from '../../../lib/realtime';
import { useLocale, pickName } from '../../../lib/i18n';
import { QK, fetchActiveCafeTables, fetchOpenDay, fetchVenueSettings } from '../../../lib/queries';
import { Button } from '../../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  DescriptionList,
  EmptyState,
  HeadlineFigure,
  Money,
  PageHeader,
  Panel,
  TabStatusIndicator,
  type Column,
} from '../../../components/kit';
import { Icon } from '../../../components/icons';
import { todayInTz } from '../../desk/useTradingNight';
import { MonthHeatCalendar } from '../../desk/calendar/MonthHeatCalendar';
import { ZoomStage, type ZoomLevel } from '../../desk/calendar/ZoomStage';
import { selectAllPages, useMonthCounts } from '../../desk/calendar/useMonthCounts';
import { fetchTabCounts } from '../../desk/calendar/monthFetchers';
import { OPEN_TABS_QUERY, tabAnchorLabel, tabDetailQuery, tabHasWebOrder, type TabListRow } from '../../till/tillData';
import { computeTabTotals, type TaxContext } from '../../till/tabTotals';
import { useTaxContext } from '../../till/useTaxContext';
import { ageLabel } from '../../till/OpenTabs';
import { ObserveDateBar } from '../ObserveDateBar';
import { DetailPanel, PanelSection } from '../DetailPanel';
import { splitTabs, tablesNow, tillDaySummary, type TabBoardRow } from '../observeLogic';

interface DayTabRow extends TabListRow {
  settled_at: string | null;
}

const DAY_TAB_COLUMNS = `id, status, label, opened_at, settled_at, total_iqd,
  table:cafe_tables(table_number),
  reservation:reservations!tabs_reservation_id_fkey(guest_name, court:courts!reservations_court_id_fkey(name_en, name_ar)),
  orders!orders_tab_id_fkey(source, status, order_items(id, line_total_iqd, voided, menu_item:menu_items(category_id))),
  tab_adjustments(kind, amount_iqd, order_item_id),
  payments(amount_iqd),
  day_session:day_sessions!inner(business_date)`;

export function TillsObserveScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();

  const settingsQ = useQuery({ queryKey: QK.venueSettings, queryFn: fetchVenueSettings });
  const dayQ = useQuery({ queryKey: QK.day, queryFn: fetchOpenDay });
  const tz = settingsQ.data?.timezone ?? VENUE_TZ;
  const today = dayQ.data?.business_date ?? todayInTz(tz);

  const [picked, setPicked] = useState<string | null>(null);
  const date = picked ?? today;
  const [level, setLevel] = useState<ZoomLevel>('day');
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const isToday = date === today;
  const taxCtx = useTaxContext();

  const dayTabsQ = useQuery({
    queryKey: ['observeTabs', date],
    refetchInterval: 30_000,
    queryFn: () =>
      selectAllPages<DayTabRow>((a, b) =>
        supabase
          .from('tabs')
          .select(DAY_TAB_COLUMNS)
          .is('merged_into_tab_id', null)
          .eq('day_session.business_date', date)
          .order('opened_at')
          .range(a, b) as unknown as PromiseLike<{ data: DayTabRow[] | null; error: unknown }>,
      ),
  });
  const openTabsQ = useQuery({ ...OPEN_TABS_QUERY, enabled: isToday });
  const tablesQ = useQuery({ queryKey: QK.activeCafeTables, queryFn: fetchActiveCafeTables, enabled: isToday });
  const callsQ = useQuery({
    queryKey: ['observeWaiterCalls'],
    enabled: isToday,
    refetchInterval: 30_000,
    queryFn: async () => {
      const { count, error } = await supabase.from('waiter_calls').select('id', { count: 'exact', head: true }).in('status', ['raised', 'acknowledged']);
      if (error) throw error;
      return count ?? 0;
    },
  });

  useBroadcast({ topic: 'floor', isPrivate: true, invalidateKeys: [['observeTabs'], ['tabs'], ['observeWaiterCalls'], ['tabsMonth']] });

  const month = useMonthCounts({
    queryKey: 'tabsMonth',
    date,
    timeZone: tz,
    hours: settingsQ.data?.opening_hours,
    enabled: level === 'month',
    fetchCounts: fetchTabCounts,
  });

  const rows = useMemo<TabBoardRow[]>(() => {
    const byId = new Map<string, DayTabRow | TabListRow>();
    for (const t of dayTabsQ.data ?? []) byId.set(t.id, t);
    // Still open from an earlier session: on the floor now, so on today's board.
    if (isToday) for (const t of openTabsQ.data ?? []) if (!byId.has(t.id)) byId.set(t.id, t);
    return [...byId.values()].map((t) => ({
      id: t.id,
      label: tabAnchorLabel(t, tr('op.till.table'), tr('op.till.forReservation')),
      table: t.table?.table_number ?? null,
      court: t.reservation?.court ? pickName(locale, t.reservation.court) : null,
      guest: t.reservation?.guest_name ?? t.label,
      status: t.status,
      openedAt: t.opened_at,
      settledAt: 'settled_at' in t ? t.settled_at : null,
      total: t.total_iqd ?? computeTabTotals(t, taxCtx).total,
      stamped: t.total_iqd != null,
      web: tabHasWebOrder(t),
    }));
  }, [dayTabsQ.data, openTabsQ.data, isToday, taxCtx, tr, locale]);

  const summary = useMemo(() => tillDaySummary(rows), [rows]);
  const { active, inactive } = useMemo(() => splitTabs(rows), [rows]);
  const tables = useMemo(() => tablesNow(tablesQ.data ?? [], rows), [tablesQ.data, rows]);
  const opened = rows.find((r) => r.id === openId) ?? null;
  const updatedAt = dayTabsQ.dataUpdatedAt ? new Date(dayTabsQ.dataUpdatedAt) : null;

  const status = dayTabsQ.isError && !dayTabsQ.data ? 'error' : dayTabsQ.data ? 'ready' : 'loading';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minBlockSize: '100%' }}>
      <PageHeader
        style={{ flexShrink: 0 }}
        title={tr('ws.owner.observe.tills.title')}
        subtitle={tr('ws.owner.observe.tills.lead')}
        actions={
          <>
            {updatedAt && (
              <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.manager.ops.updated', { time: formatTime(updatedAt, locale) })}</span>
            )}
            <Button
              kind="ghost"
              icon="refresh"
              busy={dayTabsQ.isFetching && dayTabsQ.data !== undefined}
              onClick={() => {
                for (const key of [['observeTabs'], ['tabs'], ['observeWaiterCalls'], ['tabsMonth']]) void queryClient.invalidateQueries({ queryKey: key });
              }}
            >
              {tr('ws.kit.actions.refresh')}
            </Button>
          </>
        }
      >
        <ObserveDateBar date={date} today={today} level={level} onDate={setPicked} onLevel={setLevel} keysDisabled={openId !== null} />
      </PageHeader>

      <ZoomStage level={level} focusDate={date} style={{ flex: 1 }}>
        {level === 'month' ? (
          <AsyncStateWrapper status={month.isError ? 'error' : 'ready'} error={month.error} onRetry={month.refetch}>
            <MonthHeatCalendar
              date={date}
              today={today}
              counts={month.counts}
              max={month.max}
              loading={month.isPending}
              countLabel={(count) => tr(count === 1 ? 'ws.kit.calendar.tabsOne' : 'ws.kit.calendar.tabs', { count })}
              onPick={(d) => {
                setPicked(d);
                setLevel('day');
              }}
            />
          </AsyncStateWrapper>
        ) : (
          <AsyncStateWrapper status={status} error={dayTabsQ.error} onRetry={() => void dayTabsQ.refetch()}>
            <div style={{ display: 'grid', gap: 'var(--tp-sp-4)', paddingBlockEnd: 'var(--tp-sp-4)' }}>
              <div style={{ display: 'grid', gap: 'var(--tp-sp-3)', gridTemplateColumns: 'repeat(auto-fit, minmax(10.5rem, 1fr))' }}>
                <HeadlineFigure
                  label={tr('ws.owner.observe.tills.figures.running')}
                  value={<Money amount={summary.runningIqd} />}
                  hint={
                    summary.awaiting > 0
                      ? tr('ws.owner.observe.tills.figures.activeHint', { count: formatNumber(summary.awaiting, locale) })
                      : tr('ws.owner.observe.tills.figures.runningHint')
                  }
                />
                <HeadlineFigure
                  label={tr('ws.owner.observe.tills.figures.settled')}
                  value={<Money amount={summary.settledIqd} />}
                  hint={tr('ws.owner.observe.tills.figures.settledHint', { count: formatNumber(summary.settled, locale) })}
                />
                <HeadlineFigure label={tr('ws.owner.observe.tills.figures.voided')} value={formatNumber(summary.voided, locale)} />
                {isToday && (
                  <HeadlineFigure
                    label={tr('ws.owner.observe.tills.figures.calls')}
                    value={callsQ.data === undefined ? '—' : formatNumber(callsQ.data, locale)}
                    tone={(callsQ.data ?? 0) > 0 ? 'warn' : 'neutral'}
                    hint={tr('ws.owner.observe.tills.figures.callsHint')}
                  />
                )}
              </div>

              {isToday && tables.length > 0 && <TablesNow tables={tables} now={now} onOpen={setOpenId} />}

              <TabsPanel
                title={tr('ws.owner.observe.tills.active.title')}
                empty={tr('ws.owner.observe.tills.active.empty')}
                rows={active}
                now={now}
                onOpen={setOpenId}
                closed={false}
              />
              <TabsPanel
                title={tr('ws.owner.observe.tills.inactive.title')}
                empty={tr('ws.owner.observe.tills.inactive.empty')}
                rows={inactive}
                now={now}
                onOpen={setOpenId}
                closed
              />
            </div>
          </AsyncStateWrapper>
        )}
      </ZoomStage>

      {opened && <TabPanel row={opened} taxCtx={taxCtx} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function TablesNow({ tables, now, onOpen }: { tables: ReturnType<typeof tablesNow>; now: number; onOpen: (id: string) => void }) {
  const { tr, locale } = useLocale();
  const occupied = tables.filter((t) => t.tabs.length > 0);
  const free = tables.filter((t) => t.tabs.length === 0);
  return (
    <Panel
      title={tr('ws.owner.observe.tills.tables.title')}
      actions={
        <span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
          {tr('ws.owner.observe.tills.tables.summary', { occupied: formatNumber(occupied.length, locale), total: formatNumber(tables.length, locale) })}
        </span>
      }
    >
      {occupied.length === 0 ? (
        <p style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.observe.tills.tables.noneOccupied')}</p>
      ) : (
        <div style={{ display: 'grid', gap: 'var(--tp-sp-2)', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))' }}>
          {occupied.map((t) => {
            const first = t.tabs[0]!;
            return (
              <button
                key={t.tableNumber}
                type="button"
                className="tp-tile"
                onClick={() => onOpen(first.id)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'minmax(0, 1fr)',
                  gap: 'var(--tp-sp-1)',
                  textAlign: 'start',
                  font: 'inherit',
                  color: 'inherit',
                  padding: 'var(--tp-sp-2-5, 0.6rem)',
                  borderRadius: 'var(--tp-radius-ctl)',
                  border: '1px solid var(--tp-accent)',
                  background: 'var(--tp-accent-soft)',
                  cursor: 'pointer',
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1)', minInlineSize: 0 }}>
                  <Icon name="table" size={14} style={{ color: 'var(--tp-accent-soft-fg)', flexShrink: 0 }} />
                  <strong style={{ minInlineSize: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {tr('op.till.table')} <bdi>{t.tableNumber}</bdi>
                  </strong>
                </span>
                <Money amount={t.runningIqd} strong />
                <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-accent-soft-fg)' }}>
                  {t.tabs.length > 1
                    ? tr('ws.owner.observe.tills.tables.tabsCount', { count: formatNumber(t.tabs.length, locale) })
                    : ageLabel(first.openedAt, now, (k, p) => tr(k, p))}
                </span>
              </button>
            );
          })}
        </div>
      )}
      {free.length > 0 && <FreeTables numbers={free.map((t) => t.tableNumber)} spaced />}
    </Panel>
  );
}

/** How many free table numbers are printed before the rest fold into a count. */
const FREE_TABLES_SHOWN = 40;

/** Free tables as their numbers on one wrapping line: nothing else is true of them. */
function FreeTables({ numbers, spaced }: { numbers: string[]; spaced: boolean }) {
  const { tr, locale } = useLocale();
  const rest = numbers.length - FREE_TABLES_SHOWN;
  return (
    <div style={{ marginBlockStart: spaced ? 'var(--tp-sp-3)' : 0, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)' }}>
      <span style={{ fontWeight: 600, marginInlineEnd: 'var(--tp-sp-1)' }}>{tr('ws.owner.observe.tills.tables.freeTables')}</span>
      {numbers.slice(0, FREE_TABLES_SHOWN).map((n) => (
        <bdi
          key={n}
          style={{
            paddingInline: 'var(--tp-sp-1-5, 0.4rem)',
            borderRadius: 'var(--tp-radius-ctl)',
            border: '1px solid var(--tp-border)',
            color: 'var(--tp-muted-fg)',
            maxInlineSize: '12rem',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {n}
        </bdi>
      ))}
      {rest > 0 && <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.observe.tills.tables.more', { count: formatNumber(rest, locale) })}</span>}
    </div>
  );
}

function TabsPanel({
  title,
  empty,
  rows,
  now,
  onOpen,
  closed,
}: {
  title: string;
  empty: string;
  rows: readonly TabBoardRow[];
  now: number;
  onOpen: (id: string) => void;
  closed: boolean;
}) {
  const { tr, locale } = useLocale();
  const columns: Column<TabBoardRow>[] = [
    {
      key: 'tab',
      header: tr('ws.owner.observe.tills.cols.tab'),
      render: (r) => (
        <span style={{ display: 'grid' }}>
          <strong>
            <bdi>{r.label}</bdi>
          </strong>
          {/* On the open list every row is open, so a status column said
              "Open" eight times; only the one state that differs is named. */}
          {!closed && r.status === 'awaiting_payment' && (
            <span style={{ justifySelf: 'start', marginBlock: 'var(--tp-sp-0)' }}>
              <TabStatusIndicator status={r.status} size="sm" />
            </span>
          )}
          {(r.court || (r.guest && r.guest !== r.label)) && (
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }}>
              <bdi>{[r.court, r.guest !== r.label ? r.guest : null].filter(Boolean).join(' · ')}</bdi>
            </span>
          )}
        </span>
      ),
    },
    ...(closed
      ? [{ key: 'status', header: tr('ws.owner.observe.tills.cols.status'), render: (r: TabBoardRow) => <TabStatusIndicator status={r.status} size="sm" /> }]
      : []),
    {
      key: 'source',
      header: tr('ws.owner.observe.tills.cols.source'),
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: r.web ? 'var(--tp-accent)' : 'var(--tp-muted-fg)' }}>
          <Icon name={r.web ? 'globe' : 'receipt'} size={13} /> {r.web ? tr('ws.cashier.tabs.sourceWeb') : tr('ws.cashier.tabs.sourceTill')}
        </span>
      ),
    },
    {
      key: 'opened',
      header: tr('ws.owner.observe.tills.cols.opened'),
      render: (r) =>
        closed ? (
          <bdi>{formatTime(new Date(r.openedAt), locale)}</bdi>
        ) : (
          <span style={{ display: 'grid' }}>
            <span>{ageLabel(r.openedAt, now, (k, p) => tr(k, p))}</span>
            <span style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-xs)' }} dir="ltr">
              {formatTime(new Date(r.openedAt), locale)}
            </span>
          </span>
        ),
    },
    ...(closed
      ? [
          {
            key: 'settled',
            header: tr('ws.owner.observe.tills.cols.closed'),
            render: (r: TabBoardRow) => (r.settledAt ? <bdi>{formatTime(new Date(r.settledAt), locale)}</bdi> : '—'),
          },
        ]
      : []),
    {
      key: 'total',
      header: tr('ws.owner.observe.tills.cols.total'),
      numeric: true,
      render: (r) => <Money amount={r.total} strong={r.stamped} style={r.stamped ? undefined : { color: 'var(--tp-muted-fg)' }} />,
    },
  ];
  return (
    <Panel title={title} actions={<span style={{ fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>{formatNumber(rows.length, locale)}</span>}>
      {rows.length === 0 ? (
        <EmptyState compact kind="nothingToDo" icon="receipt" title={empty} />
      ) : (
        <DataTable columns={columns} rows={rows} rowKey={(r) => r.id} onRowClick={(r) => onOpen(r.id)} dense aria-label={title} />
      )}
    </Panel>
  );
}

function TabPanel({ row, taxCtx, onClose }: { row: TabBoardRow; taxCtx: TaxContext | null; onClose: () => void }) {
  const { tr, locale } = useLocale();
  const tabQ = useQuery({ ...tabDetailQuery(row.id) });
  const tab = tabQ.data;
  const totals = useMemo(() => computeTabTotals(tab ?? null, taxCtx), [tab, taxCtx]);
  const lines = (tab?.orders ?? []).flatMap((o) => o.order_items.map((l) => ({ ...l, orderVoided: o.status === 'voided' })));
  const stamped = tab?.total_iqd != null;

  return (
    <DetailPanel
      eyebrow={tr('ws.owner.observe.tills.peek.tab')}
      title={<bdi>{row.label}</bdi>}
      status={
        <span>
          <TabStatusIndicator status={row.status} />
        </span>
      }
      onClose={onClose}
      target={{ workspace: 'cashier', to: '/till', search: { tab: row.id } }}
    >
      <DescriptionList
        columns={2}
        items={[
          { label: tr('ws.owner.observe.tills.peek.where'), value: <bdi>{[row.table ? `${tr('op.till.table')} ${row.table}` : null, row.court, row.guest !== row.label ? row.guest : null].filter(Boolean).join(' · ') || row.label}</bdi> },
          { label: tr('ws.owner.observe.tills.cols.source'), value: row.web ? tr('ws.cashier.tabs.sourceWeb') : tr('ws.cashier.tabs.sourceTill') },
          { label: tr('ws.owner.observe.tills.cols.opened'), value: <bdi>{formatDateTime(new Date(row.openedAt), locale)}</bdi> },
          { label: tr('ws.owner.observe.tills.cols.closed'), value: row.settledAt ? <bdi>{formatDateTime(new Date(row.settledAt), locale)}</bdi> : '—' },
        ]}
      />

      <AsyncStateWrapper status={tabQ.isError ? 'error' : tab ? 'ready' : 'loading'} error={tabQ.error} onRetry={() => void tabQ.refetch()}>
        <PanelSection title={tr('ws.owner.observe.tills.peek.items')}>
          {lines.length === 0 ? (
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.observe.tills.peek.noItems')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1-5, 0.4rem)' }}>
              {lines.map((l) => {
                const voided = l.voided || l.orderVoided;
                return (
                  <li key={l.id} style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'baseline', opacity: voided ? 0.55 : 1 }}>
                    <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--tp-muted-fg)', minInlineSize: '1.75rem' }}>{formatNumber(l.qty, locale)}×</span>
                    <span style={{ flex: 1, minInlineSize: 0, textDecoration: voided ? 'line-through' : undefined }}>
                      <bdi>{pickName(locale, l.menu_item)}</bdi>
                      {l.variant && (
                        <span style={{ color: 'var(--tp-muted-fg)' }}>
                          {' '}
                          · <bdi>{pickName(locale, l.variant)}</bdi>
                        </span>
                      )}
                      {l.order_item_modifiers.length > 0 && (
                        <span style={{ display: 'block', fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>
                          <bdi>{l.order_item_modifiers.map((m) => pickName(locale, m.modifier)).join(', ')}</bdi>
                        </span>
                      )}
                      {voided && <span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-danger-fg)', marginInlineStart: 'var(--tp-sp-1)' }}>{tr('ws.owner.observe.tills.peek.voided')}</span>}
                    </span>
                    <Money amount={l.line_total_iqd} style={{ textDecoration: voided ? 'line-through' : undefined }} />
                  </li>
                );
              })}
            </ul>
          )}
        </PanelSection>

        {tab && tab.court_iqd > 0 && (
          <PanelSection title={tr('ws.owner.observe.tills.peek.court')}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>{tr('ws.owner.observe.tills.peek.courtFee')}</span>
              <Money amount={tab.court_iqd} />
            </div>
          </PanelSection>
        )}

        <PanelSection title={tr('ws.owner.observe.tills.peek.totals')}>
          <DescriptionList
            columns={2}
            items={[
              { label: tr('ws.owner.observe.tills.peek.subtotal'), value: <Money amount={stamped ? (tab?.subtotal_iqd ?? totals.subtotal) : totals.subtotal} />, numeric: true },
              { label: tr('ws.owner.observe.tills.peek.discount'), value: <Money amount={totals.discount} />, numeric: true },
              { label: tr('ws.owner.observe.tills.peek.total'), value: <Money amount={stamped ? tab!.total_iqd : totals.total} strong />, numeric: true },
              { label: tr('ws.owner.observe.tills.peek.paid'), value: <Money amount={totals.paid} />, numeric: true },
            ]}
          />
          {!stamped && <p style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.owner.observe.tills.peek.runningNote')}</p>}
        </PanelSection>

        <PanelSection title={tr('ws.owner.observe.tills.peek.payments')}>
          {(tab?.payments ?? []).length === 0 ? (
            <p style={{ color: 'var(--tp-muted-fg)', fontSize: 'var(--tp-fs-sm)' }}>{tr('ws.owner.observe.tills.peek.noPayments')}</p>
          ) : (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-1)' }}>
              {(tab?.payments ?? []).map((p) => (
                <li key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)' }}>
                  <span>{p.method === 'cash' || p.method === 'card' ? tr(`ws.cashier.payment.${p.method}`) : p.method}</span>
                  <Money amount={p.amount_iqd} />
                </li>
              ))}
            </ul>
          )}
        </PanelSection>
      </AsyncStateWrapper>
    </DetailPanel>
  );
}
