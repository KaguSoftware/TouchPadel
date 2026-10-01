set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0277 lesson_reservation_guards — coaching, lane DB (docs/design/coaching/db.md
-- §4.5; build contracts §1.1, §1.8, R1, R7, R25, R35, R37, R64, R73).
--
-- A lesson's court row (reservations.kind 'lesson', or a 'hold' naming its
-- lesson while a private lesson's Qi payment is open; guest_id NULL,
-- guest_name 'Lesson', lesson_id set, 0275) is taught to the reservation
-- bodies. Every function keeps its signature (so its grants), is re-issued
-- verbatim from its latest body with the one change named, and says 0277 in
-- its comment.
--
--   1. A lesson is FIRM: match_court_free_firm (0260), match_quote (0261),
--      desk_open_matches and desk_match_detail (0262) count kind 'lesson'
--      beside booking and maintenance, so a lesson on the last court bumps a
--      filling match and is never counted free by OM-42.
--   2. The reservation trigger reservations_match (0263) also fires for a
--      lesson row: part B bumps a filling or waiting match a newly live lesson
--      leaves with no firm-free court, and a held lesson's success (Money turns
--      the hold row into kind 'lesson' in place) is caught by the kind change.
--      The body is not re-issued: part A finds no match for a lesson row.
--   3. court_availability shows a lesson as a booking (the column list is
--      unchanged, so create or replace is legal and the owner-rights
--      projection the invariant gate audits stays the same).
--   4. A lesson's court hold is not an orphan (R1, R25): expire_stale_holds
--      and its twin match_expire_holds (0268) expire it by TTL like any hold,
--      never on sight.
--   5. close_branch refuses live lessons and course sessions (their court rows
--      are counted with the bookings) and, R37, a branch with coaching money
--      still to settle: BRANCH_HAS_BOOKINGS detail coaching_money.
--   6. LESSON_VIA_COACHING (R7, R35, R73): a lesson's court row is changed only
--      through the coaching RPCs. cancel_reservation (cancel), mark_reservation
--      (mark), extend_reservation (extend), staff_create_reservation with
--      p_kind 'lesson' (create), open_tab on a lesson row (tab), confirm_booking
--      (confirm) and move_reservation (move) refuse it, queued (replay) or not.
--      Each refusal comes after the row is read, so an unknown id still answers
--      RESERVATION_NOT_FOUND first; each body still takes its locks first, so
--      the lock gate prints what it printed before.
--
-- close_branch calls Money's app.lesson_money_open (0278) only for a branch
-- that has a lesson or a coach statement, in a nested IF (plpgsql prepares a
-- statement when it first runs it), so a branch with no coaching closes as
-- before even where 0278 has not landed yet.

-- ===========================================================================
-- 1. A lesson is firm (db.md §4.5.1)
-- ===========================================================================

-- match_court_free_firm: re-issued from 20260929000260_match_core.sql:508; 0277:
-- a lesson counts as firm.
create or replace function app.match_court_free_firm(p_venue uuid, p_period tstzrange, p_duration_min int,
                                                     p_need int default 1)
returns boolean
language sql stable security definer set search_path = public as $match_court_free_firm_0277$
  select count(*) >= coalesce(p_need, 1)
    from courts c
   where c.venue_id = p_venue
     and c.is_active
     and p_duration_min = any (c.duration_options)
     and not exists (select 1 from reservations r
                      where r.court_id = c.id
                        and r.kind in ('booking', 'maintenance', 'lesson')   -- 0277: a lesson is firm
                        and r.status in ('pending', 'confirmed', 'arrived')
                        and r.period && p_period)
$match_court_free_firm_0277$;

comment on function app.match_court_free_firm(uuid, tstzrange, int, int) is
  '0260. Internal. True when at least p_need active courts of the branch offer p_duration_min and have no firm row (a live booking or maintenance; a hold is not firm, R22) overlapping p_period. OM-42 (start), the booking decision and the bump test read it. 0277 (db.md §4.5.1): a live lesson row is firm too (kind booking, maintenance or lesson).';

-- match_quote: re-issued from 20260929000261_match_guest_rpcs.sql:860; 0277: a
-- lesson counts as firm in the free-court count.
create or replace function app.match_quote(p_venue_id uuid, p_court_id uuid, p_start_at timestamptz,
                                           p_duration_min int)
returns jsonb
language plpgsql stable security definer set search_path = public as $match_quote_0277$
declare
  v_p        profiles%rowtype := app.match_guest(false);
  v_court    courts%rowtype;
  v_vs       venue_settings%rowtype;
  v_ps       platform_settings%rowtype;
  v_end      timestamptz;
  v_period   tstzrange;
  v_deadline int;
  v_price    bigint;
  v_rule     uuid;
  v_n        int;
  v_free     int;
  v_have     int;
  v_refusal  text;
  v_code     text;
  v_bookable text;
