/**
 * TillScreen (spec 06.11) — the cashier's landing screen and the fastest
 * surface in the app. Two views, one after the other:
 *
 *   floor   what the till opens on (FloorView): a plan of the café where a
 *           table with a live tab is green, and the courts behind their own
 *           button. Tap a green table to add to its tab; tap a free one to open
 *           a tab there (SpotDialog: a short confirm with an optional name).
 *           Beside the plan: waiter calls and any open tab the plan does not
 *           draw, so every live tab is one tap away.
 *   order   once a tab is chosen: filter, category strip (1–9), item grid and
 *           basket, and the tab itself (lines, totals, promotion, payment,
 *           actions). "Floor" goes back. Everything the till could do before
 *           the plan it still does here, unchanged.
 *
 * Every write is an app.* RPC through mutate(); prices always come back from
 * the server. Offline: tabs opened while disconnected live in the durable
 * queue (lib/offlineTabs) and show on the plan until their open replays.
 *
 * States: loading (menu skeleton) · ready · error (menu unreachable, retry) ·
 * busy (sending — the basket's button carries it).
 *
 * Keymap: keymap.ts (one table feeds the handler and the help popover).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { mutate } from '../../lib/mutate';
import { LOCAL_TAB_PREFIX, appendOfflineLines, listOfflineTabs, subscribeOfflineTabs } from '../../lib/offlineTabs';
import { QK, fetchActiveCafeTables, fetchOpenDay } from '../../lib/queries';
import { useBroadcast } from '../../lib/realtime';
import { chime, StartShiftBanner } from '../../lib/audio';
import { TillShiftPanel } from '../tillShift/TillShiftPanel';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { formatTime } from '@touch/i18n';
import { Button, Skeleton, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, Kbd } from '../../components/kit';
import { WAITER_CALLS_QUERY, WaiterCallsPanel } from './WaiterCallsPanel';
import { FloorView, OtherTabsList, useCourtBookings, type FloorMode, type OtherTab } from './FloorView';
import { SpotDialog, type SpotTarget } from './SpotDialog';
import { courtBoards, courtTabCount, otherOpenTabs, placeCafe, type BoardBooking, type CafeSpot, type CourtRow } from './floorPlan';
import { CategoryStrip, MenuItemGrid, TileLegend } from './TillGrid';
import { Basket } from './Basket';
import { ItemSheet } from './ItemSheet';
import { LineNoteDialog } from './LineNoteDialog';
import { NewTabDialog } from './NewTabDialog';
import { TabDetailPanel } from './TabDetailPanel';
import { OfflineTabPanel } from './OfflineTabPanel';
import { KeymapHelp } from './KeymapHelp';
import { mergeQuickLine, quickVariant } from './quickAdd';
import { resolveTillKey, type TillAction } from './keymap';
import { BarcodeWedge } from './barcodeWedge';
import { findByBarcode, orderSections, shopVariantIds, splitBasket } from './basketSplit';
import { localIsoDate, deriveTileState, tileInteractive } from './tileState';
import { OPEN_TABS_QUERY, TILL_MENU_QUERY, basketLineEstimate, fetchTabDetail, tabAnchorLabel, type BasketLine, type ItemRow } from './tillData';
import type { TillSearch } from './tillSearch';
import { BASKET_BLOCK_SIZE, muted } from './tillStyles';

export function TillScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const toast = useToast();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as TillSearch;

  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sheetItem, setSheetItem] = useState<ItemRow | null>(null);
  /** Basket line key whose note dialog is open — the line itself is read from `basket`. */
  const [noteLineKey, setNoteLineKey] = useState<string | null>(null);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  /* The basket is short by default — the item grid keeps the screen — and the
     cashier opens it taller to read a long order before sending. */
  const [basketExpanded, setBasketExpanded] = useState(false);
  const [sendError, setSendError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [newTab, setNewTab] = useState<{ reservationId?: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [floorMode, setFloorMode] = useState<FloorMode>('cafe');
  const [spotTarget, setSpotTarget] = useState<SpotTarget | null>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const wedgeRef = useRef(new BarcodeWedge());
  const today = useMemo(() => localIsoDate(), []);

  // Tabs opened while disconnected — durable in the queue, shown on the plan.
  const offlineTabs = useSyncExternalStore(subscribeOfflineTabs, listOfflineTabs);

  // When a selected offline tab's open replays (acked) its entry retires and
  // the server tab takes its place in the rail — drop the dangling selection.
  useEffect(() => {
    if (!selectedTabId?.startsWith(LOCAL_TAB_PREFIX)) return;
    const key = selectedTabId.slice(LOCAL_TAB_PREFIX.length);
    if (!offlineTabs.some((t) => t.idemKey === key)) setSelectedTabId(null);
  }, [offlineTabs, selectedTabId]);

  // ---- data -----------------------------------------------------------------
  const dayQ = useQuery({ queryKey: QK.day, queryFn: fetchOpenDay });
  const menuQ = useQuery({ ...TILL_MENU_QUERY });
  const tabsQ = useQuery({ ...OPEN_TABS_QUERY });
  const tablesQ = useQuery({ queryKey: QK.activeCafeTables, queryFn: fetchActiveCafeTables });
  const courtsQ = useCourtBookings();
  const callsQ = useQuery({ ...WAITER_CALLS_QUERY });

  // Bookings start and end while the plan is on screen; the court boards read the clock.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  useBroadcast({ topic: 'menu', isPrivate: false, events: ['menu_changed'], invalidateKeys: [['menu']] });
  const { status: floorStatus } = useBroadcast({
    topic: 'floor',
    isPrivate: true,
    events: ['waiter_call'],
    invalidateKeys: [['tabs'], ['waiterCalls']],
    // chime() is a no-op until audio is armed (StartShiftBanner / Electron autoplay policy).
    onEvent: (_e, p) => (p as { status?: string } | null)?.status === 'raised' && chime('call'),
  });

  // Touch Shop sections (0144) follow the café ones, so keys 1–9 keep their places.
  const categories = useMemo(() => orderSections((menuQ.data?.categories ?? []).filter((c) => c.is_active)), [menuQ.data]);
  const shopVariants = useMemo(() => shopVariantIds(menuQ.data), [menuQ.data]);
  const activeCategory = categoryId ?? categories[0]?.id ?? null;

  const visibleItems = useMemo(() => {
    const items = (menuQ.data?.items ?? []).filter((i) => i.is_active);
    const q = filter.trim().toLowerCase();
    if (q) return items.filter((i) => i.name_en.toLowerCase().includes(q) || i.name_ar.includes(filter.trim()));
    return items.filter((i) => i.category_id === activeCategory);
  }, [menuQ.data, filter, activeCategory]);

  const prefetchTab = useCallback(
    (id: string) => {
      void queryClient.prefetchQuery({ queryKey: ['tab', id], queryFn: () => fetchTabDetail(id), staleTime: 10_000 });
    },
    [queryClient],
  );

  // ---- deep links: /till?tab=<id> · /till?reservation=<id> ------------------
  useEffect(() => {
    if (!search.tab && !search.reservation) return;
    if (search.tab) {
      setSelectedTabId(search.tab);
      setBasket([]);
      prefetchTab(search.tab);
    }
    if (search.reservation) setNewTab({ reservationId: search.reservation });
    // Consume the params so a reload or Back does not re-apply them.
    void navigate({ to: '/till', search: {}, replace: true });
  }, [search.tab, search.reservation, navigate, prefetchTab]);

  // ---- quick add / tab switching -------------------------------------------
  const hasActiveTab = selectedTabId !== null;

  function addOrOpen(item: ItemRow) {
    const state = deriveTileState({
      orderable: menuQ.data?.availability[item.id],
      soldOut: item.sold_out,
      unavailableOn: item.unavailable_on,
      hasActiveTab,
      today,
    });
    if (!tileInteractive(state)) return;
    const v = quickVariant(item);
    if (!v) {
      setSheetItem(item);
      return;
    }
    setBasket((b) =>
      mergeQuickLine(b, {
        key: crypto.randomUUID(),
        variantId: v.id,
        itemName: pickName(locale, item),
        variantName: pickName(locale, v),
        qty: 1,
        notes: '',
        unitPriceIqd: v.price_iqd,
        modifiers: [],
      }),
    );
  }

  /** A barcode scan (USB wedge): the exact size, straight into the basket. */
  function addScanned(code: string) {
    const hit = findByBarcode(menuQ.data?.items ?? [], code);
    if (!hit) {
      toast.info(tr('ws.cashier.shop.scanUnknown', { code }));
      return;
    }
    if (!hasActiveTab) {
      toast.info(tr('ws.cashier.shop.scanNoTab'));
      return;
    }
    const state = deriveTileState({
      orderable: menuQ.data?.availability[hit.item.id],
      soldOut: hit.item.sold_out,
      unavailableOn: hit.item.unavailable_on,
      hasActiveTab,
      today,
    });
    if (!tileInteractive(state)) {
      toast.info(tr('ws.cashier.shop.scanUnavailable', { name: pickName(locale, hit.item) }));
      return;
    }
    setBasket((b) =>
      mergeQuickLine(b, {
        key: crypto.randomUUID(),
        variantId: hit.variant.id,
        itemName: pickName(locale, hit.item),
        variantName: pickName(locale, hit.variant),
        qty: 1,
        notes: '',
        unitPriceIqd: hit.variant.price_iqd,
        modifiers: [],
      }),
    );
  }

  /** Switching tabs discards the unsent basket — never silently. */
  async function selectTab(id: string | null) {
    if (basket.length > 0 && id !== selectedTabId) {
      const ok = await confirm({
        title: tr('op.till.discardBasketTitle'),
        body: tr('op.till.discardBasketBody', { count: basket.length }),
        kind: 'danger',
      });
      if (!ok) return;
    }
    setSelectedTabId(id);
    setBasket([]);
    setSendError(null);
  }

  // ---- the floor ------------------------------------------------------------
  const spots = useMemo(
    () => placeCafe(tablesQ.data ?? [], tabsQ.data ?? [], offlineTabs, callsQ.data ?? []),
    [tablesQ.data, tabsQ.data, offlineTabs, callsQ.data],
  );
  const boards = useMemo(() => courtBoards(courtsQ.data?.courts ?? [], courtsQ.data?.bookings ?? [], now), [courtsQ.data, now]);
  const others = useMemo<OtherTab[]>(() => {
    const ids = otherOpenTabs(tabsQ.data ?? [], offlineTabs, spots, boards);
    return ids.flatMap((id): OtherTab[] => {
      if (id.startsWith(LOCAL_TAB_PREFIX)) {
        const ot = offlineTabs.find((t) => `${LOCAL_TAB_PREFIX}${t.idemKey}` === id);
        return ot ? [{ id, label: ot.label ?? '—', status: 'open', offline: true }] : [];
      }
      const t = (tabsQ.data ?? []).find((x) => x.id === id);
      return t ? [{ id, label: tabAnchorLabel(t, tr('op.till.table'), tr('op.till.forReservation')), status: t.status, offline: false }] : [];
    });
  }, [tabsQ.data, offlineTabs, spots, boards, tr]);

  /** One tab on the table: straight to it. None, or several: the spot dialog asks. */
  function pressTable(spot: CafeSpot) {
    if (spot.tabs.length === 1) {
      const id = spot.tabs[0]!.id;
      if (!spot.tabs[0]!.offline) prefetchTab(id);
      void selectTab(id);
      return;
    }
    setSpotTarget({ kind: 'table', spot });
  }

  function pressBooking(b: BoardBooking, court: CourtRow) {
    if (b.liveTab) {
      prefetchTab(b.liveTab.id);
      void selectTab(b.liveTab.id);
      return;
    }
    setSpotTarget({
      kind: 'booking',
      reservationId: b.booking.id,
      description: tr('ws.cashier.charge.option', {
        time: formatTime(new Date(b.booking.start_at), locale),
        court: pickName(locale, court),
        guest: b.booking.guest_name ?? '—',
      }),
    });
  }

  /** A tab was opened (plan or dialog): go to it, and let the plan catch up. */
  function openedTab(tabId: string) {
    setSelectedTabId(tabId);
    setBasket([]);
    setSendError(null);
    void queryClient.invalidateQueries({ queryKey: ['tabs'] });
    void queryClient.invalidateQueries({ queryKey: ['tillCourts'] });
    void queryClient.invalidateQueries({ queryKey: ['openTabReservations'] });
  }

  /**
   * Quantity stops at ONE. Taking the last one off used to delete the line
   * outright, so a mis-aimed − removed a drink the cashier only meant to count
   * down — and silently, with the row gone before they could see it. Removing
   * is the × button's job, which is the one that asks.
   */
  function bumpBasketQty(key: string, delta: number) {
    setBasket((b) => b.map((l) => (l.key === key ? { ...l, qty: Math.max(1, l.qty + delta) } : l)));
  }

  function setLineNotes(key: string, notes: string) {
    setBasket((b) => b.map((l) => (l.key === key ? { ...l, notes } : l)));
  }

  // ---- send basket ----------------------------------------------------------
  async function sendBasket() {
    if (!selectedTabId || basket.length === 0 || sending) return;
    setSending(true);
    setSendError(null);
    try {
      // 0146: café lines are kitchen work, shop lines come off the shelf, and
      // the server takes them as separate orders (MIXED_BASKET otherwise). Each
      // part leaves the basket as soon as it is sent, so a failure on the second
      // retries only what is still there.
      const { cafe, shop } = splitBasket(basket, shopVariants);
      for (const part of [cafe, shop]) {
        if (part.length === 0) continue;
        const items = part.map((l) => ({
          variantId: l.variantId,
          qty: l.qty,
          ...(l.notes ? { notes: l.notes } : {}),
          modifiers: l.modifiers.map((m) => ({ modifierId: m.modifierId, qty: m.qty })),
        }));
        const shopFlag = part === shop ? { shop: true as const } : {};
        // Single write path: queued durably in Electron, direct RPC in browser mode.
        if (selectedTabId.startsWith(LOCAL_TAB_PREFIX)) {
          const idemKey = selectedTabId.slice(LOCAL_TAB_PREFIX.length);
          await mutate('order.add_items', { tabIdemKey: idemKey, items, ...shopFlag });
          appendOfflineLines(
            idemKey,
            part.map((l) => ({ name: `${l.itemName} (${l.variantName})`, qty: l.qty, priceIqd: basketLineEstimate(l) / l.qty })),
          );
        } else {
          await mutate('order.add_items', { tabId: selectedTabId, items, ...shopFlag });
        }
        const sent = new Set(part.map((l) => l.key));
        setBasket((b) => b.filter((l) => !sent.has(l.key)));
      }
      void queryClient.invalidateQueries({ queryKey: ['tab', selectedTabId] });
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
    } catch (e) {
      setSendError(e);
    } finally {
      setSending(false);
    }
  }

  // ---- keyboard (spec R11) ----------------------------------------------------
  const latest = useRef({ visibleItems, categories, sendBasket, addOrOpen, addScanned });
  latest.current = { visibleItems, categories, sendBasket, addOrOpen, addScanned };

  useEffect(() => {
    let flushTimer: number | undefined;

    /** One action, from a key press (`e`) or replayed from a held key (`e` null). */
    function run(action: TillAction, e: KeyboardEvent | null) {
      const { visibleItems: visible, categories: cats, sendBasket: send, addOrOpen: add } = latest.current;
      if (typeof action === 'object') {
        const cat = cats[action.index];
        if (cat) {
          e?.preventDefault();
          setCategoryId(cat.id);
          setFilter('');
        }
        return;
      }
      switch (action) {
        case 'send':
          e?.preventDefault();
          void send();
          return;
        case 'cash':
        case 'card':
          // Opens the settle pane only — money is never CONFIRMED by keyboard.
          e?.preventDefault();
          window.dispatchEvent(new CustomEvent('till-settle-hotkey', { detail: action }));
          return;
        case 'newTab':
          e?.preventDefault();
          setNewTab({});
          return;
        case 'focusFilter':
          e?.preventDefault();
          filterRef.current?.focus();
          filterRef.current?.select();
          return;
        case 'help':
          e?.preventDefault();
          setHelpOpen(true);
          return;
        case 'quickAddFromFilter':
          // Type "wat", Enter, done — when exactly one visible item needs no choices.
          if (visible.length === 1 && quickVariant(visible[0]!)) {
            e?.preventDefault();
            add(visible[0]!);
            setFilter('');
          }
          return;
        case 'typeToFilter':
          filterRef.current?.focus();
          return;
      }
    }

    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'));
      const inFilter = target === filterRef.current;
      const overlayOpen = Boolean(document.querySelector('[role="dialog"][aria-modal="true"]'));
      const modifier = e.ctrlKey || e.metaKey || e.altKey;

      // Barcode wedge (Touch Shop, barcodeWedge.ts): only where a stray key
      // would otherwise switch a category or type into the filter.
      const mode = modifier || overlayOpen ? null : inFilter ? 'filter' : inField ? null : 'idle';
      if (mode === null) {
        wedgeRef.current.reset();
      } else {
        const w = wedgeRef.current.feed(e.key, e.timeStamp, mode);
        if (w.kind === 'scan') {
          e.preventDefault();
          if (mode === 'filter') setFilter('');
          latest.current.addScanned(w.code);
          return;
        }
        if (w.kind === 'swallow') {
          e.preventDefault();
          window.clearTimeout(flushTimer);
          flushTimer = window.setTimeout(() => {
            const held = wedgeRef.current.flush(performance.now());
            if (held === null) return;
            if (held.length === 1) {
              // A lone digit: the category key the person pressed.
              const a = resolveTillKey({ key: held, inField: false, inFilter: false, overlayOpen: false, modifier: false });
              if (a !== null) run(a, null);
            } else {
              // A short burst that never ended in Enter: typing, not a scan.
              setFilter(held);
              filterRef.current?.focus();
            }
          }, wedgeRef.current.maxGapMs + 20);
          return;
        }
      }

      const action = resolveTillKey({ key: e.key, inField, inFilter, overlayOpen, modifier });
      if (action === null) return;
      run(action, e);
    }
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.clearTimeout(flushTimer);
    };
  }, []);

  // ---- render ---------------------------------------------------------------
  if (dayQ.isSuccess && !dayQ.data) {
    return (
      <div style={{ maxInlineSize: 'var(--tp-measure-form)' }}>
        <h1 style={{ fontSize: 'var(--tp-fs-xl)', fontWeight: 700, marginBlockEnd: 'var(--tp-sp-3)' }}>{tr('till.title')}</h1>
        <EmptyState icon="sun" title={tr('op.till.noOpenDay')} />
      </div>
    );
  }

  const menuStatus = menuQ.isError && !menuQ.data ? 'error' : menuQ.data ? 'ready' : 'loading';
  const filtering = filter.trim().length > 0;
  const selectedIsOffline = selectedTabId?.startsWith(LOCAL_TAB_PREFIX) ?? false;
  // Derived, not held: removing the line (or clearing the basket, or switching
  // tabs) under an open note dialog closes it rather than leaving a dialog
  // editing a line that no longer exists.
  const noteLine = basket.find((l) => l.key === noteLineKey) ?? null;
  // The legend names the two unavailable looks. It printed under every
  // category, including the ones with nothing unavailable in them, where it
  // explained a look the cashier could not see.
  const showLegend = visibleItems.some((i) => {
    const state = deriveTileState({ orderable: menuQ.data?.availability[i.id], soldOut: i.sold_out, unavailableOn: i.unavailable_on, hasActiveTab: true, today });
    return state === 'unavailable' || state === 'blockedByStock';
  });
  // Which tab the basket will land on, named where the basket is — the tab
  // panel saying so from the far side of the screen is not enough.
  const selectedLabel = (() => {
    if (!selectedTabId) return null;
    if (selectedIsOffline) {
      const ot = offlineTabs.find((t) => `${LOCAL_TAB_PREFIX}${t.idemKey}` === selectedTabId);
      return ot ? (ot.tableNumber ? `${tr('op.till.table')} ${ot.tableNumber}` : (ot.label ?? null)) : null;
    }
    const t = (tabsQ.data ?? []).find((x) => x.id === selectedTabId);
    return t ? tabAnchorLabel(t, tr('op.till.table'), tr('op.till.forReservation')) : null;
  })();

  const overlays = (
    <>
      {sheetItem && menuQ.data && (
        <ItemSheet
          item={sheetItem}
          groups={menuQ.data.groups}
          modifiers={menuQ.data.modifiers}
          onClose={() => setSheetItem(null)}
          onAdd={(line) => {
            setBasket((b) => [...b, line]);
            setSheetItem(null);
          }}
        />
      )}
      {noteLine && (
        <LineNoteDialog
          line={noteLine}
          onClose={() => setNoteLineKey(null)}
          onSave={(notes) => {
            setLineNotes(noteLine.key, notes);
            setNoteLineKey(null);
          }}
        />
      )}
      {spotTarget && (
        <SpotDialog
          target={spotTarget}
          onClose={() => setSpotTarget(null)}
          onPickTab={(tabId) => {
            setSpotTarget(null);
            void selectTab(tabId);
          }}
          onOpened={(tabId) => {
            setSpotTarget(null);
            openedTab(tabId);
          }}
        />
      )}
      {newTab && (
        <NewTabDialog
          initialReservationId={newTab.reservationId}
          shopEnabled={shopVariants.size > 0}
          openTabs={tabsQ.data ?? []}
          onPickExisting={(tabId) => {
            setNewTab(null);
            void selectTab(tabId);
          }}
          onClose={() => setNewTab(null)}
          onOpened={(tabId) => {
            setNewTab(null);
            openedTab(tabId);
          }}
        />
      )}
      {helpOpen && <KeymapHelp onClose={() => setHelpOpen(false)} />}
    </>
  );

  // ---- floor view -------------------------------------------------------------
  if (!selectedTabId) {
    return (
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(15rem, 21rem)',
          // Row 1: floor heading and legend | New tab. Row 2: the plan | calls.
          gridTemplateRows: 'auto minmax(0, 1fr)',
          columnGap: 'var(--tp-sp-4)',
          rowGap: 'var(--tp-sp-3)',
          blockSize: '100%',
          minBlockSize: 0,
          alignItems: 'stretch',
        }}
      >
        <FloorView
          mode={floorMode}
          onMode={setFloorMode}
          spots={spots}
          tablesStatus={tablesQ.isError && !tablesQ.data ? 'error' : tablesQ.data ? 'ready' : 'loading'}
          onRetryTables={() => void tablesQ.refetch()}
          boards={boards}
          boardsStatus={courtsQ.isError && !courtsQ.data ? 'error' : courtsQ.data ? 'ready' : 'loading'}
          boardsError={courtsQ.error}
          onRetryBoards={() => void courtsQ.refetch()}
          courtTabs={courtTabCount(boards)}
          onTable={pressTable}
          onBooking={pressBooking}
        />
        {/* The screen's own action, top of the end column like every page's
            header button, with the calls to answer right under it. */}
        <span style={{ gridColumn: 2, gridRow: 1, alignSelf: 'start', justifySelf: 'end', display: 'inline-flex', alignItems: 'center', gap: 'var(--tp-sp-1)' }}>
          <Kbd>F6</Kbd>
          <Button kind="primary" size="lg" icon="plus" onClick={() => setNewTab({})}>
            {tr('ws.cashier.till.rail.newTab')}
          </Button>
        </span>
        <aside style={{ gridColumn: 2, gridRow: 2, minBlockSize: 0, minInlineSize: 0, overflowY: 'auto', overflowX: 'hidden', display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)' }}>
          <WaiterCallsPanel status={floorStatus} />
          {/* Wave 5 (§5.1): the till shift's start panel while none is open, else the sound strip. */}
          <TillShiftPanel fallback={<StartShiftBanner />} />
          <OtherTabsList tabs={others} onPick={(id) => void selectTab(id)} />
        </aside>
        {overlays}
      </div>
    );
  }

  // ---- order view -------------------------------------------------------------
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)', blockSize: '100%', minBlockSize: 0 }}>
      <TillShiftPanel fallback={<StartShiftBanner />} />
      <WaiterCallsPanel status={floorStatus} layout="strip" />
      <div
        style={{
          display: 'grid',
          // Proportional, so the tab column gives way with the menu rather than
          // before it. At 1100px a fixed 20–23rem side left the menu and basket
          // ~280px and Send ran over the pay column.
          gridTemplateColumns: 'minmax(17rem, 1.6fr) minmax(16rem, 1fr)',
          gap: 'var(--tp-sp-4)',
          flex: 1,
          minBlockSize: 0,
          /* ONE row, as tall as the strip and no taller. Without this the row
             was implicit and `auto`, so it took the height of whichever pane
             was taller — and the basket opening made the menu pane that pane,
             which pushed the row, both panes and the buttons on their bottom
             edges down the screen. A definite row is what lets the item grid
             absorb the basket's two heights instead. */
          gridTemplateRows: 'minmax(0, 1fr)',
          alignItems: 'stretch',
        }}
      >
        {/* ---- menu: back, filter, categories, grid, basket ---- */}
        {/* `blockSize: 100%` is what pins the basket to the bottom of the pane.
            Without it the column sized to its CONTENT, so the item grid's
            `flex: 1` had no fixed height to divide and the basket's two
            reserved heights simply made the whole pane taller or shorter —
            which is what moved Send up and down on every press of the
            chevron. With a definite height the grid absorbs the difference and
            the bottom edge, and everything sitting on it, never moves. */}
        <section aria-label={tr('ws.cashier.till.regionMenu')} style={{ blockSize: '100%', minBlockSize: 0, minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-2-5)', position: 'relative' }}>
          <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
            <Button icon="chevronStart" onClick={() => void selectTab(null)} aria-label={tr('ws.cashier.floor.backLabel')} style={{ minBlockSize: 'var(--tp-touch)', flexShrink: 0 }}>
              {tr('ws.cashier.floor.back')}
            </Button>
            <input
              ref={filterRef}
              style={{ ...inputStyle, flex: 1, minBlockSize: 'var(--tp-touch)' }}
              aria-label={tr('ws.cashier.till.filterLabel')}
              placeholder={tr('ws.cashier.till.filterPlaceholder')}
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && filter) {
                  e.stopPropagation();
                  setFilter('');
                }
              }}
            />
            <Button icon="keyboard" onClick={() => setHelpOpen(true)} aria-label={tr('ws.cashier.till.help.open')} title={tr('ws.cashier.till.help.open')} style={{ minBlockSize: 'var(--tp-touch)' }}>
              <Kbd>?</Kbd>
            </Button>
          </div>

          <AsyncStateWrapper
            status={menuStatus}
            onRetry={() => void menuQ.refetch()}
            error={menuQ.error}
            skeleton={
              <div style={{ display: 'grid', gap: 'var(--tp-sp-2-5)' }} aria-busy="true">
                <p style={muted}>{tr('ws.cashier.till.loadingMenu')}</p>
                {/* The skeleton stands on the same two physical tokens the real
                    strip and tiles do, so the menu does not resize on arrival. */}
                <Skeleton lines={1} blockSize="var(--tp-touch)" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))', gap: 'var(--tp-sp-1-5)' }}>
                  {Array.from({ length: 8 }, (_, i) => (
                    <Skeleton key={i} lines={1} blockSize="var(--tp-tile-min-block)" />
                  ))}
                </div>
              </div>
            }
          >
            <CategoryStrip
              categories={categories}
              activeId={activeCategory}
              filtering={filtering}
              onSelect={(id) => {
                setCategoryId(id);
                setFilter('');
              }}
            />
            {/* `overflow-y: auto` makes the box clip on BOTH axes, and the
                focus ring is drawn 2px OUTSIDE the tile it belongs to, so a
                tile in the first or last column had the outer half of its ring
                sliced off by the scroll edge. The padding is the room the ring
                needs; the negative margin keeps the grid itself as wide as it
                was, so the tile count per row does not change. */}
            <div
              style={{
                flex: 1,
                minBlockSize: 0,
                overflowY: 'auto',
                padding: 'var(--tp-focus-room)',
                margin: 'calc(-1 * var(--tp-focus-room))',
              }}
            >
              <MenuItemGrid
                items={visibleItems}
                availability={menuQ.data?.availability ?? {}}
                hasActiveTab={hasActiveTab}
                today={today}
                onPick={addOrOpen}
                onOpenSheet={setSheetItem}
                emptyText={filtering ? tr('ws.cashier.till.noMatches', { query: filter.trim() }) : tr('ws.cashier.till.noItems')}
              />
              {showLegend && <TileLegend />}
            </div>
          </AsyncStateWrapper>

          {/* Reserved, not emergent: see BASKET_BLOCK_SIZE. The grid above keeps
              exactly the same height from the first item of the shift to the
              last, so a finger already travelling to a tile still lands on it. */}
          {/* Holds the basket's CLOSED height in the column, so the item grid
              ends where it always did; the basket itself is lifted out of the
              flow over this spacer and grows upward from the same bottom
              edge. */}
          <div
            aria-hidden="true"
            style={{
              flex: '0 0 auto',
              blockSize: `calc(${BASKET_BLOCK_SIZE} + 2 * var(--tp-sp-2-5))`,
            }}
          />
          <div
            style={{
              /* The basket keeps the natural order — heading, lines, estimate,
                 Send — and grows UPWARD when it opens: the whole box is lifted
                 out of the column and pinned to the pane's bottom edge, so its
                 bottom never moves however tall it gets and the extra height
                 is taken off the item grid above. Leaving it in the column
                 made a taller box grow at both ends, which is what carried
                 Send and the estimated total down the screen. */
              position: 'absolute',
              insetInline: 0,
              insetBlockEnd: 0,
              background: 'var(--tp-bg)',
              borderBlockStart: '1px solid var(--tp-border)',
              /* Padded at BOTH ends like the pay footer opposite it: with a
                 start pad only, Send sat flush to the window edge while Cash
                 and Card floated 0.625rem above it, and the three buttons that
                 are meant to read as one family sat on two different lines. */
              paddingBlock: 'var(--tp-sp-2-5)',
            }}
          >
            <Basket
              expanded={basketExpanded}
              onToggleExpanded={() => setBasketExpanded((v) => !v)}
              lines={basket}
              forLabel={selectedLabel}
              sending={sending}
              error={sendError}
              canSend={basket.length > 0}
              onBump={bumpBasketQty}
              onNote={setNoteLineKey}
              onRemove={(key) => setBasket((b) => b.filter((x) => x.key !== key))}
              onClear={() => setBasket([])}
              onSend={() => void sendBasket()}
            />
          </div>
        </section>

        {/*
          ---- the tab ----
          The column does NOT scroll: TabDetailPanel scrolls inside itself so its
          identity header and its pay footer stay pinned (rulebook 5.2 and 11.5).
          A scroll here would let the Cash button drift with the line count.
        */}
        <aside
          style={{
            minBlockSize: 0,
            minInlineSize: 0,
            display: 'flex',
            flexDirection: 'column',
            borderInlineStart: '1px solid var(--tp-border)',
            paddingInline: 'var(--tp-sp-3)',
          }}
        >
          {!selectedIsOffline && (
            <TabDetailPanel
              tabId={selectedTabId}
              onClosedTab={() => {
                setSelectedTabId(null);
                void queryClient.invalidateQueries({ queryKey: ['tabs'] });
                void queryClient.invalidateQueries({ queryKey: ['tillCourts'] });
              }}
              onSwitchTab={(id) => {
                setSelectedTabId(id);
                setBasket([]);
              }}
            />
          )}
          {selectedIsOffline && (
            <div style={{ minBlockSize: 0, overflowY: 'auto' }}>
              <OfflineTabPanel idemKey={selectedTabId.slice(LOCAL_TAB_PREFIX.length)} onSettled={() => setSelectedTabId(null)} />
            </div>
          )}
        </aside>
      </div>
      {overlays}
    </div>
  );
}
