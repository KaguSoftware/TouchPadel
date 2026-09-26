-- 0173 release_post_launch — what happens after a product release: the scheduled
-- launch, the 30-day window for staff notes on the new item, the day-30
-- review, and the photo purge of stopped runs.
--
-- Feature: protocols and the staff phone, lane E
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.10, §2.19, §2.20,
-- §2.21, §2.22; plan §5.1, Q9, Q13, #43, #54).
-- Depends on: product_release (E: the launch internals, readiness,
-- menu_items.launched_at and release_run_id), marketing_staff (0168:
-- marketing_notes, read by release_review_input as marketing's take).
-- Re-issues nothing.
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing; cron.schedule upserts by name.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE TWO CLOCKS. tp_protocol_tick (every 5 minutes) asks protocol-action to
-- launch the releases whose date has come (copying the chosen photo into
-- menu-media first) and to remove the photos of runs stopped or withdrawn 90
-- days ago. tp_release_review (daily) asks release-review to write the day-30
-- review of every item live for 30 days. Both nudges post nothing when
-- nothing is due, and are silent without pg_net or the two secrets (0113).
--
-- WHO READS THE REVIEW (#54). Only managers and owners: release_review is
-- MGMT, release_reviews is MGMT at the venue, and review_ready goes to the
-- owners and the venue's managers, never to a starter who is not MGMT (who
-- sees the run reach done with no figures, on every protocol surface).
--
-- WHAT GOES TO THE MODEL. release_review_input is the release-review
-- function's only input (SEC-29 scans it by name): the item's names, its own
-- sales figures from the sales lines report_cafe reads (0096) and v_item_margin,
-- staff notes and marketing's take as text with no author, and whether the
-- launch campaign carried a promotion. It never calls report_cafe, whose
-- reports_guard refuses the service role.
--
-- covered by packages/db/tests/release-post-launch.test.ts and
-- release-review.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists release_reviews (
  run_id        uuid primary key references protocol_runs(id) on delete cascade,
  venue_id      uuid not null references venues(id),
  menu_item_id  uuid references menu_items(id) on delete set null,
  numbers       jsonb not null,
  write_up      jsonb,
  status        text not null check (status in ('written','thin','fallback','failed')),
  model         text,
  created_at    timestamptz not null default now(),
  written_at    timestamptz
);

create table if not exists release_notes (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  menu_item_id  uuid not null references menu_items(id) on delete cascade,
  run_id        uuid references protocol_runs(id) on delete set null,
  author_id     uuid not null references staff(id),
  body          text not null check (coalesce(length(btrim(body)), 0) between 1 and 2000),
  created_at    timestamptz not null default now()
);

create index if not exists release_notes_item_idx on release_notes (menu_item_id, created_at);

comment on table release_reviews is
  'release_post_launch (§2.10): the day-30 review of a released item, written once by the release-review edge function (app.release_review_save): the numbers it read and the write-up. Read by MGMT only (#54), through app.release_review.';
comment on column release_reviews.run_id is 'The product release run reviewed.';
comment on column release_reviews.venue_id is 'The run''s venue.';
comment on column release_reviews.menu_item_id is 'The released item.';
comment on column release_reviews.numbers is 'The figures of the item''s first 30 days (app.release_review_input numbers): units, revenue, margin, share of its category, days sold, bought with, and the window.';
comment on column release_reviews.write_up is 'The write-up, {en, ar}: from the venue''s model, gated to the numbers it was given, or the template when the model is not available.';
comment on column release_reviews.status is 'written (by the model), thin (too few units to say much), fallback (the template), failed (nothing written; the next day''s tick tries again).';
comment on column release_reviews.model is 'The model that wrote it (the venue''s llm_default_model); NULL for the template.';
comment on column release_reviews.created_at is 'When the row was first saved.';
comment on column release_reviews.written_at is 'When the write-up was saved; NULL while failed.';

comment on table release_notes is
  'release_post_launch (§2.10, Q9, #43): notes any staff member adds on a released item in its first 30 days, customer remarks included, feeding the day-30 review. Written through app.add_release_note; read by MGMT at the venue, and by staff through app.release_notes_for_me and app.release_notes_for_item.';
comment on column release_notes.id is 'Note id.';
comment on column release_notes.venue_id is 'The item''s venue.';
comment on column release_notes.menu_item_id is 'The released item.';
comment on column release_notes.run_id is 'The product release that launched it.';
comment on column release_notes.author_id is 'Who wrote it.';
comment on column release_notes.body is 'The note, as typed (1 to 2000 characters); no guest names or phone numbers (the form says so).';
comment on column release_notes.created_at is 'When it was written.';

alter table release_reviews enable row level security;
alter table release_notes   enable row level security;

drop policy if exists release_reviews_mgmt_read on release_reviews;
create policy release_reviews_mgmt_read on release_reviews
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists release_notes_mgmt_read on release_notes;
create policy release_notes_mgmt_read on release_notes
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on release_reviews, release_notes to authenticated;
grant all on release_reviews, release_notes to service_role;

-- ---------------------------------------------------------------------------
-- 2. Staff notes on a new item (Q9): any staff member at the item's venue,
--    for 30 days from its launch.
-- ---------------------------------------------------------------------------
create or replace function app.release_notes_for_me(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_notes_for_me_0173$
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
       and mi.launched_at <= now()
       and now() < mi.launched_at + interval '30 days'), '[]'::jsonb));
