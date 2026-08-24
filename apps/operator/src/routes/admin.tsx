import { createRoute } from '@tanstack/react-router';
import { t } from '@touch/i18n';
import { rootRoute } from './__root';

// Admin placeholder — staff management (owner-only policies), menu edits, table QR
// token rotation (tables.token_version bump — design-arch.md §6.2). Sensitive actions
// require fresh PIN + reason_code and write audit_log (design-arch.md §4).
export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: () => <h1>{t('en', 'admin.title')}</h1>,
});
