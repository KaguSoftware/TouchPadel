/**
 * The Touch Shop till (0243–0246, docs/design/shop/shop-desk-2026-09-27.md):
 * scan a barcode or tap a product, the basket adds up, Cash or Card takes the
 * payment there and then, and the receipt prints. No table, no booking, no
 * kitchen: a shop sale is paid on the spot at the shop desk.
 *
 * One sale is one 'shop' tab (openTabOn kind shop, labelled with the time it
 * was rung up), its lines sent as one shop order (order.add_items shop: true)
 * and settled at once (tab.settle), through the same durable queue the café
 * till uses, so the shop keeps selling offline. The server takes shop lines
 * only on a shop tab and draws their stock from the shop store (0244, 0245).
 * The payment lands in the drawer of the till shift open at this PC.
 *
 * A sale rung up but not paid (the payment pane closed, a card declined) stays
 * open and is listed under Unfinished sales, where Take payment finishes it:
 * open tabs hold the day close (0216).
 *
 * A member (loyalty build contracts §5) is identified before the sale exists: the Member button,
 * or a scanner burst that is a member card (TP-…) rather than a barcode. The sale is rung up
 * with them attached (set_tab_customer), and a step before the payment offers Use points and
 * Rewards on it. Offline there is no server tab to attach to, so the sale goes without.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import { formatIQD } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { mutate } from '../../lib/mutate';
import { AppRpcError } from '../../lib/appRpc';
import { useLocale, pickName } from '../../lib/i18n';
import { LOCAL_TAB_PREFIX, appendOfflineLines, markOfflineSettled, removeOfflineTab } from '../../lib/offlineTabs';
import { Button, ErrorText, Modal } from '../../components/ui';
import { EmptyState, MessagePresenter, Money, PageHeader, Panel, SearchField } from '../../components/kit';
import { TILL_MENU_QUERY, fetchTabDetail } from '../till/tillData';
import { openTabOn } from '../till/NewTabDialog';
import { PaymentPane, type PaymentMethod } from '../till/PaymentPane';
import { BillView } from '../till/BillView';
import { computeTabTotals } from '../till/tabTotals';
import { useTaxContext } from '../till/useTaxContext';
import { BarcodeWedge } from '../till/barcodeWedge';
import { isModalOpen } from '../../lib/overlay';
import type { IdentifiedMember } from '@touch/core/loyalty';
import { can, useAuth } from '../../lib/auth';
import { MemberAttach, MemberChip, MemberIdentifyDialog } from '../loyalty/MemberAttach';
import { isMemberScan, memberView } from '../loyalty/loyaltyLogic';
import { setTabCustomer } from '../loyalty/useLoyalty';
import {
  addToBasket,
  basketCount,
  basketEstimate,
  findSizeByCode,
  matchesSearch,
  saleItems,
  saleLabel,
  setLineQty,
  shopCatalogue,
  type ShopLine,
  type ShopSize,
} from './shopTillLogic';

interface OpenShopSale {
  id: string;
  label: string | null;
  opened_at: string;
}

const OPEN_SHOP_SALES = {
  queryKey: ['tabs', 'shop'] as const,
  queryFn: async (): Promise<OpenShopSale[]> => {
    const { data, error } = await supabase
      .from('tabs')
      .select('id, label, opened_at')
      .eq('kind', 'shop')
      .in('status', ['open', 'awaiting_payment'])
      .is('merged_into_tab_id', null)
      .order('opened_at');
    if (error) throw error;
    return (data ?? []) as OpenShopSale[];
  },
  refetchInterval: 30_000,
};

/** A sale being paid: its tab, what is due, and the method pressed. */
interface Paying {
  tabId: string;
  label: string;
  due: number;
  method: PaymentMethod;
}

/** A sale just paid: its tab (for the receipt) and the change given, or queued offline. */
interface Paid {
  tabId: string;
  label: string;
  change: number | null;
  queued: boolean;
}

