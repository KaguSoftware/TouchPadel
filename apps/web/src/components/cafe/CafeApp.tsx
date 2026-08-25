'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { makeT, formatIQD, isolate, type Locale } from '@touch/i18n';
import { makeIdempotencyKey, applyPctDiscountIqd } from '@touch/core';
import { createBrowserSupabase, type BrowserSupabase } from '@/lib/supabase/client';
import { appRpc, isRpcError, rpcErrorKey } from '@/lib/appRpc';
import {
  decorateFeatured,
  fetchMenu,
  type CafeSettings,
  type MenuCategory,
  type MenuItem,
} from '@/lib/menu';
import {
  basketCount,
  basketTotal,
  buildLine,
  clearDraft,
  loadDraft,
  mergeDrafts,
  saveDraft,
  toOrderPayload,
  type BasketLine,
} from '@/lib/cafe/basket';
import { LOCALE_COOKIE, otherLocale } from '@/lib/locales';
import type { MenuStatus } from '@/lib/menu.server';
import { ItemSheet } from './ItemSheet';
import { BasketSheet } from './BasketSheet';
import { OrdersPanel, type GuestOrder } from './OrdersPanel';
import { WaiterSheet, type WaiterCallState } from './WaiterSheet';
import { Wordmark } from './brand/Wordmark';
import { Swoosh } from './brand/Swoosh';
import { Loader } from './brand/Loader';

/**
 * FOUNDATION SHIM (web-slice §9 "Foundation"): the previous single-component
 * app, minimally adapted to the new page contract —
 *   • the menu arrives server-rendered via `initialMenu` (no blank-until-RPC);
 *   • table binding / basket send / orders / realtime run only when `token`
 *     is set; without a table the guest can browse + build a basket, and
 *     "send" / "call waiter" open the "scan the QR on your table" notice;
 *   • `menuStatus !== 'ok'` renders an explicit unavailable state + retry.
 * Wave 7 (hooks + core UI) replaces this file wholesale — do not grow it.
 */

interface SessionInfo {
  sessionId: string;
  tableId: string;
  tableNumber: string;
  expiresAt: string;
}

type Phase =
  | { name: 'none' } // no token: browse-only
  | { name: 'connecting' }
  | { name: 'invalid' } // bad / rotated token
  | { name: 'expired' } // inactivity expiry — re-scan prompt
  | { name: 'error' }
  | { name: 'ready'; session: SessionInfo };

const VENUE_MODE_POLL_MS = 30_000;
const WAITER_POLL_MS = 20_000;

type BootResult =
  | { name: 'invalid' }
  | { name: 'error' }
  | { name: 'ready'; session: SessionInfo };

/**
 * One shared boot per token (module scope). React StrictMode double-mounts
 * the boot effect in dev, and two PARALLEL anonymous sign-ins mint two anon
 * users racing for the auth cookie — sharing the in-flight promise makes any
 * concurrent mount reuse the first sign-in + table session.
 */
const bootCache = new Map<string, Promise<BootResult>>();

function bootSession(sb: BrowserSupabase, token: string): Promise<BootResult> {
  const cached = bootCache.get(token);
  if (cached) return cached;
  const p = (async (): Promise<BootResult> => {
    const { data: sessionData } = await sb.auth.getSession();
    if (!sessionData.session) {
      const { error } = await sb.auth.signInAnonymously();
      if (error) return { name: 'error' };
    }
    const { data, error } = await appRpc(sb, 'open_table_session', { p_token: token });
    if (error) return isRpcError(error, 'TOKEN_INVALID') ? { name: 'invalid' } : { name: 'error' };
    const row = data as {
      session_id: string;
      table_id: string;
      table_number: string;
      expires_at: string;
    };
    return {
      name: 'ready',
      session: {
        sessionId: row.session_id,
        tableId: row.table_id,
        tableNumber: row.table_number,
        expiresAt: row.expires_at,
      },
    };
  })().catch((): BootResult => ({ name: 'error' }));
  bootCache.set(token, p);
  // Only a successful boot stays cached — "Try again" must retry for real.
  void p.then((r) => {
    if (r.name !== 'ready') bootCache.delete(token);
  });
  return p;
}

export interface CafeAppProps {
  locale: Locale;
  /** null = browsing without a table (site root) */
  token: string | null;
  initialMenu: MenuCategory[];
  menuStatus: MenuStatus;
  settings: CafeSettings;
}

