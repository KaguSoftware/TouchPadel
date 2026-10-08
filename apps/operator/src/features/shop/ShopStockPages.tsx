/**
 * The shop store's pages on the Touch Shop desk (0245): the café's own On
 * hand, Goods in and Count screens, told to keep the shop store and shop
 * stock only (StockScopeProvider). One screen each, so a rule fixed on the
 * café's page is fixed on the shop's too. No Waste page here: the shop desk
 * does not write stock off (2026-10-08).
 */
import { StockScopeProvider } from '../stock/stockScope';
import { OnHand } from '../stock/OnHand';
import { ReceiveDelivery } from '../stock/ReceiveDelivery';
import { CountScreen } from '../stock/CountScreen';

export function ShopStock() {
  return (
    <StockScopeProvider scope="shop">
      <OnHand />
    </StockScopeProvider>
  );
}

export function ShopReceive() {
  return (
    <StockScopeProvider scope="shop">
      <ReceiveDelivery />
    </StockScopeProvider>
  );
}

export function ShopCounts() {
  return (
    <StockScopeProvider scope="shop">
      <CountScreen />
    </StockScopeProvider>
  );
}
