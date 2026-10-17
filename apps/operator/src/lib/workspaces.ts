/**
 * Six workspaces, one app (spec §04). A workspace is a landing screen plus
 * its own navigation set; a staff role maps to the workspaces it may enter.
 * Nothing here grants access — ROUTE_ROLES and the RPC guards remain the wall.
 * The active workspace only chooses which rail the shell renders.
 *
 * A workspace may also carry SECTIONS. A section is a landing screen of its
 * own plus its own rail: the workspace shows one button for it, and once
 * inside, the rail is the section's list and nothing else.
 *
 * Management's and Operations' sections are the same seven, cut by part of
 * the club (page map, Sait 2026-10-17): FINANCIAL (key `money`), COURTS, CAFÉ & SHOP, STOCK,
 * TEAM, CUSTOMERS & MARKETING and SETTINGS. Before, the owner's were cut by
 * question (Financial, Observe, Stock, Setup) and the manager's by verb (Run
 * the day, Records, Setup); people had to guess which question or verb a page
 * answered before they could look for it, and the same page lived in two
 * places for the two of them. Each person sees the rows and tabs they may
 * open.
 *
 * FAMILIES (management rebuild, 2026-10-17,
 * docs/design/operator-ui/management-rebuild-brief-2026-10-16.md). A section's
 * rail prints one row per JOB. When a job has several pages, the row carries
 * them as `tabs`: the row lights on every one of them, and the page header
 * shows them as tabs under the page title (components/FamilyTabs.tsx). There
 * are no dropdowns and no rows hidden inside other screens any more: before
 * the rebuild Management had 43 rows behind 4 dropdowns and 7 hidden rows, and
 * owners could not tell which section a page lived in. Every tab keeps the URL
 * its page always had, so phone pushes, Today tiles, the assistant's page
 * links and bookmarks still land.
 *
 * A family's tabs are a named `readonly NavTab[]` list referenced by the row
 * (`tabs: CASH_TABS`), never written inline: the owner's and the manager's
 * rails share them, and packages/db/scripts/build-assistant-map.mjs reads them
 * by name.
 */
import type { IconName } from '../components/icons';
import { rolesOf, type StaffAccess } from '@touch/core';
import type { StaffRole } from './auth';

export type WorkspaceKey = 'courtDesk' | 'cashier' | 'prep' | 'manager' | 'owner' | 'team' | 'shop';

/** i18n key under ws.shell.nav: a rail row's name, or a family tab's. */
export type NavLabelKey =
  | 'today' | 'calendar' | 'customers' | 'newSeries' | 'blockCourt'
  | 'till' | 'openTabs' | 'cashDrawer'
  | 'overview' | 'bookings' | 'tills' | 'dayClose' | 'menu' | 'rates' | 'promotions' | 'stock' | 'reports' | 'audit'
  | 'panel' | 'analytics' | 'staff' | 'branches' | 'courts' | 'tables' | 'settings' | 'guestSite'
  // Financial: the menu row, the cash and pay families, the report tabs.
  | 'menuPrices' | 'cash' | 'pay' | 'revenue' | 'cafe'
  | 'menuItems' | 'categories' | 'addons' | 'suggested'
  // Observe.
  | 'floorNow' | 'staffActivity' | 'activityMonitor' | 'whoIsOn' | 'whatTheyDid'
  | 'fromTeam' | 'requests' | 'marketing' | 'campaigns' | 'telegram'
  // Stock: the four families' rows, their tabs, then the shop.
  | 'onHand' | 'goodsIn' | 'moveStock' | 'wasteProduction' | 'expiry' | 'alerts'
  | 'stockCount' | 'countDifferences' | 'margins' | 'ingredients' | 'recipes'
  | 'stockValue' | 'shop' | 'stockMovement' | 'stockCounting' | 'stockCosts'
  // The Touch Shop desk's own rail (0243–0246).
  | 'shopTill' | 'shopStock' | 'shopReceive' | 'shopCounts' | 'shopProducts' | 'shopSuppliers'
  // The owner assistant (docs/design/assistant §5.1).
  | 'assistant'
  // The team workspace (driver, marketing), and the till's and the desk's row.
  | 'myTasks'
  // Protocols and the staff suggestion box (build-contracts-2026-09-23 §5.1).
  | 'protocols' | 'suggestions'
  // Wave 5, people records (wave5-addendum-2026-09-25 §5.2).
  | 'deductions' | 'incidents'
  // Wages (0270–0272), rewards (0332–0333), the main cash (0343).
  | 'wages' | 'attendance' | 'rewards' | 'safe'
  // Coaching (docs/design/coaching/operator.md §5.3.3).
  | 'coaches' | 'coachPay' | 'lessonTypes' | 'coachHours' | 'lessonRules'
  // Tournaments (build-contracts-2026-10-03 §1.11) and loyalty (build-contracts-2026-10-05 §5).
  | 'tournaments' | 'loyalty'
  // Setup's families: courts and their rules, the venue, the guest app, devices.
  | 'bookingRules' | 'onlineDeposit' | 'openMatches'
  // The page map (2026-10-17): Court settings, the sales report tabs, bills
  // paid from the main cash, the settings tabs that shared another page's name.
  | 'courtSettings' | 'courtSales' | 'cafeSales' | 'billsSuppliers' | 'tournamentRules'
  | 'analyticsSettings' | 'computersScreens'
  | 'venue' | 'venueDetails' | 'openingHours' | 'businessDay'
  | 'guestApp' | 'devices' | 'stations' | 'kitchenScreens' | 'offlineMode';