export function CafeApp({ locale, token, initialMenu, menuStatus, settings }: CafeAppProps) {
  const tr = useMemo(() => makeT(locale), [locale]);
  const supabaseRef = useRef<BrowserSupabase | null>(null);
  const supabase = () => (supabaseRef.current ??= createBrowserSupabase());

  const [phase, setPhase] = useState<Phase>(token ? { name: 'connecting' } : { name: 'none' });
  const [bootAttempt, setBootAttempt] = useState(0);
  const [menu, setMenu] = useState<MenuCategory[]>(() => decorateFeatured(initialMenu, settings));
  const [status, setStatus] = useState<MenuStatus>(menuStatus);
  const [retrying, setRetrying] = useState(false);
  const [degraded, setDegraded] = useState(false);
  const [orders, setOrders] = useState<GuestOrder[]>([]);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [draftReady, setDraftReady] = useState(false);
  const [sheetItem, setSheetItem] = useState<MenuItem | null>(null);
  const [basketOpen, setBasketOpen] = useState(false);
  const [waiterOpen, setWaiterOpen] = useState(false);
  const [qrRequired, setQrRequired] = useState<'order' | 'waiter' | null>(null);
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
    if (!token) return;
    let cancelled = false;
    setPhase({ name: 'connecting' });
    void bootSession(supabase(), token).then((result) => {
      if (cancelled) return;
      if (result.name === 'ready') setPhase({ name: 'ready', session: result.session });
      else if (result.name === 'invalid') setPhase({ name: 'invalid' });
      else setPhase({ name: 'error' });
    });
    return () => {
      cancelled = true;
    };
  }, [token, bootAttempt]);

  const session = phase.name === 'ready' ? phase.session : null;
  const tableId = session?.tableId ?? null;

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

  // ------------------------------------------------------------- menu refresh
  const refreshMenu = useCallback(async () => {
    setRetrying(true);
    try {
      const cats = await fetchMenu(supabase());
      setMenu(decorateFeatured(cats, settings));
      setStatus(cats.length > 0 ? 'ok' : 'empty');
    } catch {
      setStatus((s) => (s === 'ok' ? 'ok' : 'error'));
      showToast(tr('errors.network'), 'error');
    } finally {
      setRetrying(false);
    }
  }, [settings, showToast, tr]);

  // Once the table binds, re-read the live menu (availability may have moved
  // since the ISR snapshot); the SSR menu stays on screen meanwhile.
  useEffect(() => {
    if (session) void refreshMenu();
  }, [session, refreshMenu]);

  // ----------------------------------------------------------- basket draft
  // Draft v2 keyed per table ('walkin' before a QR bind); the walk-in draft
  // folds into the table draft on bind.
  useEffect(() => {
    if (tableId) {
      const merged = mergeDrafts(loadDraft(null), loadDraft(tableId));
      clearDraft(null);
      setBasket(merged.lines);
    } else {
      setBasket(loadDraft(null).lines);
    }
    setDraftReady(true);
  }, [tableId]);
  useEffect(() => {
    if (draftReady) saveDraft(tableId, { lines: basket, note: '', idemKey: null });
  }, [tableId, basket, draftReady]);

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

  const itemsById = useMemo(() => {
    const map = new Map<string, MenuItem>();
    for (const cat of menu) for (const it of cat.items) map.set(it.id, it);
    return map;
  }, [menu]);

  const sheetSuggestions = useMemo(() => {
    if (!sheetItem) return [];
    return sheetItem.suggestedItemIds
      .map((id) => itemsById.get(id))
      .filter((s): s is MenuItem => Boolean(s && s.orderable && s.variants.length > 0));
  }, [sheetItem, itemsById]);

  const addSuggestion = useCallback(
    (item: MenuItem) => {
      if (item.modifierGroups.some((g) => g.min_select > 0)) {
        setSheetItem(item);
        return;
      }
      const variant = item.variants.find((v) => v.is_default) ?? item.variants[0];
      if (!variant) return;
      setBasket((prev) => [...prev, buildLine(item, variant.id, 1, [], null)]);
      showToast(tr('cafe.addedToBasket'));
    },
    [showToast, tr],
  );

  const submitOrder = useCallback(async () => {
    if (basket.length === 0 || sending) return;
    if (!session) {
      setBasketOpen(false);
      setQrRequired('order');
      return;
    }
    setSending(true);
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

  const openWaiter = useCallback(() => {
    if (!session) {
      setQrRequired('waiter');
      return;
    }
    setWaiterOpen(true);
  }, [session]);

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

  const jumpTo = useCallback((id: string) => {
    document.getElementById(`cat-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, []);

  // ----------------------------------------------------------------- render
  const other = otherLocale(locale);
  const otherHref = token ? `/${other}/t/${token}` : `/${other}`;
  const rememberLocale = () => {
    document.cookie = `${LOCALE_COOKIE}=${other}; path=/; max-age=31536000; samesite=lax`;
  };
  const count = basketCount(basket);
  const ar = locale === 'ar';

  return (
    <div className="tp-cafe tp-page-with-bar" data-theme="cafe">
      <header className="tp-cafe__topbar">
        <div className="tp-container tp-cafe__topbar-inner">
          <Wordmark tone="onBlue" />
          {session && (
            <span className="tp-cafe__table">
              {tr('cafe.tableLabel', { table: isolate(session.tableNumber) })}
            </span>
          )}
          {phase.name === 'connecting' && (
            <span className="tp-cafe__table" data-state="binding">
              <Loader size="xs" tone="onDark" /> {tr('cafe.tableChipBinding')}
            </span>
          )}
          <a href={otherHref} lang={other} onClick={rememberLocale}>
            {tr('cafe.localeSwitch')}
          </a>
        </div>
      </header>
      <div className="tp-topbar__band" aria-hidden="true">
        <Swoosh />
      </div>
      {/* SOW: ordering is NOT paying — persistent notice. */}
      <div className="tp-paynotice">{tr('cafe.payAtDesk')}</div>

      <main className="tp-container">
        {phase.name === 'invalid' && (
          <div className="tp-banner tp-banner--error" role="status">
            {tr('cafe.invalidQr')}
          </div>
        )}
        {phase.name === 'expired' && (
          <div className="tp-banner tp-banner--warn" role="status">
            {tr('errors.sessionTableExpired')} <strong>{tr('cafe.scanAgain')}</strong>
          </div>
        )}
        {phase.name === 'error' && (
          <div className="tp-banner tp-banner--error" role="status">
            {tr('errors.generic')}{' '}
            <button
              type="button"
              className="tp-btn tp-btn--ghost"
              style={{ minBlockSize: '2rem', paddingBlock: '0.1rem' }}
              onClick={() => setBootAttempt((n) => n + 1)}
            >
              {tr('common.retry')}
            </button>
          </div>
        )}
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

        {session && <OrdersPanel orders={orders} locale={locale} />}

        {status !== 'ok' ? (
          <section className="tp-menu-unavailable" role="status">
            <Loader size="md" tone="onLight" />
            <h2>{tr('cafe.menuUnavailable.title')}</h2>
            <p>{tr('cafe.menuUnavailable.body')}</p>
            <button
              type="button"
              className="tp-btn tp-btn--primary"
              disabled={retrying}
              onClick={() => void refreshMenu()}
            >
              {tr('common.retry')}
            </button>
          </section>
        ) : (
          <>
            <nav className="tp-cattabs tp-cattabs--sticky" aria-label={tr('cafe.menu')}>
              {menu.map((cat) => (
                <button key={cat.id} type="button" onClick={() => jumpTo(cat.id)}>
                  {ar ? cat.name_ar : cat.name_en}
                </button>
              ))}
            </nav>

            {menu.map((cat) => (
              <section key={cat.id} id={`cat-${cat.id}`} className="tp-menu-cat">
                <h2>{ar ? cat.name_ar : cat.name_en}</h2>
                {cat.items.map((item) => (
                  <CafeMenuRow
                    key={item.id}
                    item={item}
                    locale={locale}
                    unavailableLabel={tr('cafe.itemUnavailable')}
                    soldOutLabel={tr('cafe.soldOut')}
                    onOpen={() => item.orderable && setSheetItem(item)}
                  />
                ))}
              </section>
            ))}
          </>
        )}
      </main>

      <div className="tp-basketbar">
        <div className="tp-container tp-basketbar__inner">
          <button type="button" className="tp-btn tp-btn--ghost" onClick={openWaiter}>
            {tr('cafe.callWaiter')}
          </button>
          <span className="tp-header__spacer" />
          <button
            type="button"
            className="tp-btn tp-btn--primary"
            disabled={count === 0}
            onClick={() => setBasketOpen(true)}
          >
            {tr('cafe.viewBasket', { count })} · {formatIQD(basketTotal(basket), locale)}
          </button>
        </div>
      </div>

      {sheetItem && (
        <ItemSheet
          item={sheetItem}
          locale={locale}
          onAdd={addLine}
          onClose={() => setSheetItem(null)}
          suggestions={sheetSuggestions}
          onAddSuggestion={addSuggestion}
        />
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
        <WaiterSheet
          locale={locale}
          degraded={degraded}
          onPick={raiseCall}
          onClose={() => setWaiterOpen(false)}
        />
      )}
      {qrRequired && (
        <>
          <div className="tp-sheet-backdrop" onClick={() => setQrRequired(null)} />
          <div
            className="tp-sheet tp-qr-required"
            role="dialog"
            aria-modal="true"
            aria-label={tr('cafe.qrRequired.title')}
          >
            <svg className="tp-qr-art" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
              <rect x="6" y="6" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="4" />
              <rect x="38" y="6" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="4" />
              <rect x="6" y="38" width="20" height="20" rx="3" fill="none" stroke="currentColor" strokeWidth="4" />
              <rect x="13" y="13" width="6" height="6" fill="currentColor" />
              <rect x="45" y="13" width="6" height="6" fill="currentColor" />
              <rect x="13" y="45" width="6" height="6" fill="currentColor" />
              <path d="M38 38h8v8h-8zM50 38h8v4h-8zM38 50h4v8h-4zM46 50h12v8H46z" fill="currentColor" />
            </svg>
            <h2>{tr('cafe.qrRequired.title')}</h2>
            <p>{tr(qrRequired === 'order' ? 'cafe.qrRequired.bodyOrder' : 'cafe.qrRequired.bodyWaiter')}</p>
            {qrRequired === 'order' && count > 0 && <p>{tr('cafe.qrRequired.keepBasket')}</p>}
            <button type="button" className="tp-btn tp-btn--primary" onClick={() => setQrRequired(null)}>
              {tr('common.ok')}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function CafeMenuRow({
  item,
  locale,
  unavailableLabel,
  soldOutLabel,
  onOpen,
}: {
  item: MenuItem;
  locale: Locale;
  unavailableLabel: string;
  soldOutLabel: string;
  onOpen: () => void;
}) {
  const ar = locale === 'ar';
  const fromPrice = item.variants.reduce(
    (min, v) => Math.min(min, v.price_iqd),
    Number.MAX_SAFE_INTEGER,
  );
  const hasPrice = fromPrice !== Number.MAX_SAFE_INTEGER;
  const hook = ar ? item.hook_ar : item.hook_en;
  const desc = ar ? item.description_ar : item.description_en;
  return (
    <article
      className={item.orderable ? 'tp-menu-item' : 'tp-menu-item tp-menu-item--off'}
      data-highlight={item.highlight !== 'none' ? item.highlight : undefined}
      data-sold-out={item.sold_out ? 'true' : undefined}
      data-unavailable={!item.orderable ? 'true' : undefined}
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
      {item.photo_url && (
        <div className="tp-menu-item__photo">
          <img src={item.photo_url} alt="" loading="lazy" decoding="async" />
        </div>
      )}
      <div className="tp-menu-item__body">
        <div className="tp-menu-item__name">{ar ? item.name_ar : item.name_en}</div>
        {hook && <div className="tp-menu-item__hook">{hook}</div>}
        {desc && <p className="tp-menu-item__desc">{desc}</p>}
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
        {hasPrice && item.discountPct > 0 ? (
          <>
            <span className="tp-price--struck">{formatIQD(fromPrice, locale)}</span>
            <span className="tp-price--promo">
              {formatIQD(applyPctDiscountIqd(fromPrice, item.discountPct), locale)}
            </span>
          </>
        ) : (
          hasPrice && <span>{formatIQD(fromPrice, locale)}</span>
        )}
      </div>
      {item.sold_out && <span className="tp-stamp">{soldOutLabel}</span>}
    </article>
  );
}
