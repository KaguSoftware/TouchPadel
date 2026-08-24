import { createRoute } from '@tanstack/react-router';
import { t } from '@touch/i18n';
import { rootRoute } from './__root';

// Landing: will redirect to the station's home module per station.json mode
// (design-arch.md §2.1 getStation) — placeholder for now.
export const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: () => <h1>{t('en', 'operator.home')}</h1>,
});
