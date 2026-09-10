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

/** Route groups that legitimately remain: only the tabs, which draw their own bar. */
const ALLOWED_GROUPS = new Set(['(tabs)']);

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
const rel = (f: string): string => f.slice(APP.length + 1).split(sep).join('/');

describe('route layout', () => {
  it('keeps no route group except (tabs)', () => {
    const groups = new Set<string>();
    for (const f of routeFiles) {
      for (const seg of rel(f).split('/')) {
        if (seg.startsWith('(') && seg.endsWith(')')) groups.add(seg);
      }
    }
    for (const g of groups) expect(ALLOWED_GROUPS.has(g), `unexpected route group ${g}`).toBe(true);
  });

  it('has no layout that hides a pushed screen behind a nested stack', () => {
    // A `_layout` outside (tabs) would reintroduce a nested navigator, and with
    // it the screens whose back item UIKit refuses to draw.
    const layouts = routeFiles.map(rel).filter((f) => f.endsWith('_layout.tsx'));
    expect(layouts.sort()).toEqual(['(tabs)/_layout.tsx', '_layout.tsx']);
  });
});

describe('navigation targets', () => {
  const sources = [...routeFiles, ...walk(SRC)].filter((f) => !f.includes('__tests__'));

  /** Every literal path passed to router.push/replace/navigate across the app. */
  const targets = new Set<string>();
  for (const f of sources) {
    const text = readFileSync(f, 'utf8');
    for (const m of text.matchAll(/router\.(?:push|replace|navigate)\(\s*\{?\s*(?:pathname:\s*)?'([^']+)'/g)) {
      const path = m[1];
      if (path && path.startsWith('/')) targets.add(path);
    }
  }

  it('finds the navigation calls it means to check', () => {
    // Guards the regex itself: a silent zero would make every assertion vacuous.
    expect(targets.size).toBeGreaterThan(8);
  });

  it('points every push at a route that exists', () => {
    const routes = new Set(
      routeFiles
        .map((f) => rel(f).replace(/\.tsx?$/, ''))
        .filter((r) => !r.endsWith('_layout'))
        .map((r) => '/' + r.replace(/\/index$/, '')),
    );
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
