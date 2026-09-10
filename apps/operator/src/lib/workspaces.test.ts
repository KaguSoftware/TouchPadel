import { describe, expect, it, beforeEach } from 'vitest';
import {
  WORKSPACES,
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
} from './workspaces';
import { ROUTE_ROLES, canAccess, type StaffRole } from './auth';

describe('workspacesForRole', () => {
  it('gives single-role staff exactly their own workspace', () => {
    expect(workspacesForRole('cashier')).toEqual(['cashier']);
    expect(workspacesForRole('prep')).toEqual(['prep']);
    expect(workspacesForRole('court_desk')).toEqual(['courtDesk']);
  });
  it('lets managers and owners enter every floor workspace, own one first', () => {
    expect(workspacesForRole('manager')[0]).toBe('manager');
    expect(workspacesForRole('owner')[0]).toBe('owner');
    expect(workspacesForRole('owner')).toContain('prep');
    expect(defaultWorkspace('owner')).toBe('owner');
  });
});

describe('navigation sets', () => {
  it('the prep workspace has no navigation at all (spec §04)', () => {
    expect(WORKSPACES.prep.groups).toHaveLength(0);
  });
  it('every nav target is a route the workspace owner role may open', () => {
    const roleFor: Record<keyof typeof WORKSPACES, StaffRole> = {
      courtDesk: 'court_desk',
      cashier: 'cashier',
      prep: 'prep',
      manager: 'manager',
      owner: 'owner',
    };
    for (const ws of Object.values(WORKSPACES)) {
      for (const item of workspaceItems(ws)) {
        expect(canAccess(roleFor[ws.key], item.to), `${ws.key} → ${item.to}`).toBe(true);
      }
      for (const section of ws.sections ?? []) {
        expect(canAccess(roleFor[ws.key], section.home), `${ws.key} → ${section.key} home`).toBe(
          true,
        );
      }
      expect(canAccess(roleFor[ws.key], ws.home), `${ws.key} home`).toBe(true);
    }
  });
  it('every route prefix in ROUTE_ROLES is reachable from at least one rail or is a shell route', () => {
    const targets = new Set(
      Object.values(WORKSPACES).flatMap((ws) => workspaceItems(ws).map((i) => i.to)),
    );
    // Telegram lives in the admin sub-nav (System group), not on a rail.
    const shell = new Set([
      '/workspaces',
      '/kds',
      '/reports',
      '/reports/revenue',
      '/desk/customers/new',
      '/admin/telegram',
    ]);
    for (const prefix of Object.keys(ROUTE_ROLES)) {
      const covered =
        shell.has(prefix) ||
        [...targets].some(
          (t) => t === prefix || t.startsWith(`${prefix}/`) || prefix.startsWith(`${t}/`),
        );
      expect(covered, prefix).toBe(true);
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
    expect(workspaceForRoute('/ops')).toBe('manager');
    expect(workspaceForRoute('/desk')).toBeNull();
    expect(workspaceForRoute('/till/tabs')).toBeNull();
  });
});

describe('sections', () => {
  const owner = WORKSPACES.owner;

  it("management's own rail is the panel plus one button per section", () => {
    expect(owner.groups).toHaveLength(1);
    // Reports and analytics left the top level: each now sits in the section
    // that owns the question it answers.
    expect(owner.groups[0]!.items.map((i) => i.to)).toEqual(['/panel']);
    expect(owner.sections?.map((s) => s.key)).toEqual(['financial', 'observation', 'setup']);
  });

  it('every section opens on its own first rail item, so the rail can lead back to it', () => {
    for (const section of owner.sections ?? []) {
      expect(section.items[0]!.to, section.key).toBe(section.home);
    }
  });

  it('splits money from observation', () => {
    expect(sectionForPath(owner, '/financial')?.key).toBe('financial');
    expect(sectionForPath(owner, '/reports/revenue')?.key).toBe('financial');
    expect(sectionForPath(owner, '/admin/day-close')?.key).toBe('financial');
    expect(sectionForPath(owner, '/till/drawer')?.key).toBe('financial');

    expect(sectionForPath(owner, '/observation')?.key).toBe('observation');
    expect(sectionForPath(owner, '/observation/requests')?.key).toBe('observation');
    expect(sectionForPath(owner, '/marketing')?.key).toBe('observation');
    expect(sectionForPath(owner, '/ops')?.key).toBe('observation');
    expect(sectionForPath(owner, '/analytics')?.key).toBe('observation');
    // Bookings and tills are section screens even though other workspaces own them too.
    expect(sectionForPath(owner, '/desk/today')?.key).toBe('observation');
    expect(sectionForPath(owner, '/till/tabs')?.key).toBe('observation');

    expect(sectionForPath(owner, '/setup')?.key).toBe('setup');
    expect(sectionForPath(owner, '/admin/settings/trading')?.key).toBe('setup');

    // The workspace's own row is not in any section.
    expect(sectionForPath(owner, '/panel')).toBeNull();
    // A workspace without sections never claims anything.
    expect(sectionForPath(WORKSPACES.manager, '/ops')).toBeNull();
  });

  it('keeps the two till screens in different sections', () => {
    // The drawer is money and the tabs are observation; an activePrefix of
    // '/till' on either would light both rails at once.
    expect(sectionForPath(owner, '/till/drawer')?.key).toBe('financial');
    expect(sectionForPath(owner, '/till/tabs')?.key).toBe('observation');
  });

  it('never lets two sections claim the same screen', () => {
    const seen = new Map<string, string>();
    for (const section of owner.sections ?? []) {
      for (const item of section.items) {
        expect(
          seen.has(item.to),
          `${item.to} in both ${seen.get(item.to)} and ${section.key}`,
        ).toBe(false);
        seen.set(item.to, section.key);
      }
    }
  });

  it('hides the screens that are opened from inside another screen', () => {
    const observation = (owner.sections ?? []).find((s) => s.key === 'observation')!;
    const hidden = observation.items.filter((i) => i.hidden).map((i) => i.to);
    // Promotions and Telegram are reached from the marketing panel.
    expect(hidden).toEqual(['/admin/promotions', '/admin/telegram']);
    // Hidden rows never print...
    expect(sectionRailItems(observation).map((i) => i.to)).not.toContain('/admin/promotions');
    // ...but the section still owns them, so the rail survives the trip.
    expect(sectionForPath(owner, '/admin/promotions')?.key).toBe('observation');
    expect(workspaceOwnsPath('owner', '/admin/promotions')).toBe(true);
  });

  it('leaves no /reports child stranded outside a section', () => {
    for (const path of [
      '/reports/revenue',
      '/reports/courts',
      '/reports/cafe',
      '/reports/stock',
      '/reports/staff',
    ]) {
      expect(sectionForPath(owner, path), path).not.toBeNull();
    }
  });
});

describe('workspaceOwnsPath', () => {
  it("keeps management on /ops, which is also the manager's home", () => {
    expect(workspaceOwnsPath('owner', '/ops')).toBe(true);
    expect(workspaceOwnsPath('owner', '/admin/staff')).toBe(true);
    // /kds is nowhere on the owner's rail: following that link does hand the
    // shell over to the prep workspace.
    expect(workspaceOwnsPath('owner', '/kds')).toBe(false);
    expect(workspaceOwnsPath('manager', '/panel')).toBe(false);
  });
});
