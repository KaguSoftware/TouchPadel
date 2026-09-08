/**
 * `/admin` LAYOUT route. The rail (lib/workspaces.ts) links straight to most
 * admin screens; only two FAMILIES have more siblings than the rail shows and
 * get a strip of section tabs above the routed screen:
 *
 *   Menu       — items · categories · add-ons · suggested
 *   Guest site — home screen · table QR · telegram
 *
 * Every other admin screen (rates, promotions, courts, hours, day close,
 * settings, staff, audit) is a rail destination and renders without a strip.
 * Child routes live in routes/admin/*.tsx and attach in main.tsx via
 * routes/admin/_children.ts (no import cycle).
 */
import { Outlet, createRoute, useRouterState } from '@tanstack/react-router';
import { rootRoute, RequireRole } from './__root';
import { useAuth, allowedSubRoutes } from '../lib/auth';
import { useLocale } from '../lib/i18n';
import { SubNav, type SubNavGroup } from '../components/SubNav';
import type { IconName } from '../components/icons';

export const adminRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/admin',
  component: () => (
    <RequireRole route="/admin">
      <AdminShell />
    </RequireRole>
  ),
});

type AdminNavKey = 'menu' | 'categories' | 'addons' | 'suggested' | 'hero' | 'qr' | 'telegram';

const FAMILIES: readonly {
  label: 'groupMenu' | 'groupGuest';
  items: readonly { to: string; key: AdminNavKey; icon: IconName }[];
}[] = [
  {
    label: 'groupMenu',
    items: [
      { to: '/admin/menu', key: 'menu', icon: 'layers' },
      { to: '/admin/categories', key: 'categories', icon: 'grid' },
      { to: '/admin/addons', key: 'addons', icon: 'plus' },
      { to: '/admin/suggested', key: 'suggested', icon: 'spark' },
    ],
  },
  {
    label: 'groupGuest',
    items: [
      { to: '/admin/hero', key: 'hero', icon: 'globe' },
      { to: '/admin/qr', key: 'qr', icon: 'qr' },
      { to: '/admin/telegram', key: 'telegram', icon: 'bell' },
    ],
  },
];

export function AdminShell() {
  const { staff } = useAuth();
  const { tr } = useLocale();
  const path = useRouterState({ select: (s) => s.location.pathname });
  const visible = new Set(staff ? allowedSubRoutes(staff.role, '/admin') : []);
  const family = FAMILIES.find((f) => f.items.some((i) => path === i.to || path.startsWith(`${i.to}/`)));
  const groups: SubNavGroup[] = family
    ? [
        {
          label: tr(`op.adminNav.${family.label}` as const),
          items: family.items
            .filter((item) => visible.has(item.to))
            .map((item) => ({ to: item.to, label: tr(`op.adminNav.${item.key}` as const), icon: item.icon })),
        },
      ]
    : [];

  return (
    <div style={{ minInlineSize: 0 }}>
      {groups.length > 0 && groups[0]!.items.length > 1 && (
        <SubNav variant="strip" title={tr('admin.title')} groups={groups} />
      )}
      <Outlet />
    </div>
  );
}
