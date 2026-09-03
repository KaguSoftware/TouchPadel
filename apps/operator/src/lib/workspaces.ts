/**
 * Five workspaces, one app (spec §04). A workspace is a landing screen plus
 * its own navigation set; a staff role maps to the workspaces it may enter.
 * Nothing here grants access — ROUTE_ROLES and the RPC guards remain the wall.
 * The active workspace only chooses which rail the shell renders.
 */
import type { IconName } from '../components/icons';
import type { StaffRole } from './auth';

export type WorkspaceKey = 'courtDesk' | 'cashier' | 'prep' | 'manager' | 'owner';

export interface NavItem {
  to: string;
  /** i18n key under ws.shell.nav */
  labelKey:
    | 'today' | 'calendar' | 'customers' | 'newSeries' | 'blockCourt'
    | 'till' | 'openTabs' | 'cashDrawer'
    | 'overview' | 'bookings' | 'tills' | 'dayClose' | 'menu' | 'rates' | 'promotions' | 'stock' | 'reports' | 'audit'
    | 'panel' | 'analytics' | 'staff' | 'courts' | 'tables' | 'settings' | 'guestSite';
  icon: IconName;
  /** Match active state on this prefix (default: exact path or prefix of `to`). */
  activePrefix?: string;
  /** Exact match only (for index routes like /desk under /desk/...). */
  exact?: boolean;
}

export interface NavGroup {
  /** i18n key under ws.shell.nav, or null for the primary (untitled) group. */
  labelKey: 'groupOperations' | 'groupSetup' | null;
  items: readonly NavItem[];
}

export interface Workspace {
  key: WorkspaceKey;
  home: string;
  icon: IconName;
  groups: readonly NavGroup[];
}

const COURT_DESK: readonly NavItem[] = [
  { to: '/desk/today', labelKey: 'today', icon: 'today' },
  { to: '/desk', labelKey: 'calendar', icon: 'calendar', exact: true },
  { to: '/desk/customers', labelKey: 'customers', icon: 'users' },
  { to: '/desk/series/new', labelKey: 'newSeries', icon: 'repeat', activePrefix: '/desk/series' },
  { to: '/desk/block', labelKey: 'blockCourt', icon: 'ban' },
];

const CASHIER: readonly NavItem[] = [
  { to: '/till', labelKey: 'till', icon: 'grid', exact: true },
  { to: '/till/tabs', labelKey: 'openTabs', icon: 'receipt' },
  { to: '/desk/customers', labelKey: 'customers', icon: 'users' },
  { to: '/till/drawer', labelKey: 'cashDrawer', icon: 'drawer' },
];

const MANAGER_OPS: readonly NavItem[] = [
  { to: '/ops', labelKey: 'overview', icon: 'dashboard' },
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk' },
  { to: '/till/tabs', labelKey: 'tills', icon: 'receipt', activePrefix: '/till' },
  { to: '/admin/day-close', labelKey: 'dayClose', icon: 'sun' },
  { to: '/stock', labelKey: 'stock', icon: 'package' },
  { to: '/reports/courts', labelKey: 'reports', icon: 'chart', activePrefix: '/reports' },
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
];

const MANAGER_SETUP: readonly NavItem[] = [
  { to: '/admin/menu', labelKey: 'menu', icon: 'layers', activePrefix: '/admin/menu' },
  { to: '/admin/rates', labelKey: 'rates', icon: 'scale' },
  { to: '/admin/promotions', labelKey: 'promotions', icon: 'tag' },
];

const OWNER_PRIMARY: readonly NavItem[] = [
  { to: '/panel', labelKey: 'panel', icon: 'dashboard' },
  { to: '/reports/revenue', labelKey: 'reports', icon: 'chart', activePrefix: '/reports' },
  { to: '/analytics', labelKey: 'analytics', icon: 'trendUp' },
];

const OWNER_SETUP: readonly NavItem[] = [
  { to: '/admin/staff', labelKey: 'staff', icon: 'shield' },
  { to: '/admin/courts', labelKey: 'courts', icon: 'court' },
  { to: '/admin/qr', labelKey: 'tables', icon: 'qr' },
  { to: '/admin/settings', labelKey: 'settings', icon: 'settings', activePrefix: '/admin/settings' },
  { to: '/admin/hero', labelKey: 'guestSite', icon: 'globe', activePrefix: '/admin/hero' },
];

