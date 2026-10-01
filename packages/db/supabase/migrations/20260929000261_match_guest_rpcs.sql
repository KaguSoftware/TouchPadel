set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0261 match_guest_rpcs — open matches for guests (docs/design/open-matches/
-- db.md §4.6, guest.md §4.3 and §4.6; build contracts §1.5, §1.6, §1.9,
-- §1.10, rulings R3, R5, R10, R17, R24, R26, R27, R31, R32, R41, R43).
--
--   0. Guest's part (lane Guest, R26), first in the file:
--        app.match_notify              the one queue for the guest push family
--        app.match_sync_reminders      reminder_3h upkeep; called only by the
--                                      match_events trigger below
--        match_events_push             AFTER INSERT on match_events
--        match_ticket_events_push      AFTER INSERT on match_ticket_events,
--                                      forfeited only
--   1. app.notify_staff               re-issued from 0193 with match_report_new
--                                      appended last (R5 as amended by R43)
--   2. DB's internals of this file     match_friends, match_guest_numbers,
--                                      match_time_clash, match_join_refusal,
--                                      match_raise, match_take_seats,
--                                      match_my_seats, match_report_target
--   3. Reads                           match_quote, open_matches, match_detail,
--                                      my_matches, my_match_blocks; anon and
--                                      authenticated: match_slots, match_invite
--   4. Writes                          match_start, match_join, match_request,
--                                      match_withdraw, match_decide, match_leave,
--                                      match_remove_player, match_cancel,
--                                      match_post_message, match_report,
--                                      match_block, match_unblock
--
-- Every guest RPC is security definer with a pinned search_path; its first
-- statement is app.match_guest (0260): AUTH_REQUIRED without a session,
-- ACCOUNT_REQUIRED for the anonymous café session. match_slots and
-- match_invite are public by design (no ids, names or money).
--
-- Locks (db.md §2.3, §2.5): start takes LS (every court of the branch, the
-- branch's stale holds, the branch mutex); join and approve take L2
-- (app.match_lock); request, withdraw, decline, leave, remove and cancel take
-- L1 (the mutex alone). Tickets are locked after the mutex. In match_decide
-- the approve branch (L2) is written before the decline branch (L1), so the
-- gate's textual walk reads courts -> reservations -> mutex -> tickets.
--
-- Pushes: DB's bodies never call match_notify or match_sync_reminders; the
-- two triggers of section 0 turn match_events and forfeited
-- match_ticket_events rows into pushes (guest.md §4.6.3). Money's
-- deposit_refund_apply (0259) queues tickets_refunded through match_notify.

-- ===========================================================================
-- 0. Guest's part: the push family (guest.md §4.6)
-- ===========================================================================

-- The one queue for the guest push family. The kind comes from the title key
-- (c_keys, a copy of _shared/guest-push.json title_keys that
-- tests/guest-push.test.ts compares), so kind and key never disagree (R3).
create or replace function app.match_notify(
  p_match_id      uuid,
  p_recipients    uuid[],
  p_title_key     text,
  p_params        jsonb default '{}',
  p_actor         uuid default null,
  p_scheduled_for timestamptz default null,
  p_dedupe        text default null
) returns int
language plpgsql security definer set search_path = public as $match_notify_0261$
declare
  c_keys constant jsonb := '{
    "request_new": "match_update", "request_expired": "match_update",
    "player_joined": "match_update", "player_left": "match_update",
    "request_approved": "match_update", "request_declined": "match_update",
    "match_booked": "match_update", "match_waiting_court": "match_update",
    "deadline_warning": "match_update", "match_cancelled": "match_update",
    "match_bumped": "match_update", "match_expired": "match_update",
    "match_moved": "match_update", "reminder_3h": "match_reminder",
    "organiser_handover": "match_update", "seat_removed": "match_update",
    "seat_refilled": "match_update", "ticket_forfeited": "match_update",
    "tickets_refunded": "match_update", "msg_on_my_way": "match_message",
    "msg_running_late": "match_message", "msg_cant_make_it": "match_message",
    "msg_bring_balls": "match_message"}';
  v_params  jsonb := coalesce(p_params, '{}'::jsonb);
  v_dedupe  text := nullif(btrim(p_dedupe), '');
  v_tickets boolean := p_title_key = 'tickets_refunded';
  v_payload jsonb;
  v_count   int := 0;
begin
  -- 1. A bad call is refused where a test can see it (outside the guard).
  if p_title_key is null or not (c_keys ? p_title_key) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'title_key';
  end if;
  if jsonb_typeof(v_params) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
  end if;
  if exists (select 1 from jsonb_each(v_params) e
              where e.key not in ('seats_taken', 'seats_total', 'minutes')
                 or jsonb_typeof(e.value) <> 'number'
                 or e.value::text !~ '^-?[0-9]+$') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
  end if;
  if p_match_id is null and not v_tickets then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'p_match_id';
  end if;

  -- 2. The closed payload: no name, no amount (OM-31, §1.9).
  v_payload := jsonb_build_object(
                 'route', case when v_tickets then 'tickets' else 'match' end,
                 'id', case when v_tickets then null else p_match_id::text end,
                 'title_key', p_title_key,
                 'params', v_params)
            || case when v_dedupe is null then '{}'::jsonb else jsonb_build_object('dedupe', v_dedupe) end;

  -- 3. A push never fails the write that queued it.
  begin
    insert into notification_outbox (profile_id, kind, payload, scheduled_for)
    select p.id, c_keys->>p_title_key, v_payload, coalesce(p_scheduled_for, now())
      from profiles p
     where p.id in (select distinct r from unnest(coalesce(p_recipients, '{}'::uuid[])) r where r is not null)
       and p.deleted_at is null
       and p.expo_push_token is not null
       and p.id is distinct from p_actor
       and (v_dedupe is null
            or not exists (select 1 from notification_outbox o
                            where o.profile_id = p.id
                              and o.payload->>'dedupe' = v_dedupe
                              and o.created_at > now() - interval '15 minutes'));
    get diagnostics v_count = row_count;
    -- 4. Only a row due now wakes send-push; a reminder waits for the sweep.
    if p_scheduled_for is null and v_count > 0 then
      perform app.push_nudge();
    end if;
  exception when others then
    raise warning 'match_notify: %', sqlerrm;
    return 0;
  end;
  return v_count;
end $match_notify_0261$;

comment on function app.match_notify(uuid, uuid[], text, jsonb, uuid, timestamptz, text) is
  '0261 (lane Guest, guest.md §4.6.1). Internal: queues one notification_outbox row per distinct recipient for a guest title key, its kind taken from c_keys (the copy of _shared/guest-push.json title_keys; tests/guest-push.test.ts compares). Payload {route, id, title_key, params} (+ dedupe): route tickets with id null for tickets_refunded, else route match with the match id. Skips deleted and tokenless profiles, the actor, and (with p_dedupe) a recipient who got that dedupe in the last 15 minutes. INVALID_ARGUMENT (hint title_key, params, p_match_id) for a bad call; a failing insert returns 0 with a warning. Nudges send-push only for rows due now. Returns the rows queued.';

revoke all on function app.match_notify(uuid, uuid[], text, jsonb, uuid, timestamptz, text) from public, anon, authenticated;

-- reminder_3h upkeep: the unsent future reminders of the match go, and a
-- booked match more than 3 hours out queues one per seat holder.
create or replace function app.match_sync_reminders(p_match_id uuid) returns void
language plpgsql security definer set search_path = public as $match_sync_reminders_0261$
declare
  v_m matches%rowtype;
begin
  begin
    delete from notification_outbox
     where kind = 'match_reminder'
       and sent_at is null
       and attempts < 5
       and scheduled_for > now()
       and payload->>'id' = p_match_id::text;
    select * into v_m from matches where id = p_match_id;
    if found and v_m.status = 'booked' and v_m.start_at - interval '3 hours' > now() then
      perform app.match_notify(
        v_m.id,
        array(select distinct s.guest_id from match_seats s
               where s.match_id = v_m.id and s.status = 'in' and s.guest_id is not null),
        'reminder_3h', '{}'::jsonb, null, v_m.start_at - interval '3 hours', null);
    end if;
  exception when others then
    raise warning 'match_sync_reminders: %', sqlerrm;
  end;
end $match_sync_reminders_0261$;

comment on function app.match_sync_reminders(uuid) is
  '0261 (lane Guest, guest.md §4.6.2, R26). Internal: deletes the match''s unsent future match_reminder rows, then, when the match is booked and starts more than 3 hours from now, queues reminder_3h at start_at - 3 h for every holder of an in seat. Never raises. Its only caller is the match_events push trigger.';

revoke all on function app.match_sync_reminders(uuid) from public, anon, authenticated;

-- match_events -> pushes (guest.md §4.6.3). Recipient sets: H holders of in
-- seats, L holders of left_late seats, E holders of cancelled seats, R
-- requesters whose request expired in this transaction, O the organiser;
-- always minus the actor, deleted and tokenless profiles (match_notify).
create or replace function app.trg_match_event_push() returns trigger
language plpgsql security definer set search_path = public as $trg_match_event_push_0261$
declare
  v_m        matches%rowtype;
  v_id       text := new.match_id::text;
  v_actor    uuid := new.actor_guest_id;
  v_o        uuid[];
  v_h        uuid[];
  v_l        uuid[];
  v_er       uuid[];
  v_taken    int;
  v_seats    jsonb;
  v_holder   uuid;
  v_asker    uuid;
  v_to       uuid;
  v_key      text;
  v_resync   boolean := false;
begin
  begin
    select * into v_m from matches where id = new.match_id;
    if not found then
      return null;
    end if;
    v_o := case when v_m.organiser_id is null then '{}'::uuid[] else array[v_m.organiser_id] end;
    select count(*) into v_taken from match_seats s where s.match_id = v_m.id and s.status in ('in', 'attended');
    v_seats := jsonb_build_object('seats_taken', v_taken, 'seats_total', 4);
    if new.seat_id is not null then
      select s.guest_id into v_holder from match_seats s where s.id = new.seat_id;
    end if;
    if new.request_id is not null then
      select q.guest_id into v_asker from match_requests q where q.id = new.request_id;
    end if;
    v_h := array(select distinct s.guest_id from match_seats s
                  where s.match_id = v_m.id and s.status = 'in' and s.guest_id is not null);

    if new.type = 'requested' then
      perform app.match_notify(v_m.id, v_o, 'request_new', '{}', v_actor, null, 'm:' || v_id || ':request_new');

    elsif new.type = 'approved' then
      perform app.match_notify(v_m.id, array[v_asker], 'request_approved', '{}', v_actor, null,
                               'm:' || v_id || ':request_approved');

    elsif new.type = 'declined' then
      perform app.match_notify(v_m.id, array[v_asker], 'request_declined', '{}', v_actor, null,
                               'm:' || v_id || ':request_declined');

    elsif new.type = 'request_expired' then
      -- Any other code (banned, an end reason): the match's own push covers it.
      if new.code in ('match_full', 'organiser_gone', 'closed') then
        perform app.match_notify(v_m.id, array[v_asker], 'request_expired', '{}', v_actor, null,
                                 'm:' || v_id || ':request_expired');
      end if;

    elsif new.type = 'joined' then
      -- The fourth seat's booked, waiting or bump push follows in the same
      -- transaction; a joined push would only say the same thing first.
      if not (v_m.status in ('filling', 'awaiting_court') and v_taken >= 4) then
        perform app.match_notify(v_m.id, v_o, 'player_joined', v_seats, v_actor, null,
                                 'm:' || v_id || ':player_joined:' || v_taken);
      end if;
      v_resync := true;

    elsif new.type in ('left', 'left_late') then
      perform app.match_notify(v_m.id, v_o, 'player_left', v_seats, v_actor, null,
                               'm:' || v_id || ':player_left:' || v_taken);
      v_resync := true;

    elsif new.type = 'removed' then
      if new.actor <> 'guest' then
        -- The venue, or a ban (match_drop_ineligible): the organiser hears a
        -- player left, unless the organiser is the one removed.
        if v_m.organiser_id is distinct from v_holder then
          perform app.match_notify(v_m.id, v_o, 'player_left', v_seats, v_actor, null,
                                   'm:' || v_id || ':player_left:' || v_taken);
        end if;
      end if;
      perform app.match_notify(v_m.id, array[v_holder], 'seat_removed', '{}', v_actor, null,
                               'm:' || v_id || ':seat_removed');
      v_resync := true;

    elsif new.type = 'refilled' then
      perform app.match_notify(v_m.id, array[v_holder], 'seat_refilled', '{}', v_actor, null,
                               'm:' || v_id || ':seat_refilled');
      v_resync := true;

    elsif new.type = 'organiser_changed' then
      v_to := nullif(new.data->>'to_guest_id', '')::uuid;
      if v_to is not null then
        perform app.match_notify(v_m.id, array[v_to], 'organiser_handover', '{}', v_actor, null,
                                 'm:' || v_id || ':organiser_handover');
      end if;

    elsif new.type = 'awaiting_court' then
      perform app.match_notify(v_m.id, v_h, 'match_waiting_court', '{}', v_actor, null,
                               'm:' || v_id || ':match_waiting_court');

    elsif new.type = 'booked' then
      perform app.match_notify(v_m.id, v_h, 'match_booked', '{}', v_actor, null, 'm:' || v_id || ':match_booked');
      v_resync := true;

    elsif new.type = 'moved' then
      v_l := array(select distinct s.guest_id from match_seats s
                    where s.match_id = v_m.id and s.status = 'left_late' and s.guest_id is not null);
      perform app.match_notify(v_m.id, v_h || v_l, 'match_moved', '{}', v_actor, null, 'm:' || v_id || ':match_moved');
      v_resync := true;

    elsif new.type = 'deadline_warning' then
      perform app.match_notify(
        v_m.id, v_h, 'deadline_warning',
        v_seats || jsonb_build_object('minutes',
          greatest(1, ceil(extract(epoch from v_m.fill_deadline_at - now()) / 60))::int),
        v_actor, null, 'm:' || v_id || ':deadline_warning:' || v_taken);

    elsif new.type = 'message' then
      if new.code in ('on_my_way', 'running_late', 'cant_make_it', 'bring_balls') then
        perform app.match_notify(v_m.id, v_h || v_o, 'msg_' || new.code, '{}', v_actor, null,
                                 'm:' || v_id || ':msg:' || coalesce(v_actor::text, '-') || ':' || new.code);
      end if;

    elsif new.type in ('cancelled', 'bumped', 'expired') then
      v_key := case
                 when new.type = 'cancelled' and new.code in ('organiser_cancelled', 'staff_cancelled',
                                                              'reservation_cancelled', 'venue_closed')
                   then 'match_cancelled'
                 when new.type = 'bumped' and new.code = 'bumped' then 'match_bumped'
                 when new.type = 'bumped' and new.code = 'no_court' then 'match_cancelled'
                 when new.type = 'expired' and new.code = 'deadline' then 'match_expired'
                 when new.type = 'expired' and new.code = 'no_court' then 'match_cancelled'
               end;
      if v_key is not null then
        -- Every seat match_end cancelled, and every request it closed now.
        v_er := array(select distinct s.guest_id from match_seats s
                       where s.match_id = v_m.id and s.status = 'cancelled' and s.guest_id is not null
                      union
                      select q.guest_id from match_requests q
                       where q.match_id = v_m.id and q.status = 'expired' and q.decided_at = now());
        perform app.match_notify(v_m.id, v_er, v_key, '{}', v_actor, null, 'm:' || v_id || ':' || v_key);
      end if;
      v_resync := true;

    elsif new.type in ('called_off_short', 'played', 'no_show') then
      -- Everyone is at the desk by then; a no-show hears through ticket_forfeited.
      v_resync := true;
    end if;

    if v_resync then
      perform app.match_sync_reminders(v_m.id);
    end if;
  exception when others then
    raise warning 'trg_match_event_push: %', sqlerrm;
  end;
  return null;
end $trg_match_event_push_0261$;

comment on function app.trg_match_event_push() is
  '0261 (lane Guest, guest.md §4.6.3, R26). Trigger match_events_push: turns a match_events row into guest pushes through app.match_notify by the fan-out table (request_new, request_approved/declined, request_expired for match_full/organiser_gone/closed only, player_joined unless the fourth seat''s own push follows, player_left, seat_removed, seat_refilled, organiser_handover, match_waiting_court, match_booked, match_moved, deadline_warning, msg_*, match_cancelled/bumped/expired to the seats and requests the end closed; a no_court ending reads match_cancelled), then resyncs reminders for the seat, booking and ending types. Never fails the write.';

