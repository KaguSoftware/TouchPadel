/**
 * OpenTabsScreen (spec 06.12) at /till/tabs — every tab open on the floor.
 *
 * `OpenTabsBoard` is the presentational half (props in, events out) and is
 * what the component test renders in its four states; `OpenTabsScreen` wires
 * the queries, the 'floor' broadcast (with polling as the safety net), the
 * waiter-call strip (build plan §0: on the till AND here, shown while a call
 * waits) and the dialogs. Selecting a tab navigates to /till?tab=<id>.
 *
 * WHAT CHANGED, AND WHY
 *
 *  - The subtitle is the floor right now ("Open: 8 · Waiting for payment: 1")
 *    rather than a sentence describing the screen, and the count is not
 *    printed a second time at the end of the toolbar.
 *  - Status was a column that read "Open" on every row — the board only lists
 *    open tabs — and the badge was secretly also the remove button, which
 *    nobody would find. The one status that differs, waiting for payment, is
 *    a badge on the tab's own cell; removing is a labelled button, offered on
 *    exactly the tabs that can be removed (nothing on them yet), which the
 *    tab's cell also says.
 *  - Source was a column that read "Till" on most rows. A web order is now a
 *    tag beside the tab name; the default says nothing and is not printed.
 *  - Age reads in hours and days ("1 d 5 h") and never wraps; the clock time
 *    under it carries the date when the tab was opened on an earlier day.
 *  - Every row carried a blue "Open on the till" button, so eight rows were
 *    eight primary buttons with no hierarchy. The row itself opens the tab;
 *    its button is an ordinary one with the arrow.
 *  - The table/court/name control only ever SORTED (and narrowed the search to
 *    one field, which read like a filter that hid rows). It is now "Sort by";
 *    the search matches table, court, guest and tab name at once.
 *
 * Totals: `total_iqd` is stamped by the server at settlement; while a tab is
 * open the board shows the running figure from the same tested mirror the
 * till uses (computeTabTotals). That mirror has no court fee, so when a
 * booking tab is on the board a line says the fee is added at payment.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatDateTime, formatNumber, formatTime, type MessageKey } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { AppRpcError } from '../../lib/appRpc';
import { mutate } from '../../lib/mutate';
import { resultErrorCode } from '../../lib/queueResults';
import { usePendingResults } from '../../lib/pendingResults';
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
import { formatElapsed } from './elapsed';
import { OPEN_TABS_QUERY, TILL_MENU_QUERY, tabAnchorLabel, tabHasWebOrder, tabRemovalBlocker, type TabListRow, type TabRemovalBlocker } from './tillData';
import { muted } from './tillStyles';

export type TabsSort = 'table' | 'court' | 'name';

export interface BoardRow {
  id: string;
  label: string;
  table: string | null;
  court: string | null;
  /** The court itself, for grouping — a name is a label, not a key. */
  courtId: string | null;
  guest: string | null;
  status: string;
  openedAt: string;
  /** Server-stamped total (settlement) or the running mirror while open. */
  total: number;
  stamped: boolean;
  web: boolean;
  /**
   * What holds this tab, or null when nothing does and the board may offer to
   * remove it (0085). Named rather than boolean so a server refusal can say
   * WHICH thing holds it — see tabRemovalBlocker.
   */
  blocker: TabRemovalBlocker | null;
}

/**
 * The message for a refused removal. A TAB_NOT_EMPTY carries the branch that
 * fired in `detail`, so the answer names the thing that holds the tab;
 * anything else falls through to the shared code-to-message map.
 */
export function removalErrorKey(error: unknown): MessageKey {
  if (error instanceof AppRpcError && error.code === 'TAB_NOT_EMPTY') {
    const detail = error.details === 'reservation' ? 'reservation' : error.details === 'payments' ? 'payments' : error.details === 'adjustments' ? 'adjustments' : error.details === 'orders' ? 'orders' : null;
    if (detail) return `ws.cashier.tabs.removeBlocked.${detail}` as MessageKey;
  }
  return errorToMessageKey(error);
}

