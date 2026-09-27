/**
 * Which stock a Stock page keeps (0245, docs/design/shop/shop-desk-2026-09-27.md).
 *
 * The café's Stock module (/stock) keeps the cafe and bakery stores and never
 * shop stock; the Touch Shop desk (/shop) keeps the shop store and only shop
 * stock. The same On hand, Goods in, Count and Waste screens serve both: the
 * shop's routes wrap them in <StockScopeProvider scope="shop">, and a screen
 * reads its scope with useStockScope() (default 'venue', the café's).
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { StockScope } from './storeLogic';

const StockScopeContext = createContext<StockScope>('venue');

export function StockScopeProvider({ scope, children }: { scope: StockScope; children: ReactNode }) {
  return <StockScopeContext.Provider value={scope}>{children}</StockScopeContext.Provider>;
}

export function useStockScope(): StockScope {
  return useContext(StockScopeContext);
}