/**
 * A live count beside a row's or a tab's name: what waits on the signed-in
 * person there. The shell reads it (lib/navBadges.ts), so a row names the
 * count it wants and never fetches it. A family row shows the sum of its tabs.
 */
export type NavBadge =
  | 'protocolsWaiting' | 'suggestionsNew' | 'deductionsWaiting' | 'incidentsOpen'
  | 'contentWaiting' | 'stockCountsWaiting' | 'wagesDue';

/**
 * A runtime condition a tab needs before it is printed. Online deposits and
 * open matches stay out of sight while online payments are paused, as their
 * panels always did; a direct link still opens the page, which says why it is
 * empty.
 */
export type NavCondition = 'onlinePaymentsLive';

/** One page of a family: a tab under the page title, and a lit row on the rail. */
export interface NavTab {
  to: string;
  labelKey: NavLabelKey;
  /** Match active state on this prefix (default: exact path or prefix of `to`). */
  activePrefix?: string;
  /** Exact match only (index routes such as /stock under /stock/...). */
  exact?: boolean;
  /**
   * Query parameters that tell this tab from its siblings on the same path
   * (Coaches' `?tab=types`). The tab without them is the default.
   */
  search?: Readonly<Record<string, string>>;
  /** Query parameters carried over when moving to this tab (the picked coach). */
  keepSearch?: readonly string[];
  badge?: NavBadge;
  when?: NavCondition;
}

export interface NavItem {
  to: string;
  labelKey: NavLabelKey;
  icon: IconName;
  badge?: NavBadge;
  /** Match active state on this prefix (default: exact path or prefix of `to`). */
  activePrefix?: string;
  /** Further prefixes that belong to the same screen. */
  alsoActive?: readonly string[];
  /** Exact match only (for index routes like /desk under /desk/...). */
  exact?: boolean;
  /**
   * Owned by the section but NOT printed: a drill-through that still lands
   * here (the Observe overview's area buttons open /desk and /till/tabs) keeps
   * the section's rail instead of dropping to the workspace's top level.
   */
  hidden?: boolean;
  /**
   * The family's pages, shown as tabs under the page title. The row goes to
   * the first tab the person may open and lights on every tab.
   */
  tabs?: readonly NavTab[];
}

export interface NavGroup {
  /** i18n key under ws.shell.nav, or null for the primary (untitled) group. */
  labelKey: 'groupOperations' | 'groupRun' | 'groupRecords' | 'groupSetup' | null;
  items: readonly NavItem[];
}

/** Courts and Café & shop have a key per rail (their first rows differ); `courtsDesk` and `cafeFloor` are the manager's. */
export type SectionKey = 'money' | 'courts' | 'courtsDesk' | 'cafe' | 'cafeFloor' | 'stock' | 'team' | 'customers' | 'settings';

/**
 * A named part of a workspace with its own rail. `home` is its first page;
 * the section button opens the first row the person may open (sectionTarget),
 * so a manager's Financial opens Court sales, the owner's Money in. `items` is the
 * rail shown from there on.
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

/**
 * Wave 5, people records (wave5-addendum-2026-09-25 §5.2). Incidents are
 * reported at the desk and the till and reviewed by management, so the row
 * sits on the desk's and the till's rails; management reaches it under Team ›
 * Staff inbox.
 */
const INCIDENTS: NavItem = { to: '/incidents', labelKey: 'incidents', icon: 'alert', badge: 'incidentsOpen' };

const COURT_DESK: readonly NavItem[] = [
  { to: '/desk/today', labelKey: 'today', icon: 'today' },
  { to: '/desk', labelKey: 'calendar', icon: 'calendar', exact: true },
  { to: '/desk/customers', labelKey: 'customers', icon: 'users' },
  { to: '/desk/series/new', labelKey: 'newSeries', icon: 'repeat', activePrefix: '/desk/series' },
  { to: '/desk/block', labelKey: 'blockCourt', icon: 'ban' },
  // Tournaments (build-contracts-2026-10-03 §1.11): the list; one opens from it or its calendar block.
  { to: '/desk/tournaments', labelKey: 'tournaments', icon: 'trophy' },
  INCIDENTS,
  MY_TASKS,
];

