-- 0249 — staff page scopes (owner, 2026-09-28): each staff page is seen by
-- the people it concerns and nobody else.
--
--   1. app.add_marketing_request — asking marketing is the manager's and the
--      owner's only (was every role but marketing). Re-issued from
--      20260925000187_marketing_requests.sql:93; only the guard changes.
--   2. app.release_notes_for_me — an item is listed for notes only while its
--      product release is at the feedback stage (run status live). Re-issued
--      from 20260925000173_release_post_launch.sql:111; only the WHERE grows.
--   3. app.protocol_engine_involved — holding an actor role of an unassigned
--      step makes you involved only while the step is waiting or open. Once
--      it is submitted, passed, skipped or stopped, only its submitters stay
--      involved (a head chef no longer follows a bar release the head barista
--      proposed). Deciders are management, who see every run anyway.
--      Re-issued from 20260925000164_protocols_engine_rpcs.sql:574.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. app.add_marketing_request
-- ---------------------------------------------------------------------------
create or replace function app.add_marketing_request(
  p_title           text,
  p_body            text,
  p_want_by         date   default null,
  p_menu_item_id    uuid   default null,
  p_photos          text[] default '{}',
  p_venue_id        uuid   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $add_marketing_request_0249$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_photos text[];
  v_id     uuid;
  v_result jsonb;
begin
  -- 0249 (owner, 2026-09-28): the manager and the owner ask; nobody else.
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'add_marketing_request');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_title is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'title';
  end if;
  if length(v_title) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'title';
  end if;
  if v_body is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_body) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;
  -- The venue's own day, not the server's.
  if p_want_by is not null and p_want_by < app.venue_business_date(v_venue) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'want_by';
  end if;
  if p_menu_item_id is not null
     and not exists (select 1 from menu_items m where m.id = p_menu_item_id and m.venue_id = v_venue) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- In the order given, once each.
  v_photos := coalesce(array(select x from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_photos) > 4 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'photos';
  end if;

  insert into marketing_requests (venue_id, requested_by, title, body, want_by, menu_item_id, photos)
  values (v_venue, auth.uid(), v_title, v_body, p_want_by, p_menu_item_id, v_photos)
  returning id into v_id;

  perform app.claim_staff_media(v_photos, v_venue, array['requests'], 'marketing_request:' || v_id::text);

  perform app.write_audit('marketing.request.add', 'marketing_request', v_id::text, null,
                          jsonb_build_object('status', 'open', 'menu_item_id', p_menu_item_id,
                                             'photos', cardinality(v_photos)));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['marketing']::staff_role[]),
    'staff_task',
    jsonb_build_object(
      'route', 'staff',
      'id', v_id,
      'title_key', 'marketing_request_new',
      'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                   'title', v_title)));

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $add_marketing_request_0249$;

comment on function app.add_marketing_request(text, text, date, uuid, text[], uuid, text) is
  'marketing_requests (§2.24.11, 0249). The manager or the owner at the venue: asks marketing for something (title 1 to 120, body 1 to 2000, an optional want-by day not in the past, an optional menu item of the venue, up to 4 photos in the requests folder) and tells marketing at the venue (staff_task / marketing_request_new). Returns {id}. Idempotent by key. FORBIDDEN, TEXT_REQUIRED, TEXT_TOO_LONG (hint title or body), INVALID_ARGUMENT (hint want_by or photos), ITEM_NOT_FOUND, PHOTO_PATH_INVALID. Audit marketing.request.add.';

revoke all on function app.add_marketing_request(text, text, date, uuid, text[], uuid, text) from public, anon;
grant execute on function app.add_marketing_request(text, text, date, uuid, text[], uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.release_notes_for_me
-- ---------------------------------------------------------------------------
create or replace function app.release_notes_for_me(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_notes_for_me_0249$
declare
  v_venue uuid;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object(
             'menu_item_id',   mi.id,
             'name_en',        mi.name_en,
             'name_ar',        mi.name_ar,
             'launched_at',    mi.launched_at,
             'window_ends_at', mi.launched_at + interval '30 days',
             'run_id',         mi.release_run_id,
             'notes',          (select count(*) from release_notes n where n.menu_item_id = mi.id),
             'my_notes',       (select count(*) from release_notes n
                                 where n.menu_item_id = mi.id and n.author_id = auth.uid()))
           order by mi.launched_at desc, mi.id)
      from menu_items mi
     where mi.venue_id = v_venue
       and mi.release_run_id is not null
       -- 0249 (owner, 2026-09-28): only while its new-item protocol is at the
       -- feedback stage: launched (live), before the day-30 review closes it.
       and exists (select 1 from protocol_runs r
                     where r.id = mi.release_run_id
                       and r.kind = 'product_release'
                       and r.status = 'live')
       and mi.launched_at <= now()
       and now() < mi.launched_at + interval '30 days'), '[]'::jsonb));
end $release_notes_for_me_0249$;

comment on function app.release_notes_for_me(uuid) is
  'release_post_launch (§2.10, 0249). Any active staff member at the venue: {items: [{menu_item_id, name_en, name_ar, launched_at, window_ends_at, run_id, notes, my_notes}]}, the released items whose product release is live (the feedback stage) and still in their 30-day note window, newest launch first, with how many notes they have and how many are the caller''s.';

revoke all on function app.release_notes_for_me(uuid) from public, anon;
grant execute on function app.release_notes_for_me(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.protocol_engine_involved
-- ---------------------------------------------------------------------------
create or replace function app.protocol_engine_involved(p_run_id uuid)
returns boolean
language sql stable security definer set search_path = public as $protocol_engine_involved_0249$
  select coalesce((
    select r.started_by = auth.uid()
        or exists (select 1 from protocol_run_steps s
                    where s.run_id = r.id
                      and (   (s.assigned_to is not null and s.assigned_to = auth.uid())
                           or (s.assigned_to is null
                               and app.is_staff_at(r.venue_id, variadic s.actor_roles)
                               -- 0249: holding the role counts while the step is
                               -- still to do; once it is handed in, only the
                               -- person who handed it in stays involved.
                               and (s.status in ('waiting', 'open')
                                    or exists (select 1 from protocol_submissions ps
                                                where ps.run_step_id = s.id
                                                  and ps.submitted_by = auth.uid())))))
      from protocol_runs r
     where r.id = p_run_id), false)
$protocol_engine_involved_0249$;

comment on function app.protocol_engine_involved(uuid) is
  'protocols_engine_rpcs (§2.7 "Visibility", 0249). Internal: true when the caller started the run, or is an assignee of one of its steps, or holds an actor role of an unassigned step at the run''s venue while that step is waiting or open, or has a submission on an unassigned step.';

revoke all on function app.protocol_engine_involved(uuid) from public, anon, authenticated;
