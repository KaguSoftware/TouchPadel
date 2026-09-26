import { Outlet, createRoute } from '@tanstack/react-router';
import { useQuery } from '@tanstack/react-query';
import { formatNumber } from '@touch/i18n';
import { rootRoute, RequireRole } from './__root';
import { useAuth, allowedSubRoutes } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { SubNav, type SubNavGroup } from '../components/SubNav';
import type { IconName } from '../components/icons';
import { SK, fetchUnfinishedCounts } from '../features/stock/stockKeys';
import { phoneCountsWaiting } from '../features/stock/storeLogic';

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
  | 'moves'
  | 'waste'
  | 'recipes'
  | 'counts'
  | 'variance'
  | 'margins'
  | 'alerts'
  | 'expiry'
  | 'products'
  | 'suppliers';

/**
 * Grouped by how often staff come here, most often first. Alerts sat under
 * "Review" beside reports although it is a to-do list; it now sits with the
 * other every-day screens. The count moved out of "Review" too: it is the one
 * way stock is corrected, so it leads the group that checks the shelves, and
 * its results ("Count differences", formerly "Variance") follow it. Setup,
 * visited least, goes last.
 */
const STOCK_GROUPS: readonly {
  label: 'groupDaily' | 'groupCheck' | 'groupSetup';
  items: readonly { to: string; key: StockNavKey; icon: IconName; exact?: boolean }[];
}[] = [
  {
    label: 'groupDaily',
    items: [
      { to: '/stock', key: 'onHand', icon: 'package', exact: true },
      { to: '/stock/receive', key: 'receive', icon: 'box' },
      // Wave 5: stock carried between the cafe and bakery stores.
      { to: '/stock/moves', key: 'moves', icon: 'repeat' },
      { to: '/stock/waste', key: 'waste', icon: 'ban' },
      { to: '/stock/expiry', key: 'expiry', icon: 'hourglass' },
      { to: '/stock/alerts', key: 'alerts', icon: 'bell' },
    ],
  },
  {
    label: 'groupCheck',
    items: [
      { to: '/stock/counts', key: 'counts', icon: 'scale' },
      { to: '/stock/variance', key: 'variance', icon: 'chart' },
      { to: '/stock/margins', key: 'margins', icon: 'trendUp' },
    ],
  },
  {
    label: 'groupSetup',
    items: [
      { to: '/stock/ingredients', key: 'ingredients', icon: 'layers' },
      { to: '/stock/recipes', key: 'recipes', icon: 'fileText' },
      // Touch Shop (0144/0145).
      { to: '/stock/products', key: 'products', icon: 'tag' },
      { to: '/stock/suppliers', key: 'suppliers', icon: 'users' },
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
  const { tr, locale } = useLocale();
  const visible = new Set(staff ? allowedSubRoutes(staff.role, '/stock') : []);
  visible.add('/stock'); // the index (on-hand) is the layout's own path
  // Counts from the phone waiting for a manager: the Stock count row's badge
  // (wave5-addendum-2026-09-25 §2.8.5, no push).
  const countsQ = useQuery({ queryKey: SK.unfinishedCounts, queryFn: fetchUnfinishedCounts, refetchInterval: 60_000 });
  const waiting = phoneCountsWaiting(countsQ.data).length;
  const groups: SubNavGroup[] = STOCK_GROUPS.map((group) => ({
    label: tr(`op.stockNav.${group.label}` as const),
    items: group.items
      .filter((item) => visible.has(item.to))
      .map((item) => ({
        to: item.to,
        label: tr(`op.stockNav.${item.key}` as const),
        icon: item.icon,
        exact: item.exact,
        ...(item.key === 'counts' && waiting > 0 ? { badge: waiting, badgeLabel: tr('ws.stores.counts.phone.badge', { count: formatNumber(waiting, locale) }) } : {}),
      })),
  }));

  return (
    <div style={{ display: 'flex', gap: 'var(--tp-sp-5)', alignItems: 'flex-start' }}>
      <SubNav title={tr('stock.title')} groups={groups} />
      <div style={{ flex: 1, minInlineSize: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