revoke all on function app.trg_match_event_push() from public, anon, authenticated;

drop trigger if exists match_events_push on match_events;
create trigger match_events_push
  after insert on match_events
  for each row
  when (new.type in ('requested', 'approved', 'declined', 'request_expired', 'joined', 'left', 'left_late',
                     'refilled', 'removed', 'organiser_changed', 'awaiting_court', 'booked', 'moved',
                     'deadline_warning', 'message', 'cancelled', 'bumped', 'expired', 'played', 'no_show',
                     'called_off_short'))
  execute function app.trg_match_event_push();

-- A forfeited ticket tells its owner, once per match (a holder whose friend
-- also missed gets one push).
create or replace function app.trg_match_ticket_event_push() returns trigger
language plpgsql security definer set search_path = public as $trg_match_ticket_event_push_0261$
begin
  begin
    if new.match_id is not null then
      perform app.match_notify(new.match_id, array[new.guest_id], 'ticket_forfeited', '{}'::jsonb, null, null,
                               'm:' || new.match_id::text || ':ticket_forfeited');
    end if;
  exception when others then
    raise warning 'trg_match_ticket_event_push: %', sqlerrm;
  end;
  return null;
end $trg_match_ticket_event_push_0261$;

comment on function app.trg_match_ticket_event_push() is
  '0261 (lane Guest, guest.md §4.6.3, R26). Trigger match_ticket_events_push (forfeited only): ticket_forfeited to the ticket''s owner for its match, deduped per match. Never fails the write.';

revoke all on function app.trg_match_ticket_event_push() from public, anon, authenticated;

drop trigger if exists match_ticket_events_push on match_ticket_events;
create trigger match_ticket_events_push
  after insert on match_ticket_events
  for each row
  when (new.type = 'forfeited')
  execute function app.trg_match_ticket_event_push();

-- ===========================================================================
-- 1. app.notify_staff: 0193 verbatim, plus match_report_new last (R5, R43)
-- ===========================================================================
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0261$
declare
  c_kinds      constant text[] := array['staff_task', 'staff_decide', 'staff_decided', 'staff_info'];
  c_title_keys constant text[] := array[
    'step_open', 'step_submitted', 'step_approved', 'step_sent_back', 'step_stopped',
    'run_stopped', 'run_live', 'launch_not_ready', 'apply_not_ready', 'review_ready',
    'request_submitted', 'request_approved', 'request_rejected', 'shopping_new',
    'purchase_to_receive', 'idea_submitted', 'idea_started', 'idea_declined',
    'teaching_new', 'recipe_change_submitted', 'recipe_change_approved',
    'recipe_change_declined', 'shopping_to_approve', 'shopping_declined',
    'marketing_request_new', 'marketing_request_answered', 'deduction_proposed',
    'deduction_approved', 'deduction_declined', 'deduction_recorded',
    'incident_reported', 'incident_reviewed', 'content_submitted', 'content_approved',
    'content_changes', 'content_declined', 'waiter_call_new', 'match_report_new'];
  c_routes     constant text[] := array[
    'staff', 'staff-step', 'staff-run', 'staff-request', 'staff-shopping',
    'staff-checklist', 'staff-notes'];
  v_payload jsonb;
  v_dedupe  text := nullif(btrim(p_dedupe), '');
  v_count   int;
begin
  if p_kind is null or not (p_kind = any(c_kinds)) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if not coalesce(p_payload->>'title_key' = any(c_title_keys), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'title_key';
  end if;
  if not coalesce(p_payload->>'route' = any(c_routes), false) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'route';
  end if;
  -- The shape is closed, so no caller can put money, a phone number or a
  -- candidate name on a lock screen by adding a key.
  if exists (select 1 from jsonb_object_keys(p_payload) k
              where k not in ('route', 'id', 'title_key', 'params', 'dedupe')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'payload';
  end if;
  if p_payload ? 'params' and p_payload->'params' <> 'null'::jsonb then
    if jsonb_typeof(p_payload->'params') <> 'object'
       or exists (select 1 from jsonb_object_keys(p_payload->'params') k
                   where k not in ('step', 'title', 'name')) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'params';
    end if;
  end if;

  v_payload := (p_payload - 'dedupe')
            || case when v_dedupe is null then '{}'::jsonb
                    else jsonb_build_object('dedupe', v_dedupe) end;

  insert into notification_outbox (profile_id, kind, payload)
  select s.id, p_kind, v_payload
    from staff s
    join profiles p on p.id = s.id
   where s.id = any(coalesce(p_staff_ids, '{}'::uuid[]))
     and s.is_active
     and s.id is distinct from auth.uid()
     and (v_dedupe is null
          or not exists (select 1 from notification_outbox o
                          where o.profile_id = s.id
                            and o.payload->>'dedupe' = v_dedupe
                            and o.created_at > now() - interval '15 minutes'));
  get diagnostics v_count = row_count;

  perform app.push_nudge();
  return v_count;
end $notify_staff_0261$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1) with the role spec''s eleven title keys, by staff_push_keys_wave5 (wave5-addendum §2.3) with wave 5''s eleven, and by match_guest_rpcs (0261, open matches R5/R43) with match_report_new. Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ===========================================================================
-- 2. DB's internals of this file
-- ===========================================================================

-- p_friends = [{"gender": "female"|"male"|null}] (OM-20, OM-39): the declared
-- genders in order. The shape only; the seat limit and the category are the
-- callers' (their refusal orders differ).
create or replace function app.match_friends(p_friends jsonb) returns text[]
language plpgsql immutable security definer set search_path = public as $match_friends_0261$
declare
  v_f   jsonb := coalesce(p_friends, '[]'::jsonb);
  v_e   jsonb;
  v_out text[] := '{}'::text[];
begin
  if jsonb_typeof(v_f) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friends';
  end if;
  for v_e in select x.value from jsonb_array_elements(v_f) x loop
    if jsonb_typeof(v_e) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friends';
    end if;
    if exists (select 1 from jsonb_object_keys(v_e) k where k <> 'gender')
       or (v_e ? 'gender' and jsonb_typeof(v_e->'gender') <> 'null'
           and (jsonb_typeof(v_e->'gender') <> 'string' or v_e->>'gender' not in ('female', 'male'))) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friends';
    end if;
    v_out := array_append(v_out, v_e->>'gender');
  end loop;
  return v_out;
end $match_friends_0261$;

comment on function app.match_friends(jsonb) is
  '0261. Internal: parses p_friends ([{"gender": "female"|"male"|null}], NULL = []) into the declared genders, in order. INVALID_ARGUMENT detail p_friends for anything else (a non-array, a non-object entry, another key, another value). The seat limit and the category rule are the callers''.';

revoke all on function app.match_friends(jsonb) from public, anon, authenticated;

-- The seat numbers open for a guest now (db.md §3.2): before the start, a
-- vacant number of a filling match, or a vacant or late-left number of a
-- booked one. Ascending.
create or replace function app.match_guest_numbers(m matches) returns smallint[]
language sql stable security definer set search_path = public as $match_guest_numbers_0261$
  select coalesce(array_agg(c.seat_no order by c.seat_no), '{}'::smallint[])
    from app.match_carriers(m.id) c
   where m.status in ('filling', 'booked')
     and now() < m.start_at
     and (c.seat_id is null or (m.status = 'booked' and c.status = 'left_late'))
$match_guest_numbers_0261$;

comment on function app.match_guest_numbers(matches) is
  '0261. Internal (db.md §3.2): the seat numbers a guest can take now, ascending: before the start, a vacant number of a filling match, or a vacant or left_late number of a booked one (a refill). Empty otherwise (awaiting_court, started, ended).';

revoke all on function app.match_guest_numbers(matches) from public, anon, authenticated;

-- R41: the guest carries a seat in another live match over p_period. A
-- carrier is db.md §3.2's (in, attended, no_show or left_late, and no such
-- seat replaces it), so a late leaver still clashes until their number is
-- refilled. p_except_match is the match in hand; p_except_key a start's own
-- idempotency key (its committed double tap is a replay, never a clash).
create or replace function app.match_time_clash(p_guest uuid, p_period tstzrange, p_except_match uuid default null,
                                                p_except_key text default null)
returns boolean
language sql stable security definer set search_path = public as $match_time_clash_0261$
  select exists (
    select 1
      from match_seats s join matches x on x.id = s.match_id
     where s.guest_id = p_guest
       and s.status in ('in', 'attended', 'no_show', 'left_late')
       and not exists (select 1 from match_seats r
                        where r.match_id = s.match_id and r.replaces_seat_id = s.id
                          and r.status in ('in', 'attended', 'no_show', 'left_late'))
       and x.id is distinct from p_except_match
       and (p_except_key is null or x.idempotency_key is distinct from p_except_key)
       and x.status in ('filling', 'awaiting_court', 'booked')
       and x.period && p_period)
$match_time_clash_0261$;

comment on function app.match_time_clash(uuid, tstzrange, uuid, text) is
  '0261. Internal (R41, db.md §3.2): true when the guest carries a seat (in, attended, no_show or left_late, not replaced by another carrier) in a filling, awaiting_court or booked match over p_period, other than p_except_match and than a match started with p_except_key. A late leaver clashes until the refill. match_quote, match_start (before the lock and again after its ticket pick), match_join_refusal.';

revoke all on function app.match_time_clash(uuid, tstzrange, uuid, text) from public, anon, authenticated;

