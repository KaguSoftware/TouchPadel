import { createRoute } from '@tanstack/react-router';
import { t } from '@touch/i18n';
import { rootRoute } from './__root';

// Stock placeholder — ledger/FEFO/variance UI lands W4 (design-delivery.md).
// Recipes: max ONE level of sub-recipe nesting, cycle guard stays (plan cut #7).
// Batch-expiry UI is the first scope item to slip to W5 if squeezed (HANDOFF ledger).
export const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  component: () => <h1>{t('en', 'stock.title')}</h1>,
});
