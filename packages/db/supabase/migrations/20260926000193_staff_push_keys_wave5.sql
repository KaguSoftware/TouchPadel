-- 0193 staff_push_keys_wave5 — wave 5's eleven push title keys in
-- app.notify_staff, and the push that tells the waiters a guest called.
--
-- Feature: protocols and the staff phone, wave 5, lane P
-- (docs/design/protocols/wave5-addendum-2026-09-25.md §2.3, §2.1.8, §2.10;
-- Majed's answers #2, #3 (§8 Q3), #6 and #7).
-- Depends on: P's send-push commit (send-push/staffStrings.ts carries the
-- eleven keys' EN and AR copy), deployed on hosted before this reaches it
-- (§1.5 step 2, §7.2): a title key send-push has no copy for is terminal
-- there. staff_roles_assistant_waiter (R: the waiter value the trigger names).
-- Re-issues (§2.10): app.notify_staff from 0169, verbatim but for
-- c_title_keys.
-- Re-runnable: create or replace, drop trigger if exists + create trigger.
--
-- The eleven keys follow marketing_request_answered in c_title_keys, in the
-- order _shared/staff-push.json lists them (tests/staff-push.test.ts compares
-- the two, order included). No kind and no route is added: each key opens
-- Today (route staff) with no id, so the phone's pushRoutes.ts does not
-- change. The params stay the closed {step, title, name}: no amount, no
-- reason, no description, no people and never the name of the person a
-- deduction is against. The guest call's table number rides in `title`.
--
-- THE GUEST CALL (§2.1.8, §8 Q3). An after-insert trigger on waiter_calls
-- queues waiter_call_new for the venue's active waiters, deduplicated per
-- call, with the table's number and nothing about the guest. It swallows its
-- own errors: a push can never fail the guest's call. The cooldown
-- (set_waiter_call_cooldown, 0052) and the one-open-call index still limit
-- how often a table calls.
--
-- covered by packages/db/tests/staff-push-keys.test.ts and staff-push.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.notify_staff — 0169 verbatim, plus wave 5's eleven title keys.
-- ---------------------------------------------------------------------------
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0193$
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
    'content_changes', 'content_declined', 'waiter_call_new'];
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
end $notify_staff_0193$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1) with the role spec''s eleven title keys and by staff_push_keys_wave5 (wave5-addendum §2.3) with wave 5''s eleven. Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.trg_waiter_call_push — a guest's call reaches the venue's waiters
--    (§2.1.8). Internal: the trigger below runs it.
-- ---------------------------------------------------------------------------
create or replace function app.trg_waiter_call_push()
returns trigger
language plpgsql security definer set search_path = public as $trg_waiter_call_push_0193$
begin
  begin
    perform app.notify_staff(
      app.staff_ids_with_roles(new.venue_id, array['waiter']::staff_role[]),
      'staff_task',
      jsonb_build_object(
        'route', 'staff',
        'id', null,
        'title_key', 'waiter_call_new',
        'params', jsonb_build_object(
                    'title', (select t.table_number from cafe_tables t where t.id = new.table_id))),
      'waiter_call:' || new.id::text);
  exception when others then
    -- The guest's call stands whatever happens to its push.
    raise warning 'trg_waiter_call_push failed: % (%)', sqlerrm, sqlstate;
  end;
  return null;
end $trg_waiter_call_push_0193$;

comment on function app.trg_waiter_call_push() is
  'staff_push_keys_wave5 (wave5-addendum §2.1.8, §2.3). Trigger, after insert on waiter_calls: queues staff_task / waiter_call_new for the active waiters at the call''s venue, deduplicated per call (waiter_call:<id>), with the table''s number as the only param and nothing about the guest. Swallows its own errors, so a push never fails the guest''s call.';

revoke all on function app.trg_waiter_call_push() from public, anon, authenticated;

drop trigger if exists waiter_calls_push on waiter_calls;
create trigger waiter_calls_push
  after insert on waiter_calls
  for each row execute function app.trg_waiter_call_push();
