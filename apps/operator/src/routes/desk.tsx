import { createRoute } from '@tanstack/react-router';
import { t } from '@touch/i18n';
import { rootRoute } from './__root';

// Desk calendar placeholder — reservation ops land W2–W3 (design-delivery.md; FE1).
// Reservation kinds: booking | hold | maintenance (plan override #3); grid updates via
// broadcast topics `courts` / `floor` (plan override #4); replay conflicts (409 on the
// EXCLUDE constraint) surface HERE for manual resolution (design-arch.md §2.2).
export const deskRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/desk',
  component: () => <h1>{t('en', 'desk.title')}</h1>,
});
