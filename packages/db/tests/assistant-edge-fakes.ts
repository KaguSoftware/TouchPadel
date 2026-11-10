/**
 * Fakes for the assistant-chat modules split out of its index.ts on
 * 2026-11-09 (runners.ts, persist.ts, reads.ts), so their behaviour is tested
 * under vitest and not only read as source (tests/assistant-edge-errors.test.ts).
 *
 *   * `fakeClient`: a supabase-js stand-in that records every query in call
 *     order — the table or RPC, the schema, the arguments and each chained
 *     method (`eq`, `order`, `limit`, `abortSignal`, …) — and answers through
 *     the handlers a test gives it, at await time, so a handler sees the whole
 *     chain;
 *   * `denoEnv`: the `Deno.env.get` those modules read, from a plain record;
 *   * `loadDenoModule`: imports a Deno module by absolute path through a
 *     non-literal specifier, so `tsc` does not follow it into its `npm:`
 *     imports (they are type-only there and vanish under vitest). A test file
 *     that loads runners.ts or persist.ts must `vi.mock` provider.ts first:
 *     the real one imports the Anthropic SDK through `npm:` and never loads
 *     under vitest (tests/assistant-clean-door.test.ts).
 *
 * Not a test file (no `.test.ts`): vitest does not collect it.
 */
import { fileURLToPath } from 'node:url';

export type Result = { data: unknown; error: unknown; [k: string]: unknown };

export interface Op {
  kind: 'rpc' | 'from' | 'download';
  /** The RPC, the table, or the storage bucket. */
  name: string;
  /** `app` for `.schema('app').rpc(…)`, `public` otherwise. */
  schema: string;
  /** The RPC's arguments, or the downloaded path. */
  args?: unknown;
  chain: { m: string; a: unknown[] }[];
  signal?: AbortSignal;
}

export interface FakeHandlers {
  rpc?(name: string, args: Record<string, unknown>, op: Op): Result | Promise<Result>;
  from?(table: string, op: Op): Result | Promise<Result>;
  download?(bucket: string, path: string): { data: Blob | null; error: unknown } | Promise<{ data: Blob | null; error: unknown }>;
}

const OK: Result = { data: null, error: null };

/** The first argument list of method `m` on this op's chain, or undefined. */
export function argsOf(op: Op, m: string): unknown[] | undefined {
  return op.chain.find((c) => c.m === m)?.a;
}

/** Every `eq` of the op as `{column: value}`. */
export function eqs(op: Op): Record<string, unknown> {
  return Object.fromEntries(op.chain.filter((c) => c.m === 'eq').map((c) => [String(c.a[0]), c.a[1]]));
}

export function fakeClient(h: FakeHandlers = {}) {
  const ops: Op[] = [];
  const builder = (op: Op, resolve: () => Result | Promise<Result>): unknown => {
    const b: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === 'then') {
            return (ok: (v: Result) => unknown, ko: (e: unknown) => unknown) => Promise.resolve().then(resolve).then(ok, ko);
          }
          if (typeof prop === 'symbol') return undefined;
          return (...a: unknown[]) => {
            op.chain.push({ m: prop, a });
            if (prop === 'abortSignal') op.signal = a[0] as AbortSignal;
            return b;
          };
        },
      },
    );
    return b;
  };
  const rpcIn = (schema: string) => (name: string, args: Record<string, unknown> = {}) => {
    const op: Op = { kind: 'rpc', name, schema, args, chain: [] };
    ops.push(op);
    return builder(op, () => (h.rpc ? h.rpc(name, args, op) : OK));
  };
  const fromIn = (schema: string) => (table: string) => {
    const op: Op = { kind: 'from', name: table, schema, chain: [] };
    ops.push(op);
    return builder(op, () => (h.from ? h.from(table, op) : OK));
  };
  const client = {
    schema: (s: string) => ({ rpc: rpcIn(s), from: fromIn(s) }),
    rpc: rpcIn('public'),
    from: fromIn('public'),
    storage: {
      from: (bucket: string) => ({
        download: async (path: string) => {
          ops.push({ kind: 'download', name: bucket, schema: 'storage', args: path, chain: [] });
          return h.download ? h.download(bucket, path) : { data: null, error: { message: 'no download handler' } };
        },
      }),
    },
  };
  return {
    client,
    ops,
    rpcs: (name?: string) => ops.filter((o) => o.kind === 'rpc' && (name === undefined || o.name === name)),
    froms: (table?: string) => ops.filter((o) => o.kind === 'from' && (table === undefined || o.name === table)),
  };
}

/** A `Deno` global with `env.get` over `vars` (vi.stubGlobal('Deno', denoEnv({...}))). */
export function denoEnv(vars: Record<string, string>) {
  return { env: { get: (n: string) => vars[n] } };
}

const FUNCTIONS = new URL('../supabase/functions/', import.meta.url);

/** A module under supabase/functions, imported at run time (see the header). */
export async function loadDenoModule<T>(relativePath: string): Promise<T> {
  const path: string = fileURLToPath(new URL(relativePath, FUNCTIONS));
  return (await import(/* @vite-ignore */ path)) as T;
}
