import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SMOKE_ROUTES } from '../../smoke/routes';

/**
 * EVERY ROUTE HAS A SMOKE CASE, OR THIS FAILS.
 *
 * The smoke suite is only worth what it covers. A new screen added to `app/`
 * with no case would leave the suite green and the screen untested — and
 * because nothing else in this repo renders a component, nobody would find out
 * until it was opened on a device. So the route table is checked-in data
 * (`src/smoke/routes.ts`) and this walks the real directory against it, in
 * both directions: a route with no entry fails, and an entry naming a file
 * that no longer exists fails too.
 *
 * AND THEN THE SUITES AGAINST THE TABLE. An entry in the table is a promise
 * that a suite renders that route; the first version of this file took the
 * promise on trust, so a route could be tabled and never cased. Now every
 * `src/smoke/*.smoke.test.tsx` is read as text and each table route must be
 * named — `route: '<name>'` — by exactly one of them. Text, not import: the
 * suites import react-native, which this runner cannot load (below).
 *
 * VITEST, IN PLAIN NODE — the same runner as `routes.test.ts` beside it, and
 * the same walk. `src/smoke/routes.ts` is deliberately a strings-only module
 * with no react-native import so it can be read here; the components live in
 * the `*.smoke.test.tsx` files, which this reads but never executes.
 */
const APP = join(__dirname, '..', '..', '..', 'app');
const SMOKE = join(__dirname, '..', '..', 'smoke');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

/** APP-relative, '/'-separated regardless of platform (`join` emits '\' on Windows). */
const rel = (f: string): string => f.slice(APP.length + 1).split(sep).join('/');

const routeFiles = walk(APP).map(rel).sort();
const tabled = SMOKE_ROUTES.map((r) => r.file).sort();

/**
 * The route names each suite mentions, from its source. Two spellings are
 * accepted: a case row (`route: 'sign-in'`) and the layout suite's lookup
 * (`r.route === 'app'`). Anything else — a route name inside a comment, a
 * testID that happens to start with one — is not a reference.
 */
const REFERENCE = /\broute(?::|\s*===)\s*'([^']+)'/g;

const suiteFiles = readdirSync(SMOKE)
  .filter((n) => n.endsWith('.smoke.test.tsx'))
  .sort();

const referencedBy = new Map<string, string[]>();
for (const name of suiteFiles) {
  const src = readFileSync(join(SMOKE, name), 'utf8');
  const seen = new Set<string>();
  for (const m of src.matchAll(REFERENCE)) seen.add(m[1]!);
  for (const route of seen) referencedBy.set(route, [...(referencedBy.get(route) ?? []), name]);
}

describe('smoke coverage', () => {
  it('has a case for every route file under app/', () => {
    const missing = routeFiles.filter((f) => !tabled.includes(f));
    expect(
      missing,
      `add these to src/smoke/routes.ts and give each a case: ${missing.join(', ')}`,
    ).toEqual([]);
  });

  it('names no route that has been deleted or moved', () => {
    const stale = tabled.filter((f) => !routeFiles.includes(f));
    expect(stale, `stale entries in src/smoke/routes.ts: ${stale.join(', ')}`).toEqual([]);
  });

  it('gives every route a distinct name and a primary id under it', () => {
    const names = SMOKE_ROUTES.map((r) => r.route);
    expect(new Set(names).size).toBe(names.length);
    for (const r of SMOKE_ROUTES) {
      // The convention: `<route>.<element>`, so a primary that does not start
      // with its own route is a copy-paste from the screen above it.
      expect(r.primary.startsWith(`${r.route}.`), `${r.route} → ${r.primary}`).toBe(true);
    }
  });

  it('lists nothing as todo without a reason', () => {
    for (const r of SMOKE_ROUTES) {
      if ('todo' in r) expect(typeof r.todo === 'string' && r.todo.length > 0).toBe(true);
    }
  });

  it('found the suites it is about to check', () => {
    // A renamed directory or extension would otherwise make the next test
    // pass vacuously with "every route is referenced by exactly one of zero".
    expect(suiteFiles.length).toBeGreaterThan(0);
  });

  it('is referenced by exactly one smoke suite per table route', () => {
    const problems: string[] = [];
    for (const r of SMOKE_ROUTES) {
      const files = referencedBy.get(r.route) ?? [];
      if (files.length !== 1) {
        problems.push(
          `${r.route}: ${files.length === 0 ? 'no suite' : files.join(' and ')}`,
        );
      }
    }
    expect(
      problems,
      `each route in src/smoke/routes.ts must be cased in exactly one src/smoke/*.smoke.test.tsx: ${problems.join('; ')}`,
    ).toEqual([]);
  });

  it('has no suite naming a route that is not in the table', () => {
    const tabledNames = new Set(SMOKE_ROUTES.map((r) => r.route));
    const unknown = [...referencedBy.keys()].filter((route) => !tabledNames.has(route));
    expect(unknown, `add to src/smoke/routes.ts: ${unknown.join(', ')}`).toEqual([]);
  });
});
