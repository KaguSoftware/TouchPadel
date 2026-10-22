import { describe, expect, it, beforeEach } from 'vitest';
import {
  WORKSPACES,
  activeNavItem,
  defaultWorkspace,
  isNavActive,
  loadWorkspace,
  saveWorkspace,
  sectionForPath,
  sectionRailItems,
  workspaceForRoute,
  workspaceItems,
  workspaceOwnsPath,
  workspacesForRole,
  activeTab,
  familyRowForPath,
  rowShown,
  rowTarget,
  sectionTarget,
  workspaceHome,
  type NavItem,
  type NavSection,
  type NavTab,
} from './workspaces';
import { ROUTE_ROLES, SUB_ROUTES, canAccess, type StaffRole } from './auth';

describe('workspacesForRole', () => {
  it('gives single-role staff exactly their own workspace', () => {
    expect(workspacesForRole('cashier')).toEqual(['cashier']);
    expect(workspacesForRole('prep')).toEqual(['prep']);
    expect(workspacesForRole('court_desk')).toEqual(['courtDesk']);
  });
  it('gives the bar and kitchen family the kitchen and nothing else, as prep had', () => {
    for (const role of ['head_barista', 'barista', 'assistant_barista', 'head_chef', 'chef'] as const) {
      expect(workspacesForRole(role), role).toEqual(['prep']);
    }
  });
  it('gives driver, marketing and the waiter the team workspace alone', () => {
    expect(workspacesForRole('driver')).toEqual(['team']);
    expect(workspacesForRole('marketing')).toEqual(['team']);
    expect(workspacesForRole('waiter')).toEqual(['team']);
  });
  it('gives the shop assistant the Touch Shop desk and nothing of the café (0243)', () => {
    expect(workspacesForRole('shop_staff')).toEqual(['shop']);
    expect(defaultWorkspace('shop_staff')).toBe('shop');
  });
  it('opens Management first for the manager and the owner alike (2026-10-19: Operations folded in)', () => {
    expect(defaultWorkspace('manager')).toBe('management');
    expect(defaultWorkspace('owner')).toBe('management');
  });
  it('gives the manager and the owner the same list: Management, the floor workspaces, the shop desk last', () => {
    // The team workspace is not a floor workspace: its one screen is refused
    // to both jokers (ROUTE_ROLES), so neither may switch into it. The Touch
    // Shop desk (0243) is one they open.
    for (const role of ['manager', 'owner'] as const) {
      expect(workspacesForRole(role), role).toEqual(['management', 'courtDesk', 'cashier', 'prep', 'shop']);
    }
  });
});