begin
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  elsif p_court_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_court_id';
  elsif p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  elsif p_duration_min is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_duration_min';
  end if;
  select * into v_court from courts
   where id = p_court_id and is_active and venue_id = p_venue_id
     and venue_id = any (app.open_venue_ids());
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (p_duration_min = any (v_court.duration_options)) then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;

  select * into v_vs from venue_settings where venue_id = p_venue_id;
  select * into v_ps from platform_settings where id;
  v_deadline := coalesce(v_vs.match_fill_deadline_minutes, 120);
  v_end := p_start_at + make_interval(mins => p_duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');

  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(p_court_id, p_start_at, p_duration_min) ps;

  select count(*) into v_n from matches x
   where x.venue_id = p_venue_id and not x.sandbox and x.status in ('filling', 'awaiting_court')
     and x.period && v_period;
  select count(*) into v_free
    from courts c
   where c.venue_id = p_venue_id and c.is_active and p_duration_min = any (c.duration_options)
     and not exists (select 1 from reservations r
                      where r.court_id = c.id and r.kind in ('booking', 'maintenance', 'lesson')   -- 0277
                        and r.status in ('pending', 'confirmed', 'arrived') and r.period && v_period);
  select count(*) into v_have from match_tickets k
   where k.guest_id = v_p.id and k.status = 'available' and k.sandbox = coalesce(v_p.payment_sandbox, false);

  begin
    perform app.assert_bookable(p_court_id, p_start_at, v_end);
  exception when sqlstate 'P0001' then
    if sqlerrm in ('CLOSED_DATE', 'OUTSIDE_HOURS') then
      v_bookable := sqlerrm;
    else
      raise;
    end if;
  end;

  v_code := app.match_eligibility(v_p.id, true);
  v_refusal := case
    when not coalesce(v_vs.matches_enabled, false) then 'MATCHES_OFF'
    when coalesce(v_vs.max_booking_horizon_days, 0) > 0
         and p_start_at > now() + make_interval(days => v_vs.max_booking_horizon_days) then 'BEYOND_HORIZON'
    when v_bookable is not null then v_bookable
    when p_start_at <= now() then 'SLOT_IN_PAST'
    when p_start_at < now() + make_interval(mins => v_deadline + 60) then 'MATCH_TOO_LATE'
    when v_rule is null then 'NO_RATE'
    when v_code in ('PHONE_REQUIRED', 'TERMS_REQUIRED', 'MATCH_BANNED') then v_code
    when (select count(distinct s.match_id)
            from match_seats s join matches x on x.id = s.match_id
           where s.guest_id = v_p.id and s.kind = 'account' and s.status = 'in'
             and x.status in ('filling', 'awaiting_court')) >= coalesce(v_ps.max_filling_matches_per_guest, 3)
      then 'MATCH_LIMIT_REACHED'
    when app.match_time_clash(v_p.id, v_period) then 'MATCH_TIME_CLASH'
    when v_free < 1 then 'SLOT_TAKEN'
    when not coalesce(v_p.payment_sandbox, false) and v_free < v_n + 1 then 'MATCH_SLOT_FULL'
  end;

  return jsonb_build_object(
    'enabled', coalesce(v_vs.matches_enabled, false),
    'duration_min', p_duration_min,
    'price_iqd', v_price,
    'shares_iqd', case when v_price is null then null else to_jsonb(app.match_shares(v_price)) end,
    'fill_deadline_at', p_start_at - make_interval(mins => v_deadline),
    'earliest_start_at', now() + make_interval(mins => v_deadline + 60),
    'categories', case v_p.gender
                    when 'female' then '["open","women"]'::jsonb
                    when 'male' then '["open","men"]'::jsonb
                    else '["open","women","men"]'::jsonb end,
    'my_gender', v_p.gender,
    'tickets_available', v_have,
    'ticket_price_iqd', v_ps.match_ticket_price_iqd,
    'seats_max', 3,
    'filling_at_time', v_n,
    'courts_free', v_free,
    'refusal', v_refusal);
end $match_quote_0277$;

comment on function app.match_quote(uuid, uuid, timestamptz, int) is
  '0261 (db.md §4.6.1, guest.md §4.3). Guest: what starting an open match on this court and time would mean: {enabled, duration_min, price_iqd, shares_iqd (NULL on NO_RATE), fill_deadline_at, earliest_start_at, categories (open plus the caller''s, all three when unset), my_gender, tickets_available (own sandbox), ticket_price_iqd, seats_max 3, filling_at_time, courts_free, refusal}. refusal is the first of MATCHES_OFF, BEYOND_HORIZON, CLOSED_DATE, OUTSIDE_HOURS, SLOT_IN_PAST, MATCH_TOO_LATE, NO_RATE, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, MATCH_LIMIT_REACHED, MATCH_TIME_CLASH, SLOT_TAKEN, MATCH_SLOT_FULL (unlocked counts), never GENDER_REQUIRED or NEED_TICKETS. Raises AUTH_REQUIRED, ACCOUNT_REQUIRED, INVALID_ARGUMENT, COURT_NOT_FOUND, INVALID_DURATION. Nothing is locked or written. 0277 (db.md §4.5.1): a live lesson row is firm too (kind booking, maintenance or lesson).';

-- desk_open_matches: re-issued from 20260929000262_match_desk_money.sql:1573;
-- 0277: courts_free_firm counts a lesson as firm.
create or replace function app.desk_open_matches(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_open_matches_0277$
declare
  v_visible uuid[];
  v_venue   uuid;
  v_vs      venue_settings%rowtype;
  v_price   bigint;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '3 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;

  -- The branch in scope; NULL (the owner's "All branches", or a clerk of two
  -- branches with no station) lists every visible branch with no settings.
  v_visible := app.visible_venue_ids();
  v_venue := app.resolve_venue();
  if v_venue is not null and not (v_venue = any (v_visible)) then
    v_venue := null;
  end if;
  if v_venue is not null then
    select * into v_vs from venue_settings where venue_id = v_venue;
  end if;
  select ps.match_ticket_price_iqd into v_price from platform_settings ps where ps.id;

  return jsonb_build_object(
    'matches_enabled', case when v_venue is null then null else coalesce(v_vs.matches_enabled, false) end,
    'fill_deadline_minutes', v_vs.match_fill_deadline_minutes,
    'earliest_start_minutes', v_vs.match_fill_deadline_minutes + 60,
    'ticket_price_iqd', v_price,
    'server_now', now(),
    'matches', coalesce((
      select jsonb_agg(x.j order by x.start_at, x.id)
        from (select m.id, m.start_at,
                     jsonb_build_object(
                       'match_id', m.id, 'venue_id', m.venue_id, 'status', m.status,
                       'start_at', m.start_at, 'end_at', m.end_at, 'duration_min', m.duration_min,
                       'category', m.category, 'join_policy', m.join_policy, 'visibility', m.visibility,
                       'seats_taken', (select count(*) from app.match_carriers(m.id) c
                                        where c.status in ('in', 'attended')),
                       'seats_left', cardinality(app.match_desk_numbers(m)),
                       'requests_pending', (select count(*) from match_requests q
                                             where q.match_id = m.id and q.status = 'pending'),
                       'fill_deadline_at', m.fill_deadline_at,
                       'organised_by', m.organised_by,
                       'organiser', (select jsonb_build_object('customer_id', p.id, 'full_name', p.full_name,
                                                               'phone', p.phone)
                                       from profiles p where p.id = m.organiser_id),
                       'price_iqd', m.price_iqd,
                       'shares_iqd', to_jsonb(m.shares_iqd),
                       'courts_free_firm', (select count(*) from courts c
                                             where c.venue_id = m.venue_id and c.is_active
                                               and m.duration_min = any (c.duration_options)
                                               and not exists (select 1 from reservations r
                                                                where r.court_id = c.id
                                                                  and r.kind in ('booking', 'maintenance', 'lesson')   -- 0277
                                                                  and r.status in ('pending', 'confirmed', 'arrived')
                                                                  and r.period && m.period)),
                       'courts_total', (select count(*) from courts c
                                         where c.venue_id = m.venue_id and c.is_active
                                           and m.duration_min = any (c.duration_options))) as j
                from matches m
               where m.venue_id = any (case when v_venue is null then v_visible else array[v_venue] end)
                 and not m.sandbox
                 and m.start_at >= p_from and m.start_at < p_to
                 and (m.status in ('filling', 'awaiting_court')
                      or (m.status = 'booked' and now() < m.end_at
                          and cardinality(app.match_desk_numbers(m)) > 0))) x), '[]'::jsonb));
end $desk_open_matches_0277$;

comment on function app.desk_open_matches(timestamptz, timestamptz) is
  '0262 (db.md §4.7.1 = operator.md §5.6.1, D12, D18). Desk (court_desk, manager, owner): {matches_enabled, fill_deadline_minutes, earliest_start_minutes (deadline + 60, OM-43), ticket_price_iqd, server_now, matches[]} for the branch in scope (app.resolve_venue; NULL = every visible branch, and the branch settings NULL). Rows: non-sandbox matches starting in [p_from, p_to) that are filling, awaiting_court, or booked with a number open for the desk before end_at: {match_id, venue_id, status, start_at, end_at, duration_min, category, join_policy, visibility, seats_taken (in or attended carriers), seats_left (numbers open for the desk), requests_pending, fill_deadline_at, organised_by, organiser {customer_id, full_name, phone} | null, price_iqd, shares_iqd, courts_free_firm, courts_total (active courts offering the length)}. INVALID_ARGUMENT for a NULL or a window over 3 days. 0277 (db.md §4.5.1): a live lesson row is firm too (kind booking, maintenance or lesson).';

-- desk_match_detail: re-issued from 20260929000262_match_desk_money.sql:1707;
-- 0277: courts_free_firm counts a lesson as firm.
create or replace function app.desk_match_detail(p_match_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $desk_match_detail_0277$
declare
  v_m         matches%rowtype;
  v_r         reservations%rowtype;
  v_court     courts%rowtype;
  v_org       profiles%rowtype;
  v_s         match_seats%rowtype;
  v_p         profiles%rowtype;
  v_mgr       boolean;
  v_started   boolean;
  v_marks     boolean;
  v_live      boolean := false;
  v_carriers  uuid[];
  v_in        int;
  v_attended  int;
  v_absent    int;
  v_free      int;
  v_total     int;
  v_org_seat  uuid;
  v_money     jsonb;
  v_by_seat   jsonb := '{}'::jsonb;
  v_sm        jsonb;
  v_tstatus   text;
  v_ticket    jsonb;
  v_paid      boolean;
  v_carrying  boolean;
  v_holder    uuid;
  v_holder_nm text;
  v_companion int;
  v_reasons   jsonb;
  v_seats     jsonb := '[]'::jsonb;
  v_requests  jsonb;
  v_events    jsonb;
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_match_id is not null then
    select * into v_m from matches where id = p_match_id;
  end if;
  if v_m.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_mgr := app.is_staff('manager', 'owner');
  v_started := now() >= v_m.start_at;
  v_marks := app.match_marks_open(v_m.id);
  v_carriers := array(select c.seat_id from app.match_carriers(v_m.id) c where c.seat_id is not null);
  select count(*) filter (where c.status = 'in'),
         count(*) filter (where c.status = 'attended'),
         count(*) filter (where c.status in ('no_show', 'left_late'))
    into v_in, v_attended, v_absent
    from app.match_carriers(v_m.id) c;
  select count(*) filter (where not exists (select 1 from reservations r
                                             where r.court_id = c.id
                                               and r.kind in ('booking', 'maintenance', 'lesson')   -- 0277
                                               and r.status in ('pending', 'confirmed', 'arrived')
                                               and r.period && v_m.period)),
         count(*)
    into v_free, v_total
    from courts c
   where c.venue_id = v_m.venue_id and c.is_active and v_m.duration_min = any (c.duration_options);

  -- Money's block exists once there is a booking (D11: Money's names win).
  if v_m.reservation_id is not null then
    select * into v_r from reservations where id = v_m.reservation_id;
    select * into v_court from courts where id = v_r.court_id;
    v_live := v_r.kind = 'booking' and v_r.status in ('confirmed', 'arrived', 'completed');
    v_money := app.match_money(v_m.id, null);
    select coalesce(jsonb_object_agg(x.value->>'seat_id', x.value), '{}'::jsonb)
      into v_by_seat
      from jsonb_array_elements(coalesce(v_money->'seats', '[]'::jsonb)) x
     where x.value->>'seat_id' is not null;
  end if;

  if v_m.organiser_id is not null then
    select * into v_org from profiles where id = v_m.organiser_id;
    select s.id into v_org_seat
      from match_seats s
     where s.id = any (v_carriers) and s.guest_id = v_m.organiser_id and s.kind in ('account', 'desk')
     order by s.seat_no
     limit 1;
  end if;

  -- Every seat: the carriers by number, then the ended seats.
  for v_s in
    select s.* from match_seats s
     where s.match_id = v_m.id
     order by (s.id = any (v_carriers)) desc,
              case when s.id = any (v_carriers) then s.seat_no end,
              s.ended_at nulls last, s.joined_at, s.seat_no, s.id
  loop
    v_carrying := v_s.id = any (v_carriers);
    v_p := null;
    if v_s.guest_id is not null then
      select * into v_p from profiles where id = v_s.guest_id;
    end if;
    v_tstatus := null;
    if v_s.ticket_id is not null then
      select k.status into v_tstatus from match_tickets k where k.id = v_s.ticket_id;
    end if;
    v_ticket := app.match_seat_ticket(v_s);
    v_paid := exists (select 1 from payment_match_seats pm where pm.match_seat_id = v_s.id);
    v_sm := v_by_seat -> (v_s.id::text);

    -- A friend seat is listed under its holder's account seat; a nameless
    -- desk extra under the seat it was started with (companion 1..2).
    v_holder := null;
    v_holder_nm := null;
    v_companion := null;
    if v_s.kind = 'friend' then
      select h.id into v_holder
        from match_seats h
       where h.match_id = v_m.id and h.kind = 'account' and h.guest_id = v_s.guest_id
       order by (h.id = any (v_carriers)) desc, h.joined_at desc, h.id desc
       limit 1;
      v_holder_nm := nullif(btrim(v_p.full_name), '');
      select count(*) into v_companion
        from match_seats f
       where f.match_id = v_m.id and f.kind = 'friend' and f.guest_id = v_s.guest_id
         and f.joined_at = v_s.joined_at and (f.seat_no, f.id) <= (v_s.seat_no, v_s.id);
    elsif v_s.kind = 'desk' and v_s.guest_id is null and v_s.guest_name is null then
      select h.id, coalesce(nullif(btrim(hp.full_name), ''), h.guest_name)
        into v_holder, v_holder_nm
        from match_seats h
        left join profiles hp on hp.id = h.guest_id
       where h.match_id = v_m.id and h.kind = 'desk' and h.joined_at = v_s.joined_at and h.id <> v_s.id
         and (h.guest_id is not null or h.guest_name is not null)
       order by h.seat_no, h.id
       limit 1;
      if v_holder is not null then
        select count(*) into v_companion
          from match_seats f
         where f.match_id = v_m.id and f.kind = 'desk' and f.guest_id is null and f.guest_name is null
           and f.joined_at = v_s.joined_at and (f.seat_no, f.id) <= (v_s.seat_no, v_s.id);
      end if;
    end if;

    -- The desk remove reasons the caller may use on this seat now (§5.13.8).
    v_reasons := case
      when v_s.status <> 'in' then '[]'::jsonb
      when v_m.status in ('filling', 'awaiting_court')
        then '["customer_request", "conduct", "staff_error", "duplicate", "other"]'::jsonb
      when v_m.status = 'booked' and not v_started and v_mgr
        then '["customer_request", "conduct", "staff_error", "duplicate", "other"]'::jsonb
      when v_m.status = 'booked' and not v_started
        then '["customer_request", "conduct", "other"]'::jsonb
      when v_m.status = 'booked' and v_mgr
        then '["staff_error", "duplicate"]'::jsonb
      else '[]'::jsonb end;

    v_seats := v_seats || jsonb_build_array(jsonb_build_object(
      'seat_id', v_s.id, 'seat_no', v_s.seat_no, 'kind', v_s.kind, 'status', v_s.status,
      'end_reason', v_s.end_reason, 'carrying', v_carrying,
      'customer_id', v_s.guest_id,
      'full_name', case when v_s.kind = 'friend' then null
                        when v_s.guest_id is not null then nullif(btrim(v_p.full_name), '')
                        else v_s.guest_name end,
      'display_name', app.match_seat_label(v_s)->>'name',
      'phone', case when v_s.kind = 'friend' then null
                    when v_s.guest_id is not null then v_p.phone
                    else v_s.guest_phone end,
      'holder_seat_id', v_holder, 'holder_name', v_holder_nm, 'companion_no', v_companion,
      'gender', v_s.gender,
      'gender_source', case when v_s.gender is null then null
                            when v_s.kind = 'account' then 'guest'
                            when v_s.kind = 'friend' then 'holder'
                            when v_s.guest_id is not null and v_p.gender = v_s.gender
                                 and v_p.gender_set_by = 'guest' then 'guest'
                            else 'desk' end,
      'vouched', v_s.vouched,
      'flags', case when v_s.kind <> 'friend' and v_s.guest_id is not null
                    then app.customer_flags_json(v_s.guest_id) else '[]'::jsonb end,
      'is_organiser', coalesce(v_s.guest_id = v_m.organiser_id and v_s.kind in ('account', 'desk'), false),
      'joined_at', v_s.joined_at, 'ended_at', v_s.ended_at, 'marked_at', v_s.marked_at,
      'marked_by_name', (select st.display_name from staff st where st.id = v_s.marked_by_staff_id),
      'replaces_seat_id', v_s.replaces_seat_id,
      'replaced_by_seat_id', (select x.id from match_seats x where x.replaces_seat_id = v_s.id
                               order by x.joined_at desc, x.id desc limit 1),
      'ticket', v_ticket,
      'write_off_reason', v_s.write_off_reason,
      'money', case when v_sm is null then null else jsonb_build_object(
                 'share_iqd', v_sm->'share_iqd', 'paid_desk_iqd', v_sm->'paid_desk_iqd',
                 'credit_iqd', v_sm->'credit_iqd', 'owed_iqd', v_sm->'owed_iqd',
                 'written_off_iqd', v_sm->'written_off_iqd', 'write_off', v_sm->'write_off',
                 'open_iqd', v_sm->'open_iqd', 'take_iqd', v_sm->'take_iqd') end,
      'can', jsonb_build_object(
        'mark_attended', coalesce(v_m.status in ('booked', 'played', 'no_show') and v_marks and v_carrying
                                  and v_s.status in ('in', 'no_show'), false),
        'mark_no_show', coalesce(v_m.status in ('booked', 'played') and v_started and v_marks and v_carrying
                                 and not v_paid
                                 and (v_s.status = 'in'
                                      or (v_s.status = 'attended'
                                          and (v_s.ticket_id is null or v_tstatus = 'available'))), false),
        'unmark', coalesce(v_m.status = 'booked' and v_marks and v_carrying
                           and ((v_s.status = 'attended' and (v_s.ticket_id is null or v_tstatus = 'available'))
                                or (v_s.status = 'no_show'
                                    and (v_s.ticket_id is null or v_ticket->>'status' = 'forfeited'
                                         or v_tstatus = 'available'))), false),
        'remove_reasons', v_reasons,
        'take_share', coalesce(v_m.status in ('booked', 'played') and v_live
                               and (v_sm->>'take_iqd')::bigint > 0, false),
        'write_off', coalesce(v_m.status in ('booked', 'played') and v_live and v_started and v_carrying
                              and v_s.status in ('in', 'attended') and v_s.written_off_at is null
                              and (v_sm->>'owed_iqd')::bigint > 0, false),
        'replace', coalesce(v_m.status = 'booked' and v_started and now() < v_m.end_at and v_carrying
                            and v_s.status = 'no_show', false))));
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'request_id', q.id, 'customer_id', q.guest_id, 'full_name', p.full_name, 'phone', p.phone,
           'flags', app.customer_flags_json(q.guest_id), 'seats_requested', q.seats_requested,
           'friend_genders', coalesce(to_jsonb(q.friend_genders), '[]'::jsonb),
           'games_played', app.guest_games_played(q.guest_id), 'no_shows', app.guest_match_no_shows(q.guest_id),
           'created_at', q.created_at)
           order by q.created_at, q.id), '[]'::jsonb)
    into v_requests
    from match_requests q
    join profiles p on p.id = q.guest_id
   where q.match_id = v_m.id and q.status = 'pending';

  select coalesce(jsonb_agg(x.j order by x.at desc, x.id desc), '[]'::jsonb)
    into v_events
    from (select e.id, e.at,
                 jsonb_build_object(
                   'at', e.at, 'type', e.type, 'actor', e.actor,
                   'actor_name', case e.actor
                                   when 'staff' then (select st.display_name from staff st where st.id = e.actor_staff_id)
                                   when 'guest' then (select p.full_name from profiles p where p.id = e.actor_guest_id)
                                 end,
                   'seat_no', (select s.seat_no from match_seats s where s.id = e.seat_id),
                   'code', e.code) as j
            from match_events e
           where e.match_id = v_m.id
           order by e.at desc, e.id desc
           limit 50) x;

  return jsonb_build_object(
    'match', jsonb_build_object(
      'id', v_m.id, 'venue_id', v_m.venue_id, 'status', v_m.status, 'ended_reason', v_m.ended_reason,
      'start_at', v_m.start_at, 'end_at', v_m.end_at, 'duration_min', v_m.duration_min,
      'category', v_m.category, 'join_policy', v_m.join_policy, 'visibility', v_m.visibility,
      'price_iqd', v_m.price_iqd, 'shares_iqd', to_jsonb(v_m.shares_iqd),
      'fill_deadline_at', v_m.fill_deadline_at, 'share_token', v_m.share_token,
      'organised_by', v_m.organised_by, 'organiser_seat_id', v_org_seat,
      'organiser', case when v_org.id is null then null
                        else jsonb_build_object('customer_id', v_org.id, 'full_name', v_org.full_name,
                                                'phone', v_org.phone,
                                                'flags', app.customer_flags_json(v_org.id)) end,
      'reservation_id', v_m.reservation_id, 'reservation_status', v_r.status, 'court_id', v_r.court_id,
      'court_name_en', v_court.name_en, 'court_name_ar', v_court.name_ar, 'sandbox', v_m.sandbox,
      'courts_free_firm', v_free, 'courts_total', v_total,
      'started', v_started, 'marks_open', v_marks, 'server_now', now(),
      'can', jsonb_build_object(
        'add_seat', cardinality(app.match_desk_numbers(v_m)) > 0,
        'cancel', v_m.status in ('filling', 'awaiting_court'),
        'call_off', v_m.status = 'booked' and v_started and v_marks
                    and v_in = 0 and v_absent > 0 and v_attended > 0)),
    'seats', v_seats,
    'requests', v_requests,
    'money', case when v_money is null then null else jsonb_build_object(
      'phase', v_money->'phase', 'price_iqd', v_money->'price_iqd',
      'booking_price_iqd', v_money->'booking_price_iqd', 'price_delta_iqd', v_money->'price_delta_iqd',
      'paid_iqd', v_money->'paid_iqd', 'live_tab_paid_iqd', v_money->'live_tab_paid_iqd',
      'desk_paid_iqd', v_money->'desk_paid_iqd', 'unassigned_iqd', v_money->'unassigned_iqd',
      'delta_owed_iqd', v_money->'delta_owed_iqd', 'owed_iqd', v_money->'owed_iqd',
      'written_off_iqd', v_money->'written_off_iqd', 'open_iqd', v_money->'open_iqd',
      'over_iqd', v_money->'over_iqd',
      'vacant', (select coalesce(jsonb_agg(jsonb_build_object('seat_no', x.value->'seat_no',
                                                              'open_iqd', x.value->'open_iqd',
                                                              'written_off_iqd', x.value->'written_off_iqd')
                                           order by (x.value->>'seat_no')::int), '[]'::jsonb)
                   from jsonb_array_elements(coalesce(v_money->'seats', '[]'::jsonb)) x
                  where x.value->>'kind' = 'vacant'),
      'unassigned', coalesce(v_money->'unassigned', '[]'::jsonb)) end,
    'events', v_events);