-- The refusals a join, a request, an approval or a read shares, in each
-- caller's order, as 'CODE' or 'CODE|detail' (app.match_raise raises it).
--   join / request / read : UNAVAILABLE, GENDER_MISMATCH, CLOSED, FULL,
--                           LIMIT_REACHED (filling only), TIME_CLASH
--   numbers               : CLOSED, FULL
--   clash                 : TIME_CLASH alone (match_join, after its ticket
--                           pick has serialised the guest's writes)
--   approve (requester)   : GENDER_MISMATCH, UNAVAILABLE, ALREADY_IN,
--                           LIMIT_REACHED, TIME_CLASH (CLOSED/FULL are the
--                           approval's own refusals, checked before)
-- "Already in" and the clash count carriers (db.md §3.2: in, attended,
-- no_show, left_late): a late leaver still holds their number until a refill,
-- so they are already in here and clash with any other match over the time.
create or replace function app.match_join_refusal(m matches, p_guest uuid, p_friends text[], p_mode text)
returns text
language plpgsql stable security definer set search_path = public as $match_join_refusal_0261$
declare
  v_gender  text;
  v_need    text := case m.category when 'women' then 'female' when 'men' then 'male' end;
  v_seats   int := 1 + coalesce(cardinality(p_friends), 0);
  v_people  uuid[];
  v_cap     int;
  v_unavail boolean;
  v_sex     text;
  v_numbers text;
  v_limit   text;
  v_clash   boolean;
  v_in      boolean;
begin
  if m.id is null or p_guest is null then
    return 'MATCH_NOT_FOUND';
  end if;

  -- CLOSED / FULL.
  if m.status in ('played', 'no_show', 'cancelled', 'bumped', 'expired')
     or (m.status = 'filling' and now() >= m.fill_deadline_at)
     or (m.status = 'booked' and now() >= m.start_at) then
    v_numbers := 'MATCH_CLOSED';
  elsif m.status = 'awaiting_court' or cardinality(app.match_guest_numbers(m)) < v_seats then
    v_numbers := 'MATCH_FULL';
  end if;
  if p_mode = 'numbers' then
    return v_numbers;
  end if;

  -- TIME_CLASH (R41): a carrier seat in another live match over the same time.
  v_clash := app.match_time_clash(p_guest, m.period, m.id);
  if p_mode = 'clash' then
    return case when v_clash then 'MATCH_TIME_CLASH' end;
  end if;

  select p.gender into v_gender from profiles p where p.id = p_guest;

  -- UNAVAILABLE: an exclusion (OM-44), a block either way with the organiser
  -- or any carrier's holder, a banned organiser. It never says which.
  select array_agg(distinct x.person) into v_people
    from (select m.organiser_id as person
          union all
          select s.guest_id from app.match_carriers(m.id) c join match_seats s on s.id = c.seat_id) x
   where x.person is not null and x.person <> p_guest;
  v_unavail :=
       exists (select 1 from match_exclusions e where e.match_id = m.id and e.guest_id = p_guest)
    or exists (select 1 from match_blocks b
                where (b.blocker_id = p_guest and b.blocked_id = any (coalesce(v_people, '{}'::uuid[])))
                   or (b.blocked_id = p_guest and b.blocker_id = any (coalesce(v_people, '{}'::uuid[]))))
    or (m.organiser_id is not null and m.organiser_id <> p_guest
        and exists (select 1 from customer_flags f where f.customer_id = m.organiser_id and f.type = 'match_ban'));

  -- GENDER_MISMATCH: the player, then each friend (detail friend), against a
  -- women-only or men-only match. An unset gender is GENDER_REQUIRED, the
  -- eligibility check's, never this.
  if v_need is not null then
    if v_gender is not null and v_gender <> v_need then
      v_sex := 'MATCH_GENDER_MISMATCH';
    elsif exists (select 1 from unnest(coalesce(p_friends, '{}'::text[])) g where g is distinct from v_need) then
      v_sex := 'MATCH_GENDER_MISMATCH|friend';
    end if;
  end if;

  -- LIMIT_REACHED (OM-37): filling or waiting matches the guest holds an in
  -- account seat in, this one aside. Only a filling match counts it (a
  -- refill of a booked match is exempt).
  if m.status = 'filling' then
    select ps.max_filling_matches_per_guest into v_cap from platform_settings ps where ps.id;
    if (select count(distinct s.match_id)
          from match_seats s join matches x on x.id = s.match_id
         where s.guest_id = p_guest and s.kind = 'account' and s.status = 'in'
           and x.id <> m.id and x.status in ('filling', 'awaiting_court')) >= coalesce(v_cap, 3) then
      v_limit := 'MATCH_LIMIT_REACHED|' || coalesce(v_cap, 3)::text;
    end if;
  end if;

  if p_mode = 'approve' then
    v_in := exists (select 1 from app.match_carriers(m.id) c join match_seats s on s.id = c.seat_id
                     where s.guest_id = p_guest);
    if v_sex is not null then return v_sex; end if;
    if v_unavail then return 'MATCH_UNAVAILABLE'; end if;
    if v_in then return 'MATCH_ALREADY_IN'; end if;
    if v_limit is not null then return v_limit; end if;
    if v_clash then return 'MATCH_TIME_CLASH'; end if;
    return null;
  end if;

  if v_unavail then return 'MATCH_UNAVAILABLE'; end if;
  if v_sex is not null then return v_sex; end if;
  if v_numbers is not null then return v_numbers; end if;
  if v_limit is not null then return v_limit; end if;
  if v_clash then return 'MATCH_TIME_CLASH'; end if;
  return null;
end $match_join_refusal_0261$;

comment on function app.match_join_refusal(matches, uuid, text[], text) is
  '0261. Internal (db.md §4.6.3, §4.6.4, §4.6.6; R41): the first refusal a join, a request, an approval or a read shares, as CODE or CODE|detail. join/request/read: MATCH_UNAVAILABLE (exclusion, a block either way with the organiser or a carrier''s holder, a banned organiser), MATCH_GENDER_MISMATCH (|friend for a friend), MATCH_CLOSED, MATCH_FULL, MATCH_LIMIT_REACHED|cap (a filling match only), MATCH_TIME_CLASH; numbers: CLOSED/FULL only; clash: MATCH_TIME_CLASH only (app.match_time_clash); approve: GENDER_MISMATCH, UNAVAILABLE, MATCH_ALREADY_IN, LIMIT_REACHED, TIME_CLASH. "Already in" and the clash count carriers (in, attended, no_show, left_late: a late leaver holds their number until a refill). NULL when none applies.';

revoke all on function app.match_join_refusal(matches, uuid, text[], text) from public, anon, authenticated;

-- Raises a 'CODE' or 'CODE|detail' refusal; each code is a literal raise, so
-- scripts/check-error-codes.mjs sees every one. NULL raises nothing.
create or replace function app.match_raise(p_refusal text) returns void
language plpgsql security definer set search_path = public as $match_raise_0261$
declare
  v_code   text := split_part(p_refusal, '|', 1);
  v_detail text := nullif(split_part(p_refusal, '|', 2), '');
begin
  if p_refusal is null then
    return;
  end if;
  if v_code = 'MATCH_UNAVAILABLE' then
    raise exception 'MATCH_UNAVAILABLE' using errcode = 'P0001';
  elsif v_code = 'MATCH_GENDER_MISMATCH' and v_detail is null then
    raise exception 'MATCH_GENDER_MISMATCH' using errcode = 'P0001';
  elsif v_code = 'MATCH_GENDER_MISMATCH' then
    raise exception 'MATCH_GENDER_MISMATCH' using errcode = 'P0001', detail = v_detail;
  elsif v_code = 'MATCH_CLOSED' then
    raise exception 'MATCH_CLOSED' using errcode = 'P0001';
  elsif v_code = 'MATCH_FULL' then
    raise exception 'MATCH_FULL' using errcode = 'P0001';
  elsif v_code = 'MATCH_LIMIT_REACHED' then
    raise exception 'MATCH_LIMIT_REACHED' using errcode = 'P0001', detail = coalesce(v_detail, '3');
  elsif v_code = 'MATCH_TIME_CLASH' then
    raise exception 'MATCH_TIME_CLASH' using errcode = 'P0001';
  elsif v_code = 'MATCH_ALREADY_IN' then
    raise exception 'MATCH_ALREADY_IN' using errcode = 'P0001';
  elsif v_code = 'MATCH_NOT_FOUND' then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  elsif v_detail is null then
    raise exception '%', v_code using errcode = 'P0001';
  else
    raise exception '%', v_code using errcode = 'P0001', detail = v_detail;
  end if;
end $match_raise_0261$;

comment on function app.match_raise(text) is
  '0261. Internal: raises a refusal written as CODE or CODE|detail (the shape app.match_join_refusal returns), each known code by its own literal raise; NULL raises nothing.';

revoke all on function app.match_raise(text) from public, anon, authenticated;

-- Seats a player and their friends (join and approval; db.md §4.6.3 writes).
-- The caller holds L2 and has picked the tickets (ticket_pick). A filling
-- match gives the lowest free numbers; a booked one the open numbers
-- ascending, each new seat replacing the number's late leaver (refilled, its
-- ticket back) or the latest ended seat on a vacant number.
create or replace function app.match_take_seats(m matches, p_guest uuid, p_tickets uuid[], p_friends text[],
                                                p_request_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $match_take_seats_0261$
declare
  v_n       int := 1 + coalesce(cardinality(p_friends), 0);
  v_numbers smallint[] := app.match_guest_numbers(m);
  v_gender  text := (select p.gender from profiles p where p.id = p_guest);
  v_refill  boolean := m.status = 'booked';
  v_i       int;
  v_no      smallint;
  v_c_seat  uuid;
  v_c_stat  text;
  v_repl    uuid;
  v_seat    uuid;
  v_kind    text;
  v_seats   uuid[] := '{}'::uuid[];
  v_out     jsonb := '[]'::jsonb;
  v_locked  int;
  v_left    record;
  v_org     boolean := false;
begin
  if coalesce(cardinality(p_tickets), 0) <> v_n then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_tickets';
  end if;
  if cardinality(v_numbers) < v_n then
    raise exception 'MATCH_FULL' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', m.venue_id::text, true);

  for v_i in 1 .. v_n loop
    v_no := v_numbers[v_i];
    v_repl := null;
    if v_refill then
      select c.seat_id, c.status into v_c_seat, v_c_stat from app.match_carriers(m.id) c where c.seat_no = v_no;
      if v_c_seat is not null and v_c_stat = 'left_late' then
        v_repl := v_c_seat;
      else
        select s.id into v_repl
          from match_seats s
         where s.match_id = m.id and s.seat_no = v_no and s.ended_at is not null
         order by s.ended_at desc, s.joined_at desc, s.id desc
         limit 1;
      end if;
    end if;
    v_kind := case when v_i = 1 then 'account' else 'friend' end;
    insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, gender, ticket_id, share_iqd,
                             request_id, replaces_seat_id)
    values (m.venue_id, m.id, v_no, v_kind, p_guest,
            case when v_i = 1 then v_gender else p_friends[v_i - 1] end,
            p_tickets[v_i], m.shares_iqd[v_no], p_request_id, v_repl)
    returning id into v_seat;
    v_seats := array_append(v_seats, v_seat);
    v_out := v_out || jsonb_build_array(jsonb_build_object('seat_id', v_seat, 'seat_no', v_no, 'kind', v_kind));
  end loop;

  v_locked := app.ticket_lock(p_tickets, v_seats, p_request_id);
  if v_locked <> v_n then
    raise exception 'NEED_TICKETS' using errcode = 'P0001',
      detail = format('{"needed":%s,"available":%s,"buy":%s}', v_n, v_locked, v_n - v_locked);
  end if;

  -- Refills (OM-11): the late leaver's ticket comes back in this transaction
  -- (released, or restored if it was already forfeited).
  for v_left in
    select o.id, o.ticket_id, o.guest_id, n.id as by_seat
      from match_seats n join match_seats o on o.id = n.replaces_seat_id
     where n.id = any (v_seats) and o.status = 'left_late'
     order by o.seat_no, o.id
  loop
    update match_seats set status = 'refilled', end_reason = 'refilled' where id = v_left.id;
    if v_left.ticket_id is not null then
      perform app.ticket_release(array[v_left.ticket_id], 'refilled', array[v_left.id]);
      perform app.ticket_restore(v_left.ticket_id, v_left.id, false);
    end if;
    perform app.match_event(m.id, m.venue_id, 'refilled', 'guest', v_left.id, null, 'refilled',
                            jsonb_build_object('by_seat_id', v_left.by_seat));
    v_org := v_org or v_left.guest_id is not distinct from m.organiser_id;
  end loop;

  -- organiser_refilled: a refilled seat was the organiser's, so the caller
  -- runs match_recompute_organiser after its joined event (OM-34).
  return jsonb_build_object('seats', v_out, 'seat_ids', to_jsonb(v_seats), 'refill', v_refill,
                            'organiser_refilled', v_org and m.organiser_id is not null);
end $match_take_seats_0261$;

comment on function app.match_take_seats(matches, uuid, uuid[], text[], uuid) is
  '0261. Internal (caller holds L2 and picked the tickets): seats the player (account, their profile gender) and their friends (friend, the declared gender) on the numbers open for a guest, ascending, each with its share and ticket, then ticket_lock (NEED_TICKETS if fewer moved). A booked match is a refill: each seat replaces the number''s late leaver, who becomes refilled with the ticket released or restored (event refilled {by_seat_id}), or the latest ended seat of a vacant number. Returns {seats, seat_ids, refill, organiser_refilled}; organiser_refilled (a refilled seat was the organiser''s) tells the caller to run match_recompute_organiser after its joined event (OM-34).';

revoke all on function app.match_take_seats(matches, uuid, uuid[], text[], uuid) from public, anon, authenticated;

-- A guest's own seats in a match, as match_detail.me.seats and
-- my_matches.my_seats read them (guest.md §4.3). ticket_status is the
-- ticket's state as that seat sees it: in_use or forfeited by this seat,
-- else available (back in the wallet); NULL for a desk seat.
create or replace function app.match_my_seats(p_match_id uuid, p_guest uuid) returns jsonb
language sql stable security definer set search_path = public as $match_my_seats_0261$
  select coalesce(jsonb_agg(jsonb_build_object(
           'seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind, 'status', s.status,
           'end_reason', s.end_reason, 'share_iqd', s.share_iqd, 'request_id', s.request_id,
           'ticket_status', case when s.ticket_id is null then null
                                 when k.status = 'in_use' and k.seat_id = s.id then 'in_use'
                                 when k.status = 'forfeited' and k.forfeited_seat_id = s.id then 'forfeited'
                                 else 'available' end)
           order by s.joined_at, s.seat_no, s.id), '[]'::jsonb)
    from match_seats s
    left join match_tickets k on k.id = s.ticket_id
   where s.match_id = p_match_id and s.guest_id = p_guest
$match_my_seats_0261$;

comment on function app.match_my_seats(uuid, uuid) is
  '0261. Internal: a guest''s own seats in a match (account, friend, linked desk; any status), [{seat_id, seat_no, kind, status, end_reason, share_iqd, request_id, ticket_status}] by joined_at; ticket_status in_use/forfeited when this seat holds or forfeited it, available otherwise, NULL for a desk seat.';

revoke all on function app.match_my_seats(uuid, uuid) from public, anon, authenticated;

-- The account behind a report or block target (db.md §4.6.11), or NULL when
-- the target is not one: exactly one of seat or request; in this match; the
-- viewer a participant; an account behind it that is not the viewer's; a
-- request only for the organiser. A friend seat names its holder.
create or replace function app.match_report_target(p_match_id uuid, p_seat_id uuid, p_request_id uuid,
                                                   p_viewer uuid)
returns uuid
language plpgsql stable security definer set search_path = public as $match_report_target_0261$
declare
  v_m      matches%rowtype;
  v_target uuid;
begin
  if p_match_id is null or p_viewer is null or num_nonnulls(p_seat_id, p_request_id) <> 1 then
    return null;
  end if;
  select * into v_m from matches where id = p_match_id;
  if not found or app.match_visibility(v_m, p_viewer, null, null) is distinct from 'participant' then
    return null;
  end if;
  if p_seat_id is not null then
    select s.guest_id into v_target from match_seats s where s.id = p_seat_id and s.match_id = p_match_id;
  else
    if v_m.organiser_id is distinct from p_viewer then
      return null;
    end if;
    select q.guest_id into v_target from match_requests q where q.id = p_request_id and q.match_id = p_match_id;
  end if;
  if v_target is null or v_target = p_viewer then
    return null;
  end if;
  return v_target;
end $match_report_target_0261$;

comment on function app.match_report_target(uuid, uuid, uuid, uuid) is
  '0261. Internal (db.md §4.6.11): the profile a report or block from p_viewer targets, or NULL (REPORT_TARGET_INVALID / BLOCK_TARGET_INVALID): exactly one of a seat or a request of this match, the viewer a participant, an account behind the target that is not the viewer (a friend seat names its holder; a typed desk seat has none), a request target only for the organiser.';

revoke all on function app.match_report_target(uuid, uuid, uuid, uuid) from public, anon, authenticated;

-- ===========================================================================
-- 3. Reads (db.md §4.6.1, §4.6.12; guest.md §4.3, R27, R31, R32)
-- ===========================================================================

-- What a start would do, before the guest commits to it. Nothing is locked
-- or written; refusal is the first a start would raise from its unlocked
-- checks, never GENDER_REQUIRED or NEED_TICKETS (the phone handles both
-- inline, D13).
create or replace function app.match_quote(p_venue_id uuid, p_court_id uuid, p_start_at timestamptz,
                                           p_duration_min int)
returns jsonb
language plpgsql stable security definer set search_path = public as $match_quote_0261$
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
                      where r.court_id = c.id and r.kind in ('booking', 'maintenance')
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
end $match_quote_0261$;

comment on function app.match_quote(uuid, uuid, timestamptz, int) is
  '0261 (db.md §4.6.1, guest.md §4.3). Guest: what starting an open match on this court and time would mean: {enabled, duration_min, price_iqd, shares_iqd (NULL on NO_RATE), fill_deadline_at, earliest_start_at, categories (open plus the caller''s, all three when unset), my_gender, tickets_available (own sandbox), ticket_price_iqd, seats_max 3, filling_at_time, courts_free, refusal}. refusal is the first of MATCHES_OFF, BEYOND_HORIZON, CLOSED_DATE, OUTSIDE_HOURS, SLOT_IN_PAST, MATCH_TOO_LATE, NO_RATE, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, MATCH_LIMIT_REACHED, MATCH_TIME_CLASH, SLOT_TAKEN, MATCH_SLOT_FULL (unlocked counts), never GENDER_REQUIRED or NEED_TICKETS. Raises AUTH_REQUIRED, ACCOUNT_REQUIRED, INVALID_ARGUMENT, COURT_NOT_FOUND, INVALID_DURATION. Nothing is locked or written.';

revoke all on function app.match_quote(uuid, uuid, timestamptz, int) from public, anon;
grant execute on function app.match_quote(uuid, uuid, timestamptz, int) to authenticated;

-- The branch's open matches a guest may join or ask to join (D14: no names).
create or replace function app.open_matches(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $open_matches_0261$
declare
  v_p profiles%rowtype := app.match_guest(false);
begin
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  elsif p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '16 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;
  if exists (select 1 from customer_flags f where f.customer_id = v_p.id and f.type = 'match_ban') then
    return jsonb_build_object('banned', true, 'matches', '[]'::jsonb);
  end if;
  if not (p_venue_id = any (app.open_venue_ids())) then
    return jsonb_build_object('banned', false, 'matches', '[]'::jsonb);
  end if;
  return jsonb_build_object('banned', false, 'matches', coalesce((
    select jsonb_agg(x.j order by x.start_at, x.id)
      from (select m.id, m.start_at,
                   jsonb_build_object(
                     'match_id', m.id, 'start_at', m.start_at, 'end_at', m.end_at, 'duration_min', m.duration_min,
                     'category', m.category, 'join_policy', m.join_policy, 'status', m.status,
                     'seats_taken', (select count(*) from app.match_carriers(m.id) c where c.status in ('in', 'attended')),
                     'seats_left', cardinality(app.match_guest_numbers(m)),
                     'refill', m.status = 'booked',
                     'fill_deadline_at', m.fill_deadline_at,
                     'share_iqd', m.shares_iqd[coalesce((app.match_guest_numbers(m))[1], 4)],
                     'mine', case
                               when exists (select 1 from match_seats s where s.match_id = m.id and s.guest_id = v_p.id
                                               and s.status in ('in', 'attended')) then 'seated'
                               when exists (select 1 from match_requests q where q.match_id = m.id
                                               and q.guest_id = v_p.id and q.status = 'pending') then 'requested'
                             end) as j
              from matches m
             where m.venue_id = p_venue_id
               and m.start_at >= p_from and m.start_at < p_to
               and ((m.status = 'filling' and now() < m.fill_deadline_at)
                    or (m.status = 'booked' and cardinality(app.match_guest_numbers(m)) > 0))
               and app.match_visibility(m, v_p.id, v_p.gender, null) in ('public', 'participant')
               -- OM-44: a removed player's match leaves their lists (the
               -- detail still shows it, with me.excluded; guest.md §4.15).
               and not exists (select 1 from match_exclusions e where e.match_id = m.id and e.guest_id = v_p.id)
             order by m.start_at, m.id
             limit 200) x), '[]'::jsonb));
end $open_matches_0261$;

comment on function app.open_matches(uuid, timestamptz, timestamptz) is
  '0261 (db.md §4.6.12, guest.md §4.3, D14, R27). Guest: {banned, matches[]} for the branch between p_from and p_to (at most 16 days): the public and own matches that are listable (filling before the deadline, or booked with a seat open before the start), by start: {match_id, start_at, end_at, duration_min, category, join_policy, status, seats_taken, seats_left, refill, fill_deadline_at, share_iqd, mine (seated|requested|null)}. No names. A match the caller was removed from (match_exclusions, OM-44) is not listed. A banned caller gets banned true and no rows; a closed or unknown branch no rows. INVALID_ARGUMENT for a NULL or a window over 16 days.';

revoke all on function app.open_matches(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function app.open_matches(uuid, timestamptz, timestamptz) to authenticated;

-- One match as the guest may see it (D15: the union of both drafts). A
-- restricted viewer (a link to a match they may not join) gets only the card
-- (R32); a participant or a public/token viewer the full shape.
create or replace function app.match_detail(p_match_id uuid default null, p_token text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $match_detail_0261$
declare
  v_p        profiles%rowtype := app.match_guest(false);
  v_uid      uuid := v_p.id;
  v_m        matches%rowtype;
  v_vis      text;
  v_venue    venues%rowtype;
  v_enabled  boolean;
  v_banned   boolean;
  v_seated   boolean;
  v_in       boolean;
  v_carrier  boolean;
  v_request  match_requests%rowtype;
  v_pending  boolean;
  v_role     text;
  v_refusal  text;
  v_have     int;
  v_live     boolean;
  v_org      boolean;
  v_excluded boolean;
  v_court    uuid;
  v_seats    jsonb;
  v_requests jsonb;
  v_messages jsonb;
  v_taken    int;
  v_left     int;
begin
  if p_match_id is null and p_token is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  end if;
  if p_match_id is not null then
    select * into v_m from matches where id = p_match_id;
  else
    select * into v_m from matches where share_token = p_token;
  end if;
  if not found then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_vis := app.match_visibility(v_m, v_uid, v_p.gender, p_token);
  if v_vis is null then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_venue from venues where id = v_m.venue_id;
  v_banned := exists (select 1 from customer_flags f where f.customer_id = v_uid and f.type = 'match_ban');
  v_left := cardinality(app.match_guest_numbers(v_m));

  if v_vis = 'restricted' then
    return jsonb_build_object(
      'restricted', true, 'status', v_m.status, 'start_at', v_m.start_at, 'end_at', v_m.end_at,
      'duration_min', v_m.duration_min, 'category', v_m.category, 'join_policy', v_m.join_policy,
      'seats_left', v_left,
      'venue', jsonb_build_object('name_en', v_venue.name_en, 'name_ar', v_venue.name_ar),
      'timezone', v_venue.timezone,
      'me', jsonb_build_object('refusal', case
              when v_banned then 'MATCH_BANNED'
              when (v_m.category = 'women' and v_p.gender = 'male')
                or (v_m.category = 'men' and v_p.gender = 'female') then 'MATCH_GENDER_MISMATCH'
              else 'MATCH_UNAVAILABLE' end),
      'server_now', now());
  end if;

  v_enabled := coalesce((select vs.matches_enabled from venue_settings vs where vs.venue_id = v_m.venue_id), false);
  v_org := v_m.organiser_id is not distinct from v_uid;
  v_live := v_m.status in ('filling', 'awaiting_court', 'booked');
  v_seated := exists (select 1 from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid
                         and s.status in ('in', 'attended'));
  v_in := exists (select 1 from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid and s.status = 'in');
  -- A carrier (db.md §3.2) is already in: a late leaver holds their number
  -- until a refill, so they can neither join nor ask again (match_join 7).
  v_carrier := exists (select 1 from app.match_carriers(v_m.id) c join match_seats s on s.id = c.seat_id
                        where s.guest_id = v_uid);
  select * into v_request from match_requests q
   where q.match_id = v_m.id and q.guest_id = v_uid
   order by q.created_at desc, q.id desc limit 1;
  v_pending := found and v_request.status = 'pending';
  v_excluded := exists (select 1 from match_exclusions e where e.match_id = v_m.id and e.guest_id = v_uid);

  v_role := case
    when v_org then 'organiser'
    when exists (select 1 from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid
                    and s.status in ('in', 'attended', 'no_show', 'left_late', 'cancelled')) then 'player'
    when v_pending then 'requester'
    when v_excluded or exists (select 1 from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid
                                  and s.status = 'removed') then 'removed'
    else 'viewer' end;

  -- me.refusal: what a join or request would say now from its unlocked
  -- checks, tickets aside (D13); NULL for a player already in (a carrier,
  -- late leavers included) or asking.
  if not v_carrier and not v_pending then
    v_refusal := app.match_eligibility(v_uid, true);
    if v_refusal is null and not v_enabled then
      v_refusal := 'MATCHES_OFF';
    end if;
    if v_refusal is null then
      v_refusal := split_part(app.match_join_refusal(v_m, v_uid, '{}'::text[], 'read'), '|', 1);
      v_refusal := nullif(v_refusal, '');
    end if;
    if v_refusal is null and v_m.join_policy = 'approve'
       and (select count(*) from match_requests q where q.guest_id = v_uid and q.status = 'pending') >= 5 then
      v_refusal := 'REQUEST_LIMIT';
    end if;
    if v_refusal is null then
      begin
        perform app.assert_not_degraded_for(v_m.start_at, v_m.venue_id);
      exception when sqlstate 'P0001' then
        if sqlerrm = 'DEGRADED_LOCKOUT' then
          v_refusal := 'DEGRADED_LOCKOUT';
        else
          raise;
        end if;
      end;
    end if;
  end if;

  select count(*) into v_have from match_tickets k
   where k.guest_id = v_uid and k.status = 'available' and k.sandbox = v_m.sandbox;
  select count(*) into v_taken from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
  if v_m.reservation_id is not null then
    select r.court_id into v_court from reservations r where r.id = v_m.reservation_id;
  end if;

  -- The seats: every carrier; a late leaver's seat is shown open, unnamed.
  select coalesce(jsonb_agg(
           case when s.status = 'left_late' then
             jsonb_build_object(
               'seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind, 'status', s.status,
               'name', null, 'former', false, 'holder_seat_no', null,
               'is_me', s.guest_id is not distinct from v_uid and s.kind in ('account', 'desk'),
               'is_mine', s.guest_id is not distinct from v_uid,
               'share_iqd', s.share_iqd,
               'open', v_m.status = 'booked' and now() < v_m.start_at,
               'can', jsonb_build_object('remove', false, 'report', false, 'block', false))
           else
             app.match_seat_label(s) || jsonb_build_object(
               'status', s.status,
               'is_me', s.guest_id is not distinct from v_uid and s.kind in ('account', 'desk'),
               'is_mine', s.guest_id is not distinct from v_uid,
               'share_iqd', s.share_iqd,
               'open', false,
               'can', jsonb_build_object(
                 'remove', v_org and v_m.status in ('filling', 'awaiting_court') and s.status = 'in'
                           and s.kind in ('account', 'friend') and s.guest_id is distinct from v_uid,
                 'report', s.guest_id is not null and s.guest_id is distinct from v_uid,
                 'block', s.guest_id is not null and s.guest_id is distinct from v_uid))
           end order by c.seat_no), '[]'::jsonb)
    into v_seats
    from app.match_carriers(v_m.id) c
    join match_seats s on s.id = c.seat_id;

  if v_org then
    select coalesce(jsonb_agg(jsonb_build_object(
             'request_id', q.id, 'seats_requested', q.seats_requested, 'friend_genders', to_jsonb(q.friend_genders),
             'games_played', app.guest_games_played(q.guest_id), 'no_shows', app.guest_match_no_shows(q.guest_id),
             'created_at', q.created_at) || app.match_display_name(q.guest_id)
             order by q.created_at, q.id), '[]'::jsonb)
      into v_requests
      from match_requests q
     where q.match_id = v_m.id and q.status = 'pending';
  else
    v_requests := '[]'::jsonb;
  end if;

  if v_org or v_carrier then
    select coalesce(jsonb_agg(x.j order by x.at, x.id), '[]'::jsonb) into v_messages
      from (select e.id, e.at,
                   jsonb_build_object('code', e.code,
                                      'seat_no', (select s.seat_no from match_seats s where s.id = e.seat_id),
                                      'is_me', e.actor_guest_id is not distinct from v_uid,
                                      'at', e.at) || app.match_display_name(e.actor_guest_id) as j
              from match_events e
             where e.match_id = v_m.id and e.type = 'message'
             order by e.at desc, e.id desc
             limit 20) x;
  else
    v_messages := '[]'::jsonb;
  end if;

  return jsonb_build_object(
    'id', v_m.id, 'venue_id', v_m.venue_id, 'status', v_m.status, 'ended_reason', v_m.ended_reason,
    'start_at', v_m.start_at, 'end_at', v_m.end_at, 'duration_min', v_m.duration_min,
    'category', v_m.category, 'visibility', v_m.visibility, 'join_policy', v_m.join_policy,
    'price_iqd', v_m.price_iqd, 'shares_iqd', to_jsonb(v_m.shares_iqd), 'fill_deadline_at', v_m.fill_deadline_at,
    'seats_taken', v_taken, 'seats_left', v_left, 'seats_total', 4, 'court_id', v_court,
    'organiser', case when v_m.organiser_id is null then null
                      else app.match_display_name(v_m.organiser_id) || jsonb_build_object('is_me', v_org) end,
    'seats', v_seats,
    'me', jsonb_build_object(
      'role', v_role,
      'seats', app.match_my_seats(v_m.id, v_uid),
      'request', case when v_request.id is null then null
                      else jsonb_build_object('request_id', v_request.id, 'status', v_request.status,
                                              'seats_requested', v_request.seats_requested) end,
      'excluded', v_excluded,
      'can', jsonb_build_object(
        'join', v_m.join_policy = 'open' and v_refusal is null and not v_carrier and not v_pending,
        'request', v_m.join_policy = 'approve' and v_refusal is null and not v_carrier and not v_pending,
        'withdraw', v_pending,
        'leave', (v_in and (v_m.status in ('filling', 'awaiting_court')
                            or (v_m.status = 'booked' and now() < v_m.start_at)))
                 or (v_pending and v_live),
        'cancel', v_org and v_m.status in ('filling', 'awaiting_court'),
        'remove', v_org and v_m.status in ('filling', 'awaiting_court')
                  and exists (select 1 from match_seats s where s.match_id = v_m.id and s.status = 'in'
                                 and s.kind in ('account', 'friend') and s.guest_id is distinct from v_uid),
        'decide', v_org and v_live
                  and exists (select 1 from match_requests q where q.match_id = v_m.id and q.status = 'pending'),
        'message', (v_org or v_carrier) and v_live and now() < v_m.end_at,
        'report', v_role <> 'viewer'
                  and (exists (select 1 from match_seats s where s.match_id = v_m.id and s.guest_id is not null
                                  and s.guest_id <> v_uid)
                       or (v_org and v_requests <> '[]'::jsonb)),
        'block', v_role <> 'viewer'
                 and (exists (select 1 from match_seats s where s.match_id = v_m.id and s.guest_id is not null
                                 and s.guest_id <> v_uid)
                      or (v_org and v_requests <> '[]'::jsonb)),
        'share', (v_org or v_seated) and v_live),
      'refusal', v_refusal,
      'tickets_available', v_have,
      'tickets_needed', case when v_role in ('viewer', 'requester') then greatest(0, 1 - v_have) else 0 end,
      'leave_outcome', case
                         when v_in and v_m.status in ('filling', 'awaiting_court') then 'release'
                         when v_in and v_m.status = 'booked' and now() < v_m.start_at then 'locked_until_refill'
                         when v_pending and v_live then 'release'
                         else 'none' end),
    'requests', v_requests,
    'messages', v_messages,
    'share_token', case when v_org or v_seated then v_m.share_token end,
    'server_now', now());
end $match_detail_0261$;

comment on function app.match_detail(uuid, text) is
  '0261 (db.md §4.6.12, guest.md §4.3, D15, R31, R32). Guest: one match by id or share token. MATCH_NOT_FOUND when unknown or not visible (app.match_visibility). A restricted viewer (a token for a match they may not join: banned, the other gender, a block either way, a banned organiser) gets only {restricted: true, status, start_at, end_at, duration_min, category, join_policy, seats_left, venue, timezone, me: {refusal}, server_now}; anyone else the full shape: the match, organiser {name, former, is_me}, seats[] (carriers, a late leaver''s seat open and unnamed, can {remove, report, block}), me {role, seats, request, excluded, can, refusal (never a ticket code), tickets_available, tickets_needed, leave_outcome}, requests[] (organiser; pending; games played and no-shows, OM-41), messages[] (organiser and carrier holders; last 20), share_token (organiser and seated players), server_now. Names only as "First I." or Former player; no phone, full name or other player''s id.';

revoke all on function app.match_detail(uuid, text) from public, anon;
grant execute on function app.match_detail(uuid, text) to authenticated;

-- The caller's matches: a seat of any kind (linked desk seats included) or a
-- request, in any status. upcoming = live and not over, plus anything ended
-- in the last 24 hours; past = the rest.
create or replace function app.my_matches(p_scope text default 'upcoming') returns jsonb
language plpgsql stable security definer set search_path = public as $my_matches_0261$
declare
  v_p     profiles%rowtype := app.match_guest(false);
  v_scope text := coalesce(p_scope, 'upcoming');
begin
  if v_scope not in ('upcoming', 'past') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_scope';
  end if;
  return coalesce((
    select jsonb_agg(x.j order by
                       case when v_scope = 'upcoming' then x.start_at end asc,
                       case when v_scope = 'past' then x.start_at end desc,
                       x.id)
      from (select m.id, m.start_at,
                   jsonb_build_object(
                     'match_id', m.id, 'venue_id', m.venue_id, 'status', m.status, 'ended_reason', m.ended_reason,
                     'start_at', m.start_at, 'end_at', m.end_at, 'duration_min', m.duration_min,
                     'category', m.category, 'join_policy', m.join_policy, 'visibility', m.visibility,
                     'seats_taken', (select count(*) from app.match_carriers(m.id) c where c.status in ('in', 'attended')),
                     'court_id', (select r.court_id from reservations r where r.id = m.reservation_id),
                     'fill_deadline_at', m.fill_deadline_at,
                     'is_organiser', m.organiser_id is not distinct from v_p.id,
                     'my_role', case
                       when m.organiser_id is not distinct from v_p.id then 'organiser'
                       when exists (select 1 from match_seats s where s.match_id = m.id and s.guest_id = v_p.id
                                       and s.status <> 'removed') then 'player'
                       when exists (select 1 from match_requests q where q.match_id = m.id
                                       and q.guest_id = v_p.id) then 'requester'
                       else 'removed' end,
                     'my_seats', app.match_my_seats(m.id, v_p.id),
                     'request', (select jsonb_build_object('request_id', q.id, 'status', q.status,
                                                           'seats_requested', q.seats_requested,
                                                           'decided_at', q.decided_at)
                                   from match_requests q where q.match_id = m.id and q.guest_id = v_p.id
                                  order by q.created_at desc, q.id desc limit 1),
                     'my_tickets', jsonb_build_object(
                       'locked', (select count(*) from match_tickets k join match_seats s on s.id = k.seat_id
                                   where s.match_id = m.id and s.guest_id = v_p.id and k.status = 'in_use')
                               + (select count(*) from match_tickets k join match_requests q on q.id = k.request_id
                                   where q.match_id = m.id and q.guest_id = v_p.id and k.status = 'reserved'),
                       'released', (select count(*) from match_seats s join match_tickets k on k.id = s.ticket_id
                                     where s.match_id = m.id and s.guest_id = v_p.id
                                       and not (k.status = 'in_use' and k.seat_id = s.id)
                                       and not (k.status = 'forfeited' and k.forfeited_seat_id = s.id)),
                       'forfeited', (select count(*) from match_seats s join match_tickets k on k.id = s.ticket_id
                                      where s.match_id = m.id and s.guest_id = v_p.id
                                        and k.status = 'forfeited' and k.forfeited_seat_id = s.id))) as j
              from matches m
             where (exists (select 1 from match_seats s where s.match_id = m.id and s.guest_id = v_p.id)
                    or exists (select 1 from match_requests q where q.match_id = m.id and q.guest_id = v_p.id))
               and case when v_scope = 'upcoming'
                        then (m.status in ('filling', 'awaiting_court', 'booked') and m.end_at > now())
                             or (m.ended_at is not null and m.ended_at > now() - interval '24 hours')
                        else not ((m.status in ('filling', 'awaiting_court', 'booked') and m.end_at > now())
                                  or (m.ended_at is not null and m.ended_at > now() - interval '24 hours'))
                   end
             order by case when v_scope = 'upcoming' then m.start_at end asc,
                      case when v_scope = 'past' then m.start_at end desc,
                      m.id
             limit 100) x), '[]'::jsonb);
end $my_matches_0261$;

comment on function app.my_matches(text) is
  '0261 (db.md §4.6.12, guest.md §4.3). Guest: the caller''s matches (a seat of any kind or a request, any status), p_scope upcoming (live and not over, plus ended in the last 24 h; by start) or past (the rest; latest first), at most 100: {match_id, venue_id, status, ended_reason, start_at, end_at, duration_min, category, join_policy, visibility, seats_taken, court_id, fill_deadline_at, is_organiser, my_role (organiser|player|requester|removed), my_seats[], request (latest) | null, my_tickets {locked, released, forfeited}}. INVALID_ARGUMENT for another scope.';

revoke all on function app.my_matches(text) from public, anon;
grant execute on function app.my_matches(text) to authenticated;

create or replace function app.my_match_blocks() returns jsonb
language plpgsql stable security definer set search_path = public as $my_match_blocks_0261$
declare
  v_p profiles%rowtype := app.match_guest(false);
begin
  return coalesce((
    select jsonb_agg(jsonb_build_object('block_id', b.id, 'created_at', b.created_at)
                     || app.match_display_name(b.blocked_id)
                     order by b.created_at desc, b.id)
      from match_blocks b
     where b.blocker_id = v_p.id), '[]'::jsonb);
end $my_match_blocks_0261$;

comment on function app.my_match_blocks() is
  '0261 (guest.md §4.3, §4.17). Guest: the players the caller blocked, [{block_id, name, former, created_at}] newest first (name as "First I." or Former player).';

revoke all on function app.my_match_blocks() from public, anon;
grant execute on function app.my_match_blocks() to authenticated;

-- The Book tab's chips (anon and authenticated, public by design; D13): no
-- ids, names or money. A signed-in guest with a profile also gets the block,
-- ban and gender filters and their own sandbox flag, and sees their own
-- listable matches (mine).
create or replace function app.match_slots(p_venue_id uuid, p_from timestamptz, p_to timestamptz)
returns jsonb
language plpgsql stable security definer set search_path = public as $match_slots_0261$
declare
  v_uid    uuid;
  v_gender text;
begin
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  elsif p_from is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_from';
  elsif p_to is null or p_to <= p_from or p_to - p_from > interval '16 days' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_to';
  end if;
  -- The anonymous café session has no profile: it reads as anon.
  select p.id, p.gender into v_uid, v_gender from profiles p where p.id = auth.uid() and p.deleted_at is null;
  if not (p_venue_id = any (app.open_venue_ids()))
     or not coalesce((select vs.matches_enabled from venue_settings vs where vs.venue_id = p_venue_id), false) then
    return '[]'::jsonb;
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
             'start_at', m.start_at, 'end_at', m.end_at, 'duration_min', m.duration_min,
             'category', m.category, 'join_policy', m.join_policy,
             'seats_left', cardinality(app.match_guest_numbers(m)),
             'mine', v_uid is not null
                     and (exists (select 1 from match_seats s where s.match_id = m.id and s.guest_id = v_uid
                                     and s.status in ('in', 'attended'))
                          or exists (select 1 from match_requests q where q.match_id = m.id and q.guest_id = v_uid
                                        and q.status = 'pending')))
             order by m.start_at, m.id)
      from matches m
     where m.venue_id = p_venue_id
       and m.start_at >= p_from and m.start_at < p_to
       and ((m.status = 'filling' and now() < m.fill_deadline_at)
            or (m.status = 'booked' and cardinality(app.match_guest_numbers(m)) > 0))
       and app.match_visibility(m, v_uid, v_gender, null) in ('public', 'participant')
       -- OM-44: no chip for a match its viewer was removed from.
       and not exists (select 1 from match_exclusions e where e.match_id = m.id and e.guest_id = v_uid)
       and (v_uid is not null or not m.sandbox)), '[]'::jsonb);