export function ShopTill() {
  const { tr, locale } = useLocale();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const menuQ = useQuery(TILL_MENU_QUERY);
  const openQ = useQuery(OPEN_SHOP_SALES);
  const catalogue = useMemo(() => shopCatalogue(menuQ.data), [menuQ.data]);
  const [basket, setBasket] = useState<ShopLine[]>([]);
  const [query, setQuery] = useState('');
  const [section, setSection] = useState<string>('all');
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [paying, setPaying] = useState<Paying | null>(null);
  const [paid, setPaid] = useState<Paid | null>(null);
  const { staff } = useAuth();
  const canMember = can(staff?.role, 'attachMember');
  /** The member the next sale is rung up for, and the field open on a scan or the button. */
  const [member, setMember] = useState<IdentifiedMember | null>(null);
  const [identify, setIdentify] = useState<{ code: string } | null>(null);
  /** A sale rung up for a member, before its payment: Use points and Rewards. */
  const [memberStep, setMemberStep] = useState<Paying | null>(null);

  const byId = useMemo(() => new Map(catalogue.sizes.map((s) => [s.variantId, s])), [catalogue.sizes]);
  const shown = catalogue.sizes.filter((s) => (section === 'all' || s.categoryId === section) && matchesSearch(s, query));
  const estimate = basketEstimate(basket, catalogue.sizes);
  const count = basketCount(basket);
  const name = (s: ShopSize) => {
    const product = pickName(locale, { name_en: s.nameEn, name_ar: s.nameAr });
    return s.hasSizes ? `${product} · ${pickName(locale, { name_en: s.sizeEn, name_ar: s.sizeAr })}` : product;
  };

  function add(size: ShopSize) {
    setNotice(null);
    setBasket((b) => addToBasket(b, size.variantId));
  }

  // The USB scanner types the code and presses Enter (barcodeWedge.ts). Here
  // no stray key switches anything, so a scan is looked up and nothing is held.
  const wedge = useRef(new BarcodeWedge());
  const sizesRef = useRef(catalogue.sizes);
  sizesRef.current = catalogue.sizes;
  const lockedRef = useRef(false);
  lockedRef.current = paying !== null || paid !== null || busy || memberStep !== null || identify !== null;
  const canMemberRef = useRef(canMember);
  canMemberRef.current = canMember;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      // A dialog on top (the guide, a PIN prompt) owns the keyboard: a scan
      // there must not drop an item into the basket behind it.
      if (lockedRef.current || isModalOpen()) return;
      const action = wedge.current.feed(e.key, e.timeStamp, 'filter');
      if (action.kind !== 'scan') return;
      e.preventDefault();
      // A member card, not a product: the member field, pre-filled and looked up.
      if (isMemberScan(action.code)) {
        setQuery('');
        if (canMemberRef.current) setIdentify({ code: action.code.trim().toUpperCase() });
        return;
      }
      const hit = findSizeByCode(sizesRef.current, action.code);
      if (hit) {
        setNotice(null);
        setBasket((b) => addToBasket(b, hit.variantId));
        // The scanner typed into the search box on its way: clear it.
        setQuery('');
      } else {
        setNotice(tr('ws.shop.till.notFound', { code: action.code }));
      }
    }
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [tr]);

  /** Ring the basket up as one shop sale, then open the payment for it. */
  async function charge(method: PaymentMethod) {
    if (basket.length === 0 || busy) return;
    setBusy(true);
    setError(null);
    const label = saleLabel(new Date());
    try {
      const tabId = await openTabOn({ kind: 'shop', label }, null);
      const items = saleItems(basket);
      let due = estimate;
      if (tabId.startsWith(LOCAL_TAB_PREFIX)) {
        const idemKey = tabId.slice(LOCAL_TAB_PREFIX.length);
        await mutate('order.add_items', { tabIdemKey: idemKey, items, shop: true });
        appendOfflineLines(
          idemKey,
          basket.map((l) => {
            const s = byId.get(l.variantId);
            return { name: s ? name(s) : l.variantId, qty: l.qty, priceIqd: s?.priceIqd ?? 0 };
          }),
        );
      } else {
        await mutate('order.add_items', { tabId, items, shop: true });
        // The server's total (tax, rounding) is what is charged.
        const detail = await fetchTabDetail(tabId).catch(() => null);
        if (detail?.total_iqd != null) due = detail.total_iqd;
      }
      setBasket([]);
      if (member && !tabId.startsWith(LOCAL_TAB_PREFIX)) {
        // Online only (L-6). A refusal leaves the sale as it is, without the member.
        try {
          await setTabCustomer(tabId, member.customer_id);
          setMember(null);
          setMemberStep({ tabId, label, due, method });
          void queryClient.invalidateQueries({ queryKey: ['tabs'] });
          return;
        } catch (e) {
          setError(e);
        }
      }
      setMember(null);
      setPaying({ tabId, label, due, method });
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** After the member step: what is owed now (points may have come off), then the payment. */
  async function payAfterMember(step: Paying) {
    setBusy(true);
    setError(null);
    try {
      const detail = await fetchTabDetail(step.tabId);
      const paidSoFar = detail.payments.reduce((s, p) => s + p.amount_iqd, 0);
      const due = Math.max((detail.total_iqd ?? detail.subtotal_iqd ?? 0) - paidSoFar, 0);
      setMemberStep(null);
      setPaying({ ...step, due });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  /** Finish an unfinished sale: read what it owes, then take the payment. */
  async function resume(sale: OpenShopSale) {
    setBusy(true);
    setError(null);
    try {
      const detail = await fetchTabDetail(sale.id);
      const paidSoFar = detail.payments.reduce((s, p) => s + p.amount_iqd, 0);
      const due = Math.max((detail.total_iqd ?? detail.subtotal_iqd ?? 0) - paidSoFar, 0);
      setPaying({ tabId: sale.id, label: sale.label ?? '', due, method: 'cash' });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function settle(method: PaymentMethod, amountIqd: number | null, tenderedIqd: number | null) {
    if (!paying) return;
    setBusy(true);
    setError(null);
    try {
      if (paying.tabId.startsWith(LOCAL_TAB_PREFIX)) {
        const idemKey = paying.tabId.slice(LOCAL_TAB_PREFIX.length);
        // Offline the server charges its own full due at replay (OfflineTabPanel).
        const settled = await mutate('tab.settle', { tabIdemKey: idemKey, method, ...(tenderedIqd != null ? { tenderedIqd } : {}) });
        // Queued: the tab stays, marked settled, until this settle acks. Acked
        // inside mutate()'s wait: its result has already fired, so retire it here.
        if (settled.queued) markOfflineSettled(idemKey, settled.idempotencyKey);
        else removeOfflineTab(idemKey);
        setPaid({ tabId: paying.tabId, label: paying.label, change: null, queued: true });
        setPaying(null);
        return;
      }
      const outcome = await mutate<{ status: string; change_iqd: number | null }>('tab.settle', {
        tabId: paying.tabId,
        method,
        ...(amountIqd != null ? { amountIqd } : {}),
        ...(tenderedIqd != null ? { tenderedIqd } : {}),
        expectedTotalIqd: paying.due,
      });
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
      void queryClient.invalidateQueries({ queryKey: ['tab', paying.tabId] });
      if (outcome.result && outcome.result.status !== 'settled') {
        // A part payment: stay on the payment with what is still owed.
        const detail = await fetchTabDetail(paying.tabId);
        const paidSoFar = detail.payments.reduce((s, p) => s + p.amount_iqd, 0);
        setPaying({ ...paying, due: Math.max((detail.total_iqd ?? 0) - paidSoFar, 0) });
        return;
      }
      setPaid({ tabId: paying.tabId, label: paying.label, change: outcome.result?.change_iqd ?? null, queued: !outcome.result });
      setPaying(null);
    } catch (e) {
      if (e instanceof AppRpcError && e.code === 'TOTAL_CHANGED') {
        const detail = await fetchTabDetail(paying.tabId).catch(() => null);
        if (detail?.total_iqd != null) setPaying({ ...paying, due: detail.total_iqd });
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const openSales = (openQ.data ?? []).filter((s) => s.id !== paying?.tabId);

  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
      <PageHeader title={tr('ws.shop.till.title')} subtitle={tr('ws.shop.till.lead')} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(18rem, 24rem)', gap: 'var(--tp-sp-4)', alignItems: 'start' }}>
        <Panel data-testid="shop-till-products">
          {catalogue.sizes.length === 0 && menuQ.isSuccess ? (
            <EmptyState
              icon="tag"
              title={tr('ws.shop.till.noProducts')}
              body={tr('ws.shop.till.noProductsBody')}
              action={
                <Button kind="primary" onClick={() => void navigate({ to: '/shop/products' })}>
                  {tr('ws.shop.till.openProducts')}
                </Button>
              }
            />
          ) : (
            <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
              <SearchField value={query} onChange={setQuery} placeholder={tr('ws.shop.till.search')} size="lg" />
              <div role="tablist" style={{ display: 'flex', gap: 'var(--tp-sp-2)', flexWrap: 'wrap' }}>
                {[{ id: 'all', label: tr('ws.shop.till.allSections') }, ...catalogue.sections.map((c) => ({ id: c.id, label: pickName(locale, c) }))].map((c) => (
                  <Button key={c.id} size="sm" kind={section === c.id ? 'primary' : 'default'} aria-pressed={section === c.id} onClick={() => setSection(c.id)}>
                    {c.label}
                  </Button>
                ))}
              </div>
              {notice && <MessagePresenter tone="refused" message={notice} />}
              <ul
                style={{
                  listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(11rem, 1fr))',
                }}
              >
                {shown.map((s) => (
                  <li key={s.variantId}>
                    <button
                      type="button"
                      className="tp-nav-item"
                      data-testid={`shop-size-${s.variantId}`}
                      disabled={!s.orderable || busy}
                      onClick={() => add(s)}
                      style={{
                        inlineSize: '100%', minBlockSize: '5.5rem', display: 'grid', alignContent: 'space-between', textAlign: 'start',
                        padding: 'var(--tp-sp-3)', borderRadius: 'var(--tp-radius-md)', border: '1px solid var(--tp-border)',
                        background: 'var(--tp-surface)', color: 'var(--tp-fg)', opacity: s.orderable ? 1 : 0.5, cursor: s.orderable ? 'pointer' : 'not-allowed',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>{name(s)}</span>
                      <span style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)' }}>
                        <Money amount={s.priceIqd} />
                        {!s.orderable && <span style={{ color: 'var(--tp-muted-fg)' }}>{tr('ws.shop.till.soldOut')}</span>}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Panel>

        <div style={{ display: 'grid', gap: 'var(--tp-sp-4)' }}>
          <Panel title={tr('ws.shop.till.basketTitle')} data-testid="shop-till-basket">
            {basket.length === 0 ? (
              <p style={{ margin: 0, color: 'var(--tp-muted-fg)' }}>{tr('ws.shop.till.basketEmpty')}</p>
            ) : (
              <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
                {basket.map((l) => {
                  const s = byId.get(l.variantId);
                  const label = s ? name(s) : l.variantId;
                  return (
                    <li key={l.variantId} style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 'var(--tp-sp-2)', alignItems: 'center' }}>
                      <span>
                        <span style={{ display: 'block', fontWeight: 600 }}>{label}</span>
                        <Money amount={(s?.priceIqd ?? 0) * l.qty} />
                      </span>
                      <span style={{ display: 'inline-flex', gap: 'var(--tp-sp-1)', alignItems: 'center' }}>
                        <Button size="sm" icon="minus" aria-label={tr('ws.shop.till.decrease', { name: label })} disabled={busy} onClick={() => setBasket((b) => setLineQty(b, l.variantId, l.qty - 1))} />
                        <span dir="ltr" style={{ minInlineSize: '2ch', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>{l.qty}</span>
                        <Button size="sm" icon="plus" aria-label={tr('ws.shop.till.increase', { name: label })} disabled={busy} onClick={() => setBasket((b) => setLineQty(b, l.variantId, l.qty + 1))} />
                        <Button size="sm" kind="ghost" icon="x" aria-label={tr('ws.shop.till.remove', { name: label })} disabled={busy} onClick={() => setBasket((b) => setLineQty(b, l.variantId, 0))} />
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBlockStart: 'var(--tp-sp-4)', fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>
              <span>{tr('ws.shop.till.total')}</span>
              <Money amount={estimate} strong />
            </div>
            {count > 0 && (
              <p style={{ margin: 0, marginBlockStart: 'var(--tp-sp-1)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.shop.till.lineCount', { count })} · {tr('ws.shop.till.estimateNote')}
              </p>
            )}
            {canMember && (
              <div style={{ marginBlockStart: 'var(--tp-sp-3)' }} data-testid="shop-till-member">
                {member ? (
                  <MemberChip
                    member={memberView(member.customer_id, member, null)}
                    note={<span style={{ fontSize: 'var(--tp-fs-xs)', color: 'var(--tp-muted-fg)' }}>{tr('ws.loyalty.member.pendingShop')}</span>}
                    actions={
                      <Button size="sm" kind="ghost" icon="x" disabled={busy} onClick={() => setMember(null)}>
                        {tr('ws.loyalty.member.remove')}
                      </Button>
                    }
                  />
                ) : (
                  <Button icon="userPlus" disabled={busy} onClick={() => setIdentify({ code: '' })} data-testid="member-button">
                    {tr('ws.loyalty.member.button')}
                  </Button>
                )}
              </div>
            )}
            {error != null && paying === null && <ErrorText error={error} />}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--tp-sp-2)', marginBlockStart: 'var(--tp-sp-3)' }}>
              <Button kind="primary" size="lg" busy={busy} disabled={basket.length === 0} onClick={() => void charge('cash')} data-testid="shop-till-cash">
                {tr('ws.shop.till.cash')}
              </Button>
              <Button kind="primary" size="lg" busy={busy} disabled={basket.length === 0} onClick={() => void charge('card')} data-testid="shop-till-card">
                {tr('ws.shop.till.card')}
              </Button>
            </div>
            {basket.length > 0 && (
              <Button kind="ghost" style={{ marginBlockStart: 'var(--tp-sp-2)', inlineSize: '100%' }} disabled={busy} onClick={() => window.confirm(tr('ws.shop.till.clearConfirm')) && setBasket([])}>
                {tr('ws.shop.till.clear')}
              </Button>
            )}
          </Panel>

          {openSales.length > 0 && (
            <Panel title={tr('ws.shop.till.unfinished')} data-testid="shop-till-unfinished">
              <p style={{ margin: 0, marginBlockEnd: 'var(--tp-sp-2)', fontSize: 'var(--tp-fs-sm)', color: 'var(--tp-muted-fg)' }}>
                {tr('ws.shop.till.unfinishedLead')}
              </p>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 'var(--tp-sp-2)' }}>
                {openSales.map((s) => (
                  <li key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 'var(--tp-sp-2)' }}>
                    <span dir="ltr" style={{ fontVariantNumeric: 'tabular-nums' }}>{s.label}</span>
                    <Button size="sm" busy={busy} onClick={() => void resume(s)}>
                      {tr('ws.shop.till.resume')}
                    </Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      </div>

      {/* The payment pane is its own Cash / Card dialog, the till's, with the
          till-shift gate in front of it (the shop PC's drawer, 0244). */}
      {paying && (
        <PaymentPane
          mode={paying.method}
          due={paying.due}
          busy={busy}
          error={error}
          onCancel={() => {
            setPaying(null);
            setError(null);
          }}
          onSettle={(m, a, t) => void settle(m, a, t)}
        />
      )}

      {paid && <PaidReceipt paid={paid} onNext={() => setPaid(null)} />}

      {identify && (
        <MemberIdentifyDialog
          initialCode={identify.code}
          onClose={() => setIdentify(null)}
          onIdentified={(m) => {
            setMember(m);
            setIdentify(null);
          }}
        />
      )}

      {memberStep && (
        <Modal
          title={tr('ws.loyalty.member.shopStepTitle')}
          subtitle={memberStep.label}
          dismissible={!busy}
          onClose={() => void payAfterMember(memberStep)}
          footer={
            <Button kind="primary" size="lg" busy={busy} onClick={() => void payAfterMember(memberStep)} data-testid="shop-member-continue">
              {tr('ws.loyalty.member.continue')}
            </Button>
          }
        >
          <ShopMemberStep tabId={memberStep.tabId} fallbackDue={memberStep.due} />
          <ErrorText error={error} />
        </Modal>
      )}
    </div>
  );
}

/** The member block on a sale before its payment, with what is still owed read live (points move it). */
function ShopMemberStep({ tabId, fallbackDue }: { tabId: string; fallbackDue: number }) {
  const { tr } = useLocale();
  const detailQ = useQuery({ queryKey: ['tab', tabId] as const, queryFn: () => fetchTabDetail(tabId) });
  const d = detailQ.data;
  const due = d ? Math.max((d.total_iqd ?? d.subtotal_iqd ?? 0) - d.payments.reduce((s, p) => s + p.amount_iqd, 0), 0) : fallbackDue;
  return (
    <div style={{ display: 'grid', gap: 'var(--tp-sp-3)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', fontSize: 'var(--tp-fs-lg)', fontWeight: 700 }}>
        <span>{tr('ws.shop.till.total')}</span>
        <Money amount={due} strong />
      </div>
      <MemberAttach tabId={tabId} remainingIqd={due} />
    </div>
  );
}

/**
 * The receipt of the sale just paid, printed as it opens (Parsa: a receipt
 * after every sale). A sale queued offline has no server bill yet: it says so
 * and prints nothing.
 */
function PaidReceipt({ paid, onNext }: { paid: Paid; onNext: () => void }) {
  const { tr, locale } = useLocale();
  const taxCtx = useTaxContext();
  const detailQ = useQuery({
    queryKey: ['tab', paid.tabId] as const,
    queryFn: () => fetchTabDetail(paid.tabId),
    enabled: !paid.queued,
  });
  const tab = detailQ.data;
  const totals = useMemo(() => computeTabTotals(tab ?? null, taxCtx, 0), [tab, taxCtx]);

  if (paid.queued || !tab) {
    return (
      <Modal title={tr('ws.shop.till.done')} onClose={onNext} footer={<Button kind="primary" onClick={onNext}>{tr('ws.shop.till.next')}</Button>}>
        {paid.queued ? <MessagePresenter tone="info" message={tr('ws.shop.till.queued')} /> : detailQ.isError ? <ErrorText error={detailQ.error} /> : null}
      </Modal>
    );
  }
  return (
    <>
      {paid.change != null && paid.change > 0 && (
        <div role="status" style={{ position: 'fixed', insetInlineStart: 0, insetInlineEnd: 0, insetBlockStart: 'var(--tp-sp-4)', textAlign: 'center', zIndex: 60, fontSize: 'var(--tp-fs-xl)', fontWeight: 700 }}>
          {tr('ws.shop.till.change', { amount: formatIQD(paid.change, locale) })}
        </div>
      )}
      <BillView
        venueName={tr('common.appName')}
        heading={tr('ws.shop.till.receiptHeading', { label: tab.label ?? paid.label })}
        orders={tab.orders}
        totals={totals}
        payments={tab.payments}
        taxInclusive={Boolean(taxCtx?.taxInclusive)}
        onClose={onNext}
        autoPrint
      />
    </>
  );
}