end $desk_match_detail_0277$;

comment on function app.desk_match_detail(uuid) is
  '0262 (db.md §4.7.3 = operator.md §5.6.3, D20, R31). Desk: one match. MATCH_NOT_FOUND when unknown, sandbox or outside the visible branches. {match {id, venue_id, status, ended_reason, start_at, end_at, duration_min, category, join_policy, visibility, price_iqd, shares_iqd, fill_deadline_at, share_token, organised_by, organiser_seat_id, organiser {customer_id, full_name, phone, flags} | null, reservation_id, reservation_status, court_id, court_name_en, court_name_ar (the booked court), sandbox, courts_free_firm, courts_total, started, marks_open, server_now, can {add_seat, cancel, call_off}}, seats[] (carriers by number, then ended seats: identity, holder and companion for friends and nameless desk extras, gender and gender_source, flags, marks, replacement links, ticket {ticket_id, status in_use|forfeited|released} | null, write_off_reason, money (Money''s match_seat_money row) | null, can {mark_attended, mark_no_show, unmark, remove_reasons[], take_share, write_off, replace}), requests[] (pending, with OM-41''s games_played and no_shows), money (app.match_money''s top level with vacant[] and unassigned[]) | null while there is no booking, events[] (the last 50, newest first, with the actor''s name)}. Staff see names and phones; players never read this. 0277 (db.md §4.5.1): a live lesson row is firm too (kind booking, maintenance or lesson).';

