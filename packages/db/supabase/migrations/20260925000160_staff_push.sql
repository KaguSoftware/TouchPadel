-- 0160 staff_push — work notifications to staff phones through the existing outbox.
--
-- Feature: protocols and the staff phone, lane G
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.4, §2.21; plan §6.6).
-- Depends on: nothing. protocols_engine_rpcs (A), checklists and
-- shopping_purchases (C), release_post_launch (E) and price_promo (F) send
-- through app.notify_staff.
-- Re-runnable: create or replace, guarded constraint work.
--
-- DEPLOY ORDER. send-push must know the four staff kinds before this reaches
-- hosted: a kind it does not know is terminal there (send-push/index.ts). Its
-- change is its own commit and push, ahead of this one (§1.6 step 2).
--
-- What this adds:
--   1. notification_outbox.kind admits staff_task, staff_decide, staff_decided
--      and staff_info (latest list 0075).
--   2. app.staff_ids_with_roles and app.notify_staff, the one way a staff row
--      enters the outbox. Staff already have a profiles row (handle_new_user,
--      0004), so profile_id = staff.id and the sender resolves the token and
--      language exactly as it does for a guest.
--   3. Re-issues: set_staff_active clears the push token on the way down (0081
--      ended the sessions but left the token, so a leaver's phone kept getting
--      work pushes); submit_staff_request tells the owners; decide_staff_request
--      tells the requester. Signatures, guards and audit rows unchanged.
--
-- The payload is {route, id, title_key, params, dedupe?} and nothing else,
-- with params {step?: {en, ar}, title?, name?}: never money, a phone number or
-- a candidate name. notify_staff refuses any other key.
--
-- covered by packages/db/tests/staff-push.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The kind CHECK, widened. 0075 named it notification_outbox_kind_check.
--    Dropped and re-added NOT VALID in one statement's worth of lock, then
--    validated under the lighter lock (every existing row is a guest kind).
-- ---------------------------------------------------------------------------
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                  'booking_no_show', 'test',
                  'staff_task', 'staff_decide', 'staff_decided', 'staff_info'))
  not valid;

do $validate_kind_check_0160$
begin
  if exists (select 1 from pg_constraint
              where conname = 'notification_outbox_kind_check'
                and conrelid = 'public.notification_outbox'::regclass
                and not convalidated) then
    alter table notification_outbox validate constraint notification_outbox_kind_check;
  end if;
end $validate_kind_check_0160$;

-- ---------------------------------------------------------------------------
-- 2. app.staff_ids_with_roles — who holds a role at a venue. Owners count at
--    every venue (they hold no staff_venues rows, 0123), so a venue with no
--    manager still has a decider to tell.
-- ---------------------------------------------------------------------------
create or replace function app.staff_ids_with_roles(p_venue uuid, p_roles staff_role[])
returns uuid[]
language sql stable security definer set search_path = public as $staff_ids_with_roles_0160$
  select coalesce(array_agg(s.id order by s.id), '{}'::uuid[])
    from staff s
   where s.is_active
     and s.role = any(p_roles)
     and (s.role = 'owner'
          or exists (select 1
                       from staff_venues sv
                       join venues v on v.id = sv.venue_id and v.is_active
                      where sv.staff_id = s.id
                        and sv.venue_id = p_venue))
$staff_ids_with_roles_0160$;

comment on function app.staff_ids_with_roles(uuid, staff_role[]) is
  'staff_push (§2.4). Internal: the active staff holding one of p_roles who are members of p_venue (an active venue); owners count at every venue. The recipient list for app.notify_staff.';

