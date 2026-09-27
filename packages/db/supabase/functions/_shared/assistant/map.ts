/**
 * map.ts — the system map at the edge (plan §3.2, contracts "map.ts").
 * Deno-only because of the JSON import attribute; `map.json` is written by
 * Lane B's `scripts/build-assistant-map.mjs` next to the committed fixture
 * (`packages/db/fixtures/assistant-map.json`): the same chunks minus `doc`, plus
 * the `compact` prefix. Docs reach the index through scripts/assistant-index-map.mjs.
 *
 * Serves the three knowledge tools that never touch the database:
 *   describe(kind, ref)   the full entry for one thing
 *   pageLookup(route)     one page: roles, rail label, what it does
 *   compactText()         the system-prefix text (pages, rules, tool names);
 *                         taken from `map.compact` when the generator emits
 *                         it, else built here from the page / rule / rpc chunks
 * plus `mapChunks()` for the indexer's `{mode:'map'}` load.
 */
import map from './map.json' with { type: 'json' };

export interface MapChunk {
  kind: string;
  ref: string;
  lang: 'en' | 'ar';
  title: string;
  body: string;
  route: string | null;
  /** Optional, posted chunks only: a vector computed by scripts/assistant-embed-local.mjs with the runtime's own model. */
  embedding?: number[] | null;
}

interface MapFile {
  generated_from: string;
  chunks: MapChunk[];
  compact?: string;
}

const MAP = map as unknown as MapFile;

/** Chunk kinds the map owns (the indexer deletes stale refs of these kinds only). */
export const MAP_KINDS: readonly string[] = ['page', 'nav', 'rpc', 'action', 'table', 'column', 'setting', 'enum', 'label', 'rule', 'system', 'doc'];

export function mapGeneratedFrom(): string {
  return MAP.generated_from;
}

export function mapChunks(): readonly MapChunk[] {
  return MAP.chunks;
}

const byKindRef: Map<string, MapChunk[]> = new Map();
for (const c of MAP.chunks) {
  const key = `${c.kind}\u0000${c.ref}`;
  const arr = byKindRef.get(key) ?? [];
  arr.push(c);
  byKindRef.set(key, arr);
}

/** Refs are prefixed `kind:` in the map (`page:/admin`, `table:reservations`); accept both spellings. */
function refCandidates(kind: string, ref: string): string[] {
  const bare = ref.trim();
  const out = new Set<string>([bare, `${kind}:${bare}`]);
  if (bare.startsWith(`${kind}:`)) out.add(bare.slice(kind.length + 1));
  if (kind === 'page' || kind === 'nav') {
    const route = bare.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
    out.add(route);
    out.add(`${kind}:${route}`);
  }
  if (kind === 'rpc' || kind === 'action') {
    const fn = bare.replace(/^app\./, '');
    out.add(fn);
    out.add(`${kind}:${fn}`);
    out.add(`${kind}:app.${fn}`);
  }
  return [...out];
}

/** The full map entry for one thing, both languages when present; null when unknown. */
export function describe(kind: string, ref: string): { kind: string; ref: string; entries: MapChunk[]; related: MapChunk[] } | null {
  let entries: MapChunk[] = [];
  let matched = ref;
  for (const cand of refCandidates(kind, ref)) {
    const hit = byKindRef.get(`${kind}\u0000${cand}`);
    if (hit && hit.length) {
      entries = hit;
      matched = cand;
      break;
    }
  }
  if (!entries.length) return null;
  // A table brings its columns; a page brings its rail entries and labels.
  const related: MapChunk[] = [];
  if (kind === 'table') {
    const prefix = `column:${matched.replace(/^table:/, '')}.`;
    for (const c of MAP.chunks) if (c.kind === 'column' && c.ref.startsWith(prefix)) related.push(c);
  } else if (kind === 'page') {
    const route = entries[0]?.route ?? matched.replace(/^page:/, '');
    for (const c of MAP.chunks) if ((c.kind === 'nav' || c.kind === 'label') && c.route === route) related.push(c);
  }
  return { kind, ref: matched, entries, related: related.slice(0, 60) };
}

/** Which page a route is, who may open it, its rail label in EN and AR, what it does. */
export function pageLookup(route: string): { route: string; page: MapChunk[]; nav: MapChunk[] } | null {
  const bare = route.replace(/[?#].*$/, '').replace(/\/+$/, '') || '/';
  // longest matching page prefix, like ROUTE_ROLES
  const pages = MAP.chunks.filter((c) => c.kind === 'page');
  let best: MapChunk[] = [];
  let bestRoute = '';
  for (const p of pages) {
    const r = p.route ?? p.ref.replace(/^page:/, '');
    if ((bare === r || bare.startsWith(`${r}/`)) && r.length > bestRoute.length) {
      bestRoute = r;
      best = pages.filter((q) => (q.route ?? q.ref.replace(/^page:/, '')) === r);
    }
  }
  if (!best.length) return null;
  const nav = MAP.chunks.filter((c) => c.kind === 'nav' && c.route === bestRoute);
  return { route: bestRoute, page: best, nav };
}

let compactCache: string | null = null;

/**
 * The compact prefix for the system prompt. Frozen per deploy (it is derived
 * from a committed file), so it can sit above the cache breakpoint.
 */
export function compactText(): string {
  if (compactCache !== null) return compactCache;
  if (typeof MAP.compact === 'string' && MAP.compact.trim()) {
    compactCache = MAP.compact.trim();
    return compactCache;
  }
  const lines: string[] = [];
  const en = (k: string) => MAP.chunks.filter((c) => c.kind === k && c.lang === 'en');
  lines.push('## Pages (route — what it does)');
  for (const p of en('page').sort((a, b) => a.ref.localeCompare(b.ref))) {
    const route = p.route ?? p.ref.replace(/^page:/, '');
    lines.push(`- ${route} — ${firstSentence(p.body)}`);
  }
  lines.push('', '## Rules');
  for (const r of en('rule')) lines.push(`- ${r.title}: ${firstSentence(r.body, 400)}`);
  lines.push('', '## Tools (one per line; call search or describe for details)');
  for (const t of en('rpc').sort((a, b) => a.ref.localeCompare(b.ref))) lines.push(`- ${t.ref.replace(/^rpc:/, '')} — ${firstSentence(t.body, 160)}`);
  compactCache = lines.join('\n');
  return compactCache;
}

function firstSentence(body: string, max = 240): string {
  const one = body.replace(/\s+/g, ' ').trim();
  const cut = one.search(/\.\s/);
  const s = cut > 40 && cut < max ? one.slice(0, cut + 1) : one.slice(0, max);
  return s.length < one.length && !s.endsWith('.') ? `${s}…` : s;
}
