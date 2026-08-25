'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Locale } from '@touch/i18n';
import type { CafeSettings, MenuCategory, MenuItem, VenueOpeningHours } from '@/lib/menu';
import type { MenuStatus } from '@/lib/menu.server';
import type { ItemSource } from '@/lib/analytics/track';
import { track } from '@/lib/analytics/track';
import { AnalyticsProvider } from '@/lib/analytics/AnalyticsProvider';
import { tap } from '@/lib/haptics';
import {
  useBasket,
  useHeroCollapse,
  useMenu,
  useOnline,
  useOrders,
  useScrollSpy,
  useSessionChannel,
  useSupabase,
  useTableSession,
  useVenueMode,
  useWaiterCall,
} from '@/hooks/cafe';
import { useToasts } from '@/hooks/cafe/useToasts';
import { OfflineBanner } from './OfflineBanner/OfflineBanner';
import { TopBar } from './TopBar/TopBar';
import { Hero } from './Hero/Hero';
import { CategoryPills } from './CategoryPills/CategoryPills';
import { OrdersStrip } from './OrdersStrip/OrdersStrip';
import { MenuStage } from './MenuStage/MenuStage';
import { MenuUnavailable } from './MenuUnavailable/MenuUnavailable';
import { Footer } from './Footer/Footer';
import { ScrollTopFab } from './ScrollTopFab/ScrollTopFab';
import { WaiterButton } from './WaiterButton/WaiterButton';
import { Ticker } from './Ticker/Ticker';
import { CafeOverlays } from './CafeOverlays';
import { hasSeenBellTutorial } from './BellTutorial/BellTutorial';
import { useCafeActions } from './useCafeActions';

/**
 * Guest app orchestrator. It owns OVERLAY STATE ONLY — data lives in the
 * `hooks/cafe` hooks, actions live in `useCafeActions`, pixels live in the
 * presentational components. The menu arrives server-rendered (`initialMenu`)
 * and is readable before any of this runs; table binding, basket, orders and
 * realtime layer on top of it.
 */
export interface CafeAppProps {
  locale: Locale;
  /** null = browsing without a table (site root) */
  token: string | null;
  initialMenu: MenuCategory[];
  menuStatus: MenuStatus;
  settings: CafeSettings;
  venue: VenueOpeningHours | null;
}

const SCROLL_TOP_FAB_AT = 320;

