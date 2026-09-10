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
import { useLocale, pickName } from '../../lib/i18n';
import { Button, Skeleton, inputStyle } from '../../components/ui';
import { AsyncStateWrapper, EmptyState, Kbd } from '../../components/kit';
import { WaiterCallsPanel } from './WaiterCallsPanel';
import { TabRail } from './TabRail';
import { CategoryStrip, MenuItemGrid, TileLegend } from './TillGrid';
import { Basket } from './Basket';
import { ItemSheet } from './ItemSheet';
import { NewTabDialog } from './NewTabDialog';
import { TabDetailPanel } from './TabDetailPanel';
import { OfflineTabPanel } from './OfflineTabPanel';
import { KeymapHelp } from './KeymapHelp';
import { mergeQuickLine, quickVariant } from './quickAdd';
import { resolveTillKey } from './keymap';
import { localIsoDate, deriveTileState, tileInteractive } from './tileState';
import { OPEN_TABS_QUERY, TILL_MENU_QUERY, basketLineEstimate, fetchTabDetail, type BasketLine, type ItemRow } from './tillData';
import type { TillSearch } from './tillSearch';
import { BASKET_BLOCK_SIZE, muted } from './tillStyles';

export function TillScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const search = useSearch({ strict: false }) as TillSearch;

  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sheetItem, setSheetItem] = useState<ItemRow | null>(null);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [sendError, setSendError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [newTab, setNewTab] = useState<{ reservationId?: string } | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
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

  const categories = useMemo(() => (menuQ.data?.categories ?? []).filter((c) => c.is_active), [menuQ.data]);
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

  // ---- send basket ----------------------------------------------------------
  async function sendBasket() {
    if (!selectedTabId || basket.length === 0 || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const items = basket.map((l) => ({
        variantId: l.variantId,
        qty: l.qty,
        ...(l.notes ? { notes: l.notes } : {}),
        modifiers: l.modifiers.map((m) => ({ modifierId: m.modifierId, qty: m.qty })),
      }));
      // Single write path: queued durably in Electron, direct RPC in browser mode.
      if (selectedTabId.startsWith(LOCAL_TAB_PREFIX)) {
        const idemKey = selectedTabId.slice(LOCAL_TAB_PREFIX.length);
        await mutate('order.add_items', { tabIdemKey: idemKey, items });
        appendOfflineLines(
          idemKey,
          basket.map((l) => ({ name: `${l.itemName} (${l.variantName})`, qty: l.qty, priceIqd: basketLineEstimate(l) / l.qty })),
        );
      } else {
        await mutate('order.add_items', { tabId: selectedTabId, items });
      }
      setBasket([]);
      void queryClient.invalidateQueries({ queryKey: ['tab', selectedTabId] });
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
    } catch (e) {
      setSendError(e);
    } finally {
      setSending(false);
    }
  }

  // ---- keyboard (spec R11) ----------------------------------------------------
  const latest = useRef({ visibleItems, categories, sendBasket, addOrOpen });
  latest.current = { visibleItems, categories, sendBasket, addOrOpen };

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'));
      const action = resolveTillKey({
        key: e.key,
        inField,
        inFilter: target === filterRef.current,
        overlayOpen: Boolean(document.querySelector('[role="dialog"][aria-modal="true"]')),
        modifier: e.ctrlKey || e.metaKey || e.altKey,
      });
      if (action === null) return;
      const { visibleItems: visible, categories: cats, sendBasket: send, addOrOpen: add } = latest.current;
      if (typeof action === 'object') {
        const cat = cats[action.index];
        if (cat) {
          e.preventDefault();
          setCategoryId(cat.id);
          setFilter('');
        }
        return;
      }
      switch (action) {
        case 'send':
          e.preventDefault();
          void send();
          return;
        case 'cash':
        case 'card':
          // Opens the settle pane only — money is never CONFIRMED by keyboard.
          e.preventDefault();
          window.dispatchEvent(new CustomEvent('till-settle-hotkey', { detail: action }));
          return;
        case 'newTab':
          e.preventDefault();
          setNewTab({});
          return;
        case 'focusFilter':
          e.preventDefault();
          filterRef.current?.focus();
          filterRef.current?.select();
          return;
        case 'help':
          e.preventDefault();
          setHelpOpen(true);
          return;
        case 'quickAddFromFilter':
          // Type "wat", Enter, done — when exactly one visible item needs no choices.
          if (visible.length === 1 && quickVariant(visible[0]!)) {
            e.preventDefault();
            add(visible[0]!);
            setFilter('');
          }
          return;
        case 'typeToFilter':
          filterRef.current?.focus();
          return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
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

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(13rem, 15rem) minmax(0, 1fr) minmax(20rem, 23rem)',
        gap: 'var(--tp-sp-4)',
        blockSize: '100%',
        minBlockSize: 0,
        alignItems: 'stretch',
      }}
    >
      {/* ---- inline-start: waiter calls + rail ---- */}
      <aside style={{ minBlockSize: 0, minInlineSize: 0, overflowY: 'auto', overflowX: 'hidden', display: 'grid', gap: 'var(--tp-sp-3)', alignContent: 'start', paddingInlineEnd: 'var(--tp-sp-1)' }}>
        <StartShiftBanner />
        <WaiterCallsPanel status={floorStatus} />
        <TabRail
          tabs={tabsQ.data ?? []}
          offlineTabs={offlineTabs}
          selectedId={selectedTabId}
          loading={tabsQ.isPending}
          onSelect={(id) => void selectTab(id)}
          onNew={() => setNewTab({})}
          onPrefetch={prefetchTab}
        />
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
            <TileLegend />
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
            sending={sending}
            error={sendError}
            canSend={hasActiveTab && basket.length > 0}
            blockedReason={sendBlockedReason}
            onBump={bumpBasketQty}
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
      {newTab && (
        <NewTabDialog
          initialReservationId={newTab.reservationId}
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
