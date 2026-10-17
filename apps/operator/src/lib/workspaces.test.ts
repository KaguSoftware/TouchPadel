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
  rowTarget,
  sectionTarget,
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
  it('lets managers and owners enter every floor workspace, own one first', () => {
    expect(workspacesForRole('manager')[0]).toBe('manager');
    expect(workspacesForRole('owner')[0]).toBe('owner');
    expect(workspacesForRole('owner')).toContain('prep');
    expect(defaultWorkspace('owner')).toBe('owner');
  });
  it('leaves the manager and owner lists as they were, plus the shop desk last', () => {
    // The team workspace is not a floor workspace: its one screen is refused
    // to both jokers (ROUTE_ROLES), so neither may switch into it. The Touch
    // Shop desk (0243) is one they open.
    expect(workspacesForRole('manager')).toEqual(['manager', 'courtDesk', 'cashier', 'prep', 'shop']);
    expect(workspacesForRole('owner')).toEqual(['owner', 'manager', 'courtDesk', 'cashier', 'prep', 'shop']);
  });
});

describe('navigation sets', () => {
  it('the prep workspace has no navigation at all (spec §04)', () => {
    expect(WORKSPACES.prep.groups).toHaveLength(0);
  });
  it('the team workspace is one untitled group holding My tasks', () => {
    expect(WORKSPACES.team.home).toBe('/tasks');
    expect(WORKSPACES.team.groups.map((g) => [g.labelKey, g.items.map((i) => [i.to, i.labelKey])])).toEqual([
      [null, [['/tasks', 'myTasks']]],
    ]);
  });
  it('every nav target is a route the workspace owner role may open', () => {
    const roleFor: Record<keyof typeof WORKSPACES, StaffRole> = {
      courtDesk: 'court_desk',
      cashier: 'cashier',
      prep: 'prep',
      // Management and Operations print the same sections (page map,
      // 2026-10-17) and each person sees the rows they may open, so the
      // manager's rail is held to the owner here and to "something to open
      // in every section" under 'the manager rail'.
      manager: 'owner',
      owner: 'owner',
      team: 'driver',
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
    expect(canAccess('manager', WORKSPACES.manager.home)).toBe(true);
    // Every role that holds a workspace can open all of it, not just the one
    // named above.
    for (const role of ['head_barista', 'barista', 'assistant_barista', 'head_chef', 'chef', 'marketing', 'waiter'] as const) {
      for (const key of workspacesForRole(role)) {
        for (const item of workspaceItems(WORKSPACES[key])) expect(canAccess(role, item.to), `${role} → ${item.to}`).toBe(true);
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
    const analytics = WORKSPACES.owner.groups[0]!.items.find((i) => i.labelKey === 'analytics')!;
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
    // A cashier signing in on the same station never inherits the manager rail.
    saveWorkspace('manager');
    expect(loadWorkspace('cashier')).toBe('cashier');
  });
});

describe('workspaceForRoute', () => {
  it('pins single-workspace routes and leaves shared ones alone', () => {
    expect(workspaceForRoute('/kds')).toBe('prep');
    expect(workspaceForRoute('/panel')).toBe('owner');
    expect(workspaceForRoute('/setup')).toBe('owner');
    expect(workspaceForRoute('/analytics')).toBe('owner');
    expect(workspaceForRoute('/analytics/courts')).toBe('owner');
    expect(workspaceForRoute('/ops')).toBe('manager');
    expect(workspaceForRoute('/wages')).toBe('owner');
    expect(workspaceForRoute('/rewards')).toBe('owner');
    // Manager and owner both open it, under Team.
    expect(workspaceForRoute('/attendance')).toBeNull();
    // Eight roles open My tasks in their own workspace (§5.1), so it pins none.
    expect(workspaceForRoute('/tasks')).toBeNull();
    expect(workspaceForRoute('/desk')).toBeNull();
    // Manager and owner share it, so a link in keeps whichever rail is open.
    expect(workspaceForRoute('/protocols')).toBeNull();
    expect(workspaceForRoute('/suggestions')).toBeNull();
    expect(workspaceForRoute('/till/tabs')).toBeNull();
  });
});

describe('sections (page map, 2026-10-17)', () => {
  const owner = WORKSPACES.owner;
  const manager = WORKSPACES.manager;

  it("management's own rail is the Overview, Trends and the assistant, plus one button per part of the club", () => {
    expect(owner.groups).toHaveLength(1);
    // Floor now folded into the Overview (2026-10-17): "Needs you" and the live floor sit on top of it.
    expect(owner.groups[0]!.items.filter((i) => !i.hidden).map((i) => i.to)).toEqual(['/panel', '/analytics', '/assistant']);
    expect(owner.sections?.map((s) => s.key)).toEqual(['money', 'courts', 'cafe', 'stock', 'team', 'customers', 'settings']);
  });

  it('gives the manager the same sections in the same order, under the same names', () => {
    expect(manager.groups.map((g) => [g.labelKey, g.items.map((i) => i.labelKey)])).toEqual([[null, ['today']]]);
    expect(manager.sections?.map((s) => s.key)).toEqual(['money', 'courtsDesk', 'cafeFloor', 'stock', 'team', 'customers', 'settings']);
    // Only Courts and Café & shop differ, in their first row: the owner's
    // view-only boards, the manager's working screens.
    for (const [i, sec] of (manager.sections ?? []).entries()) {
      const theirs = owner.sections![i]!;
      if (sec.key === theirs.key) expect(sec.items, sec.key).toBe(theirs.items);
      else expect(sectionRailItems(sec).slice(1), sec.key).toEqual(sectionRailItems(theirs).slice(1));
    }
  });

  it('every section opens on its own first rail item, so the rail can lead back to it', () => {
    for (const ws of [owner, manager]) {
      for (const section of ws.sections ?? []) {
        expect(section.items[0]!.to, section.key).toBe(section.home);
      }
    }
  });

  it('puts each page where the owner would look first', () => {
    const where = (path: string, search = {}) => sectionForPath(owner, path, search)?.key;
    // Financial: sales, the cash, everything paid out.
    for (const path of ['/reports/revenue', '/reports/courts', '/reports/cafe', '/admin/day-close', '/safe', '/till/drawer', '/wages', '/deductions', '/rewards', '/reports/coaches']) {
      expect(where(path), path).toBe('money');
    }
    // Courts: bookings, every court setting, coaches.
    for (const path of ['/observation/courts', '/admin/rates', '/admin/courts', '/admin/settings/booking', '/admin/hours', '/admin/settings/tournaments', '/admin/coaches']) {
      expect(where(path), path).toBe('courts');
    }
    // Café & shop.
    for (const path of ['/observation/tills', '/admin/menu', '/admin/categories', '/admin/qr', '/shop']) {
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
    expect(sectionForPath(owner, '/panel')).toBeNull();
    expect(sectionForPath(owner, '/observation')).toBeNull();
    expect(sectionForPath(owner, '/ops')).toBeNull();
    expect(sectionForPath(owner, '/analytics/courts')).toBeNull();
    expect(sectionForPath(manager, '/ops')).toBeNull();
  });

  it('opens the main cash under Cash, and the same page showing its payments under Pay', () => {
    const money = owner.sections!.find((s) => s.key === 'money')!;
    expect(activeNavItem(sectionRailItems(money), '/safe')?.labelKey).toBe('cash');
    expect(activeNavItem(sectionRailItems(money), '/safe', { show: 'payments' })?.labelKey).toBe('pay');
    expect(familyRowForPath(owner, '/safe')?.labelKey).toBe('cash');
    expect(familyRowForPath(owner, '/safe', { show: 'payments' })?.labelKey).toBe('pay');
    expect(familyRowForPath(manager, '/safe', { show: 'payments' })?.labelKey).toBe('pay');
    const pay = familyRowForPath(owner, '/safe', { show: 'payments' })!.tabs!;
    expect(activeTab(pay, '/safe', { show: 'payments' })?.labelKey).toBe('billsSuppliers');
  });

  it('keeps the working screens behind the owner’s boards on the owner’s rail', () => {
    // Bookings and the tills are the owner's view-only boards (2026-09-13);
    // their "Open in …" buttons open the desk and the tab board.
    expect(sectionForPath(owner, '/desk/today')?.key).toBe('courts');
    expect(sectionForPath(owner, '/till/tabs')?.key).toBe('cafe');
    expect(sectionForPath(manager, '/desk/today')?.key).toBe('courtsDesk');
    expect(sectionForPath(manager, '/till/tabs')?.key).toBe('cafeFloor');
    // The drawer is money: an activePrefix of '/till' on the tabs would light both.
    expect(sectionForPath(owner, '/till/drawer')?.key).toBe('money');
    // The old overviews still open from links, and keep a rail.
    expect(sectionForPath(owner, '/financial')?.key).toBe('money');
    expect(sectionForPath(owner, '/setup')?.key).toBe('settings');
  });

  it('hides only the screens a link or a drill-through still lands on', () => {
    const hidden = (ws: typeof owner) =>
      [...ws.groups.flatMap((g) => g.items), ...(ws.sections ?? []).flatMap((s) => s.items)].filter((i) => i.hidden).map((i) => i.to);
    expect(hidden(owner)).toEqual(['/ops', '/financial', '/desk', '/till/tabs', '/setup']);
    expect(hidden(manager)).toEqual(['/financial', '/setup']);
  });

  it('never lists one page twice on a rail', () => {
    for (const ws of [owner, manager]) {
      const seen = new Set<string>();
      for (const sec of ws.sections ?? []) {
        for (const row of sec.items) {
          if (row.hidden) continue;
          for (const page of row.tabs ?? [{ to: row.to, labelKey: row.labelKey } as NavTab]) {
            const id = `${page.to}?${new URLSearchParams(page.search ?? {}).toString()}`;
            expect(seen.has(id), `${ws.key} ${id}`).toBe(false);
            seen.add(id);
          }
        }
      }
    }
  });

  it('leaves no /reports child stranded outside a section', () => {
    for (const path of ['/reports/revenue', '/reports/courts', '/reports/cafe', '/reports/stock', '/reports/staff', '/reports/coaches']) {
      expect(sectionForPath(owner, path), path).not.toBeNull();
      expect(sectionForPath(manager, path), path).not.toBeNull();
    }
  });
});

describe('workspaceOwnsPath', () => {
  it("keeps management on /ops, which is also the manager's home", () => {
    expect(workspaceOwnsPath('owner', '/ops')).toBe(true);
    expect(workspaceOwnsPath('owner', '/admin/staff')).toBe(true);
    expect(workspaceOwnsPath('owner', '/stock/counts')).toBe(true);
    expect(workspaceOwnsPath('owner', '/analytics/cafe')).toBe(true);
    // /kds is nowhere on the owner's rail: following that link does hand the
    // shell over to the prep workspace.
    expect(workspaceOwnsPath('owner', '/kds')).toBe(false);
    expect(workspaceOwnsPath('manager', '/panel')).toBe(false);
    expect(workspaceOwnsPath('team', '/tasks')).toBe(true);
    expect(workspaceOwnsPath('courtDesk', '/tasks')).toBe(true);
    expect(workspaceOwnsPath('cashier', '/tasks')).toBe(true);
    expect(workspaceOwnsPath('owner', '/tasks')).toBe(false);
    // Protocols is on both management rails, so a link in keeps either.
    expect(workspaceOwnsPath('owner', '/protocols')).toBe(true);
    expect(workspaceOwnsPath('manager', '/protocols')).toBe(true);
  });
});

describe('the manager rail', () => {
  const manager = WORKSPACES.manager;

  it('has something a manager may open in every section, and opens the first of it', () => {
    const canOpen = (to: string) => canAccess('manager', to);
    for (const sec of manager.sections ?? []) {
      const target = sectionTarget(sec, (row) => (row.tabs?.length ? row.tabs.some((t) => canOpen(t.to)) : canOpen(row.to)), (t) => canOpen(t.to));
      expect(target, sec.key).not.toBeNull();
      expect(canOpen(target!.to), `${sec.key} → ${target!.to}`).toBe(true);
    }
    // Money in is the owner's: the manager's Financial opens on Court sales.
    const money = manager.sections!.find((s) => s.key === 'money')!;
    expect(sectionTarget(money, () => true, (t) => canOpen(t.to))?.to).toBe('/reports/courts');
  });

  it('works in the desk and the tab board, not the owner’s view-only boards', () => {
    const rail = (key: string) => sectionRailItems(manager.sections!.find((s) => s.key === key)!).map((i) => i.to);
    expect(rail('courtsDesk')[0]).toBe('/desk');
    expect(rail('cafeFloor')[0]).toBe('/till/tabs');
    expect(rail('courtsDesk')).not.toContain('/observation/courts');
    expect(rail('cafeFloor')).not.toContain('/observation/tills');
  });

  it('keeps the owner’s own rail the owner’s', () => {
    // Every page of the owner's own rail is refused to a manager.
    for (const item of WORKSPACES.owner.groups.flatMap((g) => g.items)) {
      if (item.to === '/ops') continue;
      expect(canAccess('manager', item.to), item.to).toBe(false);
    }
  });
});

describe('menu editor tabs', () => {
  // Categories, add-ons and suggested items are tabs of the menu editor but
  // live beside /admin/menu, so the Menu row must claim them explicitly.
  it('keeps the Menu row lit on every tab of the menu editor', () => {
    const menuRow = workspaceItems(WORKSPACES.manager).find((i) => i.labelKey === 'menu')!;
    for (const path of ['/admin/menu', '/admin/categories', '/admin/addons', '/admin/suggested']) {
      expect(isNavActive(menuRow, path), path).toBe(true);
    }
    expect(isNavActive(menuRow, '/admin/rates')).toBe(false);
  });
});

describe('Touch Shop desk (0243–0246)', () => {
  const ownerCafe = WORKSPACES.owner.sections!.find((s) => s.key === 'cafe')!;
  const managerCafe = WORKSPACES.manager.sections!.find((s) => s.key === 'cafeFloor')!;

  it('gives owner and manager a Shop row, under Café & shop, that opens the shop desk', () => {
    expect(ownerCafe.items.find((i) => i.labelKey === 'shop')?.to).toBe('/shop');
    expect(managerCafe.items.find((i) => i.labelKey === 'shop')?.to).toBe('/shop');
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
  const owner = WORKSPACES.owner;
  const section = (key: string) => (owner.sections ?? []).find((s) => s.key === key)!;
  const rowNamed = (key: string, label: string) => section(key).items.find((i) => i.labelKey === label)!;

  it('prints one short row per job in each section, with no dropdowns', () => {
    const rows = (key: string) => sectionRailItems(section(key)).map((i) => i.labelKey);
    expect(rows('money')).toEqual(['reports', 'cash', 'pay']);
    expect(rows('courts')).toEqual(['bookings', 'coaches', 'courtSettings']);
    expect(rows('cafe')).toEqual(['tills', 'menu', 'tables', 'shop']);
    expect(rows('stock')).toEqual(['onHand', 'stockMovement', 'stockCounting', 'stockCosts']);
    expect(rows('team')).toEqual(['staff', 'staffActivity', 'attendance', 'fromTeam', 'protocols']);
    expect(rows('customers')).toEqual(['customers', 'loyalty', 'marketing', 'guestApp']);
    expect(rows('settings')).toEqual(['venue', 'branches', 'computersScreens', 'audit']);
  });

  it('gives every family at least two pages and opens a family on its first', () => {
    for (const ws of [WORKSPACES.owner, WORKSPACES.manager]) {
      for (const sec of ws.sections ?? []) {
        for (const row of sec.items) {
          if (!row.tabs) continue;
          expect(row.tabs.length, `${sec.key} ${row.labelKey}`).toBeGreaterThan(1);
          expect(row.to, `${sec.key} ${row.labelKey}`).toBe(row.tabs[0]!.to);
        }
      }
    }
  });

  it('puts what is paid out under Pay, and every court setting under Court settings', () => {
    const tabs = (sec: string, row: string) => rowNamed(sec, row).tabs?.map((t) => t.labelKey);
    expect(tabs('money', 'pay')).toEqual(['wages', 'billsSuppliers', 'deductions', 'rewards', 'coachPay']);
    expect(tabs('courts', 'courtSettings')).toEqual(['rates', 'courts', 'bookingRules', 'onlineDeposit', 'openMatches', 'openingHours', 'tournamentRules']);
    expect(tabs('team', 'fromTeam')).toEqual(['requests', 'incidents', 'suggestions']);
    expect(tabs('settings', 'computersScreens')).toContain('kitchenScreens');
    // Every settings page that used to be a panel of Venue settings has a tab.
    const allTabs = new Set((owner.sections ?? []).flatMap((s) => s.items.flatMap((r) => (r.tabs ?? []).map((t) => t.to))));
    for (const route of SUB_ROUTES['/admin'].filter((r) => r.startsWith('/admin/settings'))) {
      expect(allTabs.has(route), route).toBe(true);
    }
  });

  it('finds the family a page belongs to, on either management rail', () => {
    expect(familyRowForPath(owner, '/safe')?.labelKey).toBe('cash');
    expect(familyRowForPath(owner, '/admin/settings/deposit')?.labelKey).toBe('courtSettings');
    expect(familyRowForPath(owner, '/reports/staff')?.labelKey).toBe('staffActivity');
    expect(familyRowForPath(WORKSPACES.manager, '/safe')?.labelKey).toBe('cash');
    expect(familyRowForPath(WORKSPACES.manager, '/reports/staff')?.labelKey).toBe('staffActivity');
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
