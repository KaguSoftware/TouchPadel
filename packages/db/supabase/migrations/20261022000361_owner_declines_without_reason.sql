-- 0361 owner_declines_without_reason, 2026-10-22 (Majed: "Whenever the owner
-- wants to do a reject operation, they never need a reason, because they are
-- the owner.").
--
-- WHAT CHANGES
--   Every approve-or-refuse decision the owner takes now accepts a refusal
--   with no reason. A note typed in is still kept, still capped, still read
--   by the person it goes to; leaving it empty is simply allowed.
--
--   Owner-only decisions (the owner is the only decider, so the reason check
--   goes):
--     decide_staff_request   reject a leave / advance / correction request
--     decide_content         ask for changes or decline a marketing post
--     decide_deduction       decline a proposed salary deduction
--     decide_recipe_change   decline a head's recipe change
--
--   Shared decisions (others decide too; they still say why, the owner
--   need not), keyed on app.is_staff_at(<venue>, 'owner'):
--     decide_shopping_item   decline a chef's shopping line (head chef, MGMT)
--     decide_step            send back or stop a protocol step (manager, owner)
--     decline_release_idea   decline a new-item idea (team head, MGMT)
--
--   reject_receipt, reject_order_slip and reject_insight already took an
--   optional reason; they are unchanged.
--
-- NOT CHANGED
--   Cancels, voids, refunds, write-offs, undoing a payment, stopping a run
--   from the run page (stop_protocol) and skipping a step keep their reasons:
--   those are corrections to money or records, not a yes/no on someone's ask.
--
-- CONSTRAINTS
--   The table checks that also demanded a non-blank reason on a refusal are
--   dropped (their length caps stay); shopping_items_declined_chk becomes
--   shopping_items_declined_by_chk, "a declined line has a decider" only. The RPCs above are now the only place a
--   reason is required, and only for a decider who is not the owner.
--   protocol_runs_stop_reason_chk goes with them: a run the owner stops at a
--   decision may carry no stop_reason (stop_protocol still demands one).

set lock_timeout = '3s';
set statement_timeout = '60s';

alter table marketing_content_versions drop constraint if exists marketing_content_versions_reason_chk;
alter table salary_deductions          drop constraint if exists salary_deductions_decline_note_chk;
alter table recipe_change_requests     drop constraint if exists recipe_change_requests_reason_chk;
alter table release_ideas              drop constraint if exists release_ideas_decline_reason_chk;
alter table protocol_submissions       drop constraint if exists protocol_submissions_reason_chk;
alter table protocol_runs              drop constraint if exists protocol_runs_stop_reason_chk;

alter table shopping_items drop constraint if exists shopping_items_declined_chk;
do $declined_chk_0361$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'shopping_items_declined_by_chk'
                    and conrelid = 'public.shopping_items'::regclass) then
    alter table shopping_items
      add constraint shopping_items_declined_by_chk
      check (status <> 'declined' or decided_by is not null) not valid;
  end if;
end $declined_chk_0361$;
alter table shopping_items validate constraint shopping_items_declined_by_chk;

-- ---------------------------------------------------------------------------
-- decide_staff_request
-- ---------------------------------------------------------------------------