end $match_slots_0261$;

comment on function app.match_slots(uuid, timestamptz, timestamptz) is
  '0261 (db.md §4.6.12, guest.md §4.3, D13, R27). Anon and authenticated, public by design: the listable public matches of an open branch with matches on, between p_from and p_to (at most 16 days): [{start_at, end_at, duration_min, category, join_policy, seats_left, mine}]. No ids, names or money. A signed-in guest with a profile also gets the ban, gender, block and exclusion (OM-44) filters and their own sandbox flag, and their own listable matches (mine true); anon never sees a sandbox match and mine is false. INVALID_ARGUMENT for a NULL or a window over 16 days.';

revoke all on function app.match_slots(uuid, timestamptz, timestamptz) from public;
grant execute on function app.match_slots(uuid, timestamptz, timestamptz) to anon, authenticated;

-- The web invite (anon and authenticated, public by design; D12, DF-9). Every
-- miss is {"status":"closed"} and nothing else, so it is no oracle.
create or replace function app.match_invite(p_token text) returns jsonb
language plpgsql stable security definer set search_path = public as $match_invite_0261$
declare
  v_m      matches%rowtype;
  v_venue  venues%rowtype;
  v_left   int;
  v_status text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{22}$' then
    return jsonb_build_object('status', 'closed');
  end if;
  select * into v_m from matches where share_token = p_token;
  if not found or v_m.sandbox
     or not (v_m.venue_id = any (app.open_venue_ids()))
     or not coalesce((select vs.matches_enabled from venue_settings vs where vs.venue_id = v_m.venue_id), false) then
    return jsonb_build_object('status', 'closed');
  end if;
  v_left := cardinality(app.match_guest_numbers(v_m));
  v_status := case
    when v_m.status = 'filling' and now() < v_m.fill_deadline_at then 'open'
    when v_m.status = 'awaiting_court' and now() < v_m.start_at then 'full'
    when v_m.status = 'booked' and now() < v_m.start_at then case when v_left > 0 then 'open' else 'full' end
    else 'closed' end;
  if v_status = 'closed' then
    return jsonb_build_object('status', 'closed');
  end if;
  select * into v_venue from venues where id = v_m.venue_id;
  return jsonb_build_object(
    'status', v_status, 'start_at', v_m.start_at, 'end_at', v_m.end_at, 'timezone', v_venue.timezone,
    'category', v_m.category, 'join_policy', v_m.join_policy, 'seats_left', v_left,
    'venue', jsonb_build_object('name_en', v_venue.name_en, 'name_ar', v_venue.name_ar));
