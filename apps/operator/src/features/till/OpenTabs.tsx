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
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatTime, type MessageKey } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { AppRpcError } from '../../lib/appRpc';
import { errorToMessageKey } from '../../lib/errors';
import { compareTableNumbers } from '../../lib/queries';
import { useBroadcast } from '../../lib/realtime';
import { chime, StartShiftBanner } from '../../lib/audio';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, type ReasonCode } from '../../components/ui';
import {
  AsyncStateWrapper,
  DataTable,
  EmptyState,
  Money,
  PageHeader,
  ReasonCodePrompt,
  SearchField,
  SegmentedControl,
  StatusBadge,
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
import { OPEN_TABS_QUERY, TILL_MENU_QUERY, tabAnchorLabel, tabHasWebOrder, tabRemovalBlocker, type TabListRow, type TabRemovalBlocker } from './tillData';
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
  /**
   * What holds this tab, or null when nothing does and the status badge may
   * offer to remove it (0085). Named rather than boolean so the board can say
   * WHICH thing holds it — see tabRemovalBlocker.
   */
  blocker: TabRemovalBlocker | null;
}

/**
 * The message for a refused removal. A TAB_NOT_EMPTY carries the branch that
 * fired in `detail`, so the answer after the press is the same sentence the
 * board would have shown before it; anything else falls through to the shared
 * code-to-message map.
 */
export function removalErrorKey(error: unknown): MessageKey {
  if (error instanceof AppRpcError && error.code === 'TAB_NOT_EMPTY') {
    const detail = error.details === 'reservation' ? 'reservation' : error.details === 'payments' ? 'payments' : error.details === 'adjustments' ? 'adjustments' : error.details === 'orders' ? 'orders' : null;
    if (detail) return `ws.cashier.tabs.removeBlocked.${detail}` as MessageKey;
  }
  return errorToMessageKey(error);
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
  // `table_number` is text, so a plain localeCompare orders the board 1, 10,
  // 11, 12, 2 — the numeric collator counts instead. Court and guest are prose
  // and stay on the plain comparison.
  const compare = filter === 'table' ? compareTableNumbers : (x: string, y: string) => x.localeCompare(y);
  return rows
    .filter(matches)
    .sort((a, b) => {
      const fa = facet(a);
      const fb = facet(b);
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      return compare(fa, fb) || a.openedAt.localeCompare(b.openedAt);
    });
}

/**
 * The Status cell, which doubles as the remove control (0085).
 *
 * A tab opened on the wrong table used to have no way off the board: settling
 * it for zero invents a sale and merging it invents a group. So the badge that
 * says "Open" is also the button that takes it back — press once to arm,
 * confirm to remove. Two presses, both on the thing already being looked at,
 * and no dialog: this is the screen a cashier uses standing up.
 *
 * The blocked case is deliberately reachable rather than dead. A badge that
 * simply does not respond teaches nothing, so pressing a held tab answers the
 * question instead — one red line, in the cell, naming the thing that holds it
 * (tabRemovalBlocker) and the move that clears it. That is also where a server
 * refusal lands, in the same words for the same cause:
 * the board's copy of a tab is a cached read, so a waiter's order can arrive
 * between the render and the press, and the answer to that race must appear in
 * exactly the same place as the answer to the ordinary case.
 *
 * The refusal is rendered by BOTH branches, and that is the whole point. It
 * used to hang off the resting branch alone, which is the one state a refusal
 * can never be seen in: a refused removal leaves the row armed and removable,
 * so the confirm branch re-rendered and the message the server sent — a stale
 * day session, a tab that gained an order a second ago — was dropped on the
 * floor. The cashier pressed "Yes, remove", the tab stayed, and the till said
 * nothing at all.
 */
