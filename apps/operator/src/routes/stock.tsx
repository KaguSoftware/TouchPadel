import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { useAuth, allowedSubRoutes } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { SubNav, type SubNavGroup } from '../components/SubNav';

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
  items: readonly { to: string; key: StockNavKey }[];
}[] = [
  {
    label: 'groupDaily',
    items: [
      { to: '/stock', key: 'onHand' },
      { to: '/stock/receive', key: 'receive' },
      { to: '/stock/waste', key: 'waste' },
      { to: '/stock/expiry', key: 'expiry' },
    ],
  },
  {
    label: 'groupSetup',
    items: [
      { to: '/stock/ingredients', key: 'ingredients' },
      { to: '/stock/recipes', key: 'recipes' },
    ],
  },
  {
    label: 'groupReview',
    items: [
      { to: '/stock/counts', key: 'counts' },
      { to: '/stock/variance', key: 'variance' },
      { to: '/stock/margins', key: 'margins' },
      { to: '/stock/alerts', key: 'alerts' },
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
      .map((item) => ({ to: item.to, label: tr(`op.stockNav.${item.key}` as const) })),
  }));

  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
      <SubNav title={tr('stock.title')} groups={groups} />
      <div style={{ flex: 1, minInlineSize: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
