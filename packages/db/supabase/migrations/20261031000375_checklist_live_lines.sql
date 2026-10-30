set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0375 checklist_live_lines — checklists that follow the owner's edits, a
-- person's past lists, and the lists live over the realtime socket (Ameen,
-- 2026-10-31: a cashier with nothing left to fill had no way to see the
-- lists they filled before; a line the owner added to a list already
-- finished never reached the person, because the copy open now was a
-- snapshot; a list could be saved with no lines at all; and the operator's
-- card and the phones read the lists only on a timer).
--
--   1. app.checklist_sync_run_lines (internal): the copies of a list open now
--      (current on the branch's business day) follow its lines. A line the
--      list gained is added to each copy, unticked, so a finished copy is
--      unfinished again and comes back to the person's phone; an unticked line
--      the list lost is removed; a ticked line stays as it was ticked (who and
--      when), even when the list no longer has it. A line takes the list's
--      "needs a photo"; one that now needs a photo and was ticked without one
--      is unticked, so it is ticked again with the photo. Lines are matched by
--      their text in both languages, the k-th copy of a repeated text with the
--      k-th.
--      The rest of an occurrence's snapshot (who, when it is due, how it
--      repeats) still changes only from the next occurrence (0323 §0).
--   2. app.save_checklist: re-issued from 0323 verbatim, plus
--      CHECKLIST_NO_LINES (hint items) for a list with no line left after the
--      blank ones are dropped, and the sync above after an edit. The legacy
--      save_checklist_template (0323, operator stations on the old build) is
--      left as it is.
--   3. app.my_checklist_history (client, any active staff at the branch): the
--      caller's past lists, newest first, keyset paged: the lists that were
--      theirs (their own copies and their role's shared lists, the same rule
--      as my_checklists_today) and any list they ticked a line of, once the
--      list is no longer open (its occurrence ended, the next started, or the
--      owner archived it), each with its lines and who ticked them when.
--      SOW:480 / PRODUCT.md:37 still hold: one person's own lists as they
--      were, never a count across lists, a rate, a ranking or anyone else's.
--   4. Realtime: the private per-branch topic 'checklists:<venue>', event
--      'changed', payload {at} only, sent once per statement and branch by
--      app.rt_checklists from checklist_run_items (a tick, an untick, a copy
--      created or synced) and checklist_templates (a list saved or archived).
--      Readable by any active staff member who works at the branch
--      (touchpadel_rt_checklists). The phones' lists and the operator's
--      Checklists card re-read on it; their timers stay the safety net.
--      SEC-28 (check-broadcast-payloads.mjs) guards the topic (same commit).
--
-- Depends on: checklist_schedules (0323), realtime_per_venue (0224).
-- Re-issues: save_checklist (0323). Same signature, so no drop and no re-grant.
-- New: checklist_sync_run_lines, my_checklist_history, rt_checklists and five
-- statement triggers. No new table, column or index.
-- Re-runnable: create or replace, drop ... if exists before each trigger and
-- the policy.
--
-- covered by packages/db/tests/checklists.test.ts (the two 0375 cases)

-- ---------------------------------------------------------------------------
-- 1. app.checklist_sync_run_lines — internal: the open copies follow the list.
-- ---------------------------------------------------------------------------
create or replace function app.checklist_sync_run_lines(p_template_id uuid)
returns int
language plpgsql security definer set search_path = public as $checklist_sync_run_lines_0375$
declare
  v_tpl   checklist_templates%rowtype;
  v_today date;
  v_run   uuid;
  v_rows  bigint;
  v_n     int := 0;
