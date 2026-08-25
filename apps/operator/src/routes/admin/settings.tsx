// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/settings
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function SettingsPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.settings" />;
}

export const adminSettingsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'settings',
  component: guarded('/admin/settings', SettingsPlaceholder),
});
