set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0268 hold_sweep_split — the hold sweep no longer settles strikes in the
-- same transaction, and no client can run it.
--
-- 1. LOCK ORDER. Since 0252 the whole-table sweep (tp_hold_sweep, every
--    minute) expired stale holds — row locks on reservations — and then, in
--    the same transaction, settled them into strikes, which locks
--    hold_standing (hold_strike_apply). hold_slot takes the same two in the
--    opposite order: hold_strikes_settle for the caller (hold_standing) at the
--    top, then lock_court and expire_stale_holds(court, period) (reservations).
--    A guest re-holding the slot their lapsed hold sat on while the sweep ran
--    was a deadlock (40P01): a generic error for the guest, or the whole
--    sweep rolled back. expire_stale_holds now only expires; a separate cron
--    job, tp_hold_strikes, settles in its own transaction, which reads
--    reservations without locking them. Strikes land within the same minute.
--
-- 2. WHO MAY CALL IT. expire_stale_holds was granted to `authenticated` —
--    every guest, anonymous sign-ins included — and since 0252 its no-argument
--    form locks every stale hold of the chain FOR UPDATE and writes strikes.
--    No app calls it (hold_slot and the cron run it as the definer owner), so
--    the grant goes; the service role keeps it.
--
-- expire_stale_holds re-issued from 20260929000252_hold_strikes.sql:711 minus
-- the settle call; match_expire_holds re-issued VERBATIM from
-- 20260929000260_match_core.sql:136 (its comment asks that the twin be
-- re-issued in the same file — the selection predicate is unchanged).

-- ---------------------------------------------------------------------------
-- 1. app.expire_stale_holds
-- ---------------------------------------------------------------------------
create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $sweep_0268$
declare v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or r.guest_id is null)   -- 0071 (SEC-07): orphans too
        and (p_court_id is null or r.court_id = p_court_id)
        and (p_period is null or r.period && p_period)
        and not exists (select 1 from booking_payments bp
                         where bp.hold_id = r.id
                           and bp.status in ('created', 'pending')
                           and bp.deadline_at > now() - interval '10 minutes')
      order by r.id
      for update of r
   );
  get diagnostics v_count = row_count;
  return v_count;
end $sweep_0268$;
comment on function app.expire_stale_holds(uuid, tstzrange) is
  '0071: expires holds past their TTL AND orphan holds (guest_id is null), which no caller can release through app.release_hold and which would otherwise occupy the court until TTL. 0242: skips a hold whose online payment is still open, until ten minutes after that payment''s deadline. 0268: only expires — strikes are settled by the tp_hold_strikes cron (app.hold_strikes_settle) in a transaction of their own — and is no longer granted to clients.';

revoke execute on function app.expire_stale_holds(uuid, tstzrange) from authenticated;
-- The service role reached it only through that grant (no grant of its own:
-- `revoke all … from public` took the default), so it gets one explicitly, as
-- does the settle the new cron runs. Both stay out of every client role.
grant execute on function app.expire_stale_holds(uuid, tstzrange) to service_role;
grant execute on function app.hold_strikes_settle(uuid[]) to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.match_expire_holds — re-issued verbatim from 20260929000260_match_core.sql:136
-- ---------------------------------------------------------------------------
create or replace function app.match_expire_holds(p_venue uuid, p_period tstzrange) returns int
language plpgsql security definer set search_path = public as $match_expire_holds_0260$
declare
  v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or r.guest_id is null)   -- 0071 (SEC-07): orphans too
        and r.venue_id = p_venue
        and (p_period is null or r.period && p_period)
        and not exists (select 1 from booking_payments bp
                         where bp.hold_id = r.id
                           and bp.status in ('created', 'pending')
                           and bp.deadline_at > now() - interval '10 minutes')
      order by r.id
      for update of r
   );
  get diagnostics v_count = row_count;
  return v_count;
end $match_expire_holds_0260$;

comment on function app.match_expire_holds(uuid, tstzrange) is
  '0260. Internal. The branch-scoped twin of app.expire_stale_holds (0242, 0252): expires the branch''s stale and orphan holds overlapping p_period in ONE id-ordered statement, skipping a hold whose online payment is still open. Settles no hold-ladder strike: like expire_stale_holds with arguments, it leaves a lapse to the guest''s next hold_slot or to tp_hold_sweep (0252). Whoever re-issues expire_stale_holds re-issues this in the same file (a test pins the two to the same rows).';

revoke all on function app.match_expire_holds(uuid, tstzrange) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. tp_hold_strikes: every minute, its own transaction. Guarded like
--    0263's tp_match_sweep. After a hosted push, cron.job must have the row
--    (packages/db/CLAUDE.md).
-- ---------------------------------------------------------------------------
do $hold_strikes_cron_0268$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_hold_strikes not scheduled';
    return;
  end if;
  perform cron.schedule('tp_hold_strikes', '* * * * *', 'select app.hold_strikes_settle(null);');
end $hold_strikes_cron_0268$;
