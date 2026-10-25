set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0370 open_matches_pay_at_desk — open matches without online payment
-- (Sait, 2026-10-25: "have the open matches but without the online payments").
--
-- Qi is delayed, so tickets (bought online) cannot be the way a player pays
-- for a seat. A new chain-wide mode, platform_settings.match_payment_mode:
--   'tickets'  the existing model: one prepaid ticket per seat (default).
--   'desk'     a player joins free in the app and the desk collects the seat's
--              share when they arrive, as it already does for a desk seat.
-- The online-payments lock (0340) is left exactly as it is. While it is closed,
-- matches can be switched on only in 'desk' mode, and the mode cannot be set
-- back to 'tickets' (ONLINE_PAYMENTS_PAUSED). Tickets already bought keep
-- working; nothing about them changes.
--
-- How little changes: in 'desk' mode ticket_pick hands back one NULL per seat
-- and ticket_lock treats an all-NULL list as locked, so match_start,
-- match_join, match_request and match_decide run untouched and the seats are
-- written with no ticket (the rest of the match code already reads a seat
-- with no ticket, as a desk seat has none).

alter table platform_settings
  add column if not exists match_payment_mode text not null default 'tickets';

do $mode_chk_0370$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'platform_settings_match_payment_mode_chk'
                    and conrelid = 'platform_settings'::regclass) then
    alter table platform_settings
      add constraint platform_settings_match_payment_mode_chk
      check (match_payment_mode in ('tickets', 'desk')) not valid;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'platform_settings_match_payment_mode_chk'
                and conrelid = 'platform_settings'::regclass and not convalidated) then
    alter table platform_settings validate constraint platform_settings_match_payment_mode_chk;
  end if;
end $mode_chk_0370$;

comment on column platform_settings.match_payment_mode is
  '0370. How a seat in an open match is paid: tickets (prepaid online, default) or desk (the desk collects the seat''s share on arrival; a player''s seat then carries no ticket). Owner-set via app.set_match_settings; while online payments are paused (0340) only desk can be set.';

-- An account or friend seat may now carry no ticket (desk mode). Every other
-- part of the rule is unchanged.
alter table match_seats drop constraint if exists match_seats_kind;
alter table match_seats add constraint match_seats_kind check (
  (kind in ('account', 'friend') and guest_id is not null and guest_name is null
     and guest_phone is null and created_by_staff_id is null)
  or (kind = 'desk' and created_by_staff_id is not null and ticket_id is null
     and (guest_id is null or (guest_name is null and guest_phone is null)))
) not valid;

do $validate_0370$
begin
  if exists (select 1 from pg_constraint
              where conname = 'match_seats_kind' and conrelid = 'match_seats'::regclass
                and not convalidated) then
    alter table match_seats validate constraint match_seats_kind;
  end if;
end $validate_0370$;

create or replace function app.match_pay_at_desk()
returns boolean
language sql stable security definer set search_path = public as $match_pay_at_desk_0370$
  select coalesce((select ps.match_payment_mode = 'desk' from platform_settings ps limit 1), false);
$match_pay_at_desk_0370$;

comment on function app.match_pay_at_desk() is
  '0370. Internal: whether open-match seats are paid at the desk (platform_settings.match_payment_mode = desk). False when there is no row.';

revoke all on function app.match_pay_at_desk() from public, anon;
grant execute on function app.match_pay_at_desk() to authenticated;

create or replace function app.match_settings(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $match_settings_0370$
declare
  v_venue uuid;
  v_out   jsonb;
begin
  -- R33: the role first, then the branch.
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'venue_id',                      vs.venue_id,
           'matches_enabled',               vs.matches_enabled,
           'match_fill_deadline_minutes',   vs.match_fill_deadline_minutes,
           'earliest_start_minutes',        vs.match_fill_deadline_minutes + 60,
           'match_ticket_price_iqd',        ps.match_ticket_price_iqd,
           'max_filling_matches_per_guest', ps.max_filling_matches_per_guest,
           'match_terms_version',           ps.match_terms_version,
           'match_payment_mode',            ps.match_payment_mode)
    into v_out
    from venue_settings vs
   cross join platform_settings ps
   where vs.venue_id = v_venue
     and ps.id;
  if v_out is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;
  return v_out;
end $match_settings_0370$;