describe('navigation sets', () => {
  it('the prep workspace has no navigation at all (spec §04)', () => {
    expect(WORKSPACES.prep.groups).toHaveLength(0);
  });
  it('the team workspace is one untitled group holding My tasks and Insights', () => {
    expect(WORKSPACES.team.home).toBe('/tasks');
    expect(WORKSPACES.team.groups.map((g) => [g.labelKey, g.items.map((i) => [i.to, i.labelKey])])).toEqual([
      [null, [['/tasks', 'myTasks'], ['/insights', 'insights']]],
    ]);
  });
  it('every nav target is a route the workspace owner role may open', () => {
    const roleFor: Record<keyof typeof WORKSPACES, StaffRole> = {
      courtDesk: 'court_desk',
      cashier: 'cashier',
      prep: 'prep',
      // The owner and the manager share it, each seeing the rows they may
      // open: held to the owner here, and to "something to open in every
      // section" under 'the manager in Management'.
      management: 'owner',
      // Insights (0360) is marketing's row: the rail drops it for the driver
      // and the waiter (rowShown), checked below.
      team: 'marketing',
      shop: 'shop_staff',
    };
    for (const ws of Object.values(WORKSPACES)) {
      for (const item of workspaceItems(ws)) {
        expect(canAccess(roleFor[ws.key], item.to), `${ws.key} → ${item.to}`).toBe(true);
      }
      for (const section of ws.sections ?? []) {
        expect(canAccess(roleFor[ws.key], section.home), `${ws.key} → ${section.key} home`).toBe(true);
      }
      expect(canAccess(roleFor[ws.key], ws.home), `${ws.key} home`).toBe(true);
    }
    // The manager cannot open the Overview, so Management opens on Today.
    expect(workspaceHome(WORKSPACES.management, (p) => canAccess('manager', p))).toBe('/ops');
    expect(workspaceHome(WORKSPACES.management, (p) => canAccess('owner', p))).toBe('/panel');
    // Every role that holds a workspace can open all of it, not just the one
    // named above.
    for (const role of ['head_barista', 'barista', 'assistant_barista', 'head_chef', 'chef', 'marketing', 'waiter', 'driver'] as const) {
      for (const key of workspacesForRole(role)) {
        for (const item of workspaceItems(WORKSPACES[key])) {
          // The team's Insights row is marketing's alone; the rail hides it from the rest (rowShown).
          if (item.to === '/insights' && role !== 'marketing') {
            expect(rowShown(item, (p) => canAccess(role, p), (t) => canAccess(role, t.to)), `${role} sees no Insights row`).toBe(false);
            continue;
          }
          expect(canAccess(role, item.to), `${role} → ${item.to}`).toBe(true);
        }
        expect(canAccess(role, WORKSPACES[key].home), `${role} → ${key} home`).toBe(true);
      }
    }
  });
  it('every route prefix in ROUTE_ROLES is reachable from at least one rail or is a shell route', () => {
    const targets = new Set(Object.values(WORKSPACES).flatMap((ws) => workspaceItems(ws).map((i) => i.to)));
    // Telegram lives in the admin sub-nav (System group), not on a rail.
    const shell = new Set(['/workspaces', '/kds', '/reports', '/reports/revenue', '/desk/customers/new', '/admin/telegram']);
    for (const prefix of Object.keys(ROUTE_ROLES)) {
      const railed = [...targets].some((t) => t === prefix || t.startsWith(`${prefix}/`) || prefix.startsWith(`${t}/`));
      expect(shell.has(prefix) || railed, prefix).toBe(true);
    }
  });

  it('puts My tasks last on the desk and the till, where a shift can reach its steps (§5.1)', () => {
    for (const key of ['courtDesk', 'cashier'] as const) {
      const items = WORKSPACES[key].groups.flatMap((g) => g.items);
      expect(items.at(-1)?.to, key).toBe('/tasks');
      expect(items.at(-1)?.labelKey, key).toBe('myTasks');
    }
    // The kitchen board stays navless: its My tasks is a header button.
    expect(WORKSPACES.prep.groups).toHaveLength(0);
  });

  it('badges the Protocols and Suggestions rows, the wave-5 Deductions, Incidents and Marketing rows, Stock count, Wages, and no other', () => {
    const badged = Object.values(WORKSPACES)
      .flatMap((ws) => workspaceItems(ws))
      .filter((i) => i.badge)
      .map((i) => [i.to, i.badge]);
    expect(new Set(badged.map((b) => b.join(' ')))).toEqual(
      new Set([
        '/protocols protocolsWaiting',
        '/suggestions suggestionsNew',
        '/deductions deductionsWaiting',
        '/incidents incidentsOpen',
        '/marketing contentWaiting',
        // The phone counts waiting, on the owner's Stock section (2026-09-27).
        '/stock/counts stockCountsWaiting',
        // The owner's pay-day reminder (0271).
        '/wages wagesDue',
      ]),
    );
  });

  it('puts Incidents on the desk and the till just before My tasks (wave5-addendum §5.2)', () => {
    for (const key of ['courtDesk', 'cashier'] as const) {
      const items = WORKSPACES[key].groups.flatMap((g) => g.items);
      expect(items.at(-2)?.to, key).toBe('/incidents');
      expect(canAccess(key === 'courtDesk' ? 'court_desk' : 'cashier', '/incidents'), key).toBe(true);
    }
  });
});

