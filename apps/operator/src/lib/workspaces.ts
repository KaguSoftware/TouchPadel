/**
 * Five workspaces, one app (spec §04). A workspace is a landing screen plus
 * its own navigation set; a staff role maps to the workspaces it may enter.
 * Nothing here grants access — ROUTE_ROLES and the RPC guards remain the wall.
 * The active workspace only chooses which rail the shell renders.
 *
 * A workspace may also carry SECTIONS. A section is a landing screen of its
 * own plus its own rail: the workspace shows one button for it, and once
 * inside, the rail is the section's list and nothing else. Management used to
 * print its own three links plus five setup links plus nine operations links
 * in one 17-row column, so the two things an owner opens daily sat in the
 * same undifferentiated stack as the nine they open twice a year.
 *
 * Management's sections are now FINANCIAL, OBSERVATION and SETUP, and the cut
 * is by the question being asked rather than by screen type:
 *
 *   * Financial answers "how much came in, how much went out, does the cash
 *     agree" — every row states an IQD figure or sets the price that produces
 *     one. Revenue, court income, cafe sales, the drawer, the day close,
 *     rates, menu prices, stock value.
 *   * Observation answers "what is happening, what has the pattern been, who
 *     did it, what is waiting on me" — the floor now, patterns, bookings,
 *     tills, staff activity, staff requests, marketing, the audit log.
 *   * Setup stays what it was: configuration, not a reading of the business.
 *
 * The old Operations section is GONE, dissolved into the two above. It was the
 * residue of "manager screens the owner can also open", which is a statement
 * about permissions, not about what the owner came to find out. Its nine links
 * split cleanly: day close, rates and menu are money; bookings, tills and
 * audit are observation.
 */
import type { IconName } from '../components/icons';
import type { StaffRole } from './auth';

export type WorkspaceKey = 'courtDesk' | 'cashier' | 'prep' | 'manager' | 'owner';

export interface NavItem {
  to: string;
  /** i18n key under ws.shell.nav */
  labelKey:
    | 'today'
    | 'calendar'
    | 'customers'
    | 'newSeries'
    | 'blockCourt'
    | 'till'
    | 'openTabs'
    | 'cashDrawer'
    | 'overview'
    | 'bookings'
    | 'tills'
    | 'dayClose'
    | 'menu'
    | 'rates'
    | 'promotions'
    | 'stock'
    | 'reports'
    | 'audit'
    | 'panel'
    | 'analytics'
    | 'staff'
    | 'courts'
    | 'tables'
    | 'settings'
    | 'guestSite'
    // Management's Financial / Observation sections (see the header note).
    | 'revenue'
    | 'courtIncome'
    | 'cafeSales'
    | 'menuPrices'
    | 'stockValue'
    | 'floorNow'
    | 'patterns'
    | 'staffActivity'
    | 'requests'
    | 'marketing'
    | 'telegram';
  icon: IconName;
  /** Match active state on this prefix (default: exact path or prefix of `to`). */
  activePrefix?: string;
  /** Exact match only (for index routes like /desk under /desk/...). */
  exact?: boolean;
  /**
   * Owned by the section but NOT printed as a rail row: reached from inside
   * one of its screens instead. Promotions and Telegram are opened from the
   * marketing panel, and without this they would leave the rail behind —
   * `sectionForPath` would find no section and the shell would fall back to
   * the workspace's own list mid-task. Listing them keeps the rail steady
   * without adding two rows an owner never navigates to directly.
   */
  hidden?: boolean;
}

export interface NavGroup {
  /** i18n key under ws.shell.nav, or null for the primary (untitled) group. */
  labelKey: 'groupOperations' | 'groupSetup' | null;
  items: readonly NavItem[];
}

export type SectionKey = 'financial' | 'observation' | 'setup';

/**
 * A named part of a workspace with its own landing screen and its own rail.
 * `home` is where the workspace's button lands; `items` is the rail shown
 * from there on, and its first item is always `home` itself so the section's
 * overview is one click away from every screen inside it.
 * Name and lead read from ws.shell.section.* / ws.shell.sectionLead.*.
 */
export interface NavSection {
  key: SectionKey;
  home: string;
  icon: IconName;
  items: readonly NavItem[];
}

