-- 0165 checklists — the daily open and close lists per role: the owner's templates,
-- today's shared list for each role, the tick, and the day-close read.
--
-- Feature: protocols and the staff phone, lane C
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.14; plan §6.4, §7.3).
-- Depends on: staff_push (G: app.staff_ids_with_roles, "roles someone holds").
-- The phone's Today and staff-checklist (H), and the operator's Daily
-- checklists card, its editor and the day-close section (I) read through it.
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE SHAPE. The owner writes one list per venue, role and slot (open or
-- close), EN and AR. The first read of a business day by anyone holding the
-- role SNAPSHOTS the list into checklist_runs / checklist_run_items (the
-- PROPOSAL that replaces the plan's checklist_marks), so an owner's edit in
-- the middle of the day changes tomorrow's list and never orphans a tick made
-- this morning. Everyone holding the role at the venue ticks the one shared
-- list; each tick keeps who and when.
--
-- THE DAY. app.venue_business_date: the three-argument business_date in the
-- venue's own timezone with the analytics start hour (never the one-argument
-- 0034 form, which reads venue_settings unqualified). Slice 2 owns moving the
-- start hour per venue.
--
-- WHAT IT IS NOT. No per-person history and no report that ranks people
-- (SOW:265, :480): the reads return today's lists and the tickers' names on
-- them, nothing per person across days. Day close only warns (I's section).
--
-- WHO READS. The four tables are MGMT at the venue (the any-staff vs explicit
-- list rule, §2.1: a tick carries a person's name and free text). Staff read
-- their own role's lists through my_checklists_today. No client holds an
-- insert, update or delete grant: every write is a definer RPC.
--
-- covered by packages/db/tests/checklists.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Tables.
-- ---------------------------------------------------------------------------
create table if not exists checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id),
  role        staff_role not null,
  slot        text not null check (slot in ('open','close')),
  name_en     text not null check (coalesce(length(btrim(name_en)),0) > 0),
  name_ar     text not null check (coalesce(length(btrim(name_ar)),0) > 0),
  version     int not null default 1,
  updated_by  uuid references staff(id),
  updated_at  timestamptz not null default now(),
  constraint checklist_templates_role_slot_key unique (venue_id, role, slot)
);

create table if not exists checklist_template_items (
  id           uuid primary key default gen_random_uuid(),
  template_id  uuid not null references checklist_templates(id) on delete cascade,
  position     int not null check (position >= 1),
  text_en      text not null check (coalesce(length(btrim(text_en)),0) > 0),
  text_ar      text not null check (coalesce(length(btrim(text_ar)),0) > 0),
  constraint checklist_template_items_position_key unique (template_id, position) deferrable initially deferred
);

create table if not exists checklist_runs (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id),
  template_id    uuid not null references checklist_templates(id),
  role           staff_role not null,
  slot           text not null check (slot in ('open','close')),
  business_date  date not null,
  created_at     timestamptz not null default now(),
  constraint checklist_runs_template_day_key unique (template_id, business_date)
);

