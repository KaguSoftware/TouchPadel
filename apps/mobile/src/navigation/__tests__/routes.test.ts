import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * The back button in this app is UIKit's own on every screen, and that rests on
 * ONE structural property: a pushed screen must live on the ROOT stack.
 *
 * A screen inside a nested group is the first entry of its own stack when it is
 * pushed from elsewhere, so `canGoBack` is false there, UIKit draws no back
 * item, and the app has to hand-draw one — which is exactly the inconsistency
 * this layout was flattened to remove. These tests fail if a route is added
 * back into a group, or if a route file is moved without its push sites
 * following, so the property cannot regress silently.
 */

const APP = join(__dirname, '..', '..', '..', 'app');
const SRC = join(__dirname, '..', '..');

/**
 * Route groups that legitimately remain: the tabs, which draw their own bar, and
 * the flows pushed from the tabs that run in a stack of their own (owner,
 * 2026-10-09): (tournaments) and (coaching). A root-stack screen's back item is
 * UIKit's shared bar's, which trails the page on a fast swipe back to the tabs;
 * the owner wants these flows' bar to leave WITH the page at any speed, which
 * only a bar owned by the page (a nested stack) can do. Each group's first screen
 * gets a native UIBarButtonItem with the system chevron instead of the back item
 * (src/navigation/groupStack.tsx). Nothing else may follow without the owner.
 */
const ALLOWED_GROUPS = new Set(['(tabs)', '(tournaments)', '(coaching)']);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx') || name.endsWith('.ts')) out.push(p);
  }
  return out;
}

const routeFiles = walk(APP);

/** APP-relative, '/'-separated regardless of platform (join() emits '\' on Windows). */
const rel = (f: string): string =>
  f
    .slice(APP.length + 1)
    .split(sep)
    .join('/');

describe('route layout', () => {
  it('keeps no route group except (tabs) and the nested-flow exceptions', () => {
    const groups = new Set<string>();
    for (const f of routeFiles) {
      for (const seg of rel(f).split('/')) {
        if (seg.startsWith('(') && seg.endsWith(')')) groups.add(seg);
      }
    }
    for (const g of groups) expect(ALLOWED_GROUPS.has(g), `unexpected route group ${g}`).toBe(true);
  });

  it('has the online deposit routes and the not-found screen on the root stack', () => {
    // build-contracts-2026-09-27 §4: the return link lands on pay/return, which
    // hands the ref to pay/status; any unknown link renders +not-found. `pay/`
    // is a plain directory, not a group and not a nested stack (no _layout),
    // so both payment screens are root-stack pushes with the native back item.
    const files = routeFiles.map(rel);
    expect(files).toContain('pay/return.tsx');
    expect(files).toContain('pay/status.tsx');
    expect(files).toContain('+not-found.tsx');
    expect(files.filter((f) => f.startsWith('pay/') && f.endsWith('_layout.tsx'))).toEqual([]);
  });

  it('has no layout that hides a pushed screen behind a nested stack', () => {
    // A `_layout` outside (tabs) would reintroduce a nested navigator, and with
    // it the screens whose back item UIKit refuses to draw.
    const layouts = routeFiles.map(rel).filter((f) => f.endsWith('_layout.tsx'));
    // (coaching) and (tournaments) are the documented exceptions (ALLOWED_GROUPS above).
    expect(layouts.sort()).toEqual([
      '(coaching)/_layout.tsx',
      '(tabs)/_layout.tsx',
      '(tournaments)/_layout.tsx',
      '_layout.tsx',
    ]);
  });
});

describe('navigation targets', () => {
  const sources = [...routeFiles, ...walk(SRC)].filter((f) => !f.includes('__tests__'));

  /** Every literal path passed to router.push/replace/navigate across the app. */
  const targets = new Set<string>();
  for (const f of sources) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(
      /router\.(?:push|replace|navigate|dismissTo)\(\s*\{?\s*(?:pathname:\s*)?'([^']+)'/g,
    )) {
      const path = m[1];
      if (path && path.startsWith('/')) targets.add(path);
    }
  }

  it('finds the navigation calls it means to check', () => {
    // Guards the regex itself: a silent zero would make every assertion vacuous.
    expect(targets.size).toBeGreaterThan(8);
  });

  it('checks the payment screen as a navigation target', () => {
    // Review and "Try again" replace to it, the resume hooks and My
    // reservations push it, and the return link dismisses to it.
    expect(targets.has('/pay/status')).toBe(true);
  });

  it('points every push at a route that exists', () => {
    const routes = new Set(
      routeFiles
        .map((f) => rel(f).replace(/\.tsx?$/, ''))
        .filter((r) => !r.endsWith('_layout'))
        .map((r) => '/' + r.replace(/\/index$/, '')),
    );
    // A non-tab group adds nothing to the URL: (coaching)/coaches is `/coaches`.
    for (const r of [...routes]) {
      const bare = r.replace(/\/\((?!tabs\))[^)]+\)/g, '');
      if (bare !== r) routes.add(bare);
    }
    // `/` and `/(tabs)` resolve to the tab group's own index.
    routes.add('/');
    routes.add('/(tabs)');

    for (const t of targets) {
      expect(routes.has(t), `${t} has no route file`).toBe(true);
    }
  });

  it('no longer points at the flattened (auth) / (gated) groups', () => {
    for (const t of targets) {
      expect(t.includes('(auth)'), `${t} still uses the removed (auth) group`).toBe(false);
      expect(t.includes('(gated)'), `${t} still uses the removed (gated) group`).toBe(false);
    }
  });
});
