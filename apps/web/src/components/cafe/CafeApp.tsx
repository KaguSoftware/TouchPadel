'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeT, formatIQD, isolate, type Locale } from '@touch/i18n';
import { makeIdempotencyKey } from '@touch/core';
import { createBrowserSupabase, type BrowserSupabase } from '@/lib/supabase/client';
import { appRpc, isRpcError, rpcErrorKey } from '@/lib/appRpc';
import { fetchMenu, type MenuCategory, type MenuItem } from '@/lib/menu';
import {
  basketCount,
  basketTotal,
  loadDraft,
  saveDraft,
  toOrderPayload,
  type BasketLine,
} from '@/lib/cafe/basket';
import { otherLocale } from '@/lib/locales';
import { ItemSheet } from './ItemSheet';
import { BasketSheet } from './BasketSheet';
import { OrdersPanel, type GuestOrder } from './OrdersPanel';
import { WaiterSheet, type WaiterCallState } from './WaiterSheet';

interface SessionInfo {
  sessionId: string;
  tableId: string;
  tableNumber: string;
  expiresAt: string;
}

type Phase =
  | { name: 'connecting' }
  | { name: 'invalid' } // bad / rotated token
  | { name: 'expired' } // inactivity expiry — re-scan prompt
  | { name: 'error' }
  | { name: 'ready'; session: SessionInfo };

const VENUE_MODE_POLL_MS = 30_000;
const WAITER_POLL_MS = 20_000;

