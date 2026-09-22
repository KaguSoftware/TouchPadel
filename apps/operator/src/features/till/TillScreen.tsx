/**
 * TillScreen (spec 06.11) — the cashier's landing screen and the fastest
 * surface in the app. Three regions:
 *
 *   inline-start  waiter calls (persistent, chimes) + the open-tabs rail
 *   centre        filter, category strip (1–9), item grid, basket
 *   inline-end    the active tab: lines, totals, promotion, payment, actions
 *
 * Every write is an app.* RPC through mutate(); prices always come back from
 * the server. Offline: tabs opened while disconnected live in the durable
 * queue (lib/offlineTabs) and show in the rail until their open replays.
 *
 * States: loading (menu skeleton) · ready · noActiveTab (grid visible, tiles
 * inert, prompt in the end region) · error (menu unreachable, retry) · busy
 * (sending — the basket's button carries it).
 *
 * Keymap: keymap.ts (one table feeds the handler and the help popover).
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearch } from '@tanstack/react-router';
import { mutate } from '../../lib/mutate';
import { LOCAL_TAB_PREFIX, appendOfflineLines, listOfflineTabs, subscribeOfflineTabs } from '../../lib/offlineTabs';
import { QK, fetchOpenDay } from '../../lib/queries';
import { useBroadcast } from '../../lib/realtime';
import { chime, StartShiftBanner } from '../../lib/audio';
import { useConfirm } from '../../components/ConfirmDialog';
import { useToast } from '../../components/toast';
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Skeleton, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, Kbd } from '../../components/kit';
import { WaiterCallsPanel } from './WaiterCallsPanel';
import { TabRail } from './TabRail';
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
  const [sendError, setSendError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [newTab, setNewTab] = useState<{ reservationId?: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const wedgeRef = useRef(new BarcodeWedge());
  const today = useMemo(() => localIsoDate(), []);

  // Tabs opened while disconnected — durable in the queue, listed in the rail.
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

  function bumpBasketQty(key: string, delta: number) {
    setBasket((b) => b.map((l) => (l.key === key ? { ...l, qty: l.qty + delta } : l)).filter((l) => l.qty > 0));
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
  // Rulebook 4.3 — the reason travels with the control, not in a tooltip. The
  // empty case already says so in the basket's own body, so only the missing
  // tab needs stating here.
  const sendBlockedReason = !hasActiveTab ? tr('ws.cashier.till.tile.noTab') : undefined;
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

  return (
    <div
      style={{
        display: 'grid',
        // Proportional, so the side columns give way with the menu rather than
        // before it: with fixed 13–15rem / 20–23rem sides the grid filled both
        // sides first, and at 1100px the menu and basket were left ~280px and
        // Send ran over the pay column. At 1440px this is the same ~14rem /
        // ~23rem split as before.
        gridTemplateColumns: 'minmax(11rem, 0.6fr) minmax(17rem, 1.6fr) minmax(16rem, 1fr)',
        gap: 'var(--tp-sp-4)',
        blockSize: '100%',
        minBlockSize: 0,
        alignItems: 'stretch',
      }}
    >
      {/*
        ---- inline-start: waiter calls + rail ----
        Two scrollers, not one. With a single scroller eight waiter calls
        pushed the open-tabs rail below the fold, and the rail is what the
        cashier reaches for on every sale. The calls keep at most about half
        the column and scroll inside it; the rail always has the rest.
      */}
      <aside style={{ minBlockSize: 0, minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-3)', paddingInlineEnd: 'var(--tp-sp-1)' }}>
        <StartShiftBanner />
        <div style={{ flex: '0 1 auto', maxBlockSize: '50%', minBlockSize: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <WaiterCallsPanel status={floorStatus} />
        </div>
        <div style={{ flex: '1 1 auto', minBlockSize: 0, overflowY: 'auto', overflowX: 'hidden' }}>
          <TabRail
          tabs={tabsQ.data ?? []}
          offlineTabs={offlineTabs}
          selectedId={selectedTabId}
          loading={tabsQ.isPending}
          onSelect={(id) => void selectTab(id)}
          onNew={() => setNewTab({})}
          onPrefetch={prefetchTab}
          />
        </div>
      </aside>

      {/* ---- centre: filter, categories, grid, basket ---- */}
      <section aria-label={tr('ws.cashier.till.regionMenu')} style={{ minBlockSize: 0, minInlineSize: 0, display: 'flex', flexDirection: 'column', gap: 'var(--tp-sp-2-5)' }}>
        <div style={{ display: 'flex', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
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
          <div style={{ flex: 1, minBlockSize: 0, overflowY: 'auto' }}>
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
        <div
          style={{
            flex: '0 0 auto',
            blockSize: BASKET_BLOCK_SIZE,
            borderBlockStart: '1px solid var(--tp-border)',
            paddingBlockStart: 'var(--tp-sp-2-5)',
          }}
        >
          <Basket
            lines={basket}
            forLabel={selectedLabel}
            sending={sending}
            error={sendError}
            canSend={hasActiveTab && basket.length > 0}
            blockedReason={sendBlockedReason}
            onBump={bumpBasketQty}
            onNote={setNoteLineKey}
            onRemove={(key) => setBasket((b) => b.filter((x) => x.key !== key))}
            onClear={() => setBasket([])}
            onSend={() => void sendBasket()}
          />
        </div>
      </section>

      {/*
        ---- inline-end: the active tab ----
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
        {!selectedTabId && (
          <div style={{ minBlockSize: 0, overflowY: 'auto' }}>
            <EmptyState
              icon="receipt"
              title={tr('ws.cashier.till.noActiveTab')}
              body={tr('ws.cashier.till.noActiveTabBody')}
              action={
                <Button kind="primary" icon="plus" onClick={() => setNewTab({})}>
                  {tr('ws.cashier.till.rail.newTab')} <Kbd>F6</Kbd>
                </Button>
              }
            />
          </div>
        )}
        {selectedTabId && !selectedIsOffline && (
          <TabDetailPanel
            tabId={selectedTabId}
            unsentCount={basket.length}
            onClosedTab={() => {
              setSelectedTabId(null);
              void queryClient.invalidateQueries({ queryKey: ['tabs'] });
            }}
            onSwitchTab={(id) => {
              setSelectedTabId(id);
              setBasket([]);
            }}
          />
        )}
        {selectedTabId && selectedIsOffline && (
          <div style={{ minBlockSize: 0, overflowY: 'auto' }}>
            <OfflineTabPanel idemKey={selectedTabId.slice(LOCAL_TAB_PREFIX.length)} onSettled={() => setSelectedTabId(null)} />
          </div>
        )}
      </aside>

      {/* ---- overlays ---- */}
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
            setSelectedTabId(tabId);
            setBasket([]);
            void queryClient.invalidateQueries({ queryKey: ['tabs'] });
            void queryClient.invalidateQueries({ queryKey: ['openTabReservations'] });
          }}
        />
      )}
      {helpOpen && <KeymapHelp onClose={() => setHelpOpen(false)} />}
    </div>
  );
}
