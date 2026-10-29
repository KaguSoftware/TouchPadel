set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0372 desk_decide_request — the desk answers a join request (Sait, 2026-10-26:
-- "the player will request but the staff cant accept ... the staff can accept
-- someone joining them").
--
-- In an ask-to-join match only the organiser, in the phone app, could answer a
-- request (0261 match_decide). A match the desk started has no organiser with
-- the app, and an organiser may be away from the phone, so the request sat
-- there. desk_decide_request lets court desk, manager and owner approve or
-- decline a pending request with the same rules as match_decide: approve seats
-- the requester (and the friends they asked for) on the tickets the request
-- reserved, the fourth carrier books the court; decline releases the tickets.
--
-- Differences from match_decide, all deliberate:
--   * the caller is staff of the match's branch, not the organiser;
--   * MATCHES_OFF and DEGRADED_LOCKOUT do not apply (R10: the desk can still
--     work a match that is already running, as desk_add_seat does);
--   * the events are written as staff, and the audit row match.desk_decide.
-- Like match_decide it takes no idempotency key: the answer is state-idempotent
-- (approving an approved request, declining a declined one, answers duplicate).
-- Lock order is match_decide's: the approve branch (L2) is written before the
-- decline branch (L1).

create or replace function app.desk_decide_request(p_request_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public as $desk_decide_request_0372$
declare
  v_q        match_requests%rowtype;
  v_m        matches%rowtype;
  v_friends  text[];
  v_code     text;
  v_tickets  uuid[];
  v_taken    jsonb;
  v_status   text;
  v_released int := 0;
  v_n        int;
  v_result   jsonb;
begin
  -- 1.
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 2.
  if p_request_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_request_id';
  elsif p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_approve';
  end if;

  -- 3. Unknown, another branch's and a sandbox match read the same (D-10).
  select * into v_q from match_requests q where q.id = p_request_id;
  if found then
    select * into v_m from matches where id = v_q.match_id;
  end if;
  if v_q.id is null or v_m.id is null or v_m.sandbox or not (v_m.venue_id = any (app.visible_venue_ids())) then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 4.
  if not app.is_staff_at(v_m.venue_id, 'court_desk', 'manager', 'owner') then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_m.venue_id::text, true);

  -- 5. The same answer again.
  if (v_q.status = 'approved' and p_approve) or (v_q.status = 'declined' and not p_approve) then
    return jsonb_build_object('request_id', v_q.id, 'status', v_q.status, 'duplicate', true,
                              'seats', app.match_my_seats(v_m.id, v_q.guest_id), 'match_status', v_m.status,
                              'tickets_released', 0);
  end if;

  -- 6.
  if v_q.status <> 'pending' then
    raise exception 'REQUEST_CLOSED' using errcode = 'P0001';
  end if;

  v_n := v_q.seats_requested;
  v_friends := coalesce(v_q.friend_genders, array_fill(null::text, array[v_n - 1]));

  if p_approve then
    -- 8. The numbers and the requester, as the organiser's approve checks them.
    perform app.match_raise(app.match_join_refusal(v_m, v_q.guest_id, v_friends, 'numbers'));
    v_code := coalesce(app.match_eligibility(v_q.guest_id, true),
                       split_part(app.match_join_refusal(v_m, v_q.guest_id, v_friends, 'approve'), '|', 1));
    if nullif(v_code, '') is not null then
      raise exception 'REQUESTER_INELIGIBLE' using errcode = 'P0001', detail = v_code;
    end if;

    -- L2, then 6, the numbers and the requester again.
    v_m := app.match_lock(v_m.id);
    select * into v_q from match_requests q where q.id = p_request_id;
    if v_q.status = 'approved' then
      return jsonb_build_object('request_id', v_q.id, 'status', v_q.status, 'duplicate', true,
                                'seats', app.match_my_seats(v_m.id, v_q.guest_id), 'match_status', v_m.status,
                                'tickets_released', 0);
    end if;
    if v_q.status <> 'pending' then
      raise exception 'REQUEST_CLOSED' using errcode = 'P0001';
    end if;
    perform app.match_raise(app.match_join_refusal(v_m, v_q.guest_id, v_friends, 'numbers'));
    v_code := coalesce(app.match_eligibility(v_q.guest_id, true),
                       split_part(app.match_join_refusal(v_m, v_q.guest_id, v_friends, 'approve'), '|', 1));
    if nullif(v_code, '') is not null then
      raise exception 'REQUESTER_INELIGIBLE' using errcode = 'P0001', detail = v_code;
    end if;

    -- The request's own reserved tickets (R17). Fewer than its seats is drift:
    -- the request closes (tickets_missing) and nothing is seated.
    v_tickets := app.ticket_pick(v_q.guest_id, v_n, v_m.sandbox, v_q.id);
    if cardinality(v_tickets) < v_n then
      v_released := app.ticket_release(v_tickets, 'tickets_missing', null, v_q.id);
      update match_requests set status = 'expired', decided_at = now() where id = v_q.id;
      perform app.match_event(v_m.id, v_m.venue_id, 'request_expired', 'system', null, v_q.id, 'tickets_missing',
                              '{}'::jsonb);
      return jsonb_build_object('request_id', v_q.id, 'status', 'expired', 'duplicate', false,
                                'refused', 'REQUEST_CLOSED', 'seats', '[]'::jsonb, 'match_status', v_m.status,
                                'tickets_released', v_released);
    end if;

    v_taken := app.match_take_seats(v_m, v_q.guest_id, v_tickets, v_friends, v_q.id);
    update match_requests set status = 'approved', decided_at = now() where id = v_q.id;
    perform app.match_event(v_m.id, v_m.venue_id, 'approved', 'staff', null, v_q.id, null, '{}'::jsonb);
    select count(*) into v_n from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
    perform app.match_event(v_m.id, v_m.venue_id, 'joined', 'staff', ((v_taken->'seat_ids')->>0)::uuid, v_q.id,
                            null, jsonb_build_object('seats', v_taken->'seat_ids', 'seats_taken', v_n,
                                                     'refill', v_taken->'refill'));
    -- OM-34: the approval refilled the organiser's own late-left number.
    if (v_taken->>'organiser_refilled')::boolean then
      perform app.match_recompute_organiser(v_m.id);
    end if;
    v_status := v_m.status;
    if v_m.status = 'filling'
       and (select count(*) from app.match_carriers(v_m.id) c where c.seat_id is not null) = 4 then
      v_status := app.match_try_book(v_m.id);
    end if;
    v_result := jsonb_build_object('request_id', v_q.id, 'status', 'approved', 'duplicate', false,
                                   'seats', v_taken->'seats', 'match_status', v_status, 'tickets_released', 0);
    perform app.write_audit('match.desk_decide', 'match_requests', v_q.id::text, null,
                            v_result || jsonb_build_object('match_id', v_m.id, 'approve', true));
    return v_result;
  end if;

  -- 7. Decline: L1, then 6 again.
  perform set_config('app.venue_id', v_m.venue_id::text, true);
  perform app.lock_match_venue(v_m.venue_id);
  select * into v_m from matches where id = v_m.id;
  select * into v_q from match_requests q where q.id = p_request_id;
  if v_q.status = 'declined' then
    return jsonb_build_object('request_id', v_q.id, 'status', 'declined', 'duplicate', true, 'seats', '[]'::jsonb,
                              'match_status', v_m.status, 'tickets_released', 0);
  end if;
  if v_q.status <> 'pending' then
    raise exception 'REQUEST_CLOSED' using errcode = 'P0001';
  end if;
  select array_agg(k.id order by k.id) into v_tickets
    from match_tickets k where k.request_id = v_q.id and k.status = 'reserved';
  v_released := app.ticket_release(v_tickets, 'declined', null, v_q.id);
  update match_requests set status = 'declined', decided_at = now() where id = v_q.id;
  perform app.match_event(v_m.id, v_m.venue_id, 'declined', 'staff', null, v_q.id, null, '{}'::jsonb);
  v_result := jsonb_build_object('request_id', v_q.id, 'status', 'declined', 'duplicate', false, 'seats', '[]'::jsonb,
                                 'match_status', v_m.status, 'tickets_released', v_released);
  perform app.write_audit('match.desk_decide', 'match_requests', v_q.id::text, null,
                          v_result || jsonb_build_object('match_id', v_m.id, 'approve', false));
  return v_result;
end $desk_decide_request_0372$;

comment on function app.desk_decide_request(uuid, boolean) is
  '0372. Desk (court desk, manager, owner): approves or declines a pending join request of an ask-to-join match, as the organiser does through match_decide (0261, db.md §4.6.6) but from the branch''s staff. Refusals in order: FORBIDDEN; INVALID_ARGUMENT (p_request_id, p_approve); REQUEST_NOT_FOUND (unknown, sandbox, not visible); VENUE_MISMATCH; the same answer again -> duplicate; REQUEST_CLOSED. Approve: the numbers (match_join_refusal ''numbers'': MATCH_CLOSED / MATCH_FULL), REQUESTER_INELIGIBLE (detail the first code the requester now fails; the request stays pending), then under L2 everything again; the request''s reserved tickets seat the requester at once (a refill as in match_join), events approved and joined (staff), the fourth carrier books the court. MATCHES_OFF and DEGRADED_LOCKOUT do not apply (R10, as desk_add_seat). Decline: under the branch mutex; tickets released. Audit match.desk_decide. Returns {request_id, status, duplicate, seats, match_status, tickets_released}.';

revoke all on function app.desk_decide_request(uuid, boolean) from public, anon, authenticated;
grant execute on function app.desk_decide_request(uuid, boolean) to authenticated;