describe('isNavActive', () => {
  it('exact items only match their own path', () => {
    const cal = WORKSPACES.courtDesk.groups[0]!.items.find((i) => i.to === '/desk')!;
    expect(isNavActive(cal, '/desk')).toBe(true);
    expect(isNavActive(cal, '/desk/today')).toBe(false);
  });
  it('prefix items match their subtree and ignore query strings', () => {
    const series = WORKSPACES.courtDesk.groups[0]!.items.find((i) => i.labelKey === 'newSeries')!;
    expect(isNavActive(series, '/desk/series/abc?x=1')).toBe(true);
    expect(isNavActive(series, '/desk/customers')).toBe(false);
  });
  it('lights the analytics row on both of its tabs', () => {
    const analytics = WORKSPACES.management.groups[0]!.items.find((i) => i.labelKey === 'analytics')!;
    expect(isNavActive(analytics, '/analytics/courts?range=7d')).toBe(true);
    expect(isNavActive(analytics, '/analytics/cafe')).toBe(true);
    expect(isNavActive(analytics, '/panel')).toBe(false);
  });
});

describe('workspace memory', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as unknown as Storage;
  });
  it('remembers a choice the role is allowed and ignores one it is not', () => {
    saveWorkspace('cashier');
    expect(loadWorkspace('manager')).toBe('cashier');
    // A cashier signing in on the same station never inherits Management.
    saveWorkspace('management');
    expect(loadWorkspace('cashier')).toBe('cashier');
  });
  it('opens Management on a station that remembered Operations or the old owner key', () => {
    for (const stale of ['manager', 'owner']) {
      localStorage.setItem('touch-operator-workspace', stale);
      expect(loadWorkspace('manager'), stale).toBe('management');
      expect(loadWorkspace('owner'), stale).toBe('management');
    }
  });
});

describe('workspaceForRoute', () => {
  it('pins single-workspace routes and leaves shared ones alone', () => {
    expect(workspaceForRoute('/kds')).toBe('prep');
    for (const path of ['/panel', '/ops', '/setup', '/analytics', '/analytics/courts', '/wages', '/rewards']) {
      expect(workspaceForRoute(path), path).toBe('management');
    }
    // Manager and owner both open it, under Team.
    expect(workspaceForRoute('/attendance')).toBeNull();
    // Eight roles open My tasks in their own workspace (§5.1), so it pins none.
    expect(workspaceForRoute('/tasks')).toBeNull();
    expect(workspaceForRoute('/desk')).toBeNull();
    // Management shares it with nobody else, but a link in keeps whichever rail is open.
    expect(workspaceForRoute('/protocols')).toBeNull();
    expect(workspaceForRoute('/suggestions')).toBeNull();
    expect(workspaceForRoute('/till/tabs')).toBeNull();
  });
});

/** The rows a section prints for this role, as the shell's rail decides (rowShown). */
function printed(section: NavSection, role: StaffRole): readonly NavItem[] {
  const canOpen = (p: string) => canAccess(role, p);
  return sectionRailItems(section).filter((row) => rowShown(row, canOpen, (t) => canOpen(t.to)));
}

