/**
 * The map's embeddings, computed OUTSIDE the edge runtime with the SAME model
 * the runtime uses for live rows and queries (Supabase/gte-small, 384 dims,
 * mean-pooled, normalised, zero-padded to 1024 exactly as
 * functions/_shared/assistant/embed.ts `padTo` does), so the two paths produce
 * comparable vectors.
 *
 * WHY HERE. The runtime bills the worker's CPU cumulatively and kills it at
 * 2 s; embedding 2,532 chunks through it took 8 minutes, 68 worker kills and
 * still failed (2026-09-20). transformers.js in Node runs onnxruntime natively
 * and does the whole map in well under a minute. The runtime keeps embedding
 * what it is good for: a queue tick of ≤ 8 rows and one query at a time.
 *
 * The model files are fetched from Hugging Face on first use and cached in
 * ~/.cache/huggingface (no key needed).
 */
import { env, pipeline } from '@huggingface/transformers';

export const MODEL = 'Supabase/gte-small';
export const DIMS = 1024;
export const NATIVE_DIMS = 384;

let extractor = null;

async function load() {
  if (!extractor) {
    env.allowLocalModels = false;
    extractor = await pipeline('feature-extraction', MODEL, { dtype: 'fp32' });
  }
  return extractor;
}

/** Zero-pad a 384-vector to 1024; refuse anything else (mirrors embed.ts padTo). */
export function padTo(vec, dims = DIMS) {
  if (vec.length > dims) throw new Error(`vector has ${vec.length} dims, more than ${dims}`);
  const out = new Array(dims).fill(0);
  for (let i = 0; i < vec.length; i++) out[i] = Number(vec[i]);
  return out;
}

/** Embed texts with gte-small; returns 1024-dim padded, normalised vectors in order. */
export async function embedLocal(texts, batch = 32) {
  const ex = await load();
  const out = [];
  for (let i = 0; i < texts.length; i += batch) {
    const slice = texts.slice(i, i + batch);
    const t = await ex(slice, { pooling: 'mean', normalize: true });
    const rows = t.tolist();
    for (const r of rows) {
      if (r.length !== NATIVE_DIMS) throw new Error(`gte-small returned ${r.length} dims, expected ${NATIVE_DIMS}`);
      out.push(padTo(r));
    }
  }
  return out;
}