const CASHIER: readonly NavItem[] = [
  { to: '/till', labelKey: 'till', icon: 'grid', exact: true },
  { to: '/till/tabs', labelKey: 'openTabs', icon: 'receipt' },
  { to: '/desk/customers', labelKey: 'customers', icon: 'users' },
  { to: '/till/drawer', labelKey: 'cashDrawer', icon: 'drawer' },
  INCIDENTS,
  MY_TASKS,
];

// ---------------------------------------------------------------------------
// Families: one row per job, its pages as tabs. Shared by the owner's and the
// manager's rails, which print the same sections (page map, 2026-10-17): a
// page is in the same place for both, and each person sees the rows and tabs
// they may open.
// ---------------------------------------------------------------------------

/** The money reports share one screen frame; each is a tab. */
const REPORT_TABS: readonly NavTab[] = [
  { to: '/reports/revenue', labelKey: 'revenue' },
  { to: '/reports/courts', labelKey: 'courtSales' },
  { to: '/reports/cafe', labelKey: 'cafeSales' },
];

/**
 * The cash, in the order the money moves at the end of a day: whether the
 * drawers agreed (the end of day count), the main cash every cost is paid
 * from (0343), then the drawer itself.
 */
const CASH_TABS: readonly NavTab[] = [
  { to: '/admin/day-close', labelKey: 'dayClose' },
  { to: '/safe', labelKey: 'safe' },
  { to: '/till/drawer', labelKey: 'cashDrawer' },
];

/**
 * Everything paid out: salaries, the bills and suppliers paid from the main
 * cash (the Safe page showing its payments, `?show=payments`), the pay
 * deductions the owner decides, bonuses and the coaches' statements. "Pay a
 * supplier" is looked for under Pay, not under Cash (Sait, 2026-10-17).
 */
const PAY_TABS: readonly NavTab[] = [
  { to: '/wages', labelKey: 'wages', badge: 'wagesDue' },
  { to: '/safe', labelKey: 'billsSuppliers', search: { show: 'payments' } },
  { to: '/deductions', labelKey: 'deductions', badge: 'deductionsWaiting' },
  { to: '/rewards', labelKey: 'rewards' },
  { to: '/reports/coaches', labelKey: 'coachPay' },
];

/**
 * Everything about playing on a court, in one place (Sait, 2026-10-17): the
 * prices, the courts, the booking rules, the online deposit and open matches,
 * the opening hours and the tournament rules.
 */
const COURT_SETTINGS_TABS: readonly NavTab[] = [
  { to: '/admin/rates', labelKey: 'rates' },
  { to: '/admin/courts', labelKey: 'courts' },
  { to: '/admin/settings/booking', labelKey: 'bookingRules' },
  { to: '/admin/settings/deposit', labelKey: 'onlineDeposit', when: 'onlinePaymentsLive' },
  { to: '/admin/settings/matches', labelKey: 'openMatches', when: 'onlinePaymentsLive' },
  { to: '/admin/hours', labelKey: 'openingHours' },
  { to: '/admin/settings/tournaments', labelKey: 'tournamentRules' },
];

/**
 * Coaches, lesson types, the coaches' hours and the lesson rules. One route,
 * told apart by `?tab=` (routes/admin/coaches.tsx); the picked coach travels
 * to Hours.
 */
const COACHES_TABS: readonly NavTab[] = [
  { to: '/admin/coaches', labelKey: 'coaches', keepSearch: ['coach'] },
  { to: '/admin/coaches', labelKey: 'lessonTypes', search: { tab: 'types' } },
  { to: '/admin/coaches', labelKey: 'coachHours', search: { tab: 'hours' }, keepSearch: ['coach'] },
  { to: '/admin/coaches', labelKey: 'lessonRules', search: { tab: 'rules' } },
];

/** The menu editor and its siblings, one tab each. */
const MENU_TABS: readonly NavTab[] = [
  { to: '/admin/menu', labelKey: 'menuItems' },
  { to: '/admin/categories', labelKey: 'categories' },
  { to: '/admin/addons', labelKey: 'addons' },
  { to: '/admin/suggested', labelKey: 'suggested' },
];

/** What is on the shelves: the stock itself, what runs low, what expires, what it is worth. */
const ON_HAND_TABS: readonly NavTab[] = [
  { to: '/stock', labelKey: 'onHand', exact: true },
  { to: '/stock/alerts', labelKey: 'alerts' },
  { to: '/stock/expiry', labelKey: 'expiry' },
  { to: '/reports/stock', labelKey: 'stockValue' },
];

/** Stock coming in, moving between the stores, and going out as waste or into production. */
const STOCK_MOVEMENT_TABS: readonly NavTab[] = [
  { to: '/stock/receive', labelKey: 'goodsIn' },
  { to: '/stock/moves', labelKey: 'moveStock' },
  { to: '/stock/waste', labelKey: 'wasteProduction' },
];

