/**
 * deposit-webhook — Qi Card's notificationUrl (plan §4; developers-gate.qi.iq
 * "Webhook Notifications", checked 2026-09-27).
 *
 *   POST (from Qi, no JWT)  the payment object; header X-Signature
 *     → 200 { ok }   processed, or a payment we can never match (so Qi stops)
 *     → 401          signature present but wrong, or wrong key: logged, not applied
 *     → 400          not JSON
 *     → 413          body over 64 KB
 *     → 500          our database or Qi's status call failed: Qi retries
 *
 * WHY verify_jwt = false: Qi carries no Supabase JWT. Authenticity is Qi's
 * RSA signature over `paymentId|amount.000|currency|creationDate|status`,
 * verified with QI_WEBHOOK_PUBLIC_KEY_PEM (QI_SANDBOX_WEBHOOK_PUBLIC_KEY_PEM
 * for a sandbox payment).
 *
 * The signature is checked FIRST, against both keys, before any database
 * access: a bad one is refused with 401 and a console warning, and no event
 * row is written (an unauthenticated caller cannot fill the events table).
 * After the lookup the row's own key must be the one that verified.
 *
 * Only those five fields are signed, so the body is matched and applied with
 * them (logic.ts): the row is found by the signed paymentId first, and by the
 * unsigned requestId only when no row carries that payment id yet; a row the
 * requestId names that already belongs to ANOTHER payment is refused (200
 * matched:false, so Qi stops; an event row records it).
 *
 * The body is never the truth on its own. For every payment we can match we
 * ask Qi's status endpoint (with OUR credentials) and apply THAT answer, as
 * Qi's own docs advise. So until Qi hands over its public key, an unsigned
 * webhook is still useful as a hint ("go and look now") and cannot be used
 * to forge a payment: a forger can only make us check. Only when Qi's status
 * call fails do we fall back to the body, and only a body whose signature
 * verified, for a row that already carries its paymentId, with the signed
 * `amount` (never the unsigned `confirmedAmount`).
 *
 * Local stack only: the payments-fake page signs its notifications with an
 * HMAC of the service role key (X-Fake-Signature) instead.
 */
import { OPEN, PAID, applyGateway, checkNow, describe, loadPayment, type PaymentRow } from '../_shared/deposits.ts';
import { handle, isLocalRuntime, json, KB, readJsonBody } from '../_shared/http.ts';
import {
  redactGatewayMessage,
  verifyFakeSignature,
  verifyQiWebhook,
  webhookKeyFromEnv,
} from '../_shared/payments/index.ts';
import { createServiceClient } from '../_shared/supabase.ts';
import { anyKeyVerdict, bodyAnswer, matchWebhookRow, rowKeyVerdict, webhookFacts, type KeyVerdict } from './logic.ts';

const env = (name: string) => Deno.env.get(name);

/** Qi's notifications are a few hundred bytes; 64 KB is generous and still bounded. */
const MAX_BODY = 64 * KB;

/** One environment's key: true verified, false set but did not verify, null not set. */
async function keyVerdict(sandbox: boolean, signature: string | null, payload: Record<string, unknown>): Promise<KeyVerdict> {
  const key = webhookKeyFromEnv(env, sandbox);
  if (!key) return null;
  const verdict = await verifyQiWebhook({ publicKeyPem: key, signature, payload });
  return verdict.ok;
}

