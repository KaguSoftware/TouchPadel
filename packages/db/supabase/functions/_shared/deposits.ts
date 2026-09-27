/**
 * The deposit edge functions' shared glue: load a payment row, pick its
 * gateway, ask the gateway what happened and hand the answer to
 * app.deposit_apply (0242), the only writer of a payment's outcome.
 *
 * Never decides anything itself. A gateway that does not answer leaves the
 * row as it was (the no-false-negative rule, plan §3.2): the next poll, the
 * webhook or the reconciler asks again.
 */
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2';
import {
  FAKE_PAYMENT_PREFIX,
  PaymentProviderError,
  fakePageUrl,
  paymentsFromEnv,
  type EnvGetter,
  type FakeStore,
  type GatewayPayment,
  type PaymentProvider,
} from './payments/index.ts';

export interface PaymentRow {
  id: string;
  request_id: string;
  provider: string;
  sandbox: boolean;
  provider_payment_id: string | null;
  status: string;
  amount_iqd: number;
  deadline_at: string;
  last_checked_at: string | null;
  locale: 'en' | 'ar';
  created_at: string;
  hold_id: string;
  reservation_id: string;
}

const ROW_COLUMNS =
  'id, request_id, provider, sandbox, provider_payment_id, status, amount_iqd, deadline_at, last_checked_at, locale, created_at, hold_id, reservation_id';

export const OPEN = new Set(['created', 'pending']);
export const PAID = new Set(['succeeded', 'refund_pending', 'refund_failed', 'refunded']);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID.test(v);

export async function loadPayment(
  service: SupabaseClient,
  by: { requestId?: string | null; paymentId?: string | null },
): Promise<PaymentRow | null> {
  if (by.requestId && isUuid(by.requestId)) {
    const { data, error } = await service.from('booking_payments').select(ROW_COLUMNS).eq('request_id', by.requestId).maybeSingle();
    if (error) throw error;
    if (data) return data as PaymentRow;
  }
  if (by.paymentId) {
    const { data, error } = await service
      .from('booking_payments')
      .select(ROW_COLUMNS)
      .eq('provider_payment_id', by.paymentId)
      .maybeSingle();
    if (error) throw error;
    if (data) return data as PaymentRow;
  }
  return null;
}

/** The pretend bank's memory, for the local `fake` provider: events noted 'fake:outcome'. */
export function fakeStoreFor(service: SupabaseClient): FakeStore {
  const byRequestId = async (requestId: string) => {
    if (!isUuid(requestId)) return null;
    const { data: row } = await service
      .from('booking_payments')
      .select('id, request_id, provider_payment_id, amount_iqd, created_at')
      .eq('request_id', requestId)
      .maybeSingle();
    if (!row) return null;
    const { data: ev } = await service
      .from('booking_payment_events')
      .select('provider_status, raw')
      .eq('payment_id', row.id)
      .eq('note', 'fake:outcome')
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    return {
      requestId: row.request_id as string,
      paymentId: (row.provider_payment_id as string | null) ?? null,
      amountIqd: Number(row.amount_iqd),
      outcome: (ev?.provider_status as string | undefined) ?? null,
      canceled: (ev?.raw as { canceled?: boolean } | undefined)?.canceled === true,
      createdAt: String(row.created_at).slice(0, 19),
    };
  };
  return {
    byRequestId,
    byPaymentId: (paymentId) =>
      paymentId.startsWith(FAKE_PAYMENT_PREFIX) ? byRequestId(paymentId.slice(FAKE_PAYMENT_PREFIX.length)) : Promise.resolve(null),
    async setOutcome(requestId, outcome, canceled) {
      const { error } = await service.schema('app').rpc('deposit_log_event', {
        p_request_id: requestId,
        p_source: 'webhook',
        p_provider_status: outcome,
        p_signature_ok: null,
        p_note: 'fake:outcome',
        p_raw: { canceled },
      });
      if (error) throw error;
    },
  };
}

export function providerFor(get: EnvGetter, service: SupabaseClient, row: { provider: string; sandbox: boolean }): PaymentProvider {
  return paymentsFromEnv(get, {
    provider: row.provider,
    sandbox: row.sandbox,
    fakeStore: row.provider === 'fake' ? fakeStoreFor(service) : undefined,
    fakePageUrl: fakePageUrl(get),
  });
}

export type ApplySource = 'webhook' | 'poll' | 'reconcile';

/** Hand one gateway answer to app.deposit_apply. Returns the payment's status after it. */
export async function applyGateway(
  service: SupabaseClient,
  requestId: string,
  p: Pick<GatewayPayment, 'status' | 'amount' | 'currency' | 'canceled' | 'raw'> & { paymentId: string | null },
  source: ApplySource,
  signatureOk: boolean | null = null,
): Promise<string | null> {
  const { data, error } = await service.schema('app').rpc('deposit_apply', {
    p_request_id: requestId,
    p_provider_payment_id: p.paymentId || null,
    p_provider_status: p.status,
    p_amount: p.amount,
    p_currency: p.currency,
    p_canceled: p.canceled,
    p_source: source,
    p_signature_ok: signatureOk,
    p_raw: p.raw,
  });
  if (error) throw error;
  return ((data as { status?: string } | null)?.status as string | undefined) ?? null;
}

/** A synthetic answer we decided ourselves (NOT_FOUND after the deadline, GIVE_UP after three failed cancels). */
export function synthetic(status: 'NOT_FOUND' | 'GIVE_UP', paymentId: string | null) {
  return { paymentId, status, amount: null, currency: null, canceled: false, raw: { synthetic: status } };
}

/**
 * Ask the gateway where this payment stands and apply the answer.
 * Returns the status after applying, or null when the gateway gave no answer
 * (nothing was changed).
 */
export async function checkNow(
  get: EnvGetter,
  service: SupabaseClient,
  row: PaymentRow,
  source: ApplySource,
  signatureOk: boolean | null = null,
): Promise<string | null> {
  const provider = providerFor(get, service, row);
  let answer: GatewayPayment;
  try {
    answer = row.provider_payment_id
      ? await provider.status(row.provider_payment_id, row.request_id)
      : await provider.statusByRequest(row.request_id);
  } catch (error) {
    if (error instanceof PaymentProviderError && error.kind === 'not_found' && !row.provider_payment_id
        && new Date(row.deadline_at).getTime() <= Date.now()) {
      // Create never reached the gateway and the window is over: nothing to wait for.
      return applyGateway(service, row.request_id, synthetic('NOT_FOUND', null), source, signatureOk);
    }
    console.warn(`[deposits] ${source}: no answer for ${row.request_id}: ${describe(error)}`);
    return null;
  }
  return applyGateway(service, row.request_id, answer, source, signatureOk);
}

export function describe(error: unknown): string {
  if (error instanceof PaymentProviderError) return `${error.provider} ${error.kind}: ${error.message}`;
  if (error && typeof error === 'object' && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}