end $release_notes_for_me_0173$;

comment on function app.release_notes_for_me(uuid) is
  'release_post_launch (§2.10). Any active staff member at the venue: {items: [{menu_item_id, name_en, name_ar, launched_at, window_ends_at, run_id, notes, my_notes}]}, the released items still in their 30-day note window, newest launch first, with how many notes they have and how many are the caller''s.';

revoke all on function app.release_notes_for_me(uuid) from public, anon;
grant execute on function app.release_notes_for_me(uuid) to authenticated;

create or replace function app.release_notes_for_item(p_menu_item_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_notes_for_item_0173$
declare
  v_item menu_items%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_item from menu_items where id = p_menu_item_id;
  if not found or v_item.release_run_id is null or not (v_item.venue_id = any(app.staff_venue_ids())) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'item', jsonb_build_object(
      'id',             v_item.id,
      'name_en',        v_item.name_en,
      'name_ar',        v_item.name_ar,
      'window_ends_at', v_item.launched_at + interval '30 days',
      'open',           coalesce(v_item.launched_at <= now()
                                 and now() < v_item.launched_at + interval '30 days', false)),
    'notes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id',          n.id,
               'author_name', s.display_name,
               'body',        n.body,
               'created_at',  n.created_at,
               'mine',        n.author_id = auth.uid())
             order by n.created_at desc, n.id)
        from release_notes n
        left join staff s on s.id = n.author_id
       where n.menu_item_id = v_item.id), '[]'::jsonb));
end $release_notes_for_item_0173$;

comment on function app.release_notes_for_item(uuid) is
  'release_post_launch (§2.10). Any active staff member at the item''s venue: {item: {id, name_en, name_ar, window_ends_at, open}, notes: [{id, author_name, body, created_at, mine}]} for an item a product release launched, newest note first. ITEM_NOT_FOUND for any other item or another venue''s.';

revoke all on function app.release_notes_for_item(uuid) from public, anon;
grant execute on function app.release_notes_for_item(uuid) to authenticated;

create or replace function app.add_release_note(
  p_menu_item_id    uuid,
  p_body            text,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $add_release_note_0173$
declare
  v_item   menu_items%rowtype;
  v_replay jsonb;
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_id     uuid;
  v_result jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_item from menu_items where id = p_menu_item_id;
  if not found or v_item.release_run_id is null or not (v_item.venue_id = any(app.staff_venue_ids())) then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_item.venue_id::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'add_release_note');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_item.launched_at is null or now() < v_item.launched_at
     or now() >= v_item.launched_at + interval '30 days' then
    raise exception 'NOTE_WINDOW_CLOSED' using errcode = 'P0001';
  end if;
  if v_body is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_body) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;

  insert into release_notes (venue_id, menu_item_id, run_id, author_id, body)
  values (v_item.venue_id, v_item.id, v_item.release_run_id, auth.uid(), v_body)
  returning id into v_id;

  v_result := jsonb_build_object('id', v_id);
  perform app.finish_replay(p_idempotency_key, v_result);
  return v_result;
end $add_release_note_0173$;