create table if not exists checklist_run_items (
  id        uuid primary key default gen_random_uuid(),
  run_id    uuid not null references checklist_runs(id) on delete cascade,
  position  int not null,
  text_en   text not null,
  text_ar   text not null,
  done_by   uuid references staff(id),
  done_at   timestamptz,
  note      text check (note is null or length(note) <= 300),
  constraint checklist_run_items_done_chk check ((done_by is null) = (done_at is null))
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (new, empty tables: the header's waiver). The unique keys above
--    already index templates by venue and runs by template and day.
-- ---------------------------------------------------------------------------
create index if not exists checklist_run_items_run_idx on checklist_run_items (run_id);

-- ---------------------------------------------------------------------------
-- 3. Comments.
-- ---------------------------------------------------------------------------
comment on table checklist_templates is
  'checklists (§2.14): the owner''s open or close list for one role at one venue, EN and AR, saved through app.save_checklist_template. Each business day''s list is a checklist_runs snapshot of it. Read by MGMT at the venue.';
comment on column checklist_templates.id is 'Checklist template id.';
comment on column checklist_templates.venue_id is 'The venue the list belongs to.';
comment on column checklist_templates.role is 'The role whose list this is; everyone holding it at the venue ticks the same list. Never prep (soft-retired).';
comment on column checklist_templates.slot is 'open (start of the day) or close (end of the day).';
comment on column checklist_templates.name_en is 'List name, English.';
comment on column checklist_templates.name_ar is 'List name, Arabic.';
comment on column checklist_templates.version is 'Bumped by every save; a save with a stale version is refused TEMPLATE_CHANGED.';
comment on column checklist_templates.updated_by is 'The owner who saved it last.';
comment on column checklist_templates.updated_at is 'When it was last saved.';

comment on table checklist_template_items is
  'checklists (§2.14): the lines of a checklist template, in order. Copied into each day''s run on its first read.';
comment on column checklist_template_items.id is 'Template line id.';
comment on column checklist_template_items.template_id is 'The checklist template.';
comment on column checklist_template_items.position is 'Order in the list, from 1.';
comment on column checklist_template_items.text_en is 'Checklist line, English.';
comment on column checklist_template_items.text_ar is 'Checklist line, Arabic.';

comment on table checklist_runs is
  'checklists (§2.14): one role''s list for one business day, created by the first read of that day (app.my_checklists_today) as a snapshot of the template, so a later edit of the template never orphans a tick. Read by MGMT at the venue.';
comment on column checklist_runs.id is 'Checklist run id.';
comment on column checklist_runs.venue_id is 'The venue.';
comment on column checklist_runs.template_id is 'The template it was snapshotted from.';
comment on column checklist_runs.role is 'The role the list is for (copied from the template).';
comment on column checklist_runs.slot is 'open or close (copied from the template).';
comment on column checklist_runs.business_date is 'The business day, in the venue''s timezone with the analytics start hour (app.venue_business_date).';
comment on column checklist_runs.created_at is 'When the day''s list was first opened.';

comment on table checklist_run_items is
  'checklists (§2.14): the lines of one day''s list and their ticks. Ticked through app.mark_checklist_item by anyone holding the role at the venue, or MGMT; the row keeps who and when.';
comment on column checklist_run_items.id is 'Run line id.';
comment on column checklist_run_items.run_id is 'The day''s list.';
comment on column checklist_run_items.position is 'Order in the list, from 1.';
comment on column checklist_run_items.text_en is 'Checklist line, English, as snapshotted.';
comment on column checklist_run_items.text_ar is 'Checklist line, Arabic, as snapshotted.';
comment on column checklist_run_items.done_by is 'Who ticked it; NULL while open.';
comment on column checklist_run_items.done_at is 'When it was ticked; NULL while open.';
comment on column checklist_run_items.note is 'An optional note on the line (at most 300 characters), in the writer''s language.';

-- ---------------------------------------------------------------------------
-- 4. RLS: select-only, MGMT at the venue; the children by an inline exists on
--    their parent (0106/0136: every policy is planned for every caller).
-- ---------------------------------------------------------------------------
alter table checklist_templates      enable row level security;
alter table checklist_template_items enable row level security;
alter table checklist_runs           enable row level security;
alter table checklist_run_items      enable row level security;

drop policy if exists checklist_templates_mgmt_read on checklist_templates;
create policy checklist_templates_mgmt_read on checklist_templates
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists checklist_template_items_mgmt_read on checklist_template_items;
create policy checklist_template_items_mgmt_read on checklist_template_items
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from checklist_templates t
                      where t.id = checklist_template_items.template_id
                        and t.venue_id = any(app.staff_venue_ids())));

drop policy if exists checklist_runs_mgmt_read on checklist_runs;
create policy checklist_runs_mgmt_read on checklist_runs
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists checklist_run_items_mgmt_read on checklist_run_items;
create policy checklist_run_items_mgmt_read on checklist_run_items
  for select to authenticated
  using (app.is_staff('manager','owner')
         and exists (select 1 from checklist_runs r
                      where r.id = checklist_run_items.run_id
                        and r.venue_id = any(app.staff_venue_ids())));

