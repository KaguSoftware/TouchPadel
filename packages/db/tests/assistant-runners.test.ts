/**
 * runners.ts — assistant-chat's tool runners, as behaviour (split out of
 * assistant-chat/index.ts on 2026-11-09). tests/assistant-edge-errors.test.ts
 * holds their wiring by reading the source; this suite RUNS them against a
 * recording fake client (tests/assistant-edge-fakes.ts) injected through
 * DispatchCtx, a stubbed `fetch` and a stubbed `Deno.env`:
 *
 *   * runRpcTool: a database error reaches the model as http.ts safePgMessage's
 *     code and fixed sentence (the raw text goes to the log), a P0001 refusal
 *     passes as our code; a list over LIST_ROW_CAP with no limit is refused
 *     towards propose_job; the turn's abort signal rides on the RPC;
 *   * runFileRead: no words → `readable: false` and no download; a failed
 *     download, a body that is not gzip and a text past the unpacked cap each
 *     end in their own fixed sentence; a real gzipped fixture built here is
 *     unpacked, windowed by offset/chars, and the storage path never reaches
 *     the model;
 *   * runPosthog: the business day start hour from the branch in scope (the
 *     0029 default on a failed read), the caller's Authorization forwarded,
 *     and every failure a fixed sentence — an HTTP status (never the body),
 *     an unreachable function, PostHog unconfigured, no result, PostHog's own
 *     error string;
 *   * runSearch: a degraded (text-only) search keeps its figures (withNote);
 *   * checkPlanCalls / runProposeJob: refusals for both slots (not a list
 *     tool, unknown tool, malformed args, scope off, unknown handle), paging
 *     stripped from steps, counts as the owner, the estimate, batch off on a
 *     provider without it, the first chunk measured on the counter without
 *     minting a handle, and a failed count or measurement;
 *   * runStoredTool: posthog, file_read, else the RPC dispatcher.
 *
 * provider.ts never loads under vitest (npm: SDK import); it is mocked here
 * with the two helpers these modules use and a controllable providerFromEnv.
 */
import { gzipSync } from 'node:zlib';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { handleFor, newHandleTable, toJson, type HandleTable } from '../supabase/functions/_shared/assistant/handles.ts';
import { LIST_ROW_CAP, toolByName, type AssistantScope, type ToolSpec } from '../supabase/functions/_shared/assistant/tools.ts';
import type { Dispatched } from '../supabase/functions/_shared/assistant/turn.ts';
import { denoEnv, eqs, fakeClient, loadDenoModule, type FakeHandlers } from './assistant-edge-fakes';

const providerMock = vi.hoisted(() => ({ providerFromEnv: vi.fn((): unknown => null) }));
vi.mock('../supabase/functions/_shared/assistant/provider.ts', () => ({
  providerFromEnv: providerMock.providerFromEnv,
  textOf: (c: { type: string; text?: string }[]) => c.filter((b) => b.type === 'text').map((b) => b.text).join(''),
  withoutThinking: (c: { type: string }[]) => c.filter((b) => b.type !== 'thinking' && b.type !== 'redacted_thinking'),
}));

