set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0371 match_pay_at_desk_when_offline — while online payments are off, open
-- matches are pay-at-the-desk without anyone having to save a setting
-- (Sait, 2026-10-26: "when the online payment is off the staff can check the
-- open matches and it should be pay at the desk").
--
-- 0370 made the desk mode a stored value (platform_settings.match_payment_mode,
-- default 'tickets'), so a chain that never saved 'desk' got no open matches on
-- the phone or the desk even though tickets cannot be bought. The one function
-- every reader goes through (ticket_pick, ticket_lock, the phone's and the
-- operator's match_pay_at_desk) now also answers true while the 0340 lock is
-- closed. When the lock opens, the stored mode decides again, as before.

create or replace function app.match_pay_at_desk()
returns boolean
language sql stable security definer set search_path = public as $match_pay_at_desk_0371$
  select coalesce((select not ps.online_payments_live or ps.match_payment_mode = 'desk'
                     from platform_settings ps limit 1), false);
$match_pay_at_desk_0371$;

comment on function app.match_pay_at_desk() is
  '0370, 0371. Internal: whether open-match seats are paid at the desk. True while online payments are paused (0340 lock closed) or when platform_settings.match_payment_mode = desk. False when there is no row.';

revoke all on function app.match_pay_at_desk() from public, anon;
grant execute on function app.match_pay_at_desk() to authenticated;
