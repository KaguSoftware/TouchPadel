/**
 * deposit-status — what the app's payment screen polls (plan §5.3, contracts §3).
 *
 *   POST (guest JWT)  { ref: uuid }   (ref = booking_payments.request_id)
 *     → 200 the app.deposit_status JSON (contracts §2.2)
 *     → { error } 400 BAD_REQUEST, 401 AUTH_REQUIRED, 404 PAYMENT_NOT_FOUND
 *
 * Reads as the CALLER (their JWT), so app.deposit_status's ownership check
 * decides what they may see. When the attempt is still open and nobody asked
 * the gateway in the last 3 seconds, asks it now and applies the answer
 * (source 'poll'): this is what makes a lost webhook harmless. A gateway that
 * does not answer changes nothing; the screen keeps showing "checking".
 */
import { createClient } from 'npm:@supabase/supabase-js@2';
import { OPEN, checkNow, describe, isUuid, loadPayment } from '../_shared/deposits.ts';
import { isRetryablePgError, json } from '../_shared/http.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const env = (name: string) => Deno.env.get(name);
const RECHECK_MS = 3_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST', message: 'POST only' }, 405);
  const authorization = req.headers.get('Authorization') ?? '';
  if (!authorization.startsWith('Bearer ')) return json({ error: 'AUTH_REQUIRED' }, 401);

  let body: { ref?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  if (!isUuid(body.ref)) return json({ error: 'BAD_REQUEST', message: 'ref must be a uuid' }, 400);
  const ref = body.ref;

  const caller = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const read = () => caller.schema('app').rpc('deposit_status', { p_request_id: ref });

  let res = await read();
  if (res.error) {
    const code = res.error.message;
    if (code === 'PAYMENT_NOT_FOUND') return json({ error: code }, 404);
    if (code === 'AUTH_REQUIRED') return json({ error: code }, 401);
    if (isRetryablePgError(res.error)) return json({ error: 'RETRY_LATER' }, 503);
    console.error(`[deposit-status] deposit_status: ${code}`);
    return json({ error: 'INTERNAL' }, 500);
  }

  const status = (res.data as { status?: string } | null)?.status ?? '';
  if (OPEN.has(status)) {
    const service = createServiceClient();
    try {
      const row = await loadPayment(service, { requestId: ref });
      const last = row?.last_checked_at ? new Date(row.last_checked_at).getTime() : 0;
      if (row && Date.now() - last >= RECHECK_MS) {
        const after = await checkNow(env, service, row, 'poll');
        if (after && after !== status) res = await read();
      }
    } catch (error) {
      // The last known state is still the truth we have; never a failure.
      console.warn(`[deposit-status] check ${ref}: ${describe(error)}`);
    }
  }

  if (res.error) return json({ error: 'RETRY_LATER' }, 503);
  return json(res.data);
});
