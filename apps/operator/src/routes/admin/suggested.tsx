// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/suggested
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function SuggestedPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.suggested" />;
}

export const adminSuggestedRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'suggested',
  component: guarded('/admin/suggested', SuggestedPlaceholder),
});
