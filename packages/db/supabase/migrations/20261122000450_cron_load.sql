-- ===========================================================================
-- 0450 — a lighter cron load on the hosted box (Majed, 2026-11-22: "lets do
-- 2, 3").
--
-- Measured on hosted (2026-11-22): the project runs on the smallest compute
-- size (0.5 GB, shared CPU). Fifteen pg_cron jobs started together at second
-- :00 of every fifth minute (nine every minute plus six every five), and in
-- the 13:31-13:34 UTC freeze every job failed with "job startup timeout"
-- while 23 API statements were cancelled at the 8 s timeout.
--
-- 1. THE RUN LOG CATCHES UP. 0386's tp_housekeeping_prune deletes at most
--    50,000 cron.job_run_details rows a night, but the jobs write ~32,000 a
--    day, so a backlog from before 0386 never shrank: 1.14 M rows, 279 MB of
--    the 333 MB database (lowest runid 1,000,001 = twenty nights of 50,000).
--    The same call, unchanged (7 days of runs kept, batches of 50,000), now
--    runs eight times a night (00:15 to 03:45 UTC, 03:15 to 06:45 in
--    Baghdad): up to 400,000 rows a night, the backlog gone in about three
--    nights, then a few thousand rows a run. Space freed by a delete is reused
--    by new runs; giving it back to the disk needs a VACUUM FULL, which no
--    migration can run.
-- 2. FEWER JOBS AT ONCE. A minute schedule always fires at second :00, so the
--    jobs are spread over different minutes, and the ones the clock already
--    covers run less often. What each one promises, and why it still holds
--    (each body is unchanged):
--      every 5 minutes, at their own minute:
--        tp_assistant_index_sweep (minute 1) a backstop: every write already
--          nudges the indexer at once.
--        tp_assistant_job_tick (2) batch jobs take hours; stuck-job checks
--          start at 10 minutes.
--        tp_scan_sweep (3) a retry after 3 minutes takes a stale reading over
--          by the clock; only the "failed" label waits for the sweep.
--        tp_hold_strikes (4) hold_slot and the lesson bookings settle the
--          caller's own strikes before reading the ladder.
--      every 2 minutes:
--        tp_hold_sweep (odd minutes) hold expiry is read from the clock
--          (court_availability, hold_slot, staff_create_reservation and
--          move_reservation expire the period first).
--        tp_reward_voucher_sweep (odd) a voucher's 15 minutes are checked by
--          use_reward_voucher; the points come back within 3 minutes of the
--          end, not 2.
--        tp_tournament_sweep (odd) registration closes by the clock; an
--          under-filled cancel lands within 2 minutes.
--        tp_degraded_sweep (even) is_degraded is live; only degraded_since can
--          be up to 2 minutes late when every till is dead.
--        tp_lesson_sweep (even: */2 keeps minute 0, when it runs its hourly
--          purge) a cancel's refund goes out within 2 minutes. Online payments
--          and coaching are not live yet; put it back to every minute if a
--          minute ever matters.
--      every 5 minutes as before, moved off minute 0:
--        tp_checklist_sweep (1), tp_monitor_cron (2), tp_price_promo_apply
--        (3), tp_reward_sweep (4). tp_protocol_tick and tp_shop_reward_sweep
--        stay on */5.
--    At most five of these start in the same minute now, and the run log
--    takes ~24,000 rows a day instead of ~32,000.
--
-- Scheduled through app.ensure_cron (0385): each call reschedules by name and
-- raises SETUP_FAILED if cron.job does not hold the new schedule afterwards.
--
-- covered by packages/db/tests/cron-load.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

do $cron_load_0450$
begin
  -- 1. The run log catches up.
  perform app.ensure_cron('tp_housekeeping_prune', '15,45 0-3 * * *', 'select app.prune_housekeeping();');

  -- 2. Every 5 minutes, each at its own minute.
  perform app.ensure_cron('tp_assistant_index_sweep', '1-59/5 * * * *', 'select app.assistant_index_nudge();');
  perform app.ensure_cron('tp_assistant_job_tick',    '2-59/5 * * * *', 'select app.assistant_job_tick_nudge();');
  perform app.ensure_cron('tp_scan_sweep',            '3-59/5 * * * *', 'select app.scan_sweep_stale();');
  perform app.ensure_cron('tp_hold_strikes',          '4-59/5 * * * *', 'select app.hold_strikes_settle(null);');

  -- Every 2 minutes.
  perform app.ensure_cron('tp_hold_sweep',            '1-59/2 * * * *', 'select app.expire_stale_holds();');
  perform app.ensure_cron('tp_reward_voucher_sweep',  '1-59/2 * * * *', 'select app.loyalty_voucher_sweep();');
  perform app.ensure_cron('tp_tournament_sweep',      '1-59/2 * * * *', 'select app.tournament_sweep();');
  perform app.ensure_cron('tp_degraded_sweep',        '*/2 * * * *',    'select app.sweep_degraded_periods();');
  perform app.ensure_cron('tp_lesson_sweep',          '*/2 * * * *',    'select app.lesson_sweep();');

  -- The five-minute jobs, moved off minute 0.
  perform app.ensure_cron('tp_checklist_sweep',       '1-59/5 * * * *', 'select app.checklist_sweep();');
  perform app.ensure_cron('tp_monitor_cron',          '2-59/5 * * * *', 'select app.monitor_cron_failures();');
  perform app.ensure_cron('tp_price_promo_apply',     '3-59/5 * * * *', 'select app.price_promo_apply_due();');
  perform app.ensure_cron('tp_reward_sweep',          '4-59/5 * * * *', 'select app.reward_sweep();');
end $cron_load_0450$;
