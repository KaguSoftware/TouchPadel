/**
 * assistant-index — the search index writer (plan §4.2, contracts
 * "assistant-index/index.ts"). Two callers:
 *   - cron `tp_assistant_index_sweep` / `app.assistant_index_nudge()` with the
 *     service-role JWT, body `{}`: drain `assistant_index_queue` in batches of 50;
 *   - the deploy script (service role) or an owner session, body `{mode:'map'}`:
 *     load every chunk of `_shared/assistant/map.json`, embed, upsert, and
 *     delete stale refs of the map kinds.
 *
 * Every text goes through clean() with `kind: 'chunk'` BEFORE it is embedded or
 * stored (plan §11.0): a customer note is pseudonymised before the embedding
 * vendor sees it. A row that fails cleaning is never embedded; it is marked
 * with `assistant_index_fail` and retried by the next claim until the queue's
 * attempts cap, exactly like the telegram sender.
 *
 * Embedding provider: `_shared/assistant/embed.ts` (EMBEDDING_PROVIDER). With
 * `none` the chunk is stored with a null vector and search is full-text only.
 *
 * Returns `{ processed, failed, ms }` with 200 always (the pg_net caller must
 * not log noise); errors are in the body.
 */
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { json } from '../_shared/http.ts';
import { clean, CleanError, sourceForChunk, type Cleaned } from '../_shared/assistant/clean.ts';
import { EMBED_BATCH, embed, embeddingProvider, EmbedError } from '../_shared/assistant/embed.ts';
import { newHandleTable } from '../_shared/assistant/handles.ts';
import { MAP_KINDS, mapChunks, mapGeneratedFrom, type MapChunk } from '../_shared/assistant/map.ts';

const CLAIM_LIMIT = 50;
const UPSERT_PARALLEL = 16;
const TZ = 'Asia/Baghdad';

type Lang = 'en' | 'ar';

interface QueueRow {
  id: number;
  kind: string;
  ref: string;
  op: 'upsert' | 'delete';
  attempts: number;
}

/** Where a live chunk kind lives in the app, so an answer can link to it. */
const ROUTE_BY_KIND: Readonly<Record<string, string>> = {
  note: '/desk/customers',
  request: '/observation/requests',
  alert: '/ops',
  finding: '/analytics/cafe',
  rejection: '/analytics/cafe',
  menu_item: '/admin/menu',
  promotion: '/admin/promotions',
};

interface Prepared {
  kind: string;
  ref: string;
  lang: Lang;
  title: string;
  route: string | null;
  cleaned: Cleaned;
  source_updated_at: string | null;
}

const env = (name: string) => Deno.env.get(name);

/**
 * The `local` provider's runner: Supabase's built-in gte-small session, which
 * exists only in the edge runtime (declared here, never in the pure module).
 */
function localRunner(): ((texts: readonly string[]) => Promise<ArrayLike<number>[]>) | undefined {
  const g = globalThis as unknown as {
    Supabase?: { ai?: { Session: new (model: string) => { run(text: string, opts: { mean_pool: boolean; normalize: boolean }): Promise<ArrayLike<number>> } } };
  };
  const ai = g.Supabase?.ai;
  if (!ai) return undefined;
  const session = new ai.Session('gte-small');
  return (texts) => Promise.all(texts.map((t) => session.run(t, { mean_pool: true, normalize: true })));
}

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, 200);
}

function prepare(kind: string, ref: string, row: Record<string, unknown>, fallbackRoute: string | null): Prepared {
  const cleaned = clean(sourceForChunk(kind), row, { tz: TZ, lang: 'en', handles: newHandleTable(null) });
  const lang: Lang = row.lang === 'ar' ? 'ar' : 'en';
  const route = typeof row.route === 'string' ? row.route : fallbackRoute;
  const title = typeof row.title === 'string' && row.title ? row.title.slice(0, 200) : firstLine(cleaned.text);
  const updated = row.updated_at ?? row.created_at ?? null;
  return { kind, ref, lang, title, route, cleaned, source_updated_at: typeof updated === 'string' ? updated : null };
}

async function embedAll(items: Prepared[]): Promise<(number[] | null)[]> {
  const out: (number[] | null)[] = [];
  const local = localRunner();
  for (let i = 0; i < items.length; i += EMBED_BATCH) {
    const slice = items.slice(i, i + EMBED_BATCH);
    const vectors = await embed(slice.map((p) => p.cleaned.text), slice[0]?.lang ?? 'en', env, fetch as never, { inputType: 'document', local });
    out.push(...vectors);
  }
  return out;
}

