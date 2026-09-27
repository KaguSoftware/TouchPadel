/**
 * receipt-scan (Phase 2, Milestone 4b): reads one photographed paper with the
 * connected model and stores the lines for review.
 *
 *   POST {receipt_id}   a supplier receipt: the driver who filed it, or MGMT at its branch
 *   POST {slip_id}      a waiter's order slip: the staff member who took it, or the
 *                       cashier, a manager or the owner at its branch
 *
 * The model is whatever _shared/receipts/connect.ts returns (RECEIPT_READER=fake
 * for the stand-in, local stacks only); one connection reads both kinds. 200
 * {status:'read', lines, matched}; 503 RECEIPT_READER_NOT_CONFIGURED; 429
 * LLM_MONTHLY_CAP / LLM_DAILY_QUOTA / SCAN_REREAD_LIMIT / SCAN_USER_DAILY_LIMIT;
 * 409 RECEIPT_BUSY / RECEIPT_ALREADY_DONE (SLIP_BUSY / SLIP_ALREADY_DONE) /
 * READING_SUPERSEDED; 404 RECEIPT_NOT_FOUND / SLIP_NOT_FOUND; 502/422/500
 * RECEIPT_READ_FAILED {code}; 500 INTERNAL (no detail). The flow is in scan.ts, pure.
 *
 * verify_jwt = true (config.toml).
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';
import { json } from '../_shared/http.ts';
import { requireStaffRole } from '../_shared/auth.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { readerFromEnv, type ScanKind } from '../_shared/receipts/index.ts';
import { PortError, SCAN_SURFACE, scanReceipt, type ScanPorts } from './scan.ts';

const STAFF_BUCKET = 'staff-media';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per kind: who may ask, and the RPCs behind the ports. */
const KINDS: Record<ScanKind, {
  roles: string[];
  detail: string;
  begin: string;
  store: string;
  fail: string;
  names: string;
  notFound: string;
}> = {
  receipt: {
    roles: ['driver', 'manager', 'owner'],
    detail: 'receipt_detail',
    begin: 'receipt_begin_reading',
    store: 'receipt_store_reading',
    fail: 'receipt_fail_reading',
    names: 'supplier_names',
    notFound: 'RECEIPT_NOT_FOUND',
  },
  order_slip: {
    roles: ['waiter', 'cashier', 'manager', 'owner'],
    detail: 'slip_detail',
    begin: 'slip_begin_reading',
    store: 'slip_store_reading',
    fail: 'slip_fail_reading',
    names: 'menu_names',
    notFound: 'SLIP_NOT_FOUND',
  },
};

function callerClient(req: Request): SupabaseClient {
  return createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: req.headers.get('Authorization')! } },
  });
}

const log = (message: string) => console.error('[receipt-scan]', message);

function ports(service: SupabaseClient, kind: ScanKind, requestedBy: string): ScanPorts {
  const k = KINDS[kind];
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    const { data, error } = await service.schema('app').rpc(fn, args);
    if (error) throw new PortError(error.message, `${fn}: ${error.message}`);
    return data;
  };
  return {
    kind,
    async beginReading(id) {
      const data = (await rpc(k.begin, { p_id: id, p_requested_by: requestedBy })) as Record<string, unknown>;
      const names = data[k.names];
      return {
        storage_path: String(data.storage_path ?? ''),
        names: Array.isArray(names) ? names.filter((n): n is string => typeof n === 'string') : [],
        token: typeof data.reading_token === 'string' ? data.reading_token : null,
      };
    },
    reader: readerFromEnv((n) => Deno.env.get(n), log),
    llmBegin: async () => {
      await rpc('llm_begin_request', {});
    },
    async download(path) {
      const { data, error } = await service.storage.from(STAFF_BUCKET).download(path);
      if (error || !data) throw new Error(`download ${path}: ${error?.message ?? 'no data'}`);
      return new Uint8Array(await data.arrayBuffer());
    },
    storeReading: async (id, reading, model, token) =>
      (await rpc(k.store, { p_id: id, p_reading: reading, p_model: model, p_token: token })) as {
        lines: number;
        matched: number;
      },
    failReading: async (id, code, status, token) => {
      await rpc(k.fail, { p_id: id, p_code: code, p_status: status, p_token: token });
    },
    async recordUsage(model, usage) {
      const { error } = await service.schema('app').rpc('llm_record_usage', {
        p_model: model,
        p_input: usage.input,
        p_cache_write: usage.cache_write ?? 0,
        p_cache_read: usage.cache_read ?? 0,
        p_output: usage.output,
        p_model_calls: 1,
        p_surface: SCAN_SURFACE[kind],
      });
      if (error) log(`usage not recorded: ${error.message}`);
    },
    log,
  };
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST', message: 'POST only' }, 405);
  let body: { receipt_id?: unknown; slip_id?: unknown } = {};
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const kind: ScanKind | null = typeof body.slip_id === 'string' ? 'order_slip' : typeof body.receipt_id === 'string' ? 'receipt' : null;
  const id = kind === 'order_slip' ? String(body.slip_id) : String(body.receipt_id ?? '');
  if (!kind || !UUID_RE.test(id)) {
    return json({ error: 'BAD_REQUEST', message: 'receipt_id or slip_id must be a uuid' }, 400);
  }
  const k = KINDS[kind];

  const service = createServiceClient();
  const auth = await requireStaffRole(req, service, k.roles);
  if (auth instanceof Response) return auth;

  // The caller's own view decides: the uploader, or the right roles at the paper's branch.
  // Only "not yours / not there" is a 404; anything else is the database failing.
  const seen = await callerClient(req).schema('app').rpc(k.detail, { p_id: id });
  if (seen.error) {
    if ([k.notFound, 'FORBIDDEN'].includes(seen.error.message)) return json({ error: k.notFound }, 404);
    log(`${k.detail} ${id}: ${seen.error.message}`);
    return json({ error: 'INTERNAL' }, 500);
  }

  try {
    const res = await scanReceipt(ports(service, kind, auth.userId), id);
    return json(res.body, res.status);
  } catch (e) {
    // Logged in full; the caller gets no database or vendor text.
    log(`failed ${id}: ${e instanceof Error ? e.message : String(e)}`);
    return json({ error: 'INTERNAL' }, 500);
  }
});
