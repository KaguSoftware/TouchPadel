/**
 * embed — the ONE seam to the embedding vendor (plan §3.3, contracts decision
 * 3), the same one-seam rule as `_shared/sms/index.ts`: callers pass an env
 * getter and a fetch so this module stays pure and runs under vitest.
 *
 *   EMBEDDING_PROVIDER unset or `none` → full-text only: every text embeds to null
 *   voyage  → voyage-multilingual-2, 1024 dims (VOYAGE_API_KEY)
 *   openai  → text-embedding-3-small requested at 1024 dims (OPENAI_API_KEY)
 *   local   → Supabase gte-small, 384 dims zero-padded to 1024 (cosine is
 *             unchanged by zero padding); the runner is injected by the edge
 *             function because `Supabase.ai` is not available here
 *   anything else → throws EmbedError('UNKNOWN_PROVIDER')
 *
 * Only this file may build an embeddings request body
 * (tests/assistant-clean-door.test.ts greps for it). The texts it receives
 * have already been through clean(); it embeds strings and knows nothing
 * about rows.
 */

export type EmbedLang = 'en' | 'ar';
export type EnvGetter = (name: string) => string | undefined;
export type FetchLike = (input: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
  text(): Promise<string>;
}>;

export const EMBEDDING_PROVIDERS = ['none', 'voyage', 'openai', 'local'] as const;
export type EmbeddingProvider = (typeof EMBEDDING_PROVIDERS)[number];

export const EMBEDDING_DIMS = 1024;
export const LOCAL_DIMS = 384;
export const VOYAGE_MODEL = 'voyage-multilingual-2';
export const OPENAI_MODEL = 'text-embedding-3-small';
export const VOYAGE_URL = 'https://api.voyageai.com/v1/embeddings';
export const OPENAI_URL = 'https://api.openai.com/v1/embeddings';
/** Vendors accept many inputs per call; the indexer batches at this size. */
export const EMBED_BATCH = 32;

export class EmbedError extends Error {
  readonly code: 'UNKNOWN_PROVIDER' | 'NOT_CONFIGURED' | 'UPSTREAM' | 'BAD_RESPONSE';
  readonly provider: string;
  readonly status?: number;
  constructor(code: EmbedError['code'], provider: string, message: string, status?: number) {
    super(message);
    this.name = 'EmbedError';
    this.code = code;
    this.provider = provider;
    this.status = status;
  }
}

export interface EmbedOptions {
  /** `document` when indexing, `query` when searching (Voyage distinguishes; OpenAI does not). */
  inputType?: 'document' | 'query';
  /** The `local` runner: `Supabase.ai.Session('gte-small').run(text, {mean_pool:true, normalize:true})` per text. */
  local?: (texts: readonly string[]) => Promise<ArrayLike<number>[]>;
}

/** The provider EMBEDDING_PROVIDER names; unset → none; an unknown name throws. */
export function embeddingProvider(env: EnvGetter): EmbeddingProvider {
  const name = (env('EMBEDDING_PROVIDER') ?? '').trim().toLowerCase();
  if (name === '') return 'none';
  if ((EMBEDDING_PROVIDERS as readonly string[]).includes(name)) return name as EmbeddingProvider;
  throw new EmbedError('UNKNOWN_PROVIDER', name, `EMBEDDING_PROVIDER=${name}: expected one of ${EMBEDDING_PROVIDERS.join(', ')}`);
}

/** Zero-pad (or refuse to truncate) a vector to EMBEDDING_DIMS. */
export function padTo(vec: ArrayLike<number>, dims = EMBEDDING_DIMS): number[] {
  if (vec.length > dims) throw new EmbedError('BAD_RESPONSE', 'local', `vector has ${vec.length} dims, more than ${dims}`);
  const out = new Array<number>(dims).fill(0);
  for (let i = 0; i < vec.length; i++) out[i] = Number(vec[i]);
  return out;
}

/**
 * Embed `texts`. Resolves to one vector (or null) per text, in order. `none`
 * resolves to all nulls without touching the network. Errors are EmbedError.
 */
export async function embed(
  texts: readonly string[],
  lang: EmbedLang,
  env: EnvGetter,
  fetchImpl: FetchLike,
  opts: EmbedOptions = {},
): Promise<(number[] | null)[]> {
  const provider = embeddingProvider(env);
  if (texts.length === 0) return [];
  void lang; // every provider here is multilingual; kept in the signature so a per-language model can be added without a call-site change
  switch (provider) {
    case 'none':
      return texts.map(() => null);
    case 'voyage': {
      const key = (env('VOYAGE_API_KEY') ?? '').trim();
      if (!key) throw new EmbedError('NOT_CONFIGURED', provider, 'missing VOYAGE_API_KEY');
      const body = JSON.stringify({ input: [...texts], model: VOYAGE_MODEL, input_type: opts.inputType ?? 'document' });
      const data = await post(fetchImpl, provider, VOYAGE_URL, key, body);
      return vectorsFrom(data, provider, texts.length);
    }
    case 'openai': {
      const key = (env('OPENAI_API_KEY') ?? '').trim();
      if (!key) throw new EmbedError('NOT_CONFIGURED', provider, 'missing OPENAI_API_KEY');
      const body = JSON.stringify({ input: [...texts], model: OPENAI_MODEL, dimensions: EMBEDDING_DIMS });
      const data = await post(fetchImpl, provider, OPENAI_URL, key, body);
      return vectorsFrom(data, provider, texts.length);
    }
    case 'local': {
      if (!opts.local) throw new EmbedError('NOT_CONFIGURED', provider, 'no local runner supplied (Supabase.ai is only available in the edge runtime)');
      const raw = await opts.local(texts);
      if (raw.length !== texts.length) throw new EmbedError('BAD_RESPONSE', provider, `expected ${texts.length} vectors, got ${raw.length}`);
      return raw.map((v) => padTo(v));
    }
  }
}

async function post(fetchImpl: FetchLike, provider: string, url: string, key: string, body: string): Promise<unknown> {
  let res: Awaited<ReturnType<FetchLike>>;
  try {
    res = await fetchImpl(url, { method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' }, body });
  } catch (e) {
    throw new EmbedError('UPSTREAM', provider, e instanceof Error ? e.message : String(e));
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new EmbedError('UPSTREAM', provider, `${res.status} ${text.slice(0, 200)}`, res.status);
  }
  return res.json();
}

/** Both vendors answer `{ data: [{ index, embedding: number[] }, …] }`; order by index to be safe. */
function vectorsFrom(data: unknown, provider: string, n: number): (number[] | null)[] {
  const rows = (data as { data?: unknown })?.data;
  if (!Array.isArray(rows)) throw new EmbedError('BAD_RESPONSE', provider, 'no data array');
  const out: (number[] | null)[] = new Array(n).fill(null);
  rows.forEach((r, i) => {
    const row = r as { index?: number; embedding?: unknown };
    const idx = typeof row.index === 'number' ? row.index : i;
    if (!Array.isArray(row.embedding)) throw new EmbedError('BAD_RESPONSE', provider, `row ${idx} has no embedding`);
    if (row.embedding.length !== EMBEDDING_DIMS) throw new EmbedError('BAD_RESPONSE', provider, `row ${idx} has ${row.embedding.length} dims, expected ${EMBEDDING_DIMS}`);
    out[idx] = row.embedding.map(Number);
  });
  return out;
}
