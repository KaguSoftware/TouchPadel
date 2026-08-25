// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/categories
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function CategoriesPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.categories" />;
}

export const adminCategoriesRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'categories',
  component: guarded('/admin/categories', CategoriesPlaceholder),
});
