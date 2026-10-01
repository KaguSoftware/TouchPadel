/**
 * deposit-begin — the guest taps "Pay now" on Review (plan §4, contracts §3).
 *
 *   POST (guest JWT)  { hold_id: uuid, locale: 'en' | 'ar' }
 *     → 200 { request_id, form_url, amount_iqd, deadline_at, status: 'pending' }
 *     → { error: CODE } 400 BAD_REQUEST | PHONE_REQUIRED, 401 AUTH_REQUIRED,
 *       403 FORBIDDEN, 404 HOLD_NOT_FOUND, 409 HOLD_EXPIRED | DEPOSITS_OFF,
 *       429 TOO_MANY_ATTEMPTS, 503 PROVIDER_UNAVAILABLE | DEGRADED_LOCKOUT | RETRY_LATER
 *
 * 1. app.deposit_prepare records the attempt (or hands back the live one on
 *    this hold: a double tap opens the same page) and stretches the hold to the
 *    payment window.
 * 2. The gateway creates the payment with OUR request_id. If that call dies
 *    after the gateway made the payment, the next tap reuses the same
 *    request_id; the gateway answers "already used" and we look it up instead
 *    of creating a second one.
 * 3. app.deposit_mark_created stores the gateway's id and page URL.
 *
 * Nothing here can mark a payment paid or failed: the webhook, the payment
 * screen's polls and the reconciler do, through app.deposit_apply.
 */
import { createAtGateway, isUuid } from '../_shared/deposits.ts';
import { isRetryablePgError, json } from '../_shared/http.ts';
import { configuredProviderName } from '../_shared/payments/index.ts';
import { createServiceClient, getCallerUserId } from '../_shared/supabase.ts';

const env = (name: string) => Deno.env.get(name);

const REFUSAL_STATUS: Record<string, number> = {
  AUTH_REQUIRED: 401,
  FORBIDDEN: 403,
  HOLD_NOT_FOUND: 404,
  HOLD_EXPIRED: 409,
  DEPOSITS_OFF: 409,
  PHONE_REQUIRED: 400,
  TOO_MANY_ATTEMPTS: 429,
  DEGRADED_LOCKOUT: 503,
  INVALID_ARGUMENT: 400,
};

const unavailable = () => json({ error: 'PROVIDER_UNAVAILABLE' }, 503);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST', message: 'POST only' }, 405);

  let body: { hold_id?: unknown; locale?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  if (!isUuid(body.hold_id)) return json({ error: 'BAD_REQUEST', message: 'hold_id must be a uuid' }, 400);
  const locale = body.locale === 'en' ? 'en' : 'ar';

  const service = createServiceClient();
  const uid = await getCallerUserId(req, service);
  if (!uid) return json({ error: 'AUTH_REQUIRED' }, 401);

  // No usable gateway: refuse before recording anything, so an unconfigured
  // project never burns a guest's attempts. The app offers pay-at-the-desk.
  const providerName = configuredProviderName(env);
  if (!providerName) {
    console.error('[deposit-begin] no payment provider configured (see docs/client/qi-card-activation.md)');
    return unavailable();
  }

  const prep = await service.schema('app').rpc('deposit_prepare', {
    p_guest_id: uid,
    p_hold_id: body.hold_id,
    p_locale: locale,
    p_provider: providerName,
  });
  if (prep.error) {
    if (isRetryablePgError(prep.error)) return json({ error: 'RETRY_LATER' }, 503);
    const code = prep.error.message ?? 'INTERNAL';
    if (code in REFUSAL_STATUS) return json({ error: code }, REFUSAL_STATUS[code]);
    console.error(`[deposit-begin] deposit_prepare failed: ${code}`);
    return json({ error: 'INTERNAL' }, 500);
  }
  const row = prep.data as {
    request_id: string;
    status: string;
    provider: string;
    sandbox: boolean;
    amount_iqd: number;
    deadline_at: string;
    form_url: string | null;
    provider_payment_id: string | null;
    locale: 'en' | 'ar';
    reservation_id: string;
    guest_phone: string | null;
  };
  const ok = (formUrl: string) =>
    json({
      request_id: row.request_id,
      form_url: formUrl,
      amount_iqd: row.amount_iqd,
      deadline_at: row.deadline_at,
      status: 'pending',
    });

  if (row.status === 'pending' && row.form_url) return ok(row.form_url);

  // The gateway half, shared with ticket-begin (_shared/deposits.ts).
  const created = await createAtGateway(service, env, row, uid, {
    reservation_id: row.reservation_id,
    request_id: row.request_id,
  });
  if ('error' in created) {
    return created.error === 'PROVIDER_UNAVAILABLE'
      ? unavailable()
      : json({ error: created.error }, created.error === 'RETRY_LATER' ? 503 : 500);
  }
  return ok(created.formUrl);
});
