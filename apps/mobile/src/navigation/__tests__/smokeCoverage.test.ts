import { readdirSync, statSync } from 'node:fs';
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
 * VITEST, IN PLAIN NODE — the same runner as `routes.test.ts` beside it, and
 * the same walk. `src/smoke/routes.ts` is deliberately a strings-only module
 * with no react-native import so it can be read here; the components live in
 * the `*.smoke.test.tsx` files, which this never touches.
 */
const APP = join(__dirname, '..', '..', '..', 'app');

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
});