interface Ctx {
  asOwner: unknown;
  scopes: readonly AssistantScope[];
  handles: HandleTable;
  tz: string;
  lang: 'en' | 'ar';
  authorization: string;
  resultRows?: number;
  venueScope?: string | null;
  signal?: AbortSignal;
}
interface FakeProvider {
  model: string;
  capabilities: { batch: boolean; exactTokens: boolean };
  countTokens: (...a: unknown[]) => Promise<number>;
}
interface Runners {
  runRpcTool(ctx: Ctx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched>;
  runFileRead(ctx: Ctx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched>;
  runPosthog(ctx: Ctx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched>;
  runSearch(ctx: Ctx, spec: ToolSpec, input: Record<string, unknown>): Promise<Dispatched>;
  runProposeJob(ctx: Ctx, provider: FakeProvider, input: Record<string, unknown>, lang: 'en' | 'ar'): Promise<Dispatched>;
  runStoredTool(ctx: Ctx, spec: ToolSpec, resolved: Record<string, unknown>): Promise<Dispatched>;
  checkPlanCalls(ctx: Ctx, list: unknown, slot: 'steps' | 'aggregate_alternative'): { tool: string; args: Record<string, unknown> }[] | string;
  businessDayStartHour(asOwner: unknown, venueScope?: string | null, signal?: AbortSignal): Promise<number>;
}

let R: Runners;
beforeAll(async () => {
  R = await loadDenoModule<Runners>('_shared/assistant/runners.ts');
});

const ENV = { SUPABASE_URL: 'http://edge.test', SUPABASE_ANON_KEY: 'anon-key' };
let logged: string[];
beforeEach(() => {
  vi.stubGlobal('Deno', denoEnv(ENV));
  logged = [];
  vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
    logged.push(a.map(String).join(' '));
  });
  providerMock.providerFromEnv.mockReset().mockReturnValue(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const spec = (name: string): ToolSpec => toolByName(name)!;
const VENUE = 'c0000000-0000-4000-8000-000000000001';
const FILE = '11111111-2222-4333-8444-555555555555';
const GUEST = '99999999-8888-4777-8666-555555555555';

function ctxWith(h: FakeHandlers, over: Partial<Ctx> = {}) {
  const fake = fakeClient(h);
  const ctx: Ctx = {
    asOwner: fake.client,
    scopes: ['money', 'courts', 'cafe', 'engagement', 'files', 'howto'],
    handles: newHandleTable({}),
    tz: 'Asia/Baghdad',
    lang: 'en',
    authorization: 'Bearer owner-jwt',
    ...over,
  };
  return { ctx, fake };
}

const RAW_PG = { code: '22P02', message: 'invalid input syntax for type uuid: "guest-secret-77"', details: 'Token "guest" is invalid.', hint: null };

// ---------------------------------------------------------------------------
describe('runRpcTool', () => {
  it('a database error reaches the model as the code and a fixed sentence; the raw text goes to the log only', async () => {
    const { ctx } = ctxWith({ rpc: () => ({ data: null, error: RAW_PG }) });
    const out = await R.runRpcTool(ctx, spec('report_revenue'), { from: '2026-11-01', to: '2026-11-07' });
    expect(out.isError).toBe(true);
    expect(out.row_count).toBeNull();
    expect(out.cleaned.text).toBe('22P02: the database refused this call (22P02)');
    expect(out.cleaned.text).not.toContain('guest-secret-77');
    expect(out.cleaned.numbers).toEqual([]);
    expect(logged.join('\n')).toContain('guest-secret-77');
  });

  it('a P0001 refusal is our own code and is passed as it is', async () => {
    const { ctx } = ctxWith({ rpc: () => ({ data: null, error: { code: 'P0001', message: 'ASSISTANT_SCOPE_OFF' } }) });
    const out = await R.runRpcTool(ctx, spec('report_revenue'), { from: '2026-11-01', to: '2026-11-07' });
    expect(out.cleaned.text).toBe('ASSISTANT_SCOPE_OFF: ASSISTANT_SCOPE_OFF');
    expect(logged).toEqual([]);
  });

  it('calls assistant_run_tool as the owner with the mapped args, and the turn signal rides on it', async () => {
    const signal = new AbortController().signal;
    const { ctx, fake } = ctxWith({ rpc: () => ({ data: { data: { total_iqd: 125_000 }, row_count: 1 }, error: null }) }, { signal });
    const out = await R.runRpcTool(ctx, spec('report_revenue'), { from: '2026-11-01', to: '2026-11-07' });
    const [op] = fake.rpcs('assistant_run_tool');
    expect(op!.schema).toBe('app');
    expect(op!.args).toEqual({ p_tool: 'report_revenue', p_args: { p_from: '2026-11-01', p_to: '2026-11-07' } });
    expect(op!.signal).toBe(signal);
    expect(out.isError).toBe(false);
    expect(out.row_count).toBe(1);
    expect(out.cleaned.numbers).toContain(125_000);
  });

  it('a list past the cap with no explicit limit is refused towards propose_job, with the total as row_count', async () => {
    const { ctx } = ctxWith({ rpc: () => ({ data: { data: { rows: [], total: 812 }, row_count: 0 }, error: null }) });
    const out = await R.runRpcTool(ctx, spec('bookings_list'), { from: '2026-11-01', to: '2026-11-07' });
    expect(out.isError).toBe(true);
    expect(out.row_count).toBe(812);
    expect(out.cleaned.text).toBe(`more than ${LIST_ROW_CAP} rows (812); call propose_job or narrow the filter`);
  });

  it('the same list with an explicit limit is served', async () => {
    const rows = [{ id: GUEST, status: 'confirmed', price_iqd: 30_000 }];
    const { ctx } = ctxWith({ rpc: () => ({ data: { data: { rows, total: 812 }, row_count: 1 }, error: null }) });
    const out = await R.runRpcTool(ctx, spec('bookings_list'), { from: '2026-11-01', to: '2026-11-07', limit: 1 });
    expect(out.isError).toBe(false);
    expect(out.row_count).toBe(1);
    expect(out.cleaned.text).not.toContain(GUEST); // the id became a handle
  });
});

// ---------------------------------------------------------------------------
describe('runFileRead', () => {
  const meta = (extra: Record<string, unknown> = {}) => ({ data: { data: { id: FILE, name: 'Supplier contract.pdf', note: 'signed', ...extra } }, error: null });
  const gz = (text: string) => new Blob([gzipSync(Buffer.from(text, 'utf8'))]);

  it('a database error is the fixed sentence and nothing is downloaded', async () => {
    const { ctx, fake } = ctxWith({ rpc: () => ({ data: null, error: RAW_PG }) });
    const out = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE });
    expect(out.cleaned.text).toBe('22P02: the database refused this call (22P02)');
    expect(fake.ops.filter((o) => o.kind === 'download')).toEqual([]);
  });

  it('a file with no words is answered from its name and note, readable false, no download', async () => {
    const { ctx, fake } = ctxWith({ rpc: () => meta() });
    const out = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE });
    expect(out.isError).toBe(false);
    expect(out.row_count).toBe(0);
    expect(out.cleaned.text).toContain('Supplier contract.pdf');
    expect(out.cleaned.text).toMatch(/^readable\tn$/m); // clean() lays a false out as n
    expect(out.cleaned.text).toContain('no words could be read');
    expect(out.cleaned.text).not.toContain(FILE);
    expect(fake.ops.filter((o) => o.kind === 'download')).toEqual([]);
    const [op] = fake.rpcs('assistant_run_tool');
    expect(op!.args).toEqual({ p_tool: 'assistant_file_get', p_args: { p_file_id: FILE } });
  });

  it('downloads the gzipped text as the owner from venue-files, unpacks it, and the storage path never reaches the model', async () => {
    const path = `${VENUE}/files/${FILE}.txt.gz`;
    const text = 'Line one of the contract\nTotal due 4,500,000 IQD\nSigned by both parties';
    const { ctx, fake } = ctxWith({ rpc: () => meta({ text_path: path }), download: () => ({ data: gz(text), error: null }) });
    const out = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE });
    const dl = fake.ops.find((o) => o.kind === 'download')!;
    expect(dl.name).toBe('venue-files');
    expect(dl.args).toBe(path);
    expect(out.isError).toBe(false);
    expect(out.row_count).toBe(3);
    expect(out.cleaned.text).toContain('Line one of the contract');
    expect(out.cleaned.text).toContain('Signed by both parties');
    expect(out.cleaned.numbers).toContain(4_500_000);
    expect(out.cleaned.text).not.toContain('.txt.gz');
    expect(out.cleaned.text).not.toContain(FILE);
  });

  it('reads the window the model asked for: offset and chars, with next_offset when there is more', async () => {
    const text = Array.from({ length: 400 }, (_, i) => `row ${i} ${'x'.repeat(20)}`).join('\n');
    const { ctx } = ctxWith({ rpc: () => meta({ text_path: 'p.txt.gz' }), download: () => ({ data: gz(text), error: null }) });
    const first = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE, chars: 1000 });
    expect(first.cleaned.text).toContain('row 0 ');
    expect(first.cleaned.text).not.toContain('row 300 ');
    expect(first.cleaned.text).toMatch(/next_offset/);
    const later = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE, offset: 8000, chars: 1000 });
    expect(later.cleaned.text).not.toContain('row 0 ');
    expect(later.row_count).toBeGreaterThan(0);
  });

  it('a failed download is one fixed sentence; the storage error goes to the log', async () => {
    const { ctx } = ctxWith({ rpc: () => meta({ text_path: 'p.txt.gz' }), download: () => ({ data: null, error: { message: 'Object not found: bucket secret path' } }) });
    const out = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE });
    expect(out).toMatchObject({ isError: true, row_count: null });
    expect(out.cleaned.text).toBe('the file text could not be downloaded');
    expect(logged.join('\n')).toContain('file_read download failed');
  });

  it('a body that is not gzip is "could not be read", logged', async () => {
    const { ctx } = ctxWith({ rpc: () => meta({ text_path: 'p.txt.gz' }), download: () => ({ data: new Blob(['plain, not gzip']), error: null }) });
    const out = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE });
    expect(out.isError).toBe(true);
    expect(out.cleaned.text).toBe('the file text could not be read');
    expect(logged.join('\n')).toContain('file_read unzip failed');
  });

  it('a text past the unpacked cap is refused with FileTextTooLarge\'s own sentence', async () => {
    const huge = gz('a'.repeat(4 * 1024 * 1024 + 10));
    const { ctx } = ctxWith({ rpc: () => meta({ text_path: 'p.txt.gz' }), download: () => ({ data: huge, error: null }) });
    const out = await R.runFileRead(ctx, spec('file_read'), { file_id: FILE });
    expect(out.isError).toBe(true);
    expect(out.cleaned.text).toBe('the stored text is larger than any file the Files page keeps');
  });
});

