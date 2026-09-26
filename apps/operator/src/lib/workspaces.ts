/**
 * Six workspaces, one app (spec §04). A workspace is a landing screen plus
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
 * Management's sections are now FINANCIAL, OBSERVE, STOCK and SETUP, and the
 * cut is by the question being asked rather than by screen type:
 *
 *   * Financial answers "how much came in, how much went out, does the cash
 *     agree" — every row states an IQD figure or sets the price that produces
 *     one. Revenue, court income, cafe sales, the drawer, the day close,
 *     rates, menu prices.
 *   * Observe (key `observation`) answers "what is happening, who did it, what
 *     is waiting on me" — the floor now, bookings,
 *     tills, staff activity, staff requests, marketing, the audit log.
 *   * Stock answers "what is on the shelves, what came in, what went out and
 *     what is it worth" — the whole /stock module plus the stock value report.
 *     It used to be a single Financial row, which buried ten screens behind
 *     one figure.
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

export type WorkspaceKey = 'courtDesk' | 'cashier' | 'prep' | 'manager' | 'owner' | 'team';

export interface NavItem {
  to: string;
  /** i18n key under ws.shell.nav */
  labelKey:
    | 'today' | 'calendar' | 'customers' | 'newSeries' | 'blockCourt'
    | 'till' | 'openTabs' | 'cashDrawer'
    | 'overview' | 'bookings' | 'tills' | 'dayClose' | 'menu' | 'rates' | 'promotions' | 'stock' | 'reports' | 'audit'
    | 'panel' | 'analytics' | 'staff' | 'courts' | 'tables' | 'settings' | 'guestSite'
    // Management's Financial / Observation sections (see the header note).
    | 'menuPrices'
    | 'floorNow' | 'staffActivity' | 'requests' | 'marketing' | 'telegram'
    // Management's Stock section.
    | 'inventory' | 'stockValue'
    // The owner assistant (docs/design/assistant §5.1).
    | 'assistant'
    // The team workspace (driver, marketing), and the till's and the desk's row.
    | 'myTasks'
    // Protocols and the staff suggestion box (build-contracts-2026-09-23 §5.1).
    | 'protocols' | 'suggestions';
  icon: IconName;
  /**
   * A live count beside the row's name: what waits on the signed-in person
   * there. The shell reads it (RailLink), so a row names the count it wants
   * and never fetches it. Protocols counts the steps to do and the
   * submissions to decide (app.protocols_waiting_count), Suggestions the ones
   * nobody has marked seen (app.suggestions_page's new_count).
   */
  badge?: 'protocolsWaiting' | 'suggestionsNew';
  /** Match active state on this prefix (default: exact path or prefix of `to`). */
  activePrefix?: string;
  /**
   * Further prefixes that belong to the same screen family. The menu editor's
   * tabs (categories, add-ons, suggested items) live beside /admin/menu, not
   * under it, so without these the Menu row went dark on three of its own four
   * tabs and a collapsible rail group closed around the screen being edited.
   */
  alsoActive?: readonly string[];
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
  labelKey: 'groupOperations' | 'groupRun' | 'groupRecords' | 'groupSetup' | null;
  items: readonly NavItem[];
}

export type SectionKey = 'financial' | 'observation' | 'stock' | 'setup';

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

/**
 * My tasks on the desk's and the till's rail: their protocol steps (the desk's
 * courts step and tournament start) and the read-only copy of what they do on
 * the phone (build-contracts-2026-09-23 §5.1). Last, because the working
 * screens above it are what a shift moves between.
 */
const MY_TASKS: NavItem = { to: '/tasks', labelKey: 'myTasks', icon: 'checkCircle' };

const COURT_DESK: readonly NavItem[] = [
  { to: '/desk/today', labelKey: 'today', icon: 'today' },
  { to: '/desk', labelKey: 'calendar', icon: 'calendar', exact: true },
  { to: '/desk/customers', labelKey: 'customers', icon: 'users' },
  { to: '/desk/series/new', labelKey: 'newSeries', icon: 'repeat', activePrefix: '/desk/series' },
  { to: '/desk/block', labelKey: 'blockCourt', icon: 'ban' },
  MY_TASKS,
];

