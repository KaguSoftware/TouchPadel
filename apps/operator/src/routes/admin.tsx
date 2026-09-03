/**
 * `/admin` LAYOUT route: role gate + grouped left sub-nav + <Outlet/>.
 * Child routes live in routes/admin/*.tsx and are attached in main.tsx via
 * `adminRoute.addChildren(adminChildren)` (routes/admin/_children.ts), which
 * keeps this module free of an import cycle with its children.
 */
import { Outlet, createRoute } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { useAuth, allowedSubRoutes } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { SubNav, type SubNavGroup } from '../components/SubNav';

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: () => (
    <RequireRole route="/admin">
      <AdminShell />
    </RequireRole>
  ),
});

type AdminNavKey =
  | 'menu'
  | 'categories'
  | 'addons'
  | 'suggested'
  | 'hero'
  | 'qr'
  | 'courts'
  | 'rates'
  | 'hours'
  | 'dayClose'
  | 'telegram'
  | 'settings'
  | 'staff'
  | 'audit';

type GroupKey = 'groupMenu' | 'groupGuest' | 'groupOps' | 'groupSystem';

/** Sub-nav groups per operator-slice.md §1.2 (visual headers only, not routes). */
const ADMIN_GROUPS: readonly {
  label: GroupKey;
  items: readonly { to: string; key: AdminNavKey }[];
}[] = [
  {
    label: 'groupMenu',
    items: [
      { to: '/admin/menu', key: 'menu' },
      { to: '/admin/categories', key: 'categories' },
      { to: '/admin/addons', key: 'addons' },
      { to: '/admin/suggested', key: 'suggested' },
    ],
  },
  {
    label: 'groupGuest',
    items: [
      { to: '/admin/hero', key: 'hero' },
      { to: '/admin/qr', key: 'qr' },
    ],
  },
  {
    label: 'groupOps',
    items: [
      { to: '/admin/courts', key: 'courts' },
      { to: '/admin/rates', key: 'rates' },
      { to: '/admin/hours', key: 'hours' },
      { to: '/admin/day-close', key: 'dayClose' },
    ],
  },
  {
    label: 'groupSystem',
    items: [
      { to: '/admin/telegram', key: 'telegram' },
      { to: '/admin/settings', key: 'settings' },
      { to: '/admin/staff', key: 'staff' },
      { to: '/admin/audit', key: 'audit' },
    ],
  },
];

export function AdminShell() {
  const { staff } = useAuth();
  const { tr } = useLocale();
  const visible = new Set(staff ? allowedSubRoutes(staff.role, '/admin') : []);
  const groups: SubNavGroup[] = ADMIN_GROUPS.map((group) => ({
    label: tr(`op.adminNav.${group.label}` as const),
    items: group.items
      .filter((item) => visible.has(item.to))
      .map((item) => ({ to: item.to, label: tr(`op.adminNav.${item.key}` as const) })),
  }));

  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
      <SubNav title={tr('admin.title')} groups={groups} />
      <div style={{ flex: 1, minInlineSize: 0 }}>
        <Outlet />
      </div>
    </div>
  );
}
