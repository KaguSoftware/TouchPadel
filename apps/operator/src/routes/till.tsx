import { createRoute } from '@tanstack/react-router';
import { t } from '@touch/i18n';
import { rootRoute } from './__root';

// Till placeholder — cashier tabs/splits land W3 (design-delivery.md; FE2).
// Money: integer IQD only. Even split = EXACT largest-remainder — base floor(total/n),
// first (total mod n) shares get +1, sum invariant === total; NO 250-IQD rounding
// (venue_settings.cash_rounding_iqd default 1 = off) — plan override #1, @touch/core/money.
export const tillRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/till',
  component: () => <h1>{t('en', 'till.title')}</h1>,
});