grant select on checklist_templates, checklist_template_items, checklist_runs, checklist_run_items
  to authenticated;
grant all on checklist_templates, checklist_template_items, checklist_runs, checklist_run_items
  to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.venue_business_date — internal. The venue's business day at p_at.
-- ---------------------------------------------------------------------------
create or replace function app.venue_business_date(p_venue uuid, p_at timestamptz default now())
returns date
language sql stable security definer set search_path = public as $venue_business_date_0165$
  select app.business_date(
           p_at,
           coalesce((select v.timezone from venues v where v.id = p_venue), 'Asia/Baghdad'),
           coalesce(app.cafe_setting_int('analytics_business_day_start_hour'), 4))
$venue_business_date_0165$;

comment on function app.venue_business_date(uuid, timestamptz) is
  'checklists (§2.14). Internal: the venue''s business day at p_at, through the three-argument app.business_date with the venue''s own timezone and the analytics_business_day_start_hour setting (default 4). Never the one-argument 0034 form.';

revoke all on function app.venue_business_date(uuid, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.my_checklists_today — any active staff member at the venue: their
--    own role's lists for today. The first read of the day snapshots each
--    list that has lines; a list nobody opened yet has no run and no row here.
-- ---------------------------------------------------------------------------
create or replace function app.my_checklists_today(p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $my_checklists_today_0165$
declare
  v_role  staff_role := app.staff_role();
  v_venue uuid;
  v_date  date;
  v_tpl   record;
  v_run   uuid;
  v_lists jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_date := app.venue_business_date(v_venue);

  -- Two phones opening the list at once: the second insert waits for the
  -- first and does nothing, and the read below sees the first one's lines.
  for v_tpl in
    select t.id, t.role, t.slot
      from checklist_templates t
     where t.venue_id = v_venue
       and t.role = v_role
       and exists (select 1 from checklist_template_items i where i.template_id = t.id)
       and not exists (select 1 from checklist_runs r
                        where r.template_id = t.id and r.business_date = v_date)
  loop
    v_run := null;
    insert into checklist_runs (venue_id, template_id, role, slot, business_date)
    values (v_venue, v_tpl.id, v_tpl.role, v_tpl.slot, v_date)
    on conflict (template_id, business_date) do nothing
    returning id into v_run;
    if v_run is not null then
      insert into checklist_run_items (run_id, position, text_en, text_ar)
      select v_run, i.position, i.text_en, i.text_ar
        from checklist_template_items i
       where i.template_id = v_tpl.id;
    end if;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
           'run_id',  r.id,
           'role',    r.role,
           'slot',    r.slot,
           'name_en', t.name_en,
           'name_ar', t.name_ar,
           'done',    (select count(*) from checklist_run_items i where i.run_id = r.id and i.done_at is not null),
           'total',   (select count(*) from checklist_run_items i where i.run_id = r.id),
           'items',   (select coalesce(jsonb_agg(jsonb_build_object(
                                'id',           i.id,
                                'position',     i.position,
                                'text_en',      i.text_en,
                                'text_ar',      i.text_ar,
                                'done_by_name', s.display_name,
                                'done_at',      i.done_at,
                                'note',         i.note)
                              order by i.position, i.id), '[]'::jsonb)
                         from checklist_run_items i
                         left join staff s on s.id = i.done_by
                        where i.run_id = r.id))
         order by case r.slot when 'open' then 1 else 2 end, r.id), '[]'::jsonb)
    into v_lists
    from checklist_runs r
    join checklist_templates t on t.id = r.template_id
   where r.venue_id = v_venue
     and r.role = v_role
     and r.business_date = v_date;

  return jsonb_build_object('business_date', v_date, 'lists', v_lists);
end $my_checklists_today_0165$;

comment on function app.my_checklists_today(uuid) is
  'checklists (§2.14). Any active staff member at the venue: today''s lists for the caller''s own role, {business_date, lists: [{run_id, role, slot, name_en, name_ar, done, total, items: [{id, position, text_en, text_ar, done_by_name, done_at, note}]}]}, open before close. Creates today''s run of each of the role''s lists that has lines, as a snapshot of the template. FORBIDDEN for a venue the caller does not work at.';