describe('sections (page map, 2026-10-17)', () => {
  const mgmt = WORKSPACES.management;
  const section = (key: string) => mgmt.sections!.find((s) => s.key === key)!;
  const primary = (role: StaffRole) =>
    mgmt.groups[0]!.items.filter((i) => !i.hidden && rowShown(i, (p) => canAccess(role, p), (t) => canAccess(role, t.to))).map((i) => i.to);

  it("management's own rail is the owner's Overview, Analytics and the assistant, or the manager's Today, then Files for both, plus one button per part of the club", () => {
    expect(mgmt.groups).toHaveLength(1);
    // Floor now folded into the Overview (2026-10-17): "Needs you" and the live floor sit on top of it.
    // Files (0354) is the owner's and the managers' documents, so it is on both.
    expect(primary('owner')).toEqual(['/panel', '/analytics', '/assistant', '/files']);
    expect(primary('manager')).toEqual(['/ops', '/files']);
    expect(mgmt.sections?.map((s) => s.key)).toEqual(['money', 'courts', 'cafe', 'stock', 'team', 'customers', 'settings']);
  });

  it('every section opens on its own first rail item, so the rail can lead back to it', () => {
    for (const sec of mgmt.sections ?? []) {
      expect(sec.items[0]!.to, sec.key).toBe(sec.home);
    }
  });

  it('puts each page where the owner would look first', () => {
    const where = (path: string, search = {}) => sectionForPath(mgmt, path, search)?.key;
    // Financial: sales, the cash, everything paid out.
    for (const path of ['/reports/revenue', '/reports/courts', '/reports/cafe', '/admin/day-close', '/safe', '/till/drawer', '/wages', '/deductions', '/rewards', '/reports/coaches']) {
      expect(where(path), path).toBe('money');
    }
    // Courts: bookings, every court setting, coaches.
    for (const path of ['/observation/courts', '/desk', '/admin/rates', '/admin/courts', '/admin/settings/booking', '/admin/hours', '/admin/settings/tournaments', '/admin/coaches']) {
      expect(where(path), path).toBe('courts');
    }
    // Café & shop.
    for (const path of ['/observation/tills', '/till/tabs', '/admin/menu', '/admin/categories', '/admin/qr', '/shop']) {
      expect(where(path), path).toBe('cafe');
    }
    // Stock, its value included.
    for (const path of ['/stock', '/stock/receive', '/stock/variance', '/stock/margins', '/reports/stock']) {
      expect(where(path), path).toBe('stock');
    }
    // Team: lateness is recorded here, not under Pay.
    for (const path of ['/admin/staff', '/observation/activity', '/reports/staff', '/attendance', '/observation/requests', '/incidents', '/suggestions', '/protocols']) {
      expect(where(path), path).toBe('team');
    }
    for (const path of ['/desk/customers', '/admin/loyalty', '/marketing', '/admin/promotions', '/admin/telegram', '/admin/hero']) {
      expect(where(path), path).toBe('customers');
    }
    for (const path of ['/admin/settings', '/admin/settings/day', '/admin/branches', '/admin/settings/kitchen', '/admin/audit']) {
      expect(where(path), path).toBe('settings');
    }
    // The workspace's own rows are in no section.
    for (const path of ['/panel', '/observation', '/ops', '/analytics/courts']) {
      expect(sectionForPath(mgmt, path), path).toBeNull();
    }
  });

  it('opens the main cash under Cash, and the same page showing its payments under Pay', () => {
    const money = section('money');
    expect(activeNavItem(sectionRailItems(money), '/safe')?.labelKey).toBe('cash');
    expect(activeNavItem(sectionRailItems(money), '/safe', { show: 'payments' })?.labelKey).toBe('pay');
    expect(familyRowForPath(mgmt, '/safe')?.labelKey).toBe('cash');
    expect(familyRowForPath(mgmt, '/safe', { show: 'payments' })?.labelKey).toBe('pay');
    const pay = familyRowForPath(mgmt, '/safe', { show: 'payments' })!.tabs!;
    expect(activeTab(pay, '/safe', { show: 'payments' })?.labelKey).toBe('billsSuppliers');
  });

  it('keeps the working screens behind the owner’s boards on the Courts and Café & shop rails', () => {
    // Bookings and the tills are the owner's view-only boards (2026-09-13);
    // their "Open in …" buttons open the desk and the tab board.
    expect(sectionForPath(mgmt, '/desk/today')?.key).toBe('courts');
    expect(sectionForPath(mgmt, '/till/tabs')?.key).toBe('cafe');
    // The drawer is money: an activePrefix of '/till' on the tabs would light both.
    expect(sectionForPath(mgmt, '/till/drawer')?.key).toBe('money');
    // The old overviews still open from links, and keep a rail.
    expect(sectionForPath(mgmt, '/financial')?.key).toBe('money');
    expect(sectionForPath(mgmt, '/setup')?.key).toBe('settings');
  });

  it('hides only the screens a link or a drill-through still lands on', () => {
    const rows = [...mgmt.groups.flatMap((g) => g.items), ...(mgmt.sections ?? []).flatMap((s) => s.items)];
    expect(rows.filter((i) => i.hidden).map((i) => i.to)).toEqual(['/financial', '/setup']);
  });

  it('stands in the manager’s screens for the owner’s, and only those three', () => {
    const rows = [...mgmt.groups.flatMap((g) => g.items), ...(mgmt.sections ?? []).flatMap((s) => s.items)];
    expect(rows.filter((i) => i.unless).map((i) => [i.to, i.unless])).toEqual([
      ['/ops', '/panel'],
      ['/desk', '/observation/courts'],
      ['/till/tabs', '/observation/tills'],
    ]);
    // Each stands in for a page the manager may not open, and opens one they may.
    for (const row of rows.filter((i) => i.unless)) {
      expect(canAccess('manager', row.unless!), row.unless).toBe(false);
      expect(canAccess('manager', row.to), row.to).toBe(true);
    }
  });

  it('never prints one page twice on a rail, for either of them', () => {
    for (const role of ['owner', 'manager'] as const) {
      const seen = new Set<string>();
      for (const sec of mgmt.sections ?? []) {
        for (const row of printed(sec, role)) {
          for (const page of row.tabs ?? [{ to: row.to, labelKey: row.labelKey } as NavTab]) {
            const id = `${page.to}?${new URLSearchParams(page.search ?? {}).toString()}`;
            expect(seen.has(id), `${role} ${id}`).toBe(false);
            seen.add(id);
          }
        }
      }
    }
  });

  it('leaves no /reports child stranded outside a section', () => {
    for (const path of ['/reports/revenue', '/reports/courts', '/reports/cafe', '/reports/stock', '/reports/staff', '/reports/coaches']) {
      expect(sectionForPath(mgmt, path), path).not.toBeNull();
    }
  });
});