end $match_invite_0261$;

comment on function app.match_invite(text) is
  '0261 (db.md §4.6.12, guest.md §4.3, D12, DF-9). Anon and authenticated, public by design: the web invite for a share token: {status open|full|closed, start_at, end_at, timezone, category, join_policy, seats_left, venue {name_en, name_ar}}; full = awaiting a court, or booked with no seat open before the start. A NULL, malformed, unknown or sandbox token, a closed branch, matches off, or a match no longer taking players answers {"status":"closed"} alone. No names, ids or money.';

revoke all on function app.match_invite(text) from public;
grant execute on function app.match_invite(text) to anon, authenticated;

-- ===========================================================================
-- 4. Writes (db.md §4.6.2–§4.6.11)
-- ===========================================================================

-- Start an open match on a free time (OM-12, OM-13): no court is held. The
-- starter takes seat 1 and up to two friend seats, each with a ticket.
create or replace function app.match_start(
  p_venue_id         uuid,
  p_court_id         uuid,
  p_start_at         timestamptz,
  p_duration_min     int,
  p_category         text,
  p_visibility       text,
  p_join_policy      text,
  p_friends          jsonb default '[]',
  p_quoted_price_iqd bigint default null,
  p_idempotency_key  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $match_start_0261$
declare
  v_p        profiles%rowtype := app.match_guest(true);
  v_uid      uuid := v_p.id;
  v_friends  text[];
  v_need     text := case p_category when 'women' then 'female' when 'men' then 'male' end;
  v_m        matches%rowtype;
  v_court    courts%rowtype;
  v_vs       venue_settings%rowtype;
  v_cap      int;
  v_deadline int;
  v_end      timestamptz;
  v_period   tstzrange;
  v_sandbox  boolean := coalesce(v_p.payment_sandbox, false);
  v_n        int;
  v_rule     uuid;
  v_price    bigint;
  v_shares   bigint[];
  v_tickets  uuid[];
  v_seat     uuid;
  v_seats    uuid[] := '{}'::uuid[];
  v_out      jsonb := '[]'::jsonb;
  v_i        int;
  v_locked   int;
  v_token    text;
begin
  -- 2. The arguments, each by name.
  if p_venue_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_venue_id';
  elsif p_court_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_court_id';
  elsif p_start_at is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_start_at';
  elsif p_duration_min is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_duration_min';
  elsif p_category is null or p_category not in ('open', 'women', 'men') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_category';
  elsif p_visibility is null or p_visibility not in ('public', 'link') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_visibility';
  elsif p_join_policy is null or p_join_policy not in ('open', 'approve') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_join_policy';
  end if;
  v_friends := app.match_friends(p_friends);
  if v_need is not null and exists (select 1 from unnest(v_friends) g where g is null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_friends';
  end if;
  if p_quoted_price_iqd is null or p_quoted_price_iqd < 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_quoted_price_iqd';
  end if;
  if p_idempotency_key is null or char_length(p_idempotency_key) not between 1 and 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_idempotency_key';
  end if;

  -- 3. A replay of this caller's start answers the same match (hold_slot's
  --    pattern); the key under anyone else is a conflict.
  select * into v_m from matches where idempotency_key = p_idempotency_key;
  if found then
    if v_m.organiser_id is distinct from v_uid
       and not exists (select 1 from match_seats s where s.match_id = v_m.id and s.kind = 'account'
                          and s.guest_id = v_uid and s.joined_at = v_m.created_at) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'that key belongs to another match';
    end if;
    return jsonb_build_object(
      'duplicate', true, 'match_id', v_m.id, 'status', v_m.status, 'share_token', v_m.share_token,
      'seats', (select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind)
                                          order by s.seat_no), '[]'::jsonb)
                  from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid and s.joined_at = v_m.created_at),
      'price_iqd', v_m.price_iqd, 'shares_iqd', to_jsonb(v_m.shares_iqd), 'fill_deadline_at', v_m.fill_deadline_at,
      'tickets_locked', (select count(*) from match_seats s join match_tickets k on k.seat_id = s.id
                          where s.match_id = v_m.id and s.guest_id = v_uid and s.joined_at = v_m.created_at
                            and k.status = 'in_use'),
      'tickets_available', (select count(*) from match_tickets k where k.guest_id = v_uid and k.status = 'available'
                              and k.sandbox = v_sandbox));
  end if;

  -- 4. OM-20: the fourth seat is always someone else's.
  if cardinality(v_friends) > 2 then
    raise exception 'MATCH_SEAT_LIMIT' using errcode = 'P0001';
  end if;

  -- 5. An active court of an open branch.
  select * into v_court from courts
   where id = p_court_id and is_active and venue_id = p_venue_id
     and venue_id = any (app.open_venue_ids());
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_vs from venue_settings where venue_id = p_venue_id;

  -- 6. R10.
  if not coalesce(v_vs.matches_enabled, false) then
    raise exception 'MATCHES_OFF' using errcode = 'P0001';
  end if;

  -- 7.
  if not (p_duration_min = any (v_court.duration_options)) then
    raise exception 'INVALID_DURATION' using errcode = 'P0001';
  end if;

  -- 8.
  if coalesce(v_vs.max_booking_horizon_days, 0) > 0
     and p_start_at > now() + make_interval(days => v_vs.max_booking_horizon_days) then
    raise exception 'BEYOND_HORIZON' using errcode = 'P0001', detail = v_vs.max_booking_horizon_days::text;
  end if;

  v_end := p_start_at + make_interval(mins => p_duration_min);
  v_period := tstzrange(p_start_at, v_end, '[)');
  v_deadline := coalesce(v_vs.match_fill_deadline_minutes, 120);

  -- 9. Closed dates and opening hours (0026).
  perform app.assert_bookable(p_court_id, p_start_at, v_end);

  -- 10.
  if p_start_at <= now() then
    raise exception 'SLOT_IN_PAST' using errcode = 'P0001';
  end if;

  -- 11. OM-43: the deadline, and an hour after it, must still lie ahead.
  if p_start_at < now() + make_interval(mins => v_deadline + 60) then
    raise exception 'MATCH_TOO_LATE' using errcode = 'P0001', detail = (v_deadline + 60)::text;
  end if;

  -- 12.
  perform app.assert_not_degraded_for(p_start_at, p_venue_id);

  -- 13. OM-7, OM-39.
  if v_need is not null then
    if v_p.gender is distinct from v_need then
      raise exception 'MATCH_GENDER_MISMATCH' using errcode = 'P0001';
    end if;
    if exists (select 1 from unnest(v_friends) g where g is distinct from v_need) then
      raise exception 'MATCH_GENDER_MISMATCH' using errcode = 'P0001', detail = 'friend';
    end if;
  end if;

  -- 14. OM-37, counted unlocked (the accepted HOLD_QUOTA_EXCEEDED shape). A
  --     match this very key started (a double tap that committed meanwhile)
  --     never counts against its own replay: step 17 answers it.
  select ps.max_filling_matches_per_guest into v_cap from platform_settings ps where ps.id;
  if (select count(distinct s.match_id)
        from match_seats s join matches x on x.id = s.match_id
       where s.guest_id = v_uid and s.kind = 'account' and s.status = 'in'
         and x.status in ('filling', 'awaiting_court')
         and x.idempotency_key is distinct from p_idempotency_key) >= coalesce(v_cap, 3) then
    raise exception 'MATCH_LIMIT_REACHED' using errcode = 'P0001', detail = coalesce(v_cap, 3)::text;
  end if;

  -- 15. R41 (the same exception for this key's own match). Checked again after
  --     the ticket pick (22).
  if app.match_time_clash(v_uid, v_period, null, p_idempotency_key) then
    raise exception 'MATCH_TIME_CLASH' using errcode = 'P0001';
  end if;

  -- 16. LS: every court of the branch, its stale holds, the branch mutex.
  perform set_config('app.venue_id', p_venue_id::text, true);
  perform app.match_lock_courts(p_venue_id);
  perform app.match_expire_holds(p_venue_id, v_period);
  perform app.lock_match_venue(p_venue_id);

  -- 17. R24: a double tap waited on the courts; the first start is committed.
  select * into v_m from matches where idempotency_key = p_idempotency_key;
  if found then
    if v_m.organiser_id is distinct from v_uid
       and not exists (select 1 from match_seats s where s.match_id = v_m.id and s.kind = 'account'
                          and s.guest_id = v_uid and s.joined_at = v_m.created_at) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'that key belongs to another match';
    end if;
    return jsonb_build_object(
      'duplicate', true, 'match_id', v_m.id, 'status', v_m.status, 'share_token', v_m.share_token,
      'seats', (select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind)
                                          order by s.seat_no), '[]'::jsonb)
                  from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid and s.joined_at = v_m.created_at),
      'price_iqd', v_m.price_iqd, 'shares_iqd', to_jsonb(v_m.shares_iqd), 'fill_deadline_at', v_m.fill_deadline_at,
      'tickets_locked', (select count(*) from match_seats s join match_tickets k on k.seat_id = s.id
                          where s.match_id = v_m.id and s.guest_id = v_uid and s.joined_at = v_m.created_at
                            and k.status = 'in_use'),
      'tickets_available', (select count(*) from match_tickets k where k.guest_id = v_uid and k.status = 'available'
                              and k.sandbox = v_sandbox));
  end if;

  -- 18. A court offering the length with no firm row (a hold is not firm).
  if not app.match_court_free_firm(p_venue_id, v_period, p_duration_min, 1) then
    raise exception 'SLOT_TAKEN' using errcode = 'P0001';
  end if;

  -- 19. OM-42: filling matches over this time never outnumber the free courts.
  if not v_sandbox then
    select count(*) into v_n from matches x
     where x.venue_id = p_venue_id and not x.sandbox and x.status in ('filling', 'awaiting_court')
       and x.period && v_period;
    if not app.match_court_free_firm(p_venue_id, v_period, p_duration_min, v_n + 1) then
      raise exception 'MATCH_SLOT_FULL' using errcode = 'P0001', detail = v_n::text;
    end if;
  end if;

  -- 20.
  select ps.rule_id, ps.price_iqd into v_rule, v_price
    from app.price_slot(p_court_id, p_start_at, p_duration_min) ps;
  if v_rule is null then
    raise exception 'NO_RATE' using errcode = 'P0001';
  end if;

  -- 21. DF-3: quote = charge.
  if v_price <> p_quoted_price_iqd then
    raise exception 'PRICE_CHANGED' using errcode = 'P0001',
      detail = format('{"quoted_iqd":%s,"current_iqd":%s}', p_quoted_price_iqd, v_price);
  end if;

  -- 22. One ticket per seat, the starter's own (friends' seats use theirs).
  v_tickets := app.ticket_pick(v_uid, 1 + cardinality(v_friends), v_sandbox);

  -- R41 again. The mutex is per branch, so the same guest's start or join at
  -- another branch (or a start this one's 15 raced) may have passed its own
  -- check meanwhile; ticket_pick locks every available ticket of the guest,
  -- so that write has committed by now and this statement sees its seats.
  if app.match_time_clash(v_uid, v_period, null, p_idempotency_key) then
    raise exception 'MATCH_TIME_CLASH' using errcode = 'P0001';
  end if;

  v_shares := app.match_shares(v_price);
  v_token := translate(rtrim(encode(extensions.gen_random_bytes(16), 'base64'), '='), '+/', '-_');
  begin
    insert into matches (venue_id, status, start_at, end_at, duration_min, visibility, join_policy, category,
                         price_iqd, shares_iqd, rate_rule_id, price_court_id, fill_deadline_at, share_token,
                         organiser_id, organised_by, sandbox, idempotency_key)
    values (p_venue_id, 'filling', p_start_at, v_end, p_duration_min, p_visibility, p_join_policy, p_category,
            v_price, v_shares, v_rule, p_court_id, p_start_at - make_interval(mins => v_deadline), v_token,
            v_uid, 'guest', v_sandbox, p_idempotency_key)
    returning * into v_m;
  exception when unique_violation then
    -- The key used at another branch and committed while this one waited
    -- (the mutex is per branch): the same answer as 3 and 17.
    select * into v_m from matches where idempotency_key = p_idempotency_key;
    if not found then
      raise;
    end if;
    if v_m.organiser_id is distinct from v_uid
       and not exists (select 1 from match_seats s where s.match_id = v_m.id and s.kind = 'account'
                          and s.guest_id = v_uid and s.joined_at = v_m.created_at) then
      raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
        hint = 'that key belongs to another match';
    end if;
    return jsonb_build_object(
      'duplicate', true, 'match_id', v_m.id, 'status', v_m.status, 'share_token', v_m.share_token,
      'seats', (select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'seat_no', s.seat_no, 'kind', s.kind)
                                          order by s.seat_no), '[]'::jsonb)
                  from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid and s.joined_at = v_m.created_at),
      'price_iqd', v_m.price_iqd, 'shares_iqd', to_jsonb(v_m.shares_iqd), 'fill_deadline_at', v_m.fill_deadline_at,
      'tickets_locked', (select count(*) from match_seats s join match_tickets k on k.seat_id = s.id
                          where s.match_id = v_m.id and s.guest_id = v_uid and s.joined_at = v_m.created_at
                            and k.status = 'in_use'),
      'tickets_available', (select count(*) from match_tickets k where k.guest_id = v_uid and k.status = 'available'
                              and k.sandbox = v_sandbox));
  end;

  for v_i in 1 .. 1 + cardinality(v_friends) loop
    insert into match_seats (venue_id, match_id, seat_no, kind, guest_id, gender, ticket_id, share_iqd)
    values (p_venue_id, v_m.id, v_i, case when v_i = 1 then 'account' else 'friend' end, v_uid,
            case when v_i = 1 then v_p.gender else v_friends[v_i - 1] end,
            v_tickets[v_i], v_shares[v_i])
    returning id into v_seat;
    v_seats := array_append(v_seats, v_seat);
    v_out := v_out || jsonb_build_array(jsonb_build_object(
               'seat_id', v_seat, 'seat_no', v_i, 'kind', case when v_i = 1 then 'account' else 'friend' end));
  end loop;
  v_locked := app.ticket_lock(v_tickets, v_seats);
  if v_locked <> cardinality(v_tickets) then
    raise exception 'NEED_TICKETS' using errcode = 'P0001',
      detail = format('{"needed":%s,"available":%s,"buy":%s}', cardinality(v_tickets), v_locked,
                      cardinality(v_tickets) - v_locked);
  end if;
  perform app.match_event(v_m.id, p_venue_id, 'started', 'guest', v_seats[1], null, null,
                          jsonb_build_object('seats', to_jsonb(v_seats), 'seats_taken', cardinality(v_seats)));

  return jsonb_build_object(
    'duplicate', false, 'match_id', v_m.id, 'status', v_m.status, 'share_token', v_m.share_token,
    'seats', v_out, 'price_iqd', v_m.price_iqd, 'shares_iqd', to_jsonb(v_m.shares_iqd),
    'fill_deadline_at', v_m.fill_deadline_at, 'tickets_locked', v_locked,
    'tickets_available', (select count(*) from match_tickets k where k.guest_id = v_uid and k.status = 'available'
                            and k.sandbox = v_sandbox));
