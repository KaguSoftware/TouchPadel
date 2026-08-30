'use client';

import type { Locale } from '@touch/i18n';
import type { CafeSettings, MenuItem } from '@/lib/menu';
import type { BasketLine } from '@/lib/cafe/basket';
import type { GuestOrder } from '@/hooks/cafe/orders';
import type { WaiterPhase } from '@/hooks/cafe/waiter';
import type { WaiterReason } from '@/hooks/cafe/useWaiterCall';
import { ItemSheet } from './ItemSheet/ItemSheet';
import { BasketSheet } from './BasketSheet/BasketSheet';
import { QrRequiredSheet } from './QrRequiredSheet/QrRequiredSheet';
import { WaiterSheet } from './WaiterButton/WaiterSheet';
import { OrdersSheet } from './OrdersPanel/OrdersSheet';
import { Toast, type ToastMessage } from './Toast/Toast';
import { BellTutorial } from './BellTutorial/BellTutorial';

/**
 * Every overlay in one place: the five sheets, the coach mark and the toast.
 * Split out of `CafeApp` so the orchestrator stays state + wiring — this file
 * is pure pass-through and holds no state of its own.
 *
 * Only ONE overlay is ever interactive at a time; `CafeApp` marks the shell
 * `inert` while any of them is open.
 */
export interface CafeOverlaysProps {
  locale: Locale;
  settings: CafeSettings;
  itemsById: Map<string, MenuItem>;
  /** item id -> category `name_en`, so a photo-less item can borrow its section icon */
  categoryNames: Map<string, string>;

  item: MenuItem | null;
  basketOpen: boolean;
  waiterOpen: boolean;
  ordersOpen: boolean;
  qrRequired: 'order' | 'waiter' | null;
  tutorialOpen: boolean;

  lines: BasketLine[];
  note: string;
  subtotal: number;
  discountTotal: number;
  total: number;
  sending: boolean;
  degraded: boolean;
  tableBound: boolean;

  waiterPhase: WaiterPhase;
  cooldownLeftMs: number;
  liveOrders: GuestOrder[];
  earlierOrders: GuestOrder[];

  toast: ToastMessage | null;
  bellRef: React.RefObject<HTMLButtonElement | null>;

  onCloseItem(): void;
  onAddLine(line: BasketLine): void;
  onOpenSuggested(item: MenuItem): void;
  onItemViewed(item: MenuItem): void;
  onItemAbandoned(item: MenuItem, dwellMs: number): void;
  onCloseBasket(): void;
  onSetQty(key: string, qty: number): void;
  onRemoveLine(key: string): void;
  onSetNote(note: string): void;
  onSubmit(): void;
  onPickReason(reason: WaiterReason): void;
  onCloseWaiter(): void;
  onCloseOrders(): void;
  onCloseQr(): void;
  onDismissTutorial(): void;
  onDismissToast(): void;
}

export function CafeOverlays(p: CafeOverlaysProps) {
  return (
    <>
      <ItemSheet
        locale={p.locale}
        item={p.item}
        settings={p.settings}
        itemsById={p.itemsById}
        categoryNames={p.categoryNames}
        onClose={p.onCloseItem}
        onAdd={p.onAddLine}
        onOpenSuggested={p.onOpenSuggested}
        onViewed={p.onItemViewed}
        onAbandon={p.onItemAbandoned}
      />
      <BasketSheet
        locale={p.locale}
        open={p.basketOpen}
        lines={p.lines}
        note={p.note}
        subtotal={p.subtotal}
        discountTotal={p.discountTotal}
        total={p.total}
        degraded={p.degraded}
        sending={p.sending}
        tableBound={p.tableBound}
        onClose={p.onCloseBasket}
        onSetQty={p.onSetQty}
        onRemove={p.onRemoveLine}
        onSetNote={p.onSetNote}
        onSubmit={p.onSubmit}
        onBrowse={p.onCloseBasket}
      />
      <WaiterSheet
        locale={p.locale}
        open={p.waiterOpen}
        phase={p.waiterPhase}
        degraded={p.degraded}
        cooldownLeftMs={p.cooldownLeftMs}
        onPick={p.onPickReason}
        onClose={p.onCloseWaiter}
      />
      <OrdersSheet
        locale={p.locale}
        open={p.ordersOpen}
        live={p.liveOrders}
        earlier={p.earlierOrders}
        onClose={p.onCloseOrders}
      />
      <QrRequiredSheet locale={p.locale} reason={p.qrRequired} onClose={p.onCloseQr} />
      {p.tutorialOpen && (
        <BellTutorial locale={p.locale} targetRef={p.bellRef} onDismiss={p.onDismissTutorial} />
      )}
      <Toast toast={p.toast} onDismiss={p.onDismissToast} />
    </>
  );
}
