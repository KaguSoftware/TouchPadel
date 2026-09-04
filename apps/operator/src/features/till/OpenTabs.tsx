/**
 * OpenTabsScreen (spec 06.12) at /till/tabs — every tab open on the floor.
 *
 * `OpenTabsBoard` is the presentational half (props in, events out) and is
 * what the component test renders in its four states; `OpenTabsScreen` wires
 * the queries, the 'floor' broadcast (with polling as the safety net), the
 * waiter-call region (build plan §0: persistent on the till AND here) and the
 * dialogs. Selecting a tab navigates to /till?tab=<id>.
 *
 * Totals: `total_iqd` is stamped by the server at settlement; while a tab is
 * open the board shows the running figure from the same tested mirror the
 * till uses (computeTabTotals) and says so.
 */
import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { useBroadcast } from '../../lib/realtime';
import { chime, StartShiftBanner } from '../../lib/audio';
import { useLocale, pickName } from '../../lib/i18n';
import { Button } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  SearchField,
  SegmentedControl,
  TabStatusIndicator,
  Toolbar,
  asyncStatus,
  type AsyncStatus,
  type Column,
} from '../../components/kit';
import { Icon } from '../../components/icons';
import { WaiterCallsPanel } from './WaiterCallsPanel';
import { NewTabDialog } from './NewTabDialog';
import { MergeTabsDialog } from './ManagerActions';
import { computeTabTotals } from './tabTotals';
import { OPEN_TABS_QUERY, TILL_MENU_QUERY, tabAnchorLabel, tabHasWebOrder, type TabListRow } from './tillData';
import { muted } from './tillStyles';

export type TabsFilter = 'table' | 'court' | 'name';

export interface BoardRow {
  id: string;
  label: string;
  table: string | null;
  court: string | null;
  guest: string | null;
  status: string;
  openedAt: string;
  /** Server-stamped total (settlement) or the running mirror while open. */
  total: number;
  stamped: boolean;
  web: boolean;
}

/** Elapsed label for a server timestamp — display only. */
export function ageLabel(openedAt: string, now: number, tr: (k: 'ws.cashier.tabs.age' | 'ws.cashier.tabs.ageHours' | 'ws.cashier.tabs.ageNow', p?: Record<string, string | number>) => string): string {
  const minutes = Math.max(0, Math.floor((now - new Date(openedAt).getTime()) / 60_000));
  if (minutes < 1) return tr('ws.cashier.tabs.ageNow');
  if (minutes < 60) return tr('ws.cashier.tabs.age', { minutes });
  return tr('ws.cashier.tabs.ageHours', { hours: Math.floor(minutes / 60), minutes: minutes % 60 });
}

/** Rows that match the facet + query; sorted by the facet's key. Pure, tested via the board test. */
export function filterBoardRows(rows: readonly BoardRow[], filter: TabsFilter, query: string): BoardRow[] {
  const q = query.trim().toLowerCase();
  const facet = (r: BoardRow): string => (filter === 'table' ? (r.table ?? '') : filter === 'court' ? (r.court ?? '') : (r.guest ?? r.label));
  const matches = (r: BoardRow): boolean => {
    if (!q) return true;
    return facet(r).toLowerCase().includes(q) || r.label.toLowerCase().includes(q);
  };
  return rows
    .filter(matches)
    .sort((a, b) => {
      const fa = facet(a);
      const fb = facet(b);
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      return fa.localeCompare(fb) || a.openedAt.localeCompare(b.openedAt);
    });
}