comment on function app.match_settings(uuid) is
  '0257, 0370. Manager and owner: the open-match rules of one branch (matches_enabled, match_fill_deadline_minutes, earliest_start_minutes = deadline + 60) and of the chain (match_ticket_price_iqd, max_filling_matches_per_guest, match_terms_version, match_payment_mode). The role is checked before the branch is resolved (R33); p_venue_id defaults to the caller''s resolved branch.';

revoke all on function app.match_settings(uuid) from public, anon;
grant execute on function app.match_settings(uuid) to authenticated;

create or replace function app.ticket_pick(p_guest_id uuid, p_count int, p_sandbox boolean,
                                           p_request_id uuid default null)
returns uuid[]
language plpgsql security definer set search_path = public as $ticket_pick_0370$
declare
  v_ids uuid[];
  v_k   int;
  v_n   int;
begin
  if p_guest_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_id';
  end if;

  -- An approval: every ticket its own request reserved.
  if p_request_id is not null then
    select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_ids
      from (select k.id from match_tickets k
             where k.request_id = p_request_id and k.status = 'reserved' and k.guest_id = p_guest_id
             order by k.id
             for update) x;
    -- 0370: pay at the desk. A request made while matches took no tickets
    -- reserved none; its seats carry no ticket either.
    if cardinality(v_ids) = 0 and app.match_pay_at_desk() then
      select q.seats_requested into v_n from match_requests q
       where q.id = p_request_id and q.guest_id = p_guest_id;
      if v_n is not null then
        return array_fill(null::uuid, array[v_n]);
      end if;
    end if;
    return v_ids;
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_count';
  end if;
  -- 0370: pay at the desk. No ticket is picked; one null per seat, so the
  -- callers' counts and match_take_seats work unchanged.
  if app.match_pay_at_desk() then
    return array_fill(null::uuid, array[p_count]);
  end if;
  -- Every available ticket of the guest in this sandbox (DF-19), locked in id
  -- order; the oldest p_count by (created_at, id) are handed back.
  select coalesce(array_agg(x.id order by x.created_at, x.id), '{}'::uuid[]) into v_ids
    from (select k.id, k.created_at from match_tickets k
           where k.guest_id = p_guest_id and k.status = 'available' and k.sandbox = coalesce(p_sandbox, false)
           order by k.id
           for update) x;
  v_k := cardinality(v_ids);
  if v_k < p_count then
    raise exception 'NEED_TICKETS' using errcode = 'P0001',
      detail = format('{"needed":%s,"available":%s,"buy":%s}', p_count, v_k, p_count - v_k);
  end if;
  return v_ids[1:p_count];
end $ticket_pick_0370$;

comment on function app.ticket_pick(uuid, int, boolean, uuid) is
  '0260, 0370. Internal. Pay at the desk (0370, match_pay_at_desk()): no ticket is picked, the result is p_count nulls (for an approval, the request''s seats_requested nulls when it reserved none). Without a request: locks (one id-ordered statement) the guest''s available tickets of sandbox p_sandbox and returns the p_count oldest; fewer -> NEED_TICKETS, detail {"needed","available","buy"}. With p_request_id: that request''s reserved tickets of the guest (all), locked in id order. Moves nothing: ticket_lock does.';

revoke all on function app.ticket_pick(uuid, int, boolean, uuid) from public, anon, authenticated;

create or replace function app.ticket_lock(p_ticket_ids uuid[], p_seat_ids uuid[] default null,
                                           p_request_id uuid default null)
returns int
language plpgsql security definer set search_path = public as $ticket_lock_0370$
declare
  v_staff     uuid := (select st.id from staff st where st.id = auth.uid());
  v_n         int := 0;
  v_i         int;
  v_t         match_tickets%rowtype;
  v_s_id      uuid;
  v_s_guest   uuid;
  v_s_ticket  uuid;
  v_s_match   uuid;
  v_s_venue   uuid;
  v_s_sandbox boolean;
  v_q_id      uuid;
  v_q_guest   uuid;
  v_q_match   uuid;
  v_q_venue   uuid;
  v_q_sandbox boolean;
  v_q_status  text;