-- ===========================================================================
-- 2. The reservation trigger fires for a lesson row (db.md §4.5.1)
-- ===========================================================================
-- Re-created from 20260929000263_match_reservation_triggers.sql:167-170 with
-- 'lesson' in its WHEN. The body (0263:58) is unchanged: part A finds no match
-- for a lesson row (matches_reservation_key); part B bumps the branch's filling
-- and waiting matches a newly live lesson row leaves with no firm-free court,
-- and Money's success turning a lesson's hold row into kind 'lesson'
-- (old.kind is distinct from new.kind) is a newly firm row.
drop trigger if exists reservations_match on reservations;
create trigger reservations_match
  after insert or update of kind, status, court_id, start_at, end_at on reservations
  for each row when (new.kind in ('booking', 'maintenance', 'lesson'))
  execute function app.trg_reservation_match();

comment on function app.trg_reservation_match() is
  '0263, 0277. Internal (db.md §4.8.1, coaching db.md §4.5.1). Trigger reservations_match, after insert or update of kind, status, court_id, start_at, end_at on a booking, maintenance or lesson row (0277: a lesson''s court row is firm). Part A, a match''s own booking (UPDATE; waits for the branch mutex; errors propagate): cancelled -> match_end cancelled (reservation_cancelled; actor staff when cancelled_by is staff), completed -> match_end played (R37 auto-attend), no_show -> MATCH_MARK_SEATS, moved or extended -> the match''s times follow (event moved {court_id}); a lesson row books no match, so part A never runs for it. Part B, a newly firm or moved live row (a lesson''s hold row becoming kind lesson included): the branch''s non-sandbox filling and awaiting_court matches over its period with no firm-free court left are bumped (match_end bumped), except the match app.match_booking names; the mutex is only try-locked, a busy branch and any error are a warning and the sweep follows (D-2). Sets app.venue_id to the row''s branch and restores it.';

-- ===========================================================================
-- 3. court_availability shows a lesson as a booking (db.md §4.5.1)
-- ===========================================================================
-- Re-created from 20260824000008_reservations.sql:670-674. Same columns, names
-- and types (kind stays reservation_kind), so create or replace is legal and
-- the audited owner-rights projection (scripts/check-db-invariants.mjs) is
-- unchanged. A held private lesson's court shows as a hold until it is paid; a
-- confirmed one as a booking: the guest grid never learns that a court is
-- taken by a lesson, nor by whom.
create or replace view court_availability with (security_invoker = off) as
select court_id,
       start_at,
       end_at,
       case when kind = 'lesson' then 'booking'::reservation_kind else kind end as kind
  from reservations
 where status in ('pending','confirmed','arrived')
   and (kind <> 'hold' or hold_expires_at > now());

grant select on court_availability to anon, authenticated;

comment on view court_availability is
  '0008, 0277. The booking surface''s free/busy: every live reservation (a hold only until its TTL) as court, start, end and kind, with no guest, price or note. 0277: a lesson''s court row reads as a booking (a held private lesson as a hold). Owner rights on purpose (scripts/check-db-invariants.mjs AUDITED_OWNER_RIGHTS_VIEWS).';

-- ===========================================================================
-- 4. A lesson's court hold is not an orphan (R1, R25; db.md §4.5.2)
-- ===========================================================================
-- expire_stale_holds (20261001000268_hold_sweep_split.sql:33) and its twin
-- match_expire_holds (0268:71), re-issued together as the twin's comment asks.
-- Only the orphan clause changes: a pending hold with no guest is an orphan
-- unless it names a lesson (the 0275 widening of reservations_live_hold_has_guest).
-- A lapsed lesson hold expires by TTL like any hold: at its hold_expires_at, or
-- later while its payment is open (the same open-payment skip as a deposit
-- hold). Same id-ordered single statement, same grants (create or replace keeps
-- 0268's: the service role, no client).
create or replace function app.expire_stale_holds(
  p_court_id uuid default null,
  p_period   tstzrange default null
) returns int
language plpgsql security definer set search_path = public as $expire_stale_holds_0277$
declare v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or (r.guest_id is null and r.lesson_id is null))   -- 0071 (SEC-07): orphans too;
                                                                                          -- 0277 (R25): a lesson's court hold is no orphan
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
end $expire_stale_holds_0277$;

comment on function app.expire_stale_holds(uuid, tstzrange) is
  '0071: expires holds past their TTL AND orphan holds (guest_id is null), which no caller can release through app.release_hold and which would otherwise occupy the court until TTL. 0242: skips a hold whose online payment is still open, until ten minutes after that payment''s deadline. 0268: only expires — strikes are settled by the tp_hold_strikes cron (app.hold_strikes_settle) in a transaction of their own — and is no longer granted to clients. 0277 (R25): a pending hold that names a lesson (reservations.lesson_id, a private lesson''s court hold while its Qi payment is open) is not an orphan: it expires by its TTL like any hold, and its open payment holds it as a deposit''s does.';

-- match_expire_holds: re-issued from 20261001000268_hold_sweep_split.sql:71 with
-- the same one-line change.
create or replace function app.match_expire_holds(p_venue uuid, p_period tstzrange) returns int
language plpgsql security definer set search_path = public as $match_expire_holds_0277$
declare
  v_count int;
