-- 0062_courts_admin — the court records write path (SOW L299-301).
--
-- "Court records: name, indoor/outdoor, description, photograph; duration
-- options configured per court." The table has carried every column since
-- 0007 and 0007's own comment promised "RPC-only (admin CRUD lands with the
-- admin drop)" — the drop never landed, so courts were only ever writable by
-- seed scripts. This is that drop:
--
--   1. app.upsert_court   — manager/owner; named validation errors; refuses to
--                           deactivate a court holding future live bookings
--                           (the desk moves/cancels them first — pricing and
--                           the exclusion constraint stay coherent); audited.
--   2. app.reorder_courts — the 0050 permutation contract, verbatim reasoning.
--   3. courts_rt          — 'court_changed' on the private 'courts' topic so
--                           the desk grid and rate editor converge live.
--   4. menu-media insert policy grows a 'courts' folder for the photos.
--
-- covered by packages/db/tests/courts-admin.test.ts

-- ---------------------------------------------------------------------------
-- 1. upsert_court
-- ---------------------------------------------------------------------------
create or replace function app.upsert_court(
  p_name_en          text,
  p_name_ar          text,
  p_indoor           boolean,
  p_description_en   text    default null,
  p_description_ar   text    default null,
  p_photo_path       text    default null,
  p_duration_options int[]   default '{60,90,120}',
  p_sort_order       int     default null,
  p_is_active        boolean default true,
  p_id               uuid    default null
) returns uuid
language plpgsql security definer set search_path = public as $upsert_court_0062$
declare
  v_before jsonb;
  v_row    courts%rowtype;
  v_opt    int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if coalesce(btrim(p_name_en), '') = '' or coalesce(btrim(p_name_ar), '') = '' then
    raise exception 'NAME_REQUIRED' using errcode = 'P0001',
      hint = 'both English and Arabic names';
  end if;

  if p_duration_options is null or coalesce(array_length(p_duration_options, 1), 0) = 0 then
    raise exception 'INVALID_DURATIONS' using errcode = 'P0001',
      hint = 'at least one duration option';
  end if;
  foreach v_opt in array p_duration_options loop
    if v_opt < 30 or v_opt > 300 or v_opt % 15 <> 0 then
      raise exception 'INVALID_DURATIONS' using errcode = 'P0001',
        detail = format('%s min', v_opt),
        hint = '30-300 minutes in 15-minute steps';
    end if;
  end loop;

  -- Photos live under one folder so the storage policy stays a closed set.
  if p_photo_path is not null and p_photo_path !~ '^courts/' then
    raise exception 'INVALID_PHOTO_PATH' using errcode = 'P0001',
      hint = 'court photos live under courts/';
  end if;

  if p_id is null then
    insert into courts (name_en, name_ar, indoor, description_en, description_ar,
                        photo_path, duration_options, sort_order, is_active)
    values (btrim(p_name_en), btrim(p_name_ar), p_indoor, p_description_en, p_description_ar,
            p_photo_path, p_duration_options,
            coalesce(p_sort_order, (select coalesce(max(sort_order), 0) + 1 from courts)),
            p_is_active)
    returning * into v_row;
    perform app.write_audit('courts.create', 'courts', v_row.id::text, null, to_jsonb(v_row));
    return v_row.id;
  end if;

  select * into v_row from courts where id = p_id for update;
  if not found then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001';
  end if;
  v_before := to_jsonb(v_row);

  -- Deactivating a court with future live bookings would orphan them behind a
  -- greyed-out row while they still occupy the exclusion constraint. The desk
  -- resolves the bookings first; this refusal names the count.
  if v_row.is_active and not p_is_active then
    if exists (select 1 from reservations
                where court_id = p_id
                  and status in ('pending','confirmed','arrived')
                  and end_at > now()) then
      raise exception 'COURT_HAS_FUTURE_RESERVATIONS' using errcode = 'P0001',
        detail = (select count(*)::text from reservations
                   where court_id = p_id
                     and status in ('pending','confirmed','arrived')
                     and end_at > now()),
        hint = 'move or cancel the bookings at the desk first';
    end if;
  end if;

  update courts
     set name_en          = btrim(p_name_en),
         name_ar          = btrim(p_name_ar),
         indoor           = p_indoor,
         description_en   = p_description_en,
         description_ar   = p_description_ar,
         photo_path       = p_photo_path,
         duration_options = p_duration_options,
         sort_order       = coalesce(p_sort_order, v_row.sort_order),
         is_active        = p_is_active
   where id = p_id
   returning * into v_row;

  perform app.write_audit('courts.update', 'courts', p_id::text, v_before, to_jsonb(v_row));
  return v_row.id;