describe('workspaceOwnsPath', () => {
  it('keeps Management on every page of its rails, the manager’s own included', () => {
    for (const path of ['/ops', '/panel', '/admin/staff', '/stock/counts', '/analytics/cafe', '/protocols', '/desk', '/till/tabs']) {
      expect(workspaceOwnsPath('management', path), path).toBe(true);
    }
    // /kds is nowhere on Management's rail: following that link does hand the
    // shell over to the prep workspace.
    expect(workspaceOwnsPath('management', '/kds')).toBe(false);
    expect(workspaceOwnsPath('management', '/tasks')).toBe(false);
    expect(workspaceOwnsPath('team', '/tasks')).toBe(true);
    expect(workspaceOwnsPath('courtDesk', '/tasks')).toBe(true);
    expect(workspaceOwnsPath('cashier', '/tasks')).toBe(true);
  });
});

describe('the manager in Management', () => {
  const mgmt = WORKSPACES.management;
  const canOpen = (to: string) => canAccess('manager', to);

  it('has something a manager may open in every section, and opens the first of it', () => {
    for (const sec of mgmt.sections ?? []) {
      const target = sectionTarget(sec, (row) => rowShown(row, canOpen, (t) => canOpen(t.to)), (t) => canOpen(t.to));
      expect(target, sec.key).not.toBeNull();
      expect(canOpen(target!.to), `${sec.key} → ${target!.to}`).toBe(true);
    }
    // Money in is the owner's: the manager's Financial opens on Court sales.
    const money = mgmt.sections!.find((s) => s.key === 'money')!;
    expect(sectionTarget(money, () => true, (t) => canOpen(t.to))?.to).toBe('/reports/courts');
  });

  it('works in the desk and the tab board, the owner in the view-only boards', () => {
    const rail = (key: string, role: StaffRole) => printed(mgmt.sections!.find((s) => s.key === key)!, role).map((i) => i.to);
    expect(rail('courts', 'manager')[0]).toBe('/desk');
    expect(rail('cafe', 'manager')[0]).toBe('/till/tabs');
    expect(rail('courts', 'manager')).not.toContain('/observation/courts');
    expect(rail('cafe', 'manager')).not.toContain('/observation/tills');
    expect(rail('courts', 'owner')[0]).toBe('/observation/courts');
    expect(rail('cafe', 'owner')[0]).toBe('/observation/tills');
    expect(rail('courts', 'owner')).not.toContain('/desk');
    expect(rail('cafe', 'owner')).not.toContain('/till/tabs');
    // The section buttons follow: each opens the person's own first row.
    const open = (key: string, role: StaffRole) => {
      const can = (p: string) => canAccess(role, p);
      return sectionTarget(mgmt.sections!.find((s) => s.key === key)!, (row) => rowShown(row, can, (t) => can(t.to)), (t) => can(t.to))?.to;
    };
    expect(open('courts', 'manager')).toBe('/desk');
    expect(open('cafe', 'manager')).toBe('/till/tabs');
    expect(open('courts', 'owner')).toBe('/observation/courts');
    expect(open('cafe', 'owner')).toBe('/observation/tills');
  });

  it('lights Coaches › Schedules, not Bookings, on the Coaches tab, for either of them', () => {
    const sec = mgmt.sections!.find((s) => s.key === 'courts')!;
    for (const role of ['owner', 'manager'] as const) {
      expect(sectionForPath(mgmt, '/desk/coaches')?.key, role).toBe('courts');
      const row = activeNavItem(printed(sec, role), '/desk/coaches');
      expect(row?.labelKey, role).toBe('coaches');
      expect(activeTab(row!.tabs!, '/desk/coaches')?.labelKey, role).toBe('coachSchedules');
    }
  });

  it('lights Tournaments, not Bookings, on a tournament page, for either of them', () => {
    const sec = mgmt.sections!.find((s) => s.key === 'courts')!;
    for (const role of ['owner', 'manager'] as const) {
      for (const path of ['/desk/tournaments', '/desk/tournaments/t1']) {
        expect(sectionForPath(mgmt, path)?.key, `${role} ${path}`).toBe('courts');
        expect(activeNavItem(printed(sec, role), path)?.labelKey, `${role} ${path}`).toBe('tournaments');
      }
    }
  });

  it('keeps the owner’s own rail the owner’s', () => {
    // Every page of the owner's own rail is refused to a manager, Today and
    // Files (0354, management's shared documents) aside.
    for (const item of mgmt.groups.flatMap((g) => g.items)) {
      if (item.unless || item.to === '/files') continue;
      expect(canAccess('manager', item.to), item.to).toBe(false);
    }
  });
});

