-- 0313_staff_screenshot_report — owner call 2026-10-07: a staff member's screenshot
-- on the phone app is reported to the owner (page, time, who).
--
-- WHAT CHANGES.
--   * app.log_staff_screenshot(p_venue_id, p_route): any active staff of the
--     branch. Writes one audit_log row (action staff.screenshot, entity screen,
--     entity_id the page, after {route}) and queues a screenshot_taken staff
--     push to the owners (the staff member's name only, no page on a lock
--     screen). The owner reads the rows in the Audit log (desktop) and, on the
--     phone, through app.audit_log_page with the prefix staff.screenshot.
--   * app.notify_staff re-issued from 20261006000308 verbatim, plus
--     screenshot_taken last in c_title_keys (_shared/staff-push.json and
--     send-push/staffStrings.ts carry the key and its copy).
-- A repeat of the same page by the same person inside 15 minutes is audited
-- again but pushes once (the dedupe of notify_staff).
set lock_timeout = '3s'; set statement_timeout = '60s';

-- notify_staff: re-issued from 20261006000308_loyalty_earn_redeem.sql:1424
-- verbatim, plus screenshot_taken last in c_title_keys.
create or replace function app.notify_staff(
  p_staff_ids uuid[],
  p_kind      text,
  p_payload   jsonb,
  p_dedupe    text default null
) returns int
language plpgsql security definer set search_path = public as $notify_staff_0313$
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
    'content_changes', 'content_declined', 'waiter_call_new', 'match_report_new',
    'loyalty_gift', 'screenshot_taken'];
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
end $notify_staff_0313$;

comment on function app.notify_staff(uuid[], text, jsonb, text) is
  'staff_push (§2.4, §2.21), re-issued by staff_push_keys (§2.24.1), staff_push_keys_wave5, match_guest_rpcs (0261, match_report_new), loyalty_earn_redeem (0308, loyalty_gift) and staff_screenshot_report (0313, screenshot_taken). Internal: queues one notification_outbox row per recipient (profile_id = staff.id) and nudges send-push. Skips NULLs, inactive staff and the caller; with p_dedupe, a recipient who got the same dedupe value in the last 15 minutes. INVALID_ARGUMENT for a kind, title_key or route outside _shared/staff-push.json, or a payload key outside {route, id, title_key, params, dedupe} / params key outside {step, title, name}. Returns the rows queued.';

revoke all on function app.notify_staff(uuid[], text, jsonb, text) from public, anon, authenticated;

create or replace function app.log_staff_screenshot(p_venue_id uuid, p_route text)
returns void
language plpgsql security definer set search_path = public as $log_staff_screenshot_0313$
declare
  v_route text := left(btrim(coalesce(p_route, '')), 120);
  v_name  text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_venue_id is null
     or not (app.is_staff('owner') or p_venue_id = any(app.staff_venue_ids())) then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;
  if v_route = '' or v_route !~ '^[]A-Za-z0-9/_().[-]+$' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'route';
  end if;

  perform set_config('app.venue_id', p_venue_id::text, true);
  perform app.write_audit('staff.screenshot', 'screen', v_route, null,
                          jsonb_build_object('route', v_route));

  select s.display_name into v_name from staff s where s.id = auth.uid();
  perform app.notify_staff(
    app.staff_ids_with_roles(null, array['owner']::staff_role[]),
    'staff_info',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', 'screenshot_taken',
      'params', jsonb_build_object('name', v_name)),
    'screenshot:' || auth.uid()::text || ':' || v_route);
end $log_staff_screenshot_0313$;

comment on function app.log_staff_screenshot(uuid, text) is
  'Screenshot report (0313). Any active staff member at p_venue_id (the owner at any branch): FORBIDDEN for anyone else, VENUE_MISMATCH for another branch, INVALID_ARGUMENT (hint route) for an empty page or one with characters outside letters, digits and / _ ( ) . [ ] - (120 at most). Audits staff.screenshot / screen / the page with {route}, and queues a screenshot_taken staff push to the owners, the staff member''s name only, one per person and page per 15 minutes. Returns nothing.';


revoke all on function app.log_staff_screenshot(uuid, text) from public, anon;
grant execute on function app.log_staff_screenshot(uuid, text) to authenticated;