begin
  select * into v_tpl from checklist_templates where id = p_template_id;
  if not found or v_tpl.archived_at is not null then
    return 0;
  end if;
  v_today := app.venue_business_date(v_tpl.venue_id);

  for v_run in
    select r.id
      from checklist_runs r
     where r.template_id = v_tpl.id
       and r.business_date <= v_today
       and app.checklist_current(r.template_id, r.business_date, r.period_end, v_today)
     order by r.id
  loop
    -- Both sides numbered within their own text, so a line written twice
    -- matches twice. One statement: every part reads the copy as it stood.
    with tpl as (
      select i.position, i.text_en, i.text_ar, i.photo_required,
             row_number() over (partition by i.text_en, i.text_ar order by i.position, i.id) as k
        from checklist_template_items i
       where i.template_id = v_tpl.id
    ), cur as (
      select ri.id, ri.text_en, ri.text_ar,
             row_number() over (partition by ri.text_en, ri.text_ar order by ri.position, ri.id) as k
        from checklist_run_items ri
       where ri.run_id = v_run
    ), pair as (
      select c.id as item_id, t.position, t.photo_required
        from cur c
        join tpl t on t.text_en = c.text_en and t.text_ar = c.text_ar and t.k = c.k
    ), gone as (
      -- A tick that lands first keeps its line: the row is re-checked after
      -- the tick's lock is released.
      delete from checklist_run_items ri
       where ri.run_id = v_run
         and ri.done_at is null
         and not exists (select 1 from pair p where p.item_id = ri.id)
      returning ri.id
    ), moved as (
      -- A line that now needs a photo and was ticked without one is unticked,
      -- so it is ticked again with the photo (mark_checklist_item's rule); a
      -- tick that carries a photo stays.
      update checklist_run_items ri
         set position       = p.position,
             photo_required = p.photo_required,
             done_by        = case when p.photo_required and ri.photo_path is null then null else ri.done_by end,
             done_at        = case when p.photo_required and ri.photo_path is null then null else ri.done_at end
        from pair p
       where ri.id = p.item_id
         and (ri.position <> p.position or ri.photo_required <> p.photo_required)
      returning ri.id
    ), added as (
      insert into checklist_run_items (run_id, position, text_en, text_ar, photo_required)
      select v_run, t.position, t.text_en, t.text_ar, t.photo_required
        from tpl t
       where not exists (select 1 from cur c
                          where c.text_en = t.text_en and c.text_ar = t.text_ar and c.k = t.k)
      returning id
    )
    select (select count(*) from gone) + (select count(*) from moved) + (select count(*) from added)
      into v_rows;
    if v_rows > 0 then
      v_n := v_n + 1;
    end if;
  end loop;

  return v_n;
end $checklist_sync_run_lines_0375$;

comment on function app.checklist_sync_run_lines(uuid) is
  'checklist_live_lines (0375). Internal, called by save_checklist after an edit: every copy of the list current on its branch''s business day follows the list''s lines. A line the list gained is added unticked (a finished copy is unfinished again), an unticked line it lost is removed, a ticked line stays as it was ticked; matched lines take the list''s order and its "needs a photo", and a line that now needs a photo and was ticked without one is unticked. Lines match by their text in both languages, the k-th copy of a repeated text with the k-th. Nothing for an archived list. Returns the copies changed.';

revoke all on function app.checklist_sync_run_lines(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.save_checklist — 0323 verbatim, plus CHECKLIST_NO_LINES and the sync.
-- ---------------------------------------------------------------------------
create or replace function app.save_checklist(
  p_venue_id         uuid,
  p_template_id      uuid,
  p_expected_version int,
  p_spec             jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $save_checklist_0375$
declare
  v_venue    uuid;
  v_en       text;
  v_ar       text;
  v_audience text;
  v_role_txt text;
  v_role     staff_role;
  v_copy     text;
  v_kind     text;
  v_slot_in  text;
  v_slot     text;
  v_due_txt  text;
  v_due      time;
  v_wd       smallint[] := '{0,1,2,3,4,5,6}';
  v_md       smallint[];
  v_staff    uuid[] := '{}';
  v_el       jsonb;
  v_ten      text;
  v_tar      text;
  v_texts    text[] := '{}';
  v_textsa   text[] := '{}';
  v_photos   boolean[] := '{}';
  v_before   int;
  v_tpl      checklist_templates%rowtype;
  v_synced   int := 0;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id,
                      (select t.venue_id from checklist_templates t where t.id = p_template_id),
                      app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  if p_spec is null or jsonb_typeof(p_spec) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'spec';
  end if;

  -- Name, both languages.
  v_en := nullif(btrim(coalesce(p_spec ->> 'name_en', '')), '');
  v_ar := nullif(btrim(coalesce(p_spec ->> 'name_ar', '')), '');
  if v_en is null or v_ar is null then
    raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'name';
  end if;
  if length(v_en) > 120 or length(v_ar) > 120 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'name';
  end if;

  -- Who.
  v_audience := p_spec ->> 'audience';
  if v_audience is null or v_audience not in ('role', 'people') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'audience';
  end if;
  if v_audience = 'role' then
    v_role_txt := p_spec ->> 'role';
    if v_role_txt is null
       or not (v_role_txt = any(enum_range(null::staff_role)::text[])) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'role';
    end if;
    v_role := v_role_txt::staff_role;
    if v_role = 'prep' then
      raise exception 'INVALID_ROLE' using errcode = 'P0001', hint = 'role';
    end if;
    v_copy := coalesce(p_spec ->> 'copy_mode', 'shared');
    if v_copy not in ('shared', 'each') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'copy_mode';
    end if;
  else
    v_role := null;
    v_copy := coalesce(p_spec ->> 'copy_mode', 'each');
    if v_copy <> 'each' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'copy_mode';
    end if;
    -- Each test only once the shape before it holds (OR does not promise an order).
    if jsonb_typeof(p_spec -> 'staff_ids') is distinct from 'array' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'staff_ids';
    end if;
    if jsonb_array_length(p_spec -> 'staff_ids') not between 1 and 50
       or exists (select 1 from jsonb_array_elements(p_spec -> 'staff_ids') e
                   where jsonb_typeof(e) <> 'string'
                      or (e #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'staff_ids';
    end if;
    select array_agg(distinct (e #>> '{}')::uuid) into v_staff
      from jsonb_array_elements(p_spec -> 'staff_ids') e;
    if exists (select 1 from unnest(v_staff) x(id) where not app.checklist_member_at(x.id, v_venue)) then
      raise exception 'ASSIGNEE_NOT_AT_BRANCH' using errcode = 'P0001', hint = 'staff_ids';
    end if;
  end if;

  -- How it repeats.
  v_kind := p_spec ->> 'repeat_kind';
  if v_kind is null or v_kind not in ('weekdays', 'monthdays') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'repeat_kind';
  end if;
  if v_kind = 'weekdays' then
    if jsonb_typeof(p_spec -> 'weekdays') is distinct from 'array' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'weekdays';
    end if;
    if jsonb_array_length(p_spec -> 'weekdays') not between 1 and 7
       or exists (select 1 from jsonb_array_elements(p_spec -> 'weekdays') e
                   where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^[0-6]$')
       or (select count(distinct e #>> '{}') from jsonb_array_elements(p_spec -> 'weekdays') e)
          <> jsonb_array_length(p_spec -> 'weekdays') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'weekdays';
    end if;
    select array_agg((e #>> '{}')::smallint order by (e #>> '{}')::smallint) into v_wd
      from jsonb_array_elements(p_spec -> 'weekdays') e;
    v_md := null;
  else
    if jsonb_typeof(p_spec -> 'month_days') is distinct from 'array' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month_days';
    end if;
    if jsonb_array_length(p_spec -> 'month_days') not between 1 and 4
       or exists (select 1 from jsonb_array_elements(p_spec -> 'month_days') e
                   where jsonb_typeof(e) <> 'number' or (e #>> '{}') !~ '^([1-9]|[12][0-9]|3[01])$')
       or (select count(distinct e #>> '{}') from jsonb_array_elements(p_spec -> 'month_days') e)
          <> jsonb_array_length(p_spec -> 'month_days') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'month_days';
    end if;
    select array_agg((e #>> '{}')::smallint order by (e #>> '{}')::smallint) into v_md
      from jsonb_array_elements(p_spec -> 'month_days') e;
    v_wd := '{0,1,2,3,4,5,6}';
  end if;

  -- When it is due.
  v_slot_in := p_spec ->> 'slot';
  if v_slot_in is null or v_slot_in not in ('open', 'close', 'time') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'slot';
  end if;
  if v_slot_in = 'time' then
    v_due_txt := p_spec ->> 'due_time';
    if v_due_txt is null or v_due_txt !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'due_time';
    end if;
    v_due := v_due_txt::time;
    v_slot := case when v_due < time '14:00' then 'open' else 'close' end;
  else
    v_due := null;
    v_slot := v_slot_in;
  end if;

  -- The lines (save_checklist_template's limits).
  if jsonb_typeof(p_spec -> 'items') is distinct from 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  if jsonb_array_length(p_spec -> 'items') > 30 then
    raise exception 'LIST_TOO_LONG' using errcode = 'P0001', hint = 'items';
  end if;
  for v_el in select e from jsonb_array_elements(p_spec -> 'items') e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_ten := nullif(btrim(coalesce(v_el ->> 'text_en', '')), '');
    v_tar := nullif(btrim(coalesce(v_el ->> 'text_ar', '')), '');
    if v_ten is null or v_tar is null then
      raise exception 'TEXT_BOTH_LANGUAGES_REQUIRED' using errcode = 'P0001', hint = 'items';
    end if;
    if length(v_ten) > 200 or length(v_tar) > 200 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'items';
    end if;
    if coalesce(jsonb_typeof(v_el -> 'photo_required'), 'null') not in ('boolean', 'null') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_texts  := v_texts  || v_ten;
    v_textsa := v_textsa || v_tar;
    v_photos := v_photos || coalesce((v_el ->> 'photo_required')::boolean, false);
  end loop;
  -- 0375: a list holds at least one line (a list with none reached nobody).
  if cardinality(v_texts) = 0 then
    raise exception 'CHECKLIST_NO_LINES' using errcode = 'P0001', hint = 'items';
  end if;

  if p_template_id is null then
    if coalesce(p_expected_version, 0) <> 0 then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := 0;
    insert into checklist_templates (venue_id, role, slot, name_en, name_ar, version, updated_by,
                                     audience, copy_mode, repeat_kind, weekdays, month_days, due_time)
    values (v_venue, v_role, v_slot, v_en, v_ar, 1, auth.uid(),
            v_audience, v_copy, v_kind, v_wd, v_md, v_due)
    returning * into v_tpl;
  else
    select * into v_tpl from checklist_templates
     where id = p_template_id and venue_id = v_venue
     for update;
    if not found or v_tpl.archived_at is not null then
      raise exception 'CHECKLIST_NOT_FOUND' using errcode = 'P0001';
    end if;
    if p_expected_version is distinct from v_tpl.version then
      raise exception 'TEMPLATE_CHANGED' using errcode = 'P0001';
    end if;
    v_before := v_tpl.version;
    update checklist_templates
       set name_en = v_en, name_ar = v_ar, role = v_role, slot = v_slot,
           audience = v_audience, copy_mode = v_copy, repeat_kind = v_kind,
           weekdays = v_wd, month_days = v_md, due_time = v_due,
           version = version + 1, updated_by = auth.uid(), updated_at = now()
     where id = v_tpl.id
     returning * into v_tpl;
    delete from checklist_template_items where template_id = v_tpl.id;
  end if;

  insert into checklist_template_items (template_id, position, text_en, text_ar, photo_required)
  select v_tpl.id, x.o, x.en, v_textsa[x.o], v_photos[x.o]
    from unnest(v_texts) with ordinality as x(en, o);

  -- The people, replaced whole (none for a role list). Someone who stays on
  -- the list keeps their row and its created_at, which says from which
  -- occurrence they get a copy (checklist_materialize).
  delete from checklist_assignees
   where template_id = v_tpl.id
     and not (staff_id = any(v_staff));
  insert into checklist_assignees (template_id, staff_id, venue_id)
  select v_tpl.id, x.id, v_venue
    from unnest(v_staff) x(id)
  on conflict (template_id, staff_id) do nothing;

  -- 0375: the copies open now take the new lines (and lose the unticked
  -- lines taken off); a ticked line stays as it was ticked.
  if p_template_id is not null then
    v_synced := app.checklist_sync_run_lines(v_tpl.id);
  end if;

  perform app.write_audit('checklist.save', 'checklist_template', v_tpl.id::text,
                          jsonb_build_object('version', v_before),
                          jsonb_build_object('audience', v_audience, 'role', v_role, 'copy_mode', v_copy,
                                             'repeat_kind', v_kind, 'weekdays', to_jsonb(v_wd),
                                             'month_days', to_jsonb(v_md), 'slot', v_slot,
                                             'due_time', to_char(v_due, 'HH24:MI'),
                                             'version', v_tpl.version,
                                             'items', cardinality(v_texts),
                                             'people', cardinality(v_staff),
                                             'copies_updated', v_synced));

  return jsonb_build_object('template_id', v_tpl.id, 'version', v_tpl.version);
end $save_checklist_0375$;

comment on function app.save_checklist(uuid, uuid, int, jsonb) is
  'checklist_schedules (0323), re-issued by checklist_live_lines (0375). Owner only, owner at the branch: creates (p_template_id NULL, expected version 0 or NULL) or rewrites one list from p_spec {name_en, name_ar, audience: role|people, role?, copy_mode: shared|each, staff_ids?: uuid[], repeat_kind: weekdays|monthdays, weekdays?: [0..6] (0 = Sunday), month_days?: [1..31] (31 = the last day), slot: open|close|time, due_time?: HH:MM, items: [{text_en, text_ar, photo_required?}]}. A people list is always each, 1 to 50 people who work at the branch; weekdays 1 to 7 distinct; month_days 1 to 4 distinct; slot time stores due_time and a derived slot (before 14:00 open, else close). Lines and people replaced whole. 0375: at least one line (CHECKLIST_NO_LINES, hint items), and the copies open now follow the new lines at once (app.checklist_sync_run_lines: a new line is added, an unticked line taken off is removed, a ticked line stays, a line that now needs a photo and was ticked without one is unticked); everything else about an occurrence already running keeps its snapshot (the edit applies from the next one). Returns {template_id, version}. INVALID_ARGUMENT (hint spec, audience, role, copy_mode, staff_ids, repeat_kind, weekdays, month_days, slot, due_time, items), INVALID_ROLE (prep), ASSIGNEE_NOT_AT_BRANCH (hint staff_ids), TEMPLATE_CHANGED, CHECKLIST_NOT_FOUND (unknown or archived), LIST_TOO_LONG, TEXT_BOTH_LANGUAGES_REQUIRED, TEXT_TOO_LONG. Audit checklist.save (counts, never the text; 0375 adds copies_updated).';

revoke all on function app.save_checklist(uuid, uuid, int, jsonb) from public, anon;
grant execute on function app.save_checklist(uuid, uuid, int, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.my_checklist_history — the caller's past lists, newest first.
-- ---------------------------------------------------------------------------
create or replace function app.my_checklist_history(
  p_venue_id    uuid default null,
  p_before_date date default null,
  p_before_run  uuid default null,
  p_limit       int  default 20
) returns jsonb
language plpgsql security definer set search_path = public as $my_checklist_history_0375$
declare
  v_role  staff_role := app.staff_role();
  v_me    uuid := auth.uid();
  v_venue uuid;
  v_today date;
  v_lists jsonb;
  v_next  jsonb;
begin
  if v_role is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_limit is null or p_limit not between 1 and 50 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'limit';
  end if;
  if (p_before_date is null) <> (p_before_run is null) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'before';
  end if;
  v_today := app.venue_business_date(v_venue);

  -- One more than asked, to know whether there is a next page.
  select coalesce(jsonb_agg(x.j order by x.business_date desc, x.id desc), '[]'::jsonb)
    into v_lists
    from (
      select r.id, r.business_date,
             jsonb_build_object(
               'run_id',       r.id,
               'template_id',  r.template_id,
               'role',         r.role,
               'slot',         r.slot,
               'name_en',      t.name_en,
               'name_ar',      t.name_ar,
               'done',         c.done,
               'total',        c.total,
               'last_done_at', c.last_done_at,
               'period_start', r.business_date,
               'period_end',   r.period_end,
               'due_at',       r.due_at,
               'assignee_id',  r.assignee_id,
               'items',        (select coalesce(jsonb_agg(jsonb_build_object(
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
                                 where i.run_id = r.id)) as j
        from checklist_runs r
        join checklist_templates t on t.id = r.template_id
        cross join lateral (
          select count(*) filter (where i.done_at is not null) as done, count(*) as total,
                 max(i.done_at) as last_done_at
            from checklist_run_items i
           where i.run_id = r.id
        ) c
       where r.venue_id = v_venue
         and r.business_date <= v_today
         and c.total > 0
         -- Past: no longer open (my_checklists_today shows the open ones).
         and not (t.archived_at is null
                  and app.checklist_current(r.template_id, r.business_date, r.period_end, v_today))
         and ((r.assignee_id is null and r.role = v_role)
              or r.assignee_id = v_me
              or exists (select 1 from checklist_run_items i where i.run_id = r.id and i.done_by = v_me))
         and (p_before_date is null or (r.business_date, r.id) < (p_before_date, p_before_run))
       order by r.business_date desc, r.id desc
       limit p_limit + 1
    ) x;

  if jsonb_array_length(v_lists) > p_limit then
    v_lists := v_lists - p_limit;
    v_next := jsonb_build_object('before_date', v_lists -> (p_limit - 1) ->> 'period_start',
                                 'before_run',  v_lists -> (p_limit - 1) ->> 'run_id');
  end if;

  return jsonb_build_object('business_date', v_today, 'lists', v_lists, 'next', v_next);
end $my_checklist_history_0375$;

comment on function app.my_checklist_history(uuid, date, uuid, int) is
  'checklist_live_lines (0375). Any active staff member at the venue: their past lists, newest first, {business_date, lists: [{run_id, template_id, role, slot, name_en, name_ar, done, total, last_done_at, period_start, period_end, due_at, assignee_id, items: [{id, position, text_en, text_ar, done_by_name, done_at, note, photo_required, photo_path}]}], next: {before_date, before_run} or null}. A list is theirs when it is their own copy, their role''s shared list (the my_checklists_today rule) or a list they ticked a line of; it is past once it is no longer open (its occurrence ended, the next one started, or the list was archived). p_limit 1..50 (default 20); pass next''s pair back as p_before_date and p_before_run for the page after. One person''s own lists as they were: no counts across lists, no rates. FORBIDDEN for a venue the caller does not work at; INVALID_ARGUMENT (hint limit, before).';

revoke all on function app.my_checklist_history(uuid, date, uuid, int) from public, anon;
grant execute on function app.my_checklist_history(uuid, date, uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Realtime: 'checklists:<venue>', event 'changed', payload {at} only.
-- ---------------------------------------------------------------------------
create or replace function app.rt_checklists() returns trigger
language plpgsql security definer set search_path = public as $rt_checklists_0375$
declare
  v_venues uuid[];
  v_venue  uuid;
begin
  begin
    -- Each trigger names only the transition table its own event has; a
    -- branch not taken is never planned.
    if tg_table_name = 'checklist_templates' then
      select array_agg(distinct n.venue_id) into v_venues from n;
    elsif tg_op = 'DELETE' then
      select array_agg(distinct r.venue_id) into v_venues
        from o join checklist_runs r on r.id = o.run_id;
    else
      select array_agg(distinct r.venue_id) into v_venues
        from n join checklist_runs r on r.id = n.run_id;
    end if;
    foreach v_venue in array coalesce(v_venues, '{}'::uuid[]) loop
      perform realtime.send(jsonb_build_object('at', now()), 'changed', 'checklists:' || v_venue::text, true);
    end loop;
  exception when others then null;
  end;
  return null;
end $rt_checklists_0375$;

comment on function app.rt_checklists() is
  '0375. AFTER statement trigger on checklist_run_items (insert, update, delete) and checklist_templates (insert, update): one ''changed'' broadcast per branch touched on the private ''checklists:<venue>'' topic, payload {at} only. Never raises.';

revoke all on function app.rt_checklists() from public, anon, authenticated;

drop trigger if exists rt_checklists_insert on public.checklist_run_items;
create trigger rt_checklists_insert after insert on public.checklist_run_items
  referencing new table as n for each statement execute function app.rt_checklists();
drop trigger if exists rt_checklists_update on public.checklist_run_items;
create trigger rt_checklists_update after update on public.checklist_run_items
  referencing new table as n for each statement execute function app.rt_checklists();
drop trigger if exists rt_checklists_delete on public.checklist_run_items;
create trigger rt_checklists_delete after delete on public.checklist_run_items
  referencing old table as o for each statement execute function app.rt_checklists();
drop trigger if exists rt_checklists_insert on public.checklist_templates;
create trigger rt_checklists_insert after insert on public.checklist_templates
  referencing new table as n for each statement execute function app.rt_checklists();
drop trigger if exists rt_checklists_update on public.checklist_templates;
create trigger rt_checklists_update after update on public.checklist_templates
  referencing new table as n for each statement execute function app.rt_checklists();

-- Who may listen (the 0224 form): any active staff member who works at the
-- branch, as my_checklists_today. The CASE keeps the uuid cast off every other
-- topic this policy is asked about.
do $rt_checklists_policy_0375$
begin
  if to_regclass('realtime.messages') is null then
    raise notice 'realtime.messages absent - skipping broadcast RLS policies';
    return;
  end if;

  execute $p$
    drop policy if exists touchpadel_rt_checklists on realtime.messages
  $p$;
  execute $p$
    create policy touchpadel_rt_checklists on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and case when realtime.topic() ~ '^checklists:[0-9a-f-]{36}$'
                 then (select app.staff_role()) is not null
                      and split_part(realtime.topic(), ':', 2)::uuid = any((select app.staff_venue_ids())::uuid[])
                 else false
            end
      )
  $p$;
end $rt_checklists_policy_0375$;