comment on function app.add_release_note(uuid, text, text) is
  'release_post_launch (§2.10, Q9). Any active staff member at the item''s venue adds a note (1 to 2000 characters; customer remarks welcome, no names or phone numbers) on an item a product release launched, in its first 30 days. Returns {id}. ITEM_NOT_FOUND, NOTE_WINDOW_CLOSED, TEXT_REQUIRED, TEXT_TOO_LONG. Idempotent on p_idempotency_key. Not audited (PROPOSAL): the row keeps who and when.';

revoke all on function app.add_release_note(uuid, text, text) from public, anon;
grant execute on function app.add_release_note(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. The day-30 review, for managers and owners only (#54).
-- ---------------------------------------------------------------------------
create or replace function app.release_review(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_review_0173$
declare
  v_run protocol_runs%rowtype;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or v_run.kind <> 'product_release' or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_run.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  return (select jsonb_build_object(
                   'status',     rv.status,
                   'numbers',    rv.numbers,
                   'write_up',   rv.write_up,
                   'model',      rv.model,
                   'written_at', rv.written_at)
            from release_reviews rv
           where rv.run_id = v_run.id);
end $release_review_0173$;

comment on function app.release_review(uuid) is
  'release_post_launch (§2.10, #54). MGMT at the run''s venue only: the day-30 review of a product release, {status, numbers, write_up, model, written_at}, or NULL before it is written. FORBIDDEN for every other role, the run''s starter included; PROTOCOL_NOT_FOUND.';

revoke all on function app.release_review(uuid) from public, anon;
grant execute on function app.release_review(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. The scheduler (§2.10, §2.20). Service role only: the protocol-action and
--    release-review edge functions call these with the service key, on the
--    cron's nudge; no client role holds EXECUTE.
-- ---------------------------------------------------------------------------

-- Scheduled releases whose date has come, with the photo their launch chose.
create or replace function app.release_due_launches(p_limit int default 10)
returns jsonb
language sql stable security definer set search_path = public as $release_due_launches_0173$
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id',       d.id,
           'venue_id',     d.venue_id,
           'menu_item_id', d.menu_item_id,
           'photo_path',   app.release_launch_record(d.id)->>'photo_path')
         order by d.scheduled_for, d.id), '[]'::jsonb)
    from (select r.id, r.venue_id, r.menu_item_id, r.scheduled_for
            from protocol_runs r
           where r.kind = 'product_release'
             and r.status = 'scheduled'
             and r.scheduled_for <= now()
           order by r.scheduled_for, r.id
           limit greatest(coalesce(p_limit, 10), 1)) d
$release_due_launches_0173$;

comment on function app.release_due_launches(int) is
  'release_post_launch (§2.10). Service role: [{run_id, venue_id, menu_item_id, photo_path}], the scheduled product releases whose date has come (oldest first, at most p_limit), with the staff-media photo their launch chose; protocol-action copies it to menu-media and calls app.release_launch_scheduled.';

revoke all on function app.release_due_launches(int) from public, anon, authenticated;
grant execute on function app.release_due_launches(int) to service_role;

-- The date has come: launch when the draft is still ready, else put the run
-- back to active, reopen its launch step in a new round and tell the owners.
-- A run that is no longer scheduled is left alone ('launched' when it is
-- live already, a retry; 'skipped' otherwise).
create or replace function app.release_launch_scheduled(p_run_id uuid, p_menu_photo_path text)
returns text
language plpgsql security definer set search_path = public as $release_launch_scheduled_0173$
declare
  v_run    protocol_runs%rowtype;
  v_rec    jsonb;
  v_ready  jsonb;
  v_launch protocol_run_steps%rowtype;
  v_failing text;
begin
  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or v_run.kind <> 'product_release' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_run.status = 'live' then
    return 'launched';
  end if;
  if v_run.status <> 'scheduled' then
    return 'skipped';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  v_rec := app.release_launch_record(v_run.id);
  if p_menu_photo_path is null
     or p_menu_photo_path is distinct from app.release_menu_photo_path(v_run.id, v_rec->>'photo_path') then
    raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'menu_photo_path';
  end if;

  v_ready := app.release_readiness_internal(v_run.id);
  if (v_ready->>'ready')::boolean then
    perform app.release_launch_internal(v_run.id, p_menu_photo_path);
    return 'launched';
  end if;

  select * into v_launch
    from protocol_run_steps s
   where s.run_id = v_run.id and s.step_key = 'launch'
   for update;
  if not app.protocol_run_allowed(v_run.status, 'active')
     or not app.protocol_step_allowed(v_launch.status, 'open') then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;
  update protocol_runs set status = 'active', scheduled_for = null where id = v_run.id;
  update protocol_run_steps
     set status = 'open', round = round + 1, opened_at = now(), passed_at = null
   where id = v_launch.id;

  select string_agg(c->>'key', ',' order by o) into v_failing
    from jsonb_array_elements(v_ready->'checks') with ordinality as t(c, o)
   where not (c->>'ok')::boolean;
  perform app.protocol_engine_notify(app.staff_ids_with_roles(v_run.venue_id, '{owner}'),
                                     'staff_task', 'launch_not_ready', 'staff-step',
                                     v_launch.id, v_run.id, v_launch.id);
  perform app.write_audit('protocol.unschedule', 'protocol_run', v_run.id::text,
    jsonb_build_object('status', 'scheduled'),
    jsonb_build_object('status', 'active', 'run_step_id', v_launch.id, 'not_ready', v_failing));
  return 'reverted';
end $release_launch_scheduled_0173$;

comment on function app.release_launch_scheduled(uuid, text) is
  'release_post_launch (§2.10). Service role: launches a scheduled product release whose date has come, re-checking through app.release_readiness_internal (never the guarded read): ready, app.release_launch_internal with p_menu_photo_path (the menu-media copy, items/<menu_item_id>/<run_id>.<ext>; RECORD_INVALID otherwise) and ''launched''; not ready, the run back to active, its launch step reopened in a new round, the owners told (staff_task / launch_not_ready), audit protocol.unschedule, and ''reverted''. ''launched'' for a run already live, ''skipped'' for one no longer scheduled.';

revoke all on function app.release_launch_scheduled(uuid, text) from public, anon, authenticated;
grant execute on function app.release_launch_scheduled(uuid, text) to service_role;

-- Items live for 30 days with no review saved yet (a failed one is tried
-- again).
create or replace function app.release_due_reviews(p_limit int default 5)
returns jsonb
language sql stable security definer set search_path = public as $release_due_reviews_0173$
  select coalesce(jsonb_agg(jsonb_build_object('run_id', d.id, 'venue_id', d.venue_id)
                            order by d.live_at, d.id), '[]'::jsonb)
    from (select r.id, r.venue_id, r.live_at
            from protocol_runs r
           where r.kind = 'product_release'
             and r.status = 'live'
             and r.live_at + interval '30 days' <= now()
             and not exists (select 1 from release_reviews rv
                              where rv.run_id = r.id and rv.status <> 'failed')
           order by r.live_at, r.id
           limit greatest(coalesce(p_limit, 5), 1)) d
$release_due_reviews_0173$;

comment on function app.release_due_reviews(int) is
  'release_post_launch (§2.10). Service role: [{run_id, venue_id}], the product releases live for 30 days with no saved review (a failed one is due again), oldest first, at most p_limit.';

revoke all on function app.release_due_reviews(int) from public, anon, authenticated;
grant execute on function app.release_due_reviews(int) to service_role;

-- The model's only input. Numbers from the item's own settled sales lines in
-- its first 30 days (the rows report_cafe reads, 0096) with the cost each
-- line carried, else today's v_item_margin cost; notes and marketing's take
-- as text only, with no author.
create or replace function app.release_review_input(p_run_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $release_review_input_0173$
declare
  v_run        protocol_runs%rowtype;
  v_item       menu_items%rowtype;
  v_tz         text;
  v_start_hour int;
  v_from       timestamptz;
  v_to         timestamptz;
  v_units      bigint;
  v_revenue    bigint;
  v_cost       bigint;
  v_cat_units  bigint;
  v_days       bigint;
  v_margin     bigint;
  v_bought     jsonb;
  v_notes      jsonb;
  v_take       jsonb;
  v_promo      boolean;
begin
  select * into v_run from protocol_runs where id = p_run_id;
  if not found or v_run.kind <> 'product_release' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  select * into v_item from menu_items where id = v_run.menu_item_id;

  v_tz := coalesce((select v.timezone from venues v where v.id = v_run.venue_id), 'Asia/Baghdad');
  v_start_hour := coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4);
  v_from := coalesce(v_run.live_at, v_item.launched_at, now());
  v_to := least(now(), v_from + interval '30 days');

  with
  l as (
    select l.order_id, l.menu_item_id, l.variant_id, l.business_date, l.net_qty,
           l.net_line_iqd, l.cost_total_iqd, mi.category_id
      from app.analytics_sales_lines('settled', v_from, v_to, v_tz, v_start_hour) l
      join menu_items mi on mi.id = l.menu_item_id
     where mi.venue_id = v_run.venue_id),
  mine as (
    select * from l where l.menu_item_id = v_item.id),
  agg as (
    select coalesce(sum(m.net_qty), 0)::bigint                                  as units,
           coalesce(sum(m.net_line_iqd), 0)::bigint                             as revenue,
           case when count(*) > 0 and bool_and(m.cost_total_iqd is not null)
                then sum(m.cost_total_iqd)::bigint end                          as cost_sold,
           count(distinct m.business_date) filter (where m.net_qty > 0)::bigint as days
      from mine m),
  -- Lines sold before cost snapshots carry none: today's recipe cost instead.
  cost_now as (
    select case when count(*) > 0 and bool_and(c.cogs_iqd is not null)
                then sum(m.net_qty * c.cogs_iqd)::bigint end as cost
      from mine m
      left join v_item_margin c on c.variant_id = m.variant_id),
  cat as (
    select coalesce(sum(x.net_qty), 0)::bigint as units
      from l x where x.category_id = v_item.category_id),
  bought as (
    select o.menu_item_id, count(distinct o.order_id) as orders
      from l o
     where o.menu_item_id <> v_item.id
       and o.order_id in (select m.order_id from mine m)
     group by o.menu_item_id
     order by count(distinct o.order_id) desc, o.menu_item_id
     limit 5)
  select agg.units, agg.revenue, coalesce(agg.cost_sold, cost_now.cost), agg.days, cat.units,
         coalesce((select jsonb_agg(jsonb_build_object(
                            'item_id', b.menu_item_id, 'name_en', bi.name_en, 'name_ar', bi.name_ar,
                            'count', b.orders)
                          order by b.orders desc, bi.name_en)
                     from bought b
                     join menu_items bi on bi.id = b.menu_item_id), '[]'::jsonb)
    into v_units, v_revenue, v_cost, v_days, v_cat_units, v_bought
    from agg, cost_now, cat;
  v_margin := case when v_units > 0 and v_cost is not null then v_revenue - v_cost end;

  select coalesce(jsonb_agg(to_jsonb(n.body) order by n.created_at, n.id), '[]'::jsonb)
    into v_notes
    from release_notes n
   where n.menu_item_id = v_item.id;

  select coalesce(jsonb_agg(to_jsonb(m.body) order by m.created_at, m.id), '[]'::jsonb)
    into v_take
    from marketing_notes m
   where m.venue_id = v_run.venue_id
     and ((m.subject_kind = 'item' and m.subject_id = v_item.id)
          or (m.subject_kind = 'run' and m.subject_id = v_run.id));

  -- A campaign-effect claim needs a measurable campaign: one that carried a
  -- promotion (the marketing step's, or any campaign linked to the run).
  v_promo := exists (
    select 1 from marketing_campaigns c
     where c.venue_id = v_run.venue_id
       and c.promotion_id is not null
       and (c.protocol_run_id = v_run.id
            or c.id in (select (x.record->>'campaign_id')::uuid
                          from protocol_submissions x
                          join protocol_run_steps s on s.id = x.run_step_id
                         where x.run_id = v_run.id and s.step_key = 'marketing'
                           and x.decision in ('approve', 'auto')
                           and x.record ? 'campaign_id')));

  return jsonb_build_object(
    'item',    jsonb_build_object('name_en', v_item.name_en, 'name_ar', v_item.name_ar),
    'numbers', jsonb_build_object(
      'units',              v_units,
      'revenue_iqd',        v_revenue,
      'margin_iqd',         v_margin,
      'margin_pct',         case when v_margin is not null and v_revenue > 0
                                 then round(v_margin * 100.0 / v_revenue, 1) end,
      'category_share_pct', case when v_cat_units > 0 then round(v_units * 100.0 / v_cat_units, 1) end,
      'days_sold',          v_days,
      'bought_with',        v_bought,
      'from',               app.business_date(v_from, v_tz, v_start_hour),
      'to',                 app.business_date(v_to, v_tz, v_start_hour)),
    'notes',                  v_notes,
    'marketing_take',         v_take,
    'campaign_has_promotion', v_promo);
end $release_review_input_0173$;

comment on function app.release_review_input(uuid) is
  'release_post_launch (§2.10). Service role; the release-review function''s ONLY model input (SEC-29 scans it by name): {item: {name_en, name_ar}, numbers: {units, revenue_iqd, margin_iqd, margin_pct, category_share_pct, days_sold, bought_with: [{item_id, name_en, name_ar, count}], from, to}, notes: [text], marketing_take: [text], campaign_has_promotion}. Numbers from the item''s settled sales lines in its first 30 days (app.analytics_sales_lines, the rows report_cafe reads) and v_item_margin; notes and marketing''s take as text only, no author. Never calls report_cafe.';

revoke all on function app.release_review_input(uuid) from public, anon, authenticated;
grant execute on function app.release_review_input(uuid) to service_role;

-- The review is written: saved (once more on a retry), the run done, and the
-- owners and the run venue's managers told. A failed save keeps the run live
-- so the next day's tick tries again.
create or replace function app.release_review_save(
  p_run_id   uuid,
  p_numbers  jsonb,
  p_write_up jsonb,
  p_status   text,
  p_model    text
) returns jsonb
language plpgsql security definer set search_path = public as $release_review_save_0173$
declare
  v_run protocol_runs%rowtype;
begin
  select * into v_run from protocol_runs where id = p_run_id for update;
  if not found or v_run.kind <> 'product_release' then
    raise exception 'PROTOCOL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_status is null or p_status not in ('written', 'thin', 'fallback', 'failed') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'status';
  end if;
  if p_numbers is null or jsonb_typeof(p_numbers) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'numbers';
  end if;
  if p_status <> 'failed'
     and (p_write_up is null or jsonb_typeof(p_write_up) <> 'object'
          or jsonb_typeof(p_write_up->'en') is distinct from 'string'
          or jsonb_typeof(p_write_up->'ar') is distinct from 'string') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'write_up';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  insert into release_reviews (run_id, venue_id, menu_item_id, numbers, write_up, status, model, written_at)
  values (v_run.id, v_run.venue_id, v_run.menu_item_id, p_numbers,
          case when p_status <> 'failed' then p_write_up end, p_status,
          nullif(btrim(coalesce(p_model, '')), ''),
          case when p_status <> 'failed' then now() end)
  on conflict (run_id) do update
     set numbers      = excluded.numbers,
         write_up     = excluded.write_up,
         status       = excluded.status,
         model        = excluded.model,
         written_at   = excluded.written_at,
         menu_item_id = excluded.menu_item_id;

  if p_status <> 'failed' and v_run.status = 'live' then
    update protocol_runs set status = 'done', finished_at = now() where id = v_run.id;
    perform app.protocol_engine_notify(app.staff_ids_with_roles(v_run.venue_id, '{manager,owner}'),
                                       'staff_info', 'review_ready', 'staff-run',
                                       v_run.id, v_run.id, null);
    perform app.write_audit('protocol.release.review', 'protocol_run', v_run.id::text,
      jsonb_build_object('status', 'live'),
      jsonb_build_object('status', 'done', 'review', p_status));
  end if;

  return jsonb_build_object('run_id', v_run.id, 'status', p_status,
                            'run_status', (select r.status from protocol_runs r where r.id = v_run.id));
end $release_review_save_0173$;

comment on function app.release_review_save(uuid, jsonb, jsonb, text, text) is
  'release_post_launch (§2.10). Service role: saves a run''s day-30 review (status written, thin, fallback or failed; a write-up {en, ar} unless failed). Unless failed, a live run goes to done and the owners and the run venue''s managers are told (staff_info / review_ready), never a starter who is not MGMT (#54). Audit protocol.release.review. Returns {run_id, status, run_status}.';

revoke all on function app.release_review_save(uuid, jsonb, jsonb, text, text) from public, anon, authenticated;
grant execute on function app.release_review_save(uuid, jsonb, jsonb, text, text) to service_role;

-- Stopped and withdrawn runs of any kind keep their photos for 90 days.
create or replace function app.protocol_photo_purge_due(p_limit int default 20)
returns jsonb
language sql stable security definer set search_path = public as $protocol_photo_purge_due_0173$
  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id', d.id,
           'paths',  coalesce((select to_jsonb(array_agg(distinct p order by p))
                                 from protocol_submissions x
                                 cross join lateral unnest(x.photos) as p
                                where x.run_id = d.id), '[]'::jsonb))
         order by d.finished_at, d.id), '[]'::jsonb)
    from (select r.id, r.finished_at
            from protocol_runs r
           where r.status in ('stopped', 'withdrawn')
             and r.finished_at + interval '90 days' <= now()
             and r.photos_purged_at is null
           order by r.finished_at, r.id
           limit greatest(coalesce(p_limit, 20), 1)) d