/** Counting, and what the counts found (counts taken on the phone wait on the first tab). */
const STOCK_COUNTING_TABS: readonly NavTab[] = [
  { to: '/stock/counts', labelKey: 'stockCount', badge: 'stockCountsWaiting' },
  { to: '/stock/variance', labelKey: 'countDifferences' },
];

/** What a dish is made of and what it costs against what it sells for. */
const STOCK_COSTS_TABS: readonly NavTab[] = [
  { to: '/stock/ingredients', labelKey: 'ingredients' },
  { to: '/stock/recipes', labelKey: 'recipes' },
  { to: '/stock/margins', labelKey: 'margins' },
];

/** Who is on the operator and the phone now (0341), and what they did over a period. */
const STAFF_ACTIVITY_TABS: readonly NavTab[] = [
  { to: '/observation/activity', labelKey: 'whoIsOn' },
  { to: '/reports/staff', labelKey: 'whatTheyDid' },
];

/**
 * What the team sends up: the owner decides requests; management reviews
 * incidents and reads the suggestion box. Pay deductions are Pay's.
 */
const STAFF_INBOX_TABS: readonly NavTab[] = [
  { to: '/observation/requests', labelKey: 'requests' },
  { to: '/incidents', labelKey: 'incidents', badge: 'incidentsOpen' },
  { to: '/suggestions', labelKey: 'suggestions', badge: 'suggestionsNew' },
];

/** Campaigns, the discounts they run, and the Telegram group. */
const MARKETING_TABS: readonly NavTab[] = [
  { to: '/marketing', labelKey: 'campaigns', activePrefix: '/marketing', badge: 'contentWaiting' },
  { to: '/admin/promotions', labelKey: 'promotions' },
  { to: '/admin/telegram', labelKey: 'telegram' },
];

/**
 * The club itself: its name and the values fixed at setup, when its business
 * day starts, and what analytics leaves out. `/admin/settings` stays its
 * address. The opening hours are Court settings'.
 */
const CLUB_TABS: readonly NavTab[] = [
  { to: '/admin/settings', labelKey: 'venueDetails', exact: true },
  { to: '/admin/settings/day', labelKey: 'businessDay' },
  { to: '/admin/settings/analytics', labelKey: 'analyticsSettings' },
];

/**
 * The machines: which ones report in, which stations are registered at the
 * branch, the kitchen screens paired to the till, and when the venue counts
 * as offline.
 */
const DEVICES_TABS: readonly NavTab[] = [
  { to: '/admin/settings/devices', labelKey: 'devices' },
  { to: '/admin/settings/stations', labelKey: 'stations' },
  { to: '/admin/settings/kitchen', labelKey: 'kitchenScreens' },
  { to: '/admin/settings/offline', labelKey: 'offlineMode' },
];

// Rows both rails print in more than one list.
const COURT_SETTINGS: NavItem = { to: '/admin/rates', labelKey: 'courtSettings', icon: 'sliders', tabs: COURT_SETTINGS_TABS };
const COACHES: NavItem = { to: '/admin/coaches', labelKey: 'coaches', icon: 'whistle', tabs: COACHES_TABS };
const MENU: NavItem = { to: '/admin/menu', labelKey: 'menu', icon: 'bookOpen', tabs: MENU_TABS };
const TABLES: NavItem = { to: '/admin/qr', labelKey: 'tables', icon: 'qr' };
const SHOP_ROW: NavItem = { to: '/shop', labelKey: 'shop', icon: 'tag' };
/** Protocols, with what waits on the signed-in person (build-contracts-2026-09-23 §5.1). */
const PROTOCOLS: NavItem = { to: '/protocols', labelKey: 'protocols', icon: 'checkCircle', badge: 'protocolsWaiting' };

// ---------------------------------------------------------------------------
// Management (the owner) and Operations (the manager)
// ---------------------------------------------------------------------------

/**
 * Management's own rail, above the section buttons: Overview (the panel, with
 * "Needs you" and the live floor on top since 2026-10-17, when the owner's
 * Floor now page folded into it), and Trends and the assistant, which read
 * across every section. The manager's home sends an owner to the Overview, so
 * /ops keeps this rail (hidden).
 */
const OWNER_PRIMARY: readonly NavItem[] = [
  { to: '/panel', labelKey: 'panel', icon: 'dashboard' },
  { to: '/ops', labelKey: 'panel', icon: 'dashboard', hidden: true },
  { to: '/analytics', labelKey: 'analytics', icon: 'trendUp', activePrefix: '/analytics' },
  { to: '/assistant', labelKey: 'assistant', icon: 'spark', activePrefix: '/assistant' },
];

/** The manager's own rail: Today, the landing screen of what needs them now. */
const MANAGER_TODAY: readonly NavItem[] = [{ to: '/ops', labelKey: 'today', icon: 'dashboard' }];