revoke all on function app.staff_ids_with_roles(uuid, staff_role[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.notify_staff — queue one push per recipient.
--
--    Skips NULL ids, anyone who is not active staff, and the caller (nobody is
--    told about their own act). A recipient with no push token still gets a
--    row, which send-push closes as NO_PUSH_TOKEN, exactly as for a guest who
--    switched notifications off: the row is the record that the push was due.
--    With p_dedupe, a recipient who got a row with the same dedupe value in
--    the last 15 minutes is skipped (the driver's "new items to buy" when the
--    list grows line by line; a requester's burst of the same staff request).
--
--    The three lists are _shared/staff-push.json's; tests/staff-push.test.ts
--    compares them. Adding one means that file, send-push/staffStrings.ts and
--    this function in the same change, with send-push deployed first.
-- ---------------------------------------------------------------------------
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0160$
declare
  c_kinds      constant text[] := array['staff_task', 'staff_decide', 'staff_decided', 'staff_info'];
  c_title_keys constant text[] := array[
    'step_open', 'step_submitted', 'step_approved', 'step_sent_back', 'step_stopped',
    'run_stopped', 'run_live', 'launch_not_ready', 'apply_not_ready', 'review_ready',
    'request_submitted', 'request_approved', 'request_rejected', 'shopping_new',
    'purchase_to_receive'];
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
end $notify_staff_0160$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21). Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. set_staff_active — 0081 verbatim, plus the push token cleared on the way
--    down. The sessions end (0081), and now the phone stops receiving work
--    pushes too; a new sign-in writes a fresh token.
-- ---------------------------------------------------------------------------
create or replace function app.set_staff_active(
  p_staff_id    uuid,
  p_active      boolean,
  p_reason_code text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_staff_active_0160$
declare
  v_before  staff%rowtype;
  v_after   staff%rowtype;
  v_revoked integer := 0;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_staff_id = auth.uid() then
    raise exception 'CANNOT_EDIT_SELF' using errcode = 'P0001',
      hint = 'another owner must deactivate your own account';
  end if;

  select * into v_before from staff where id = p_staff_id for update;
  if not found then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_before.role = 'owner' and not coalesce(p_active, false)
     and app.other_active_owners(p_staff_id) = 0 then
    raise exception 'LAST_OWNER' using errcode = 'P0001',
      hint = 'promote another owner first';
  end if;

  update staff
     set is_active = coalesce(p_active, false),
         -- A deactivated account must not keep a usable authorisation PIN.
         pin_hash = case when coalesce(p_active, false) then pin_hash else null end
   where id = p_staff_id
   returning * into v_after;

  -- 0081/SEC-35. Only on the way DOWN: reactivating somebody must not punish
  -- whatever session they happen to have, and there is nothing to revoke.
  if not v_after.is_active then
    v_revoked := app.revoke_user_sessions(p_staff_id);
    -- staff_push: and no more pushes to the phone they leave with.
    update profiles set expo_push_token = null
     where id = p_staff_id and expo_push_token is not null;
  end if;

  perform app.write_audit('staff.active_set', 'staff', p_staff_id::text,
                          jsonb_build_object('is_active', v_before.is_active),
                          jsonb_build_object('is_active', v_after.is_active,
                                             'sessions_revoked', v_revoked),
                          p_reason_code);

  return jsonb_build_object('id', v_after.id, 'role', v_after.role,
                            'is_active', v_after.is_active,
                            'sessions_revoked', v_revoked);
end $set_staff_active_0160$;

comment on function app.set_staff_active(uuid, boolean, text) is
  '0081 = 0051 + SEC-35, + staff_push. Owner-only. Deactivating also nulls the authorisation PIN, REVOKES every session (auth.sessions delete, refresh tokens cascade) and clears profiles.expo_push_token, so a leaver is signed out and gets no more work pushes. An access token already issued stays valid until jwt_expiry.';

revoke all on function app.set_staff_active(uuid, boolean, text) from public, anon;
grant execute on function app.set_staff_active(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. submit_staff_request — 0072 verbatim, plus the owners told
--    (staff_decide / request_submitted, §2.21), once per requester in 15
--    minutes. An owner's own request goes to the other owners: notify_staff
--    skips the caller.
-- ---------------------------------------------------------------------------
create or replace function app.submit_staff_request(
  p_kind       text,
  p_from       date default null,
  p_to         date default null,
  p_amount_iqd int  default null,
  p_note       text default ''
) returns uuid
language plpgsql security definer set search_path = public as $fn_submit_staff_request_0160$
declare
  v_id   uuid;
  v_kind staff_request_kind;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  begin
    v_kind := p_kind::staff_request_kind;
  exception when invalid_text_representation then
    raise exception 'BAD_KIND' using errcode = 'P0001';
  end;

  -- One open ask of a kind at a time: a second pending leave request is
  -- almost always a double submit, and the owner should never have to guess
  -- which of two identical rows is the live one.
  if exists (
    select 1 from staff_requests
     where staff_id = auth.uid() and kind = v_kind and status = 'pending'
  ) then
    raise exception 'REQUEST_ALREADY_PENDING' using errcode = 'P0001';
  end if;

  insert into staff_requests (staff_id, kind, from_date, to_date, amount_iqd, note)
  values (auth.uid(), v_kind, p_from, p_to, p_amount_iqd, coalesce(btrim(p_note), ''))
  returning id into v_id;

  perform app.write_audit(
    'staff_request.submit', 'staff_request', v_id::text, null,
    jsonb_build_object('kind', p_kind, 'from', p_from, 'to', p_to, 'amountIqd', p_amount_iqd));

  -- staff_push: the owners decide (0072), so the owners are told. The kind and
  -- the amount stay off the lock screen; the phone opens the request.
  -- Deduped per requester: REQUEST_ALREADY_PENDING counts pending rows only,
  -- so submit, withdraw, submit again (or one request of each kind) would
  -- otherwise buzz every owner once a round. One push in 15 minutes says this
  -- person is asking; Observe ▸ Requests lists every pending ask. The key
  -- names no kind, so the kind stays out of the outbox too.
  perform app.notify_staff(
    (select coalesce(array_agg(s.id), '{}'::uuid[]) from staff s where s.role = 'owner' and s.is_active),
    'staff_decide',
    jsonb_build_object(
      'route', 'staff-request',
      'id', v_id,
      'title_key', 'request_submitted',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()))),
    'request:' || auth.uid()::text);

  return v_id;
end $fn_submit_staff_request_0160$;

comment on function app.submit_staff_request(text, date, date, int, text) is
  '0072 + staff_push. Any active staff member, for themselves: a leave, shift swap, advance or correction request. Queues staff_decide / request_submitted for every active owner (the caller excepted), at most once per requester in 15 minutes (dedupe request:<requester id>).';

revoke all on function app.submit_staff_request(text, date, date, int, text) from public, anon;
grant execute on function app.submit_staff_request(text, date, date, int, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. decide_staff_request — 0072 verbatim, plus the requester told
--    (staff_decided / request_approved | request_rejected, §2.21).
-- ---------------------------------------------------------------------------
create or replace function app.decide_staff_request(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn_decide_staff_request_0160$
declare
  v_row    staff_requests%rowtype;
  v_status staff_request_status;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_row from staff_requests where id = p_id for update;
  if not found then
    raise exception 'REQUEST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_row.status <> 'pending' then
    raise exception 'REQUEST_NOT_PENDING' using errcode = 'P0001';
  end if;
  if v_row.staff_id = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;

  -- A refusal without a reason is the one decision a person cannot act on,
  -- so it is the one that must carry a note.
  if not p_approve and coalesce(length(btrim(p_note)), 0) = 0 then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_status := case when p_approve then 'approved' else 'rejected' end;

  update staff_requests
     set status        = v_status,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = nullif(btrim(coalesce(p_note, '')), '')
   where id = p_id
   returning * into v_row;

  perform app.write_audit('staff_request.decide', 'staff_request', p_id::text,
                          null, to_jsonb(v_row));

  -- staff_push: the requester hears the answer. The note stays in the app.
  perform app.notify_staff(
    array[v_row.staff_id],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff-request',
      'id', v_row.id,
      'title_key', case when p_approve then 'request_approved' else 'request_rejected' end,
      'params', '{}'::jsonb));

  return to_jsonb(v_row);
end $fn_decide_staff_request_0160$;

comment on function app.decide_staff_request(uuid, boolean, text) is
  '0072 + staff_push. Owner-only, never on their own request; a refusal needs a note. Queues staff_decided / request_approved or request_rejected for the requester.';

revoke all on function app.decide_staff_request(uuid, boolean, text) from public, anon;
grant execute on function app.decide_staff_request(uuid, boolean, text) to authenticated;
