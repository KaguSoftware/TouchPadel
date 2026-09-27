set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0247_degraded_only_while_trading — offline (degraded) mode only while the
-- branch trades.
--
-- Until now a branch was degraded whenever it had a till row and no till had
-- beaten inside heartbeat_stale_seconds. That cannot tell "the till lost the
-- server mid-shift" from "nobody runs a till right now", so every branch whose
-- till is switched off at night, or that keeps an old till row, read as
-- offline around the clock: both apps showed "Venue offline mode" and guests
-- could not book inside the protected horizon or order online.
--
-- Now it also needs an open business day at the branch (status open or
-- closing). That is safe because:
--   * a till sells nothing without an open day (DAY_NOT_OPEN on tabs, orders);
--   * open_day is online-only, so a day always opens with the server watching;
--   * close_day refuses while a till that beat during the day still reports
--     queued writes (DAY_UNSYNCED, Guard 2), so a closed day leaves nothing
--     known to replay.
-- A till that goes quiet mid-shift still flips the branch exactly as before.
--
-- Known edge: a day closed from another machine while a till is silent WITH
-- writes it never got to report stops the lockout at the close; its replay
-- then meets whatever guests booked meanwhile as an ordinary conflict.
--
-- is_degraded() and venue_mode(uuid) / venue_mode() delegate here, and so do
-- assert_not_degraded_for and the degraded sweep (0229), so the logged
-- degraded period now ends when the day closes.

-- is_degraded: re-issued from 20260926000212_degraded_promotions_telegram_per_venue.sql:30
create or replace function app.is_degraded(p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $is_degraded_0247$
  select exists (select 1 from device_heartbeats
                  where venue_id = p_venue
                    and (is_till or device_id like 'TILL%'))
     and not exists (
       select 1 from device_heartbeats
        where venue_id = p_venue
          and (is_till or device_id like 'TILL%')
          and last_seen_at > now() - make_interval(
                secs => coalesce(
                  (select heartbeat_stale_seconds from venue_settings where venue_id = p_venue),
                  45))
     )
     -- 0247: only while the branch trades.
     and exists (select 1 from day_sessions
                  where venue_id = p_venue
                    and status in ('open', 'closing'))
$is_degraded_0247$;

comment on function app.is_degraded(uuid) is
  '0137, 0212, 0247. True while the branch has an open business day, has a till, and no till has beaten inside heartbeat_stale_seconds.';

revoke all on function app.is_degraded(uuid) from public;
grant execute on function app.is_degraded(uuid) to anon, authenticated;

-- End the periods the old rule left open at branches that are not trading.
select app.sweep_degraded_periods();