/**
 * The sections (page map, Sait 2026-10-17). Cut by part of the club rather
 * than by verb, because "Observe", "Run the day" and "Records" made people
 * guess before they could look: Financial, Courts, Café & shop, Stock, Team,
 * Customers & marketing, Settings. Each page has one place; a section button
 * opens the first page of it the person may open.
 */

/** FINANCIAL: what came in, the cash and whether it agrees, and everything paid out. */
const MONEY: readonly NavItem[] = [
  { to: '/reports/revenue', labelKey: 'reports', icon: 'chart', tabs: REPORT_TABS },
  { to: '/admin/day-close', labelKey: 'cash', icon: 'drawer', tabs: CASH_TABS },
  { to: '/wages', labelKey: 'pay', icon: 'banknote', tabs: PAY_TABS },
  // The old Financial overview still opens from links; it keeps this rail.
  { to: '/financial', labelKey: 'overview', icon: 'grid', exact: true, hidden: true },
];

/**
 * COURTS for the owner: Bookings is the view-only board (owner call,
 * 2026-09-13); its "Open in …" buttons open the desk, which keeps this rail.
 */
const OWNER_COURTS: readonly NavItem[] = [
  { to: '/observation/courts', labelKey: 'bookings', icon: 'calendar' },
  COACHES,
  COURT_SETTINGS,
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk', hidden: true },
];

/** COURTS for the manager: Bookings is the desk calendar they work in. */
const MANAGER_COURTS: readonly NavItem[] = [
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk' },
  COACHES,
  COURT_SETTINGS,
];

/**
 * CAFÉ & SHOP for the owner: the view-only tills board, the menu, the table
 * QR cards and the Touch Shop desk. `/till/tabs` carries no prefix: '/till'
 * would also claim /till/drawer, which is Financial's.
 */
const OWNER_CAFE: readonly NavItem[] = [
  { to: '/observation/tills', labelKey: 'tills', icon: 'receipt' },
  MENU,
  TABLES,
  SHOP_ROW,
  { to: '/till/tabs', labelKey: 'tills', icon: 'receipt', hidden: true },
];

/** CAFÉ & SHOP for the manager: the open tabs they work in. */
const MANAGER_CAFE: readonly NavItem[] = [
  { to: '/till/tabs', labelKey: 'openTabs', icon: 'receipt', activePrefix: '/till/tabs' },
  MENU,
  TABLES,
  SHOP_ROW,
];

/** STOCK: what is on the shelves, what came in and went out, the counts, and what a dish costs. */
const STOCK: readonly NavItem[] = [
  // Claims the whole /stock subtree, so an old link to a /stock path with no
  // tab of its own still keeps this rail; every tab is a more specific match.
  { to: '/stock', labelKey: 'onHand', icon: 'package', activePrefix: '/stock', tabs: ON_HAND_TABS },
  { to: '/stock/receive', labelKey: 'stockMovement', icon: 'box', tabs: STOCK_MOVEMENT_TABS },
  { to: '/stock/counts', labelKey: 'stockCounting', icon: 'scale', tabs: STOCK_COUNTING_TABS },
  { to: '/stock/ingredients', labelKey: 'stockCosts', icon: 'note', tabs: STOCK_COSTS_TABS },
];

/**
 * TEAM: the people, who is working, late arrivals and early leaves (recorded
 * here, taken off pay under Pay), what the team sends up, and the protocols.
 */
const PEOPLE: readonly NavItem[] = [
  { to: '/admin/staff', labelKey: 'staff', icon: 'user' },
  { to: '/observation/activity', labelKey: 'staffActivity', icon: 'eye', tabs: STAFF_ACTIVITY_TABS },
  { to: '/attendance', labelKey: 'attendance', icon: 'clock' },
  { to: '/observation/requests', labelKey: 'fromTeam', icon: 'mail', tabs: STAFF_INBOX_TABS },
  PROTOCOLS,
];

/** CUSTOMERS & MARKETING: the guests, their points, the campaigns and discounts, and the guest app. */
const CUSTOMERS: readonly NavItem[] = [
  { to: '/desk/customers', labelKey: 'customers', icon: 'users' },
  // Loyalty (build-contracts-2026-10-05 §5): business-wide points, tiers and rewards.
  { to: '/admin/loyalty', labelKey: 'loyalty', icon: 'star' },
  { to: '/marketing', labelKey: 'marketing', icon: 'image', tabs: MARKETING_TABS },
  { to: '/admin/hero', labelKey: 'guestApp', icon: 'phone', activePrefix: '/admin/hero' },
];

/** SETTINGS: the club, its branches, the machines, and the change history. */
const SETTINGS: readonly NavItem[] = [
  { to: '/admin/settings', labelKey: 'venue', icon: 'home', tabs: CLUB_TABS },
  { to: '/admin/branches', labelKey: 'branches', icon: 'pin' },
  { to: '/admin/settings/devices', labelKey: 'computersScreens', icon: 'keyboard', tabs: DEVICES_TABS },
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
  // The old Setup overview still opens from links; it keeps this rail.
  { to: '/setup', labelKey: 'overview', icon: 'grid', exact: true, hidden: true },
];