export function OpenTabsBoard({
  status,
  rows,
  filter,
  query,
  now,
  error,
  onFilter,
  onQuery,
  onSelect,
  onMerge,
  onOpenTab,
  onRetry,
}: {
  status: AsyncStatus;
  rows: readonly BoardRow[];
  filter: TabsFilter;
  query: string;
  now: number;
  error?: unknown;
  onFilter: (f: TabsFilter) => void;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onMerge: (survivorId: string) => void;
  onOpenTab: () => void;
  onRetry: () => void;
}) {
  const { tr, locale } = useLocale();
  const visible = useMemo(() => filterBoardRows(rows, filter, query), [rows, filter, query]);

  const columns: Column<BoardRow>[] = [
    {
      key: 'tab',
      header: tr('ws.cashier.tabs.colTab'),
      render: (r) => (
        <span style={{ display: 'grid' }}>
          <strong>
            <bdi>{r.label}</bdi>
          </strong>
          {(r.court || (r.guest && r.guest !== r.label)) && (
            <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>
              {[r.court, r.guest !== r.label ? r.guest : null].filter(Boolean).map((p, i) => (
                <span key={i}>
                  {i > 0 && ' · '}
                  <bdi>{p}</bdi>
                </span>
              ))}
            </span>
          )}
        </span>
      ),
    },
    { key: 'status', header: tr('ws.cashier.tabs.colStatus'), render: (r) => <TabStatusIndicator status={r.status} size="sm" /> },
    {
      key: 'source',
      header: tr('ws.cashier.tabs.colSource'),
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', color: r.web ? 'var(--tp-accent)' : 'var(--tp-muted-fg)' }}>
          <Icon name={r.web ? 'globe' : 'receipt'} size={13} /> {r.web ? tr('ws.cashier.tabs.sourceWeb') : tr('ws.cashier.tabs.sourceTill')}
        </span>
      ),
    },
    {
      key: 'age',
      header: tr('ws.cashier.tabs.colAge'),
      render: (r) => (
        <span style={{ display: 'grid' }}>
          <span>{ageLabel(r.openedAt, now, tr)}</span>
          <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }} dir="ltr">
            {formatTime(new Date(r.openedAt), locale)}
          </span>
        </span>
      ),
    },
    {
      key: 'total',
      header: tr('ws.cashier.tabs.colTotal'),
      numeric: true,
      render: (r) => <Money amount={r.total} strong={r.stamped} style={r.stamped ? undefined : { color: 'var(--tp-muted-fg)' }} />,
    },
    {
      key: 'actions',
      header: '',
      align: 'end',
      render: (r) => (
        <span style={{ display: 'inline-flex', gap: '0.3rem' }} onClick={(e) => e.stopPropagation()}>
          <Button size="sm" icon="merge" onClick={() => onMerge(r.id)} title={tr('ws.cashier.tabs.survivor')}>
            {tr('ws.cashier.tabs.merge')}
          </Button>
          <Button size="sm" kind="primary" iconEnd="arrowUpRight" onClick={() => onSelect(r.id)}>
            {tr('ws.cashier.tabs.select')}
          </Button>
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('ws.cashier.tabs.title')}
        subtitle={tr('ws.cashier.tabs.lead')}
        actions={
          <Button kind="primary" icon="plus" onClick={onOpenTab}>
            {tr('ws.cashier.tabs.openTab')}
          </Button>
        }
      />
      <Toolbar
        end={
          status === 'ready' ? (
            <span style={muted}>{tr('ws.cashier.tabs.count', { count: rows.length })}</span>
          ) : undefined
        }
      >
        <SegmentedControl<TabsFilter>
          value={filter}
          onChange={onFilter}
          aria-label={tr('ws.cashier.tabs.filter')}
          options={[
            { value: 'table', label: tr('ws.cashier.tabs.byTable'), icon: 'table' },
            { value: 'court', label: tr('ws.cashier.tabs.byCourt'), icon: 'court' },
            { value: 'name', label: tr('ws.cashier.tabs.byName'), icon: 'user' },
          ]}
        />
        <SearchField value={query} onChange={onQuery} placeholder={tr('ws.cashier.tabs.searchPlaceholder')} style={{ maxInlineSize: '20rem' }} />
      </Toolbar>

      <AsyncStateWrapper
        status={status}
        onRetry={onRetry}
        error={error}
        emptyContent={
          <EmptyState
            icon="receipt"
            title={tr('ws.cashier.tabs.empty')}
            body={tr('ws.cashier.tabs.emptyBody')}
            action={
              <Button kind="primary" icon="plus" onClick={onOpenTab}>
                {tr('ws.cashier.tabs.openTab')}
              </Button>
            }
          />
        }
      >
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(r) => r.id}
          onRowClick={(r) => onSelect(r.id)}
          emptyContent={tr('ws.cashier.tabs.noMatches')}
          aria-label={tr('ws.cashier.tabs.title')}
        />
        <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)', marginBlockStart: '0.5rem' }}>{tr('ws.cashier.tabs.runningTotal')}</p>
      </AsyncStateWrapper>
    </div>
  );
}

