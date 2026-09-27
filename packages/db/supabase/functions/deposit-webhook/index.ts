/**
 * deposit-webhook — Qi Card's notificationUrl (plan §4; developers-gate.qi.iq
 * "Webhook Notifications", checked 2026-09-27).
 *
 *   POST (from Qi, no JWT)  the payment object; header X-Signature
 *     → 200 { ok }   processed, or a payment we can never match (so Qi stops)
 *     → 401          signature present but wrong, or wrong key: logged, not applied
 *     → 400          not JSON
 *     → 500          our database or Qi's status call failed: Qi retries
 *
 * WHY verify_jwt = false: Qi carries no Supabase JWT. Authenticity is Qi's
 * RSA signature over `paymentId|amount.000|currency|creationDate|status`,
 * verified with QI_WEBHOOK_PUBLIC_KEY_PEM (QI_SANDBOX_WEBHOOK_PUBLIC_KEY_PEM
 * for a sandbox payment).
 *
 * The body is never the truth on its own. For every payment we can match we
 * ask Qi's status endpoint (with OUR credentials) and apply THAT answer, as
 * Qi's own docs advise. So until Qi hands over its public key, an unsigned
 * webhook is still useful as a hint ("go and look now") and cannot be used
 * to forge a payment: a forger can only make us check. With a key set, a bad
 * signature is refused outright. Only when Qi's status call fails do we fall
 * back to the body, and only a body whose signature verified.
 *
 * Local stack only: the payments-fake page signs its notifications with an
 * HMAC of the service role key (X-Fake-Signature) instead.
 */
import { OPEN, PAID, applyGateway, checkNow, describe, isUuid, loadPayment, type PaymentRow } from '../_shared/deposits.ts';
import { json } from '../_shared/http.ts';
import {
  isLocalRuntime,
  redactGatewayMessage,
  verifyFakeSignature,
  verifyQiWebhook,
  webhookKeyFromEnv,
} from '../_shared/payments/index.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const env = (name: string) => Deno.env.get(name);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST' }, 405);
  const raw = await req.text();
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
    payload = parsed as Record<string, unknown>;
  } catch {
    return json({ error: 'BAD_REQUEST' }, 400);
  }

  const service = createServiceClient();
  const requestId = isUuid(payload.requestId) ? payload.requestId : null;
  const paymentId = typeof payload.paymentId === 'string' && payload.paymentId ? payload.paymentId : null;
  const status = typeof payload.status === 'string' ? payload.status : null;
  const kept = redactGatewayMessage(payload);

  let row: PaymentRow | null;
  try {
    row = await loadPayment(service, { requestId, paymentId });
  } catch (error) {
    console.error(`[deposit-webhook] lookup: ${describe(error)}`);
    return json({ error: 'INTERNAL' }, 500);
  }

  // ── authenticity ──────────────────────────────────────────────────────────
  let signatureOk: boolean | null = null;
  const fakeSig = req.headers.get('X-Fake-Signature');
  if (fakeSig && isLocalRuntime(env) && (!row || row.provider === 'fake')) {
    signatureOk = await verifyFakeSignature(env('SUPABASE_SERVICE_ROLE_KEY') ?? '', raw, fakeSig);
  } else {
    const keys = row
      ? [webhookKeyFromEnv(env, row.sandbox)]
      : [webhookKeyFromEnv(env, false), webhookKeyFromEnv(env, true)];
    const usable = keys.filter((k): k is string => !!k);
    if (usable.length) {
      signatureOk = false;
      for (const key of usable) {
        const verdict = await verifyQiWebhook({ publicKeyPem: key, signature: req.headers.get('X-Signature'), payload });
        if (verdict.ok) {
          signatureOk = true;
          break;
        }
      }
    }
  }

  const log = (note: string | null, sig: boolean | null) =>
    service.schema('app').rpc('deposit_log_event', {
      p_request_id: row?.request_id ?? requestId,
      p_source: 'webhook',
      p_provider_status: status,
      p_signature_ok: sig,
      p_note: note,
      p_raw: kept,
    });

  if (signatureOk === false) {
    console.warn(`[deposit-webhook] bad signature for ${paymentId ?? requestId ?? '?'}`);
    await log('signature refused', false);
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  if (!row) {
    // Never ours (or not yet visible): record it and let Qi stop.
    const { error } = await log('unmatched', signatureOk);
    if (error) return json({ error: 'INTERNAL' }, 500);
    return json({ ok: true, matched: false });
  }

  // A settled payment: the message is logged; nothing to ask.
  if (PAID.has(row.status) && status !== 'SUCCESS') {
    const { error } = await log(null, signatureOk);
    return error ? json({ error: 'INTERNAL' }, 500) : json({ ok: true });
  }

  try {
    const after = await checkNow(env, service, row, 'webhook', signatureOk);
    if (after === null) {
      // Qi's status call gave no answer. A verified body is Qi's word; an
      // unverified one is only a hint, so ask Qi to send it again later.
      if (signatureOk === true && status) {
        await applyGateway(
          service,
          row.request_id,
          {
            paymentId: paymentId ?? row.provider_payment_id,
            status,
            amount:
              typeof payload.confirmedAmount === 'number'
                ? payload.confirmedAmount
                : typeof payload.amount === 'number'
                  ? payload.amount
                  : null,
            currency: typeof payload.currency === 'string' ? payload.currency : null,
            canceled: payload.canceled === true,
            raw: kept,
          },
          'webhook',
          true,
        );
        return json({ ok: true });
      }
      if (OPEN.has(row.status) || status === 'SUCCESS') return json({ error: 'RETRY_LATER' }, 500);
      await log(null, signatureOk);
    }
  } catch (error) {
    console.error(`[deposit-webhook] apply ${row.request_id}: ${describe(error)}`);
    return json({ error: 'INTERNAL' }, 500);
  }
  return json({ ok: true });
});
