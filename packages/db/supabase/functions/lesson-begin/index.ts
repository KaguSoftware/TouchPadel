/**
 * lesson-begin — a guest pays for a held lesson place online (docs/design/
 * coaching/money.md §6.7; build contracts §1.11, C-3, C-26, R3, R50, R67).
 *
 *   POST (guest JWT)  { enrolment_id: uuid, locale: 'en' | 'ar' }
 *     → 200 { request_id, form_url, amount_iqd, deadline_at, status: 'pending',
 *             reused, enrolment_id }
 *     → { error: CODE, detail? } 400 BAD_REQUEST | INVALID_ARGUMENT |
 *       PHONE_REQUIRED, 401 AUTH_REQUIRED, 403 ACCOUNT_REQUIRED |
 *       TERMS_REQUIRED, 404 ENROLMENT_NOT_FOUND, 409 LESSON_NOT_PAYABLE |
 *       ONLINE_PAYMENT_OFF | COACHING_OFF, 429 TOO_MANY_ATTEMPTS,
 *       503 PROVIDER_UNAVAILABLE | DEGRADED_LOCKOUT | RETRY_LATER
 *
 * 1. No provider configured: 503 before anything is recorded, so an
 *    unconfigured project never burns a guest's attempts (R67: a missing Qi
 *    provider is this function's PROVIDER_UNAVAILABLE). The phone offers the
 *    desk when the branch allows it.
 * 2. app.lesson_payment_prepare records the attempt for the caller's held
 *    enrolment (or hands back its live one: a double tap opens the same page)
 *    and stretches the hold to the payment window. It re-checks that the
 *    enrolment is the caller's (ENROLMENT_NOT_FOUND otherwise).
 * 3. The gateway creates the payment with OUR request_id, through the same
 *    code as deposit-begin and ticket-begin (createAtGateway in
 *    _shared/deposits.ts).
 *
 * The app then polls deposit-status with the request_id; the webhook, those
 * polls and the reconciler finish the payment through app.deposit_apply,
 * whose lesson arm books the place (0281). Nothing here marks a payment paid
 * or failed.
 */
import { checkNow, createAtGateway, describe, loadPayment } from '../_shared/deposits.ts';
import { handle, json, KB, readJsonBody } from '../_shared/http.ts';
import { configuredProviderName } from '../_shared/payments/index.ts';
import { createServiceClient, getCallerUserId } from '../_shared/supabase.ts';
import { beginLesson, parseLessonBegin, type PreparedLesson } from './logic.ts';

const env = (name: string) => Deno.env.get(name);

Deno.serve(
  handle('lesson-begin', async (req) => {
    if (req.method !== 'POST') return json({ error: 'BAD_REQUEST', message: 'POST only' }, 405);

    const read = await readJsonBody(req, {
      maxBytes: 4 * KB,
      badJson: () => json({ error: 'BAD_REQUEST', message: 'invalid JSON body' }, 400),
    });
    if (!read.ok) return read.response;
    const parsed = parseLessonBegin(read.value);
    if (!parsed.ok) return json({ error: 'BAD_REQUEST', message: parsed.message }, 400);
    const { enrolment_id: enrolmentId, locale } = parsed.value;

    const service = createServiceClient();
    const uid = await getCallerUserId(req, service);
    if (!uid) return json({ error: 'AUTH_REQUIRED' }, 401);

    const providerName = configuredProviderName(env);
    if (!providerName) {
      console.error(
        '[lesson-begin] no payment provider configured (see docs/client/qi-card-activation.md)',
      );
      return json({ error: 'PROVIDER_UNAVAILABLE' }, 503);
    }

    const answer = await beginLesson({
      async prepare() {
        const res = await service.schema('app').rpc('lesson_payment_prepare', {
          p_guest_id: uid,
          p_enrolment_id: enrolmentId,
          p_locale: locale,
          p_provider: providerName,
        });
        return res.error ? { error: res.error } : { data: res.data as PreparedLesson };
      },
      async settleStale(row) {
        try {
          const full = await loadPayment(service, { requestId: row.request_id });
          if (full) await checkNow(env, service, full, 'poll');
        } catch (error) {
          console.warn(`[lesson-begin] stale ${row.request_id}: ${describe(error)}`);
        }
      },
      gateway: (row) =>
        createAtGateway(service, env, row, uid, {
          purpose: 'lesson',
          enrolment_id: row.enrolment_id,
          request_id: row.request_id,
        }),
      now: () => Date.now(),
    });
    return json(answer.body, answer.status);
  }),
);
