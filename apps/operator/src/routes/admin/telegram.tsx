// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/telegram
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function TelegramPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.telegram" />;
}

export const adminTelegramRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'telegram',
  component: guarded('/admin/telegram', TelegramPlaceholder),
});