/**
 * SHOP — the Touch Shop's own desk (docs/design/shop/shop-desk-2026-09-27.md):
 * its own PC, till, drawer, stock store, products and suppliers, and nothing
 * of the café. The shop assistant holds only this; management opens it from
 * the Shop row on the Stock rail.
 */
const SHOP: readonly NavItem[] = [
  { to: '/shop', labelKey: 'shopTill', icon: 'grid', exact: true },
  { to: '/shop/drawer', labelKey: 'cashDrawer', icon: 'drawer' },
  { to: '/shop/stock', labelKey: 'shopStock', icon: 'package' },
  { to: '/shop/receive', labelKey: 'shopReceive', icon: 'box' },
  { to: '/shop/counts', labelKey: 'shopCounts', icon: 'scale' },
  { to: '/shop/products', labelKey: 'shopProducts', icon: 'tag' },
  { to: '/shop/suppliers', labelKey: 'shopSuppliers', icon: 'users' },
];

/**
 * TEAM — driver and marketing (0155), and the waiter (wave 5 §2.1). One row:
 * My tasks, their protocol steps and the read-only copy of their phone
 * pages. It is a rail and not a navless board like the kitchen's because a
 * staff member who holds nothing but this still needs Options, Go on break
 * and Sign out.
 */
const TEAM: readonly NavItem[] = [MY_TASKS];

/**
 * The sections, in the same order on both rails. Courts and Café & shop have
 * a key per rail because their first row differs (the owner's view-only
 * boards, the manager's working screens); both carry the same name. `home` is
 * the section's first page; the shell opens the first one the person may open.
 */
const OWNER_SECTIONS: readonly NavSection[] = [
  { key: 'money', home: '/reports/revenue', icon: 'banknote', items: MONEY },
  { key: 'courts', home: '/observation/courts', icon: 'court', items: OWNER_COURTS },
  { key: 'cafe', home: '/observation/tills', icon: 'cake', items: OWNER_CAFE },
  { key: 'stock', home: '/stock', icon: 'package', items: STOCK },
  { key: 'team', home: '/admin/staff', icon: 'users', items: PEOPLE },
  { key: 'customers', home: '/desk/customers', icon: 'userPlus', items: CUSTOMERS },
  // Icons (Sait, 2026-10-17): each names what is inside, and no two buttons on
  // one rail share a glyph. Café & shop is food, Customers & marketing is
  // winning guests, Settings is the gear.
  { key: 'settings', home: '/admin/settings', icon: 'settings', items: SETTINGS },
];

const MANAGER_SECTIONS: readonly NavSection[] = [
  { key: 'money', home: '/reports/revenue', icon: 'banknote', items: MONEY },
  { key: 'courtsDesk', home: '/desk', icon: 'court', items: MANAGER_COURTS },
  { key: 'cafeFloor', home: '/till/tabs', icon: 'cake', items: MANAGER_CAFE },
  { key: 'stock', home: '/stock', icon: 'package', items: STOCK },
  { key: 'team', home: '/admin/staff', icon: 'users', items: PEOPLE },
  { key: 'customers', home: '/desk/customers', icon: 'userPlus', items: CUSTOMERS },
  { key: 'settings', home: '/admin/settings', icon: 'settings', items: SETTINGS },
];

export const WORKSPACES: Record<WorkspaceKey, Workspace> = {
  courtDesk: { key: 'courtDesk', home: '/desk/today', icon: 'calendar', groups: [{ labelKey: null, items: COURT_DESK }] },
  cashier: { key: 'cashier', home: '/till', icon: 'grid', groups: [{ labelKey: null, items: CASHIER }] },
  prep: { key: 'prep', home: '/kds', icon: 'flame', groups: [] },
  manager: { key: 'manager', home: '/ops', icon: 'dashboard', groups: [{ labelKey: null, items: MANAGER_TODAY }], sections: MANAGER_SECTIONS },
  owner: { key: 'owner', home: '/panel', icon: 'shield', groups: [{ labelKey: null, items: OWNER_PRIMARY }], sections: OWNER_SECTIONS },
  team: { key: 'team', home: '/tasks', icon: 'checkCircle', groups: [{ labelKey: null, items: TEAM }] },
  shop: { key: 'shop', home: '/shop', icon: 'tag', groups: [{ labelKey: null, items: SHOP }] },
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
    case 'shop_staff':
      return ['shop'];
    case 'manager':
      return ['manager', 'courtDesk', 'cashier', 'prep', 'shop'];
    case 'owner':
      return ['owner', 'manager', 'courtDesk', 'cashier', 'prep', 'shop'];
  }
}

