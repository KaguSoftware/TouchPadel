/**
 * deposit-reconcile — the payment sweeper (plan §4). Called by pg_cron through
 * app.deposit_nudge (tp_deposit_sweep, every 30 s) and nudged right after a
 * refund is requested.
 *
 *   POST (service role only)  {}
 *     → 200 { checked, cancelled, refunded, refund_failed, errors }
 *     → 403 for any other caller
 *
 * For each payment app.deposits_due_for_reconcile claims (60 s lease):
 *   check   open past its deadline, or pending and unheard for 90 s: ask the
 *           gateway and apply. Still open past the deadline → cancel it at the
 *           gateway and apply what it says; three failed cancels → GIVE_UP
 *           (expired; a SUCCESS that still arrives later is honoured).
 *   refund  refund_pending: send the refund with the request id minted when
 *           it was requested (so a retry is the same refund), then
 *           app.deposit_refund_apply. A refund the gateway says it already
 *           has, but whose outcome we never saw, is refund_failed: a manager
 *           checks the gateway's dashboard instead of us guessing.
 *
 * Bounded: 50 rows and a 45 s budget, under the cron's 60 s lease.
 */
import { applyGateway, checkNow, describe, loadPayment, providerFor, synthetic } from '../_shared/deposits.ts';
import { handle, json, logError } from '../_shared/http.ts';
import { PaymentProviderError } from '../_shared/payments/index.ts';
import { createServiceClient, isServiceRoleRequest } from '../_shared/supabase.ts';

const env = (name: string) => Deno.env.get(name);
const BUDGET_MS = 45_000;
const MAX_CANCEL_ATTEMPTS = 3;

interface DueRow {
  id: string;
  action: 'check' | 'refund';
  request_id: string;
  provider: string;
  sandbox: boolean;
  provider_payment_id: string | null;
  status: string;
  amount_iqd: number;
  deadline_at: string;
  cancel_attempts: number;
  refund_request_id: string | null;
  refund_amount_iqd: number | null;
  refund_reason: string | null;
  /** 0258: 'ticket' for a purchase of open-match tickets (a cash-out or a DF-20 refund). */
  purpose: 'deposit' | 'ticket';
  ticket_count: number | null;
}

Deno.serve(handle('deposit-reconcile', async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST' }, 405);
  if (!isServiceRoleRequest(req)) return json({ error: 'FORBIDDEN' }, 403);

  const started = Date.now();
  const service = createServiceClient();
  const tally = { checked: 0, cancelled: 0, refunded: 0, refund_failed: 0, errors: 0 };

  const due = await service.schema('app').rpc('deposits_due_for_reconcile', { p_limit: 50 });
  if (due.error) {
    console.error(`[deposit-reconcile] claim: ${due.error.message}`);
    return json({ error: 'INTERNAL' }, 500);
  }

  for (const row of (due.data ?? []) as DueRow[]) {
    if (Date.now() - started > BUDGET_MS) break; // the lease hands the rest to the next run
    try {
      if (row.action === 'check') await check(row, tally);
      else await refund(row, tally);
    } catch (error) {
      tally.errors++;
      console.error(`[deposit-reconcile] ${row.action} ${row.request_id}: ${describe(error)}`);
    }
  }
  return json(tally);

  async function check(row: DueRow, t: typeof tally) {
    t.checked++;
    const full = await loadPayment(service, { requestId: row.request_id });
    if (!full) return;
    const after = await checkNow(env, service, full, 'reconcile');
    const stillOpen = after === null ? ['created', 'pending'].includes(full.status) : ['created', 'pending'].includes(after);
    if (!stillOpen || new Date(full.deadline_at).getTime() > Date.now()) return;

    // Past our window and the gateway still has it open: cancel it there.
    const paymentId = full.provider_payment_id;
    if (!paymentId) return; // created, never reached the gateway: checkNow expires it when NOT_FOUND
    const provider = providerFor(env, service, full);
    try {
      const cancelled = await provider.cancel(paymentId, crypto.randomUUID());
      t.cancelled++;
      await applyGateway(service, full.request_id, cancelled, 'reconcile');
    } catch (error) {
      console.warn(`[deposit-reconcile] cancel ${full.request_id}: ${describe(error)}`);
      const n = await service.schema('app').rpc('deposit_note_cancel_attempt', { p_payment_id: full.id });
      if (n.error) logError('deposit-reconcile', n.error, `cancel attempt not counted for ${full.request_id}`);
      if (!n.error && Number(n.data) >= MAX_CANCEL_ATTEMPTS) {
        // One last look: a payment that turned SUCCESS meanwhile is applied as such.
        const last = await checkNow(env, service, full, 'reconcile');
        if (last === null || ['created', 'pending'].includes(last)) {
          await applyGateway(service, full.request_id, synthetic('GIVE_UP', paymentId), 'reconcile');
        }
      }
    }
  }

  async function refund(row: DueRow, t: typeof tally) {
    const outcome = async (o: 'succeeded' | 'failed' | 'pending' | 'unknown', providerStatus: string | null, refundId: string | null, raw: Record<string, unknown>) => {
      const res = await service.schema('app').rpc('deposit_refund_apply', {
        p_payment_id: row.id,
        p_outcome: o,
        p_provider_status: providerStatus,
        p_refund_provider_id: refundId,
        p_raw: raw,
      });
      if (res.error) throw res.error;
      if (o === 'succeeded') t.refunded++;
      if (o === 'failed') t.refund_failed++;
    };

    if (!row.provider_payment_id || !row.refund_request_id || !row.refund_amount_iqd) {
      await outcome('failed', 'NO_PAYMENT_ID', null, { reason: 'the gateway never gave this payment an id' });
      return;
    }
    const provider = providerFor(env, service, row);
    try {
      const r = await provider.refund({
        paymentId: row.provider_payment_id,
        refundRequestId: row.refund_request_id,
        amountIqd: Number(row.refund_amount_iqd),
        message: `Touch Padel ${row.purpose === 'ticket' ? 'ticket' : 'deposit'} refund (${row.refund_reason ?? 'refund'})`,
      });
      const s = r.status.toUpperCase();
      await outcome(s === 'SUCCESS' ? 'succeeded' : s === 'FAILED' ? 'failed' : 'pending', r.status, r.refundId, r.raw);
    } catch (error) {
      if (error instanceof PaymentProviderError) {
        if (error.kind === 'refused' || error.kind === 'already_used' || error.kind === 'not_found') {
          await outcome('failed', `CODE_${error.code ?? error.kind}`, null, { error: error.message });
          return;
        }
      }
      console.warn(`[deposit-reconcile] refund ${row.request_id}: ${describe(error)}`);
      await outcome('unknown', null, null, { error: describe(error) });
    }
  }
}));