const CASHIER: readonly NavItem[] = [
  { to: '/till', labelKey: 'till', icon: 'grid', exact: true },
  { to: '/till/tabs', labelKey: 'openTabs', icon: 'receipt' },
  { to: '/desk/customers', labelKey: 'customers', icon: 'users' },
  { to: '/till/drawer', labelKey: 'cashDrawer', icon: 'drawer' },
  MY_TASKS,
];

/**
 * The manager's rail, grouped by WHEN a manager reaches for each row rather
 * than printed as one ten-row column. It used to put Bookings, Day close and
 * the Audit log at the same level with nothing between them, so the four
 * screens used every shift sat in the same stack as the ones used once a
 * week.
 *
 *   * Today — the landing screen: what needs the manager now, and how the day
 *     is going.
 *   * Run the day — the working screens a shift moves between.
 *   * Records — what already happened.
 *   * Setup — what the other screens are priced and built from.
 *
 * Row names match the title of the screen they open ("Open tabs", not
 * "Tills"): a row that says one thing and lands on a page headed another made
 * a manager check whether they had clicked the right one.
 */
const MANAGER_TODAY: readonly NavItem[] = [{ to: '/ops', labelKey: 'today', icon: 'dashboard' }];

/**
 * Protocols and the suggestion box, on both management rails with their
 * counts (build-contracts-2026-09-23 §5.1). One definition each, so the
 * manager's row and the owner's Observe row cannot drift apart.
 */
const PROTOCOLS: NavItem = { to: '/protocols', labelKey: 'protocols', icon: 'split', badge: 'protocolsWaiting' };
const SUGGESTIONS: NavItem = { to: '/suggestions', labelKey: 'suggestions', icon: 'note', badge: 'suggestionsNew' };

const MANAGER_RUN: readonly NavItem[] = [
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk' },
  { to: '/till/tabs', labelKey: 'openTabs', icon: 'receipt', activePrefix: '/till' },
  { to: '/stock', labelKey: 'stock', icon: 'package' },
  { to: '/admin/day-close', labelKey: 'dayClose', icon: 'sun' },
  PROTOCOLS,
  SUGGESTIONS,
];

const MANAGER_RECORDS: readonly NavItem[] = [
  { to: '/reports/courts', labelKey: 'reports', icon: 'chart', activePrefix: '/reports' },
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
];

/** The menu editor's sibling tabs; see NavItem.alsoActive. */
const MENU_FAMILY = ['/admin/categories', '/admin/addons', '/admin/suggested'] as const;

const MANAGER_SETUP: readonly NavItem[] = [
  { to: '/admin/menu', labelKey: 'menu', icon: 'layers', activePrefix: '/admin/menu', alsoActive: MENU_FAMILY },
  { to: '/admin/rates', labelKey: 'rates', icon: 'scale' },
  { to: '/admin/promotions', labelKey: 'promotions', icon: 'tag' },
];

/**
 * Management's own rail is two rows. The panel is the headline every other
 * screen in the workspace elaborates, and Analytics is the one reading that
 * spans the whole business (courts and cafe on two tabs), so it sits above the
 * split rather than inside Observe (owner call, 2026-09-13). Reports stayed in
 * the sections that own the question they answer (revenue → Financial).
 * `activePrefix` keeps the row lit on both tabs (/analytics/courts, /cafe).
 */
const OWNER_PRIMARY: readonly NavItem[] = [
  { to: '/panel', labelKey: 'panel', icon: 'dashboard' },
  { to: '/analytics', labelKey: 'analytics', icon: 'trendUp', activePrefix: '/analytics' },
  // The assistant reads across every section, so like Analytics it sits
  // above the split (docs/design/assistant §5.1). `activePrefix` keeps the
  // row lit on one conversation and on the usage page.
  { to: '/assistant', labelKey: 'assistant', icon: 'spark', activePrefix: '/assistant' },
];

/**
 * FINANCIAL — money in, money out, and the two places it is counted.
 *
 * Order is the money's own path: what was earned (revenue, then the two
 * sources that make it up), then what is physically in the drawer and whether
 * it agrees at the close, then the prices that will produce tomorrow's
 * figures. The value sitting on the shelves moved to Stock.
 *
 * The money reports (revenue, courts, cafe) are ONE Reports row: they share a
 * screen whose tabs move between them, so a row per tab printed the same
 * navigation twice. Its '/reports' prefix claims courts and cafe; staff
 * activity and stock value have exact rows in Observe and Stock, which win
 * over a prefix in `sectionForPath`. Every report lives in one section only,
 * and the tabs show only the reports of the section you are in.
 */
