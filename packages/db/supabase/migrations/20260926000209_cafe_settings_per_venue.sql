set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0209_cafe_settings_per_venue — multi-venue slice 2, step 3.
--
-- cafe_settings (0029) is a key/value table with `key` as its primary key: one
-- featured item, one hero, one Telegram group, one idle-lock timeout for the
-- whole chain. Every key is a branch's business (a featured item id belongs to
-- one branch's menu; MV3 gives each branch its own Telegram group), except
-- analytics_engagement_floor, which is harmless per branch. So the table gains
-- venue_id and is keyed by (venue_id, key).
--
--   * venue_id: backfilled to the default venue, present by a validated CHECK,
--     FK to venues, default app.current_venue() (identified writers only).
--   * The key moves: the key-only primary key is dropped, a unique index on
--     (venue_id, key) replaces it.
--   * The four accessors (cafe_setting, _text, _int, _bool) gain an optional
--     p_venue. Without it they read the caller's resolved venue, falling back to
--     the default branch (app.current_venue_or_default: station, then
--     app.venue_id, then the caller's only membership, then the only active
--     venue), so every existing reader keeps working unchanged; a reader that
--     knows its branch passes it (the day, telegram and cafe families of this
--     slice).
--   * The three writers take the branch: set_cafe_setting_internal (0177; the
--     price/promo apply sets app.venue_id first, so its calls resolve right),
--     set_cafe_setting (0177) and set_cafe_settings (0050). The manager's
--     featured-discount lock (0177, #57) now compares against that branch's
--     values.
--   * cafe_settings_public appends venue_id; cafe_settings_staff_read gains the
--     venue conjunct; the realtime trigger names the branch in its payload.
--
-- MIGRATION-RISK-ACCEPTED: one non-concurrent unique index on cafe_settings
-- (at most ~25 rows, one per key), and the FK / CHECK are added NOT VALID then
-- validated. Recorded in PHASE-2-CHECKLIST.md with the slice-2 waiver.

-- ---------------------------------------------------------------------------
-- 1. The column and the key
-- ---------------------------------------------------------------------------
alter table cafe_settings add column if not exists venue_id uuid;

-- The backfill fires the realtime trigger per row; harmless (a settings_changed
-- broadcast on the public menu topic), and there are at most a few dozen rows.
update cafe_settings set venue_id = app.default_venue() where venue_id is null;

alter table cafe_settings alter column venue_id set default app.current_venue();

do $cafe_settings_venue$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'cafe_settings_venue_id_present' and conrelid = 'cafe_settings'::regclass) then
    alter table cafe_settings add constraint cafe_settings_venue_id_present
      check (venue_id is not null) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'cafe_settings_venue_id_fkey' and conrelid = 'cafe_settings'::regclass) then
    alter table cafe_settings add constraint cafe_settings_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
end
$cafe_settings_venue$;

alter table cafe_settings validate constraint cafe_settings_venue_id_present;
alter table cafe_settings validate constraint cafe_settings_venue_id_fkey;

alter table cafe_settings drop constraint if exists cafe_settings_pkey;

create unique index if not exists cafe_settings_venue_key on cafe_settings (venue_id, key);

comment on column cafe_settings.venue_id is
  '0209. The branch this value belongs to. Key is (venue_id, key); a branch with no row for a key reads the registry default (app.cafe_setting_specs).';
comment on table cafe_settings is
  'Cafe key/value settings, per branch since 0209 (unique (venue_id, key)). Keys, shapes, defaults and write roles live in app.cafe_setting_specs(); writes only via app.set_cafe_setting. is_public rows are mirrored to anon/guests through the cafe_settings_public view; private rows (telegram_*, analytics_*) are manager|owner read only, at their own branch.';

-- ---------------------------------------------------------------------------
-- 2. Read surfaces
-- ---------------------------------------------------------------------------
drop policy if exists cafe_settings_staff_read on cafe_settings;
create policy cafe_settings_staff_read on cafe_settings for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- create or replace can only APPEND a column.
create or replace view cafe_settings_public with (security_invoker = off) as
select cs.key, cs.value, cs.venue_id
  from cafe_settings cs
  join venues v on v.id = cs.venue_id and v.is_active
 where cs.is_public;

grant select on cafe_settings_public to anon, authenticated;

comment on view cafe_settings_public is
  '0029, per branch since 0209. The public cafe keys (hero, featured item, ticker, bell tutorial) of every active branch. A key absent for a branch means the registry default.';

-- ---------------------------------------------------------------------------
-- 3. The accessors (0029 bodies): an optional branch
-- ---------------------------------------------------------------------------
drop function if exists app.cafe_setting_bool(text);
drop function if exists app.cafe_setting_int(text);
drop function if exists app.cafe_setting_text(text);
drop function if exists app.cafe_setting(text);

create or replace function app.cafe_setting(p_key text, p_venue uuid default null) returns jsonb
language sql stable security definer set search_path = public as $cafe_get_0209$
  select coalesce(
    (select cs.value from cafe_settings cs
      where cs.key = p_key
        and cs.venue_id = coalesce(p_venue, app.current_venue_or_default())),
    (select s.default_value from app.cafe_setting_spec(p_key) s)
  )