$protocol_photo_purge_due_0173$;

comment on function app.protocol_photo_purge_due(int) is
  'release_post_launch (§2.10). Service role: [{run_id, paths}], runs of any kind stopped or withdrawn 90 days ago whose photos are not purged yet, with every staff-media path their submissions carry; protocol-action removes the objects and calls app.protocol_photos_purged.';

revoke all on function app.protocol_photo_purge_due(int) from public, anon, authenticated;
grant execute on function app.protocol_photo_purge_due(int) to service_role;

create or replace function app.protocol_photos_purged(p_run_id uuid)
returns void
language sql security definer set search_path = public as $protocol_photos_purged_0173$
  update protocol_runs set photos_purged_at = now()
   where id = p_run_id and photos_purged_at is null
$protocol_photos_purged_0173$;

comment on function app.protocol_photos_purged(uuid) is
  'release_post_launch (§2.10). Service role: marks a stopped or withdrawn run''s photos removed from storage.';

revoke all on function app.protocol_photos_purged(uuid) from public, anon, authenticated;
grant execute on function app.protocol_photos_purged(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. The nudges and the two cron jobs (§2.19), in the 0113 shape: a POST of
--    {action:'tick'} through pg_net, only while there is something to do.
-- ---------------------------------------------------------------------------
create or replace function app.protocol_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $protocol_tick_nudge_0173$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from protocol_runs r
                    where r.kind = 'product_release' and r.status = 'scheduled'
                      and r.scheduled_for <= now())
       and not exists (select 1 from protocol_runs r
                        where r.status in ('stopped', 'withdrawn')
                          and r.finished_at + interval '90 days' <= now()
                          and r.photos_purged_at is null) then
      return;                                  -- nothing due: no HTTP
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/protocol-action',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'protocol_tick_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $protocol_tick_nudge_0173$;