// ---------------------------------------------------------------------------
describe('runPosthog', () => {
  const input = { template: 'funnel', from: '2026-11-01', to: '2026-11-07', limit: 5 };
  const hourOk = (hour: unknown) => ({ from: (t: string) => (t === 'cafe_settings' ? { data: { value: hour }, error: null } : { data: { id: VENUE }, error: null }) });
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

  it('posts one template to analytics-posthog as the caller, with the branch\'s business day start hour', async () => {
    const fetchMock = respond(200, { configured: true, floor: '2026-10-01', results: { funnel: { columns: ['step', 'users'], rows: [['view', 410], ['cart', 77]] } } });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx, fake } = ctxWith(hourOk(6), { venueScope: VENUE });
    const out = await R.runPosthog(ctx, spec('posthog'), input);
    const settings = fake.froms('cafe_settings')[0]!;
    expect(eqs(settings)).toEqual({ key: 'analytics_business_day_start_hour', venue_id: VENUE });
    expect(fake.froms('venues')).toEqual([]); // the branch in scope, no default-branch read
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('http://edge.test/functions/v1/analytics-posthog');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer owner-jwt');
    expect((init.headers as Record<string, string>).apikey).toBe('anon-key');
    expect(JSON.parse(String(init.body))).toEqual({ queries: [{ name: 'funnel', from: '2026-11-01', to: '2026-11-07', params: { limit: 5 } }], business_day_start_hour: 6 });
    expect(out.isError).toBe(false);
    expect(out.row_count).toBe(2);
    expect(out.cleaned.numbers).toEqual(expect.arrayContaining([410, 77]));
    expect(out.cleaned.text).toContain('engagement_floor');
  });

  it('a failed settings read starts the day at the 0029 default (4) and says so in the log', async () => {
    const fetchMock = respond(200, { results: { funnel: { columns: [], rows: [] } } });
    vi.stubGlobal('fetch', fetchMock);
    const { ctx } = ctxWith({ from: () => ({ data: null, error: { code: '42501', message: 'permission denied' } }) });
    await R.runPosthog(ctx, spec('posthog'), input);
    expect(JSON.parse(String((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body)).business_day_start_hour).toBe(4);
    expect(logged.join('\n')).toContain('default branch unread');
  });

  it('an out-of-range stored hour is replaced by the default', async () => {
    const { ctx } = ctxWith(hourOk(17));
    expect(await R.businessDayStartHour(ctx.asOwner, null)).toBe(4);
    const { ctx: ok } = ctxWith(hourOk(3));
    expect(await R.businessDayStartHour(ok.asOwner, null)).toBe(3);
  });

  it('an HTTP failure names the status only: the body (vendor text) goes to the log', async () => {
    vi.stubGlobal('fetch', respond(502, 'PostHog: personal key phx_SECRET rejected'));
    const { ctx } = ctxWith(hourOk(4));
    const out = await R.runPosthog(ctx, spec('posthog'), input);
    expect(out).toMatchObject({ isError: true, row_count: null });
    expect(out.cleaned.text).toBe('analytics-posthog answered HTTP 502; the analytics query did not run');
    expect(out.cleaned.text).not.toContain('phx_SECRET');
    expect(logged.join('\n')).toContain('phx_SECRET');
  });

  it('an unreachable function is "could not be reached"', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('fetch failed: ECONNREFUSED 10.0.0.9');
    }));
    const { ctx } = ctxWith(hourOk(4));
    const out = await R.runPosthog(ctx, spec('posthog'), input);
    expect(out.cleaned.text).toBe('analytics-posthog could not be reached');
    expect(out.cleaned.text).not.toContain('ECONNREFUSED');
  });

  it('PostHog unconfigured, no result for the template, and PostHog\'s own error string are each a fixed sentence', async () => {
    const { ctx } = ctxWith(hourOk(4));
    vi.stubGlobal('fetch', respond(200, { configured: false }));
    expect((await R.runPosthog(ctx, spec('posthog'), input)).cleaned.text).toBe('PostHog is not configured for this venue');
    vi.stubGlobal('fetch', respond(200, { configured: true, results: {} }));
    expect((await R.runPosthog(ctx, spec('posthog'), input)).cleaned.text).toBe('analytics-posthog returned nothing for funnel');
    vi.stubGlobal('fetch', respond(200, { configured: true, results: { funnel: { error: 'HogQL: column secret_col does not exist' } } }));
    const out = await R.runPosthog(ctx, spec('posthog'), input);
    expect(out).toMatchObject({ isError: true, row_count: null });
    expect(out.cleaned.text).toBe('funnel: PostHog could not answer this query');
    expect(logged.join('\n')).toContain('secret_col');
  });
});

