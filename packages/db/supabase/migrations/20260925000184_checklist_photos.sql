-- 0184 checklist_photos — a checklist line may need a photo when it is ticked.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.8, §2.14; plan #69).
-- Depends on: staff_media_folders (J: the checklists folder and the
-- checklist_item: read rule in app.staff_media_visible).
-- Re-issues (§2.18): app.my_checklists_today, app.checklist_board and
-- app.save_checklist_template from 0165, same signatures;
-- app.mark_checklist_item from 0165 with a SIGNATURE CHANGE: dropped by its
-- exact (uuid, boolean, text) signature and created as (uuid, boolean, text,
-- text), with its revoke and grant re-issued. A call with three named
-- arguments still resolves (p_photo_path has a default), so
-- fixtures/rpc-overloads.json gains nothing. checklist_day_state is unchanged.
-- Re-runnable: add column if not exists, guarded constraint work, drop
-- function if exists, create or replace.
--
-- THE RULE (#69). The owner marks a line "Needs a photo" in the template. The
-- day's run copies the flag with the line's text, so an owner's edit in the
-- middle of the day changes tomorrow's list only. Ticking a flagged line
-- needs a photo: the one sent, or one already on the line. Any other line may
-- carry a photo too. Unticking clears the photo from the line; its slot stays
-- the line's (checklist_item:<id>), so a re-tick may send it again. Who reads
-- the photo: its uploader, MGMT, and the holders of the list's role at the
-- venue, who share the list (staff_media_folders). The waiter's cleaning list
-- waits for the parked waiter role (§0 P1); the flag works for every role.
--
-- No audit for a tick or its photo (PROPOSAL, §2.22): the line keeps who and
-- when.
--
-- covered by packages/db/tests/checklist-photos.test.ts and checklists.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Columns. Constant defaults, so neither table is rewritten.
-- ---------------------------------------------------------------------------
alter table checklist_template_items add column if not exists photo_required boolean not null default false;
alter table checklist_run_items      add column if not exists photo_required boolean not null default false;
alter table checklist_run_items      add column if not exists photo_path     text;

comment on column checklist_template_items.photo_required is
  'checklist_photos (§2.24.8): ticking this line needs a photo ("Needs a photo").';
comment on column checklist_run_items.photo_required is
  'checklist_photos (§2.24.8): copied from the template line when the day''s list was opened; a tick needs a photo.';
comment on column checklist_run_items.photo_path is
  'checklist_photos (§2.24.8): the tick''s photo, a staff-media path in the checklists folder claimed as checklist_item:<id>; NULL while unticked or with no photo.';

-- A ticked line that needs a photo has one. Added NOT VALID (every existing
-- line has the flag off), then validated under the lighter lock.
do $add_photo_chk_0184$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'checklist_run_items_photo_chk'
                    and conrelid = 'public.checklist_run_items'::regclass) then
    alter table checklist_run_items
      add constraint checklist_run_items_photo_chk
      check (not photo_required or done_at is null or photo_path is not null) not valid;
  end if;
end $add_photo_chk_0184$;

do $validate_photo_chk_0184$
begin
  if exists (select 1 from pg_constraint
              where conname = 'checklist_run_items_photo_chk'
                and conrelid = 'public.checklist_run_items'::regclass
                and not convalidated) then
    alter table checklist_run_items validate constraint checklist_run_items_photo_chk;
  end if;
end $validate_photo_chk_0184$;

-- ---------------------------------------------------------------------------
-- 2. app.my_checklists_today — 0165 verbatim, plus the flag copied into the
--    day's run and photo_required, photo_path on each line.
-- ---------------------------------------------------------------------------
create or replace function app.my_checklists_today(p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $my_checklists_today_0184$
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
      insert into checklist_run_items (run_id, position, text_en, text_ar, photo_required)
      select v_run, i.position, i.text_en, i.text_ar, i.photo_required
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
                                'id',             i.id,
                                'position',       i.position,
                                'text_en',        i.text_en,
                                'text_ar',        i.text_ar,
                                'done_by_name',   s.display_name,
                                'done_at',        i.done_at,
                                'note',           i.note,
                                'photo_required', i.photo_required,
                                'photo_path',     i.photo_path)
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
end $my_checklists_today_0184$;

