-- 0035_cafe_fixes — fixes surfaced by the wave-3 DB test suites
-- (packages/db/tests/telegram.test.ts). 0027–0034 are committed and
-- production-bound, so the fix lands as a full function re-creation here
-- (0026 lesson: one migration owns the whole body). Additive only.
--
-- FIX 1 — app.claim_due_telegram double-claim (double-send) window.
--   The 0032 claim bumped `attempts` but left `scheduled_for` untouched, so a
--   claimed row stayed DUE while the sender was still delivering it. Two
--   overlapping senders — the pg_net nudge from the enqueue path and the 10 s
--   pg_cron sweep (both call the same edge function) — could therefore claim
--   and send the SAME row twice (FOR UPDATE SKIP LOCKED only protects rows
--   inside one claim transaction, not between two claims a second apart). The
--   contract (db-slice "Wave 3", telegram.test.ts) is: a second immediate claim
--   returns nothing.
--   Now a claim also pushes `scheduled_for` forward by an exponential backoff
--   (30 s, 60 s, 120 s, … capped at 16 min, keyed on the attempt just taken).
--   A successful send stamps status = 'sent' and the backoff is moot; a 429
--   overrides scheduled_for with Telegram's retry_after; a sender that crashed
--   mid-batch retries after the backoff instead of immediately;
--   app.retry_telegram_outbox (0032) still resets scheduled_for = now().
--   Same signature, attributes and grants as 0032 (service_role only).

create or replace function app.claim_due_telegram(p_limit int default 50)
returns setof telegram_outbox
language sql security definer set search_path = public as $tg_claim_0035$
  update telegram_outbox o
     set attempts      = o.attempts + 1,
         scheduled_for = now() + make_interval(secs => 30 * power(2, least(o.attempts, 5)))
    from (
      select id from telegram_outbox
       where status = 'queued' and attempts < 8 and scheduled_for <= now()
       order by scheduled_for
       for update skip locked
       limit p_limit
    ) due
   where o.id = due.id
  returning o.*;
$tg_claim_0035$;

comment on function app.claim_due_telegram(int) is
  'Sender claim (service role only): due queued rows, attempts < 8, FOR UPDATE SKIP LOCKED. Bumps attempts AND pushes scheduled_for by an exponential backoff (0035) so an overlapping sender never re-claims a row still in flight.';

revoke all on function app.claim_due_telegram(int) from public, anon, authenticated;
grant execute on function app.claim_due_telegram(int) to service_role;