end $match_start_0261$;

comment on function app.match_start(uuid, uuid, timestamptz, int, text, text, text, jsonb, bigint, text) is
  '0261 (db.md §4.6.2). Guest: starts an open match on a free time (no court held, OM-13): refusals in order AUTH_REQUIRED, ACCOUNT_REQUIRED, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, GENDER_REQUIRED; INVALID_ARGUMENT (detail the argument; p_idempotency_key and p_quoted_price_iqd are required); a replay of the caller''s key returns the match with duplicate true, anyone else''s IDEMPOTENCY_CONFLICT; MATCH_SEAT_LIMIT; COURT_NOT_FOUND; MATCHES_OFF; INVALID_DURATION; BEYOND_HORIZON; CLOSED_DATE, OUTSIDE_HOURS; SLOT_IN_PAST; MATCH_TOO_LATE (detail minutes, OM-43); DEGRADED_LOCKOUT; MATCH_GENDER_MISMATCH (detail friend); MATCH_LIMIT_REACHED (detail the cap, OM-37); MATCH_TIME_CLASH (R41); then under courts, stale holds and the branch mutex: the key again (R24), SLOT_TAKEN, MATCH_SLOT_FULL (detail the overlapping count, OM-42; not for sandbox), NO_RATE, PRICE_CHANGED (detail {quoted_iqd, current_iqd}), NEED_TICKETS, MATCH_TIME_CLASH again after the ticket pick (R41 across branches). Writes the match (the stamped price, shares, deadline, a 22-character share token, the caller''s sandbox), seat 1 and the friend seats with their tickets locked, event started.';

revoke all on function app.match_start(uuid, uuid, timestamptz, int, text, text, text, jsonb, bigint, text) from public, anon;
grant execute on function app.match_start(uuid, uuid, timestamptz, int, text, text, text, jsonb, bigint, text) to authenticated;

-- Join an instant match (OM-4), or take an open seat of a booked one.
create or replace function app.match_join(p_match_id uuid, p_friends jsonb default '[]', p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public as $match_join_0261$
declare
  v_p       profiles%rowtype := app.match_guest(true);
  v_uid     uuid := v_p.id;
  v_friends text[];
  v_m       matches%rowtype;
  v_mine    int;
  v_tickets uuid[];
  v_taken   jsonb;
  v_status  text;
  v_n       int;
  v_pass    int;
begin
  -- 2, 3.
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  end if;
  v_friends := app.match_friends(p_friends);
  if cardinality(v_friends) > 2 then
    raise exception 'MATCH_SEAT_LIMIT' using errcode = 'P0001';
  end if;

  -- 4. Unknown and invisible read the same (a sandbox mismatch lands here).
  select * into v_m from matches where id = p_match_id;
  if not found or app.match_visibility(v_m, v_uid, v_p.gender, p_token) is null then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 5. R10.
  if not coalesce((select vs.matches_enabled from venue_settings vs where vs.venue_id = v_m.venue_id), false) then
    raise exception 'MATCHES_OFF' using errcode = 'P0001';
  end if;

  -- 6.
  if v_m.join_policy = 'approve' then
    raise exception 'MATCH_APPROVAL_REQUIRED' using errcode = 'P0001';
  end if;

  -- 7-14 once unlocked; then under L2 (courts, the booking row, stale holds,
  -- the branch mutex) 7 and 10 again, so a double tap that waited on the
  -- courts answers as a replay.
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      v_m := app.match_lock(v_m.id);
    end if;

    -- 7. Already in: the caller carries a number here (db.md §3.2; a late
    --    leaver holds theirs until a refill, so they never take another). The
    --    same live seats again is a replay; a late leaver's seats never are.
    select count(*) into v_mine from match_seats s
     where s.match_id = v_m.id and s.guest_id = v_uid and s.status in ('in', 'attended');
    if exists (select 1 from app.match_carriers(v_m.id) c join match_seats s on s.id = c.seat_id
                where s.guest_id = v_uid) then
      if v_mine = 1 + cardinality(v_friends) then
        return jsonb_build_object(
          'duplicate', true, 'match_id', v_m.id, 'match_status', v_m.status,
          'refill', exists (select 1 from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid
                               and s.status in ('in', 'attended') and s.replaces_seat_id is not null),
          'seats', (select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'seat_no', s.seat_no,
                                                                 'kind', s.kind) order by s.seat_no), '[]'::jsonb)
                      from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid
                       and s.status in ('in', 'attended')),
          'tickets_locked', (select count(*) from match_seats s join match_tickets k on k.seat_id = s.id
                              where s.match_id = v_m.id and s.guest_id = v_uid and k.status = 'in_use'),
          'tickets_available', (select count(*) from match_tickets k where k.guest_id = v_uid
                                  and k.status = 'available' and k.sandbox = v_m.sandbox));
      end if;
      raise exception 'MATCH_ALREADY_IN' using errcode = 'P0001';
    end if;

    if v_pass = 1 then
      -- 8-12: UNAVAILABLE, GENDER_MISMATCH, CLOSED / FULL, LIMIT_REACHED, TIME_CLASH.
      perform app.match_raise(app.match_join_refusal(v_m, v_uid, v_friends, 'join'));
      -- 13.
      perform app.assert_not_degraded_for(v_m.start_at, v_m.venue_id);
    else
      -- 10 again.
      perform app.match_raise(app.match_join_refusal(v_m, v_uid, v_friends, 'numbers'));
    end if;
  end loop;

  -- 15.
  v_tickets := app.ticket_pick(v_uid, 1 + cardinality(v_friends), v_m.sandbox);

  -- 12 again (R41). The mutex is per branch, so the same guest's join or start
  -- at another branch may have passed its own check meanwhile; ticket_pick
  -- locks every available ticket of the guest, so that write has committed by
  -- now and this statement sees its seats.
  perform app.match_raise(app.match_join_refusal(v_m, v_uid, v_friends, 'clash'));

  begin
    v_taken := app.match_take_seats(v_m, v_uid, v_tickets, v_friends, null);
  exception when unique_violation then
    raise exception 'MATCH_ALREADY_IN' using errcode = 'P0001';
  end;
  select count(*) into v_n from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
  perform app.match_event(v_m.id, v_m.venue_id, 'joined', 'guest',
                          ((v_taken->'seat_ids')->>0)::uuid, null, null,
                          jsonb_build_object('seats', v_taken->'seat_ids', 'seats_taken', v_n,
                                             'refill', v_taken->'refill'));
  -- OM-34: the organiser left late and this refill took their number.
  if (v_taken->>'organiser_refilled')::boolean then
    perform app.match_recompute_organiser(v_m.id);
  end if;

  v_status := v_m.status;
  if v_m.status = 'filling'
     and (select count(*) from app.match_carriers(v_m.id) c where c.seat_id is not null) = 4 then
    v_status := app.match_try_book(v_m.id);
  end if;

  return jsonb_build_object(
    'duplicate', false, 'match_id', v_m.id, 'match_status', v_status,
    'refill', v_taken->'refill', 'seats', v_taken->'seats',
    'tickets_locked', cardinality(v_tickets),
    'tickets_available', (select count(*) from match_tickets k where k.guest_id = v_uid and k.status = 'available'
                            and k.sandbox = v_m.sandbox));
end $match_join_0261$;

comment on function app.match_join(uuid, jsonb, text) is
  '0261 (db.md §4.6.3). Guest: joins an instant match (OM-4), or takes an open seat of a booked one before its start (a refill: the late leaver''s ticket comes back, OM-11). Refusals in order: the match_guest codes; INVALID_ARGUMENT; MATCH_SEAT_LIMIT; MATCH_NOT_FOUND (unknown or not visible); MATCHES_OFF; MATCH_APPROVAL_REQUIRED; the caller carries a number here (a late leaver included): the same live seats again -> duplicate, else MATCH_ALREADY_IN; MATCH_UNAVAILABLE; MATCH_GENDER_MISMATCH; MATCH_CLOSED / MATCH_FULL; MATCH_LIMIT_REACHED (filling only); MATCH_TIME_CLASH; DEGRADED_LOCKOUT; then under L2 (courts, the booking row, stale holds, the branch mutex) the seats again; NEED_TICKETS; MATCH_TIME_CLASH again after the ticket pick (R41 across branches). The fourth carrier books the court (match_try_book). Returns {duplicate, match_id, match_status, refill, seats, tickets_locked, tickets_available}.';

revoke all on function app.match_join(uuid, jsonb, text) from public, anon;
grant execute on function app.match_join(uuid, jsonb, text) to authenticated;

-- Ask to join an approve-mode match (OM-35): the tickets are reserved with
-- the request.
create or replace function app.match_request(p_match_id uuid, p_friends jsonb default '[]', p_token text default null)
returns jsonb
language plpgsql security definer set search_path = public as $match_request_0261$
declare
  v_p       profiles%rowtype := app.match_guest(true);
  v_uid     uuid := v_p.id;
  v_friends text[];
  v_n       int;
  v_m       matches%rowtype;
  v_q       match_requests%rowtype;
  v_tickets uuid[];
  v_locked  int;
begin
  -- 2, 3.
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  end if;
  v_friends := app.match_friends(p_friends);
  if cardinality(v_friends) > 2 then
    raise exception 'MATCH_SEAT_LIMIT' using errcode = 'P0001';
  end if;
  v_n := 1 + cardinality(v_friends);

  -- 4.
  select * into v_m from matches where id = p_match_id;
  if not found or app.match_visibility(v_m, v_uid, v_p.gender, p_token) is null then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 5.
  if not coalesce((select vs.matches_enabled from venue_settings vs where vs.venue_id = v_m.venue_id), false) then
    raise exception 'MATCHES_OFF' using errcode = 'P0001';
  end if;

  -- 6.
  if v_m.join_policy = 'open' then
    raise exception 'MATCH_NOT_APPROVAL' using errcode = 'P0001';
  end if;

  -- 7. The caller carries a number here (a late leaver included, db.md §3.2).
  if exists (select 1 from app.match_carriers(v_m.id) c join match_seats s on s.id = c.seat_id
              where s.guest_id = v_uid) then
    raise exception 'MATCH_ALREADY_IN' using errcode = 'P0001';
  end if;

  -- 8. The caller's pending request is the answer to a replay.
  select * into v_q from match_requests q where q.match_id = v_m.id and q.guest_id = v_uid and q.status = 'pending';
  if found then
    return jsonb_build_object('duplicate', true, 'request_id', v_q.id, 'status', 'pending',
                              'seats_requested', v_q.seats_requested,
                              'tickets_reserved', (select count(*) from match_tickets k
                                                    where k.request_id = v_q.id and k.status = 'reserved'));
  end if;

  -- 9-13.
  perform app.match_raise(app.match_join_refusal(v_m, v_uid, v_friends, 'request'));

  -- 14.
  if (select count(*) from match_requests q where q.guest_id = v_uid and q.status = 'pending') >= 5 then
    raise exception 'REQUEST_LIMIT' using errcode = 'P0001', detail = '5';
  end if;

  -- 15.
  perform app.assert_not_degraded_for(v_m.start_at, v_m.venue_id);

  -- 16. L1, then 7, 8 and 11 again.
  perform set_config('app.venue_id', v_m.venue_id::text, true);
  perform app.lock_match_venue(v_m.venue_id);
  select * into v_m from matches where id = v_m.id;
  if exists (select 1 from app.match_carriers(v_m.id) c join match_seats s on s.id = c.seat_id
              where s.guest_id = v_uid) then
    raise exception 'MATCH_ALREADY_IN' using errcode = 'P0001';
  end if;
  select * into v_q from match_requests q where q.match_id = v_m.id and q.guest_id = v_uid and q.status = 'pending';
  if found then
    return jsonb_build_object('duplicate', true, 'request_id', v_q.id, 'status', 'pending',
                              'seats_requested', v_q.seats_requested,
                              'tickets_reserved', (select count(*) from match_tickets k
                                                    where k.request_id = v_q.id and k.status = 'reserved'));
  end if;
  perform app.match_raise(app.match_join_refusal(v_m, v_uid, v_friends, 'numbers'));

  -- 17.
  v_tickets := app.ticket_pick(v_uid, v_n, v_m.sandbox);

  insert into match_requests (venue_id, match_id, guest_id, seats_requested, friend_genders)
  values (v_m.venue_id, v_m.id, v_uid, v_n, case when v_m.category = 'open' then null else v_friends end)
  returning * into v_q;
  v_locked := app.ticket_lock(v_tickets, null, v_q.id);
  if v_locked <> v_n then
    raise exception 'NEED_TICKETS' using errcode = 'P0001',
      detail = format('{"needed":%s,"available":%s,"buy":%s}', v_n, v_locked, v_n - v_locked);
  end if;
  perform app.match_event(v_m.id, v_m.venue_id, 'requested', 'guest', null, v_q.id, null,
                          jsonb_build_object('seats', v_n));

  return jsonb_build_object('duplicate', false, 'request_id', v_q.id, 'status', 'pending',
                            'seats_requested', v_n, 'tickets_reserved', v_locked);