comment on function app.my_checklists_today(uuid) is
  'checklists (§2.14), re-issued by checklist_photos (§2.24.8). Any active staff member at the venue: today''s lists for the caller''s own role, {business_date, lists: [{run_id, role, slot, name_en, name_ar, done, total, items: [{id, position, text_en, text_ar, done_by_name, done_at, note, photo_required, photo_path}]}]}, open before close. Creates today''s run of each of the role''s lists that has lines, as a snapshot of the template, "Needs a photo" included. FORBIDDEN for a venue the caller does not work at.';

revoke all on function app.my_checklists_today(uuid) from public, anon;
grant execute on function app.my_checklists_today(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.mark_checklist_item — 0165 plus p_photo_path. Signature change: the
--    three-argument function is dropped by its exact signature and the
--    four-argument one created, revoke and grant re-issued.
-- ---------------------------------------------------------------------------
drop function if exists app.mark_checklist_item(uuid, boolean, text);

create or replace function app.mark_checklist_item(
  p_item_id    uuid,
  p_done       boolean,
  p_note       text default null,
  p_photo_path text default null
) returns jsonb
language plpgsql security definer set search_path = public as $mark_checklist_item_0184$
declare
  v_item  checklist_run_items%rowtype;
  v_run   checklist_runs%rowtype;
  v_note  text;
  v_photo text := nullif(btrim(coalesce(p_photo_path, '')), '');
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

  -- checklist_photos (#69): a line that needs a photo is ticked with one, the
  -- one sent or the one it already carries. An untick sends none.
  if p_done then
    if v_item.photo_required and coalesce(v_photo, v_item.photo_path) is null then
      raise exception 'RECORD_INVALID' using errcode = 'P0001', hint = 'photo_path';
    end if;
    if v_photo is not null then
      perform app.claim_staff_media(array[v_photo], v_run.venue_id, array['checklists'],
                                    'checklist_item:' || v_item.id::text);
    end if;
  end if;

  update checklist_run_items
     set done_by    = case when p_done then coalesce(done_by, auth.uid()) end,
         done_at    = case when p_done then coalesce(done_at, now()) end,
         note       = case when p_note is null then note else v_note end,
         photo_path = case when p_done then coalesce(v_photo, photo_path) end
   where id = p_item_id
   returning * into v_item;

  return jsonb_build_object(
    'id',             v_item.id,
    'position',       v_item.position,
    'text_en',        v_item.text_en,
    'text_ar',        v_item.text_ar,
    'done_by_name',   (select s.display_name from staff s where s.id = v_item.done_by),
    'done_at',        v_item.done_at,
    'note',           v_item.note,
    'photo_required', v_item.photo_required,
    'photo_path',     v_item.photo_path);
end $mark_checklist_item_0184$;

comment on function app.mark_checklist_item(uuid, boolean, text, text) is
  'checklists (§2.14), re-created by checklist_photos (§2.24.8) with p_photo_path. Ticks (p_done true) or unticks one line of a day''s list: anyone holding the list''s role at its venue, or MGMT. A repeat tick keeps the first ticker and time. A line that needs a photo is ticked only with one, sent now (a checklists slot of the caller, claimed as checklist_item:<id>) or already on it; any line may carry one; a new photo replaces the line''s; an untick clears it. p_note (at most 300) sets the line''s note, blank clears it, NULL leaves it. Returns the line {id, position, text_en, text_ar, done_by_name, done_at, note, photo_required, photo_path}. CHECKLIST_NOT_FOUND for a line at a venue the caller does not work at; FORBIDDEN for another role; RECORD_INVALID (hint photo_path); PHOTO_PATH_INVALID; TEXT_TOO_LONG (hint note).';

revoke all on function app.mark_checklist_item(uuid, boolean, text, text) from public, anon;
grant execute on function app.mark_checklist_item(uuid, boolean, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.checklist_board — 0165 verbatim, plus photo_required on the
--    template's lines and photo_required, photo_path on the day's.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_board(
  p_venue_id      uuid default null,
  p_business_date date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $checklist_board_0184$
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
                                    'position', i.position, 'text_en', i.text_en, 'text_ar', i.text_ar,
                                    'photo_required', i.photo_required)
                                  order by i.position), '[]'::jsonb)
                             from checklist_template_items i
                            where i.template_id = t.id),
           'today',       (select jsonb_build_object(
                                    'run_id', r.id,
                                    'done',   (select count(*) from checklist_run_items ri
                                                where ri.run_id = r.id and ri.done_at is not null),
                                    'total',  (select count(*) from checklist_run_items ri where ri.run_id = r.id),
                                    'items',  (select coalesce(jsonb_agg(jsonb_build_object(
                                                        'text_en',        ri.text_en,
                                                        'text_ar',        ri.text_ar,
                                                        'done_by_name',   s.display_name,
                                                        'done_at',        ri.done_at,
                                                        'note',           ri.note,
                                                        'photo_required', ri.photo_required,
                                                        'photo_path',     ri.photo_path)
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
end $checklist_board_0184$;

comment on function app.checklist_board(uuid, date) is
  'checklists (§2.14), re-issued by checklist_photos (§2.24.8). MGMT at the venue: {business_date, templates: [{template_id, role, slot, name_en, name_ar, version, items: [{position, text_en, text_ar, photo_required}], today: {run_id, done, total, items: [{text_en, text_ar, done_by_name, done_at, note, photo_required, photo_path}]} | null}]} for the business day asked (default today). The operator opens a photo_path by signed URL. Creates nothing. FORBIDDEN for anyone else.';

revoke all on function app.checklist_board(uuid, date) from public, anon;
grant execute on function app.checklist_board(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.save_checklist_template — 0165 verbatim, plus each line's optional
--    photo_required (a boolean; anything else is INVALID_ARGUMENT, hint items).
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
language plpgsql security definer set search_path = public as $save_checklist_template_0184$
declare
  v_venue  uuid;
  v_en     text := nullif(btrim(coalesce(p_name_en, '')), '');
  v_ar     text := nullif(btrim(coalesce(p_name_ar, '')), '');
  v_el     jsonb;
  v_ten    text;
  v_tar    text;
  v_texts  text[] := '{}';
  v_textsa text[] := '{}';
  v_photos boolean[] := '{}';
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
    -- checklist_photos: "Needs a photo", absent or null meaning no.
    if coalesce(jsonb_typeof(v_el->'photo_required'), 'null') not in ('boolean', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_texts  := v_texts  || v_ten;
    v_textsa := v_textsa || v_tar;
    v_photos := v_photos || coalesce((v_el->>'photo_required')::boolean, false);
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

  insert into checklist_template_items (template_id, position, text_en, text_ar, photo_required)
  select v_tpl.id, x.o, x.en, v_textsa[x.o], v_photos[x.o]
    from unnest(v_texts) with ordinality as x(en, o);

  perform app.write_audit('checklist.template.save', 'checklist_template', v_tpl.id::text,
                          jsonb_build_object('version', v_before),
                          jsonb_build_object('role', p_role, 'slot', p_slot, 'version', v_tpl.version,
                                             'items', cardinality(v_texts)));

  return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version);
end $save_checklist_template_0184$;

comment on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) is
  'checklists (§2.14), re-issued by checklist_photos (§2.24.8). Owner only: writes the venue''s open or close list for one role, names and lines ([{text_en, text_ar, photo_required?}], at most 30, both languages, 200 characters each, photo_required a boolean) replaced whole. p_expected_version is 0 (or NULL) for a new list, else the version read. Returns {template_id, version}. INVALID_ROLE (prep), INVALID_ARGUMENT (slot, items), TEMPLATE_CHANGED, LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED, TEXT_TOO_LONG. Audit checklist.template.save. A day''s list already opened keeps its snapshot.';

revoke all on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) from public, anon;
grant execute on function app.save_checklist_template(uuid, staff_role, text, int, text, text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Owner assistant: the two tables' new columns join their table_read rows
--    (the 0144 statement, limited to these tables; the existing rows stay).
--    photo_path is not a default read.
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
   and c.table_name in ('checklist_template_items', 'checklist_run_items')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