begin
  update reservations
     set status = 'expired'
   where id in (
     select r.id from reservations r
      where r.kind = 'hold' and r.status = 'pending'
        and (r.hold_expires_at < now() or (r.guest_id is null and r.lesson_id is null))   -- 0071 (SEC-07): orphans too;
                                                                                          -- 0277 (R25): a lesson's court hold is no orphan
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
end $match_expire_holds_0277$;

comment on function app.match_expire_holds(uuid, tstzrange) is
  '0260. Internal. The branch-scoped twin of app.expire_stale_holds (0242, 0252): expires the branch''s stale and orphan holds overlapping p_period in ONE id-ordered statement, skipping a hold whose online payment is still open. Settles no hold-ladder strike: like expire_stale_holds with arguments, it leaves a lapse to the guest''s next hold_slot or to tp_hold_sweep (0252). Whoever re-issues expire_stale_holds re-issues this in the same file (a test pins the two to the same rows). 0277 (R25): like expire_stale_holds, a pending hold that names a lesson is not an orphan; it expires by its TTL.';

-- ===========================================================================
-- 5. close_branch (db.md §4.5.1, R37)
-- ===========================================================================
-- Re-issued from 20260926000233_branch_lifecycle.sql:69. A live lesson or
-- course session has exactly one live court row (kind 'lesson', or 'hold' for a
-- held private lesson), so counting kind 'lesson' beside booking and hold
-- counts every lesson still to come. Then R37: once a branch is closed nobody
-- is staff there (is_staff_at is false at a closed branch), so nobody could
-- approve or pay its coach statements or refund its lesson money at the till.
create or replace function app.close_branch(p_venue uuid)
 RETURNS venues
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $close_branch_0277$
declare
  v_old venues%rowtype;
  v_row venues%rowtype;
  v_n   int;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0233: one status change (or day open) at a time, chain-wide.
  perform pg_advisory_xact_lock(hashtextextended('venue_status', 0));
  select * into v_old from venues where id = p_venue for update;
  if not found then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_old.status = 'closed' then
    return v_old;
  end if;
  if v_old.status = 'open'
     and not exists (select 1 from venues v where v.status = 'open' and v.id <> p_venue) then
    raise exception 'LAST_OPEN_BRANCH' using errcode = 'P0001',
      hint = 'open another branch before closing this one';
  end if;
  if exists (select 1 from day_sessions d where d.venue_id = p_venue and d.status in ('open','closing')) then
    raise exception 'BRANCH_DAY_OPEN' using errcode = 'P0001',
      hint = 'close the branch''s day first';
  end if;

  -- 0233: guests with a court still to come are told by a person, not by a
  -- closed door. Cancel or move them first.
  select count(*) into v_n
    from reservations r
   where r.venue_id = p_venue
     and r.kind in ('booking', 'hold', 'lesson')   -- 0277: a lesson's court row is a booking to come
     and r.status in ('pending', 'confirmed')
     and r.end_at > now();
  v_n := v_n + (select count(*) from reservation_series s
                 where s.venue_id = p_venue and s.cancelled_at is null
                   and (s.ends_on is null or s.ends_on >= current_date));
  if v_n > 0 then
    raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = v_n::text,
      hint = 'cancel or move the branch''s bookings, lessons, holds and series first';
  end if;

  -- 0277 (R37): coaching money still to settle. Money's app.lesson_money_open
  -- (0278) is true while the branch has a draft or approved coach statement, a
  -- statement lesson in a month with no non-void statement, or an enrolment
  -- whose lesson money is still due back at the till (or blocked on Qi). The
  -- outer test keeps the call off a branch that never had a lesson or a
  -- statement; the nested IF is prepared only when it runs.
  if exists (select 1 from lessons l where l.venue_id = p_venue)
     or exists (select 1 from coach_statements s where s.venue_id = p_venue) then
    if app.lesson_money_open(p_venue) then
      raise exception 'BRANCH_HAS_BOOKINGS' using errcode = 'P0001', detail = 'coaching_money',
        hint = 'approve and pay the branch''s coach statements and make its lesson refunds first';
    end if;
  end if;

  -- 0233: tidy up while the branch is still open, so every row below (and the
  -- audit row) is filed there.
  perform set_config('app.venue_id', p_venue::text, true);
  update guest_sessions set closed_at = now()
   where venue_id = p_venue and closed_at is null;
  delete from station_staff where venue_id = p_venue;
  delete from device_heartbeats where venue_id = p_venue;
  update stations set retired_at = now()
   where venue_id = p_venue and retired_at is null;
  update degraded_periods set ended_at = now()
   where venue_id = p_venue and ended_at is null;
  perform app.write_audit('venue.close', 'venues', p_venue::text,
    jsonb_build_object('status', v_old.status), jsonb_build_object('status', 'closed'));

  update venues set status = 'closed' where id = p_venue returning * into v_row;
  return v_row;
end $close_branch_0277$;

comment on function app.close_branch(uuid) is
  '0223 (MV4). Owner-only: close a branch (never deleted). Refuses the last open branch (LAST_OPEN_BRANCH) and a branch whose day is still open (BRANCH_DAY_OPEN). Audited as venue.close. 0277: live lessons count with the bookings (BRANCH_HAS_BOOKINGS, detail the count); R37: a branch with coaching money to settle (a draft or approved coach statement, an undrafted month of statement lessons, a lesson refund still due at the till or blocked on Qi; app.lesson_money_open) is refused BRANCH_HAS_BOOKINGS detail coaching_money.';

-- ===========================================================================
-- 6. LESSON_VIA_COACHING (R7, R35, R73; db.md §4.5.3, §4.5.4)
-- ===========================================================================

-- cancel_reservation: re-issued from 20260926000210_booking_settings_per_venue.sql:543.
-- Right after v_staff is known: staff only. A guest still gets FORBIDDEN from
-- the ownership check (a lesson row has no guest_id), so no guest learns that a
-- row is a lesson.
create or replace function app.cancel_reservation(
  p_reservation_id uuid,
  p_reason         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $cancel_reservation_0277$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_staff  boolean;
  v_window int;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_CANCELLABLE' using errcode = 'P0001';
  end if;

  v_staff := app.is_staff('court_desk','manager','owner');
  -- 0277 (R7, db.md §4.5.3): a lesson is cancelled through the coaching RPCs
  -- (desk_cancel_lesson and friends), which refund and notify its students.
  if v_staff and v.lesson_id is not null then
    raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'cancel',
      hint = 'a lesson is cancelled from its lesson screen';
  end if;
  if not v_staff then
    if v.guest_id is distinct from auth.uid() then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    select cancellation_window_hours into v_window from venue_settings where venue_id = v.venue_id;
    if v.start_at < now() + make_interval(hours => coalesce(v_window, 12)) then
      raise exception 'CANCELLATION_WINDOW' using errcode = 'P0001',
        hint = 'inside the cancellation window — contact the venue';
    end if;
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = p_reason,
         -- The SAME branch the policy above turned on: a staff caller reaches
         -- this line without owning the row or clearing the window, a guest
         -- only after proving both. Recording it costs nothing here and is
         -- unrecoverable afterwards from the reservation alone.
         cancelled_by = (case when v_staff then 'staff' else 'guest' end)::cancellation_actor
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.cancel', 'reservations', v.id::text,
                          v_before, to_jsonb(v), p_reason);

  return jsonb_build_object('reservation_id', v.id, 'status', v.status,
                            'cancelled_by', v.cancelled_by);
end $cancel_reservation_0277$;

comment on function app.cancel_reservation(uuid, text) is
  '0088 = 0008 + the actor. Guest cancels an OWN booking outside cancellation_window_hours; staff cancel any live booking. Stamps reservations.cancelled_by from the same staff check the policy branch already makes, so the guest can be told whether they cancelled it or the venue did. 0277: a lesson''s court row (lesson_id set) is refused to staff with LESSON_VIA_COACHING detail cancel; a guest gets FORBIDDEN from the ownership check as for any row that is not theirs.';

-- mark_reservation: re-issued from 20260929000262_match_desk_money.sql:3232.
-- Right after RESERVATION_NOT_FOUND, before MATCH_MARK_SEATS, for every status:
-- attendance is marked per student, and completion is the lesson sweep's.
create or replace function app.mark_reservation(
  p_reservation_id uuid,
  p_status         reservation_status,
  p_reason         text default 'staff_op'      -- recorded in the audit row (0026)
) returns jsonb
language plpgsql security definer set search_path = public as $mark_reservation_0277$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_ok     boolean;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0277 (R7, R35, db.md §4.5.3): a lesson's court row is changed only through
  -- the coaching RPCs (the lesson screen), queued or not.
  if v.lesson_id is not null then
    raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'mark',
      hint = 'a lesson''s students are marked on its lesson screen';
  end if;

  -- 0262 (db.md §4.7.13): an open match's booking is marked player by player
  -- (mark_match_seats), whatever the match's status, so an offline
  -- reservation.update replay can never forfeit four people's tickets in one
  -- click. arrived and completed stay allowed (completed ends the match).
  if p_status = 'no_show' and exists (select 1 from matches m where m.reservation_id = p_reservation_id) then
    raise exception 'MATCH_MARK_SEATS' using errcode = 'P0001',
      hint = 'an open match is marked player by player (mark_match_seats)';
  end if;

  v_ok := (p_status = 'arrived'   and v.status = 'confirmed')
       or (p_status = 'no_show'   and v.status = 'confirmed')
       or (p_status = 'completed' and v.status in ('confirmed','arrived'));
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  -- 0071 (SEC-11), restored. Checked against the FOR UPDATE read, so it cannot
  -- race a concurrent move that shifted start_at.
  if p_status in ('no_show','completed') and now() < v.start_at then
    raise exception 'RESERVATION_NOT_STARTED' using errcode = 'P0001',
      detail = format('starts at %s', v.start_at),
      hint = 'a future booking is cancelled through cancel_reservation with a reason, not marked no_show';
  end if;

  v_before := to_jsonb(v);

  -- 0075: the booking is over from this moment. Anything asking "has this
  -- ended?" reads cancelled_at, and a no-show used to leave it null.
  update reservations
     set status = p_status,
         cancelled_at = case when p_status in ('no_show','completed')
                             then coalesce(v.cancelled_at, now())
                             else v.cancelled_at end,
         cancellation_reason = case when p_status = 'no_show'
                                    then coalesce(p_reason, 'no_show')
                                    else v.cancellation_reason end
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.mark_' || p_status::text, 'reservations',
                          v.id::text, v_before, to_jsonb(v),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'status', v.status);
end $mark_reservation_0277$;

comment on function app.mark_reservation(uuid, reservation_status, text) is
  '0262 = the 0089 body (0076 = 0075 + 0071/SEC-11) plus one refusal: no_show on a booking that is an open match''s reservation_id is MATCH_MARK_SEATS, whatever the match''s status (marks are per seat, mark_match_seats). arrived / no_show / completed. The two ENDINGS stamp cancelled_at (a no_show also stamps cancellation_reason) AND are refused before start_at with RESERVATION_NOT_STARTED, because both leave the exclusion set and would free a future court for resale. A no_show is not a cancellation: the reports count them separately. 0277: a lesson''s court row is refused LESSON_VIA_COACHING detail mark, whatever the status (attendance is per student, completion is the lesson sweep''s).';