const OWNER_FINANCIAL: readonly NavItem[] = [
  { to: '/financial', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/reports/revenue', labelKey: 'reports', icon: 'chart', activePrefix: '/reports' },
  { to: '/till/drawer', labelKey: 'cashDrawer', icon: 'drawer' },
  { to: '/admin/day-close', labelKey: 'dayClose', icon: 'sun' },
  { to: '/admin/rates', labelKey: 'rates', icon: 'scale' },
  { to: '/admin/menu', labelKey: 'menuPrices', icon: 'layers', activePrefix: '/admin/menu', alsoActive: MENU_FAMILY },
];

/**
 * OBSERVATION — watching the venue rather than counting it.
 *
 * Order is by how far back you are looking: right now (the floor), then the
 * live records you inspect (bookings, tills, staff activity), then the two
 * things that WAIT ON THE OWNER — staff requests to confirm and marketing to
 * run — and finally the audit log, which is where you go when one of the
 * others raised a question. The shape over time (Analytics) is no longer a
 * row here: it is on Management's own rail, see OWNER_PRIMARY.
 *
 * Bookings and Tills open Observe's OWN boards, not the desk calendar and the
 * cashier's tab board (owner call, 2026-09-13). Those are workstations; these
 * are view-only readings of what is active, what is not and what the day adds
 * up to, and every write on them is a "go to workspace" button away.
 *
 * The working screens stay listed as hidden rows only so that a drill-through
 * which still lands on them (Floor now's cluster buttons) keeps this rail
 * instead of dropping the owner onto Management's bare top level.
 */
const OWNER_OBSERVATION: readonly NavItem[] = [
  { to: '/observation', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/ops', labelKey: 'floorNow', icon: 'dashboard' },
  { to: '/observation/courts', labelKey: 'bookings', icon: 'calendar' },
  { to: '/observation/tills', labelKey: 'tills', icon: 'receipt' },
  { to: '/reports/staff', labelKey: 'staffActivity', icon: 'users' },
  { to: '/observation/requests', labelKey: 'requests', icon: 'bell' },
  // What waits on the owner in protocols (a step to decide or to do) and the
  // staff suggestion box, right after the requests they sit beside.
  PROTOCOLS,
  SUGGESTIONS,
  { to: '/marketing', labelKey: 'marketing', icon: 'spark', activePrefix: '/marketing' },
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
  // Opened from the marketing panel, not from the rail. See NavItem.hidden.
  { to: '/admin/promotions', labelKey: 'promotions', icon: 'tag', hidden: true },
  { to: '/admin/telegram', labelKey: 'telegram', icon: 'phone', hidden: true },
  // Reached only by drilling through from Floor now; see the note above.
  // `/till/tabs` carries no activePrefix: '/till' would also light this row on
  // /till/drawer over in Financial.
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk', hidden: true },
  { to: '/till/tabs', labelKey: 'tills', icon: 'receipt', hidden: true },
];

/**
 * STOCK — the shelves. The /stock module already carries its own grouped
 * sub-nav (daily, setup, review) beside the screen, so the rail does not
 * repeat those ten rows: one row owns the whole /stock subtree and lands on
 * on-hand, and the second is the stock value report, which lives under
 * /reports but answers a stock question.
 */
const OWNER_STOCK: readonly NavItem[] = [
  { to: '/stock', labelKey: 'inventory', icon: 'package', activePrefix: '/stock' },
  { to: '/reports/stock', labelKey: 'stockValue', icon: 'chart' },
];

const OWNER_SETUP: readonly NavItem[] = [
  { to: '/setup', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/admin/staff', labelKey: 'staff', icon: 'shield' },
  { to: '/admin/courts', labelKey: 'courts', icon: 'court' },
  { to: '/admin/qr', labelKey: 'tables', icon: 'qr' },
  { to: '/admin/settings', labelKey: 'settings', icon: 'settings', activePrefix: '/admin/settings' },
  { to: '/admin/hero', labelKey: 'guestSite', icon: 'globe', activePrefix: '/admin/hero' },
];

/**
 * TEAM — driver and marketing (0155), and the waiter (wave 5 §2.1). One row:
 * My tasks, their protocol steps and the read-only copy of their phone
 * pages. It is a rail and not a navless
 * board like the kitchen's because a staff member who holds nothing but this
 * still needs Options, Go on break and Sign out.
 */
const TEAM: readonly NavItem[] = [MY_TASKS];

const OWNER_SECTIONS: readonly NavSection[] = [
  { key: 'financial', home: '/financial', icon: 'banknote', items: OWNER_FINANCIAL },
  { key: 'observation', home: '/observation', icon: 'eye', items: OWNER_OBSERVATION },
  { key: 'stock', home: '/stock', icon: 'package', items: OWNER_STOCK },
  // Sliders, not the gear: /admin/settings is ONE row inside this section
  // (OWNER_SETUP), and when the section and one of its own rows wore the same
  // gear, the row you wanted was the one that looked like the section holding
  // it. It is also the mobile app's settings glyph, so staff who use both
  // meet one icon for the idea.
  { key: 'setup', home: '/setup', icon: 'sliders', items: OWNER_SETUP },
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
      { labelKey: null, items: MANAGER_TODAY },
      { labelKey: 'groupRun', items: MANAGER_RUN },
      { labelKey: 'groupRecords', items: MANAGER_RECORDS },
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
  team: { key: 'team', home: '/tasks', icon: 'checkCircle', groups: [{ labelKey: null, items: TEAM }] },
};

/** The workspaces a role may enter, own one first. */
export function workspacesForRole(role: StaffRole): readonly WorkspaceKey[] {
  switch (role) {
    case 'cashier':
      return ['cashier'];
    // The bar and kitchen family has exactly prep's workspace (0155); the
    // assistant barista joins it for the bar's tickets (wave 5 §2.1).
    case 'prep':
    case 'head_barista':
    case 'barista':
    case 'assistant_barista':
    case 'head_chef':
    case 'chef':
      return ['prep'];
    case 'court_desk':
      return ['courtDesk'];
    case 'driver':
    case 'marketing':
    case 'waiter':
      return ['team'];
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
  if (path === '/panel' || path.startsWith('/reports/revenue')) return 'owner';
  if (path === '/analytics' || path.startsWith('/analytics/')) return 'owner';
  if (path === '/assistant' || path.startsWith('/assistant/')) return 'owner';
  if (path === '/setup' || path.startsWith('/setup/')) return 'owner';
  // The section homes. /observation/requests is owner-only too, so the whole
  // subtree resolves here rather than only its landing screen.
  if (path === '/financial' || path === '/observation' || path.startsWith('/observation/')) return 'owner';
  if (path === '/marketing' || path.startsWith('/marketing/')) return 'owner';
  if (path === '/ops') return 'manager';
  // /tasks is not pinned: eight roles open it in their own workspace (the
  // desk's and the till's rail row, the kitchen board's My tasks), and only
  // driver and marketing hold the team workspace.
  return null;
}

/** Is `path` the active route for `item`? */
export function isNavActive(item: NavItem, path: string): boolean {
  const bare = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  if (item.exact) return bare === item.to;
  const prefixes = [item.activePrefix ?? item.to, ...(item.alsoActive ?? [])];
  return prefixes.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
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
 * own rail. Derived from the URL, so a deep link, a reload and a drill-through
 * all land on the rail that matches the screen.
 *
 * When rows in two sections match, the most specific one wins: a row whose
 * `to` IS the path beats a prefix, and a longer prefix beats a shorter one.
 * Financial's Reports row claims '/reports', but /reports/stock is Stock's and
 * /reports/staff is Observe's.
 */
export function sectionForPath(ws: Workspace, path: string): NavSection | null {
  const bare = path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  let best: NavSection | null = null;
  let bestScore = -1;
  for (const section of ws.sections ?? []) {
    const matches = section.items.filter((item) => isNavActive(item, path));
    if (matches.length === 0) continue;
    const score = Math.max(...matches.map((item) => (item.to === bare ? Number.MAX_SAFE_INTEGER : (item.activePrefix ?? item.to).length)));
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }
  return best;
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
