-- ===========================================================================
-- 0419 reward_voucher_cron_registered — the reward voucher sweep is a
-- registered setup job (0385, F-55).
--
-- 0415 scheduled tp_reward_voucher_sweep with cron.schedule directly, so the
-- job ran but app.setup_expected never listed it: the deploy's setup check
-- could not tell if it went missing, and tests/setup-checks.test.ts failed on
-- main (CI 43623993755). 0415 is on main and cannot be edited (the migration
-- gate), so this schedules the same job, same schedule and command, through
-- app.ensure_cron, which reschedules it in place, registers it, and raises
-- SETUP_FAILED when pg_cron is absent or the job did not land.
--
-- Nothing else changes.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

do $reward_voucher_cron_0419$
begin
  perform app.ensure_cron('tp_reward_voucher_sweep', '* * * * *', 'select app.loyalty_voucher_sweep();');
end $reward_voucher_cron_0419$;