/**
 * The workspaces a person may enter (0345): their main role's, then each
 * second job's, once each. A cashier who also runs the court desk gets the
 * till and the desk, and the rail's switcher to move between them. Blocked
 * pages are the shell's to drop (it asks canAccess of each home).
 */
export function workspacesFor(who: StaffAccess): readonly WorkspaceKey[] {
  const out: WorkspaceKey[] = [];
  for (const role of rolesOf(who)) {
    for (const key of workspacesForRole(role)) if (!out.includes(key)) out.push(key);
  }
  return out;
}

export function defaultWorkspace(role: StaffRole): WorkspaceKey {
  return workspacesForRole(role)[0]!;
}

const STORAGE_KEY = 'touch-operator-workspace';

/** Station-local memory of the last chosen workspace; validated against the role. */
export function loadWorkspace(role: StaffRole, allowed: readonly WorkspaceKey[] = workspacesForRole(role)): WorkspaceKey {
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
  if (path === '/wages') return 'owner';
  if (path === '/rewards') return 'owner';
  if (path === '/ops') return 'manager';
  if (path === '/shop' || path.startsWith('/shop/')) return 'shop';
  // /tasks is not pinned: eight roles open it in their own workspace (the
  // desk's and the till's rail row, the kitchen board's My tasks), and only
  // driver and marketing hold the team workspace.
  return null;
}


/** A path without its query, hash or trailing slash. */
function barePath(path: string): string {
  return path.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
}

type Matchable = Pick<NavItem, 'to' | 'exact' | 'activePrefix' | 'alsoActive'>;

/** Does the row or tab itself (not its tabs) cover `bare`? */
function ownActive(item: Matchable, bare: string): boolean {
  if (item.exact) return bare === item.to;
  const prefixes = [item.activePrefix ?? item.to, ...(item.alsoActive ?? [])];
  return prefixes.some((prefix) => bare === prefix || bare.startsWith(`${prefix}/`));
}

/** Is `path` the active route for `item`? A family row is active on every one of its tabs. */
export function isNavActive(item: NavItem | NavTab, path: string): boolean {
  const bare = barePath(path);
  if (ownActive(item, bare)) return true;
  return 'tabs' in item && (item.tabs ?? []).some((tab) => ownActive(tab, bare));
}

/** A family tab in the shape of a row, for readers that want one list of destinations. */
function tabAsItem(tab: NavTab, row: NavItem): NavItem {
  return {
    to: tab.to,
    labelKey: tab.labelKey,
    icon: row.icon,
    ...(tab.activePrefix ? { activePrefix: tab.activePrefix } : {}),
    ...(tab.exact ? { exact: true } : {}),
    ...(tab.badge ? { badge: tab.badge } : {}),
    ...(row.hidden ? { hidden: true } : {}),
  };
}

/**
 * Every destination of a workspace: its own groups' rows and all of its
 * sections', each family's tabs listed BEFORE their row. Readers that keep the
 * first match per path (the assistant's page links) or the first of equally
 * specific matches (the activity monitor) then name a page by its own tab
 * ("Safe"), not by its family ("Cash").
 */
export function workspaceItems(ws: Workspace): readonly NavItem[] {
  // Hidden rows included: this drives workspaceOwnsPath, and a route the
  // section owns without printing must still keep the rail.
  const rows = [...ws.groups.flatMap((g) => g.items), ...(ws.sections ?? []).flatMap((s) => s.items)];
  return rows.flatMap((row) => [...(row.tabs ?? []).map((tab) => tabAsItem(tab, row)), row]);
}

/**
 * The section `path` sits inside, or null when it belongs to the workspace's
 * own rail. Derived from the URL, so a deep link, a reload and a drill-through
 * all land on the rail that matches the screen.
 *
 * When rows in two sections match, the most specific one wins: a row or tab
 * whose `to` IS the path beats a prefix, and a longer prefix beats a shorter
 * one. /reports/stock is Stock's (its own tab) although Financial's Reports
 * family also lives under /reports.
 */
export function sectionForPath(ws: Workspace, path: string, search: NavSearch = {}): NavSection | null {
  const bare = barePath(path);
  let best: NavSection | null = null;
  let bestScore = -1;
  for (const section of ws.sections ?? []) {
    const matches = section.items.filter((item) => isNavActive(item, path));
    if (matches.length === 0) continue;
    const score = Math.max(...matches.map((item) => navMatchScore(item, bare, search)));
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }
  return best;
}

/** The query of the page being matched (`?show=payments`); a tab that names one needs it. */
export type NavSearch = Readonly<Record<string, unknown>>;

/** The score of a row or tab whose `to` IS the path; a tab whose query also matches scores one more. */
const EXACT_SCORE = 1_000_000;

/**
 * How specifically the row or tab itself matches; -1 when it does not. A tab
 * that names a query matches only with that query, and then beats a tab on the
 * same path without one: on /safe?show=payments Pay's Bills & suppliers beats
 * Cash's Main cash, which keeps plain /safe.
 */