export function CafeApp({ locale, token }: { locale: Locale; token: string }) {
  const tr = useMemo(() => makeT(locale), [locale]);
  const supabaseRef = useRef<BrowserSupabase | null>(null);
  const supabase = () => (supabaseRef.current ??= createBrowserSupabase());

  const [phase, setPhase] = useState<Phase>({ name: 'connecting' });
  const [menu, setMenu] = useState<MenuCategory[]>([]);
  const [activeCat, setActiveCat] = useState<string | null>(null);
  const [degraded, setDegraded] = useState(false);
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [waiterCall, setWaiterCall] = useState<WaiterCallState>(null);
  const [toast, setToast] = useState<{ text: string; kind: 'info' | 'error' } | null>(null);
  const [sending, setSending] = useState(false);
  const orderIdemKey = useRef<string | null>(null);
  const expiryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setToast({ text, kind });
    setTimeout(() => setToast((t) => (t?.text === text ? null : t)), 6000);
  }, []);

  // ------------------------------------------------------------------ boot
  useEffect(() => {
    let cancelled = false;
    const sb = supabase();
    (async () => {
      const { data: sessionData } = await sb.auth.getSession();
      if (!sessionData.session) {
        const { error } = await sb.auth.signInAnonymously();
        if (error) {
          if (!cancelled) setPhase({ name: 'error' });
          return;
        }
      }
      const { data, error } = await appRpc(sb, 'open_table_session', { p_token: token });
      if (cancelled) return;
      if (error) {
        setPhase(isRpcError(error, 'TOKEN_INVALID') ? { name: 'invalid' } : { name: 'error' });
        return;
      }
      const row = data as {
        session_id: string;
        table_id: string;
        table_number: string;
        expires_at: string;
      };
      setPhase({
        name: 'ready',
        session: {
          sessionId: row.session_id,
          tableId: row.table_id,
          tableNumber: row.table_number,
          expiresAt: row.expires_at,
        },
      });
    })().catch(() => {
      if (!cancelled) setPhase({ name: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const session = phase.name === 'ready' ? phase.session : null;

  // -------------------------------------------------- expiry: re-scan prompt
  const armExpiry = useCallback((expiresAt: string) => {
    if (expiryTimer.current) clearTimeout(expiryTimer.current);
    const ms = new Date(expiresAt).getTime() - Date.now();
    if (ms <= 0) {
      setPhase({ name: 'expired' });
      return;
    }
    expiryTimer.current = setTimeout(() => setPhase({ name: 'expired' }), ms);
  }, []);

  useEffect(() => {
    if (session) armExpiry(session.expiresAt);
    return () => {
      if (expiryTimer.current) clearTimeout(expiryTimer.current);
    };
  }, [session, armExpiry]);

  /** Writes slide expires_at server-side (touch_guest_session); re-read + re-arm. */
  const refreshExpiry = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase()
      .from('guest_sessions')
      .select('expires_at')
      .eq('id', session.sessionId)
      .maybeSingle();
    if (data?.expires_at) armExpiry(data.expires_at);
  }, [session, armExpiry]);

  // ------------------------------------------------------------- menu load
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    fetchMenu(supabase())
      .then((cats) => {
        if (cancelled) return;
        setMenu(cats);
        setActiveCat((c) => c ?? cats[0]?.id ?? null);
      })
      .catch(() => showToast(tr('errors.network'), 'error'));
    return () => {
      cancelled = true;
    };
  }, [session, showToast, tr]);

  // ----------------------------------------------------------- basket draft
  useEffect(() => {
    if (session) setBasket(loadDraft(session.tableId));
  }, [session]);
  useEffect(() => {
    if (session) saveDraft(session.tableId, basket);
  }, [session, basket]);

  // -------------------------------------------------------- degraded poll
  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    const check = async () => {
      const { data } = await appRpc(supabase(), 'venue_mode');
      if (!cancelled && data && typeof data === 'object') {
        setDegraded(Boolean((data as { degraded?: boolean }).degraded));
      }
    };
    void check();
    const id = setInterval(check, VENUE_MODE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [session]);

  // ------------------------------------------------------------ own orders
  const loadOrders = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase()
      .from('orders')
      .select(
        `id, status, placed_at,
         order_items ( id, qty, line_total_iqd, voided,
           menu_items ( name_en, name_ar ),
           menu_item_variants ( name_en, name_ar ) )`,
      )
      .eq('guest_session_id', session.sessionId)
      .order('placed_at', { ascending: false });
    if (data) {
      setOrders(
        data.map((o) => ({
          id: o.id,
          status: o.status,
          placed_at: o.placed_at,
          items: (o.order_items ?? [])
            .filter((oi) => !oi.voided)
            .map((oi) => ({
              id: oi.id,
              qty: oi.qty,
              line_total_iqd: oi.line_total_iqd,
              name_en: oi.menu_items?.name_en ?? '',
              name_ar: oi.menu_items?.name_ar ?? '',
              variant_en: oi.menu_item_variants?.name_en ?? '',
              variant_ar: oi.menu_item_variants?.name_ar ?? '',
            })),
        })),
      );
    }
  }, [session]);

  useEffect(() => {
    void loadOrders();
  }, [loadOrders]);

  // ------------------------------------- live order status: session:{id} topic
  useEffect(() => {
    if (!session) return;
    const sb = supabase();
    // Private broadcast channel (0022): realtime auth carries the anonymous
    // JWT; RLS on realtime.messages checks the topic suffix is OUR live session.
    void sb.realtime.setAuth();
    const channel = sb
      .channel(`session:${session.sessionId}`, { config: { private: true } })
      .on('broadcast', { event: 'order_status' }, (msg) => {
        const payload = msg.payload as { order_id?: string; status?: GuestOrder['status'] };
        if (!payload?.order_id || !payload.status) return;
        setOrders((prev) => {
          const known = prev.some((o) => o.id === payload.order_id);
          if (!known) {
            void loadOrders();
            return prev;
          }
          return prev.map((o) =>
            o.id === payload.order_id ? { ...o, status: payload.status! } : o,
          );
        });
      })
      .subscribe();
    return () => {
      void sb.removeChannel(channel);
    };
  }, [session, loadOrders]);

  // ------------------------------------------------ waiter call state (poll)
  // 0022 broadcasts waiter calls to the staff-only 'floor' topic — guests
  // cannot subscribe, so resolution arrives via a light poll of our own call.
  useEffect(() => {
    if (!session || !waiterCall || waiterCall.status === 'resolved') return;
    const id = setInterval(async () => {
      const { data } = await supabase()
        .from('waiter_calls')
        .select('id, status')
        .eq('id', waiterCall.callId)
        .maybeSingle();
      if (data && data.status !== waiterCall.status) {
        setWaiterCall({ callId: data.id, status: data.status });
        if (data.status === 'resolved') showToast(tr('cafe.waiterResolved'));
      }
    }, WAITER_POLL_MS);
    return () => clearInterval(id);
  }, [session, waiterCall, showToast, tr]);

  // --------------------------------------------------------------- actions
  const addLine = useCallback(
    (line: BasketLine) => {
      setBasket((prev) => [...prev, line]);
      setSheetItem(null);
      showToast(tr('cafe.addedToBasket'));
    },
    [showToast, tr],
  );

  const submitOrder = useCallback(async () => {
    if (!session || basket.length === 0 || sending) return;
    setSending(true);
    // One idempotency key per attempt batch — kept across retries, cleared on success.
    orderIdemKey.current ??= makeIdempotencyKey('WEB', 'order.create');
    const { error } = await appRpc(supabase(), 'create_guest_order', {
      p_items: toOrderPayload(basket) as never,
      p_idempotency_key: orderIdemKey.current,
    });
    setSending(false);
    if (error) {
      if (isRpcError(error, 'SESSION_EXPIRED')) {
        setPhase({ name: 'expired' });
        return;
      }
      if (isRpcError(error, 'DEGRADED_LOCKOUT')) setDegraded(true);
      showToast(tr(rpcErrorKey(error)), 'error');
      return;
    }
    orderIdemKey.current = null;
    setBasket([]);
    setBasketOpen(false);
    showToast(tr('cafe.orderPlaced'));
    void loadOrders();
    void refreshExpiry();
  }, [session, basket, sending, showToast, tr, loadOrders, refreshExpiry]);

  const raiseCall = useCallback(
    async (reason: 'order' | 'bill' | 'water' | 'assistance') => {
      setWaiterOpen(false);
      const { data, error } = await appRpc(supabase(), 'raise_waiter_call', { p_reason: reason });
      if (error) {
        if (isRpcError(error, 'SESSION_EXPIRED')) {
          setPhase({ name: 'expired' });
          return;
        }
        if (isRpcError(error, 'DEGRADED_LOCKOUT')) {
          setDegraded(true);
          showToast(tr('degraded.waiterCallRefused'), 'error');
          return;
        }
        // ALREADY_NOTIFIED / CALL_COOLDOWN — cooldown feedback, not an error tone.
        showToast(tr(rpcErrorKey(error)), 'info');
        return;
      }
      const row = data as { call_id: string; status: 'raised' };
      setWaiterCall({ callId: row.call_id, status: row.status });
      showToast(tr('cafe.waiterCalled'));
      void refreshExpiry();
    },
    [showToast, tr, refreshExpiry],
  );

  // ----------------------------------------------------------------- render
  const other = otherLocale(locale);

  if (phase.name !== 'ready' || !session) {
    return (
      <div className="tp-cafe" data-theme="cafe">
        <main className="tp-boot">
          {phase.name === 'connecting' && <p>{tr('cafe.linkingTable')}</p>}
          {phase.name === 'invalid' && (
            <>
              <h1>{tr('common.cafeName')}</h1>
              <p>{tr('cafe.invalidQr')}</p>
            </>
          )}
          {phase.name === 'expired' && (
            <>
              <h1>{tr('common.cafeName')}</h1>
              <p>{tr('errors.sessionTableExpired')}</p>
              <p style={{ fontWeight: 700 }}>{tr('cafe.scanAgain')}</p>
            </>
          )}
          {phase.name === 'error' && (
            <>
              <h1>{tr('common.cafeName')}</h1>
              <p>{tr('errors.generic')}</p>
              <button className="tp-btn tp-btn--primary" onClick={() => window.location.reload()}>
                {tr('common.retry')}
              </button>
            </>
          )}
        </main>
      </div>
    );
  }

  const count = basketCount(basket);
  const activeCategory = menu.find((c) => c.id === activeCat) ?? menu[0];

  return (
    <div className="tp-cafe tp-page-with-bar" data-theme="cafe">
      <header className="tp-cafe__topbar">
        <div className="tp-container tp-cafe__topbar-inner">
          <strong>{tr('common.cafeName')}</strong>
          <span className="tp-cafe__table">
            {tr('cafe.tableLabel', { table: isolate(session.tableNumber) })}
          </span>
          <Link href={`/${other}/t/${token}`} lang={other}>
            {other === 'ar' ? 'العربية' : 'English'}
          </Link>
        </div>
      </header>
      {/* SOW: ordering is NOT paying — persistent notice. */}
      <div className="tp-paynotice">{tr('cafe.payAtDesk')}</div>

      <main className="tp-container">
        {degraded && (
          <div className="tp-banner tp-banner--warn" role="status">
            {tr('degraded.orderingRefused')} {tr('degraded.readOnlyNotice')}
          </div>
        )}
        {toast && (
          <div
            className={`tp-banner ${toast.kind === 'error' ? 'tp-banner--error' : 'tp-banner--info'}`}
            role="status"
          >
            {toast.text}
          </div>
        )}

        {waiterCall && waiterCall.status !== 'resolved' && (
          <div className="tp-banner tp-banner--info" role="status">
            {tr('cafe.waiterCalled')}
          </div>
        )}

        <OrdersPanel orders={orders} locale={locale} />

        <nav className="tp-cattabs" aria-label={tr('cafe.menu')}>
          {menu.map((cat) => (
            <button
              key={cat.id}
              aria-current={cat.id === activeCategory?.id}
              onClick={() => setActiveCat(cat.id)}
            >
              {locale === 'ar' ? cat.name_ar : cat.name_en}
            </button>
          ))}
        </nav>

        {activeCategory && (
          <section className="tp-menu-cat" style={{ marginBlockStart: 0 }}>
            {activeCategory.items.map((item) => (
              <CafeMenuRow
                key={item.id}
                item={item}
                locale={locale}
                unavailableLabel={tr('cafe.itemUnavailable')}
                onOpen={() => item.orderable && setSheetItem(item)}
              />
            ))}
          </section>
        )}
      </main>

      <div className="tp-basketbar">
        <div className="tp-container tp-basketbar__inner">
          <button className="tp-btn tp-btn--ghost" onClick={() => setWaiterOpen(true)}>
            {tr('cafe.callWaiter')}
          </button>
          <span className="tp-header__spacer" />
          <button
            className="tp-btn tp-btn--primary"
            disabled={count === 0}
            onClick={() => setBasketOpen(true)}
          >
            {tr('cafe.viewBasket', { count })} · {formatIQD(basketTotal(basket), locale)}
          </button>
        </div>
      </div>

      {sheetItem && (
        <ItemSheet item={sheetItem} locale={locale} onAdd={addLine} onClose={() => setSheetItem(null)} />
      )}
      {basketOpen && (
        <BasketSheet
          lines={basket}
          locale={locale}
          degraded={degraded}
          sending={sending}
          onRemove={(key) => setBasket((prev) => prev.filter((l) => l.key !== key))}
          onSubmit={submitOrder}
          onClose={() => setBasketOpen(false)}
        />
      )}
      {waiterOpen && (
        <WaiterSheet locale={locale} degraded={degraded} onPick={raiseCall} onClose={() => setWaiterOpen(false)} />
      )}
    </div>
  );
}