begin
  if coalesce(cardinality(p_ticket_ids), 0) = 0 then
    return 0;
  end if;
  -- 0370: pay at the desk. A seat that carries no ticket has nothing to lock;
  -- every one of them counts as there, so the callers' "fewer than asked"
  -- refusal (NEED_TICKETS) never fires for them.
  if array_position(p_ticket_ids, null) is not null then
    if (select count(*) from unnest(p_ticket_ids) x where x is not null) = 0 then
      return cardinality(p_ticket_ids);
    end if;
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_ticket_ids';
  end if;
  if p_seat_ids is null and p_request_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;
  if p_seat_ids is not null and cardinality(p_seat_ids) <> cardinality(p_ticket_ids) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;

  perform 1 from match_tickets where id = any (p_ticket_ids) order by id for update;

  if p_request_id is not null then
    select q.id, q.guest_id, q.match_id, mt.venue_id, mt.sandbox, q.status
      into v_q_id, v_q_guest, v_q_match, v_q_venue, v_q_sandbox, v_q_status
      from match_requests q join matches mt on mt.id = q.match_id
     where q.id = p_request_id;
  end if;

  for v_i in 1 .. cardinality(p_ticket_ids) loop
    select * into v_t from match_tickets where id = p_ticket_ids[v_i];
    continue when not found;

    if p_seat_ids is not null then
      select s.id, s.guest_id, s.ticket_id, s.match_id, s.venue_id, mt.sandbox
        into v_s_id, v_s_guest, v_s_ticket, v_s_match, v_s_venue, v_s_sandbox
        from match_seats s join matches mt on mt.id = s.match_id
       where s.id = p_seat_ids[v_i];
      -- R17: the seat is the ticket's holder's and names this ticket.
      continue when v_s_id is null
                 or v_s_guest is distinct from v_t.guest_id
                 or v_s_ticket is distinct from v_t.id
                 or v_s_sandbox is distinct from v_t.sandbox;
      if v_t.status = 'in_use' and v_t.seat_id = v_s_id then
        v_n := v_n + 1;                      -- already there
      elsif v_t.status = 'available'
            or (v_t.status = 'reserved' and v_q_id is not null and v_t.request_id = v_q_id) then
        update match_tickets
           set status = 'in_use', seat_id = v_s_id, request_id = null, updated_at = now()
         where id = v_t.id;
        insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, seat_id, request_id,
                                         actor_staff_id)
        values (v_t.id, v_t.guest_id, 'locked', v_s_venue, v_s_match, v_s_id, v_t.request_id, v_staff);
        v_n := v_n + 1;
      end if;
    else
      continue when v_q_id is null
                 or v_q_status <> 'pending'
                 or v_t.guest_id is distinct from v_q_guest
                 or v_t.sandbox is distinct from v_q_sandbox;
      if v_t.status = 'reserved' and v_t.request_id = v_q_id then
        v_n := v_n + 1;                      -- already there
      elsif v_t.status = 'available' then
        update match_tickets set status = 'reserved', request_id = v_q_id, updated_at = now() where id = v_t.id;
        insert into match_ticket_events (ticket_id, guest_id, type, venue_id, match_id, request_id, actor_staff_id)
        values (v_t.id, v_t.guest_id, 'reserved', v_q_venue, v_q_match, v_q_id, v_staff);
        v_n := v_n + 1;
      end if;
    end if;
  end loop;
  return v_n;
end $ticket_lock_0370$;

comment on function app.ticket_lock(uuid[], uuid[], uuid) is
  '0260, 0370. Internal (R17). Pay at the desk (0370): an array of only nulls (seats with no ticket) locks nothing and returns its length; nulls mixed with ids are INVALID_ARGUMENT. Locks the tickets in id order. With p_seat_ids (paired by position): a ticket available, or reserved for p_request_id only, moves to in_use on its seat when the seat is its holder''s, names that ticket and has its sandbox (event locked). With only p_request_id: an available ticket of the requester, same sandbox, moves to reserved for that pending request (event reserved). A mismatch is skipped. Returns how many tickets are now in the asked state (moved, or already there); a caller that gets fewer raises. INVALID_ARGUMENT without a pairing or with arrays of different lengths.';

revoke all on function app.ticket_lock(uuid[], uuid[], uuid) from public, anon, authenticated;