function ownScore(item: Matchable & { search?: Readonly<Record<string, string>> }, bare: string, search: NavSearch = {}): number {
  if (!ownActive(item, bare)) return -1;
  const score = item.to === bare ? EXACT_SCORE : (item.activePrefix ?? item.to).length;
  if (!item.search) return score;
  return Object.entries(item.search).every(([key, value]) => search[key] === value) ? score + 1 : -1;
}

/** How specifically a row matches, counting its tabs: its own path beats any prefix, a longer prefix a shorter one. */
function navMatchScore(item: NavItem, bare: string, search: NavSearch = {}): number {
  return Math.max(ownScore(item, bare), ...(item.tabs ?? []).map((tab) => ownScore(tab, bare, search)));
}

/**
 * The one row of a printed list that lights for `path`, or null. Same rule as
 * sectionForPath, one level down: On hand claims all of /stock, but on
 * /stock/counts the Counting family is the more specific match and On hand
 * stays dark, so the rail never shows two current pages. Pass the rows as
 * printed (hidden and role-filtered rows removed), so a row nobody can see
 * never takes the light from its visible parent.
 */
export function activeNavItem(items: readonly NavItem[], path: string, search: NavSearch = {}): NavItem | null {
  const bare = barePath(path);
  let best: NavItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    if (!isNavActive(item, path)) continue;
    const score = navMatchScore(item, bare, search);
    if (score > bestScore) {
      best = item;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Can this workspace's rail — its own or one of its sections' — reach `path`?
 * Guards the shell's "follow a link into another workspace" rule: /ops is the
 * manager's home AND a hidden row of the owner's Observe, and an owner opening
 * it must keep the management rail.
 */
export function workspaceOwnsPath(key: WorkspaceKey, path: string): boolean {
  const ws = WORKSPACES[key];
  return workspaceItems(ws).some((item) => isNavActive(item, path));
}

/** The rows a section's rail prints — its items minus the hidden ones. */
export function sectionRailItems(section: NavSection): readonly NavItem[] {
  return section.items.filter((item) => !item.hidden);
}

/**
 * The family row whose tabs `path` is one of, on this workspace's rail, or
 * null when the page stands alone. Only printed rows count: a hidden row has
 * no tabs to show.
 */
export function familyRowForPath(ws: Workspace, path: string, search: NavSearch = {}): NavItem | null {
  const section = sectionForPath(ws, path, search);
  const rows = (section ? section.items : ws.groups.flatMap((g) => g.items)).filter((row) => !row.hidden);
  const row = activeNavItem(rows, path, search);
  return row?.tabs?.length ? row : null;
}

/** Does the query select this tab among its siblings (`?tab=` on Coaches)? */
function searchSelects(tab: NavTab, siblings: readonly NavTab[], search: Readonly<Record<string, unknown>>): boolean {
  const keys = new Set(siblings.flatMap((t) => Object.keys(t.search ?? {})));
  for (const key of keys) {
    const have = typeof search[key] === 'string' ? (search[key] as string) : undefined;
    if ((tab.search?.[key] ?? undefined) !== have) return false;
  }
  return true;
}

/**
 * The tab of a family that `path` (and its query) shows, or null when the page
 * is not one of the family's tabs but sits under one of them (a promotion's
 * editor under Promotions): the row stays lit there, but the tab strip belongs
 * to the tab pages themselves.
 */
export function activeTab(tabs: readonly NavTab[], path: string, search: Readonly<Record<string, unknown>> = {}): NavTab | null {
  const bare = barePath(path);
  let best: NavTab | null = null;
  let bestScore = -1;
  for (const tab of tabs) {
    if (bare !== tab.to) continue;
    if (!searchSelects(tab, tabs, search)) continue;
    const score = ownScore(tab, bare, search);
    if (score > bestScore) {
      best = tab;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Where a row goes: the first of its tabs the person may open, so a manager's
 * From the team lands on the pay deductions they propose and never on a
 * refusal. A row without tabs goes to its own `to`.
 */
export function rowTarget(row: NavItem, canOpen: (tab: NavTab) => boolean): { to: string; search?: Readonly<Record<string, string>> } {
  const tab = row.tabs?.find(canOpen);
  return tab ? { to: tab.to, ...(tab.search ? { search: tab.search } : {}) } : { to: row.to };
}

/**
 * Where a section button goes: the first printed row the person may open,
 * through rowTarget. Null when they may open none of it, and the button is
 * not printed.
 */
export function sectionTarget(
  section: NavSection,
  canOpenRow: (row: NavItem) => boolean,
  canOpenTab: (tab: NavTab) => boolean,
): { to: string; search?: Readonly<Record<string, string>> } | null {
  const row = sectionRailItems(section).find(canOpenRow);
  return row ? rowTarget(row, canOpenTab) : null;
}