describe('menu editor tabs', () => {
  // Categories, add-ons and suggested items are tabs of the menu editor but
  // live beside /admin/menu, so the Menu row must claim them explicitly.
  it('keeps the Menu row lit on every tab of the menu editor', () => {
    const menuRow = workspaceItems(WORKSPACES.management).find((i) => i.labelKey === 'menu')!;
    for (const path of ['/admin/menu', '/admin/categories', '/admin/addons', '/admin/suggested']) {
      expect(isNavActive(menuRow, path), path).toBe(true);
    }
    expect(isNavActive(menuRow, '/admin/rates')).toBe(false);
  });
});

describe('Touch Shop desk (0243–0246)', () => {
  const cafe = WORKSPACES.management.sections!.find((s) => s.key === 'cafe')!;

  it('gives owner and manager a Shop row, under Café & shop, that opens the shop desk', () => {
    for (const role of ['owner', 'manager'] as const) {
      expect(printed(cafe, role).find((i) => i.labelKey === 'shop')?.to, role).toBe('/shop');
    }
    expect(workspaceForRoute('/shop')).toBe('shop');
    expect(workspaceForRoute('/shop/products')).toBe('shop');
  });

  it('is its own rail: sell, the drawer, the shop store and the products', () => {
    expect(WORKSPACES.shop.home).toBe('/shop');
    expect(WORKSPACES.shop.groups.flatMap((g) => g.items.map((i) => i.to))).toEqual([
      '/shop', '/shop/drawer', '/shop/stock', '/shop/receive', '/shop/counts',
      '/shop/products', '/shop/suppliers',
    ]);
    // Nothing of the café's till or stock.
    for (const item of workspaceItems(WORKSPACES.shop)) {
      expect(item.to.startsWith('/till') || item.to.startsWith('/stock'), item.to).toBe(false);
    }
  });

  it('keeps the café cashier and the court desk out, and lets management in', () => {
    for (const role of ['cashier', 'court_desk', 'prep', 'waiter'] as const) {
      expect(canAccess(role, '/shop'), role).toBe(false);
    }
    for (const role of ['shop_staff', 'manager', 'owner'] as const) {
      expect(canAccess(role, '/shop'), role).toBe(true);
      expect(canAccess(role, '/shop/products'), role).toBe(true);
    }
    expect(canAccess('shop_staff', '/till')).toBe(false);
    expect(canAccess('shop_staff', '/stock')).toBe(false);
  });

  it('lights one row at a time on the shop rail', () => {
    const rows = WORKSPACES.shop.groups.flatMap((g) => g.items);
    expect(activeNavItem(rows, '/shop')?.labelKey).toBe('shopTill');
    expect(activeNavItem(rows, '/shop/products')?.labelKey).toBe('shopProducts');
    expect(activeNavItem(rows, '/shop/drawer')?.labelKey).toBe('cashDrawer');
  });
});