Deno.serve(handle('deposit-webhook', async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST' }, 405);
  const body = await readJsonBody(req, { maxBytes: MAX_BODY });
  if (!body.ok) return body.response;
  const payload = body.value;
  const facts = webhookFacts(payload);
  const kept = redactGatewayMessage(payload);
  const who = facts.paymentId ?? facts.requestId ?? '?';

  // ── authenticity, before any database access ──────────────────────────────
  const fakeSig = req.headers.get('X-Fake-Signature');
  const fakeOk = fakeSig && isLocalRuntime(env)
    ? await verifyFakeSignature(env('SUPABASE_SERVICE_ROLE_KEY') ?? '', body.raw, fakeSig)
    : null;
  const qiSig = req.headers.get('X-Signature');
  const live = await keyVerdict(false, qiSig, payload);
  const sandbox = await keyVerdict(true, qiSig, payload);
  if (fakeOk === false || (fakeOk !== true && anyKeyVerdict(live, sandbox) === false)) {
    console.warn(`[deposit-webhook] bad signature for ${who}: refused, nothing recorded`);
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  // ── which row: the signed paymentId first, the unsigned requestId after ───
  const service = createServiceClient();
  let byPaymentId: PaymentRow | null = null;
  let byRequestId: PaymentRow | null = null;
  try {
    if (facts.paymentId) byPaymentId = await loadPayment(service, { paymentId: facts.paymentId });
    if (!byPaymentId && facts.requestId) byRequestId = await loadPayment(service, { requestId: facts.requestId });
  } catch (error) {
    console.error(`[deposit-webhook] lookup: ${describe(error)}`);
    return json({ error: 'INTERNAL' }, 500);
  }
  const match = matchWebhookRow(facts, byPaymentId, byRequestId);
  const row = match.row;

  // The fake HMAC vouches only for a fake-provider payment; anything else needs Qi's key.
  const signatureOk: boolean | null =
    fakeOk === true && (!row || row.provider === 'fake') ? true : rowKeyVerdict(row, live, sandbox);
  if (signatureOk === false) {
    console.warn(`[deposit-webhook] ${who}: not signed with the key of its payment's environment: refused, nothing recorded`);
    return json({ error: 'UNAUTHORIZED' }, 401);
  }

  const log = (requestId: string | null, note: string | null, sig: boolean | null) =>
    service.schema('app').rpc('deposit_log_event', {
      p_request_id: requestId,
      p_source: 'webhook',
      p_provider_status: facts.status,
      p_signature_ok: sig,
      p_note: note,
      p_raw: kept,
    });

  if (!row) {
    if ('conflicting' in match) {
      // The unsigned requestId names a row that belongs to another payment:
      // never applied. Recorded on that row for whoever reviews it; 200 so Qi stops.
      console.warn(
        `[deposit-webhook] ${facts.paymentId} names request ${match.conflicting.request_id}, which belongs to payment ${match.conflicting.provider_payment_id}: not applied`,
      );
      const { error } = await log(match.conflicting.request_id, 'payment_id mismatch: not applied', signatureOk);
      if (error) {
        console.error(`[deposit-webhook] event not recorded: ${describe(error)}`);
        return json({ error: 'INTERNAL' }, 500);
      }
      return json({ ok: true, matched: false });
    }
    // Never ours (or not yet visible): record it and let Qi stop.
    const { error } = await log(facts.requestId, 'unmatched', signatureOk);
    if (error) {
      console.error(`[deposit-webhook] event not recorded: ${describe(error)}`);
      return json({ error: 'INTERNAL' }, 500);
    }
    return json({ ok: true, matched: false });
  }

  // A settled payment: the message is logged; nothing to ask.
  if (PAID.has(row.status) && facts.status !== 'SUCCESS') {
    const { error } = await log(row.request_id, null, signatureOk);
    if (error) console.error(`[deposit-webhook] event not recorded for ${row.request_id}: ${describe(error)}`);
    return error ? json({ error: 'INTERNAL' }, 500) : json({ ok: true });
  }

  try {
    const after = await checkNow(env, service, row, 'webhook', signatureOk);
    if (after === null) {
      // Qi's status call gave no answer. A verified body is Qi's word for the
      // row that carries its paymentId; anything else is only a hint, so ask
      // Qi to send it again later.
      const answer = bodyAnswer(facts, match, signatureOk);
      if (answer) {
        await applyGateway(service, row.request_id, { ...answer, raw: kept }, 'webhook', true);
        return json({ ok: true });
      }
      if (OPEN.has(row.status) || facts.status === 'SUCCESS') return json({ error: 'RETRY_LATER' }, 500);
      const { error } = await log(row.request_id, null, signatureOk);
      if (error) console.error(`[deposit-webhook] event not recorded for ${row.request_id}: ${describe(error)}`);
    }
  } catch (error) {
    console.error(`[deposit-webhook] apply ${row.request_id}: ${describe(error)}`);
    return json({ error: 'INTERNAL' }, 500);
  }
  return json({ ok: true });
}));