create or replace function app.decide_staff_request(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $fn_decide_staff_request_0361$
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

  -- 0361: the owner refuses without a reason when they choose; the note
  -- stays optional either way.
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
end $fn_decide_staff_request_0361$;

comment on function app.decide_staff_request(uuid, boolean, text) is
  '0072 + staff_push. Owner-only, never on their own request; the note is optional on either answer (0361). Queues staff_decided / request_approved or request_rejected for the requester.';

revoke all on function app.decide_staff_request(uuid, boolean, text) from public, anon;
grant execute on function app.decide_staff_request(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_content
-- ---------------------------------------------------------------------------

create or replace function app.decide_content(
  p_id       uuid,
  p_version  int,
  p_decision text,
  p_note     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_content_0361$
declare
  v_row  marketing_content%rowtype;
  v_ver  marketing_content_versions%rowtype;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from marketing_content where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if p_decision is null or p_decision not in ('approve','changes','decline') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'decision';
  end if;
  -- Only the version the owner is looking at, and only while it is open.
  select * into v_ver from marketing_content_versions
   where content_id = p_id and version = p_version and decision is null and superseded_at is null
   for update;
  if v_row.status <> 'waiting' or p_version is distinct from v_row.current_version or not found then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if auth.uid() = v_row.author_id or auth.uid() = v_ver.submitted_by then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  -- 0361: the owner's note is optional on every decision.

  update marketing_content_versions
     set decision = p_decision, decided_by = auth.uid(), decided_at = now(), decision_note = v_note
   where id = v_ver.id
   returning * into v_ver;

  update marketing_content
     set status     = case p_decision when 'approve' then 'approved'
                                      when 'changes' then 'changes'
                                      else 'declined' end,
         decided_by = case when p_decision in ('approve','decline') then auth.uid() end,
         decided_at = case when p_decision in ('approve','decline') then v_ver.decided_at end,
         updated_at = now()
   where id = p_id
   returning * into v_row;

  perform app.write_audit('marketing.content.' || p_decision, 'marketing_content', p_id::text,
                          jsonb_build_object('status', 'waiting', 'version', p_version),
                          jsonb_build_object('status', v_row.status, 'version', p_version));

  perform app.notify_staff(
    array[v_ver.submitted_by, v_row.author_id],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', case p_decision when 'approve' then 'content_approved'
                                   when 'changes' then 'content_changes'
                                   else 'content_declined' end,
      'params', jsonb_build_object('title', v_row.title)));

  return jsonb_build_object('status', v_row.status, 'version', p_version, 'decided_at', v_ver.decided_at);
end $decide_content_0361$;

comment on function app.decide_content(uuid, int, text, text) is
  'marketing_content (wave5-addendum §2.7.2). The owner decides the current open version of a waiting item: approve (final), changes or decline (final), each with an optional note (at most 1000; 0361 dropped the required reason). Tells the version''s submitter and the author (staff_decided / content_approved, content_changes or content_declined, the title only). Returns {status, version, decided_at}. REF_NOT_FOUND, FORBIDDEN, INVALID_ARGUMENT (hint decision), SUBMISSION_DECIDED (not the current open version), CANNOT_DECIDE_OWN, TEXT_TOO_LONG (hint note). Audit marketing.content.approve / .changes / .decline {status, version}.';

revoke all on function app.decide_content(uuid, int, text, text) from public, anon;
grant execute on function app.decide_content(uuid, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_deduction
-- ---------------------------------------------------------------------------

create or replace function app.decide_deduction(
  p_id      uuid,
  p_approve boolean,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_deduction_0361$
declare
  v_row   salary_deductions%rowtype;
  v_venue uuid;
  v_staff uuid;
  v_note  text := nullif(btrim(coalesce(p_note, '')), '');
begin
  -- 0272: the owner decides.
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select d.venue_id, d.staff_id into v_venue, v_staff from salary_deductions d where d.id = p_id;
  if not found or not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_venue, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  -- The person's pay lock before the row's (0271).
  perform app.lock_wage(v_venue, v_staff);
  select * into v_row from salary_deductions where id = p_id for update;
  if v_row.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if auth.uid() = v_row.proposed_by or auth.uid() = v_row.staff_id then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'approve';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  -- 0361: the owner declines without a reason when they choose.

  update salary_deductions
     set status        = case when p_approve then 'approved' else 'declined' end,
         decided_by    = auth.uid(),
         decided_at    = now(),
         decision_note = v_note,
         -- V16, 0272: the month it is approved in, or the person's next
         -- unpaid one when the owner already paid it.
         pay_month     = case when p_approve
                              then app.wage_open_month(v_row.venue_id, v_row.staff_id,
                                                       app.venue_business_date(v_row.venue_id, now()))
                         end
   where id = p_id
   returning * into v_row;

  perform app.write_audit(case when p_approve then 'staff.deduction.approve' else 'staff.deduction.decline' end,
                          'salary_deduction', p_id::text,
                          jsonb_build_object('status', 'waiting'),
                          jsonb_build_object('status', v_row.status));

  perform app.notify_staff(
    array[v_row.proposed_by],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', null,
      'title_key', case when p_approve then 'deduction_approved' else 'deduction_declined' end,
      'params', '{}'::jsonb));
  if p_approve then
    perform app.notify_staff(
      array[v_row.staff_id],
      'staff_info',
      jsonb_build_object('route', 'staff', 'id', null, 'title_key', 'deduction_recorded',
                         'params', '{}'::jsonb));
  end if;

  return jsonb_build_object('status', v_row.status, 'decided_at', v_row.decided_at,
                            'pay_month', v_row.pay_month);
end $decide_deduction_0361$;

comment on function app.decide_deduction(uuid, boolean, text) is
  'salary_deductions (wave5-addendum §2.5.3, 0272). The owner approves or declines a waiting deduction at a venue, never one they proposed or one against themselves; the note is optional on either answer (at most 1000; 0361). An approval stamps pay_month: the venue''s business month today, or the person''s next unpaid month when that one is paid (V16, 0272), and the amount comes off that month''s wage. Tells the proposer (staff_decided / deduction_approved or deduction_declined) and, on an approval, the person (staff_info / deduction_recorded), with no amount. Returns {status, decided_at, pay_month}. FORBIDDEN (not the owner), REF_NOT_FOUND, SUBMISSION_DECIDED, CANNOT_DECIDE_OWN, INVALID_ARGUMENT (hint approve), TEXT_TOO_LONG (hint note). Audit staff.deduction.approve / .decline {status}.';

revoke all on function app.decide_deduction(uuid, boolean, text) from public, anon;
grant execute on function app.decide_deduction(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_recipe_change
-- ---------------------------------------------------------------------------

create or replace function app.decide_recipe_change(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_recipe_change_0361$
declare
  v_row     recipe_change_requests%rowtype;
  v_reason  text := nullif(btrim(coalesce(p_reason, '')), '');
  v_now     jsonb;
  v_active  boolean;
  v_written int := 0;
  v_name_en text;
  v_name_ar text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from recipe_change_requests where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.requested_by = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if v_row.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'approve';
  end if;

  if v_row.target = 'variant' then
    select mi.name_en, mi.name_ar, (mi.is_active and c.kind = 'cafe')
      into v_name_en, v_name_ar, v_active
      from menu_item_variants v
      join menu_items mi on mi.id = v.item_id
      join menu_categories c on c.id = mi.category_id
     where v.id = v_row.variant_id;
  else
    select i.name_en, i.name_ar, (i.is_active and i.kind = 'prepared')
      into v_name_en, v_name_ar, v_active
      from ingredients i
     where i.id = v_row.output_ingredient_id;
  end if;

  if p_approve then
    -- The target as it stands must be the target the head saw.
    select coalesce(jsonb_agg(jsonb_build_object('recipe_line_id', rl.id, 'ingredient_id', rl.ingredient_id,
                                                 'qty', rl.qty) order by rl.id), '[]'::jsonb)
      into v_now
      from recipe_lines rl
     where (v_row.target = 'variant' and rl.variant_id = v_row.variant_id)
        or (v_row.target = 'output' and rl.output_ingredient_id = v_row.output_ingredient_id);
    if not coalesce(v_active, false) or v_now is distinct from v_row.before then
      raise exception 'RECIPE_CHANGED' using errcode = 'P0001';
    end if;

    -- The recipe path, as the owner: set_recipe's own audit and cycle check.
    v_written := app.set_recipe(v_row.target,
                                coalesce(v_row.variant_id, v_row.output_ingredient_id),
                                v_row.after);

    update recipe_change_requests
       set status = 'approved', decided_by = auth.uid(), decided_at = now()
     where id = p_id
     returning * into v_row;
    perform app.write_audit('stock.recipe.change_approve', 'recipe_change_request', p_id::text,
                            jsonb_build_object('status', 'waiting'),
                            jsonb_build_object('status', 'approved', 'lines_written', v_written));
  else
    -- 0361: the owner declines without a reason when they choose.
    if length(v_reason) > 1000 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
    end if;
    update recipe_change_requests
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_reason = v_reason
     where id = p_id
     returning * into v_row;
    perform app.write_audit('stock.recipe.change_decline', 'recipe_change_request', p_id::text,
                            jsonb_build_object('status', 'waiting'),
                            jsonb_build_object('status', 'declined'));
  end if;

  perform app.notify_staff(
    array[v_row.requested_by],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', v_row.id,
      'title_key', case when p_approve then 'recipe_change_approved' else 'recipe_change_declined' end,
      'params', jsonb_build_object('step', jsonb_build_object('en', v_name_en, 'ar', v_name_ar))));

  return jsonb_build_object('status', v_row.status, 'lines_written', v_written);
end $decide_recipe_change_0361$;

comment on function app.decide_recipe_change(uuid, boolean, text) is
  'recipe_change_requests (§2.24.7). The owner, at the request''s venue, never on their own: an approve checks the target is still active and its lines still match the request''s before (else RECIPE_CHANGED), writes after through app.set_recipe (its stock.recipe.set audit and cycle check: RECIPE_CYCLE, INGREDIENT_NOT_FOUND, INVALID_QTY, VARIANT_NOT_FOUND), and tells the head (recipe_change_approved); a decline takes an optional reason (at most 1000; 0361) and tells the head (recipe_change_declined). Returns {status, lines_written}. REF_NOT_FOUND, FORBIDDEN, CANNOT_DECIDE_OWN, SUBMISSION_DECIDED, INVALID_ARGUMENT (hint approve), TEXT_TOO_LONG. Audit stock.recipe.change_approve or stock.recipe.change_decline.';

revoke all on function app.decide_recipe_change(uuid, boolean, text) from public, anon;
grant execute on function app.decide_recipe_change(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_shopping_item
-- ---------------------------------------------------------------------------

create or replace function app.decide_shopping_item(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_shopping_item_0361$
declare
  v_item   shopping_items%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Row-addressed: an unknown line, or one elsewhere, answers as not open
  -- (the 0166 convention).
  select * into v_item from shopping_items where id = p_id for update;
  if not found or not (v_item.venue_id = any(app.staff_venue_ids())) then
    raise exception 'SHOPPING_ITEM_NOT_OPEN' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_item.venue_id, 'head_chef', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_item.venue_id::text, true);
  if v_item.status <> 'pending' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  -- A line is pending only while its requester is a chef, so this holds by
  -- construction; it guards a chef who became head chef since.
  if v_item.requested_by = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'approve';
  end if;

  if p_approve then
    update shopping_items
       set status = 'open', decided_by = auth.uid(), decided_at = now()
     where id = p_id
     returning * into v_item;
    perform app.write_audit('shopping.approve', 'shopping_item', p_id::text,
                            jsonb_build_object('status', 'pending'),
                            jsonb_build_object('status', 'open'));
    perform app.notify_staff(
      app.staff_ids_with_roles(v_item.venue_id, array['driver']::staff_role[]),
      'staff_task',
      jsonb_build_object('route', 'staff-shopping', 'title_key', 'shopping_new', 'params', '{}'::jsonb),
      'shopping:' || v_item.venue_id::text);
  else
    -- 0361: the head chef and a manager say why; the owner need not.
    if v_reason is null and not app.is_staff_at(v_item.venue_id, 'owner') then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
    if length(v_reason) > 300 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
    end if;
    update shopping_items
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_reason = v_reason
     where id = p_id
     returning * into v_item;
    perform app.write_audit('shopping.decline', 'shopping_item', p_id::text,
                            jsonb_build_object('status', 'pending'),
                            jsonb_build_object('status', 'declined'));
    perform app.notify_staff(
      array[v_item.requested_by],
      'staff_decided',
      jsonb_build_object('route', 'staff-shopping', 'title_key', 'shopping_declined', 'params', '{}'::jsonb));
  end if;

  return jsonb_build_object('id', v_item.id, 'status', v_item.status);
end $decide_shopping_item_0361$;

comment on function app.decide_shopping_item(uuid, boolean, text) is
  'shopping_head_approval (§2.24.9). The head chef or MGMT at the line''s venue: approves a pending line (open; the drivers get staff_task / shopping_new, deduped shopping:<venue>) or declines it with a reason (at most 300; optional for the owner, 0361; the requester gets staff_decided / shopping_declined). Returns {id, status}. SHOPPING_ITEM_NOT_OPEN (unknown or elsewhere), FORBIDDEN, SUBMISSION_DECIDED (not pending), CANNOT_DECIDE_OWN, INVALID_ARGUMENT (hint approve), REASON_REQUIRED, TEXT_TOO_LONG. Audit shopping.approve or shopping.decline.';

revoke all on function app.decide_shopping_item(uuid, boolean, text) from public, anon;
grant execute on function app.decide_shopping_item(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- decide_step
-- ---------------------------------------------------------------------------

create or replace function app.decide_step(
  p_submission_id uuid,
  p_decision      text,
  p_note          text  default null,
  p_send_back_to  uuid  default null,
  p_data          jsonb default '{}'
) returns jsonb
language plpgsql security definer set search_path = public as $decide_step_0361$
declare
  v_run_id uuid;
  v_run    protocol_runs%rowtype;
  v_step   protocol_run_steps%rowtype;
  v_sub    protocol_submissions%rowtype;
  v_target protocol_run_steps%rowtype;
  v_note   text;
  v_last   text;
  v_reset  uuid[];
  v_opened uuid[] := '{}';
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select x.run_id into v_run_id from protocol_submissions x where x.id = p_submission_id;
  select * into v_run from protocol_runs where id = v_run_id for update;
  if not found or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);
  select * into v_step
    from protocol_run_steps
   where id = (select x.run_step_id from protocol_submissions x where x.id = p_submission_id)
   for update;
  select * into v_sub from protocol_submissions where id = p_submission_id for update;

  if v_run.status <> 'active' then
    raise exception 'PROTOCOL_CLOSED' using errcode = 'P0001';
  end if;
  if v_sub.decision is not null or v_sub.withdrawn_at is not null or v_sub.superseded_at is not null
     or v_step.status <> 'submitted' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if not app.protocol_engine_decider(v_run.venue_id, v_step.needs_owner_ok, false) then
    raise exception 'NOT_DECIDER' using errcode = 'P0001';
  end if;
  if v_sub.submitted_by = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if p_decision is null or p_decision not in ('approve', 'send_back', 'stop') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'decision';
  end if;
  v_note := app.protocol_engine_text(p_note, 1000, 'note');
  -- 0361: a manager says why; the owner need not.
  if p_decision in ('send_back', 'stop') and v_note is null
     and not app.is_staff_at(v_run.venue_id, 'owner') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_data is not null and jsonb_typeof(p_data) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'data';
  end if;

  if p_decision = 'approve' then
    -- No override (#42): the figures on record stay the sender's.
    update protocol_submissions
       set decision = 'approve', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = v_sub.id;
    v_opened := app.protocol_engine_pass(v_run.id, v_step.id, v_sub.id, coalesce(p_data, '{}'::jsonb));
    perform app.protocol_engine_notify(array[v_sub.submitted_by, v_run.started_by],
      'staff_decided', 'step_approved', 'staff-step', v_step.id, v_run.id, v_step.id);

  elsif p_decision = 'send_back' then
    if p_send_back_to is null or p_send_back_to = v_step.id then
      v_target := v_step;
    else
      select * into v_target
        from protocol_run_steps
       where id = p_send_back_to and run_id = v_run.id
       for update;
      if not found or v_target.status <> 'passed' or v_target.position >= v_step.position then
        raise exception 'SEND_BACK_TARGET_INVALID' using errcode = 'P0001';
      end if;
    end if;

    update protocol_submissions
       set decision = 'send_back', decided_by = auth.uid(), decided_at = now(),
           decision_note = v_note, send_back_to = v_target.id
     where id = v_sub.id;

    -- What goes back to waiting: every step that waits for the target by the
    -- opening rule, and what waits for those in turn (a built-in step through
    -- its after_keys; any step above an owner-added one, and an owner-added
    -- step above any step; the terminal step, which waits for all), plus the
    -- sent-back step itself when the target is another. A step that does not
    -- wait for the target keeps its state, so the order of two parallel
    -- steps (the swaps §2.8 allows) never changes what a send-back undoes.
    v_last := (select d->>'step_key'
                 from jsonb_array_elements(app.protocol_step_defs(v_run.kind, v_run.variant)) d
                where d->>'fixed' = 'last');
    v_reset := array(
      with recursive dep(id) as (
        select v_target.id
        union
        select s.id
          from dep
          join protocol_run_steps t on t.id = dep.id
          join protocol_run_steps s on s.run_id = t.run_id and s.id <> t.id
         where (s.step_key is not null and t.step_key is not null and t.step_key = any(s.after_keys))
            or ((s.step_key is null or t.step_key is null) and s.position > t.position)
            or s.step_key = v_last)
      select dep.id from dep where dep.id <> v_target.id
      union
      select v_step.id where v_step.id <> v_target.id);

    -- One that already holds a decided submission this round starts the
    -- next round, so its next send never meets that one; undecided
    -- submissions are set aside.
    update protocol_run_steps s
       set round = s.round + case when exists (select 1 from protocol_submissions x
                                                where x.run_step_id = s.id and x.round = s.round
                                                  and x.decision is not null
                                                  and x.withdrawn_at is null and x.superseded_at is null)
                                  then 1 else 0 end,
           status = 'waiting',
           passed_at = null
     where s.id = any(v_reset)
       and app.protocol_step_allowed(s.status, 'waiting');
    update protocol_submissions x
       set superseded_at = now()
     where x.run_id = v_run.id
       and x.decision is null and x.withdrawn_at is null and x.superseded_at is null
       and x.run_step_id = any(v_reset);

    -- The target reopens in a new round; earlier rounds stay as history.
    update protocol_run_steps
       set status = 'open', round = round + 1, opened_at = now(), passed_at = null
     where id = v_target.id;
    v_opened := app.protocol_engine_open(v_run.id);

    perform app.protocol_engine_notify(array[v_sub.submitted_by, v_run.started_by],
      'staff_decided', 'step_sent_back', 'staff-step', v_step.id, v_run.id, v_step.id);
    if v_target.id <> v_step.id then
      perform app.protocol_engine_notify(
        app.protocol_engine_actor_ids(v_run.venue_id, v_target.actor_roles, v_target.assigned_to),
        'staff_task', 'step_open', 'staff-step', v_target.id, v_run.id, v_target.id);
    end if;

  else
    update protocol_submissions
       set decision = 'stop', decided_by = auth.uid(), decided_at = now(), decision_note = v_note
     where id = v_sub.id;
    update protocol_run_steps set status = 'stopped' where id = v_step.id;
    update protocol_runs
       set status = 'stopped', stop_reason = v_note, finished_at = now()
     where id = v_run.id;
    perform app.protocol_engine_stop_hook(v_run.id);
    perform app.protocol_engine_notify(array[v_sub.submitted_by, v_run.started_by],
      'staff_decided', 'step_stopped', 'staff-step', v_step.id, v_run.id, v_step.id);
  end if;

  perform app.write_audit('protocol.decide', 'protocol_run', v_run.id::text, null,
    jsonb_build_object('run_step_id', v_step.id, 'submission_id', v_sub.id, 'decision', p_decision,
                       'send_back_to', case when p_decision = 'send_back' then v_target.id end));

  return jsonb_build_object(
    'submission_id',   v_sub.id,
    'decision',        p_decision,
    'step_status',     (select s.status from protocol_run_steps s where s.id = v_step.id),
    'run_status',      (select r.status from protocol_runs r where r.id = v_run.id),
    'opened_step_ids', to_jsonb(v_opened));
end $decide_step_0361$;

comment on function app.decide_step(uuid, text, text, uuid, jsonb) is
  'protocols_engine_rpcs (§2.7). A decider (the owner when the step needs the owner''s OK, else a manager at the venue or the owner), never on their own submission: approve (p_data is the pass hook''s decision data; no override of the figures), send_back to the step itself or a passed step below it (a new round; every step that waits for it by the opening rule goes back to waiting, and so does the sent-back step), or stop (the run stops). A reason is required to send back or stop, except from the owner (0361). Returns {submission_id, decision, step_status, run_status, opened_step_ids}. Audit protocol.decide.';

revoke all on function app.decide_step(uuid, text, text, uuid, jsonb) from public, anon;
grant execute on function app.decide_step(uuid, text, text, uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- decline_release_idea
-- ---------------------------------------------------------------------------

create or replace function app.decline_release_idea(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $decline_release_idea_0361$
declare
  v_idea   release_ideas%rowtype;
  v_reason text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_idea from release_ideas where id = p_id for update;
  if not found or not (v_idea.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not (app.is_staff_at(v_idea.venue_id, app.staff_team_head(v_idea.team))
          or app.is_staff_at(v_idea.venue_id, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_idea.status <> 'waiting' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  v_reason := nullif(btrim(coalesce(p_reason, '')), '');
  -- 0361: the team head and a manager say why; the owner need not.
  if v_reason is null and not app.is_staff_at(v_idea.venue_id, 'owner') then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_reason) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;
  perform set_config('app.venue_id', v_idea.venue_id::text, true);

  update release_ideas
     set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_reason = v_reason
   where id = v_idea.id;

  perform app.write_audit('protocol.release.idea_decline', 'release_idea', v_idea.id::text,
    jsonb_build_object('status', 'waiting'), jsonb_build_object('status', 'declined', 'team', v_idea.team));
  perform app.notify_staff(
    array[v_idea.author_id], 'staff_decided',
    jsonb_build_object('route', 'staff', 'id', v_idea.id, 'title_key', 'idea_declined',
                       'params', jsonb_build_object(
                         'title', coalesce(v_idea.record->>'name_en', v_idea.record->>'name_ar'))));
  return jsonb_build_object('status', 'declined');
end $decline_release_idea_0361$;

comment on function app.decline_release_idea(uuid, text) is
  'product_release (§2.9). The head of the idea''s team (head_barista for bar, head_chef for kitchen) or MGMT at its venue declines a waiting idea with a reason (<= 1000), which the author reads (optional for the owner, 0361); the author is told (staff_decided / idea_declined). REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED, REASON_REQUIRED, TEXT_TOO_LONG. Returns {status}. Audit protocol.release.idea_decline (no text).';

revoke all on function app.decline_release_idea(uuid, text) from public, anon;
grant execute on function app.decline_release_idea(uuid, text) to authenticated;