revoke all on function app.my_checklists_today(uuid) from public, anon;
grant execute on function app.my_checklists_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.mark_checklist_item — a holder of the list's role at its venue, or
--    MGMT. State-idempotent: ticking a ticked line keeps its first ticker.
--    p_note NULL leaves the note as it is; a blank one clears it.
-- ---------------------------------------------------------------------------
create or replace function app.mark_checklist_item(
  p_item_id uuid,
  p_done    boolean,
  p_note    text default null
) returns jsonb
language plpgsql security definer set search_path = public as $mark_checklist_item_0165$
declare
  v_item checklist_run_items%rowtype;
  v_run  checklist_runs%rowtype;
  v_note text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_item from checklist_run_items where id = p_item_id for update;
  if found then
    select * into v_run from checklist_runs where id = v_item.run_id;
  end if;
  if v_run.id is null or not (v_run.venue_id = any(app.staff_venue_ids())) then
    raise exception 'CHECKLIST_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (app.is_staff_at(v_run.venue_id, v_run.role)
          or app.is_staff_at(v_run.venue_id, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_run.venue_id::text, true);

  if p_done is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'done';
  end if;
  if p_note is not null then
    v_note := nullif(btrim(p_note), '');
    if length(v_note) > 300 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
    end if;
  end if;

  update checklist_run_items
     set done_by = case when p_done then coalesce(done_by, auth.uid()) end,
         done_at = case when p_done then coalesce(done_at, now()) end,
         note    = case when p_note is null then note else v_note end
   where id = p_item_id
   returning * into v_item;

  return jsonb_build_object(
    'id',           v_item.id,
    'position',     v_item.position,
    'text_en',      v_item.text_en,
    'text_ar',      v_item.text_ar,
    'done_by_name', (select s.display_name from staff s where s.id = v_item.done_by),
    'done_at',      v_item.done_at,
    'note',         v_item.note);
end $mark_checklist_item_0165$;

comment on function app.mark_checklist_item(uuid, boolean, text) is
  'checklists (§2.14). Ticks (p_done true) or unticks one line of a day''s list: anyone holding the list''s role at its venue, or MGMT. A repeat tick keeps the first ticker and time. p_note (at most 300) sets the line''s note, blank clears it, NULL leaves it. Returns the line {id, position, text_en, text_ar, done_by_name, done_at, note}. CHECKLIST_NOT_FOUND for a line at a venue the caller does not work at; FORBIDDEN for another role; TEXT_TOO_LONG (hint note).';