export function OpenTabsScreen() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<TabsFilter>('table');
  const [query, setQuery] = useState('');
  const [newTab, setNewTab] = useState(false);
  const [mergeSurvivor, setMergeSurvivor] = useState<TabListRow | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const tabsQ = useQuery({ ...OPEN_TABS_QUERY });
  const menuQ = useQuery({ ...TILL_MENU_QUERY });
  const taxInclusiveQ = useQuery({
    queryKey: ['taxInclusive'],
    staleTime: 300_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase.from('venue_settings').select('tax_inclusive').single();
      if (error) throw error;
      return Boolean((data as { tax_inclusive: boolean }).tax_inclusive);
    },
  });
  const taxCtx = useMemo(() => {
    if (!menuQ.data || taxInclusiveQ.data === undefined) return null;
    return {
      rateByCategory: new Map(menuQ.data.categories.map((c) => [c.id, c.tax_group?.rate_bp ?? 0])),
      taxInclusive: taxInclusiveQ.data,
    };
  }, [menuQ.data, taxInclusiveQ.data]);

  const { status: floorStatus } = useBroadcast({
    topic: 'floor',
    isPrivate: true,
    events: ['waiter_call'],
    invalidateKeys: [['tabs'], ['waiterCalls']],
    onEvent: (_e, p) => (p as { status?: string } | null)?.status === 'raised' && chime('call'),
  });

  const rows = useMemo<BoardRow[]>(
    () =>
      (tabsQ.data ?? []).map((t) => ({
        id: t.id,
        label: tabAnchorLabel(t, tr('op.till.table'), tr('op.till.forReservation')),
        table: t.table?.table_number ?? null,
        court: t.reservation?.court ? pickName(locale, t.reservation.court) : null,
        guest: t.reservation?.guest_name ?? t.label,
        status: t.status,
        openedAt: t.opened_at,
        total: t.total_iqd ?? computeTabTotals(t, taxCtx).total,
        stamped: t.total_iqd !== null,
        web: tabHasWebOrder(t),
      })),
    [tabsQ.data, taxCtx, tr, locale],
  );

  function goToTill(id: string) {
    void navigate({ to: '/till', search: { tab: id } });
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(16rem, 18rem)', gap: '1.25rem', alignItems: 'start' }}>
      <OpenTabsBoard
        status={asyncStatus(tabsQ, (d) => d.length === 0)}
        rows={rows}
        filter={filter}
        query={query}
        now={now}
        error={tabsQ.error}
        onFilter={setFilter}
        onQuery={setQuery}
        onSelect={goToTill}
        onMerge={(id) => setMergeSurvivor((tabsQ.data ?? []).find((t) => t.id === id) ?? null)}
        onOpenTab={() => setNewTab(true)}
        onRetry={() => void tabsQ.refetch()}
      />
      <aside style={{ display: 'grid', gap: '0.75rem' }}>
        <StartShiftBanner />
        <WaiterCallsPanel status={floorStatus} />
      </aside>

      {newTab && (
        <NewTabDialog
          onClose={() => setNewTab(false)}
          onOpened={(tabId) => {
            setNewTab(false);
            void queryClient.invalidateQueries({ queryKey: ['tabs'] });
            goToTill(tabId);
          }}
        />
      )}
      {mergeSurvivor && (
        <MergeTabsDialog
          survivorTabId={mergeSurvivor.id}
          survivorLabel={tabAnchorLabel(mergeSurvivor, tr('op.till.table'), tr('op.till.forReservation'))}
          onDone={() => {
            setMergeSurvivor(null);
            void queryClient.invalidateQueries({ queryKey: ['tabs'] });
          }}
          onClose={() => setMergeSurvivor(null)}
        />
      )}
    </div>
  );
}