-- extend_reservation: re-issued from 20260906000071_booking_integrity.sql:444.
-- After the FOR UPDATE read (under the court lock) and its RESERVATION_NOT_FOUND.
create or replace function app.extend_reservation(
  p_reservation_id uuid,
  p_new_end_at     timestamptz,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $extend_reservation_0277$
declare
  v          reservations%rowtype;
  v_before   jsonb;
  v_from     uuid;
  v_dur      int;
  v_rule     uuid;
  v_price    bigint;
  v_override boolean;
  v_was      bigint;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042): same order as every other writer -- court, then row.
  select court_id into v_from from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform app.lock_court(v_from);

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0277 (R7, R35, db.md §4.5.3): a lesson's court row is changed only through
  -- the coaching RPCs (the lesson screen), queued or not.
  if v.lesson_id is not null then
    raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'extend',
      hint = 'a lesson keeps its length; move it in time from its lesson screen';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_EXTENDABLE' using errcode = 'P0001';
  end if;
  if p_new_end_at <= v.start_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  -- 0048 (H5): see move_reservation.
  if v.court_id is distinct from v_from then
    raise exception 'RESERVATION_MOVED' using errcode = '40001',
      hint = 'the reservation changed court while locks were acquired - retry';
  end if;

  v_before := to_jsonb(v);
  v_was    := v.price_iqd;

  -- 0048 (H2): extending past closing time was accepted outright.
  if v.kind <> 'maintenance' then
    perform app.assert_bookable(v.court_id, v.start_at, p_new_end_at);
  end if;

  perform app.expire_stale_holds(v.court_id, tstzrange(v.start_at, p_new_end_at, '[)'));

  -- 0048 (H1): extending a 60-minute booking to 120 kept the 60-minute price.
  -- Manual overrides are preserved, as in move_reservation.
  v_override := (v.kind = 'booking' and v.rate_rule_id is null and v.price_iqd is not null);
  if v.kind = 'booking' and not v_override then
    v_dur := (extract(epoch from (p_new_end_at - v.start_at)) / 60)::int;
    select ps.rule_id, ps.price_iqd into v_rule, v_price
      from app.price_slot(v.court_id, v.start_at, v_dur) ps;
    if v_rule is null then
      raise exception 'NO_RATE' using errcode = 'P0001',
        hint = 'no rate rule prices the extended duration';
    end if;
  else
    v_rule  := v.rate_rule_id;
    v_price := v.price_iqd;
  end if;

  -- 0071 (SEC-09): an extend almost ALWAYS re-prices (60 -> 120 minutes is a
  -- different price row), so this is the path the rule was written for.
  if v_price is distinct from v_was and not app.reason_given(p_reason) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      detail = format('price %s -> %s', coalesce(v_was::text, 'null'), coalesce(v_price::text, 'null')),
      hint = 'an extend that changes the price needs an explicit reason';
  end if;

  begin
    update reservations
       set end_at = p_new_end_at, rate_rule_id = v_rule, price_iqd = v_price
     where id = p_reservation_id
     returning * into v;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
  end;

  perform app.write_audit('reservation.extend', 'reservations', v.id::text,
                          v_before,
                          to_jsonb(v) || jsonb_build_object(
                            'price_before',     v_was,
                            'price_after',      v.price_iqd,
                            'price_changed',    (v.price_iqd is distinct from v_was),
                            'rate_rule_before', v_before ->> 'rate_rule_id',
                            'rate_rule_after',  v.rate_rule_id),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'end_at', v.end_at,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd,
    'price_before', v_was, 'price_changed', (v.price_iqd is distinct from v_was));
end $extend_reservation_0277$;

comment on function app.extend_reservation(uuid, timestamptz, text) is
  '0071 (SEC-09), 0277. Desk (court_desk, manager, owner): extends a live reservation to p_new_end_at under its court lock, re-priced by its rate rule (a manual override kept); a price change needs a reason (REASON_REQUIRED). RESERVATION_NOT_FOUND, NOT_EXTENDABLE, INVALID_RANGE, RESERVATION_MOVED (40001), NO_RATE, SLOT_TAKEN. 0277: a lesson''s court row is refused LESSON_VIA_COACHING detail extend (a lesson keeps its length).';

-- staff_create_reservation: re-issued from 20260929000263_match_reservation_triggers.sql:443.
-- After the branch block, before INVALID_RANGE. It never sets lesson_id, so it
-- cannot make a lesson row of another kind; without this a kind 'lesson' row
-- with no lesson would only meet a raw 23514 (reservations_lesson_link).
create or replace function app.staff_create_reservation(
  p_court_id           uuid,
  p_kind               reservation_kind,
  p_start_at           timestamptz,
  p_end_at             timestamptz,
  p_guest_name         text default null,
  p_guest_phone        text default null,
  p_guest_id           uuid default null,
  p_notes              text default null,
  p_idempotency_key    text default null,
  p_client_ref         text default null,
  p_device_id          text default null,
  p_price_override_iqd bigint default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a till on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players            int default null
) returns jsonb
language plpgsql security definer set search_path = public as $staff_create_reservation_0277$
declare
  v_venue uuid;
  v_status   reservation_status;
  v_ttl      int;
  v_expires  timestamptz;
  v_rule     uuid;
  v_price    bigint;
  v_dur      int;
  v_existing reservations%rowtype;
  v_res      reservations%rowtype;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the court's branch decides the day, the rows written and who may act.
  v_venue := (select c.venue_id from courts c where c.id = p_court_id);
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'court_desk','manager','owner') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  -- 0277 (db.md §4.5.3): a lesson is booked through the coaching RPCs, which
  -- take the coach and pick the court (desk_book_lesson and friends).
  if p_kind = 'lesson' then
    raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'create',
      hint = 'a lesson is booked from the lessons screen';
  end if;
  if p_end_at <= p_start_at then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_existing from reservations where idempotency_key = p_idempotency_key;
    if found then
      -- 0048 (H3): scoped to the staff member who created it.
      if v_existing.created_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another reservation';
      end if;
      return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
        'status', v_existing.status);
    end if;
  end if;

  -- BOOKING-HOURS GUARD (0026): maintenance is exempt -- blocking time on a
  -- closed day (repairs, private events) is legitimate.
  if p_kind <> 'maintenance' then
    perform app.assert_bookable(p_court_id, p_start_at, p_end_at);
  end if;

  if p_kind = 'booking' and p_guest_id is null and p_guest_name is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042): same point in the sequence as hold_slot -- the desk and
  -- the guest app now queue for one court instead of racing into the GiST
  -- exclusion check and deadlocking there.
  perform app.lock_court(p_court_id);

  perform app.expire_stale_holds(p_court_id, tstzrange(p_start_at, p_end_at, '[)'));

  -- 0263 (R22, C9): an open match waiting for a court keeps it, whatever the
  -- kind (series go through here). After the lazy expiry above. Not while the
  -- branch trades offline inside the protected horizon: the sweep does not
  -- book the match there, so the desk may take the court (part B bumps it).
  if app.match_court_claimed(p_court_id, tstzrange(p_start_at, p_end_at, '[)')) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'match_waiting',
      hint = 'a full open match is waiting for this court';
  end if;

  v_status := case when p_kind = 'hold' then 'pending' else 'confirmed' end;
  if p_kind = 'hold' then
    select hold_ttl_seconds into v_ttl from venue_settings where venue_id = (select c.venue_id from courts c where c.id = p_court_id);
    v_expires := now() + make_interval(secs => coalesce(v_ttl, 300));
  end if;

  if p_kind = 'booking' then
    v_dur := (extract(epoch from (p_end_at - p_start_at)) / 60)::int;
    select ps.rule_id, ps.price_iqd into v_rule, v_price
      from app.price_slot(p_court_id, p_start_at, v_dur) ps;
    if p_price_override_iqd is not null then
      -- Explicit price under manager/owner authority (odd ranges no rule
      -- prices, or a deliberate override). Audited below.
      if not app.is_staff('manager','owner') then
        raise exception 'FORBIDDEN' using errcode = 'P0001',
          hint = 'price overrides are manager/owner only';
      end if;
      if p_price_override_iqd < 0 then
        raise exception 'INVALID_PRICE' using errcode = 'P0001';
      end if;
      v_price := p_price_override_iqd;
      v_rule  := null;                          -- 0048: mark it as an override for H1
    elsif v_rule is null then
      -- 0026: an unpriced booking is never stored silently any more.
      raise exception 'NO_RATE' using errcode = 'P0001',
        hint = 'no rate rule prices this range - a manager/owner may pass p_price_override_iqd';
    end if;
  end if;

  begin
    insert into reservations
      (court_id, kind, status, start_at, end_at, guest_id, guest_name, guest_phone,
       created_by_staff_id, source, rate_rule_id, price_iqd, hold_expires_at,
       notes, device_id, idempotency_key, client_ref)
    values
      (p_court_id, p_kind, v_status, p_start_at, p_end_at, p_guest_id, p_guest_name,
       p_guest_phone, auth.uid(), 'desk', v_rule, v_price, v_expires,
       p_notes, p_device_id, p_idempotency_key, p_client_ref)
    returning * into v_res;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
    when unique_violation then
      if p_idempotency_key is not null then
        select * into v_existing from reservations where idempotency_key = p_idempotency_key;
        if found then
          if v_existing.created_by_staff_id is distinct from auth.uid() then
            raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
              hint = 'that key belongs to another reservation';
          end if;
          return jsonb_build_object('duplicate', true, 'reservation_id', v_existing.id,
            'status', v_existing.status);
        end if;
      end if;
      raise;
  end;

  perform app.write_audit('reservation.create', 'reservations', v_res.id::text,
                          null, to_jsonb(v_res), null, null, p_device_id);

  if p_kind = 'booking' and p_price_override_iqd is not null then
    perform app.write_audit('reservation.price_override', 'reservations', v_res.id::text,
                            null,
                            jsonb_build_object('price_override_iqd', p_price_override_iqd,
                                               'applied_by', auth.uid(),
                                               'rate_rule_id', v_rule),
                            'price_override', null, p_device_id);
  end if;

  return jsonb_build_object('duplicate', false, 'reservation_id', v_res.id,
    'status', v_res.status, 'rate_rule_id', v_rule, 'price_iqd', v_price);