comment on function app.protocol_tick_nudge() is
  'release_post_launch (§2.19). Every 5 minutes (tp_protocol_tick): asks protocol-action to launch the scheduled releases whose date has come and to remove the photos of runs stopped or withdrawn 90 days ago. Posts nothing when nothing is due; silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.protocol_tick_nudge() from public, anon, authenticated;

create or replace function app.release_review_nudge()
returns void
language plpgsql security definer set search_path = public as $release_review_nudge_0173$
declare
  v_base text;
  v_key  text;
begin
  begin
    if jsonb_array_length(app.release_due_reviews(1)) = 0 then
      return;                                  -- nothing due: no HTTP
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/release-review',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'release_review_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $release_review_nudge_0173$;

comment on function app.release_review_nudge() is
  'release_post_launch (§2.19). Daily (tp_release_review): asks release-review to write the day-30 reviews that are due. Posts nothing when none is; silent without pg_net or the two secrets; swallows its own errors.';

revoke all on function app.release_review_nudge() from public, anon, authenticated;

do $release_cron_0173$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - protocol ticks skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_protocol_tick and tp_release_review not scheduled';
    return;
  end if;

  -- cron.schedule upserts by job name (0021).
  perform cron.schedule('tp_protocol_tick', '*/5 * * * *', 'select app.protocol_tick_nudge();');
  perform cron.schedule('tp_release_review', '20 4 * * *', 'select app.release_review_nudge();');
end $release_cron_0173$;

-- ---------------------------------------------------------------------------
-- 6. Owner assistant: the two tables join the table_read allowlist (the 0144
--    statement, limited to this migration's tables, §1.5). The review's
--    numbers and write-up are jsonb, so not default reads.
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   and c.table_name in ('release_reviews', 'release_notes')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