/** Elapsed label for a server timestamp — display only. See elapsed.ts. */
export const ageLabel = formatElapsed;

/**
 * Courts carrying more than one open tab, and what those tabs come to together.
 *
 * A court legitimately has several live tabs at once — `tabs` has no court
 * column, the link is through the reservation, and the only uniqueness index is
 * one live tab per RESERVATION (0106). So an 18:00 and a 19:00 booking on Court
 * 1 are two tabs, and the board showed two unrelated figures with nothing
 * saying what the court owed altogether (reported 2026-09-23).
 *
 * Only courts with TWO OR MORE tabs are returned: a court with one tab has
 * nothing to add up, and giving it a heading would push every row down a line
 * to repeat a number already in the row.
 *
 * The totals are the board's own `total` — the same figure the column shows,
 * so the two can never disagree. Court FEES are outside both (the board says so
 * in its footnote); this adds up bills, not bookings.
 */
export function courtTotals(rows: readonly BoardRow[]): Map<string, { total: number; count: number }> {
  const byCourt = new Map<string, { total: number; count: number }>();
  for (const r of rows) {
    if (r.courtId === null) continue;
    const seen = byCourt.get(r.courtId);
    if (seen) {
      seen.total += r.total;
      seen.count += 1;
    } else {
      byCourt.set(r.courtId, { total: r.total, count: 1 });
    }
  }
  for (const [id, v] of byCourt) if (v.count < 2) byCourt.delete(id);
  return byCourt;
}

/**
 * Rows that match the query, ordered by the chosen key. The query matches
 * table, court, guest and the tab's own name together — a cashier typing "Ali"
 * or "7" should not first have to say which of those it is. Pure, tested.
 */
export function filterBoardRows(rows: readonly BoardRow[], sort: TabsSort, query: string): BoardRow[] {
  const q = query.trim().toLowerCase();
  const key = (r: BoardRow): string => (sort === 'table' ? (r.table ?? '') : sort === 'court' ? (r.court ?? '') : (r.guest ?? r.label));
  const matches = (r: BoardRow): boolean => {
    if (!q) return true;
    return [r.table, r.court, r.guest, r.label].some((v) => (v ?? '').toLowerCase().includes(q));
  };
  // `table_number` is text, so a plain localeCompare orders the board 1, 10,
  // 11, 12, 2 — the numeric collator counts instead. Court and guest are prose
  // and stay on the plain comparison.
  const compare = sort === 'table' ? compareTableNumbers : (x: string, y: string) => x.localeCompare(y);
  return rows
    .filter(matches)
    .sort((a, b) => {
      const fa = key(a);
      const fb = key(b);
      if (fa && !fb) return -1;
      if (!fa && fb) return 1;
      return compare(fa, fb) || a.openedAt.localeCompare(b.openedAt);
    });
}

