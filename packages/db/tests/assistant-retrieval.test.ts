/**
 * 0325 — retrieval recall of the assistant's full-text half, measured.
 *
 * The "where is" cases of the eval set (tests/assistant-eval/cases.json, five
 * English, five Arabic) are asked of app.assistant_search exactly as a chat
 * with only their scopes on would ask them (p_kinds = SCOPE_CHUNK_KINDS of
 * those scopes), as the owner, with p_embedding NULL: the degraded mode every
 * stack without an embedding provider runs in, and the ONLY half that can find
 * an Arabic question, because the local embedder (gte-small) is English-only.
 * A case is a hit when its expected route is the route of one of the top five
 * results (recall@5); the suite prints recall per language and holds it to a
 * floor set a little below what 0325 measured.
 *
 *   * the system map (fixtures/assistant-map.json, what
 *     scripts/assistant-index-map.mjs posts after a deploy) is planted for any
 *     (kind, ref, lang) the stack does not already hold, through the service
 *     role, with the same clean() text and title the assistant-index function
 *     stores and a NULL embedding; afterAll removes exactly the planted ids;
 *   * measured 2026-10-08 on the local stack: 0110's websearch_to_tsquery
 *     (every word ANDed) found EN 1/5, AR 0/5; 0325's assistant_tsquery
 *     (folded, stopwords dropped, prefix OR) with title weighting finds
 *     EN 5/5, AR 2/5 (RECALL_FLOOR's comment says why AR stops there).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SupabaseClient } from '@supabase/supabase-js';
import { stackAvailable, serviceClient, signedInClient, appRpc, outcome, SEED_STAFF } from './helpers';
import { SCOPE_CHUNK_KINDS, type AssistantScope } from '../../core/src/assistant/tools';
import { clean, sourceForChunk } from '../supabase/functions/_shared/assistant/clean.ts';
import { newHandleTable } from '../supabase/functions/_shared/assistant/handles.ts';

interface WhereCase {
  id: string;
  kind: string;
  lang: 'en' | 'ar';
  question: string;
  scopes: AssistantScope[];
  expect: { route?: string };
}
interface MapChunk { kind: string; ref: string; lang: 'en' | 'ar'; title?: string | null; body: string; route?: string | null }
interface Hit { kind: string; ref: string; lang: string; route: string | null; score: number }

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CASES = (JSON.parse(readFileSync(path.join(HERE, 'assistant-eval/cases.json'), 'utf8')) as { cases: WhereCase[] }).cases.filter(
  (c) => c.kind === 'where',
);
const MAP = (JSON.parse(readFileSync(path.resolve(HERE, '../fixtures/assistant-map.json'), 'utf8')) as { chunks: MapChunk[] }).chunks;

/**
 * Floors, one case below the 0325 measurement (EN 5/5, AR 2/5 on 2026-10-08;
 * 0110 measured EN 1/5, AR 0/5). The three Arabic misses are the map's, not
 * the search's: /stock/waste and /assistant/usage have no Arabic chunk at all,
 * and /reports/revenue's Arabic chunks say التقارير / المكتسب, never تقرير
 * الإيرادات (a broken plural no light stemmer folds). Raise AR when the map
 * gains Arabic page bodies.
 */
const RECALL_FLOOR = { en: 0.8, ar: 0.2 } as const;
const TOP_K = 5;

// The assistant-index function's own preparation (functions/assistant-index/index.ts
// `prepare`): the cleaned text is the body; the title is the map title, else its first line.
const TZ = 'Asia/Baghdad';
function prepared(c: MapChunk) {
  const text = clean(sourceForChunk(c.kind), { title: c.title, body: c.body, route: c.route, lang: c.lang }, {
    tz: TZ,
    lang: 'en',
    handles: newHandleTable(null),
  }).text;
  const title = typeof c.title === 'string' && c.title ? c.title.slice(0, 200) : (text.split('\n')[0] ?? '').slice(0, 200);
  return { kind: c.kind, ref: c.ref, lang: c.lang, title, body: text, route: c.route ?? null };
}

