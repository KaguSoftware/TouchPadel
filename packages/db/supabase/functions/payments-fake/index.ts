/**
 * payments-fake — the pretend Qi payment page, LOCAL STACK ONLY (plan §8).
 * Answers 404 to everything anywhere else (it checks at every request, so a
 * deploy by mistake exposes nothing).
 *
 *   GET  ?ref=<request_id>   the page: amount, and four buttons
 *   POST ref=…&action=…      succeed | decline | otp | nothing
 *        → records what the pretend bank decided, sends deposit-webhook a
 *          Qi-shaped notification (HMAC-signed, X-Fake-Signature), then
 *          303s the browser to the finish URL, exactly like Qi's page
 *
 * "Do nothing" leaves the payment open, to walk the deadline → cancel →
 * expired path. Run with PAYMENTS_PROVIDER=fake in supabase/functions/.env;
 * set PAYMENTS_FAKE_PAGE_URL to a LAN address to open it from a phone.
 */
import { fakeStoreFor, isUuid, loadPayment } from '../_shared/deposits.ts';
import {
  fakePaymentId,
  finishPaymentUrl,
  isLocalRuntime,
  notificationUrl,
  signFakeNotification,
} from '../_shared/payments/index.ts';
import { createServiceClient } from '../_shared/supabase.ts';

const env = (name: string) => Deno.env.get(name);

const ACTIONS: Record<string, { status: string; label: string } | null> = {
  succeed: { status: 'SUCCESS', label: 'Pay (card approved)' },
  decline: { status: 'FAILED', label: 'Card declined' },
  otp: { status: 'AUTHENTICATION_FAILED', label: 'Wrong 3-D Secure code' },
  nothing: null,
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function page(title: string, inner: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>body{font:16px/1.45 system-ui,sans-serif;max-width:28rem;margin:2rem auto;padding:0 1rem;color:#111;background:#f6f6f4}
h1{font-size:1.25rem}p.small{color:#555;font-size:.9rem}form{margin:0}button{display:block;width:100%;margin:.5rem 0;padding:.9rem;font-size:1rem;border-radius:.6rem;border:1px solid #bbb;background:#fff}
button.go{background:#1f7a3a;color:#fff;border-color:#1f7a3a}.box{background:#fff;border-radius:.8rem;padding:1rem 1.2rem;margin:1rem 0;border:1px solid #ddd}</style>
</head><body>${inner}</body></html>`,
    { status, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } },
  );
}

Deno.serve(async (req) => {
  if (!isLocalRuntime(env)) return new Response('Not found', { status: 404 });

  const service = createServiceClient();
  const url = new URL(req.url);

  if (req.method === 'GET') {
    const ref = url.searchParams.get('ref');
    if (!isUuid(ref)) return page('Fake payment', '<h1>Fake payment</h1><p>No payment reference.</p>', 400);
    const row = await loadPayment(service, { requestId: ref });
    if (!row) return page('Fake payment', '<h1>Fake payment</h1><p>No such payment.</p>', 404);
    const buttons = Object.entries(ACTIONS)
      .map(
        ([action, a]) => `<form method="post"><input type="hidden" name="ref" value="${esc(ref)}">
<input type="hidden" name="action" value="${action}"><button class="${action === 'succeed' ? 'go' : ''}" type="submit">${
          a ? esc(a.label) : 'Do nothing (leave it open)'
        }</button></form>`,
      )
      .join('');
    return page(
      'Fake payment',
      `<h1>Fake Qi Card payment</h1>
<div class="box"><p><strong>${Number(row.amount_iqd).toLocaleString('en-US')} IQD</strong></p>
<p class="small">Status now: ${esc(row.status)} · local stack only · no money moves</p></div>${buttons}`,
    );
  }

  if (req.method === 'POST') {
    const form = await req.formData();
    const ref = String(form.get('ref') ?? '');
    const action = String(form.get('action') ?? '');
    if (!isUuid(ref) || !(action in ACTIONS)) return page('Fake payment', '<p>Bad request.</p>', 400);
    const row = await loadPayment(service, { requestId: ref });
    if (!row) return page('Fake payment', '<p>No such payment.</p>', 404);

    const chosen = ACTIONS[action];
    if (chosen) {
      await fakeStoreFor(service).setOutcome(ref, chosen.status, false);
      const body = JSON.stringify({
        requestId: ref,
        paymentId: row.provider_payment_id ?? fakePaymentId(ref),
        status: chosen.status,
        canceled: false,
        amount: Number(row.amount_iqd),
        confirmedAmount: chosen.status === 'SUCCESS' ? Number(row.amount_iqd) : 0,
        currency: 'IQD',
        paymentType: 'CARD',
        creationDate: String(row.created_at).slice(0, 19),
      });
      try {
        const res = await fetch(notificationUrl(env), {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Fake-Signature': await signFakeNotification(env('SUPABASE_SERVICE_ROLE_KEY') ?? '', body),
          },
          body,
        });
        await res.body?.cancel();
      } catch (error) {
        // Like a lost webhook: the app's polls still find the outcome.
        console.warn(`[payments-fake] webhook not delivered: ${String(error)}`);
      }
    }
    return new Response(null, { status: 303, headers: { Location: finishPaymentUrl(env, row.locale, ref) } });
  }

  return new Response('Method not allowed', { status: 405 });
});