create or replace function app.set_match_settings(p_patch jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_match_settings_0370$
declare
  v_allowed text[] := array['matches_enabled', 'match_fill_deadline_minutes',
                            'match_ticket_price_iqd', 'max_filling_matches_per_guest',
                            'match_payment_mode'];
  v_live   boolean := coalesce((select online_payments_live from platform_settings limit 1), false);
  v_mode   text;
  v_venue  uuid;
  v_key    text;
  v_int    int;
  v_before jsonb;
  v_after  jsonb;
begin
  -- R33: the role first, then the branch.
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0340: while the platform lock is closed, matches_enabled = true is refused.
  -- 0370: while online payments are paused, matches may be switched on only
  -- when the seats are paid at the desk (match_payment_mode = 'desk'), and the
  -- mode cannot go back to tickets (they are bought online).
  v_mode := coalesce(p_patch->>'match_payment_mode',
                     (select ps.match_payment_mode from platform_settings ps limit 1));
  if p_patch ? 'match_payment_mode' and jsonb_typeof(p_patch->'match_payment_mode') <> 'string' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'match_payment_mode';
  end if;
  if p_patch ? 'match_payment_mode' and v_mode not in ('tickets', 'desk') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'match_payment_mode';
  end if;
  if not v_live and v_mode = 'tickets'
     and ((p_patch ? 'matches_enabled' and p_patch->'matches_enabled' = 'true'::jsonb)
          or (p_patch ? 'match_payment_mode')) then
    raise exception 'ONLINE_PAYMENTS_PAUSED' using errcode = 'P0001';
  end if;

  -- The whole patch is checked before anything is written.
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_patch';
  end if;
  for v_key in select jsonb_object_keys(p_patch) loop
    if not (v_key = any (v_allowed)) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = v_key;
    end if;
  end loop;
  if p_patch ? 'matches_enabled' and jsonb_typeof(p_patch->'matches_enabled') <> 'boolean' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'matches_enabled';
  end if;
  if p_patch ? 'match_fill_deadline_minutes' then
    v_int := app.venue_patch_int(p_patch, 'match_fill_deadline_minutes', 60, 2880);
  end if;
  if p_patch ? 'match_ticket_price_iqd' then
    v_int := app.venue_patch_int(p_patch, 'match_ticket_price_iqd', 1000, 1000000);
    if v_int % 250 <> 0 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'match_ticket_price_iqd',
        hint = 'a multiple of 250';
    end if;
  end if;
  if p_patch ? 'max_filling_matches_per_guest' then
    v_int := app.venue_patch_int(p_patch, 'max_filling_matches_per_guest', 1, 10);
  end if;

  v_before := app.match_settings(v_venue);

  perform set_config('app.venue_id', v_venue::text, true);

  if p_patch ? 'matches_enabled' or p_patch ? 'match_fill_deadline_minutes' then
    update venue_settings
       set matches_enabled             = case when p_patch ? 'matches_enabled'
                                              then (p_patch->>'matches_enabled')::boolean
                                              else matches_enabled end,
           match_fill_deadline_minutes = case when p_patch ? 'match_fill_deadline_minutes'
                                              then (p_patch->>'match_fill_deadline_minutes')::int
                                              else match_fill_deadline_minutes end
     where venue_id = v_venue;
  end if;

  -- The ticket price and the per-guest cap are the chain's (0207 form).
  if p_patch ? 'match_ticket_price_iqd' or p_patch ? 'max_filling_matches_per_guest'
     or p_patch ? 'match_payment_mode' then
    update platform_settings
       set match_payment_mode            = case when p_patch ? 'match_payment_mode'
                                                then p_patch->>'match_payment_mode'
                                                else match_payment_mode end,
           match_ticket_price_iqd        = case when p_patch ? 'match_ticket_price_iqd'
                                                then (p_patch->>'match_ticket_price_iqd')::bigint
                                                else match_ticket_price_iqd end,
           max_filling_matches_per_guest = case when p_patch ? 'max_filling_matches_per_guest'
                                                then (p_patch->>'max_filling_matches_per_guest')::int
                                                else max_filling_matches_per_guest end,
           updated_at                    = now()
     where id;
  end if;

  v_after := app.match_settings(v_venue);
  if v_before is distinct from v_after then
    perform app.write_audit('venue.match_settings', 'venue_settings', v_venue::text, v_before, v_after);
  end if;
  return v_after;
end $set_match_settings_0370$;

revoke all on function app.set_match_settings(jsonb, uuid) from public, anon;
grant execute on function app.set_match_settings(jsonb, uuid) to authenticated;