end $staff_create_reservation_0277$;

comment on function app.staff_create_reservation(uuid, reservation_kind, timestamptz, timestamptz, text, text, uuid, text, text, text, text, bigint, int) is
  'Desk (court_desk, manager, owner at the court''s branch, 0217): creates a booking, hold or maintenance row; serialised on the court (0042) with lazy hold expiry; a booking is priced by its rate rule, or by p_price_override_iqd (manager, owner; audited). 0263 (R22): a court an awaiting_court open match could still book is refused SLOT_TAKEN detail match_waiting (app.match_court_claimed), for every kind, so series (create_series) too; not while the branch is degraded with the match inside protected_horizon_hours (the sweep does not book it there; the new row bumps it instead). p_players is accepted and ignored (0147). 0277: p_kind lesson is refused LESSON_VIA_COACHING detail create (lessons are booked through the coaching RPCs).';

-- open_tab: re-issued from 20260927000244_shop_desk_access.sql:70. In the
-- p_reservation_id branch the read also takes lesson_id; a lesson row is
-- refused before RESERVATION_NOT_LIVE. A lesson is paid on its own kind
-- 'lesson' tab (Money's lesson_settle); p_kind 'lesson' stays INVALID_ARGUMENT.
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null,
  p_kind            text default 'cafe'
) returns jsonb
language plpgsql security definer set search_path = public as $open_tab_0277$
declare
  v_venue uuid;
  v_day        uuid;
  v_row        tabs%rowtype;
  v_label      text := nullif(btrim(p_label), '');
  v_status     reservation_status;
  v_live       uuid;
  v_constraint text;
  v_kind       text := coalesce(p_kind, 'cafe');
  v_lesson     uuid;   -- 0277
begin
  if not app.is_staff('cashier','court_desk','manager','owner','shop_staff') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0217: the table or booking's branch decides the day, the rows written and who may act.
  v_venue := coalesce((select t.venue_id from cafe_tables t where t.id = p_table_id),
                     (select r.venue_id from reservations r where r.id = p_reservation_id));
  if v_venue is not null then
    if not app.is_staff_at(v_venue, 'cashier','court_desk','manager','owner','shop_staff') then
      raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  if v_kind not in ('cafe','shop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_kind';
  end if;
  -- 0244: the kind decides who may open it (shop_staff shop only, the café
  -- staff café only), and a shop sale is paid on the spot: no table, no booking.
  perform app.assert_tab_kind_role(v_kind);
  if v_kind = 'shop' and (p_table_id is not null or p_reservation_id is not null) then
    raise exception 'SHOP_TAB_NO_ANCHOR' using errcode = 'P0001',
      hint = 'a shop sale is paid at the shop desk; it never goes on a table or a booking';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from tabs where idempotency_key = p_idempotency_key;
    if found then
      if v_row.opened_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another tab';
      end if;
      return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null then
    select status, lesson_id into v_status, v_lesson from reservations where id = p_reservation_id;
    if not found then
      raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
    end if;
    -- 0277 (db.md §4.5.3): a lesson is paid on its own bill (lesson_settle),
    -- never on a tab opened against its court row.
    if v_lesson is not null then
      raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'tab',
        hint = 'a lesson is paid from its lesson screen';
    end if;
    -- 0106: a booking that has ended without being played owes nothing; a tab
    -- opened against it is a mistake the day close would have to clean up.
    if v_status in ('cancelled','no_show','expired') then
      raise exception 'RESERVATION_NOT_LIVE' using errcode = 'P0001', detail = v_status::text;
    end if;
    -- 0106 (D1): friendly refusal. NOT serialised — two concurrent opens both
    -- pass it; tabs_one_live_per_reservation is the guard, mapped below.
    select id into v_live from tabs
     where reservation_id = p_reservation_id
       and status in ('open','awaiting_payment')
     limit 1;
    if v_live is not null then
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = v_live::text,
        hint = 'this booking already has an open bill; add to that one';
    end if;
  end if;
  if p_table_id is null and p_reservation_id is null then
    -- 0145: a shop counter sale is the one tab with no table and no booking;
    -- its label is what the till and the day close show for it.
    if v_kind = 'shop' then
      if v_label is null then
        raise exception 'LABEL_REQUIRED' using errcode = 'P0001',
          hint = 'a counter sale needs a name or a number';
      end if;
    else
      raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001',
        hint = 'a tab needs a table or a reservation; a name alone is not an anchor';
    end if;
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key, kind)
    values (v_day, p_table_id, p_reservation_id, v_label,
            auth.uid(), p_device_id, p_idempotency_key, v_kind)
    returning * into v_row;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'tabs_one_live_per_reservation' then
      select id into v_live from tabs
       where reservation_id = p_reservation_id
         and status in ('open','awaiting_payment')
       limit 1;
      raise exception 'BOOKING_TAB_OPEN' using errcode = 'P0001', detail = coalesce(v_live::text, ''),
        hint = 'this booking already has an open bill; add to that one';
    end if;
    if p_idempotency_key is not null then
      select * into v_row from tabs where idempotency_key = p_idempotency_key;
      if found then
        if v_row.opened_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another tab';
        end if;
        return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
      end if;
    end if;
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id);
end $open_tab_0277$;

comment on function app.open_tab(uuid, text, uuid, text, text, text) is
  '0106, 0145, 0217, 0244, 0277. Opens a staff tab at the branch of its table or booking (VENUE_MISMATCH elsewhere): kind cafe (cashier, court_desk, manager, owner; a table or a booking is its anchor, TAB_ANCHOR_REQUIRED) or shop (shop_staff, manager, owner; no anchor, a label, SHOP_TAB_NO_ANCHOR, LABEL_REQUIRED); any other p_kind is INVALID_ARGUMENT. A booking takes at most one live tab (BOOKING_TAB_OPEN, detail = that tab id) and an ended booking none (RESERVATION_NOT_LIVE). NO_OPEN_DAY, TABLE_NOT_FOUND, RESERVATION_NOT_FOUND, IDEMPOTENCY_CONFLICT. 0277: a tab against a lesson''s court row is refused LESSON_VIA_COACHING detail tab: a lesson is paid on its own kind lesson tab (lesson_settle).';