revoke all on function app.mark_checklist_item(uuid, boolean, text) from public, anon;
grant execute on function app.mark_checklist_item(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.checklist_board — MGMT at the venue: every template with its lines
--    and the day's state of its list (NULL when nobody opened it that day).
--    A read: it creates no run.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_board(
  p_venue_id      uuid default null,
  p_business_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $checklist_board_0165$
declare
  v_venue uuid;
  v_date  date;
  v_rows  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_date := coalesce(p_business_date, app.venue_business_date(v_venue));

  select coalesce(jsonb_agg(jsonb_build_object(
           'template_id', t.id,
           'role',        t.role,
           'slot',        t.slot,
           'name_en',     t.name_en,
           'name_ar',     t.name_ar,
           'version',     t.version,
           'items',       (select coalesce(jsonb_agg(jsonb_build_object(
                                    'position', i.position, 'text_en', i.text_en, 'text_ar', i.text_ar)
                                  order by i.position), '[]'::jsonb)
                             from checklist_template_items i
                            where i.template_id = t.id),
           'today',       (select jsonb_build_object(
                                    'run_id', r.id,
                                    'done',   (select count(*) from checklist_run_items ri
                                                where ri.run_id = r.id and ri.done_at is not null),
                                    'total',  (select count(*) from checklist_run_items ri where ri.run_id = r.id),
                                    'items',  (select coalesce(jsonb_agg(jsonb_build_object(
                                                        'text_en',      ri.text_en,
                                                        'text_ar',      ri.text_ar,
                                                        'done_by_name', s.display_name,
                                                        'done_at',      ri.done_at,
                                                        'note',         ri.note)
                                                      order by ri.position, ri.id), '[]'::jsonb)
                                                 from checklist_run_items ri
                                                 left join staff s on s.id = ri.done_by
                                                where ri.run_id = r.id))
                             from checklist_runs r
                            where r.template_id = t.id and r.business_date = v_date))
         order by t.role, case t.slot when 'open' then 1 else 2 end), '[]'::jsonb)
    into v_rows
    from checklist_templates t
   where t.venue_id = v_venue;

  return jsonb_build_object('business_date', v_date, 'templates', v_rows);
end $checklist_board_0165$;

comment on function app.checklist_board(uuid, date) is
  'checklists (§2.14). MGMT at the venue: {business_date, templates: [{template_id, role, slot, name_en, name_ar, version, items: [{position, text_en, text_ar}], today: {run_id, done, total, items: [{text_en, text_ar, done_by_name, done_at, note}]} | null}]} for the business day asked (default today). Creates nothing. FORBIDDEN for anyone else.';

revoke all on function app.checklist_board(uuid, date) from public, anon;
grant execute on function app.checklist_board(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.save_checklist_template — the owner writes one role's open or close
--    list. The first save of a list expects version 0 (or NULL); every later
--    one the version it read. The lines are replaced whole; today's run keeps
--    its snapshot.
-- ---------------------------------------------------------------------------
create or replace function app.save_checklist_template(
  p_venue_id         uuid,
  p_role             staff_role,
  p_slot             text,
  p_expected_version int,
  p_name_en          text,
  p_name_ar          text,
  p_items            jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $save_checklist_template_0165$
declare
  v_venue  uuid;
  v_en     text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_ar     text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_el     jsonb;
  v_ten    text;
  v_tar    text;
  v_texts  text[] := '{}';
  v_textsa text[] := '{}';
  v_before int;
  v_tpl    checklist_templates%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_role is null or p_role = 'prep' then
    raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'role';
  end if;
  if p_slot is null or p_slot not in ('open', 'close') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'slot';
  end if;
  if v_en is null or v_ar is null then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'name';
  end if;
  if length(v_en) > 120 or length(v_ar) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'name';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if jsonb_array_length(p_items) > 30 then
    raise exception 'LIST_TOO_LONG' using errcode = 'P0001', hint = 'items';
  end if;
  for v_el in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_ten := nullif(btrim(coalesce(v_el->>'text_en', '')), '');
    v_tar := nullif(btrim(coalesce(v_el->>'text_ar', '')), '');
    if v_ten is null or v_tar is null then
      raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'items';
    end if;
    if length(v_ten) > 200 or length(v_tar) > 200 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'items';
    end if;
    v_texts  := v_texts  || v_ten;
    v_textsa := v_textsa || v_tar;
  end loop;

  select * into v_tpl from checklist_templates
   where venue_id = v_venue and role = p_role and slot = p_slot
   for update;
  if not found then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := 0;
    insert into checklist_templates (venue_id, role, slot, name_en, name_ar, version, updated_by)
    values (v_venue, p_role, p_slot, v_en, v_ar, 1, auth.uid())
    on conflict (venue_id, role, slot) do nothing
    returning * into v_tpl;
    -- Another owner's first save landed between the read and the insert.
    if v_tpl.id is null then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
  else
    if p_expected_version is distinct from v_tpl.version then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := v_tpl.version;
    update checklist_templates
       set name_en = v_en, name_ar = v_ar, version = version + 1,
           updated_by = auth.uid(), updated_at = now()
     where id = v_tpl.id
     returning * into v_tpl;
    delete from checklist_template_items where template_id = v_tpl.id;
  end if;

  insert into checklist_template_items (template_id, position, text_en, text_ar)
  select v_tpl.id, x.o, x.en, v_textsa[x.o]
    from unnest(v_texts) with ordinality as x(en, o);

  perform app.write_audit('checklist.template.save', 'checklist_template', v_tpl.id::text,
                          jsonb_build_object('version', v_before),
                          jsonb_build_object('role', p_role, 'slot', p_slot, 'version', v_tpl.version,
                                             'items', cardinality(v_texts)));

  return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version);
end $save_checklist_template_0165$;

comment on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) is
  'checklists (§2.14). Owner only: writes the venue''s open or close list for one role, names and lines ([{text_en, text_ar}], at most 30, both languages, 200 characters each) replaced whole. p_expected_version is 0 (or NULL) for a new list, else the version read. Returns {template_id, version}. INVALID_ROLE (prep), INVALID_ARGUMENT (slot), TEMPLATE_CHANGED, LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED, TEXT_TOO_LONG. Audit checklist.template.save. A day''s list already opened keeps its snapshot.';

revoke all on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) from public, anon;
grant execute on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.checklist_day_state — MGMT at the venue: the day-close warning.
--     Every list with lines whose role someone active holds at the venue: its
--     day's run when opened, else the template as it stands (nothing done).
--     A read: it creates no run.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_day_state(
  p_venue_id      uuid default null,
  p_business_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $checklist_day_state_0165$
declare
  v_venue uuid;
  v_date  date;
  v_lists jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_date := coalesce(p_business_date, app.venue_business_date(v_venue));

  select coalesce(jsonb_agg(jsonb_build_object(
           'role',       x.role,
           'slot',       x.slot,
           'name_en',    x.name_en,
           'name_ar',    x.name_ar,
           'total',      x.total,
           'done',       x.done,
           'open_items', x.open_items)
         order by x.role, case x.slot when 'open' then 1 else 2 end), '[]'::jsonb)
    into v_lists
    from (
      select t.role, t.slot, t.name_en, t.name_ar,
             case when r.id is not null
                  then (select count(*) from checklist_run_items ri where ri.run_id = r.id)
                  else (select count(*) from checklist_template_items ti where ti.template_id = t.id)
             end as total,
             case when r.id is not null
                  then (select count(*) from checklist_run_items ri
                         where ri.run_id = r.id and ri.done_at is not null)
                  else 0
             end as done,
             case when r.id is not null
                  then (select coalesce(jsonb_agg(jsonb_build_object('text_en', ri.text_en, 'text_ar', ri.text_ar)
                                                  order by ri.position, ri.id), '[]'::jsonb)
                          from checklist_run_items ri
                         where ri.run_id = r.id and ri.done_at is null)
                  else (select coalesce(jsonb_agg(jsonb_build_object('text_en', ti.text_en, 'text_ar', ti.text_ar)
                                                  order by ti.position), '[]'::jsonb)
                          from checklist_template_items ti
                         where ti.template_id = t.id)
             end as open_items
        from checklist_templates t
        left join checklist_runs r on r.template_id = t.id and r.business_date = v_date
       where t.venue_id = v_venue
         and cardinality(app.staff_ids_with_roles(v_venue, array[t.role])) > 0
         and (case when r.id is not null
                   then exists (select 1 from checklist_run_items ri where ri.run_id = r.id)
                   else exists (select 1 from checklist_template_items ti where ti.template_id = t.id)
              end)
    ) x;

  return jsonb_build_object('business_date', v_date, 'lists', v_lists);
end $checklist_day_state_0165$;

comment on function app.checklist_day_state(uuid, date) is
  'checklists (§2.14, plan §7.3). MGMT at the venue: {business_date, lists: [{role, slot, name_en, name_ar, total, done, open_items: [{text_en, text_ar}]}]} for the business day asked (default today): every list with lines whose role an active staff member holds at the venue, from its day''s run when opened, else from the template with nothing done. Day close shows it as a warning, never a block. Creates nothing.';

revoke all on function app.checklist_day_state(uuid, date) from public, anon;
grant execute on function app.checklist_day_state(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. Owner assistant: the four tables join the table_read allowlist (the
--     0144 statement, limited to this migration's tables, §1.5; never the
--     all-table catch-up).
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
   and c.table_name in ('checklist_templates', 'checklist_template_items', 'checklist_runs',
                        'checklist_run_items')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