export interface Workspace {
  key: WorkspaceKey;
  home: string;
  icon: IconName;
  groups: readonly NavGroup[];
  /** Sections reachable from this workspace's rail, one button each. */
  sections?: readonly NavSection[];
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

/**
 * Management's own rail is now one row. The panel is the headline every other
 * screen in the workspace elaborates; reports and analytics moved into the
 * sections that own the question they answer (revenue → Financial, patterns
 * → Observation) rather than sitting above the split as loose peers.
 */
const OWNER_PRIMARY: readonly NavItem[] = [{ to: '/panel', labelKey: 'panel', icon: 'dashboard' }];

/**
 * FINANCIAL — money in, money out, and the two places it is counted.
 *
 * Order is the money's own path: what was earned (revenue, then the two
 * sources that make it up), then what is physically in the drawer and whether
 * it agrees at the close, then the prices that will produce tomorrow's
 * figures, then the value sitting on the shelves.
 *
 * Every /reports child except staff lives here, which is deliberate: a report
 * that states IQD is a financial instrument, and /reports alone redirects to
 * /reports/courts, so the bare path lands inside this section rather than
 * nowhere.
 */
const OWNER_FINANCIAL: readonly NavItem[] = [
  { to: '/financial', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/reports/revenue', labelKey: 'revenue', icon: 'chart' },
  { to: '/reports/courts', labelKey: 'courtIncome', icon: 'court' },
  { to: '/reports/cafe', labelKey: 'cafeSales', icon: 'cake' },
  { to: '/till/drawer', labelKey: 'cashDrawer', icon: 'drawer' },
  { to: '/admin/day-close', labelKey: 'dayClose', icon: 'sun' },
  { to: '/admin/rates', labelKey: 'rates', icon: 'scale' },
  { to: '/admin/menu', labelKey: 'menuPrices', icon: 'layers', activePrefix: '/admin/menu' },
  { to: '/reports/stock', labelKey: 'stockValue', icon: 'package' },
];

/**
 * OBSERVATION — watching the venue rather than counting it.
 *
 * Order is by how far back you are looking: right now (the floor), the shape
 * over time (patterns), then the three live records you inspect (bookings,
 * tills, staff activity), then the two things that WAIT ON THE OWNER — staff
 * requests to confirm and marketing to run — and finally the audit log, which
 * is where you go when one of the others raised a question.
 *
 * `/till/tabs` carries no activePrefix on purpose: it used to be '/till', which
 * would now also light this row while the owner is on /till/drawer over in
 * Financial, and the rail would claim they were in two sections at once.
 */
const OWNER_OBSERVATION: readonly NavItem[] = [
  { to: '/observation', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/ops', labelKey: 'floorNow', icon: 'dashboard' },
  { to: '/analytics', labelKey: 'patterns', icon: 'trendUp' },
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk' },
  { to: '/till/tabs', labelKey: 'tills', icon: 'receipt' },
  { to: '/reports/staff', labelKey: 'staffActivity', icon: 'users' },
  { to: '/observation/requests', labelKey: 'requests', icon: 'bell' },
  { to: '/marketing', labelKey: 'marketing', icon: 'spark', activePrefix: '/marketing' },
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
  // Opened from the marketing panel, not from the rail. See NavItem.hidden.
  { to: '/admin/promotions', labelKey: 'promotions', icon: 'tag', hidden: true },
  { to: '/admin/telegram', labelKey: 'telegram', icon: 'phone', hidden: true },
];

const OWNER_SETUP: readonly NavItem[] = [
  { to: '/setup', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/admin/staff', labelKey: 'staff', icon: 'shield' },
  { to: '/admin/courts', labelKey: 'courts', icon: 'court' },
  { to: '/admin/qr', labelKey: 'tables', icon: 'qr' },
  {
    to: '/admin/settings',
    labelKey: 'settings',
    icon: 'settings',
    activePrefix: '/admin/settings',
  },
  { to: '/admin/hero', labelKey: 'guestSite', icon: 'globe', activePrefix: '/admin/hero' },
];

const OWNER_SECTIONS: readonly NavSection[] = [
  { key: 'financial', home: '/financial', icon: 'banknote', items: OWNER_FINANCIAL },
  { key: 'observation', home: '/observation', icon: 'eye', items: OWNER_OBSERVATION },
  { key: 'setup', home: '/setup', icon: 'settings', items: OWNER_SETUP },
];

export const WORKSPACES: Record<WorkspaceKey, Workspace> = {
  courtDesk: {
    key: 'courtDesk',
    home: '/desk/today',
    icon: 'calendar',
    groups: [{ labelKey: null, items: COURT_DESK }],
  },
  cashier: {
    key: 'cashier',
    home: '/till',
    icon: 'grid',
    groups: [{ labelKey: null, items: CASHIER }],
  },
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
    groups: [{ labelKey: null, items: OWNER_PRIMARY }],
    sections: OWNER_SECTIONS,
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
  if (path === '/panel' || path.startsWith('/reports/revenue') || path === '/analytics')
    return 'owner';
  if (path === '/setup' || path.startsWith('/setup/')) return 'owner';
  // The section homes. /observation/requests is owner-only too, so the whole
  // subtree resolves here rather than only its landing screen.
  if (path === '/financial' || path === '/observation' || path.startsWith('/observation/'))
    return 'owner';
  if (path === '/marketing' || path.startsWith('/marketing/')) return 'owner';
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

/** Every rail target of a workspace: its own groups and all of its sections. */
export function workspaceItems(ws: Workspace): readonly NavItem[] {
  return [
    ...ws.groups.flatMap((g) => g.items),
    // Hidden items included: this drives workspaceOwnsPath, and a route the
    // section owns without printing must still keep the rail.
    ...(ws.sections ?? []).flatMap((s) => s.items),
  ];
}

/**
 * The section `path` sits inside, or null when it belongs to the workspace's
 * own rail. Derived from the URL rather than remembered, so a deep link, a
 * reload and a drill-through all land on the rail that matches the screen.
 */
export function sectionForPath(ws: Workspace, path: string): NavSection | null {
  for (const section of ws.sections ?? []) {
    if (section.items.some((item) => isNavActive(item, path))) return section;
  }
  return null;
}

/**
 * Can this workspace's rail — its own or one of its sections' — reach `path`?
 * Guards the shell's "follow a link into another workspace" rule: /ops is the
 * manager's home AND the owner's operations section, and an owner opening it
 * must keep the management rail.
 */
export function workspaceOwnsPath(key: WorkspaceKey, path: string): boolean {
  const ws = WORKSPACES[key];
  return workspaceItems(ws).some((item) => isNavActive(item, path));
}

/** The rows a section's rail prints — its items minus the hidden ones. */
export function sectionRailItems(section: NavSection): readonly NavItem[] {
  return section.items.filter((item) => !item.hidden);
}