// ---------------------------------------------------------------------------
describe('runSearch', () => {
  it('kinds of scopes that are off: refused before any RPC', async () => {
    const { ctx, fake } = ctxWith({}, { scopes: ['howto'] });
    const out = await R.runSearch(ctx, spec('search'), { query: 'revenue', kinds: ['audit'] });
    expect(out.isError).toBe(true);
    expect(fake.rpcs()).toEqual([]);
  });

  it('with no embedding provider the search runs on text, its figures kept and one note appended', async () => {
    const rows = [{ kind: 'doc', ref: 'pages/reports', title: 'Revenue report', snippet: 'shows 4,250,000 IQD for the week', score: 0.9 }];
    const { ctx, fake } = ctxWith({ rpc: () => ({ data: rows, error: null }) });
    const out = await R.runSearch(ctx, spec('search'), { query: 'weekly revenue' });
    const [op] = fake.rpcs('assistant_search');
    expect((op!.args as { p_embedding: unknown }).p_embedding).toBeNull();
    expect(out.isError).toBe(false);
    expect(out.cleaned.text.endsWith('Search ran on text only (no embedding provider).')).toBe(true);
    expect(out.cleaned.numbers).toContain(4_250_000);
  });

  it('a search RPC error is the safe sentence', async () => {
    const { ctx } = ctxWith({ rpc: () => ({ data: null, error: RAW_PG }) });
    const out = await R.runSearch(ctx, spec('search'), { query: 'weekly revenue' });
    expect(out.cleaned.text).toBe('22P02: the database refused this call (22P02)');
  });
});