-- confirm_booking: re-issued from 20260927000242_online_deposit_rpcs.sql:1304
-- (R35). After the FOR UPDATE read and the ownership check: staff are refused
-- (before, they met only a raw 23514 from reservations_lesson_kind); a guest
-- gets FORBIDDEN from ownership as for any row that is not theirs.
create or replace function app.confirm_booking(
  p_hold_id     uuid,
  p_guest_name  text default null,
  p_guest_phone text default null,
  -- 0147: DEPRECATED, accepted and IGNORED (no range check, no write). Kept so
  -- a phone on an older build that still sends it does not get PGRST202;
  -- dropped by a later migration once every till and app build is past 0147.
  p_players     int  default null
) returns jsonb
language plpgsql security definer set search_path = public as $confirm_booking_0277$
declare
  v_uid    uuid := auth.uid();
  v        reservations%rowtype;
  v_before jsonb;
  v_rule   uuid;
  v_price  bigint;
  v_dur    int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_hold_id for update;
  if not found then
    raise exception 'HOLD_NOT_FOUND' using errcode = 'P0001';
  end if;

  if not app.is_staff('court_desk','manager','owner')
     and v.guest_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- 0277 (R7, R35, db.md §4.5.3): a lesson's court row is changed only through
  -- the coaching RPCs (the lesson screen), queued or not.
  if v.lesson_id is not null then
    raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'confirm',
      hint = 'a lesson is confirmed by its payment or from its lesson screen';
  end if;

  -- Idempotent confirm.
  if v.kind = 'booking' and v.status = 'confirmed' then
    return jsonb_build_object('duplicate', true, 'reservation_id', v.id,
      'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
  end if;

  if v.kind <> 'hold' or v.status <> 'pending' or v.hold_expires_at < now() then
    raise exception 'HOLD_EXPIRED' using errcode = 'P0001';
  end if;

  -- DEGRADED GUARD (0021): guests cannot confirm inside the protected horizon
  -- while the venue trades offline; staff paths are unaffected.
  if not app.is_staff('court_desk','manager','owner') then
    perform app.assert_not_degraded_for(v.start_at, v.venue_id);
  end if;

  -- 0059: spec 05.3 makes the phone a required PROFILE field and the desk
  -- relies on it to reach a guest about their booking. Enforced only in the app
  -- until now; a social sign-in creates a phone-less profile, so the write path
  -- refuses too. Staff paths pass p_guest_phone and are exempt.
  if not app.is_staff('court_desk','manager','owner')
     and not exists (select 1 from profiles
                      where id = v_uid and nullif(btrim(phone), '') is not null) then
    raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
      hint = 'add a phone number to your profile before confirming';
  end if;

  -- 0242: when the branch asks this guest to pay first, a guest confirm needs
  -- a paid deposit (which app.deposit_apply confirms by itself, so reaching
  -- here without one is the refusal). Desk bookings are never asked.
  if not app.is_staff('court_desk','manager','owner')
     and app.deposit_mode_for(v_uid, v.venue_id) = 'required'
     and not exists (select 1 from booking_payments bp
                      where bp.hold_id = v.id and bp.status = 'succeeded') then
    raise exception 'DEPOSIT_REQUIRED' using errcode = 'P0001',
      hint = 'this booking needs an online deposit before it is confirmed';
  end if;

  if v.guest_id is null and coalesce(p_guest_name, v.guest_name) is null then
    raise exception 'GUEST_REQUIRED' using errcode = 'P0001',
      hint = 'a booking needs guest_id or guest_name';
  end if;

  v_before := to_jsonb(v);
  v_dur := (extract(epoch from (v.end_at - v.start_at)) / 60)::int;

  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(v.court_id, v.start_at, v_dur) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001';
  end if;

  -- 0117 (C5): quote = charge. The hold carries the price the guest was shown
  -- (stamped by hold_slot since 0117). If the rate rules moved underneath the
  -- hold, refuse rather than charge an amount nobody agreed to; the app shows
  -- the new price and asks again. A hold from before 0117 has no stamp and
  -- keeps the old behaviour. Staff paths are exempt: the desk sees the current
  -- price on screen as it confirms.
  if v.price_iqd is not null and v.price_iqd <> v_price
     and not app.is_staff('court_desk','manager','owner') then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001',
      detail = jsonb_build_object('quoted_iqd', v.price_iqd, 'current_iqd', v_price,
                                  'rate_rule_id', v_rule)::text,
      hint = 'the price of this slot changed after it was held; hold it again to see the new price';
  end if;

  update reservations
     set kind            = 'booking',
         status          = 'confirmed',
         rate_rule_id    = v_rule,
         price_iqd       = v_price,
         guest_name      = coalesce(p_guest_name, guest_name),
         guest_phone     = coalesce(p_guest_phone, guest_phone),
         hold_expires_at = null
   where id = p_hold_id
   returning * into v;

  perform app.write_audit('reservation.confirm', 'reservations', v.id::text,
                          v_before, to_jsonb(v), null, null, v.device_id);

  return jsonb_build_object('duplicate', false, 'reservation_id', v.id,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd);
end $confirm_booking_0277$;

comment on function app.confirm_booking(uuid, text, text, int) is
  '0092, 0242, 0277. Turns a live hold into a confirmed booking at the price its rate rule names now: the hold''s own guest (PHONE_REQUIRED, the degraded guard, DEPOSIT_REQUIRED when the branch asks for a deposit, PRICE_CHANGED when the quoted price moved) or the desk (court_desk, manager, owner). HOLD_NOT_FOUND, FORBIDDEN (not the guest''s hold), HOLD_EXPIRED, GUEST_REQUIRED, NO_RATE; a confirmed booking answers duplicate. 0277 (R35): a lesson''s court hold is refused LESSON_VIA_COACHING detail confirm (Money''s payment success confirms it); a guest gets FORBIDDEN from ownership first.';

-- move_reservation: re-issued from 20260923000150_move_not_into_past.sql:37 (R7).
-- After INVALID_RANGE and before RESERVATION_IN_PAST, whatever the new court
-- and times: desk_move_lesson_court (0280) is the only way to move a lesson's
-- court, and a lesson moves in time through its reschedule.
create or replace function app.move_reservation(
  p_reservation_id uuid,
  p_court_id       uuid default null,
  p_start_at       timestamptz default null,
  p_end_at         timestamptz default null,
  p_reason         text default 'staff_op'
) returns jsonb
language plpgsql security definer set search_path = public as $move_reservation_0277$
declare
  v          reservations%rowtype;
  v_before   jsonb;
  v_from     uuid;
  v_court    uuid;
  v_start    timestamptz;
  v_end      timestamptz;
  v_dur      int;
  v_rule     uuid;
  v_price    bigint;
  v_override boolean;
  v_was      bigint;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- SERIALIZE (0042). Unlocked peek first, only to learn which court(s) this
  -- move touches; every guard below still runs against the FOR UPDATE read.
  select court_id into v_from from reservations where id = p_reservation_id;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_court := coalesce(p_court_id, v_from);

  -- Cross-court move touches two exclusion scopes: take them in a total order
  -- so two opposing moves queue instead of deadlocking (merge_tabs, 0015).
  if v_court = v_from then
    perform app.lock_court(v_from);
  else
    perform app.lock_court(least(v_from, v_court));
    perform app.lock_court(greatest(v_from, v_court));
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_MOVABLE' using errcode = 'P0001';
  end if;

  -- 0048 (H5): the lock set above was chosen from an UNLOCKED peek. Two
  -- concurrent movers hold DIFFERENT pairs, so the locked court can differ from
  -- the peek; writing anyway would enter the exclusion window holding no lock on
  -- the court we write. 40001 is retryable, which is what the caller should do.
  if v.court_id is distinct from v_from then
    raise exception 'RESERVATION_MOVED' using errcode = '40001',
      hint = 'the reservation changed court while locks were acquired - retry';
  end if;

  v_before := to_jsonb(v);
  v_was    := v.price_iqd;
  v_court  := coalesce(p_court_id, v.court_id);
  v_start  := coalesce(p_start_at, v.start_at);
  v_end    := coalesce(p_end_at, v.end_at);
  if v_end <= v_start then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;

  -- 0277 (R7, R35, db.md §4.5.3): a lesson's court row is changed only through
  -- the coaching RPCs (the lesson screen), queued or not.
  if v.lesson_id is not null then
    raise exception 'LESSON_VIA_COACHING' using errcode = 'P0001', detail = 'move',
      hint = 'a lesson changes court or time from its lesson screen';
  end if;

  -- 0150: a start MOVED into the past strands the booking. On 2026-09-23 a
  -- 00:00-01:00 booking made from the app was dragged "half an hour earlier"
  -- on the desk grid and landed at 22:30: this function took it, the desk went
  -- on calling it confirmed, and on the guest's phone it left Upcoming and
  -- appeared in no list at all. Nothing downstream can repair that, so it is
  -- refused here.
  --
  -- A start that does NOT move is not this: carrying a game already running
  -- across to another court is a normal desk act and only the court changes.
  -- Shortening and extending go through extend_reservation, not this function,
  -- so neither is caught by the guard.
  if v_start is distinct from v.start_at and v_start < now() then
    raise exception 'RESERVATION_IN_PAST' using errcode = 'P0001',
      detail = format('%s -> %s', v.start_at, v_start),
      hint = 'a booking cannot be moved to a start time that has already passed';
  end if;

  -- 0048 (H2): re-validate opening hours and closed dates. Maintenance is
  -- exempt for the same reason it is in staff_create_reservation.
  if v.kind <> 'maintenance' then
    perform app.assert_bookable(v_court, v_start, v_end);
  end if;

  perform app.expire_stale_holds(v_court, tstzrange(v_start, v_end, '[)'));

  -- 0048 (H1): re-price. A MANUAL OVERRIDE is preserved: rate_rule_id null with
  -- a price set means a manager priced this deliberately
  -- (staff_create_reservation, p_price_override_iqd).
  v_override := (v.kind = 'booking' and v.rate_rule_id is null and v.price_iqd is not null);
  if v.kind = 'booking' and not v_override then
    v_dur := (extract(epoch from (v_end - v_start)) / 60)::int;
    select ps.rule_id, ps.price_iqd into v_rule, v_price
      from app.price_slot(v_court, v_start, v_dur) ps;
    if v_rule is null then
      raise exception 'NO_RATE' using errcode = 'P0001',
        hint = 'no rate rule prices the destination slot/duration';
    end if;
  else
    v_rule  := v.rate_rule_id;
    v_price := v.price_iqd;
  end if;

  -- 0071 (SEC-09): the money changed, so a person has to say why. Checked
  -- BEFORE the write, so a refused move leaves the reservation exactly as it
  -- was rather than moved-but-unexplained.
  if v_price is distinct from v_was and not app.reason_given(p_reason) then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001',
      detail = format('price %s -> %s', coalesce(v_was::text, 'null'), coalesce(v_price::text, 'null')),
      hint = 'a move that changes the price needs an explicit reason';
  end if;

  begin
    update reservations
       set court_id = v_court, start_at = v_start, end_at = v_end,
           rate_rule_id = v_rule, price_iqd = v_price
     where id = p_reservation_id
     returning * into v;
  exception
    when exclusion_violation then
      raise exception 'SLOT_TAKEN' using errcode = 'P0001', detail = 'reservations_no_overlap';
  end;

  -- 0071 (SEC-09): both prices as NAMED fields, not only as a diff of two row
  -- snapshots. "every move that changed a price" is then a query, not a read.
  perform app.write_audit('reservation.move', 'reservations', v.id::text,
                          v_before,
                          to_jsonb(v) || jsonb_build_object(
                            'price_before',     v_was,
                            'price_after',      v.price_iqd,
                            'price_changed',    (v.price_iqd is distinct from v_was),
                            'rate_rule_before', v_before ->> 'rate_rule_id',
                            'rate_rule_after',  v.rate_rule_id),
                          coalesce(p_reason, 'staff_op'));

  return jsonb_build_object('reservation_id', v.id, 'court_id', v.court_id,
    'start_at', v.start_at, 'end_at', v.end_at,
    'rate_rule_id', v.rate_rule_id, 'price_iqd', v.price_iqd,
    'price_before', v_was, 'price_changed', (v.price_iqd is distinct from v_was));
end $move_reservation_0277$;

comment on function app.move_reservation(uuid, uuid, timestamptz, timestamptz, text) is
  '0071, 0150, 0277. Desk (court_desk, manager, owner): moves a live reservation to another court and/or time under both court locks (id order), re-priced by its rate rule (a manual override kept; a price change needs a reason, REASON_REQUIRED); a start moved into the past is RESERVATION_IN_PAST. RESERVATION_NOT_FOUND, NOT_MOVABLE, RESERVATION_MOVED (40001), INVALID_RANGE, NO_RATE, SLOT_TAKEN. 0277 (R7): a lesson''s court row is refused LESSON_VIA_COACHING detail move, whatever the new court and times, queued or not; desk_move_lesson_court and the reschedule RPCs move lessons.';
