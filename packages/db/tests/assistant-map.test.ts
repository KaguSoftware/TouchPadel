/**
 * The assistant's system map is GENERATED from the code (plan §3.2). Two
 * properties, no database:
 *
 *   1. Staleness — regenerating the map in memory equals the committed fixture
 *      chunk for chunk. A new route, RPC, table comment or catalog string that
 *      lands without `pnpm --filter @touch/db assistant:map` fails here, the
 *      same discipline check-rpc-registry.mjs applies to grants.
 *   2. Every route has a sentence — every ROUTE_ROLES key, SUB_ROUTES child and
 *      rail row in lib/workspaces.ts has a page chunk whose first line is the
 *      hand-written sentence from docs/design/assistant/pages.md.
 *
 * `generated_from` (the git sha) is deliberately NOT compared: it changes with
 * every commit while the chunks do not.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import * as catalog from '../../core/src/assistant/tools';
import {
  CHUNK_KINDS,
  COMPACT_BYTE_TARGET,
  PATHS,
  buildMap,
  inventoryRail,
  inventoryRoutes,
  readPages,
  renderCompact,
} from '../scripts/build-assistant-map.mjs';

interface Chunk {
  kind: string;
  ref: string;
  lang: 'en' | 'ar';
  title: string;
  body: string;
  route: string | null;
}
interface MapFile {
  generated_from: string;
  chunks: Chunk[];
}

const fixture = JSON.parse(readFileSync(PATHS.mapJson, 'utf8')) as MapFile;
const built = await buildMap({ catalog, sha: fixture.generated_from });

describe('assistant-map.json', () => {
  it('is not stale: regenerating from the code gives the same chunks', () => {
    const fresh = built.chunks as Chunk[];
    expect(fresh.length, 'chunk count').toBe(fixture.chunks.length);
    // Compare by ref+lang first so a failure names the chunk rather than a byte offset.
    const key = (c: Chunk) => `${c.kind}|${c.ref}|${c.lang}`;
    expect(fresh.map(key)).toEqual(fixture.chunks.map(key));
    for (let i = 0; i < fresh.length; i++) {
      const a = fresh[i]!;
      const b = fixture.chunks[i]!;
      if (a.title !== b.title || a.body !== b.body || a.route !== b.route) {
        expect.fail(`chunk ${key(a)} differs from the fixture — run: pnpm --filter @touch/db assistant:map`);
      }
    }
  });

  it('carries every chunk kind the plan lists, and nothing else', () => {
    const kinds = new Set(fixture.chunks.map((c) => c.kind));
    for (const k of CHUNK_KINDS) expect(kinds.has(k), `kind ${k} present`).toBe(true);
    for (const k of kinds) expect(CHUNK_KINDS).toContain(k);
  });

  it('has no duplicate (kind, ref, lang)', () => {
    const seen = new Set<string>();
    for (const c of fixture.chunks) {
      const k = `${c.kind}|${c.ref}|${c.lang}`;
      expect(seen.has(k), `duplicate ${k}`).toBe(false);
      seen.add(k);
    }
  });

  it('keeps every chunk body within the 2,000-character cap for docs and labels', () => {
    for (const c of fixture.chunks) {
      if (c.kind === 'doc' || c.kind === 'label') expect(c.body.length, c.ref).toBeLessThanOrEqual(2000 + 200);
    }
  });
});

describe('every route has a sentence', () => {
  const { routeRoles, subRoutes } = inventoryRoutes();
  const rail = inventoryRail();
  const routes = new Set<string>([...routeRoles.keys(), ...[...subRoutes.values()].flat()]);
  for (const ws of rail.workspaces) {
    for (const g of ws.groups) for (const it of g.items) routes.add(it.to);
    for (const s of ws.sections) for (const it of s.items) routes.add(it.to);
  }
  const pages = readPages();
  const pageChunks = new Map(fixture.chunks.filter((c) => c.kind === 'page').map((c) => [c.route, c]));

  it.each([...routes].sort())('%s', (route) => {
    const sentence = pages.get(route);
    expect(sentence, `pages.md line for ${route}`).toBeTruthy();
    expect(sentence!.length).toBeGreaterThan(40);
    const chunk = pageChunks.get(route);
    expect(chunk, `page chunk for ${route}`).toBeTruthy();
    expect(chunk!.body.split('\n')[0]).toBe(sentence);
    expect(chunk!.body).toMatch(/^Roles: /m);
  });

  it('every catalog tool with a route points at a page that exists or is the assistant\'s own', () => {
    for (const t of catalog.ASSISTANT_TOOLS) {
      if (!t.route) continue;
      if (t.route.startsWith('/assistant')) continue; // Lane D's page; not in ROUTE_ROLES yet
      const known = [...pageChunks.keys()].some((r) => r === t.route || t.route!.startsWith(`${r}/`));
      expect(known, `tool ${t.name} route ${t.route}`).toBe(true);
    }
  });
});

describe('compact prefix', () => {
  it('stays under the byte target and lists every page, rule and tool', () => {
    const compact = renderCompact(built);
    expect(Buffer.byteLength(compact)).toBeLessThanOrEqual(COMPACT_BYTE_TARGET);
    expect(compact).toBe(readFileSync(PATHS.compact, 'utf8'));
    for (const c of fixture.chunks) {
      if (c.kind === 'page') expect(compact).toContain(`- ${c.route} [`);
      if (c.kind === 'rule') expect(compact).toContain(`### ${c.title}`);
    }
    for (const t of catalog.ASSISTANT_TOOLS) expect(compact).toMatch(new RegExp(`^${t.name} — `, 'm'));
  });
});
