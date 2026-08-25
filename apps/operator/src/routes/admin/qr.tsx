// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/qr
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function QrPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.qr" />;
}

export const adminQrRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'qr',
  component: guarded('/admin/qr', QrPlaceholder),
});
