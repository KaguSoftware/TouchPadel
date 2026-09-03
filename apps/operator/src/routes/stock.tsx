import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { useAuth, allowedSubRoutes } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { SubNav, type SubNavGroup } from '../components/SubNav';
import type { IconName } from '../components/icons';

// Module 5 — stock & recipes (SOW L515-547). The layout mirrors /admin: a
// grouped sub-nav over lazy children. Acceptance is the counts → variance
// flow; batch expiry is the first scope item to slip if squeezed (SOW L929).
export const stockRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/stock',
  component: StockShellGuarded,
});

type StockNavKey =
  | 'onHand'
  | 'ingredients'
  | 'receive'
  | 'waste'
  | 'recipes'
  | 'counts'
  | 'variance'
  | 'margins'
  | 'alerts'
  | 'expiry';

const STOCK_GROUPS: readonly {
  label: 'groupDaily' | 'groupSetup' | 'groupReview';
  items: readonly { to: string; key: StockNavKey; icon: IconName; exact?: boolean }[];
}[] = [
  {
    label: 'groupDaily',
    items: [
      { to: '/stock', key: 'onHand', icon: 'package', exact: true },
      { to: '/stock/receive', key: 'receive', icon: 'box' },
      { to: '/stock/waste', key: 'waste', icon: 'ban' },
      { to: '/stock/expiry', key: 'expiry', icon: 'hourglass' },
    ],
  },
  {
    label: 'groupSetup',
    items: [
      { to: '/stock/ingredients', key: 'ingredients', icon: 'layers' },
      { to: '/stock/recipes', key: 'recipes', icon: 'fileText' },
    ],
  },
  {
    label: 'groupReview',
    items: [
      { to: '/stock/counts', key: 'counts', icon: 'check' },
      { to: '/stock/variance', key: 'variance', icon: 'scale' },
      { to: '/stock/margins', key: 'margins', icon: 'trendUp' },
      { to: '/stock/alerts', key: 'alerts', icon: 'alert' },
    ],
  },
];

function StockShellGuarded() {
  return (
    <RequireRole route="/stock">
      <StockShell />
    </RequireRole>
  );
}

function StockShell() {
  const { staff } = useAuth();
  const { tr } = useLocale();
  const visible = new Set(staff ? allowedSubRoutes(staff.role, '/stock') : []);
  visible.add('/stock'); // the index (on-hand) is the layout's own path
  const groups: SubNavGroup[] = STOCK_GROUPS.map((group) => ({
    label: tr(`op.stockNav.${group.label}` as const),
    items: group.items
      .filter((item) => visible.has(item.to))
      .map((item) => ({ to: item.to, label: tr(`op.stockNav.${item.key}` as const), icon: item.icon, exact: item.exact })),
  }));

  return (
    <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start' }}>
      <SubNav title={tr('stock.title')} groups={groups} />
      <div style={{ flex: 1, minInlineSize: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
