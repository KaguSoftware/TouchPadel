/**
 * ticket-begin — a guest buys open-match tickets (docs/design/open-matches/
 * money.md §5.1–§5.3; build contracts §1.6, §1.10, §1.11).
 *
 *   POST (guest JWT)  { count: 1..3, locale: 'en' | 'ar' }
 *     → 200 { request_id, form_url, amount_iqd, ticket_count, unit_price_iqd,
 *             deadline_at, status: 'pending', reused }
 *     → { error: CODE, detail? } 400 BAD_REQUEST | TICKET_COUNT_INVALID |
 *       PHONE_REQUIRED | INVALID_ARGUMENT, 401 AUTH_REQUIRED, 403
 *       ACCOUNT_REQUIRED | TERMS_REQUIRED | MATCH_BANNED, 409 MATCHES_OFF,
 *       429 TOO_MANY_ATTEMPTS, 503 PROVIDER_UNAVAILABLE | RETRY_LATER
 *
 * 1. No provider configured: 503 before anything is recorded, so an
 *    unconfigured project never burns a guest's attempts.
 * 2. app.ticket_payment_prepare records the attempt (a chain row: no hold, no
 *    booking, no branch), or hands back the guest's live one (a double tap
 *    opens the same page, with that attempt's own count).
 * 3. The gateway creates the payment with OUR request_id, through the same
 *    code as deposit-begin (createAtGateway in _shared/deposits.ts).
 *
 * The app then polls deposit-status with the request_id; the webhook, those
 * polls and the reconciler finish the purchase through app.deposit_apply,
 * whose ticket branch creates the tickets (0259). Nothing here marks a
 * payment paid or failed.
 */
import { checkNow, createAtGateway, describe, loadPayment } from '../_shared/deposits.ts';
import { json } from '../_shared/http.ts';
import { configuredProviderName } from '../_shared/payments/index.ts';
import { createServiceClient, getCallerUserId } from '../_shared/supabase.ts';
import { beginTickets, parseTicketBegin, type PreparedTicket } from './logic.ts';

const env = (name: string) => Deno.env.get(name);

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'BAD_REQUEST', message: 'POST only' }, 405);

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400);
  }
  const parsed = parseTicketBegin(raw);
  if (!parsed.ok) return json({ error: 'BAD_REQUEST', message: parsed.message }, 400);
  const { count, locale } = parsed.value;

  const service = createServiceClient();
  const uid = await getCallerUserId(req, service);
  if (!uid) return json({ error: 'AUTH_REQUIRED' }, 401);

  const providerName = configuredProviderName(env);
  if (!providerName) {
    console.error('[ticket-begin] no payment provider configured (see docs/client/qi-card-activation.md)');
    return json({ error: 'PROVIDER_UNAVAILABLE' }, 503);
  }

  const answer = await beginTickets({
    async prepare() {
      const res = await service.schema('app').rpc('ticket_payment_prepare', {
        p_guest_id: uid,
        p_count: count,
        p_locale: locale,
        p_provider: providerName,
      });
      return res.error ? { error: res.error } : { data: res.data as PreparedTicket };
    },
    async settleStale(row) {
      try {
        const full = await loadPayment(service, { requestId: row.request_id });
        if (full) await checkNow(env, service, full, 'poll');
      } catch (error) {
        console.warn(`[ticket-begin] stale ${row.request_id}: ${describe(error)}`);
      }
    },
    gateway: (row) =>
      createAtGateway(service, env, row, uid, {
        purpose: 'ticket',
        ticket_count: String(row.ticket_count),
        request_id: row.request_id,
      }),
    now: () => Date.now(),
  });
  return json(answer.body, answer.status);
});
