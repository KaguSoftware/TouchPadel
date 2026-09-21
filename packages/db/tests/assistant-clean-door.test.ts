/**
 * The clean door is a wall, not a convention (plan §11.0 property 1). This
 * test greps every assistant edge file and asserts:
 *   - a `tool_result` block is built in clean.ts and nowhere else;
 *   - an embeddings request body is built in embed.ts and nowhere else;
 *   - provider.ts types its tool results with `Cleaned` from clean.ts;
 *   - the Anthropic SDK is imported by provider.ts only (one adapter, §4.1);
 *   - the pure modules import neither `Deno` nor `npm:` (vitest must load them).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const FUNCTIONS = join(import.meta.dirname, '..', 'supabase', 'functions');

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const files = [
  ...walk(join(FUNCTIONS, '_shared', 'assistant')),
  ...readdirSync(FUNCTIONS)
    .filter((n) => n.startsWith('assistant-'))
    .flatMap((n) => walk(join(FUNCTIONS, n))),
].map((p) => ({ path: relative(FUNCTIONS, p), text: readFileSync(p, 'utf8') }));

const PURE = ['tools', 'clean', 'handles', 'gate', 'estimate', 'sse', 'scopes', 'prompt', 'embed'].map((m) => `_shared/assistant/${m}.ts`);
const DENO = ['_shared/assistant/provider.ts', '_shared/assistant/map.ts', 'assistant-chat/index.ts', 'assistant-index/index.ts', 'assistant-job/index.ts'];

describe('the clean door', () => {
  it('scans the expected files', () => {
    const names = files.map((f) => f.path);
    for (const p of [...PURE, ...DENO]) expect(names, `${p} is missing`).toContain(p);
  });

  it('builds tool_result blocks in clean.ts only', () => {
    const offenders = files.filter((f) => f.path !== '_shared/assistant/clean.ts' && /type:\s*['"]tool_result['"]|"tool_result"|'tool_result'/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('builds embeddings request bodies in embed.ts only', () => {
    const offenders = files.filter((f) => f.path !== '_shared/assistant/embed.ts' && /embeddings/.test(f.text));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  it('provider.ts imports Cleaned from clean.ts and is the only SDK importer', () => {
    const provider = files.find((f) => f.path === '_shared/assistant/provider.ts')!;
    expect(provider.text).toMatch(/import[^;]*\bCleaned\b[^;]*from\s+['"]\.\/clean\.ts['"]/);
    expect(provider.text).toMatch(/import[^;]*\bCleanedToolResult\b[^;]*from\s+['"]\.\/clean\.ts['"]/);
    const sdkImporters = files.filter((f) => /from\s+['"]npm:@anthropic-ai\/sdk/.test(f.text)).map((f) => f.path);
    expect(sdkImporters).toEqual(['_shared/assistant/provider.ts']);
  });

  it('pure modules have no Deno and no npm: specifiers', () => {
    for (const p of PURE) {
      const f = files.find((x) => x.path === p)!;
      expect(f.text, `${p} mentions Deno`).not.toMatch(/\bDeno\.\w/);
      expect(f.text, `${p} imports npm:`).not.toMatch(/from\s+['"]npm:/);
    }
  });

  it('the three functions never call the vendor around the provider and never read business data with the service client', () => {
    for (const p of DENO.filter((x) => x.startsWith('assistant-'))) {
      const f = files.find((x) => x.path === p)!;
      expect(f.text, `${p} calls api.anthropic.com`).not.toMatch(/api\.anthropic\.com/);
      // Business reads go through the JWT-bound client; the service client may
      // only touch bookkeeping RPCs. A `service…rpc('assistant_run_tool'` is the smell.
      expect(f.text, `${p} dispatches a tool as service role`).not.toMatch(/service[\s\S]{0,80}rpc\(\s*['"]assistant_(run_tool|search|usage|count)['"]/);
    }
  });
});
