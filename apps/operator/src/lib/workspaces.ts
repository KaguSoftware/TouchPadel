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
 * Management's sections are FINANCIAL, OBSERVE, STOCK and SETUP, cut by the
 * question being asked rather than by screen type:
 *
 *   * Financial answers "how much came in, how much went out, does the cash
 *     agree": the money reports, the cash (day close, safe, drawer), pay, and
 *     the prices that produce tomorrow's figures.
 *   * Observe (key `observation`) answers "what is happening, who did it, what
 *     is waiting on me": the floor, the boards, staff activity, what the team
 *     sends up, protocols, marketing and the audit log.
 *   * Stock answers "what is on the shelves, what came in, what went out and
 *     what is it worth".
 *   * Setup is configuration, not a reading of the business.
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

export type SectionKey = 'financial' | 'observation' | 'stock' | 'setup' | 'run' | 'records' | 'opsSetup';

/**
 * A named part of a workspace with its own landing screen and its own rail.
 * `home` is where the workspace's button lands; `items` is the rail shown
 * from there on.
 * Name and lead read from ws.shell.section.* / ws.shell.sectionLead.*.
 */
export interface NavSection {
  key: SectionKey;
  home: string;
  icon: IconName;
  items: readonly NavItem[];
  /**
   * Opened from a row in the workspace's own groups, so the rail prints no
   * separate section button for it (the manager's Stock, in Run the day).
   */
  fromRow?: boolean;
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
 * sits on the desk's and the till's rails; management reaches it under From
 * the team.
 */
const INCIDENTS: NavItem = { to: '/incidents', labelKey: 'incidents', icon: 'alert', badge: 'incidentsOpen' };
/** Late arrivals and early leaves (0271): the manager records them; the owner reads them under Pay. */
const ATTENDANCE: NavItem = { to: '/attendance', labelKey: 'attendance', icon: 'clock' };

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
// Families shared by the owner's and the manager's rails.
// ---------------------------------------------------------------------------

/**
 * The cash, in the order the money moves at the end of a day: whether the
 * drawers agreed (day close), the main cash every cost is paid from (0343),
 * then the drawer itself. Before the rebuild these were three unrelated rows.
 */
const CASH_TABS: readonly NavTab[] = [
  { to: '/admin/day-close', labelKey: 'dayClose' },
  { to: '/safe', labelKey: 'safe' },
  { to: '/till/drawer', labelKey: 'cashDrawer' },
];

/**
 * What the team sends up to management. The owner decides requests and pay
 * deductions; a manager proposes deductions (theirs is the same page, read as
 * their role), reviews incidents and reads the suggestion box. Protocols stay
 * a row of their own: they are a tool for running a change, not an inbox.
 */
const FROM_TEAM_TABS: readonly NavTab[] = [
  { to: '/observation/requests', labelKey: 'requests' },
  { to: '/deductions', labelKey: 'deductions', badge: 'deductionsWaiting' },
  { to: '/incidents', labelKey: 'incidents', badge: 'incidentsOpen' },
  { to: '/suggestions', labelKey: 'suggestions', badge: 'suggestionsNew' },
];

/** The menu editor and its siblings, one tab each. */
const MENU_TABS: readonly NavTab[] = [
  { to: '/admin/menu', labelKey: 'menuItems' },
  { to: '/admin/categories', labelKey: 'categories' },
  { to: '/admin/addons', labelKey: 'addons' },
  { to: '/admin/suggested', labelKey: 'suggested' },
];

/**
 * Coaches, lesson types, the coaches' hours and the lesson rules (the rules
 * used to be a panel inside Venue settings). One route, told apart by `?tab=`
 * (routes/admin/coaches.tsx); the picked coach travels to Hours.
 */
const COACHES_TABS: readonly NavTab[] = [
  { to: '/admin/coaches', labelKey: 'coaches', keepSearch: ['coach'] },
  { to: '/admin/coaches', labelKey: 'lessonTypes', search: { tab: 'types' } },
  { to: '/admin/coaches', labelKey: 'coachHours', search: { tab: 'hours' }, keepSearch: ['coach'] },
  { to: '/admin/coaches', labelKey: 'lessonRules', search: { tab: 'rules' } },
];

/**
 * Coach pay (coaching operator.md §5.3.3): its exact `to` beats a '/reports'
 * prefix in `sectionForPath`, so it lights on its own screen.
 */
const COACH_PAY: NavItem = { to: '/reports/coaches', labelKey: 'coachPay', icon: 'whistle' };
const COACHES: NavItem = { to: '/admin/coaches', labelKey: 'coaches', icon: 'whistle', tabs: COACHES_TABS };

/**
 * Protocols and the suggestion box, on both management rails with their
 * counts (build-contracts-2026-09-23 §5.1).
 */
const PROTOCOLS: NavItem = { to: '/protocols', labelKey: 'protocols', icon: 'split', badge: 'protocolsWaiting' };

// ---------------------------------------------------------------------------
// Operations (the manager)
// ---------------------------------------------------------------------------

/**
 * The manager's rail: Today, then three sections (owner call, 2026-10-16).
 * Pressing a section opens its first screen, and from there the rail is that
 * section's rows and a way back.
 *
 *   * Today — the landing screen: what needs the manager now.
 *   * Run the day — the working screens a shift moves between.
 *   * Records — what already happened.
 *   * Setup — what the other screens are priced and built from.
 */
const MANAGER_TODAY: readonly NavItem[] = [{ to: '/ops', labelKey: 'today', icon: 'dashboard' }];

/** What the team sends up, as a manager reads it: no staff requests (the owner's). */
const MANAGER_FROM_TEAM_TABS: readonly NavTab[] = [
  { to: '/deductions', labelKey: 'deductions', badge: 'deductionsWaiting' },
  { to: '/incidents', labelKey: 'incidents', badge: 'incidentsOpen' },
  { to: '/suggestions', labelKey: 'suggestions', badge: 'suggestionsNew' },
];

const MANAGER_RUN: readonly NavItem[] = [
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk' },
  { to: '/till/tabs', labelKey: 'openTabs', icon: 'receipt', activePrefix: '/till/tabs' },
  // Stock opens the Stock section's own rail (STOCK_SECTION below).
  { to: '/stock', labelKey: 'stock', icon: 'package', activePrefix: '/stock' },
  { to: '/admin/day-close', labelKey: 'cash', icon: 'drawer', tabs: CASH_TABS },
  PROTOCOLS,
  { to: '/deductions', labelKey: 'fromTeam', icon: 'bell', tabs: MANAGER_FROM_TEAM_TABS },
  ATTENDANCE,
];

/** The manager's reports: courts, cafe and staff activity (revenue is the owner's). */
const MANAGER_REPORT_TABS: readonly NavTab[] = [
  { to: '/reports/courts', labelKey: 'courts' },
  { to: '/reports/cafe', labelKey: 'cafe' },
  { to: '/reports/staff', labelKey: 'staffActivity' },
];

const MANAGER_RECORDS: readonly NavItem[] = [
  { to: '/reports/courts', labelKey: 'reports', icon: 'chart', tabs: MANAGER_REPORT_TABS },
  COACH_PAY,
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
];

const MANAGER_SETUP: readonly NavItem[] = [
  { to: '/admin/menu', labelKey: 'menu', icon: 'layers', tabs: MENU_TABS },
  { to: '/admin/rates', labelKey: 'rates', icon: 'scale' },
  COACHES,
  { to: '/admin/promotions', labelKey: 'promotions', icon: 'tag' },
];

// ---------------------------------------------------------------------------
// Management (the owner)
// ---------------------------------------------------------------------------

/**
 * Management's own rail. The panel is the headline every other screen in the
 * workspace elaborates, and Analytics and the assistant read across every
 * section, so they sit above the split (owner calls, 2026-09-13 and
 * docs/design/assistant §5.1).
 */
const OWNER_PRIMARY: readonly NavItem[] = [
  { to: '/panel', labelKey: 'panel', icon: 'dashboard' },
  { to: '/analytics', labelKey: 'analytics', icon: 'trendUp', activePrefix: '/analytics' },
  { to: '/assistant', labelKey: 'assistant', icon: 'spark', activePrefix: '/assistant' },
];

/** The money reports share one screen frame; each is a tab. */
const REVENUE_REPORT_TABS: readonly NavTab[] = [
  { to: '/reports/revenue', labelKey: 'revenue' },
  { to: '/reports/courts', labelKey: 'courts' },
  { to: '/reports/cafe', labelKey: 'cafe' },
];

/**
 * Paying people: salaries and pay days, the late arrivals and early leaves
 * that come off them (it hid inside Wages before the rebuild), the rewards
 * added to them, and the coaches' monthly statements.
 */
const PAY_TABS: readonly NavTab[] = [
  { to: '/wages', labelKey: 'wages', badge: 'wagesDue' },
  { to: '/attendance', labelKey: 'attendance' },
  { to: '/rewards', labelKey: 'rewards' },
  { to: '/reports/coaches', labelKey: 'coachPay' },
];

/**
 * FINANCIAL — money in, money out, and the places it is counted. Order is the
 * money's own path: what was earned, the cash and whether it agrees, what is
 * paid out to people, then the prices that will produce tomorrow's figures.
 */
const OWNER_FINANCIAL: readonly NavItem[] = [
  { to: '/financial', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/reports/revenue', labelKey: 'reports', icon: 'chart', tabs: REVENUE_REPORT_TABS },
  { to: '/admin/day-close', labelKey: 'cash', icon: 'drawer', tabs: CASH_TABS },
  { to: '/wages', labelKey: 'pay', icon: 'banknote', tabs: PAY_TABS },
  { to: '/admin/rates', labelKey: 'rates', icon: 'scale' },
  { to: '/admin/menu', labelKey: 'menuPrices', icon: 'layers', tabs: MENU_TABS },
];

/** Who is on the operator and the phone now (0341), and what they did over a period. */
const STAFF_ACTIVITY_TABS: readonly NavTab[] = [
  { to: '/observation/activity', labelKey: 'whoIsOn' },
  { to: '/reports/staff', labelKey: 'whatTheyDid' },
];

/** Campaigns, the promotions they run, and the Telegram group (all hidden inside Marketing before). */
const MARKETING_TABS: readonly NavTab[] = [
  { to: '/marketing', labelKey: 'campaigns', activePrefix: '/marketing', badge: 'contentWaiting' },
  { to: '/admin/promotions', labelKey: 'promotions' },
  { to: '/admin/telegram', labelKey: 'telegram' },
];

/**
 * OBSERVE — watching the venue rather than counting it. Right now (the
 * overview and the two boards), who is working, what the team sends up, the
 * protocols running, marketing, and the audit log, where you go when one of
 * the others raised a question.
 *
 * Bookings and Tills are Observe's OWN boards, view-only (owner call,
 * 2026-09-13); every write is an "Open in …" button away.
 */
const OWNER_OBSERVATION: readonly NavItem[] = [
  { to: '/observation', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/observation/courts', labelKey: 'bookings', icon: 'calendar' },
  { to: '/observation/tills', labelKey: 'tills', icon: 'receipt' },
  { to: '/observation/activity', labelKey: 'staffActivity', icon: 'users', tabs: STAFF_ACTIVITY_TABS },
  { to: '/observation/requests', labelKey: 'fromTeam', icon: 'bell', tabs: FROM_TEAM_TABS },
  PROTOCOLS,
  { to: '/marketing', labelKey: 'marketing', icon: 'spark', tabs: MARKETING_TABS },
  { to: '/admin/audit', labelKey: 'audit', icon: 'fileText' },
  // Floor now is the overview's own body (owner call, 2026-10-08); /ops sends
  // the owner there, and this keeps the rail on Observe for that moment.
  { to: '/ops', labelKey: 'floorNow', icon: 'dashboard', hidden: true },
  // The overview's area buttons still open the working screens; these keep
  // the Observe rail there. `/till/tabs` carries no prefix: '/till' would also
  // claim /till/drawer, which is Financial's.
  { to: '/desk', labelKey: 'bookings', icon: 'calendar', activePrefix: '/desk', hidden: true },
  { to: '/till/tabs', labelKey: 'tills', icon: 'receipt', hidden: true },
];

/** What is on the shelves: the stock itself, the warnings about it, what expires, what it is worth. */
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

/**
 * STOCK — the shelves, on the owner's rail and the manager's alike: four
 * families and the Touch Shop desk (0243–0246), whose till, drawer and
 * products are its own.
 */
const STOCK: readonly NavItem[] = [
  // Claims the whole /stock subtree, so an old link to a /stock path with no
  // tab of its own still keeps this rail; every tab is a more specific match.
  { to: '/stock', labelKey: 'onHand', icon: 'package', activePrefix: '/stock', tabs: ON_HAND_TABS },
  { to: '/stock/receive', labelKey: 'stockMovement', icon: 'box', tabs: STOCK_MOVEMENT_TABS },
  { to: '/stock/counts', labelKey: 'stockCounting', icon: 'scale', tabs: STOCK_COUNTING_TABS },
  { to: '/stock/ingredients', labelKey: 'stockCosts', icon: 'fileText', tabs: STOCK_COSTS_TABS },
  { to: '/shop', labelKey: 'shop', icon: 'tag' },
];

/**
 * Courts and every rule about playing on them. The booking rules, the online
 * deposit, open matches and tournaments were panels inside Venue settings.
 */
const COURTS_TABS: readonly NavTab[] = [
  { to: '/admin/courts', labelKey: 'courts' },
  { to: '/admin/settings/booking', labelKey: 'bookingRules' },
  { to: '/admin/settings/deposit', labelKey: 'onlineDeposit', when: 'onlinePaymentsLive' },
  { to: '/admin/settings/matches', labelKey: 'openMatches', when: 'onlinePaymentsLive' },
  { to: '/admin/settings/tournaments', labelKey: 'tournaments' },
];

/**
 * The venue itself: its name and the values fixed at setup, when it opens,
 * when its business day starts, and what analytics leaves out. `/admin/settings`
 * stays the venue's address; `/admin/hours` stops being a second copy of the
 * opening hours and becomes this family's tab.
 */
const VENUE_TABS: readonly NavTab[] = [
  { to: '/admin/settings', labelKey: 'venueDetails', exact: true },
  { to: '/admin/hours', labelKey: 'openingHours' },
  { to: '/admin/settings/day', labelKey: 'businessDay' },
  { to: '/admin/settings/analytics', labelKey: 'analytics' },
];

/** What a guest sees: the guest app's home screen and the table QR cards that open it. */
const GUEST_APP_TABS: readonly NavTab[] = [
  { to: '/admin/hero', labelKey: 'guestSite', activePrefix: '/admin/hero' },
  { to: '/admin/qr', labelKey: 'tables' },
];

/**
 * The machines: which ones report in, which stations are registered at the
 * branch, the kitchen screens paired to the till (on the hidden Setup
 * overview before), and when the venue counts as offline.
 */
const DEVICES_TABS: readonly NavTab[] = [
  { to: '/admin/settings/devices', labelKey: 'devices' },
  { to: '/admin/settings/stations', labelKey: 'stations' },
  { to: '/admin/settings/kitchen', labelKey: 'kitchenScreens' },
  { to: '/admin/settings/offline', labelKey: 'offlineMode' },
];

/** SETUP — configuration: people, the courts and their rules, the venue, the guest app, loyalty, the machines. */
const OWNER_SETUP: readonly NavItem[] = [
  { to: '/setup', labelKey: 'overview', icon: 'grid', exact: true },
  { to: '/admin/staff', labelKey: 'staff', icon: 'shield' },
  COACHES,
  { to: '/admin/courts', labelKey: 'courts', icon: 'court', tabs: COURTS_TABS },
  { to: '/admin/settings', labelKey: 'venue', icon: 'home', tabs: VENUE_TABS },
  { to: '/admin/branches', labelKey: 'branches', icon: 'pin' },
  { to: '/admin/hero', labelKey: 'guestApp', icon: 'globe', tabs: GUEST_APP_TABS },
  // Loyalty (build-contracts-2026-10-05 §5): business-wide points, tiers and rewards.
  { to: '/admin/loyalty', labelKey: 'loyalty', icon: 'star' },
  { to: '/admin/settings/devices', labelKey: 'devices', icon: 'settings', tabs: DEVICES_TABS },
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

/** Stock as a section, on the owner's rail and the manager's alike. */
const STOCK_SECTION: NavSection = { key: 'stock', home: '/stock', icon: 'package', items: STOCK };

const OWNER_SECTIONS: readonly NavSection[] = [
  { key: 'financial', home: '/financial', icon: 'banknote', items: OWNER_FINANCIAL },
  { key: 'observation', home: '/observation', icon: 'eye', items: OWNER_OBSERVATION },
  STOCK_SECTION,
  // Sliders, not the gear: the gear is the Devices row inside this section,
  // and the mobile app's settings glyph is the same sliders.
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
    groups: [{ labelKey: null, items: MANAGER_TODAY }],
    sections: [
      // Stock opens its own rail, as it does for the owner (owner call,
      // 2026-09-27), from its row in Run the day rather than a section button.
      // FIRST, because Run the day lists the same /stock row: on /stock both
      // match exactly, and sectionForPath keeps the earlier section on a tie.
      { ...STOCK_SECTION, fromRow: true },
      // Each lands on its first row, like Management's Setup.
      { key: 'run', home: '/desk', icon: 'play', items: MANAGER_RUN },
      { key: 'records', home: '/reports/courts', icon: 'bookOpen', items: MANAGER_RECORDS },
      { key: 'opsSetup', home: '/admin/menu', icon: 'sliders', items: MANAGER_SETUP },
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
export function sectionForPath(ws: Workspace, path: string): NavSection | null {
  const bare = barePath(path);
  let best: NavSection | null = null;
  let bestScore = -1;
  for (const section of ws.sections ?? []) {
    const matches = section.items.filter((item) => isNavActive(item, path));
    if (matches.length === 0) continue;
    const score = Math.max(...matches.map((item) => navMatchScore(item, bare)));
    if (score > bestScore) {
      best = section;
      bestScore = score;
    }
  }
  return best;
}

/** How specifically the row or tab itself matches; -1 when it does not. */
function ownScore(item: Matchable, bare: string): number {
  if (!ownActive(item, bare)) return -1;
  return item.to === bare ? Number.MAX_SAFE_INTEGER : (item.activePrefix ?? item.to).length;
}

/** How specifically a row matches, counting its tabs: its own path beats any prefix, a longer prefix a shorter one. */
function navMatchScore(item: NavItem, bare: string): number {
  return Math.max(ownScore(item, bare), ...(item.tabs ?? []).map((tab) => ownScore(tab, bare)));
}

/**
 * The one row of a printed list that lights for `path`, or null. Same rule as
 * sectionForPath, one level down: On hand claims all of /stock, but on
 * /stock/counts the Counting family is the more specific match and On hand
 * stays dark, so the rail never shows two current pages. Pass the rows as
 * printed (hidden and role-filtered rows removed), so a row nobody can see
 * never takes the light from its visible parent.
 */
export function activeNavItem(items: readonly NavItem[], path: string): NavItem | null {
  const bare = barePath(path);
  let best: NavItem | null = null;
  let bestScore = -1;
  for (const item of items) {
    if (!isNavActive(item, path)) continue;
    const score = navMatchScore(item, bare);
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
export function familyRowForPath(ws: Workspace, path: string): NavItem | null {
  const section = sectionForPath(ws, path);
  const rows = (section ? section.items : ws.groups.flatMap((g) => g.items)).filter((row) => !row.hidden);
  const row = activeNavItem(rows, path);
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
    const score = ownScore(tab, bare);
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
