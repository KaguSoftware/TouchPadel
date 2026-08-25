/**
 * Till v1 — keyboard-first category/item grid, open tabs, size+modifier sheet,
 * settle (cash/card/split), PIN-gated discount and void-after-send.
 * Every write is an app.* RPC (0015); prices always come back from the server.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { splitEvenly } from '@touch/core';
import { formatIQD, formatTime } from '@touch/i18n';
import { supabase } from '../../lib/supabase';
import { appRpc } from '../../lib/appRpc';
import { idemKey, deviceId } from '../../lib/idem';
import { useBroadcast } from '../../lib/realtime';
import { chime, StartShiftBanner } from '../../lib/audio';
import { useLocale, pickName } from '../../lib/i18n';
import {
  AmountPad,
  Button,
  ErrorText,
  Field,
  Modal,
  PinReasonModal,
  card,
  inputStyle,
} from '../../components/ui';
import { computeChange } from './change';
import { WaiterCallsPanel } from './WaiterCallsPanel';

// ---------------------------------------------------------------------------
// row shapes (manual mirrors of the nested selects)
// ---------------------------------------------------------------------------
interface CategoryRow {
  id: string;
  name_en: string;
  name_ar: string;
  sort_order: number;
  is_active: boolean;
  tax_group: { rate_bp: number } | null;
}
interface VariantRow {
  id: string;
  item_id: string;
  name_en: string;
  name_ar: string;
  price_iqd: number;
  is_default: boolean;
  sort_order: number;
}
interface ModifierRow {
  id: string;
  group_id: string;
  name_en: string;
  name_ar: string;
  price_delta_iqd: number;
  is_active: boolean;
}
interface ModifierGroupRow {
  id: string;
  name_en: string;
  name_ar: string;
  min_select: number;
  max_select: number;
}
interface ItemRow {
  id: string;
  category_id: string;
  name_en: string;
  name_ar: string;
  is_active: boolean;
  sort_order: number;
  menu_item_variants: VariantRow[];
  menu_item_modifier_groups: { group_id: string; sort_order: number }[];
}
interface TabListRow {
  id: string;
  status: string;
  label: string | null;
  opened_at: string;
  table: { table_number: string } | null;
  reservation: { guest_name: string | null } | null;
}
interface TabDetail {
  id: string;
  status: string;
  label: string | null;
  subtotal_iqd: number | null;
  total_iqd: number | null;
  table: { table_number: string } | null;
  reservation: { guest_name: string | null } | null;
  orders: {
    id: string;
    status: string;
    placed_at: string;
    order_items: {
      id: string;
      qty: number;
      unit_price_iqd: number;
      line_total_iqd: number;
      voided: boolean;
      notes: string | null;
      menu_item: { name_en: string; name_ar: string; category_id: string } | null;
      variant: { name_en: string; name_ar: string } | null;
      order_item_modifiers: {
        qty: number;
        price_delta_iqd: number;
        modifier: { name_en: string; name_ar: string } | null;
      }[];
    }[];
  }[];
  payments: { id: string; method: string; amount_iqd: number }[];
  tab_adjustments: { id: string; kind: string; amount_iqd: number }[];
}

interface BasketLine {
  key: string;
  variantId: string;
  itemName: string;
  variantName: string;
  qty: number;
  notes: string;
  unitPriceIqd: number; // display estimate only — server re-snapshots at send
  modifiers: { modifierId: string; name: string; qty: number; priceDeltaIqd: number }[];
}

export function TillScreen() {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [selectedTabId, setSelectedTabId] = useState<string | null>(null);
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [sheetItem, setSheetItem] = useState<ItemRow | null>(null);
  const [basket, setBasket] = useState<BasketLine[]>([]);
  const [sendError, setSendError] = useState<unknown>(null);
  const [sending, setSending] = useState(false);
  const [showNewTab, setShowNewTab] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);

  // ---- data -----------------------------------------------------------------
  const dayQ = useQuery({
    queryKey: ['day'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('day_sessions')
        .select('id, status, business_date, opened_at, opening_float_iqd')
        .in('status', ['open', 'closing'])
        .order('opened_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const menuQ = useQuery({
    queryKey: ['menu'],
    queryFn: async () => {
      const [cats, items, groups, mods, avail] = await Promise.all([
        supabase
          .from('menu_categories')
          .select('id, name_en, name_ar, sort_order, is_active, tax_group:tax_groups(rate_bp)')
          .order('sort_order'),
        supabase
          .from('menu_items')
          .select(
            'id, category_id, name_en, name_ar, is_active, sort_order, menu_item_variants(*), menu_item_modifier_groups(group_id, sort_order)',
          )
          .order('sort_order'),
        supabase.from('modifier_groups').select('*'),
        supabase.from('modifiers').select('*').order('sort_order'),
        supabase.from('menu_item_availability').select('item_id, orderable'),
      ]);
      for (const r of [cats, items, groups, mods, avail]) if (r.error) throw r.error;
      return {
        categories: (cats.data ?? []) as unknown as CategoryRow[],
        items: (items.data ?? []) as unknown as ItemRow[],
        groups: (groups.data ?? []) as unknown as ModifierGroupRow[],
        modifiers: (mods.data ?? []) as unknown as ModifierRow[],
        availability: new Map(
          ((avail.data ?? []) as { item_id: string; orderable: boolean }[]).map((a) => [
            a.item_id,
            a.orderable,
          ]),
        ),
      };
    },
  });

  useBroadcast({
    topic: 'menu',
    isPrivate: false,
    events: ['menu_changed'],
    invalidateKeys: [['menu']],
  });

  const tabsQ = useQuery({
    queryKey: ['tabs'],
    queryFn: async (): Promise<TabListRow[]> => {
      const { data, error } = await supabase
        .from('tabs')
        .select(
          'id, status, label, opened_at, table:cafe_tables(table_number), reservation:reservations(guest_name)',
        )
        .in('status', ['open', 'awaiting_payment'])
        .is('merged_into_tab_id', null)
        .order('opened_at');
      if (error) throw error;
      return data as unknown as TabListRow[];
    },
  });

  const { status: floorStatus } = useBroadcast({
    topic: 'floor',
    isPrivate: true,
    events: ['waiter_call'],
    invalidateKeys: [['tabs'], ['waiterCalls']],
    // chime() is a no-op until audio is armed (StartShiftBanner / Electron autoplay policy).
    onEvent: (_e, p) => (p as { status?: string } | null)?.status === 'raised' && chime('call'),
  });

  const categories = useMemo(
    () => (menuQ.data?.categories ?? []).filter((c) => c.is_active),
    [menuQ.data],
  );
  const activeCategory = categoryId ?? categories[0]?.id ?? null;

  const visibleItems = useMemo(() => {
    const items = (menuQ.data?.items ?? []).filter((i) => i.is_active);
    const q = filter.trim().toLowerCase();
    if (q) {
      return items.filter(
        (i) => i.name_en.toLowerCase().includes(q) || i.name_ar.includes(filter.trim()),
      );
    }
    return items.filter((i) => i.category_id === activeCategory);
  }, [menuQ.data, filter, activeCategory]);

  // ---- keyboard-first: number keys pick categories, typing filters ----------
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT');
      if (inField && target !== filterRef.current) return;
      if (!inField && /^[1-9]$/.test(e.key)) {
        const cat = categories[Number(e.key) - 1];
        if (cat) {
          setCategoryId(cat.id);
          setFilter('');
          e.preventDefault();
        }
        return;
      }
      if (!inField && e.key.length === 1 && /[\p{L}\p{N}]/u.test(e.key)) {
        filterRef.current?.focus();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [categories]);

  // ---- send basket ----------------------------------------------------------
  async function sendBasket() {
    if (!selectedTabId || basket.length === 0) return;
    setSending(true);
    setSendError(null);
    try {
      await appRpc('till_add_items', {
        p_tab_id: selectedTabId,
        p_items: basket.map((l) => ({
          variant_id: l.variantId,
          qty: l.qty,
          notes: l.notes || undefined,
          modifiers: l.modifiers.map((m) => ({ modifier_id: m.modifierId, qty: m.qty })),
        })),
        p_idempotency_key: idemKey('order.create'),
        p_device_id: deviceId(),
      });
      setBasket([]);
      void queryClient.invalidateQueries({ queryKey: ['tab', selectedTabId] });
      void queryClient.invalidateQueries({ queryKey: ['tabs'] });
    } catch (e) {
      setSendError(e);
    } finally {
      setSending(false);
    }
  }

  function tabTitle(tb: TabListRow): string {
    if (tb.table) return `${tr('op.till.table')} ${tb.table.table_number}`;
    if (tb.reservation) return tb.reservation.guest_name ?? tr('op.till.forReservation');
    return tb.label ?? '—';
  }

  const basketTotal = basket.reduce(
    (sum, l) =>
      sum + (l.unitPriceIqd + l.modifiers.reduce((s, m) => s + m.priceDeltaIqd * m.qty, 0)) * l.qty,
    0,
  );

  if (dayQ.isSuccess && !dayQ.data) {
    return (
      <div>
        <h1 style={{ marginBlockStart: 0, fontSize: '1.3rem' }}>{tr('till.title')}</h1>
        <p style={card}>{tr('op.till.noOpenDay')}</p>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', gap: '0.8rem', alignItems: 'flex-start' }}>
      {/* Floor + open tabs rail */}
      <div style={{ inlineSize: '13rem', flexShrink: 0 }}>
        <StartShiftBanner />
        <WaiterCallsPanel status={floorStatus} />
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0, fontSize: '1rem' }}>{tr('op.till.openTabs')}</h2>
          <Button kind="primary" onClick={() => setShowNewTab(true)}>
            +
          </Button>
        </div>
        {(tabsQ.data ?? []).length === 0 && (
          <p style={{ color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>{tr('op.till.noTabs')}</p>
        )}
        {(tabsQ.data ?? []).map((tb) => (
          <Button
            key={tb.id}
            kind={tb.id === selectedTabId ? 'primary' : 'default'}
            style={{ display: 'block', inlineSize: '100%', marginBlockStart: '0.4rem', textAlign: 'start' }}
            onClick={() => {
              setSelectedTabId(tb.id);
              setBasket([]);
            }}
          >
            {tabTitle(tb)}
            {tb.status === 'awaiting_payment' && ' ⏳'}
          </Button>
        ))}
      </div>

      {/* Menu grid */}
      <div style={{ flex: 1, minInlineSize: 0 }}>
        <input
          ref={filterRef}
          style={{ ...inputStyle, marginBlockEnd: '0.5rem' }}
          placeholder={tr('op.till.filterPlaceholder')}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem', marginBlockEnd: '0.5rem' }}>
          {categories.map((c, i) => (
            <Button
              key={c.id}
              kind={c.id === activeCategory && !filter ? 'primary' : 'default'}
              onClick={() => {
                setCategoryId(c.id);
                setFilter('');
              }}
            >
              {i < 9 ? `${i + 1}. ` : ''}
              {pickName(locale, c)}
            </Button>
          ))}
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(9.5rem, 1fr))',
            gap: '0.4rem',
          }}
        >
          {visibleItems.map((item) => {
            const orderable = menuQ.data?.availability.get(item.id) ?? true;
            const defVariant =
              item.menu_item_variants.find((v) => v.is_default) ?? item.menu_item_variants[0];
            return (
              <button
                key={item.id}
                type="button"
                disabled={!orderable || !selectedTabId}
                onClick={() => setSheetItem(item)}
                style={{
                  ...card,
                  cursor: orderable && selectedTabId ? 'pointer' : 'not-allowed',
                  opacity: orderable ? (selectedTabId ? 1 : 0.6) : 0.35,
                  textAlign: 'start',
                  minBlockSize: '4.5rem',
                }}
              >
                <strong style={{ display: 'block' }}>{pickName(locale, item)}</strong>
                {defVariant && (
                  <span style={{ color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
                    {formatIQD(defVariant.price_iqd, locale)}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* basket */}
        <div style={{ ...card, marginBlockStart: '0.8rem' }}>
          <h3 style={{ marginBlockStart: 0, fontSize: '0.95rem' }}>{tr('op.till.basket')}</h3>
          {basket.length === 0 && (
            <p style={{ margin: 0, color: 'var(--tp-muted-fg)', fontSize: '0.85rem' }}>
              {tr('op.till.emptyBasket')}
            </p>
          )}
          {basket.map((l) => (
            <div
              key={l.key}
              style={{ display: 'flex', justifyContent: 'space-between', gap: '0.5rem', marginBlockEnd: '0.25rem' }}
            >
              <span>
                {l.qty}× {l.itemName} ({l.variantName})
                {l.modifiers.length > 0 && (
                  <span style={{ color: 'var(--tp-muted-fg)' }}>
                    {' — '}
                    {l.modifiers.map((m) => m.name).join(', ')}
                  </span>
                )}
              </span>
              <span style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                {formatIQD(
                  (l.unitPriceIqd + l.modifiers.reduce((s, m) => s + m.priceDeltaIqd * m.qty, 0)) *
                    l.qty,
                  locale,
                )}
                <Button kind="ghost" onClick={() => setBasket((b) => b.filter((x) => x.key !== l.key))}>
                  ✕
                </Button>
              </span>
            </div>
          ))}
          <ErrorText error={sendError} />
          {basket.length > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <strong>{formatIQD(basketTotal, locale)}</strong>
              <Button kind="primary" disabled={sending || !selectedTabId} onClick={() => void sendBasket()}>
                {tr('op.till.sendOrder')}
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Tab detail */}
      {selectedTabId && (
        <TabDetailPanel
          tabId={selectedTabId}
          onClosedTab={() => {
            setSelectedTabId(null);
            void queryClient.invalidateQueries({ queryKey: ['tabs'] });
          }}
        />
      )}

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
      {showNewTab && (
        <NewTabDialog
          onClose={() => setShowNewTab(false)}
          onOpened={(tabId) => {
            setShowNewTab(false);
            setSelectedTabId(tabId);
            void queryClient.invalidateQueries({ queryKey: ['tabs'] });
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Item sheet: size + modifiers + qty + notes
// ---------------------------------------------------------------------------
function ItemSheet({
  item,
  groups,
  modifiers,
  onClose,
  onAdd,
}: {
  item: ItemRow;
  groups: ModifierGroupRow[];
  modifiers: ModifierRow[];
  onClose: () => void;
  onAdd: (line: BasketLine) => void;
}) {
  const { tr, locale } = useLocale();
  const variants = [...item.menu_item_variants].sort((a, b) => a.sort_order - b.sort_order);
  const [variantId, setVariantId] = useState<string>(
    (variants.find((v) => v.is_default) ?? variants[0])?.id ?? '',
  );
  const [qty, setQty] = useState(1);
  const [notes, setNotes] = useState('');
  const [chosen, setChosen] = useState<Map<string, number>>(new Map()); // modifier id -> qty

  const linkedGroups = item.menu_item_modifier_groups
    .map((l) => groups.find((g) => g.id === l.group_id))
    .filter((g): g is ModifierGroupRow => Boolean(g));

  const variant = variants.find((v) => v.id === variantId);

  const selectionValid = linkedGroups.every((g) => {
    const count = modifiers.filter((m) => m.group_id === g.id && chosen.has(m.id)).length;
    return count >= g.min_select && count <= g.max_select;
  });

  function toggle(m: ModifierRow, group: ModifierGroupRow) {
    setChosen((prev) => {
      const next = new Map(prev);
      if (next.has(m.id)) next.delete(m.id);
      else {
        const inGroup = modifiers.filter((x) => x.group_id === group.id && next.has(x.id));
        if (inGroup.length >= group.max_select && group.max_select === 1) {
          for (const x of inGroup) next.delete(x.id);
        }
        if (modifiers.filter((x) => x.group_id === group.id && next.has(x.id)).length < group.max_select)
          next.set(m.id, 1);
      }
      return next;
    });
  }

  return (
    <Modal title={pickName(locale, item)} onClose={onClose}>
      <Field label={tr('op.till.size')}>
        <select style={inputStyle} value={variantId} onChange={(e) => setVariantId(e.target.value)}>
          {variants.map((v) => (
            <option key={v.id} value={v.id}>
              {pickName(locale, v)} — {formatIQD(v.price_iqd, locale)}
            </option>
          ))}
        </select>
      </Field>
      {linkedGroups.map((g) => (
        <div key={g.id} style={{ marginBlockEnd: '0.5rem' }}>
          <p style={{ marginBlock: '0.2rem', fontSize: '0.85rem', color: 'var(--tp-muted-fg)' }}>
            {pickName(locale, g)} ({g.min_select}–{g.max_select})
          </p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem' }}>
            {modifiers
              .filter((m) => m.group_id === g.id && m.is_active)
              .map((m) => (
                <Button
                  key={m.id}
                  kind={chosen.has(m.id) ? 'primary' : 'default'}
                  onClick={() => toggle(m, g)}
                >
                  {pickName(locale, m)}
                  {m.price_delta_iqd > 0 && ` +${formatIQD(m.price_delta_iqd, locale)}`}
                </Button>
              ))}
          </div>
        </div>
      ))}
      <Field label={tr('op.till.qty')}>
        <input
          style={inputStyle}
          type="number"
          min={1}
          max={99}
          value={qty}
          onChange={(e) => setQty(Math.max(1, Math.min(99, Number(e.target.value) || 1)))}
        />
      </Field>
      <Field label={tr('op.till.itemNotes')}>
        <input style={inputStyle} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </Field>
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button
          kind="primary"
          disabled={!variant || !selectionValid}
          onClick={() => {
            if (!variant) return;
            onAdd({
              key: crypto.randomUUID(),
              variantId: variant.id,
              itemName: pickName(locale, item),
              variantName: pickName(locale, variant),
              qty,
              notes,
              unitPriceIqd: variant.price_iqd,
              modifiers: [...chosen.entries()].map(([id, mQty]) => {
                const m = modifiers.find((x) => x.id === id);
                return {
                  modifierId: id,
                  qty: mQty,
                  name: m ? pickName(locale, m) : '',
                  priceDeltaIqd: m?.price_delta_iqd ?? 0,
                };
              }),
            });
          }}
        >
          {tr('op.till.addToBasket')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// New tab dialog — table / by-name / reservation anchor (app.open_tab)
// ---------------------------------------------------------------------------
function NewTabDialog({
  onClose,
  onOpened,
}: {
  onClose: () => void;
  onOpened: (tabId: string) => void;
}) {
  const { tr, locale } = useLocale();
  const [tableId, setTableId] = useState('');
  const [label, setLabel] = useState('');
  const [reservationId, setReservationId] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const tablesQ = useQuery({
    queryKey: ['cafeTables'],
    queryFn: async () => {
      const { data, error: err } = await supabase
        .from('cafe_tables')
        .select('id, table_number')
        .eq('is_active', true)
        .order('table_number');
      if (err) throw err;
      return data as { id: string; table_number: string }[];
    },
  });

  // Charge-to-booking: today's confirmed/arrived reservations that have no tab
  // yet (the embedded tabs list is empty). RLS: cashiers may see none — the
  // picker simply stays empty for them.
  const reservationsQ = useQuery({
    queryKey: ['openTabReservations'],
    queryFn: async () => {
      const dayStart = new Date();
      dayStart.setHours(0, 0, 0, 0);
      const dayEnd = new Date(dayStart.getTime() + 86_400_000);
      const { data, error: err } = await supabase
        .from('reservations')
        .select('id, start_at, end_at, guest_name, court:courts(name_en, name_ar), tabs(id)')
        .in('status', ['confirmed', 'arrived'])
        .gte('start_at', dayStart.toISOString())
        .lt('start_at', dayEnd.toISOString())
        .order('start_at');
      if (err) throw err;
      return (
        data as unknown as {
          id: string;
          start_at: string;
          guest_name: string | null;
          court: { name_en: string; name_ar: string } | null;
          tabs: { id: string }[];
        }[]
      ).filter((r) => (r.tabs ?? []).length === 0);
    },
  });

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await appRpc<{ tab_id: string }>('open_tab', {
        p_table_id: tableId || null,
        p_label: label || null,
        p_reservation_id: reservationId || null,
        p_idempotency_key: idemKey('tab.open'),
        p_device_id: deviceId(),
      });
      onOpened(res.tab_id);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title={tr('op.till.newTab')} onClose={onClose}>
      <Field label={tr('op.till.table')}>
        <select style={inputStyle} value={tableId} onChange={(e) => setTableId(e.target.value)}>
          <option value="">{tr('op.till.chooseTable')}</option>
          {(tablesQ.data ?? []).map((t) => (
            <option key={t.id} value={t.id}>
              {t.table_number}
            </option>
          ))}
        </select>
      </Field>
      <Field label={tr('op.till.byName')}>
        <input style={inputStyle} value={label} onChange={(e) => setLabel(e.target.value)} />
      </Field>
      <Field label={tr('op.till.reservationLabel')}>
        <select
          style={inputStyle}
          value={reservationId}
          onChange={(e) => setReservationId(e.target.value)}
        >
          <option value="">{tr('op.till.noReservation')}</option>
          {(reservationsQ.data ?? []).map((r) => (
            <option key={r.id} value={r.id}>
              {tr('op.till.reservationOption', {
                time: formatTime(new Date(r.start_at), locale),
                court: pickName(locale, r.court),
                guest: r.guest_name ?? '—',
              })}
            </option>
          ))}
        </select>
      </Field>
      <ErrorText error={error} />
      <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
        <Button onClick={onClose}>{tr('common.cancel')}</Button>
        <Button
          kind="primary"
          disabled={busy || (!tableId && !label && !reservationId)}
          onClick={() => void submit()}
        >
          {tr('op.till.openTabBtn')}
        </Button>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Tab detail: lines, running totals, settle / split / discount / void
// ---------------------------------------------------------------------------
function TabDetailPanel({ tabId, onClosedTab }: { tabId: string; onClosedTab: () => void }) {
  const { tr, locale } = useLocale();
  const queryClient = useQueryClient();
  const [settleMode, setSettleMode] = useState<'cash' | 'card' | 'split' | null>(null);
  const [tendered, setTendered] = useState(0);
  const [splitN, setSplitN] = useState(2);
  const [shares, setShares] = useState<number[] | null>(null);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [discountKind, setDiscountKind] = useState<'discount_percent' | 'discount_amount'>(
    'discount_percent',
  );
  const [discountValue, setDiscountValue] = useState(10);
  const [voidItemId, setVoidItemId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [pinError, setPinError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [lastChange, setLastChange] = useState<number | null>(null);

  const tabQ = useQuery({
    queryKey: ['tab', tabId],
    queryFn: async (): Promise<TabDetail> => {
      const { data, error } = await supabase
        .from('tabs')
        .select(
          `id, status, label, subtotal_iqd, total_iqd,
           table:cafe_tables(table_number), reservation:reservations(guest_name),
           orders (
             id, status, placed_at,
             order_items (
               id, qty, unit_price_iqd, line_total_iqd, voided, notes,
               menu_item:menu_items(name_en, name_ar, category_id),
               variant:menu_item_variants(name_en, name_ar),
               order_item_modifiers(qty, price_delta_iqd, modifier:modifiers(name_en, name_ar))
             )
           ),
           payments(id, method, amount_iqd),
           tab_adjustments(id, kind, amount_iqd)`,
        )
        .eq('id', tabId)
        .single();
      if (error) throw error;
      return data as unknown as TabDetail;
    },
  });

  const taxQ = useQuery({
    queryKey: ['taxContext'],
    queryFn: async () => {
      const [cats, settings] = await Promise.all([
        supabase.from('menu_categories').select('id, tax_group:tax_groups(rate_bp)'),
        supabase.from('venue_settings').select('tax_inclusive').single(),
      ]);
      if (cats.error) throw cats.error;
      if (settings.error) throw settings.error;
      return {
        rateByCategory: new Map(
          (cats.data as unknown as { id: string; tax_group: { rate_bp: number } | null }[]).map(
            (c) => [c.id, c.tax_group?.rate_bp ?? 0],
          ),
        ),
        taxInclusive: Boolean((settings.data as { tax_inclusive: boolean }).tax_inclusive),
      };
    },
  });

  const tab = tabQ.data;

  // Display totals mirror app.compute_tab_totals; the settle RPC re-stamps the
  // authoritative figures server-side.
  const totals = useMemo(() => {
    if (!tab) return { subtotal: 0, discount: 0, tax: 0, total: 0, paid: 0 };
    const lines = tab.orders
      .filter((o) => o.status !== 'voided')
      .flatMap((o) => o.order_items.filter((i) => !i.voided));
    const subtotal = lines.reduce((s, l) => s + l.line_total_iqd, 0);
    const discount = Math.min(
      tab.tab_adjustments
        .filter((a) => a.kind === 'discount_percent' || a.kind === 'discount_amount')
        .reduce((s, a) => s + a.amount_iqd, 0),
      subtotal,
    );
    const byGroup = new Map<number, number>();
    for (const l of lines) {
      const rate = taxQ.data?.rateByCategory.get(l.menu_item?.category_id ?? '') ?? 0;
      byGroup.set(rate, (byGroup.get(rate) ?? 0) + l.line_total_iqd);
    }
    let tax = 0;
    for (const [rate, grp] of byGroup) tax += Math.round((grp * rate) / 10000);
    const total = Math.max(subtotal - discount + (taxQ.data?.taxInclusive ? 0 : tax), 0);
    const paid = tab.payments.reduce((s, p) => s + p.amount_iqd, 0);
    return { subtotal, discount, tax, total, paid };
  }, [tab, taxQ.data]);

  const due = Math.max(totals.total - totals.paid, 0);

  function refresh() {
    void queryClient.invalidateQueries({ queryKey: ['tab', tabId] });
    void queryClient.invalidateQueries({ queryKey: ['tabs'] });
  }

  async function settle(method: 'cash' | 'card', amountIqd: number | null, tenderedIqd: number | null) {
    setBusy(true);
    setActionError(null);
    try {
      const res = await appRpc<{ status: string; change_iqd: number | null }>('settle_tab', {
        p_tab_id: tabId,
        p_method: method,
        p_tendered_iqd: tenderedIqd,
        p_amount_iqd: amountIqd,
        p_idempotency_key: idemKey('payment.record'),
        p_device_id: deviceId(),
      });
      setLastChange(res.change_iqd ?? null);
      refresh();
      if (res.status === 'settled') {
        setSettleMode(null);
        setShares(null);
      }
    } catch (e) {
      setActionError(e);
    } finally {
      setBusy(false);
    }
  }

  async function loadShares() {
    setActionError(null);
    try {
      const res = await appRpc<number[]>('split_evenly', { p_tab_id: tabId, p_n: splitN });
      setShares(res);
      // sanity: server split mirrors @touch/core splitEvenly exactly
      if (totals.total > 0 && res.length === splitN) void splitEvenly(totals.total, splitN);
    } catch (e) {
      setActionError(e);
    }
  }

  async function applyDiscount(pin: string, reasonCode: string) {
    setBusy(true);
    setPinError(null);
    try {
      await appRpc('apply_discount', {
        p_tab_id: tabId,
        p_kind: discountKind,
        p_value: discountKind === 'discount_percent' ? discountValue * 100 : discountValue,
        p_pin: pin,
        p_reason_code: reasonCode,
        p_device_id: deviceId(),
      });
      setDiscountOpen(false);
      refresh();
    } catch (e) {
      setPinError(e);
    } finally {
      setBusy(false);
    }
  }

  async function voidItem(pin: string, reasonCode: string) {
    if (!voidItemId) return;
    setBusy(true);
    setPinError(null);
    try {
      await appRpc('void_after_send', {
        p_order_item_id: voidItemId,
        p_pin: pin,
        p_reason_code: reasonCode,
        p_device_id: deviceId(),
      });
      setVoidItemId(null);
      refresh();
    } catch (e) {
      setPinError(e);
    } finally {
      setBusy(false);
    }
  }

  if (!tab) return <div style={{ inlineSize: '20rem' }}>{tr('common.loading')}</div>;

  const settled = tab.status === 'settled';
  const change = computeChange(due, tendered);

  return (
    <div style={{ inlineSize: '21rem', flexShrink: 0 }}>
      <div style={card}>
        <h2 style={{ marginBlockStart: 0, fontSize: '1.05rem' }}>
          {tab.table
            ? `${tr('op.till.table')} ${tab.table.table_number}`
            : (tab.reservation?.guest_name ?? tab.label ?? '—')}
        </h2>

        {tab.orders
          .filter((o) => o.status !== 'voided')
          .map((o) => (
            <div key={o.id} style={{ marginBlockEnd: '0.4rem' }}>
              {o.order_items.map((i) => (
                <div
                  key={i.id}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: '0.4rem',
                    textDecoration: i.voided ? 'line-through' : 'none',
                    color: i.voided ? 'var(--tp-muted-fg)' : 'inherit',
                    fontSize: '0.9rem',
                  }}
                >
                  <span>
                    {i.qty}× {pickName(locale, i.menu_item)}
                    {i.variant && ` (${pickName(locale, i.variant)})`}
                  </span>
                  <span style={{ display: 'flex', gap: '0.3rem', alignItems: 'center' }}>
                    {formatIQD(i.line_total_iqd, locale)}
                    {!i.voided && !settled && (
                      <Button kind="ghost" onClick={() => setVoidItemId(i.id)}>
                        {tr('op.till.voidItem')}
                      </Button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}

        <hr style={{ border: 'none', borderBlockStart: '1px solid var(--tp-border)' }} />
        <Row label={tr('common.subtotal')} value={formatIQD(totals.subtotal, locale)} />
        {totals.discount > 0 && (
          <Row label={tr('common.discount')} value={`−${formatIQD(totals.discount, locale)}`} />
        )}
        {totals.tax > 0 && <Row label={tr('op.till.tax')} value={formatIQD(totals.tax, locale)} />}
        <Row label={tr('common.total')} value={formatIQD(totals.total, locale)} strong />
        {totals.paid > 0 && (
          <Row label={tr('op.till.remaining', { amount: formatIQD(due, locale) })} value="" />
        )}
        {lastChange != null && lastChange > 0 && (
          <Row label={tr('op.till.change')} value={formatIQD(lastChange, locale)} strong />
        )}
        <ErrorText error={actionError} />

        {settled ? (
          <p style={{ color: 'var(--tp-accent)', fontWeight: 700 }}>{tr('op.till.paidInFull')}</p>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBlockStart: '0.5rem' }}>
            <Button kind="primary" disabled={due <= 0} onClick={() => { setSettleMode('cash'); setTendered(0); setLastChange(null); }}>
              {tr('op.till.payCash')}
            </Button>
            <Button disabled={due <= 0} onClick={() => { setSettleMode('card'); setLastChange(null); }}>
              {tr('op.till.payCard')}
            </Button>
            <Button disabled={due <= 0} onClick={() => { setSettleMode('split'); setShares(null); }}>
              {tr('op.till.splitEvenly')}
            </Button>
            <Button onClick={() => setDiscountOpen(true)}>{tr('op.till.discount')}</Button>
          </div>
        )}
        {settled && (
          <Button style={{ marginBlockStart: '0.4rem' }} onClick={onClosedTab}>
            {tr('common.close')}
          </Button>
        )}
      </div>

      {/* cash settle */}
      {settleMode === 'cash' && (
        <Modal title={tr('op.till.payCash')} onClose={() => setSettleMode(null)}>
          <Row label={tr('common.total')} value={formatIQD(due, locale)} strong />
          <Field label={tr('op.till.tendered')}>
            <input
              style={{ ...inputStyle, fontSize: '1.3rem', textAlign: 'end' }}
              dir="ltr"
              inputMode="numeric"
              value={tendered}
              onChange={(e) => setTendered(Number(e.target.value.replace(/\D/g, '')) || 0)}
            />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'center', marginBlockEnd: '0.6rem' }}>
            <AmountPad value={tendered} onChange={setTendered} />
          </div>
          <Row
            label={tr('op.till.change')}
            value={change.sufficient ? formatIQD(change.changeIqd, locale) : `−${formatIQD(change.shortByIqd, locale)}`}
            strong
          />
          <ErrorText error={actionError} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setSettleMode(null)}>{tr('common.cancel')}</Button>
            <Button
              kind="primary"
              disabled={busy || !change.sufficient || due <= 0}
              onClick={() => void settle('cash', null, tendered)}
            >
              {tr('op.till.recordPayment')}
            </Button>
          </div>
        </Modal>
      )}

      {/* card settle */}
      {settleMode === 'card' && (
        <Modal title={tr('op.till.payCard')} onClose={() => setSettleMode(null)}>
          <Row label={tr('common.total')} value={formatIQD(due, locale)} strong />
          <ErrorText error={actionError} />
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
            <Button onClick={() => setSettleMode(null)}>{tr('common.cancel')}</Button>
            <Button kind="primary" disabled={busy || due <= 0} onClick={() => void settle('card', null, null)}>
              {tr('op.till.recordPayment')}
            </Button>
          </div>
        </Modal>
      )}

      {/* split evenly */}
      {settleMode === 'split' && (
        <Modal title={tr('op.till.splitEvenly')} onClose={() => setSettleMode(null)}>
          <Field label={tr('op.till.splitCount')}>
            <input
              style={inputStyle}
              type="number"
              min={2}
              max={50}
              value={splitN}
              onChange={(e) => setSplitN(Math.max(2, Math.min(50, Number(e.target.value) || 2)))}
            />
          </Field>
          <Button kind="primary" onClick={() => void loadShares()}>
            {tr('op.common.apply')}
          </Button>
          {shares && (
            <div style={{ marginBlockStart: '0.6rem' }}>
              {shares.map((s, i) => (
                <div
                  key={i}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBlockEnd: '0.3rem' }}
                >
                  <span>{tr('op.till.share', { index: i + 1, amount: formatIQD(Number(s), locale) })}</span>
                  <Button
                    disabled={busy || due <= 0 || Number(s) > due}
                    onClick={() => void settle('cash', Number(s), Number(s))}
                  >
                    {tr('op.till.settleShare')}
                  </Button>
                </div>
              ))}
              <Row label={tr('op.till.remaining', { amount: formatIQD(due, locale) })} value="" />
            </div>
          )}
          <ErrorText error={actionError} />
        </Modal>
      )}

      {/* discount */}
      {discountOpen && (
        <PinReasonModal
          title={tr('op.till.discount')}
          busy={busy}
          error={pinError}
          onClose={() => {
            setDiscountOpen(false);
            setPinError(null);
          }}
          onSubmit={(pin, reason) => void applyDiscount(pin, reason)}
        >
          <Field label={tr('op.till.discount')}>
            <select
              style={inputStyle}
              value={discountKind}
              onChange={(e) => setDiscountKind(e.target.value as typeof discountKind)}
            >
              <option value="discount_percent">{tr('op.till.discountPercent')}</option>
              <option value="discount_amount">{tr('op.till.discountAmount')}</option>
            </select>
          </Field>
          <Field label={tr('op.till.discountValue')}>
            <input
              style={inputStyle}
              type="number"
              min={1}
              max={discountKind === 'discount_percent' ? 100 : undefined}
              value={discountValue}
              onChange={(e) => setDiscountValue(Math.max(1, Number(e.target.value) || 1))}
            />
          </Field>
        </PinReasonModal>
      )}

      {/* void after send */}
      {voidItemId && (
        <PinReasonModal
          title={tr('op.till.voidTitle')}
          busy={busy}
          error={pinError}
          reasons={['wrong_item', 'changed_mind', 'quality', 'spill', 'staff_error', 'other']}
          onClose={() => {
            setVoidItemId(null);
            setPinError(null);
          }}
          onSubmit={(pin, reason) => void voidItem(pin, reason)}
        />
      )}
    </div>
  );
}

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        fontWeight: strong ? 700 : 400,
        marginBlockEnd: '0.15rem',
      }}
    >
      <span>{label}</span>
      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}
