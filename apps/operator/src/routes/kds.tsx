import { createRoute } from '@tanstack/react-router';
import { t } from '@touch/i18n';
import { rootRoute } from './__root';

// KDS placeholder — kitchen ticket flow lands W3 (design-delivery.md; FE2).
// Normal source: realtime broadcast topic `kds` (plan override #4). Degraded source:
// LAN feed via touch.onLanTicket from the till's ws server on :47810, resync via
// ticket.snapshot, dedupe by client_ref (design-arch.md §2.4).
export const kdsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/kds',
  component: () => <h1>{t('en', 'kds.title')}</h1>,
});