export function CafeApp({
  locale,
  token,
  initialMenu,
  menuStatus,
  settings: initialSettings,
  venue,
}: CafeAppProps) {
  const supabase = useSupabase();
  const online = useOnline();
  const toasts = useToasts();

  const table = useTableSession(token);
  const menu = useMenu({ menu: initialMenu, status: menuStatus }, initialSettings, supabase);
  const basket = useBasket(table.session?.tableId ?? null, menu.featured);
  const { degraded } = useVenueMode(supabase);
  const orders = useOrders(supabase, table.session?.sessionId ?? null);
  const waiter = useWaiterCall(supabase, table.session);

  useSessionChannel(supabase, table.session?.sessionId ?? null, {
    onOrderStatus: (p) => orders.applyStatus(p.order_id, p.status),
    onWaiterCallStatus: waiter.applyStatus,
  });

  // ------------------------------------------------------------ overlay state
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [ordersOpen, setOrdersOpen] = useState(false);
  const [qrRequired, setQrRequired] = useState<'order' | 'waiter' | null>(null);
  const [sending, setSending] = useState(false);
  const [footerVisible, setFooterVisible] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [tutorialOpen, setTutorialOpen] = useState(false);
  const sourceRef = useRef<ItemSource>('list');

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement | null>(null);

  const collapsed = useHeroCollapse(scrollRef, sentinelRef);
  const categoryIds = useMemo(() => menu.menu.map((c) => c.id), [menu.menu]);
  const spy = useScrollSpy(scrollRef, categoryIds);
  const anySheet =
    sheetItem !== null || basketOpen || waiterOpen || ordersOpen || qrRequired !== null;

  const actions = useCafeActions({
    locale,
    supabase,
    table,
    menu,
    basket,
    orders,
    waiter,
    toasts,
    sourceRef,
    setSheetItem,
    setBasketOpen,
    setWaiterOpen,
    setQrRequired,
    setSending,
    setTutorialOpen,
  });

  // Coach mark: bound table + live bell + operator switch on, once per browser
  // session, and never over a sheet (web-slice §2).
  useEffect(() => {
    if (
      table.state !== 'bound' ||
      !table.bellEnabled ||
      !menu.settings.bell_tutorial_enabled ||
      anySheet ||
      hasSeenBellTutorial()
    ) {
      return;
    }
    setTutorialOpen(true);
  }, [table.state, table.bellEnabled, menu.settings.bell_tutorial_enabled, anySheet]);

  const dismissTutorial = useCallback(() => setTutorialOpen(false), []);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (el) setScrolled(el.scrollTop > SCROLL_TOP_FAB_AT);
  }, []);

  const openBasket = useCallback(() => {
    setBasketOpen(true);
    track.basketOpened({
      item_count: basket.count,
      total_iqd: basket.total,
      has_table: table.session !== null,
    });
  }, [basket.count, basket.total, table.session]);

  return (
    <div className="tp-app" data-theme="cafe">
      <AnalyticsProvider locale={locale} tableNumber={table.session?.tableNumber ?? null} />
      <OfflineBanner locale={locale} online={online} />
      <TopBar
        locale={locale}
        token={token}
        sessionState={table.state}
        session={table.session}
        basketCount={basket.count}
        basketTotal={basket.total}
        onOpenBasket={openBasket}
        onNeedsRescan={() => actions.requireQr('order')}
      />

      {/* The ONLY scroller in the app (the shell is position: fixed). */}
      <div className="tp-app__scroll" ref={scrollRef} onScroll={onScroll} inert={anySheet}>
        <Hero
          locale={locale}
          settings={menu.settings}
          featured={menu.featured}
          itemCount={menu.itemsById.size}
          venue={venue}
          collapsed={collapsed}
          onOpenFeatured={(item) => {
            track.featuredItemClicked({ item_id: item.id });
            actions.openItem(item, 'featured');
          }}
        />
        <div data-hero-sentinel="" ref={sentinelRef} />

        <CategoryPills
          locale={locale}
          categories={menu.menu}
          activeId={spy.activeId}
          compact={collapsed}
          onSelect={(cat) => {
            tap();
            spy.jumpTo(cat.id);
            track.categorySelected({ category_id: cat.id, category_name_en: cat.name_en });
          }}
        />

        <main className="tp-container">
          <OrdersStrip locale={locale} live={orders.live} onOpen={() => setOrdersOpen(true)} />
          {menu.status === 'ok' ? (
            <MenuStage
              locale={locale}
              categories={menu.menu}
              onOpenItem={(item) => actions.openItem(item, 'list')}
            />
          ) : (
            <MenuUnavailable
              locale={locale}
              retrying={menu.refreshing}
              onRetry={() => void actions.refreshAndReconcile()}
            />
          )}
        </main>

        <Footer locale={locale} venue={venue} onVisibilityChange={setFooterVisible} />
      </div>

      <WaiterButton
        ref={bellRef}
        locale={locale}
        visible={(table.bellEnabled || table.state === 'none') && !anySheet && !footerVisible}
        phase={waiter.phase}
        cooldownLeftMs={waiter.cooldownLeftMs}
        onClick={actions.bellTapped}
      />
      <ScrollTopFab
        locale={locale}
        visible={scrolled && !footerVisible && !anySheet}
        onClick={() => scrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' })}
      />
      <Ticker locale={locale} settings={menu.settings} />

      <CafeOverlays
        locale={locale}
        settings={menu.settings}
        itemsById={menu.itemsById}
        item={sheetItem}
        basketOpen={basketOpen}
        waiterOpen={waiterOpen}
        ordersOpen={ordersOpen}
        qrRequired={qrRequired}
        tutorialOpen={tutorialOpen}
        lines={basket.lines}
        note={basket.note}
        subtotal={basket.subtotal}
        discountTotal={basket.discountTotal}
        total={basket.total}
        sending={sending}
        degraded={degraded || !online}
        tableBound={table.state === 'bound'}
        waiterPhase={waiter.phase}
        cooldownLeftMs={waiter.cooldownLeftMs}
        liveOrders={orders.live}
        earlierOrders={orders.earlier}
        toast={toasts.toast}
        bellRef={bellRef}
        onCloseItem={() => setSheetItem(null)}
        onAddLine={actions.addLine}
        onOpenSuggested={(item) => {
          if (sheetItem) track.suggestedItemClicked({ item_id: item.id, from_item_id: sheetItem.id });
          actions.openItem(item, 'suggested');
        }}
        onItemViewed={actions.itemViewed}
        onItemAbandoned={actions.itemAbandoned}
        onCloseBasket={() => setBasketOpen(false)}
        onSetQty={basket.setQty}
        onRemoveLine={actions.removeLine}
        onSetNote={basket.setNote}
        onSubmit={() => void actions.submit()}
        onPickReason={(reason) => void actions.raiseCall(reason)}
        onCloseWaiter={() => setWaiterOpen(false)}
        onCloseOrders={() => setOrdersOpen(false)}
        onCloseQr={() => setQrRequired(null)}
        onDismissTutorial={dismissTutorial}
        onDismissToast={toasts.dismiss}
      />
    </div>
  );
}