// ---------------------------------------------------------------------------
describe('checkPlanCalls', () => {
  const RANGE = { from: '2026-11-01', to: '2026-11-07' };
  const { ctx } = ctxWith({}, { scopes: ['courts', 'howto'] });

  it('steps take list tools with an RPC only', () => {
    expect(R.checkPlanCalls(ctx, [{ tool: 'report_courts', args: RANGE }], 'steps')).toBe('report_courts is not a list tool a job can page');
    expect(R.checkPlanCalls(ctx, [{ tool: 'nope', args: {} }], 'steps')).toBe('nope is not a list tool a job can page');
    expect(R.checkPlanCalls(ctx, [{ tool: 'posthog', args: {} }], 'steps')).toBe('posthog is not a list tool a job can page');
  });

  it('steps drop limit/offset, check the input, the scope and the handles', () => {
    expect(R.checkPlanCalls(ctx, [{ tool: 'bookings_list', args: { ...RANGE, limit: 5, offset: 20 } }], 'steps')).toEqual([{ tool: 'bookings_list', args: RANGE }]);
    expect(R.checkPlanCalls(ctx, [{ tool: 'bookings_list', args: { to: '2026-11-07' } }], 'steps')).toMatch(/^bookings_list: .*from/);
    expect(R.checkPlanCalls(ctx, [{ tool: 'payments_list', args: RANGE }], 'steps')).toMatch(/^payments_list: /);
    expect(R.checkPlanCalls(ctx, [{ tool: 'bookings_list', args: { ...RANGE, customer: 'c9' } }], 'steps')).toMatch(/^Unknown handle c9/);
  });

  it('aggregate_alternative takes any catalog tool, checked the same way, and names its slot', () => {
    expect(R.checkPlanCalls(ctx, [{ tool: 'report_courts', args: RANGE }], 'aggregate_alternative')).toEqual([{ tool: 'report_courts', args: RANGE }]);
    expect(R.checkPlanCalls(ctx, [{ tool: 'ghost', args: {} }], 'aggregate_alternative')).toBe('aggregate_alternative: unknown tool ghost');
    expect(R.checkPlanCalls(ctx, [{ tool: 'report_courts', args: {} }], 'aggregate_alternative')).toMatch(/^aggregate_alternative report_courts: /);
    expect(R.checkPlanCalls(ctx, [{ tool: 'report_revenue', args: RANGE }], 'aggregate_alternative')).toMatch(/^aggregate_alternative report_revenue: /);
  });

  it('skips an entry with no tool name and answers [] for a non-list', () => {
    expect(R.checkPlanCalls(ctx, [{ args: RANGE }, null, 7], 'steps')).toEqual([]);
    expect(R.checkPlanCalls(ctx, 'bookings_list', 'steps')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('runProposeJob', () => {
  const RANGE = { from: '2026-11-01', to: '2026-11-07' };
  const provider = (over: Partial<FakeProvider['capabilities']> = {}): FakeProvider => ({
    model: 'claude-opus-5-5',
    capabilities: { batch: true, exactTokens: true, ...over },
    countTokens: vi.fn(async () => 1234),
  });
  const input = (extra: Record<string, unknown> = {}) => ({
    question: 'Which guests booked most this week?',
    steps: { calls: [{ tool: 'bookings_list', args: { ...RANGE, limit: 3, offset: 9 } }], extract: 'count per guest', reduce: 'top 10' },
    ...extra,
  });
  const jobRpc = (count: number, firstChunk: unknown = { data: { rows: [{ id: GUEST, guest_id: GUEST, status: 'confirmed', price_iqd: 30_000 }], total: count } }): FakeHandlers => ({
    rpc: (name) => (name === 'assistant_count' ? { data: count, error: null } : { data: firstChunk, error: null }),
  });

  it('a steps refusal comes back as an is_error notice, nothing counted', async () => {
    const { ctx, fake } = ctxWith(jobRpc(10), { scopes: ['money', 'howto'] });
    const out = await R.runProposeJob(ctx, provider(), input(), 'en');
    expect(out.isError).toBe(true);
    expect(out.cleaned.text).toMatch(/^bookings_list: /); // courts is off in this chat
    expect(fake.rpcs()).toEqual([]);
  });

  it('no list tool at all is refused', async () => {
    const { ctx } = ctxWith(jobRpc(10));
    const out = await R.runProposeJob(ctx, provider(), input({ steps: { calls: [] } }), 'en');
    expect(out.cleaned.text).toBe('steps.calls must name at least one list tool');
  });

  it('an aggregate_alternative refusal comes back too, nothing counted', async () => {
    const { ctx, fake } = ctxWith(jobRpc(10));
    const out = await R.runProposeJob(ctx, provider(), input({ aggregate_alternative: { calls: [{ tool: 'ghost' }] } }), 'en');
    expect(out.cleaned.text).toBe('aggregate_alternative: unknown tool ghost');
    expect(fake.rpcs()).toEqual([]);
  });

  it('counts as the owner with paging stripped, estimates, and measures the first chunk on the counter', async () => {
    const signal = new AbortController().signal;
    const handles = newHandleTable({});
    const known = handleFor(handles, GUEST, 'c');
    const before = JSON.stringify(toJson(handles));
    const { ctx, fake } = ctxWith(jobRpc(600), { handles, signal });
    const p = provider();
    const out = await R.runProposeJob(
      ctx,
      p,
      input({
        steps: { calls: [{ tool: 'bookings_list', args: { ...RANGE, limit: 3, offset: 9, customer: known } }], extract: 'count per guest', reduce: 'top 10' },
        aggregate_alternative: { calls: [{ tool: 'report_courts', args: RANGE }] },
      }),
      'ar',
    );
    expect(out.isError).toBe(false);
    const [count] = fake.rpcs('assistant_count');
    expect(count!.schema).toBe('app');
    expect(count!.args).toEqual({ p_tool: 'assistant_bookings_list', p_args: { p_from: RANGE.from, p_to: RANGE.to, p_customer_id: GUEST } });
    expect(count!.signal).toBe(signal);
    const [first] = fake.rpcs('assistant_run_tool');
    expect(first!.args).toEqual({ p_tool: 'assistant_bookings_list', p_args: { p_from: RANGE.from, p_to: RANGE.to, p_customer_id: GUEST, p_limit: 250, p_offset: 0 } });
    expect(p.countTokens).toHaveBeenCalledTimes(1);
    const est = out.estimate!;
    expect(est.rows).toBe(600);
    expect(est.chunks).toBe(3);
    expect(est.first_chunk_exact).toBe(1234);
    expect(est.modes.batch).toEqual({ allowed: true });
    expect(est.plan).toMatchObject({ question: 'Which guests booked most this week?', lang: 'ar', extract: 'count per guest', reduce: 'top 10' });
    expect(est.plan.calls).toEqual([{ tool: 'bookings_list', args: { ...RANGE, customer: GUEST } }]);
    expect(est.plan.aggregate_alternative).toEqual({ calls: [{ tool: 'report_courts', args: RANGE }] });
    expect(out.row_count).toBe(600);
    expect(out.cleaned.text).toMatch(/^Job proposed: 600 rows in 3 chunks/);
    // A scratch copy: measuring the chunk minted no handle in the chat's table.
    expect(JSON.stringify(toJson(handles))).toBe(before);
  });

  it('each call is counted with its own args; the job extract model counts tokens when it can be built', async () => {
    const counter = { model: 'claude-sonnet-5-5', capabilities: { batch: true, exactTokens: true }, countTokens: vi.fn(async () => 777) };
    providerMock.providerFromEnv.mockReturnValue(counter);
    const { ctx, fake } = ctxWith(jobRpc(100));
    const chat = provider();
    const out = await R.runProposeJob(
      ctx,
      chat,
      input({ steps: { calls: [{ tool: 'bookings_list', args: RANGE }, { tool: 'bookings_list', args: { ...RANGE, status: 'cancelled' } }] } }),
      'en',
    );
    // Both calls counted, each with its own filter, and each call's count is
    // its own: two 100-row calls of one tool estimate 200 rows, not 400 (the
    // by-tool-name summing was the 2026-11-09 estimator bug).
    expect(fake.rpcs('assistant_count').map((o) => (o.args as { p_args: Record<string, unknown> }).p_args.p_status ?? null)).toEqual([null, 'cancelled']);
    expect(out.estimate!.rows).toBe(200);
    expect(counter.countTokens).toHaveBeenCalledTimes(1);
    expect(chat.countTokens).not.toHaveBeenCalled();
    expect(out.estimate!.first_chunk_exact).toBe(777);
  });

  it('a provider without batch offers live only; an inexact counter leaves first_chunk_exact null', async () => {
    const { ctx } = ctxWith(jobRpc(40));
    const out = await R.runProposeJob(ctx, { ...provider({ batch: false, exactTokens: false }), model: 'openai/gpt-oss-120b' }, input(), 'en');
    expect(out.estimate!.modes.batch).toEqual({ allowed: false, reason: 'batch jobs are not available on openai/gpt-oss-120b; run the job live' });
    expect(out.estimate!.first_chunk_exact).toBeNull();
  });

  it('a failed count is the tool name plus the safe sentence', async () => {
    const { ctx } = ctxWith({ rpc: () => ({ data: null, error: RAW_PG }) });
    const out = await R.runProposeJob(ctx, provider(), input(), 'en');
    expect(out).toMatchObject({ isError: true, row_count: null });
    expect(out.cleaned.text).toBe('bookings_list: 22P02: the database refused this call (22P02)');
  });

  it('a first chunk that cannot be measured still proposes the job, unmeasured, and says why in the log', async () => {
    const { ctx } = ctxWith(jobRpc(40));
    const p = provider();
    p.countTokens = vi.fn(async () => {
      throw new Error('count_tokens 529 overloaded');
    });
    const out = await R.runProposeJob(ctx, p, input(), 'en');
    expect(out.isError).toBe(false);
    expect(out.estimate!.first_chunk_exact).toBeNull();
    expect(logged.join('\n')).toContain('first chunk not measured');
  });

  it('zero rows: nothing to measure, no first-chunk read', async () => {
    const { ctx, fake } = ctxWith(jobRpc(0));
    const out = await R.runProposeJob(ctx, provider(), input(), 'en');
    expect(out.estimate!.chunks).toBe(0);
    expect(fake.rpcs('assistant_run_tool')).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('runStoredTool', () => {
  it('routes posthog to the sibling function, file_read to storage, anything else to assistant_run_tool', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ configured: false })));
    vi.stubGlobal('fetch', fetchMock);
    const { ctx, fake } = ctxWith({
      rpc: (_n, args) => (args.p_tool === 'assistant_file_get' ? { data: { data: { name: 'x', text_path: 'p.txt.gz' } }, error: null } : { data: { data: { total_iqd: 1 } }, error: null }),
      from: () => ({ data: { value: 4, id: VENUE }, error: null }),
      download: () => ({ data: new Blob([gzipSync(Buffer.from('hello'))]), error: null }),
    });
    await R.runStoredTool(ctx, spec('posthog'), { template: 'funnel', from: '2026-11-01', to: '2026-11-07' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fake.rpcs()).toEqual([]);
    await R.runStoredTool(ctx, spec('file_read'), { file_id: FILE });
    expect(fake.ops.some((o) => o.kind === 'download')).toBe(true);
    await R.runStoredTool(ctx, spec('report_revenue'), { from: '2026-11-01', to: '2026-11-07' });
    expect(fake.rpcs('assistant_run_tool').map((o) => (o.args as { p_tool: string }).p_tool)).toEqual(['assistant_file_get', 'report_revenue']);
  });
});