end $match_request_0261$;

comment on function app.match_request(uuid, jsonb, text) is
  '0261 (db.md §4.6.4, OM-35). Guest: asks to join an approve-mode match; the request reserves one ticket per seat. Refusals in order: the match_guest codes; INVALID_ARGUMENT; MATCH_SEAT_LIMIT; MATCH_NOT_FOUND; MATCHES_OFF; MATCH_NOT_APPROVAL; MATCH_ALREADY_IN (the caller carries a number here, a late leaver included); the caller''s pending request -> duplicate; MATCH_UNAVAILABLE; MATCH_GENDER_MISMATCH; MATCH_CLOSED / MATCH_FULL; MATCH_LIMIT_REACHED (filling only); MATCH_TIME_CLASH; REQUEST_LIMIT (detail 5 pending across matches); DEGRADED_LOCKOUT; then under the branch mutex the seat, the pending request and the numbers again; NEED_TICKETS. Returns {duplicate, request_id, status, seats_requested, tickets_reserved}.';

revoke all on function app.match_request(uuid, jsonb, text) from public, anon;
grant execute on function app.match_request(uuid, jsonb, text) to authenticated;

-- The requester takes their request back; its tickets come back.
create or replace function app.match_withdraw(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $match_withdraw_0261$
declare
  v_p        profiles%rowtype := app.match_guest(false);
  v_uid      uuid := v_p.id;
  v_q        match_requests%rowtype;
  v_tickets  uuid[];
  v_released int;
begin
  if p_request_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_request_id';
  end if;
  select * into v_q from match_requests q where q.id = p_request_id and q.guest_id = v_uid;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_q.status = 'withdrawn' then
    return jsonb_build_object('request_id', v_q.id, 'status', 'withdrawn', 'duplicate', true, 'tickets_released', 0);
  end if;
  if v_q.status <> 'pending' then
    raise exception 'REQUEST_CLOSED' using errcode = 'P0001';
  end if;

  -- L1, then the same answers again.
  perform set_config('app.venue_id', v_q.venue_id::text, true);
  perform app.lock_match_venue(v_q.venue_id);
  select * into v_q from match_requests q where q.id = p_request_id;
  if v_q.status = 'withdrawn' then
    return jsonb_build_object('request_id', v_q.id, 'status', 'withdrawn', 'duplicate', true, 'tickets_released', 0);
  end if;
  if v_q.status <> 'pending' then
    raise exception 'REQUEST_CLOSED' using errcode = 'P0001';
  end if;

  select array_agg(k.id order by k.id) into v_tickets
    from match_tickets k where k.request_id = v_q.id and k.status = 'reserved';
  v_released := app.ticket_release(v_tickets, 'withdrawn', null, v_q.id);
  update match_requests set status = 'withdrawn', decided_at = now() where id = v_q.id;
  perform app.match_event(v_q.match_id, v_q.venue_id, 'withdrawn', 'guest', null, v_q.id, null, '{}'::jsonb);

  return jsonb_build_object('request_id', v_q.id, 'status', 'withdrawn', 'duplicate', false,
                            'tickets_released', v_released);
end $match_withdraw_0261$;

comment on function app.match_withdraw(uuid) is
  '0261 (db.md §4.6.5). Guest: withdraws the caller''s pending request, its reserved tickets released. Refusals: the match_guest codes, INVALID_ARGUMENT, REQUEST_NOT_FOUND (not the caller''s: unknown and someone else''s read the same), REQUEST_CLOSED (approved, declined, expired); already withdrawn -> duplicate. Under the branch mutex. Returns {request_id, status, duplicate, tickets_released}.';

revoke all on function app.match_withdraw(uuid) from public, anon;
grant execute on function app.match_withdraw(uuid) to authenticated;

-- The organiser answers a request. The approve branch (L2) is written before
-- the decline branch (L1): the lock gate reads the body in text order.
create or replace function app.match_decide(p_request_id uuid, p_approve boolean) returns jsonb
language plpgsql security definer set search_path = public as $match_decide_0261$
declare
  v_p        profiles%rowtype := app.match_guest(false);
  v_uid      uuid := v_p.id;
  v_q        match_requests%rowtype;
  v_m        matches%rowtype;
  v_friends  text[];
  v_code     text;
  v_tickets  uuid[];
  v_taken    jsonb;
  v_status   text;
  v_released int := 0;
  v_n        int;
begin
  -- 2.
  if p_request_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_request_id';
  elsif p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_approve';
  end if;

  -- 3. Unknown, or a match the caller has no part in.
  select * into v_q from match_requests q where q.id = p_request_id;
  if found then
    select * into v_m from matches where id = v_q.match_id;
  end if;
  if v_q.id is null or app.match_visibility(v_m, v_uid, null, null) is distinct from 'participant' then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 4.
  if v_m.organiser_id is distinct from v_uid then
    raise exception 'NOT_ORGANISER' using errcode = 'P0001';
  end if;

  -- 5.
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
    -- 8. R10.
    if not coalesce((select vs.matches_enabled from venue_settings vs where vs.venue_id = v_m.venue_id), false) then
      raise exception 'MATCHES_OFF' using errcode = 'P0001';
    end if;
    perform app.match_raise(app.match_join_refusal(v_m, v_q.guest_id, v_friends, 'numbers'));
    v_code := coalesce(app.match_eligibility(v_q.guest_id, true),
                       split_part(app.match_join_refusal(v_m, v_q.guest_id, v_friends, 'approve'), '|', 1));
    if nullif(v_code, '') is not null then
      raise exception 'REQUESTER_INELIGIBLE' using errcode = 'P0001', detail = v_code;
    end if;
    perform app.assert_not_degraded_for(v_m.start_at, v_m.venue_id);

    -- L2, then 4, 6, the numbers and the requester again.
    v_m := app.match_lock(v_m.id);
    select * into v_q from match_requests q where q.id = p_request_id;
    if v_m.organiser_id is distinct from v_uid then
      raise exception 'NOT_ORGANISER' using errcode = 'P0001';
    end if;
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
    perform app.match_event(v_m.id, v_m.venue_id, 'approved', 'guest', null, v_q.id, null, '{}'::jsonb);
    select count(*) into v_n from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
    perform app.match_event(v_m.id, v_m.venue_id, 'joined', 'guest', ((v_taken->'seat_ids')->>0)::uuid, v_q.id,
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
    return jsonb_build_object('request_id', v_q.id, 'status', 'approved', 'duplicate', false,
                              'seats', v_taken->'seats', 'match_status', v_status, 'tickets_released', 0);
  end if;

  -- 7. Decline: L1, then 4 and 6 again.
  perform set_config('app.venue_id', v_m.venue_id::text, true);
  perform app.lock_match_venue(v_m.venue_id);
  select * into v_m from matches where id = v_m.id;
  select * into v_q from match_requests q where q.id = p_request_id;
  if v_m.organiser_id is distinct from v_uid then
    raise exception 'NOT_ORGANISER' using errcode = 'P0001';
  end if;
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
  perform app.match_event(v_m.id, v_m.venue_id, 'declined', 'guest', null, v_q.id, null, '{}'::jsonb);
  return jsonb_build_object('request_id', v_q.id, 'status', 'declined', 'duplicate', false, 'seats', '[]'::jsonb,
                            'match_status', v_m.status, 'tickets_released', v_released);
end $match_decide_0261$;

comment on function app.match_decide(uuid, boolean) is
  '0261 (db.md §4.6.6). Guest (the organiser): approves or declines a request. Refusals in order: the match_guest codes (p_act false); INVALID_ARGUMENT; REQUEST_NOT_FOUND (unknown, or not a participant of its match); NOT_ORGANISER; the same answer again -> duplicate; REQUEST_CLOSED. Approve: MATCHES_OFF; MATCH_CLOSED / MATCH_FULL; REQUESTER_INELIGIBLE (detail the first code the requester now fails: ACCOUNT_REQUIRED, PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, GENDER_REQUIRED, MATCH_GENDER_MISMATCH, MATCH_UNAVAILABLE, MATCH_ALREADY_IN, MATCH_LIMIT_REACHED, MATCH_TIME_CLASH; the request stays pending); DEGRADED_LOCKOUT; then under L2 everything again; the request''s reserved tickets seat the requester at once (a refill as in match_join), events approved and joined, the fourth carrier books. Decline: under the branch mutex; tickets released. Returns {request_id, status, duplicate, seats, match_status, tickets_released}.';

revoke all on function app.match_decide(uuid, boolean) from public, anon;
grant execute on function app.match_decide(uuid, boolean) to authenticated;

-- Leave: every in seat of the caller here (account, friend, linked desk) and
-- their pending request, or the seats named. Filling or waiting: tickets
-- back. Booked, before the start: a late leave, the ticket held until a
-- refill or forfeited at the start.
create or replace function app.match_leave(p_match_id uuid, p_seat_ids uuid[] default null) returns jsonb
language plpgsql security definer set search_path = public as $match_leave_0261$
declare
  v_p        profiles%rowtype := app.match_guest(false);
  v_uid      uuid := v_p.id;
  v_m        matches%rowtype;
  v_all      uuid[];
  v_targets  uuid[];
  v_q        match_requests%rowtype;
  v_tickets  uuid[];
  v_paired   uuid[];
  v_first    uuid;
  v_released int := 0;
  v_locked   int := 0;
  v_withdrew boolean := false;
  v_changed  boolean := false;
  v_n        int;
  v_left     jsonb := '[]'::jsonb;
  v_pass     int;
begin
  -- 2.
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  end if;
  if p_seat_ids is not null and cardinality(p_seat_ids) = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_ids';
  end if;

  -- 3.
  select * into v_m from matches where id = p_match_id;
  if not found or app.match_visibility(v_m, v_uid, null, null) is distinct from 'participant' then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- 4-7 once unlocked, then once more under the branch mutex (L1).
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform set_config('app.venue_id', v_m.venue_id::text, true);
      perform app.lock_match_venue(v_m.venue_id);
      select * into v_m from matches where id = p_match_id;
    end if;
    select coalesce(array_agg(s.id order by s.seat_no, s.id), '{}'::uuid[]) into v_all
      from match_seats s where s.match_id = v_m.id and s.guest_id = v_uid and s.status = 'in';
    if p_seat_ids is not null then
      if exists (select 1 from unnest(p_seat_ids) x where not (x = any (v_all))) then
        raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
      end if;
      select array_agg(distinct x) into v_targets from unnest(p_seat_ids) x;
      v_q := null;
    else
      v_targets := v_all;
      select * into v_q from match_requests q
       where q.match_id = v_m.id and q.guest_id = v_uid and q.status = 'pending';
    end if;
    -- Nothing left to leave: a replay.
    if cardinality(v_targets) = 0 and v_q.id is null then
      return jsonb_build_object('match_id', v_m.id, 'match_status', v_m.status, 'left', '[]'::jsonb,
                                'request_withdrawn', false, 'organiser_changed', false, 'duplicate', true,
                                'tickets_released', 0, 'tickets_locked', 0);
    end if;
    if v_m.status in ('played', 'no_show', 'cancelled', 'bumped', 'expired') then
      raise exception 'MATCH_CLOSED' using errcode = 'P0001';
    end if;
    if v_m.status = 'booked' and now() >= v_m.start_at and cardinality(v_targets) > 0 then
      raise exception 'SEAT_STARTED' using errcode = 'P0001';
    end if;
    -- Friends' seats never stay without their holder's account seat.
    if exists (select 1 from match_seats s where s.id = any (v_targets) and s.kind = 'account')
       and exists (select 1 from match_seats s where s.id = any (v_all) and s.kind = 'friend'
                      and not (s.id = any (v_targets))) then
      raise exception 'SEAT_HOLDER_REQUIRED' using errcode = 'P0001';
    end if;
  end loop;

  select s.id into v_first from match_seats s
   where s.id = any (v_targets) order by (s.kind = 'account') desc, s.seat_no, s.id limit 1;

  if cardinality(v_targets) > 0 then
    if v_m.status in ('filling', 'awaiting_court') then
      select array_agg(s.ticket_id order by s.seat_no, s.id) filter (where s.ticket_id is not null),
             array_agg(s.id order by s.seat_no, s.id) filter (where s.ticket_id is not null)
        into v_tickets, v_paired
        from match_seats s where s.id = any (v_targets);
      v_released := app.ticket_release(v_tickets, 'left', v_paired);
      update match_seats set status = 'left', ended_at = now(), end_reason = 'left' where id = any (v_targets);
      if v_m.status = 'awaiting_court' then
        update matches set status = 'filling', updated_at = now() where id = v_m.id;
      end if;
      select count(*) into v_n from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
      perform app.match_event(v_m.id, v_m.venue_id, 'left', 'guest', v_first, null, 'left',
                              jsonb_build_object('seats', to_jsonb(v_targets), 'seats_taken', v_n));
    else
      -- Booked, before the start: the seat stays a carrier until a refill.
      update match_seats set status = 'left_late', ended_at = now(), end_reason = 'left' where id = any (v_targets);
      select count(*) into v_locked from match_seats s join match_tickets k on k.seat_id = s.id
       where s.id = any (v_targets) and k.status = 'in_use';
      select count(*) into v_n from app.match_carriers(v_m.id) c where c.status in ('in', 'attended');
      perform app.match_event(v_m.id, v_m.venue_id, 'left_late', 'guest', v_first, null, 'left',
                              jsonb_build_object('seats', to_jsonb(v_targets), 'seats_taken', v_n));
    end if;
    select coalesce(jsonb_agg(jsonb_build_object('seat_id', s.id, 'status', s.status) order by s.seat_no, s.id),
                    '[]'::jsonb)
      into v_left from match_seats s where s.id = any (v_targets);
  end if;

  if v_q.id is not null then
    select array_agg(k.id order by k.id) into v_tickets
      from match_tickets k where k.request_id = v_q.id and k.status = 'reserved';
    v_released := v_released + app.ticket_release(v_tickets, 'withdrawn', null, v_q.id);
    update match_requests set status = 'withdrawn', decided_at = now() where id = v_q.id;
    perform app.match_event(v_m.id, v_m.venue_id, 'withdrawn', 'guest', null, v_q.id, null, '{}'::jsonb);
    v_withdrew := true;
  end if;

  if cardinality(v_targets) > 0 then
    v_changed := app.match_recompute_organiser(v_m.id);
  end if;

  return jsonb_build_object(
    'match_id', v_m.id, 'match_status', (select mt.status from matches mt where mt.id = v_m.id),
    'left', v_left, 'request_withdrawn', v_withdrew, 'organiser_changed', coalesce(v_changed, false),
    'duplicate', false, 'tickets_released', v_released, 'tickets_locked', v_locked);
end $match_leave_0261$;

comment on function app.match_leave(uuid, uuid[]) is
  '0261 (db.md §4.6.7). Guest: leaves the caller''s in seats here (all of them and their pending request when p_seat_ids is NULL). Refusals: the match_guest codes (p_act false); INVALID_ARGUMENT; MATCH_NOT_FOUND (unknown, or not a participant); SEAT_NOT_FOUND (an id not one of the caller''s in seats here); nothing left to leave -> duplicate; MATCH_CLOSED (ended); SEAT_STARTED (booked and started); SEAT_HOLDER_REQUIRED (the account seat without its friends); checked again under the branch mutex. Filling or waiting: seats left, tickets released, a waiting match back to filling, event left. Booked before the start: seats left_late, tickets held until a refill (event left_late). The pending request is withdrawn. Then app.match_recompute_organiser (OM-34). Returns {match_id, match_status, left[], request_withdrawn, organiser_changed, duplicate, tickets_released, tickets_locked}.';

revoke all on function app.match_leave(uuid, uuid[]) from public, anon;
grant execute on function app.match_leave(uuid, uuid[]) to authenticated;

-- OM-44: the organiser removes a player (and their friends' seats with their
-- account seat) while filling; the player cannot rejoin this match.
create or replace function app.match_remove_player(p_match_id uuid, p_seat_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $match_remove_player_0261$
declare
  v_p        profiles%rowtype := app.match_guest(false);
  v_uid      uuid := v_p.id;
  v_m        matches%rowtype;
  v_s        match_seats%rowtype;
  v_targets  uuid[];
  v_tickets  uuid[];
  v_paired   uuid[];
  v_released int;
  v_pass     int;
begin
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  elsif p_seat_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_seat_id';
  end if;
  select * into v_m from matches where id = p_match_id;
  if not found or app.match_visibility(v_m, v_uid, null, null) is distinct from 'participant' then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform set_config('app.venue_id', v_m.venue_id::text, true);
      perform app.lock_match_venue(v_m.venue_id);
      select * into v_m from matches where id = p_match_id;
    end if;
    if v_m.organiser_id is distinct from v_uid then
      raise exception 'NOT_ORGANISER' using errcode = 'P0001';
    end if;
    select * into v_s from match_seats s
     where s.id = p_seat_id and s.match_id = v_m.id and s.status = 'in' and s.kind in ('account', 'friend')
       and s.guest_id is distinct from v_uid;
    if not found then
      raise exception 'SEAT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_m.status = 'booked' then
      raise exception 'MATCH_BOOKED' using errcode = 'P0001';
    end if;
    if v_m.status not in ('filling', 'awaiting_court') then
      raise exception 'MATCH_CLOSED' using errcode = 'P0001';
    end if;
  end loop;

  -- The account seat takes its holder's friend seats with it.
  select array_agg(s.id order by (s.kind = 'account') desc, s.seat_no, s.id),
         array_agg(s.ticket_id order by s.seat_no, s.id) filter (where s.ticket_id is not null),
         array_agg(s.id order by s.seat_no, s.id) filter (where s.ticket_id is not null)
    into v_targets, v_tickets, v_paired
    from match_seats s
   where s.match_id = v_m.id and s.status = 'in'
     and (s.id = v_s.id or (v_s.kind = 'account' and s.kind = 'friend' and s.guest_id = v_s.guest_id));
  v_released := app.ticket_release(v_tickets, 'removed_by_organiser', v_paired);
  update match_seats set status = 'removed', ended_at = now(), end_reason = 'removed_by_organiser'
   where id = any (v_targets);
  if v_s.kind = 'account' then
    insert into match_exclusions (match_id, guest_id, venue_id, reason)
    values (v_m.id, v_s.guest_id, v_m.venue_id, 'removed_by_organiser')
    on conflict (match_id, guest_id) do nothing;
  end if;
  if v_m.status = 'awaiting_court' then
    update matches set status = 'filling', updated_at = now() where id = v_m.id;
  end if;
  perform app.match_event(v_m.id, v_m.venue_id, 'removed', 'guest', v_s.id, null, 'removed_by_organiser',
                          jsonb_build_object('seats', to_jsonb(v_targets)));

  return jsonb_build_object('match_id', v_m.id, 'match_status', (select mt.status from matches mt where mt.id = v_m.id),
                            'removed', to_jsonb(v_targets), 'tickets_released', v_released);
end $match_remove_player_0261$;

comment on function app.match_remove_player(uuid, uuid) is
  '0261 (db.md §4.6.8, OM-44). Guest (the organiser): removes another holder''s account seat (with their friend seats) or one friend seat while the match fills or waits. Refusals: the match_guest codes (p_act false); INVALID_ARGUMENT; MATCH_NOT_FOUND (not a participant); NOT_ORGANISER; SEAT_NOT_FOUND (not an in account or friend seat of another holder here; the organiser''s own and desk seats are out of reach); MATCH_BOOKED; MATCH_CLOSED; checked again under the branch mutex. Tickets released; the account seat''s holder is excluded from the match (match_exclusions); a waiting match back to filling; event removed. Returns {match_id, match_status, removed[], tickets_released}.';

revoke all on function app.match_remove_player(uuid, uuid) from public, anon;
grant execute on function app.match_remove_player(uuid, uuid) to authenticated;

-- The organiser calls it off before the court is booked.
create or replace function app.match_cancel(p_match_id uuid, p_reason text default null) returns jsonb
language plpgsql security definer set search_path = public as $match_cancel_0261$
declare
  v_p    profiles%rowtype := app.match_guest(false);
  v_uid  uuid := v_p.id;
  v_m    matches%rowtype;
  v_pass int;
begin
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  end if;
  if p_reason is not null and p_reason not in ('not_enough_players', 'plans_changed', 'other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;
  select * into v_m from matches where id = p_match_id;
  if not found or app.match_visibility(v_m, v_uid, null, null) is distinct from 'participant' then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;

  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform set_config('app.venue_id', v_m.venue_id::text, true);
      perform app.lock_match_venue(v_m.venue_id);
      select * into v_m from matches where id = p_match_id;
    end if;
    if v_m.organiser_id is distinct from v_uid then
      raise exception 'NOT_ORGANISER' using errcode = 'P0001';
    end if;
    if v_m.status = 'cancelled' and v_m.ended_reason = 'organiser_cancelled' then
      return jsonb_build_object('match_id', v_m.id, 'status', 'cancelled', 'duplicate', true);
    end if;
    if v_m.status = 'booked' then
      raise exception 'MATCH_BOOKED' using errcode = 'P0001';
    end if;
    if v_m.status not in ('filling', 'awaiting_court') then
      raise exception 'MATCH_CLOSED' using errcode = 'P0001';
    end if;
  end loop;

  perform app.match_end(v_m.id, 'cancelled', 'organiser_cancelled', 'guest');
  perform app.write_audit('match.cancel', 'matches', v_m.id::text, null,
                          jsonb_build_object('status', 'cancelled'), p_reason);
  return jsonb_build_object('match_id', v_m.id, 'status', 'cancelled', 'duplicate', false);
end $match_cancel_0261$;

comment on function app.match_cancel(uuid, text) is
  '0261 (db.md §4.6.9). Guest (the organiser): cancels a filling or waiting match (app.match_end organiser_cancelled: every seat''s tickets back, requests closed). Refusals: the match_guest codes (p_act false); INVALID_ARGUMENT (p_reason outside not_enough_players, plans_changed, other); MATCH_NOT_FOUND; NOT_ORGANISER; already cancelled by the organiser -> duplicate; MATCH_BOOKED; MATCH_CLOSED; checked again under the branch mutex. Audited as match.cancel with the reason. Returns {match_id, status, duplicate}.';

revoke all on function app.match_cancel(uuid, text) from public, anon;
grant execute on function app.match_cancel(uuid, text) to authenticated;

-- A preset quick message (OM-17). No lock: an append-only event.
create or replace function app.match_post_message(p_match_id uuid, p_code text) returns jsonb
language plpgsql security definer set search_path = public as $match_post_message_0261$
declare
  v_p    profiles%rowtype := app.match_guest(false);
  v_uid  uuid := v_p.id;
  v_m    matches%rowtype;
  v_seat uuid;
  v_id   bigint;
begin
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  end if;
  if p_code is null or p_code not in ('on_my_way', 'running_late', 'cant_make_it', 'bring_balls') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_code';
  end if;
  select * into v_m from matches where id = p_match_id;
  if not found or app.match_visibility(v_m, v_uid, null, null) is distinct from 'participant' then
    raise exception 'MATCH_NOT_FOUND' using errcode = 'P0001';
  end if;
  select s.id into v_seat
    from app.match_carriers(v_m.id) c join match_seats s on s.id = c.seat_id
   where s.guest_id = v_uid
   order by (s.kind = 'account') desc, s.seat_no
   limit 1;
  if v_seat is null and v_m.organiser_id is distinct from v_uid then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_m.status not in ('filling', 'awaiting_court', 'booked') or now() >= v_m.end_at then
    raise exception 'MATCH_CLOSED' using errcode = 'P0001';
  end if;

  select e.id into v_id from match_events e
   where e.match_id = v_m.id and e.type = 'message' and e.actor_guest_id = v_uid and e.code = p_code
     and e.at > now() - interval '10 minutes'
   order by e.id desc limit 1;
  if v_id is not null then
    return jsonb_build_object('event_id', v_id, 'duplicate', true);
  end if;
  if (select count(*) from match_events e
       where e.match_id = v_m.id and e.type = 'message' and e.actor_guest_id = v_uid) >= 12 then
    raise exception 'RATE_LIMITED' using errcode = 'P0001';
  end if;

  v_id := app.match_event(v_m.id, v_m.venue_id, 'message', 'guest', v_seat, null, p_code, '{}'::jsonb);
  return jsonb_build_object('event_id', v_id, 'duplicate', false);
end $match_post_message_0261$;

comment on function app.match_post_message(uuid, text) is
  '0261 (db.md §4.6.10, OM-17). Guest: posts a preset message (on_my_way, running_late, cant_make_it, bring_balls) to the match. Refusals: the match_guest codes (p_act false); INVALID_ARGUMENT; MATCH_NOT_FOUND (not a participant); FORBIDDEN (no carrier seat and not the organiser); MATCH_CLOSED (not live, or over); the same code within 10 minutes -> duplicate; RATE_LIMITED past 12 messages in the match. Event message; the seat holders and the organiser get msg_<code>. Returns {event_id, duplicate}.';

revoke all on function app.match_post_message(uuid, text) from public, anon;
grant execute on function app.match_post_message(uuid, text) to authenticated;

-- A report goes to the branch's managers and owners (OM-27, R5).
create or replace function app.match_report(p_match_id uuid, p_reason text, p_seat_id uuid default null,
                                            p_request_id uuid default null, p_block boolean default false)
returns jsonb
language plpgsql security definer set search_path = public as $match_report_0261$
declare
  v_p       profiles%rowtype := app.match_guest(false);
  v_uid     uuid := v_p.id;
  v_m       matches%rowtype;
  v_target  uuid;
  v_id      uuid;
  v_blocked boolean;
begin
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  elsif p_reason is null or p_reason not in ('offensive_name', 'abusive_behaviour', 'harassment', 'unsafe_play',
                                             'no_show', 'other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  elsif p_block is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_block';
  end if;
  v_target := app.match_report_target(p_match_id, p_seat_id, p_request_id, v_uid);
  if v_target is null then
    raise exception 'REPORT_TARGET_INVALID' using errcode = 'P0001';
  end if;
  select * into v_m from matches where id = p_match_id;

  select r.id into v_id from match_reports r
   where r.reporter_id = v_uid and r.reported_id = v_target and r.match_id = v_m.id;
  if v_id is null then
    if (select count(*) from match_reports r
         where r.reporter_id = v_uid and r.created_at > now() - interval '24 hours') >= 10 then
      raise exception 'RATE_LIMITED' using errcode = 'P0001';
    end if;
    perform set_config('app.venue_id', v_m.venue_id::text, true);
    begin
      insert into match_reports (venue_id, match_id, reporter_id, reported_id, seat_id, request_id, reason)
      values (v_m.venue_id, v_m.id, v_uid, v_target, p_seat_id, p_request_id, p_reason)
      returning id into v_id;
    exception when unique_violation then
      select r.id into v_id from match_reports r
       where r.reporter_id = v_uid and r.reported_id = v_target and r.match_id = v_m.id;
      if p_block then
        insert into match_blocks (blocker_id, blocked_id) values (v_uid, v_target)
        on conflict (blocker_id, blocked_id) do nothing;
      end if;
      return jsonb_build_object('report_id', v_id, 'duplicate', true,
                                'blocked', exists (select 1 from match_blocks b
                                                    where b.blocker_id = v_uid and b.blocked_id = v_target));
    end;
    if p_block then
      insert into match_blocks (blocker_id, blocked_id) values (v_uid, v_target)
      on conflict (blocker_id, blocked_id) do nothing;
    end if;
    -- The branch's managers and owners hear of it; the push names nobody. A
    -- sandbox (App Review) match reaches no one (D-10).
    if not v_m.sandbox then
      begin
        perform app.notify_staff(app.staff_ids_with_roles(v_m.venue_id, array['manager', 'owner']::staff_role[]),
                                 'staff_info',
                                 jsonb_build_object('route', 'staff', 'id', v_id::text,
                                                    'title_key', 'match_report_new', 'params', '{}'::jsonb),
                                 'match_report:' || v_id::text);
      exception when others then
        null;
      end;
    end if;
    return jsonb_build_object('report_id', v_id, 'duplicate', false,
                              'blocked', exists (select 1 from match_blocks b
                                                  where b.blocker_id = v_uid and b.blocked_id = v_target));
  end if;

  -- A report already made: a replay (a block asked for now is still added).
  if p_block then
    insert into match_blocks (blocker_id, blocked_id) values (v_uid, v_target)
    on conflict (blocker_id, blocked_id) do nothing;
  end if;
  return jsonb_build_object('report_id', v_id, 'duplicate', true,
                            'blocked', exists (select 1 from match_blocks b
                                                where b.blocker_id = v_uid and b.blocked_id = v_target));
end $match_report_0261$;

comment on function app.match_report(uuid, text, uuid, uuid, boolean) is
  '0261 (db.md §4.6.11, OM-27, R5, R43). Guest: reports a player of this match (a seat, or a request for the organiser), with a fixed reason; optionally blocks them too. Refusals: the match_guest codes (p_act false); INVALID_ARGUMENT (p_reason outside the six, p_block NULL); REPORT_TARGET_INVALID (not exactly one target, outside this match, not a participant, a typed desk seat, oneself, a request when not the organiser); the same reporter, player and match -> duplicate; RATE_LIMITED past 10 reports in 24 hours. The branch''s managers and owners get match_report_new (notify_staff, never for a sandbox match, never failing the report). Returns {report_id, duplicate, blocked}.';

revoke all on function app.match_report(uuid, text, uuid, uuid, boolean) from public, anon;
grant execute on function app.match_report(uuid, text, uuid, uuid, boolean) to authenticated;

-- A block hides future matches both ways and refuses future joins, requests
-- and approvals between the two; it removes nobody from a shared match.
create or replace function app.match_block(p_match_id uuid, p_seat_id uuid default null, p_request_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $match_block_0261$
declare
  v_p      profiles%rowtype := app.match_guest(false);
  v_uid    uuid := v_p.id;
  v_target uuid;
  v_id     uuid;
begin
  if p_match_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_match_id';
  end if;
  v_target := app.match_report_target(p_match_id, p_seat_id, p_request_id, v_uid);
  if v_target is null then
    raise exception 'BLOCK_TARGET_INVALID' using errcode = 'P0001';
  end if;
  select b.id into v_id from match_blocks b where b.blocker_id = v_uid and b.blocked_id = v_target;
  if v_id is not null then
    return jsonb_build_object('block_id', v_id, 'duplicate', true);
  end if;
  insert into match_blocks (blocker_id, blocked_id) values (v_uid, v_target)
  on conflict (blocker_id, blocked_id) do nothing
  returning id into v_id;
  if v_id is null then
    select b.id into v_id from match_blocks b where b.blocker_id = v_uid and b.blocked_id = v_target;
    return jsonb_build_object('block_id', v_id, 'duplicate', true);
  end if;
  return jsonb_build_object('block_id', v_id, 'duplicate', false);
end $match_block_0261$;

comment on function app.match_block(uuid, uuid, uuid) is
  '0261 (db.md §4.6.11, OM-27). Guest: blocks the player behind a seat (or a request, for the organiser) of this match: their future matches are hidden from each other and joins, requests and approvals between them refused (MATCH_UNAVAILABLE); nobody leaves a match they share. Refusals: the match_guest codes (p_act false); INVALID_ARGUMENT; BLOCK_TARGET_INVALID (the report target rules); the same pair again -> duplicate. Returns {block_id, duplicate}.';

revoke all on function app.match_block(uuid, uuid, uuid) from public, anon;
grant execute on function app.match_block(uuid, uuid, uuid) to authenticated;

create or replace function app.match_unblock(p_block_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $match_unblock_0261$
declare
  v_p   profiles%rowtype := app.match_guest(false);
  v_uid uuid := v_p.id;
  v_n   int;
begin
  if p_block_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_block_id';
  end if;
  delete from match_blocks b where b.id = p_block_id and b.blocker_id = v_uid;
  get diagnostics v_n = row_count;
  return jsonb_build_object('unblocked', v_n > 0);
end $match_unblock_0261$;

comment on function app.match_unblock(uuid) is
  '0261 (db.md §4.6.11). Guest: removes one of the caller''s own blocks; {unblocked: true|false}. Refusals: the match_guest codes (p_act false), INVALID_ARGUMENT.';

revoke all on function app.match_unblock(uuid) from public, anon;
grant execute on function app.match_unblock(uuid) to authenticated;