function routeMatches(route: string | null, expected: string): boolean {
  if (!route) return false;
  return route === expected || [`${expected}/`, `${expected}?`, `${expected}#`].some((p) => route.startsWith(p));
}

const up = await stackAvailable();

describe.skipIf(!up)('0325 assistant retrieval recall (full text only)', () => {
  let svc: SupabaseClient;
  let owner: SupabaseClient;
  const planted: number[] = [];
  const recall: Record<'en' | 'ar', { hit: number; of: number; misses: string[] }> = {
    en: { hit: 0, of: 0, misses: [] },
    ar: { hit: 0, of: 0, misses: [] },
  };

  beforeAll(async () => {
    svc = serviceClient();
    owner = await signedInClient(SEED_STAFF.owner);

    // Plant what is missing; ON CONFLICT DO NOTHING returns only the rows it inserted,
    // so `planted` is exactly ours even when an indexer filled part of the map.
    const rows = MAP.map(prepared);
    for (let i = 0; i < rows.length; i += 250) {
      const { data, error } = await svc
        .from('assistant_chunks')
        .upsert(rows.slice(i, i + 250), { onConflict: 'kind,ref,lang', ignoreDuplicates: true })
        .select('id');
      expect(error, error?.message).toBeNull();
      for (const r of (data ?? []) as { id: number }[]) planted.push(r.id);
    }

    for (const c of CASES) {
      const kinds = [...new Set(c.scopes.flatMap((s) => SCOPE_CHUNK_KINDS[s] ?? []))];
      const res = await appRpc(owner, 'assistant_search', {
        p_query: c.question,
        p_embedding: null,
        p_kinds: kinds.length ? kinds : null,
        p_limit: TOP_K,
      }).then(outcome);
      expect(res.ok, `${c.id}: ${res.errorMessage}`).toBe(true);
      const hits = (res.data as Hit[]).slice(0, TOP_K);
      const r = recall[c.lang];
      r.of += 1;
      if (hits.some((h) => routeMatches(h.route, c.expect.route!))) r.hit += 1;
      else r.misses.push(`${c.id} → [${hits.map((h) => h.route ?? '-').join(', ')}]`);
    }
    console.log(
      `[assistant-retrieval] planted ${planted.length} of ${MAP.length} map chunks; ` +
        `recall@${TOP_K} full text only: EN ${recall.en.hit}/${recall.en.of}, AR ${recall.ar.hit}/${recall.ar.of}` +
        (recall.en.misses.length + recall.ar.misses.length
          ? `\n  misses:\n    ${[...recall.en.misses, ...recall.ar.misses].join('\n    ')}`
          : ''),
    );
  });

  afterAll(async () => {
    for (let i = 0; i < planted.length; i += 500) {
      await svc.from('assistant_chunks').delete().in('id', planted.slice(i, i + 500));
    }
    await owner?.auth.signOut();
  });

  it('the eval set has where-cases in both languages, each with a route', () => {
    expect(CASES.filter((c) => c.lang === 'en').length).toBeGreaterThan(0);
    expect(CASES.filter((c) => c.lang === 'ar').length).toBeGreaterThan(0);
    for (const c of CASES) expect(c.expect.route, c.id).toMatch(/^\//);
  });

  it(`English recall@${TOP_K} holds its floor`, () => {
    expect(recall.en.hit / recall.en.of, recall.en.misses.join('; ')).toBeGreaterThanOrEqual(RECALL_FLOOR.en);
  });

  it(`Arabic recall@${TOP_K} holds its floor`, () => {
    expect(recall.ar.hit / recall.ar.of, recall.ar.misses.join('; ')).toBeGreaterThanOrEqual(RECALL_FLOOR.ar);
  });

  it('search_fold folds letters, digits, marks and the article the same on both sides', async () => {
    const fold = async (t: string) => {
      const res = await appRpc(owner, 'search_fold', { p_text: t }).then(outcome);
      expect(res.ok, res.errorMessage).toBe(true);
      return res.data as string;
    };
    expect(await fold('الحجز')).toBe('حجز');
    expect(await fold('والحجز بالملعب للحجز')).toBe('حجز ملعب حجز');
    expect(await fold('أضيف إغلاق آخر')).toBe('اضيف اغلاق اخر');
    expect(await fold('عرضاً جديداً')).toBe('عرض جديد');
    expect(await fold('عدّ الدرج ـ مكتبة مستشفى ٤٥')).toBe('عد درج  مكتبه مستشفي 45');
    // two letters must remain: الم stays a word, it is not "م"
    expect(await fold('الم')).toBe('الم');
    expect(await fold('Day Close')).toBe('day close');
  });

  it('a name that folds like a preposition (علي), the month may, and both readings of لل are found', async () => {
    const notes = {
      ali: ['ee570000-0000-4000-8000-0000e7a1f0a1', 'ملاحظة: علي يفضل الملعب الثاني'],
      may: ['ee570000-0000-4000-8000-0000e7a1f0a2', 'targets for may'],
      lilPlayers: ['ee570000-0000-4000-8000-0000e7a1f0a3', 'تدريب مسائي للاعبين'],
      thePlayers: ['ee570000-0000-4000-8000-0000e7a1f0a4', 'جدول اللاعبين الجدد'],
    } as const;
    for (const [ref, body] of Object.values(notes)) {
      const r = await svc.schema('app').rpc('assistant_upsert_chunk', { p: { kind: 'note', ref, lang: 'ar', title: null, body } }).then(outcome);
      expect(r.ok, r.errorMessage).toBe(true);
    }
    const refsFor = async (q: string) => {
      const res = await appRpc(owner, 'assistant_search', { p_query: q, p_embedding: null, p_kinds: ['note'], p_limit: 50 }).then(outcome);
      expect(res.ok, res.errorMessage).toBe(true);
      return (res.data as Hit[]).map((h) => h.ref);
    };
    try {
      expect(await refsFor('علي')).toContain(notes.ali[0]);
      expect(await refsFor('على')).toContain(notes.ali[0]);
      expect(await refsFor('may')).toContain(notes.may[0]);
      // للاعبين indexes as اعبين, اللاعبين as لاعبين: each question finds both notes
      for (const q of ['اللاعبين', 'لاعبين', 'للاعبين']) {
        const refs = await refsFor(q);
        expect(refs, q).toContain(notes.lilPlayers[0]);
        expect(refs, q).toContain(notes.thePlayers[0]);
      }
    } finally {
      for (const [ref] of Object.values(notes)) await svc.schema('app').rpc('assistant_delete_chunk', { p_kind: 'note', p_ref: ref });
    }
  });

  it('a live free-text kind carries a 1,200-character snippet, a map kind 300', async () => {
    const ref = 'ee570000-0000-4000-8000-0000e7a1f00d';
    const long = `retrievalprobe ${'x'.repeat(2000)}`;
    for (const [kind, ref_] of [['note', ref], ['page', '/retrieval-probe']] as const) {
      const up_ = await svc.schema('app').rpc('assistant_upsert_chunk', { p: { kind, ref: ref_, lang: 'en', title: 'probe', body: long } }).then(outcome);
      expect(up_.ok, up_.errorMessage).toBe(true);
    }
    try {
      const res = await appRpc(owner, 'assistant_search', { p_query: 'retrievalprobe', p_embedding: null, p_kinds: ['note', 'page'], p_limit: 5 }).then(outcome);
      expect(res.ok, res.errorMessage).toBe(true);
      const hits = res.data as (Hit & { snippet: string })[];
      expect(hits.find((h) => h.kind === 'note')?.snippet.length).toBe(1200);
      expect(hits.find((h) => h.kind === 'page')?.snippet.length).toBe(300);
    } finally {
      await svc.schema('app').rpc('assistant_delete_chunk', { p_kind: 'note', p_ref: ref });
      await svc.schema('app').rpc('assistant_delete_chunk', { p_kind: 'page', p_ref: '/retrieval-probe' });
    }
  });
});