/** "Open: 8 · Waiting for payment: 1" — the second half only when it is not zero. */
export function boardSummary(rows: readonly Pick<BoardRow, 'status'>[], tr: (k: MessageKey, p?: Record<string, string | number>) => string, locale: 'en' | 'ar'): string {
  const awaiting = rows.filter((r) => r.status === 'awaiting_payment').length;
  const open = tr('ws.cashier.tabs.summaryOpen', { count: formatNumber(rows.length, locale) });
  return awaiting > 0 ? `${open} · ${tr('ws.cashier.tabs.summaryAwaiting', { count: formatNumber(awaiting, locale) })}` : open;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * The remove control (0085), for a tab with nothing on it.
 *
 * Press once to arm, confirm, then say why — the same reason picker a
 * cancelled booking goes through, because a tab that vanishes from the board
 * with no recorded reason is the one act the audit log could not explain the
 * next morning. No dialog before the reason: this is the screen a cashier uses
 * standing up.
 *
 * A refusal is rendered in BOTH branches. The board's rows are a cached read,
 * so a waiter's order can land between the render and the press; the server
 * then refuses, the row stays armed and removable, and the message the server
 * sent must still be visible in the branch that re-renders.
 */
function RemoveTabControl({
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
    maxInlineSize: '14rem',
    textWrap: 'balance',
    textAlign: 'start',
  };

  const refusal = error != null && (
    <span role="alert" style={warn}>
      <Icon name="alert" size={12} style={{ marginBlockStart: '0.15rem', flexShrink: 0 }} />
      {tr(removalErrorKey(error))}
    </span>
  );

  if (armed && row.blocker === null) {
    return (
      <span style={{ display: 'grid', justifyItems: 'end', gap: '0.3rem' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          <span style={{ fontSize: 'var(--tp-fs-sm)', fontWeight: 600, color: 'var(--tp-danger-fg)' }}>{tr('ws.cashier.tabs.removeAsk')}</span>
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
    <span style={{ display: 'grid', justifyItems: 'end', gap: '0.3rem' }}>
      {row.blocker === null && (
        <Button size="sm" kind="ghost" icon="trash" onClick={() => onArm(!armed)}>
          {tr('ws.cashier.tabs.remove')}
        </Button>
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
  pendingIds,
}: {
  status: AsyncStatus;
  rows: readonly BoardRow[];
  /** The sort key (named `filter` for the existing call sites). */
  filter: TabsSort;
  query: string;
  now: number;
  error?: unknown;
  onFilter: (f: TabsSort) => void;
  onQuery: (q: string) => void;
  onSelect: (id: string) => void;
  onMerge: (survivorId: string) => void;
  onOpenTab: () => void;
  onRetry: () => void;
  /**
   * Confirmed removal of an empty tab (0085), with the reason the cashier
   * chose (0100) — 'code' or 'code: note', the shape the audit log already
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
   * tab refused once wore the message for the rest of the shift.
   */
  onDismissRemoveError: () => void;
  /** Tabs whose removal is on the durable queue, unanswered (item 9): badge, no control. */
  pendingIds?: ReadonlyMap<string, unknown> | ReadonlySet<string>;
}) {
  const { tr, locale } = useLocale();
  const visible = useMemo(() => filterBoardRows(rows, filter, query), [rows, filter, query]);
  // Computed over what is ON SCREEN: a court total that counted rows the
  // search has hidden would not add up to the rows under it.
  const grouped = useMemo(() => courtTotals(visible), [visible]);
  /*
   * Which row is asking "remove?". One id, not a set: two tabs mid-confirm at
   * once is not a state a cashier ever wants, and arming a second row is the
   * clearest possible way to say they are done with the first.
   */
  const [armedId, setArmedId] = useState<string | null>(null);
  /* The tab whose reason is being asked for. */
  const [reasonFor, setReasonFor] = useState<string | null>(null);
  // Escape backs out of the confirm, the way it backs out of every dialog
  // here. Not while the reason prompt is up: that dialog owns its own Escape.
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
    if (reasonFor !== null && (!rows.some((r) => r.id === reasonFor) || pendingIds?.has(reasonFor))) {
      setReasonFor(null);
      setArmedId(null);
    }
  }, [rows, reasonFor, pendingIds]);

  const nowDate = new Date(now);
  const hasBookingTabs = rows.some((r) => r.court !== null);

  const columns: Column<BoardRow>[] = [
    {
      key: 'tab',
      header: tr('ws.cashier.tabs.colTab'),
      render: (r) => {
        const sub = [r.court, r.guest && r.guest !== r.label ? r.guest : null].filter((p): p is string => Boolean(p));
        return (
          <span style={{ display: 'grid', gap: 'var(--tp-sp-0)', minInlineSize: 0 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--tp-sp-1-5)', flexWrap: 'wrap' }}>
              <strong style={{ overflowWrap: 'anywhere' }}>
                <bdi>{r.label}</bdi>
              </strong>
              {r.status !== 'open' && <TabStatusIndicator status={r.status} size="sm" />}
              {r.web && <StatusBadge tone="info" icon="globe" dot={false} size="sm" label={tr('ws.cashier.tabs.sourceWeb')} />}
            </span>
            {sub.length > 0 && (
              <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>
                {sub.map((p, i) => (
                  <span key={i}>
                    {i > 0 && ' · '}
                    <bdi>{p}</bdi>
                  </span>
                ))}
              </span>
            )}
            {r.blocker === null && <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>{tr('ws.cashier.tabs.nothingYet')}</span>}
          </span>
        );
      },
    },
    {
      key: 'age',
      header: tr('ws.cashier.tabs.colAge'),
      width: '9rem',
      render: (r) => {
        const opened = new Date(r.openedAt);
        return (
          <span style={{ display: 'grid', whiteSpace: 'nowrap' }}>
            <span>{formatElapsed(r.openedAt, now, tr)}</span>
            <span style={{ ...muted, fontSize: 'var(--tp-fs-xs)' }}>
              <bdi>{tr('ws.cashier.tabs.since', { time: sameLocalDay(opened, nowDate) ? formatTime(opened, locale) : formatDateTime(opened, locale) })}</bdi>
            </span>
          </span>
        );
      },
    },
    {
      key: 'total',
      header: tr('ws.cashier.tabs.colTotal'),
      numeric: true,
      width: '8rem',
      render: (r) => <Money amount={r.total} strong style={{ whiteSpace: 'nowrap' }} />,
    },
    {
      key: 'actions',
      header: <span className="tp-sr-only">{tr('ws.cashier.tabs.colActions')}</span>,
      align: 'end',
      // No stopPropagation: DataTable's own CELL_CONTROL guard already keeps a
      // <button> inside a cell from firing the row's navigate, by click and by
      // Enter — so arming a removal cannot also open the tab it is removing.
      render: (r) => (
        <span style={{ display: 'inline-flex', alignItems: 'flex-start', gap: 'var(--tp-sp-1)', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {pendingIds?.has(r.id) ? (
            <StatusBadge tone="info" icon="wifiOff" size="sm" label={tr('ws.cashier.tabs.removalQueued')} />
          ) : (
            <RemoveTabControl
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
          )}
          {armedId !== r.id && (
            <>
              <Button size="sm" kind="ghost" icon="merge" onClick={() => onMerge(r.id)}>
                {tr('ws.cashier.tabs.merge')}
              </Button>
              <Button size="sm" iconEnd="arrowUpRight" onClick={() => onSelect(r.id)}>
                {tr('ws.cashier.tabs.select')}
              </Button>
            </>
          )}
        </span>
      ),
    },
  ];

  return (
    <div>
      <PageHeader
        title={tr('ws.cashier.tabs.title')}
        subtitle={status === 'ready' || status === 'empty' ? boardSummary(rows, tr, locale) : undefined}
        actions={
          <Button kind="primary" icon="plus" onClick={onOpenTab}>
            {tr('ws.cashier.tabs.openTab')}
          </Button>
        }
      />
      {status !== 'empty' && (
        <Toolbar>
          <SearchField value={query} onChange={onQuery} placeholder={tr('ws.cashier.tabs.searchPlaceholder')} style={{ maxInlineSize: '20rem' }} />
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
            <span id="open-tabs-sort" style={muted}>
              {tr('ws.cashier.tabs.filter')}
            </span>
            <SegmentedControl<TabsSort>
              value={filter}
              onChange={onFilter}
              aria-labelledby="open-tabs-sort"
              size="sm"
              options={[
                { value: 'table', label: tr('ws.cashier.tabs.byTable') },
                { value: 'court', label: tr('ws.cashier.tabs.byCourt') },
                { value: 'name', label: tr('ws.cashier.tabs.byName') },
              ]}
            />
          </span>
        </Toolbar>
      )}

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
          // Only courts carrying more than one tab are grouped; everything
          // else keeps the row it always had.
          groupBy={(r) => (r.courtId !== null && grouped.has(r.courtId) ? r.courtId : null)}
          renderGroupHeader={(key, groupRows) => {
            const sum = grouped.get(key);
            if (!sum) return null;
            return (
              <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 'var(--tp-sp-3)' }}>
                <span style={{ fontWeight: 700 }}>
                  {tr('ws.cashier.tabs.courtGroup', { court: groupRows[0]?.court ?? '', count: String(sum.count) })}
                </span>
                <Money amount={sum.total} strong />
              </span>
            );
          }}
        />
        {hasBookingTabs && <p style={{ ...muted, fontSize: 'var(--tp-fs-xs)', marginBlockStart: 'var(--tp-sp-2)' }}>{tr('ws.cashier.tabs.courtFeeNote')}</p>}
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
  const [filter, setFilter] = useState<TabsSort>('table');
  const [query, setQuery] = useState('');
  const [newTab, setNewTab] = useState(false);
  const [mergeSurvivor, setMergeSurvivor] = useState<TabListRow | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [removeError, setRemoveError] = useState<{ id: string; error: unknown } | null>(null);
  /**
   * Removals on the durable queue, unanswered: tab id -> the envelope's localId
   * (item 9). The ack retires the entry; a refusal the server turned down
   * lands back in the row, exactly where a synchronous refusal would have.
   * (The root also toasts it.)
   */
  const pendingRemovals = usePendingResults<string>((id, r) => {
    const code = resultErrorCode(r) ?? 'UNKNOWN';
    const detail = (r.serverResult as { details?: unknown } | null)?.details;
    setRemoveError({ id, error: new AppRpcError(code, code, undefined, typeof detail === 'string' ? detail : undefined) });
  });

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  const tabsQ = useQuery({ ...OPEN_TABS_QUERY });

  // A refetch that no longer lists the tab also retires its entry (the ack
  // may have landed while this screen was unmounted).
  useEffect(() => {
    if (pendingRemovals.pending.size === 0 || !tabsQ.data) return;
    const live = new Set(tabsQ.data.map((t) => t.id));
    for (const id of pendingRemovals.pending.keys()) if (!live.has(id)) pendingRemovals.remove(id);
  }, [tabsQ.data, pendingRemovals]);
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
        courtId: t.reservation?.court?.id ?? null,
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
   * tab.cancel on the durable queue (item 9 / C3, 0120; before it, a direct
   * app.cancel_tab call that only worked online). The server still re-checks
   * emptiness under the row lock at replay time, so a removal that lands after
   * the tab gained an order is refused TAB_NOT_EMPTY — as a queue row, which
   * onFailedResult below turns back into the per-row message. merge_tabs, the
   * other tab-shape change on this screen, stays a direct RPC by decision.
   */
  async function removeTab(id: string, reason: string) {
    setRemovingId(id);
    setRemoveError(null);
    try {
      const outcome = await mutate('tab.cancel', { tabId: id, reasonCode: reason });
      if (outcome.queued) {
        // Safe on disk, unanswered: the row wears its badge until the ack
        // (the refetch drops it) or the refusal (the row shows it).
        pendingRemovals.add(id, outcome.localId);
        return;
      }
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
    /*
     * The board takes the full width. Waiter calls used to hold a fixed 18rem
     * column beside it all shift, empty or not, and the table of tabs gave up
     * that width to a panel that mostly said "No calls". They are a strip
     * above the list now, and only while a call is waiting.
     */
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 'var(--tp-sp-4)', alignContent: 'start' }}>
      <StartShiftBanner />
      <WaiterCallsPanel status={floorStatus} layout="strip" />
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
        pendingIds={pendingRemovals.pending}
      />

      {newTab && (
        <NewTabDialog
          openTabs={tabsQ.data ?? []}
          onPickExisting={(tabId) => {
            setNewTab(false);
            goToTill(tabId);
          }}
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