$cafe_get_0209$;

create or replace function app.cafe_setting_text(p_key text, p_venue uuid default null) returns text
language sql stable security definer set search_path = public as $cafe_get_text_0209$
  select app.cafe_setting(p_key, p_venue) #>> '{}'
$cafe_get_text_0209$;

create or replace function app.cafe_setting_int(p_key text, p_venue uuid default null) returns int
language sql stable security definer set search_path = public as $cafe_get_int_0209$
  select case when jsonb_typeof(v) = 'number' then (v #>> '{}')::numeric::int end
    from app.cafe_setting(p_key, p_venue) as v
$cafe_get_int_0209$;

create or replace function app.cafe_setting_bool(p_key text, p_venue uuid default null) returns boolean
language sql stable security definer set search_path = public as $cafe_get_bool_0209$
  select case when jsonb_typeof(v) = 'boolean' then (v #>> '{}')::boolean end
    from app.cafe_setting(p_key, p_venue) as v
$cafe_get_bool_0209$;

comment on function app.cafe_setting(text, uuid) is
  '0029, 0209. A cafe setting''s value at a branch (p_venue; default: the caller''s resolved venue, else the default branch), or the registry default when that branch never set it.';

revoke all on function app.cafe_setting(text, uuid) from public, anon, authenticated;
grant execute on function app.cafe_setting(text, uuid) to service_role;
revoke all on function app.cafe_setting_text(text, uuid) from public, anon, authenticated;
grant execute on function app.cafe_setting_text(text, uuid) to service_role;
revoke all on function app.cafe_setting_int(text, uuid) from public, anon, authenticated;
grant execute on function app.cafe_setting_int(text, uuid) to service_role;
revoke all on function app.cafe_setting_bool(text, uuid) from public, anon, authenticated;
grant execute on function app.cafe_setting_bool(text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 4. The writers (0177, 0050 bodies): the branch
-- ---------------------------------------------------------------------------
drop function if exists app.set_cafe_setting_internal(text, jsonb);

create or replace function app.set_cafe_setting_internal(
  p_key   text,
  p_value jsonb,
  p_venue uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_cafe_setting_internal_0209$
declare
  v_spec   record;
  v_venue  uuid := coalesce(p_venue, app.current_venue());
  v_value  jsonb := coalesce(p_value, 'null'::jsonb);   -- SQL NULL from PostgREST == JSON null
  v_before jsonb;
  v_row    cafe_settings%rowtype;
begin
  select * into v_spec from app.cafe_setting_spec(p_key);
  if not found then
    raise exception 'UNKNOWN_SETTING' using errcode = 'P0001',
      detail = format('no such cafe setting: %s', coalesce(p_key, '<null>'));
  end if;

  perform app.validate_cafe_setting(v_spec.key, v_spec.jtype, v_value);
  perform set_config('app.venue_id', v_venue::text, true);

  select to_jsonb(cs) into v_before from cafe_settings cs
   where cs.venue_id = v_venue and cs.key = v_spec.key for update;

  insert into cafe_settings (venue_id, key, value, is_public, updated_at, updated_by)
  values (v_venue, v_spec.key, v_value, v_spec.is_public, now(), auth.uid())
  on conflict (venue_id, key) do update
     set value      = excluded.value,
         is_public  = excluded.is_public,     -- registry wins if a flag ever changes
         updated_at = excluded.updated_at,
         updated_by = excluded.updated_by
  returning * into v_row;

  perform app.write_audit('settings.cafe', 'cafe_settings', v_spec.key,
                          v_before, to_jsonb(v_row));

  return jsonb_build_object(
    'key',        v_row.key,
    'value',      v_row.value,
    'is_public',  v_row.is_public,
    'updated_at', v_row.updated_at,
    'venue_id',   v_row.venue_id
  );
end $set_cafe_setting_internal_0209$;

comment on function app.set_cafe_setting_internal(text, jsonb, uuid) is
  '0177, 0209. Definer-only: validate and upsert one cafe setting at a branch (p_venue; default app.current_venue(), which the price/promo apply sets through app.venue_id), audited as settings.cafe at that branch. No role or lock check: callers do that.';

revoke all on function app.set_cafe_setting_internal(text, jsonb, uuid) from public, anon, authenticated;

drop function if exists app.set_cafe_setting(text, jsonb);

create or replace function app.set_cafe_setting(
  p_key      text,
  p_value    jsonb,
  p_venue_id uuid default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_cafe_setting_0209$
declare
  v_role  staff_role := app.staff_role();
  v_venue uuid;
  v_spec  record;
  v_value jsonb := coalesce(p_value, 'null'::jsonb);   -- SQL NULL from PostgREST == JSON null
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_spec from app.cafe_setting_spec(p_key);
  if not found then
    raise exception 'UNKNOWN_SETTING' using errcode = 'P0001',
      detail = format('no such cafe setting: %s', coalesce(p_key, '<null>'));
  end if;

  -- Owner passes everything; a manager may only write 'manager' keys.
  if v_spec.min_role = 'owner' and v_role <> 'owner' then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = format('%s is owner-only', p_key);
  end if;

  if v_role = 'manager' then
    if p_key = 'featured_discount_pct'
       and v_value is distinct from app.cafe_setting('featured_discount_pct', v_venue)
       and v_value <> '0'::jsonb then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
    if p_key = 'featured_item_id'
       and lower(v_value #>> '{}') is distinct from lower(app.cafe_setting_text('featured_item_id', v_venue))
       and coalesce(app.cafe_setting_int('featured_discount_pct', v_venue), 0) > 0 then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
    if p_key = 'hero_mode'
       and v_value = '"featured"'::jsonb
       and app.cafe_setting_text('hero_mode', v_venue) is distinct from 'featured'
       and coalesce(app.cafe_setting_int('featured_discount_pct', v_venue), 0) > 0 then
      raise exception 'PRICE_VIA_PROTOCOL' using errcode = 'P0001';
    end if;
  end if;

  return app.set_cafe_setting_internal(p_key, p_value, v_venue);
end $set_cafe_setting_0209$;

comment on function app.set_cafe_setting(text, jsonb, uuid) is
  '0029/0177, 0209. Manager or owner at the branch (p_venue_id; default the caller''s resolved venue): write one cafe setting. Owner-only keys refuse a manager; a manager''s featured-discount changes that would give a discount raise PRICE_VIA_PROTOCOL (#57), judged against that branch''s values.';

revoke all on function app.set_cafe_setting(text, jsonb, uuid) from public, anon;
grant execute on function app.set_cafe_setting(text, jsonb, uuid) to authenticated;

drop function if exists app.set_cafe_settings(jsonb);

create or replace function app.set_cafe_settings(p_settings jsonb, p_venue_id uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $set_settings_0209$
declare
  v_key    text;
  v_venue  uuid;
  v_result jsonb := '[]'::jsonb;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());

  if p_settings is null or jsonb_typeof(p_settings) <> 'object' then
    raise exception 'INVALID_SETTINGS' using errcode = 'P0001',
      hint = 'expected a JSON object of {key: value}';
  end if;

  -- An empty object is a no-op, not an error: the hero builder computes its
  -- diff client-side and may legitimately find nothing changed.
  for v_key in select k from jsonb_object_keys(p_settings) k order by k loop
    v_result := v_result || jsonb_build_array(
      app.set_cafe_setting(v_key, p_settings -> v_key, v_venue)
    );
  end loop;

  return v_result;
end $set_settings_0209$;

comment on function app.set_cafe_settings(jsonb, uuid) is
  '0050, 0209. Manager or owner: several cafe settings at one branch, atomically, each through app.set_cafe_setting.';

revoke all on function app.set_cafe_settings(jsonb, uuid) from public, anon;
grant execute on function app.set_cafe_settings(jsonb, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Realtime (0033 body): the payload names the branch
-- ---------------------------------------------------------------------------
create or replace function app.rt_settings_changed() returns trigger
language plpgsql security definer set search_path = public as $rt_set_0209$
begin
  if coalesce(new.is_public, old.is_public) then
    begin
      perform realtime.send(
        jsonb_build_object(
          'table',    'cafe_settings',
          'key',      coalesce(new.key, old.key),
          'venue_id', coalesce(new.venue_id, old.venue_id),
          'op',       tg_op),
        'settings_changed',
        'menu',
        true);
    exception when others then null;
    end;
  end if;
  return coalesce(new, old);
end $rt_set_0209$;

revoke all on function app.rt_settings_changed() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. assistant_settings_read (0207 body): cafe keys per branch
-- ---------------------------------------------------------------------------
create or replace function app.assistant_settings_read()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_settings_read_0209$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'platform',   (select to_jsonb(ps) from platform_settings ps where ps.id),
    'venues',     (select coalesce(jsonb_agg(to_jsonb(vs) || jsonb_build_object(
                             'venue_name_en', v.name_en, 'venue_name_ar', v.name_ar,
                             'cafe', (select coalesce(jsonb_object_agg(cs.key, cs.value), '{}'::jsonb)
                                        from cafe_settings cs where cs.venue_id = v.id))
                           order by v.created_at), '[]'::jsonb)
                     from venue_settings vs join venues v on v.id = vs.venue_id),
    'cafe',       (select coalesce(jsonb_object_agg(cs.key, cs.value), '{}'::jsonb)
                     from cafe_settings cs where cs.venue_id = app.current_venue_or_default()),
    'tax_groups', (select coalesce(jsonb_agg(to_jsonb(tg) order by tg.name_en), '[]'::jsonb) from tax_groups tg));
end $assistant_settings_read_0209$;

comment on function app.assistant_settings_read() is
  '0109, 0207, 0209. Owner-only (reached through app.assistant_run_tool). The chain''s platform_settings row, every branch''s venue_settings row with its name and its cafe_settings keys, the default branch''s cafe keys under cafe (kept for the existing prompt), and the tax groups.';