describe('families (management rebuild, 2026-10-17)', () => {
  const owner = WORKSPACES.management;
  const section = (key: string) => (owner.sections ?? []).find((s) => s.key === key)!;
  const rowNamed = (key: string, label: string) => section(key).items.find((i) => i.labelKey === label)!;

  it('prints one short row per job in each section, with no dropdowns', () => {
    const rows = (key: string) => printed(section(key), 'owner').map((i) => i.labelKey);
    expect(rows('money')).toEqual(['reports', 'cash', 'pay']);
    expect(rows('courts')).toEqual(['bookings', 'tournaments', 'coaches', 'courtSettings']);
    expect(rows('cafe')).toEqual(['tills', 'menu', 'tables', 'shop']);
    expect(rows('stock')).toEqual(['onHand', 'stockMovement', 'stockCounting', 'stockCosts']);
    expect(rows('team')).toEqual(['staff', 'staffActivity', 'attendance', 'fromTeam', 'protocols']);
    expect(rows('customers')).toEqual(['customers', 'loyalty', 'marketing', 'insights', 'guestApp']);
    expect(rows('settings')).toEqual(['branches', 'computersScreens', 'audit']);
  });

  it('opens club details from a branch card only, and keeps Branches lit there', () => {
    const branches = rowNamed('settings', 'branches');
    expect(branches.tabs!.map((t) => t.labelKey)).toEqual(['branches', 'businessDay', 'analyticsSettings']);
    expect(familyRowForPath(owner, '/admin/settings')?.labelKey).toBe('branches');
    expect(activeTab(branches.tabs!, '/admin/settings')).toBeNull();
    // The rows under /admin/settings keep their own light.
    expect(familyRowForPath(owner, '/admin/settings/devices')?.labelKey).toBe('computersScreens');
    expect(familyRowForPath(owner, '/admin/settings/booking')?.labelKey).toBe('courtSettings');
  });

  it('gives every family at least two pages and opens a family on its first', () => {
    for (const sec of owner.sections ?? []) {
      for (const row of sec.items) {
        if (!row.tabs) continue;
        expect(row.tabs.length, `${sec.key} ${row.labelKey}`).toBeGreaterThan(1);
        expect(row.to, `${sec.key} ${row.labelKey}`).toBe(row.tabs[0]!.to);
      }
    }
  });

  it('puts what is paid out under Pay, and every court setting under Court settings', () => {
    const tabs = (sec: string, row: string) => rowNamed(sec, row).tabs?.map((t) => t.labelKey);
    expect(tabs('money', 'pay')).toEqual(['wages', 'billsSuppliers', 'deductions', 'rewards', 'coachPay']);
    expect(tabs('courts', 'courtSettings')).toEqual(['rates', 'genderHours', 'courts', 'bookingRules', 'onlineDeposit', 'openMatches', 'openingHours', 'tournamentRules']);
    expect(tabs('team', 'fromTeam')).toEqual(['requests', 'incidents', 'suggestions']);
    expect(tabs('settings', 'computersScreens')).toContain('kitchenScreens');
    // Every settings page that used to be a panel of Venue settings has a tab.
    const allTabs = new Set((owner.sections ?? []).flatMap((s) => s.items.flatMap((r) => (r.tabs ?? []).map((t) => t.to))));
    // Club details is the exception: a branch card opens it (Sait, 2026-10-18).
    for (const route of SUB_ROUTES['/admin'].filter((r) => r.startsWith('/admin/settings') && r !== '/admin/settings')) {
      expect(allTabs.has(route), route).toBe(true);
    }
  });

  it('finds the family a page belongs to', () => {
    expect(familyRowForPath(owner, '/safe')?.labelKey).toBe('cash');
    expect(familyRowForPath(owner, '/admin/settings/deposit')?.labelKey).toBe('courtSettings');
    expect(familyRowForPath(owner, '/reports/staff')?.labelKey).toBe('staffActivity');
    // A page that stands alone has no family.
    expect(familyRowForPath(owner, '/panel')).toBeNull();
    expect(familyRowForPath(owner, '/observation/courts')).toBeNull();
    expect(familyRowForPath(owner, '/admin/audit')).toBeNull();
    // The cashier's drawer is a row of its own on the till.
    expect(familyRowForPath(WORKSPACES.cashier, '/till/drawer')).toBeNull();
  });

  it('selects the tab the path and its query name, and no tab under one', () => {
    const cash = rowNamed('money', 'cash').tabs!;
    expect(activeTab(cash, '/safe')?.labelKey).toBe('safe');
    expect(activeTab(cash, '/admin/day-close?x=1')?.labelKey).toBe('dayClose');
    // A promotion's editor sits under the Promotions tab, not on it.
    const marketing = rowNamed('customers', 'marketing').tabs!;
    expect(activeTab(marketing, '/admin/promotions')?.labelKey).toBe('promotions');
    expect(activeTab(marketing, '/admin/promotions/new')).toBeNull();
    // Coaches' tabs share a path and differ by ?tab=.
    const coaches = rowNamed('courts', 'coaches').tabs!;
    expect(activeTab(coaches, '/admin/coaches', {})?.labelKey).toBe('coaches');
    expect(activeTab(coaches, '/admin/coaches', { coach: 'c1' })?.labelKey).toBe('coaches');
    expect(activeTab(coaches, '/admin/coaches', { tab: 'types' })?.labelKey).toBe('lessonTypes');
    expect(activeTab(coaches, '/admin/coaches', { tab: 'hours', coach: 'c1' })?.labelKey).toBe('coachHours');
    expect(activeTab(coaches, '/admin/coaches', { tab: 'rules' })?.labelKey).toBe('lessonRules');
  });

  it('sends a family row to the first page the person may open', () => {
    const inbox = rowNamed('team', 'fromTeam');
    expect(rowTarget(inbox, () => true).to).toBe('/observation/requests');
    expect(rowTarget(inbox, (t) => t.to !== '/observation/requests').to).toBe('/incidents');
    const pay = rowNamed('money', 'pay');
    expect(rowTarget(pay, (t) => t.to !== '/wages')).toEqual({ to: '/safe', search: { show: 'payments' } });
    const coaches = rowNamed('courts', 'coaches');
    expect(rowTarget(coaches, (t) => t.labelKey === 'lessonRules')).toEqual({ to: '/admin/coaches', search: { tab: 'rules' } });
    // A plain row goes to its own page.
    expect(rowTarget(rowNamed('settings', 'audit'), () => true).to).toBe('/admin/audit');
  });

  it('keeps online deposits and open matches behind the online-payments condition', () => {
    const courts = rowNamed('courts', 'courtSettings').tabs!;
    expect(courts.filter((t) => t.when === 'onlinePaymentsLive').map((t) => t.to)).toEqual([
      '/admin/settings/deposit',
      '/admin/settings/matches',
    ]);
  });

  it('keeps the owner-only settings pages the owner’s', () => {
    expect(canAccess('manager', '/admin/settings/booking')).toBe(true);
    expect(canAccess('manager', '/admin/settings/analytics')).toBe(false);
    expect(canAccess('manager', '/admin/settings/kitchen')).toBe(false);
    expect(canAccess('owner', '/admin/settings/kitchen')).toBe(true);
  });
});
