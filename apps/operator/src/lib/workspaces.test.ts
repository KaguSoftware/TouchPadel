import { describe, expect, it, beforeEach } from 'vitest';
import {
  WORKSPACES,
  defaultWorkspace,
  isNavActive,
  loadWorkspace,
  saveWorkspace,
  workspaceForRoute,
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
      for (const group of ws.groups) {
        for (const item of group.items) {
          expect(canAccess(roleFor[ws.key], item.to), `${ws.key} → ${item.to}`).toBe(true);
        }
      }
      expect(canAccess(roleFor[ws.key], ws.home), `${ws.key} home`).toBe(true);
    }
  });
  it('every route prefix in ROUTE_ROLES is reachable from at least one rail or is a shell route', () => {
    const targets = new Set(
      Object.values(WORKSPACES).flatMap((ws) => ws.groups.flatMap((g) => g.items.map((i) => i.to))),
    );
    // Telegram lives in the admin sub-nav (System group), not on a rail.
    const shell = new Set(['/workspaces', '/kds', '/reports', '/reports/revenue', '/desk/customers/new', '/admin/telegram']);
    for (const prefix of Object.keys(ROUTE_ROLES)) {
      const covered =
        shell.has(prefix) || [...targets].some((t) => t === prefix || t.startsWith(`${prefix}/`) || prefix.startsWith(`${t}/`));
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
    expect(workspaceForRoute('/ops')).toBe('manager');
    expect(workspaceForRoute('/desk')).toBeNull();
    expect(workspaceForRoute('/till/tabs')).toBeNull();
  });
});
