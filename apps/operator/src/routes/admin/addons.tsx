// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/addons
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function AddonsPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.addons" />;
}

export const adminAddonsRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'addons',
  component: guarded('/admin/addons', AddonsPlaceholder),
});
