/**
 * Which stock a Stock page keeps (0245, docs/design/shop/shop-desk-2026-09-27.md).
 *
 * The café's Stock module (/stock) keeps the cafe and bakery stores and never
 * shop stock; the Touch Shop desk (/shop) keeps the shop store and only shop
 * stock. The same On hand, Goods in, Count and Waste screens serve both: the
 * shop's routes wrap them in <StockScopeProvider scope="shop">, and a screen
 * reads its scope with useStockScope() (default 'venue', the café's).
 *
 * A shop product is its own stock (one row per size, counted in pieces): no
 * ingredient, no recipe. useStockWords() gives a screen the scope's words for
 * what it lists, so the shop desk never reads "ingredient" (Sait, 2026-10-21).
 */
import { createContext, useContext, type ReactNode } from 'react';
import { useLocale } from '../../lib/i18n';
import type { StockScope } from './storeLogic';

const StockScopeContext = createContext<StockScope>('venue');

export function StockScopeProvider({ scope, children }: { scope: StockScope; children: ReactNode }) {
  return <StockScopeContext.Provider value={scope}>{children}</StockScopeContext.Provider>;
}

export function useStockScope(): StockScope {
  return useContext(StockScopeContext);
}

/** The words a shared stock screen uses for what it lists: ingredients at the café, products at the shop. */
export function useStockWords() {
  const { tr } = useLocale();
  const shop = useStockScope() === 'shop';
  return {
    shop,
    item: shop ? tr('ws.shop.words.item') : tr('op.stock.ingredient'),
    unknown: shop ? tr('ws.shop.words.unknown') : tr('ws.manager.stock.alerts.unknownIngredient'),
    search: shop ? tr('ws.shop.words.search') : tr('ws.manager.stock.onHand.table.search'),
    noneAll: shop ? tr('ws.shop.words.noneAll') : tr('ws.manager.stock.onHand.table.none.all'),
    noneCountNeeded: shop ? tr('ws.shop.words.noneCountNeeded') : tr('ws.manager.stock.onHand.table.none.countNeeded'),
    clear: shop ? tr('ws.shop.words.clear') : tr('ws.manager.stock.onHand.now.clear'),
    outHint: shop ? tr('ws.shop.words.outHint') : tr('ws.manager.stock.onHand.now.outHint'),
    countNeededHint: shop ? tr('ws.shop.words.countNeededHint') : tr('ws.manager.stock.onHand.now.countNeededHint'),
    howStockMoves: shop ? tr('ws.shop.words.howStockMoves') : tr('ws.manager.stock.onHand.howStockMoves'),
    ledgerLead: shop ? tr('ws.shop.words.ledgerLead') : tr('ws.manager.stock.ledger.lead'),
    ledgerPeriodLead: shop ? tr('ws.shop.words.ledgerPeriodLead') : tr('ws.manager.stock.ledger.periodLead'),
    ledgerEmpty: shop ? tr('ws.shop.words.ledgerEmpty') : tr('ws.manager.stock.ledger.empty'),
    choose: shop ? tr('ws.shop.words.choose') : tr('ws.manager.stock.goodsIn.problem.ingredient'),
    addLine: shop ? tr('ws.shop.words.addLine') : tr('ws.manager.stock.goodsIn.addLine'),
    recordEmpty: shop ? tr('ws.shop.words.recordEmpty') : tr('ws.manager.stock.goodsIn.recordEmpty'),
    countStep: shop ? tr('ws.shop.words.countStep') : tr('ws.manager.stock.count.step2'),
    finishBody: (count: string) =>
      shop ? tr('ws.shop.words.finishBody', { count }) : tr('ws.manager.stock.count.finishBody', { count }),
  };
}
