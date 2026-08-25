// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/staff
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function StaffPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.staff" />;
}

export const adminStaffRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'staff',
  component: guarded('/admin/staff', StaffPlaceholder),
});
