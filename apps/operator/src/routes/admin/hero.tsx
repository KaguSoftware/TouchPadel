// SCOPE(cafe-rebuild W10-W11): placeholder — GROWS LATER → features/admin/hero
import { createRoute } from '@tanstack/react-router';
import { adminRoute } from '../admin';
import { ComingSoon } from '../../components/ComingSoon';
import { guarded } from './_shared';

function HeroPlaceholder() {
  return <ComingSoon titleKey="op.adminNav.hero" />;
}

export const adminHeroRoute = createRoute({
  getParentRoute: () => adminRoute,
  path: 'hero',
  component: guarded('/admin/hero', HeroPlaceholder),
});
