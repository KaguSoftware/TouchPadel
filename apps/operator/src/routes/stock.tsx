import { createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { useLocale } from '../lib/i18n';

// Stock placeholder — ledger/FEFO/variance UI lands W4 (design-delivery.md).
// Recipes: max ONE level of sub-recipe nesting, cycle guard stays (plan cut #7).
// Batch-expiry UI is the first scope item to slip to W5 if squeezed (HANDOFF ledger).
export const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  component: StockPlaceholder,
});

function StockPlaceholder() {
  const { tr } = useLocale();
  return (
    <RequireRole route="/stock">
      <h1>{tr('stock.title')}</h1>
    </RequireRole>
  );
}