async function upsertAll(db: ReturnType<typeof createServiceClient>, items: Prepared[], vectors: (number[] | null)[]): Promise<{ ok: number[]; failed: { i: number; error: string }[] }> {
  const ok: number[] = [];
  const failed: { i: number; error: string }[] = [];
  for (let i = 0; i < items.length; i += UPSERT_PARALLEL) {
    const slice = items.slice(i, i + UPSERT_PARALLEL);
    await Promise.all(
      slice.map(async (p, j) => {
        const idx = i + j;
        const { error } = await db.schema('app').rpc('assistant_upsert_chunk', {
          p: {
            kind: p.kind,
            ref: p.ref,
            lang: p.lang,
            title: p.title,
            body: p.cleaned.text,
            route: p.route,
            embedding: vectors[idx] ?? null,
            source_updated_at: p.source_updated_at,
            stats: p.cleaned.stats,
          },
        });
        if (error) failed.push({ i: idx, error: error.message });
        else ok.push(idx);
      }),
    );
  }
  return { ok, failed };
}

// ---------------------------------------------------------------------------
// Drain the queue
// ---------------------------------------------------------------------------
async function drain(db: ReturnType<typeof createServiceClient>): Promise<{ processed: number; failed: number; claimed: number }> {
  const { data: claimed, error: claimErr } = await db.schema('app').rpc('claim_due_index', { p_limit: CLAIM_LIMIT });
  if (claimErr) throw new Error(`claim_due_index: ${claimErr.message}`);
  const rows = (claimed ?? []) as QueueRow[];
  if (!rows.length) return { processed: 0, failed: 0, claimed: 0 };

  const done: number[] = [];
  let failed = 0;
  const fail = async (row: QueueRow, message: string) => {
    failed++;
    const { error } = await db.schema('app').rpc('assistant_index_fail', { p_id: row.id, p_error: message.slice(0, 500) });
    if (error) console.error('[assistant-index] fail not recorded', row.id, error.message);
  };

  // 1. deletes and source loads
  const prepared: { row: QueueRow; item: Prepared }[] = [];
  for (const row of rows) {
    try {
      if (row.op === 'delete') {
        const { error } = await db.schema('app').rpc('assistant_delete_chunk', { p_kind: row.kind, p_ref: row.ref });
        if (error) throw new Error(error.message);
        done.push(row.id);
        continue;
      }
      const { data: src, error } = await db.schema('app').rpc('assistant_chunk_source', { p_kind: row.kind, p_ref: row.ref });
      if (error) throw new Error(error.message);
      if (src === null || src === undefined) {
        // The source row is gone: the chunk goes too.
        const del = await db.schema('app').rpc('assistant_delete_chunk', { p_kind: row.kind, p_ref: row.ref });
        if (del.error) throw new Error(del.error.message);
        done.push(row.id);
        continue;
      }
      prepared.push({ row, item: prepare(row.kind, row.ref, src as Record<string, unknown>, ROUTE_BY_KIND[row.kind] ?? null) });
    } catch (e) {
      const msg = e instanceof CleanError ? `CLEAN_${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      await fail(row, msg);
    }
  }

  // 2. embed (a vendor failure fails every row of the batch; they retry after the lease)
  let vectors: (number[] | null)[] = [];
  if (prepared.length) {
    try {
      vectors = await embedAll(prepared.map((p) => p.item));
    } catch (e) {
      const msg = e instanceof EmbedError ? `EMBED_${e.code}: ${e.message}` : e instanceof Error ? e.message : String(e);
      for (const p of prepared) await fail(p.row, msg);
      prepared.length = 0;
    }
  }

  // 3. upsert
  if (prepared.length) {
    const r = await upsertAll(db, prepared.map((p) => p.item), vectors);
    for (const i of r.ok) done.push(prepared[i]!.row.id);
    for (const f of r.failed) await fail(prepared[f.i]!.row, f.error);
  }

  if (done.length) {
    const { error } = await db.schema('app').rpc('assistant_index_done', { p_ids: done });
    if (error) console.error('[assistant-index] done not recorded', error.message);
  }
  return { processed: done.length, failed, claimed: rows.length };
}

// ---------------------------------------------------------------------------
// Load the map
// ---------------------------------------------------------------------------
/**
 * `posted` is the doc (and any other) chunks scripts/assistant-index-map.mjs
 * sends in batches because the edge copy of the map leaves them out. A posted
 * batch is upserted only; the stale sweep runs for the bundled load alone and
 * only over the kinds that load actually carried, so a bundled map without
 * `doc` chunks never deletes the docs the script indexed.
 */
async function indexMap(
  db: ReturnType<typeof createServiceClient>,
  posted: readonly MapChunk[] | null,
): Promise<{ processed: number; failed: number; deleted: number; generated_from: string }> {
  const items: Prepared[] = [];
  let failed = 0;
  const source: readonly MapChunk[] = posted ?? mapChunks();
  for (const c of source) {
    if (!MAP_KINDS.includes(c.kind) || typeof c.ref !== 'string' || typeof c.body !== 'string') {
      failed++;
      continue;
    }
    try {
      const item = prepare(c.kind, c.ref, { title: c.title, body: c.body, route: c.route, lang: c.lang }, c.route);
      items.push({ ...item, lang: c.lang, title: c.title.slice(0, 200) });
    } catch (e) {
      failed++;
      console.error('[assistant-index] map chunk refused', c.kind, c.ref, e instanceof Error ? e.message : String(e));
    }
  }
  const vectors = await embedAll(items);
  const r = await upsertAll(db, items, vectors);
  failed += r.failed.length;
  for (const f of r.failed) console.error('[assistant-index] map upsert failed', items[f.i]?.ref, f.error);

  // Stale refs — bundled load only, and only of the kinds it carried.
  let deleted = 0;
  if (posted) return { processed: r.ok.length, failed, deleted, generated_from: mapGeneratedFrom() };
  const keep = new Set(items.map((i) => `${i.kind}\u0000${i.ref}`));
  const kindsLoaded = [...new Set(items.map((i) => i.kind))];
  const { data: existing, error } = await db.from('assistant_chunks').select('kind, ref').in('kind', kindsLoaded);
  if (error) throw new Error(`assistant_chunks read: ${error.message}`);
  const stale = ((existing ?? []) as { kind: string; ref: string }[]).filter((x) => !keep.has(`${x.kind}\u0000${x.ref}`));
  for (const x of stale) {
    const del = await db.schema('app').rpc('assistant_delete_chunk', { p_kind: x.kind, p_ref: x.ref });
    if (del.error) console.error('[assistant-index] stale delete failed', x.kind, x.ref, del.error.message);
    else deleted++;
  }
  return { processed: r.ok.length, failed, deleted, generated_from: mapGeneratedFrom() };
}

/** Delete chunks of `kinds` whose ref is not in `keep` — the last step of scripts/assistant-index-map.mjs. */
async function prune(db: ReturnType<typeof createServiceClient>, kinds: string[], keep: string[]): Promise<{ deleted: number; kinds: string[] }> {
  const valid = kinds.filter((k) => MAP_KINDS.includes(k));
  if (valid.length === 0) return { deleted: 0, kinds: [] };
  const keepSet = new Set(keep);
  const { data, error } = await db.from('assistant_chunks').select('kind, ref').in('kind', valid);
  if (error) throw new Error(`assistant_chunks read: ${error.message}`);
  let deleted = 0;
  for (const x of (data ?? []) as { kind: string; ref: string }[]) {
    if (keepSet.has(x.ref)) continue;
    const del = await db.schema('app').rpc('assistant_delete_chunk', { p_kind: x.kind, p_ref: x.ref });
    if (del.error) console.error('[assistant-index] prune failed', x.kind, x.ref, del.error.message);
    else deleted++;
  }
  return { deleted, kinds: valid };
}

// ---------------------------------------------------------------------------
Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const started = Date.now();
  const db = createServiceClient();

  interface Body {
    mode?: string;
    /** `map` mode: chunks to index instead of the bundled map (scripts/assistant-index-map.mjs). */
    chunks?: MapChunk[];
    /** `prune` mode: delete rows of these kinds whose ref is not in `keep`. */
    kinds?: string[];
    keep?: string[];
  }
  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    body = {};
  }
  const mode = body.mode === 'map' ? 'map' : body.mode === 'prune' ? 'prune' : 'drain';

  if (!isServiceRoleRequest(req)) {
    // An owner may trigger the bundled map load from the app; posted chunks,
    // pruning and the drain are the service role's alone.
    if (mode !== 'map' || body.chunks) return json({ error: 'forbidden' }, 403);
    const auth = await requireStaffRole(req, db, ['owner']);
    if (auth instanceof Response) return auth;
  }

  try {
    embeddingProvider(env); // an unknown EMBEDDING_PROVIDER fails the run before any claim
    const result =
      mode === 'map'
        ? await indexMap(db, Array.isArray(body.chunks) ? body.chunks : null)
        : mode === 'prune'
          ? await prune(db, body.kinds ?? [], body.keep ?? [])
          : await drain(db);
    return json({ ...result, provider: embeddingProvider(env), ms: Date.now() - started });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error('[assistant-index] failed', msg);
    return json({ ok: false, error: msg, processed: 0, failed: 0, ms: Date.now() - started });
  }
});