const OWNER_OPS: readonly NavItem[] = [
  { to: '/ops', labelKey: 'overview', icon: 'eye' },
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk' },
  { to: '/till/tabs', labelKey: 'tills', icon: 'receipt', activePrefix: '/till' },
  { to: '/admin/day-close', labelKey: 'dayClose', icon: 'sun' },
  { to: '/admin/menu', labelKey: 'menu', icon: 'layers', activePrefix: '/admin/menu' },
  { to: '/admin/rates', labelKey: 'rates', icon: 'scale' },
  { to: '/admin/promotions', labelKey: 'promotions', icon: 'tag' },
  { to: '/stock', labelKey: 'stock', icon: 'package' },
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
];

export const WORKSPACES: Record<WorkspaceKey, Workspace> = {
  courtDesk: { key: 'courtDesk', home: '/desk/today', icon: 'calendar', groups: [{ labelKey: null, items: COURT_DESK }] },
  cashier: { key: 'cashier', home: '/till', icon: 'grid', groups: [{ labelKey: null, items: CASHIER }] },
  prep: { key: 'prep', home: '/kds', icon: 'flame', groups: [] },
  manager: {
    key: 'manager',
    home: '/ops',
    icon: 'dashboard',
    groups: [
      { labelKey: null, items: MANAGER_OPS },
      { labelKey: 'groupSetup', items: MANAGER_SETUP },
    ],
  },
  owner: {
    key: 'owner',
    home: '/panel',
    icon: 'shield',
    groups: [
      { labelKey: null, items: OWNER_PRIMARY },
      { labelKey: 'groupSetup', items: OWNER_SETUP },
      { labelKey: 'groupOperations', items: OWNER_OPS },
    ],
  },
};

/** The workspaces a role may enter, own one first. */
export function workspacesForRole(role: StaffRole): readonly WorkspaceKey[] {
  switch (role) {
    case 'cashier':
      return ['cashier'];
    case 'prep':
      return ['prep'];
    case 'court_desk':
      return ['courtDesk'];
    case 'manager':
      return ['manager', 'courtDesk', 'cashier', 'prep'];
    case 'owner':
      return ['owner', 'manager', 'courtDesk', 'cashier', 'prep'];
  }
}

export function defaultWorkspace(role: StaffRole): WorkspaceKey {
  return workspacesForRole(role)[0]!;
}

const STORAGE_KEY = 'touch-operator-workspace';

/** Station-local memory of the last chosen workspace; validated against the role. */
export function loadWorkspace(role: StaffRole): WorkspaceKey {
  const allowed = workspacesForRole(role);
  try {
    const raw = localStorage.getItem(STORAGE_KEY) as WorkspaceKey | null;
    if (raw && (allowed as readonly string[]).includes(raw)) return raw;
  } catch {
    /* private mode */
  }
  return allowed[0]!;
}

/** True once this station has recorded a workspace choice for anyone. */
export function hasStoredWorkspace(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

export function saveWorkspace(key: WorkspaceKey): void {
  try {
    localStorage.setItem(STORAGE_KEY, key);
  } catch {
    /* private mode */
  }
}

/**
 * The workspace a route most naturally belongs to, so opening a link from
 * another workspace (manager → till) can keep the rail coherent. Returns null
 * when the route is shared.
 */
export function workspaceForRoute(path: string): WorkspaceKey | null {
  if (path === '/kds') return 'prep';
  if (path === '/panel' || path.startsWith('/reports/revenue') || path === '/analytics') return 'owner';
  if (path === '/ops') return 'manager';
  return null;
}

/** Is `path` the active route for `item`? */
export function isNavActive(item: NavItem, path: string): boolean {
  const bare = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  if (item.exact) return bare === item.to;
  const prefix = item.activePrefix ?? item.to;
  return bare === prefix || bare.startsWith(`${prefix}/`);
}