function CafeMenuRow({
  item,
  locale,
  unavailableLabel,
  onOpen,
}: {
  item: MenuItem;
  locale: Locale;
  unavailableLabel: string;
  onOpen: () => void;
}) {
  const ar = locale === 'ar';
  const fromPrice = item.variants.reduce(
    (min, v) => Math.min(min, v.price_iqd),
    Number.MAX_SAFE_INTEGER,
  );
  return (
    <article
      className={item.orderable ? 'tp-menu-item' : 'tp-menu-item tp-menu-item--off'}
      onClick={onOpen}
      role={item.orderable ? 'button' : undefined}
      tabIndex={item.orderable ? 0 : undefined}
      onKeyDown={(e) => {
        if (item.orderable && (e.key === 'Enter' || e.key === ' ')) {
          e.preventDefault();
          onOpen();
        }
      }}
    >
      <div className="tp-menu-item__body">
        <div className="tp-menu-item__name">{ar ? item.name_ar : item.name_en}</div>
        {(ar ? item.description_ar : item.description_en) && (
          <p className="tp-menu-item__desc">{ar ? item.description_ar : item.description_en}</p>
        )}
        {(item.allergens.length > 0 || !item.orderable) && (
          <div className="tp-chips">
            {item.allergens.map((a) => (
              <span key={a.code} className="tp-chip">
                {ar ? a.label_ar : a.label_en}
              </span>
            ))}
            {!item.orderable && <span className="tp-chip tp-chip--muted">{unavailableLabel}</span>}
          </div>
        )}
      </div>
      <div className="tp-menu-item__prices">
        {fromPrice !== Number.MAX_SAFE_INTEGER && <span>{formatIQD(fromPrice, locale)}</span>}
      </div>
    </article>
  );
}
