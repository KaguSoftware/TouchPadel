/**
 * What the assistant's edge functions let through of an error, and the input
 * they refuse (review 2026-11-09):
 *   - http.ts `safePgMessage`: a P0001 refusal is our own code and passes as
 *     before; any other SQLSTATE is the mapped code plus a fixed sentence, the
 *     raw Postgres text to the log only, so a cleanedNotice carries our words;
 *   - assistant-chat and assistant-job never forward mapPgError's message, the
 *     analytics-posthog body or PostHog's error string to the model;
 *   - the job prices a call by the TypeScript estimate when llm_price_micros
 *     fails (never 0) and refuses a malformed job_id with 400;
 *   - the re-check refuses a malformed venue_scope like the main path; every
 *     JSON refusal carries `code`; no bare console.error in either function.
 * The Deno entries cannot load under vitest (npm: specifiers, Deno.env), so the
 * wiring is held by reading their source, as tests/assistant-jobs.test.ts does.
 * assistant-chat's source is its index.ts plus the _shared/assistant modules
 * its code moved to on 2026-11-09 (runners.ts holds the tool runners).
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanedNotice } from '../supabase/functions/_shared/assistant/clean.ts';
import { safePgMessage, type PgError } from '../supabase/functions/_shared/http.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(resolve(HERE, '../supabase/functions', p), 'utf8');
const CHAT_INDEX = read('assistant-chat/index.ts');
const RUNNERS = read('_shared/assistant/runners.ts');
const CHAT = [CHAT_INDEX, RUNNERS, ...['persist', 'reads', 'recheck', 'reuse'].map((m) => read(`_shared/assistant/${m}.ts`))].join('\n');
const JOB = read('assistant-job/index.ts');

afterEach(() => vi.restoreAllMocks());

describe('safePgMessage', () => {
  it('a 22P02 becomes its code and a fixed sentence: no raw Postgres text in the notice; the raw text is logged', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const err: PgError = { code: '22P02', message: 'invalid input syntax for type uuid: "x7-guest-secret"', details: 'Token "x7" is invalid.', hint: null };
    const notice = cleanedNotice(safePgMessage(err, 'assistant-chat'));
    expect(notice.text).toBe('22P02: the database refused this call (22P02)');
    for (const raw of ['invalid input', 'uuid', 'x7-guest-secret', 'Token']) expect(notice.text).not.toContain(raw);
    expect(notice.numbers).toEqual([]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]!.join(' ')).toContain('x7-guest-secret');
    expect(log.mock.calls[0]![0]).toBe('[assistant-chat]');
  });

  it('a P0001 refusal is our own code and passes exactly as before, unlogged', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(safePgMessage({ code: 'P0001', message: 'ASSISTANT_UNKNOWN_COLUMN' }, 'x')).toBe('ASSISTANT_UNKNOWN_COLUMN: ASSISTANT_UNKNOWN_COLUMN');
    expect(safePgMessage({ code: 'P0001', message: 'FORBIDDEN' }, 'x')).toBe('FORBIDDEN: FORBIDDEN');
    expect(log).not.toHaveBeenCalled();
  });

  it('mapped codes keep their name; the raw constraint, table or timeout text never shows', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(safePgMessage({ code: '23505', message: 'duplicate key value violates unique constraint "guests_phone_key"' }, 'x')).toBe('DUPLICATE: the database refused this call (23505)');
    expect(safePgMessage({ code: '42501', message: 'permission denied for table staff_pins' }, 'x')).toBe('42501: the database refused this call (42501)');
    expect(safePgMessage({ code: '23P01', message: 'conflicting key value violates exclusion constraint "no_overlap"' }, 'x')).toBe('SLOT_TAKEN: the database refused this call (23P01)');
    expect(safePgMessage({ code: '57014', message: 'canceling statement due to statement timeout' }, 'x')).toBe('RETRY_LATER: the database could not run this call right now (57014)');
    expect(safePgMessage({ code: 'PGRST202', message: 'Could not find the function app.x(p_a) in the schema cache' }, 'x')).toBe('RPC_NOT_DEPLOYED: the database refused this call (PGRST202)');
  });

  it('no code, or a code that is not a SQLSTATE, prints no code text', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(safePgMessage({ message: 'fetch failed: ECONNREFUSED 10.0.0.4' }, 'x')).toBe('INTERNAL: the database refused this call (no code)');
    const odd = safePgMessage({ code: 'leak "me"', message: 'raw' }, 'x');
    expect(odd).not.toContain('raw');
    expect(odd).toMatch(/\(no code\)$/);
  });
});

describe('assistant-chat and assistant-job hand the model no raw error text', () => {
  it('no mapPgError message is interpolated into a notice or a thrown error', () => {
    for (const [name, src] of [['assistant-chat', CHAT], ['assistant-job', JOB]] as const) {
      expect(src, name).not.toMatch(/mapped\.message|\bm\.message\b/);
      expect(src, name).not.toMatch(/mapPgError\(/);
      expect(src, name).toMatch(/safePgMessage\(error, '/);
    }
  });

  it("posthog: the status only, the body and PostHog's own error string go to the log", () => {
    const fn = RUNNERS.slice(RUNNERS.indexOf('async function runPosthog('), RUNNERS.indexOf('async function runSearch('));
    expect(fn).not.toMatch(/cleanedNotice\([^)]*\$\{text\}/);
    expect(fn).not.toMatch(/cleanedNotice\([^)]*result\.error/);
    expect(fn).toMatch(/logError\('assistant-chat', text \|\| 'empty body'/);
    expect(fn).toMatch(/logError\('assistant-chat', result\.error/);
  });

  it('the degraded search appends its note with withNote, never by re-wrapping cleaned text in cleanedNotice', () => {
    const fn = RUNNERS.slice(RUNNERS.indexOf('async function runSearch('), RUNNERS.indexOf('async function runKnowledgeOrMeta('));
    expect(fn).toMatch(/withNote\(cleaned, SEARCH_TEXT_ONLY_NOTE\)/);
    expect(CHAT).not.toMatch(/cleanedNotice\(`\$\{cleaned\.text\}/);
  });
});

describe('job plans, prices and refusals', () => {
  it('propose_job checks aggregate_alternative calls like steps.calls: input rules, scopes, handles', () => {
    const fn = RUNNERS.slice(RUNNERS.indexOf('function checkPlanCalls('), RUNNERS.indexOf('async function runProposeJob('));
    expect(fn).toMatch(/validateToolInput\(spec, args\)/);
    expect(fn).toMatch(/checkScope\(spec\.name, ctx\.scopes\)/);
    expect(fn).toMatch(/resolveArgs\(spec, args, ctx\.handles\)/);
    expect(CHAT).toMatch(/checkPlanCalls\(ctx, steps\.calls, 'steps'\)/);
    expect(CHAT).toMatch(/checkPlanCalls\(ctx, [^)]*'aggregate_alternative'\)/);
    expect(CHAT).not.toMatch(/\.filter\(\(c\) => typeof c\.tool === 'string' && toolByName\(c\.tool\)\)/);
  });

  it('a failed llm_price_micros read prices the call by the TypeScript estimate, never 0', () => {
    const at = JOB.indexOf('\n  async price(');
    const body = JOB.slice(at, JOB.indexOf('\n  }\n', at));
    expect(body).not.toMatch(/return 0;/);
    expect(body).toMatch(/return await this\.estimate\(u, model\)/);
    expect(JOB).toMatch(/turnEstimateMicros\(model, u, rates, fallback\)/);
  });

  it('a malformed job_id is a 400 before any read', () => {
    const handler = JOB.slice(JOB.indexOf("Deno.serve(handle('assistant-job'"));
    const check = handler.indexOf('if (!isUuid(body.job_id))');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(handler.indexOf(".from('assistant_jobs')"));
  });

  it('the re-check refuses a malformed venue_scope with 400, as the main path does', () => {
    const handler = CHAT_INDEX.slice(CHAT_INDEX.indexOf("Deno.serve(handle('assistant-chat'"));
    const recheck = handler.slice(handler.indexOf("'recheck' in raw"), handler.indexOf('return handleRecheck('));
    expect(recheck).toMatch(/if \(scope === false\) return json\(\{ error: 'INVALID_REQUEST', code: 'INVALID_REQUEST'/);
    expect(handler).not.toMatch(/scope === false \? null : scope/);
  });

  it('every JSON refusal carries code; no bare console.error', () => {
    for (const [name, src] of [['assistant-chat', CHAT], ['assistant-job', JOB]] as const) {
      const bodies = src.match(/json\(\{ (?:ok: false, )?error: [^}]*\}/g) ?? [];
      expect(bodies.length, name).toBeGreaterThan(0);
      for (const b of bodies) expect(b, `${name}: ${b}`).toMatch(/\bcode: /);
      expect(src, name).not.toMatch(/console\.error\(/);
    }
  });
});