end $upsert_court_0062$;

revoke all on function app.upsert_court(text, text, boolean, text, text, text, int[], int, boolean, uuid)
  from public, anon;
grant execute on function app.upsert_court(text, text, boolean, text, text, text, int[], int, boolean, uuid)
  to authenticated;

-- ---------------------------------------------------------------------------
-- 2. reorder_courts — 0050 contract: full permutation, locked, audited.
-- ---------------------------------------------------------------------------
create or replace function app.reorder_courts(p_ids uuid[])
returns int
language plpgsql security definer set search_path = public as $reorder_courts_0062$
declare
  v_expected int := coalesce(array_length(p_ids, 1), 0);
  v_found    int;
  v_before   jsonb;
  v_after    jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_expected = 0 then
    return 0;
  end if;
  if v_expected <> (select count(distinct id) from unnest(p_ids) as id) then
    raise exception 'DUPLICATE_ID' using errcode = 'P0001',
      hint = 'each court may appear once in the ordering';
  end if;

  perform 1 from courts where id = any(p_ids) order by id for update;

  select count(*) into v_found from courts where id = any(p_ids);
  if v_found <> v_expected then
    raise exception 'COURT_NOT_FOUND' using errcode = 'P0001',
      detail = format('%s of %s ids exist', v_found, v_expected);
  end if;

  select jsonb_agg(jsonb_build_object('id', c.id, 'sort_order', c.sort_order) order by c.sort_order)
    into v_before from courts c where c.id = any(p_ids);

  update courts c
     set sort_order = ord.pos
    from (select id, (ordinality - 1)::int as pos
            from unnest(p_ids) with ordinality as t(id, ordinality)) ord
   where c.id = ord.id
     and c.sort_order is distinct from ord.pos;

  select jsonb_agg(jsonb_build_object('id', c.id, 'sort_order', c.sort_order) order by c.sort_order)
    into v_after from courts c where c.id = any(p_ids);

  perform app.write_audit('courts.reorder', 'courts', 'multiple', v_before, v_after);
  return v_expected;
end $reorder_courts_0062$;

revoke all on function app.reorder_courts(uuid[]) from public, anon;
grant execute on function app.reorder_courts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. courts realtime — desk grid + rate editor + guest court lists converge.
-- ---------------------------------------------------------------------------
create or replace function app.rt_court_changed() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    perform realtime.send(
      jsonb_build_object('court_id', new.id, 'active', new.is_active),
      'court_changed',
      'courts',
      true);
  exception when others then null;
  end;
  return new;
end $$;

drop trigger if exists courts_rt on courts;
create trigger courts_rt
  after insert or update on courts
  for each row execute function app.rt_court_changed();

-- ---------------------------------------------------------------------------
-- 4. Storage: the menu-media insert policy grows a 'courts' folder.
-- ---------------------------------------------------------------------------
do $storage_0062$
begin
  begin
    drop policy if exists menu_media_staff_insert on storage.objects;
    create policy menu_media_staff_insert on storage.objects
      for insert to authenticated
      with check (bucket_id = 'menu-media'
                  and app.is_staff('manager','owner')
                  and (storage.foldername(name))[1] in ('items','categories','hero','courts'));
  exception when insufficient_privilege then
    raise notice 'cannot recreate menu_media_staff_insert as % - add the courts folder via Dashboard > Storage > Policies',
      current_user;
  end;
end $storage_0062$;