function TabStatusCell({
  row,
  armed,
  busy,
  error,
  onArm,
  onConfirm,
}: {
  row: BoardRow;
  armed: boolean;
  busy: boolean;
  error: unknown;
  onArm: (next: boolean) => void;
  onConfirm: () => void;
}) {
  const { tr } = useLocale();
  const warn: CSSProperties = {
    display: 'inline-flex',
    alignItems: 'flex-start',
    gap: '0.3rem',
    color: 'var(--tp-danger-fg)',
    fontSize: 'var(--tp-fs-xs)',
    lineHeight: 1.3,
    maxInlineSize: '12rem',
    textWrap: 'balance',
  };

  const refusal = error != null && (
    <span role="alert" style={warn}>
      <Icon name="alert" size={12} style={{ marginBlockStart: '0.15rem', flexShrink: 0 }} />
      {tr(removalErrorKey(error))}
    </span>
  );

  if (armed && row.blocker === null) {
    return (
      <span style={{ display: 'grid', justifyItems: 'start', gap: '0.3rem' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', flexWrap: 'wrap' }}>
          <StatusBadge tone="danger" icon="trash" size="sm" label={tr('ws.cashier.tabs.removeAsk')} />
          <Button size="sm" kind="danger" busy={busy} onClick={onConfirm}>
            {tr('ws.cashier.tabs.removeConfirm')}
          </Button>
          <Button size="sm" disabled={busy} onClick={() => onArm(false)}>
            {tr('ws.cashier.tabs.removeKeep')}
          </Button>
        </span>
        {refusal}
      </span>
    );
  }

  return (
    <span style={{ display: 'grid', justifyItems: 'start', gap: '0.3rem' }}>
      <button
        type="button"
        onClick={() => onArm(!armed)}
        // The badge is the accessible name ("Open"); the hidden span appends
        // what pressing it does, because a control whose whole name is its
        // current state announces as a label rather than as a button.
        style={{ border: 0, background: 'none', padding: 0, margin: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}
      >
        <TabStatusIndicator status={row.status} size="sm" />
        <span className="tp-sr-only"> — {tr('ws.cashier.tabs.removeArm')}</span>
      </button>
      {armed && row.blocker !== null && (
        <span role="alert" style={warn}>
          <Icon name="alert" size={12} style={{ marginBlockStart: '0.15rem', flexShrink: 0 }} />
          {tr(`ws.cashier.tabs.removeBlocked.${row.blocker}`)}
        </span>
      )}
      {refusal}
    </span>
  );
}

/**
 * Why a tab is being taken back. The same picker a cancelled booking goes
 * through (CANCEL_REASONS on the court desk), minus the weather — a tab is
 * opened indoors and no rain ever cancelled one — and plus `changed_mind`,
 * which is the guest who sat down, read the menu and left.
 */
const TAB_REMOVE_REASONS = ['staff_error', 'duplicate', 'changed_mind', 'customer_request', 'other'] as const satisfies readonly ReasonCode[];

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
  onRemoveTab,
  removingId,
  removeError,
  onDismissRemoveError,
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
  /**
   * Confirmed removal of an empty tab (0085), with the reason the cashier
   * chose (0086) — 'code' or 'code: note', the shape the audit log already
   * takes from a cancelled booking.
   */
  onRemoveTab: (id: string, reason: string) => void;
  /** The tab whose cancel_tab call is in flight. */
  removingId?: string | null;
  /** A refusal from the server, against the row it belongs to. */
  removeError?: { id: string; error: unknown } | null;
  /**
   * Drop a refusal that is no longer being answered. A refusal describes ONE
   * press against ONE snapshot of a tab; without this it outlived both, so a
   * tab refused once wore the message for the rest of the shift — through
   * Keep, through arming another row, through every 30-second refetch — and
   * read as the board's permanent opinion of that tab rather than as the
   * answer to something the cashier just did.
   */
  onDismissRemoveError: () => void;
}) {
  const { tr, locale } = useLocale();
  const visible = useMemo(() => filterBoardRows(rows, filter, query), [rows, filter, query]);
  /*
   * Which row is asking "remove?". One id, not a set: two tabs mid-confirm at
   * once is not a state a cashier ever wants, and arming a second row is the
   * clearest possible way to say they are done with the first.
   */
  const [armedId, setArmedId] = useState<string | null>(null);
  /*
   * The tab whose reason is being asked for. Confirming the row does not
   * remove it — it opens the same reason picker a cancelled booking goes
   * through, because a tab that vanishes from the board with no recorded
   * reason is the one destructive act in the till the audit log could not
   * explain the next morning.
   */
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  // Escape backs out of the confirm, the way it backs out of every dialog
  // here. Not while the reason prompt is up: that dialog owns its own Escape,
  // and disarming the row underneath it would pull the ground out from under
  // the thing being answered.
  useEffect(() => {
    if (armedId === null || reasonFor !== null) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setArmedId(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [armedId, reasonFor]);
  /*
   * The tab leaving the board IS the acknowledgement — the query refetches
   * after the RPC and a voided tab is not in the open-tabs select. Closing on
   * that rather than on the call resolving keeps the prompt busy until the
   * board actually agrees the tab is gone, and leaves it open (with the
   * server's message inside it) when the removal was refused.
   */
  useEffect(() => {
    if (reasonFor !== null && !rows.some((r) => r.id === reasonFor)) {
      setReasonFor(null);
      setArmedId(null);
    }
  }, [rows, reasonFor]);

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
    {
      key: 'status',
      header: tr('ws.cashier.tabs.colStatus'),
      // No stopPropagation: DataTable's own CELL_CONTROL guard already keeps a
      // <button> inside a cell from firing the row's navigate, by click and by
      // Enter — so arming a removal cannot also open the tab it is about to
      // remove.
      render: (r) => (
        <TabStatusCell
          row={r}
          armed={armedId === r.id}
          busy={removingId === r.id}
          error={removeError?.id === r.id ? removeError.error : null}
          onArm={(next) => {
            setArmedId(next ? r.id : null);
            setReasonFor(null);
            onDismissRemoveError();
          }}
          onConfirm={() => setReasonFor(r.id)}
        />
      ),
    },
    {
      key: 'source',
      header: tr('ws.cashier.tabs.colSource'),
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', color: r.web ? 'var(--tp-accent)' : 'var(--tp-muted-fg)' }}>
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
        <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)' }} onClick={(e) => e.stopPropagation()}>
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
        <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)', marginBlockStart: 'var(--tp-sp-2)' }}>{tr('ws.cashier.tabs.runningTotal')}</p>
      </AsyncStateWrapper>

      {reasonFor !== null && (
        <ReasonCodePrompt
          action={tr('ws.cashier.tabs.removeAction')}
          reasonCodes={TAB_REMOVE_REASONS}
          busy={removingId === reasonFor}
          error={removeError?.id === reasonFor ? removeError.error : undefined}
          onSubmit={(code, note) => onRemoveTab(reasonFor, note ? `${code}: ${note}` : code)}
          onCancel={() => setReasonFor(null)}
        >
          {/* Rulebook: the consequence is stated BEFORE the act, not after. */}
          <p style={{ marginBlockEnd: 'var(--tp-sp-3)' }}>
            {tr('ws.cashier.tabs.removeConsequence', { name: rows.find((r) => r.id === reasonFor)?.label ?? '' })}
          </p>
        </ReasonCodePrompt>
      )}
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
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ id: string; error: unknown } | null>(null);

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
        // `!= null` so the flag agrees with the `??` above: an undefined
        // total_iqd (a row cached before the column joined the select) is a
        // running figure, not a settled one, and must not render as stamped.
        stamped: t.total_iqd != null,
        web: tabHasWebOrder(t),
        blocker: tabRemovalBlocker(t),
      })),
    [tabsQ.data, taxCtx, tr, locale],
  );

  function goToTill(id: string) {
    void navigate({ to: '/till', search: { tab: id } });
  }

  /**
   * app.cancel_tab, not mutate(): removing a tab is an online-only correction
   * (the server re-checks emptiness under the row lock, which a queued replay
   * minutes later cannot do meaningfully) and it takes the same direct-RPC
   * route as merge_tabs, the other tab-shape change on this screen.
   */
  async function removeTab(id: string, reason: string) {
    setRemovingId(id);
    setRemoveError(null);
    try {
      await appRpc('cancel_tab', { p_tab_id: id, p_reason_code: reason });
      // Awaited on purpose: ['tabs'] is mounted here, so this resolves only
      // once the board has refetched without the cancelled tab — which is the
      // signal the reason prompt closes on, and the reason `removingId` must
      // still be set while it happens.
      await queryClient.invalidateQueries({ queryKey: ['tabs'] });
    } catch (e) {
      // Refusals belong in the row, not in a toast: the cashier is looking at
      // the tab they pressed, and the answer is about that tab.
      setRemoveError({ id, error: e });
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(16rem, 18rem)', gap: 'var(--tp-sp-5)', alignItems: 'start' }}>
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
        onRemoveTab={(id, reason) => void removeTab(id, reason)}
        removingId={removingId}
        removeError={removeError}
        onDismissRemoveError={() => setRemoveError(null)}
      />
      <aside style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
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
