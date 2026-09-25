-- 0179 teachings — what the head barista and the head chef teach their team.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.3, §2.21, §2.22; plan #64).
-- Depends on: staff_push_keys (J: the teaching_new title key),
-- staff_media_folders (J: the teachings folder, app.staff_team, the
-- teaching: read rule in app.staff_media_visible).
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- TWO TEAMS. bar (head_barista, barista) and kitchen (head_chef, chef). A head
-- writes for their own team; the manager and the owner write for either
-- (PROPOSAL). The team reads its own teachings, MGMT reads both. Cashier,
-- court desk, driver, marketing and prep read none.
--
-- STAFF TEXT. One title and one body in the writer's language (#48), shown as
-- typed. Nothing records who opened a teaching (SOW:265, :480), and the audit
-- rows carry ids and counts, never the text.
--
-- WHO READS. The table is MGMT at the venue; the team reads through
-- teachings_for_me. No client holds a write grant.
--
-- covered by packages/db/tests/teachings.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists teachings (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id),
  team         text not null check (team in ('bar','kitchen')),
  author_id    uuid not null references staff(id),
  title        text not null check (length(btrim(title)) between 1 and 120),
  body         text not null check (length(btrim(body)) between 1 and 4000),
  photos       text[] not null default '{}' check (cardinality(photos) <= 6),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  archived_at  timestamptz,
  archived_by  uuid references staff(id),
  constraint teachings_archived_chk check ((archived_at is null) = (archived_by is null))
);

create index if not exists teachings_team_idx
  on teachings (venue_id, team, created_at desc) where archived_at is null;

comment on table teachings is
  'teachings (§2.24.3, #64): what a head writes for their team (bar or kitchen), in one language, with photos. Written through app.save_teaching and app.archive_teaching; read by MGMT at the venue, and by the team through app.teachings_for_me. No read receipts.';
comment on column teachings.id is 'Teaching id.';
comment on column teachings.venue_id is 'The venue.';
comment on column teachings.team is 'bar (head_barista, barista) or kitchen (head_chef, chef): who reads it. Never changes.';
comment on column teachings.author_id is 'Who wrote it: the team''s head, or a manager or the owner.';
comment on column teachings.title is 'The title, as typed (1 to 120 characters).';
comment on column teachings.body is 'The teaching, as typed in the writer''s language (1 to 4000 characters).';
comment on column teachings.photos is 'Photos: staff-media paths in the teachings folder (at most 6).';
comment on column teachings.created_at is 'When it was written.';
comment on column teachings.updated_at is 'When it was last edited.';
comment on column teachings.archived_at is 'When it was archived; an archived teaching leaves the team''s list. NULL while current.';
comment on column teachings.archived_by is 'Who archived it.';

alter table teachings enable row level security;

drop policy if exists teachings_mgmt_read on teachings;
create policy teachings_mgmt_read on teachings
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on teachings to authenticated;
grant all on teachings to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.save_teaching — a new teaching (p_id NULL): a head for their own
--    team, or MGMT for either; an edit: its author, or MGMT at its venue.
--    The team never changes.
-- ---------------------------------------------------------------------------
create or replace function app.save_teaching(
  p_title           text,
  p_body            text,
  p_team            text   default null,
  p_photos          text[] default '{}',
  p_id              uuid   default null,
  p_venue_id        uuid   default null,
  p_idempotency_key text   default null
) returns jsonb
language plpgsql security definer set search_path = public as $save_teaching_0179$
declare
  v_venue  uuid;
  v_row    teachings%rowtype;
  v_mgmt   boolean;
  v_team   text;
  v_replay jsonb;
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_photos text[];
  v_id     uuid;
  v_result jsonb;
begin
  if p_id is null then
    if not app.is_staff('head_barista','head_chef','manager','owner') then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    v_venue := coalesce(p_venue_id, app.current_venue());
    if not (v_venue = any(app.staff_venue_ids())
            and app.is_staff_at(v_venue, 'head_barista','head_chef','manager','owner')) then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  else
    -- Row-addressed: a teaching elsewhere, or archived, answers as missing.
    if app.staff_role() is null then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    select * into v_row from teachings where id = p_id for update;
    if not found or not (v_row.venue_id = any(app.staff_venue_ids())) or v_row.archived_at is not null then
      raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
    end if;
    if not (v_row.author_id = auth.uid() or app.is_staff_at(v_row.venue_id, 'manager','owner')) then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    v_venue := v_row.venue_id;
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  v_mgmt := app.is_staff_at(v_venue, 'manager','owner');

  if p_team is not null and p_team not in ('bar','kitchen') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
  end if;
  if p_id is null then
    if v_mgmt then
      if p_team is null then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
      end if;
      v_team := p_team;
    else
      v_team := app.staff_team(app.staff_role());
      if p_team is not null and p_team is distinct from v_team then
        raise exception 'FORBIDDEN' using errcode = 'P0001';
      end if;
    end if;
    v_replay := app.claim_replay(p_idempotency_key, 'save_teaching');
    if v_replay is not null then
      return v_replay;
    end if;
  else
    if p_team is not null and p_team <> v_row.team then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
    end if;
    v_team := v_row.team;
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
  if length(v_body) > 4000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;
  -- In the order given, once each.
  v_photos := coalesce(array(select x from unnest(coalesce(p_photos, '{}'::text[])) with ordinality as u(x, o)
                              group by x order by min(o)), '{}'::text[]);
  if cardinality(v_photos) > 6 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'photos';
  end if;

  if p_id is null then
    insert into teachings (venue_id, team, author_id, title, body, photos)
    values (v_venue, v_team, auth.uid(), v_title, v_body, v_photos)
    returning id into v_id;
  else
    update teachings
       set title = v_title, body = v_body, photos = v_photos, updated_at = now()
     where id = p_id
     returning id into v_id;
  end if;

  perform app.claim_staff_media(v_photos, v_venue, array['teachings'], 'teaching:' || v_id::text);

  perform app.write_audit('teaching.save', 'teaching', v_id::text,
                          case when p_id is null then null
                               else jsonb_build_object('photos', cardinality(v_row.photos)) end,
                          jsonb_build_object('team', v_team, 'photos', cardinality(v_photos),
                                             'edit', p_id is not null));

  -- A new teaching tells its team; notify_staff skips the author, and a
  -- head writing several in a row buzzes each reader once in 15 minutes.
  if p_id is null then
    perform app.notify_staff(
      app.staff_ids_with_roles(v_venue, case v_team
                                          when 'bar' then array['head_barista','barista']::staff_role[]
                                          else array['head_chef','chef']::staff_role[] end),
      'staff_info',
      jsonb_build_object(
        'route', 'staff',
        'id', v_id,
        'title_key', 'teaching_new',
        'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()),
                                     'title', v_title)),
      'teaching:' || auth.uid()::text);
  end if;

  v_result := jsonb_build_object('id', v_id);
  if p_id is null and p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $save_teaching_0179$;

comment on function app.save_teaching(text, text, text, text[], uuid, uuid, text) is
  'teachings (§2.24.3). A new teaching (p_id NULL; idempotent by key): the head barista or head chef for their own team (p_team defaults to it, another team is FORBIDDEN), or MGMT for either (p_team required); tells the team (staff_info / teaching_new). An edit: its author, or MGMT at its venue; the team never changes. Title 1 to 120, body 1 to 4000, photos teachings slots of the caller (at most 6). Returns {id}. FORBIDDEN, INVALID_ARGUMENT (hint team or photos), REF_NOT_FOUND (unknown, archived or elsewhere), TEXT_REQUIRED, TEXT_TOO_LONG, PHOTO_PATH_INVALID. Audit teaching.save.';

revoke all on function app.save_teaching(text, text, text, text[], uuid, uuid, text) from public, anon;
grant execute on function app.save_teaching(text, text, text, text[], uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.archive_teaching — its author, or MGMT at its venue.
-- ---------------------------------------------------------------------------
create or replace function app.archive_teaching(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $archive_teaching_0179$
declare
  v_row teachings%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from teachings where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) or v_row.archived_at is not null then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not (v_row.author_id = auth.uid() or app.is_staff_at(v_row.venue_id, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);

  update teachings set archived_at = now(), archived_by = auth.uid() where id = p_id;

  perform app.write_audit('teaching.archive', 'teaching', p_id::text,
                          jsonb_build_object('archived', false),
                          jsonb_build_object('archived', true, 'team', v_row.team));
end $archive_teaching_0179$;

comment on function app.archive_teaching(uuid) is
  'teachings (§2.24.3). Its author, or MGMT at its venue: archives a teaching, which leaves the team''s list, and its photos leave the team''s reads. REF_NOT_FOUND (unknown, already archived or elsewhere), FORBIDDEN. Audit teaching.archive.';

revoke all on function app.archive_teaching(uuid) from public, anon;
grant execute on function app.archive_teaching(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.teachings_for_me — the bar and kitchen teams their own team's, MGMT
--    both (or one, by p_team). Current teachings, newest first.
-- ---------------------------------------------------------------------------
create or replace function app.teachings_for_me(
  p_venue_id uuid default null,
  p_team     text default null,
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $teachings_for_me_0179$
declare
  v_venue  uuid;
  v_mgmt   boolean;
  v_teams  text[];
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 100);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_total  int;
begin
  if not app.is_staff('head_barista','barista','head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','barista','head_chef','chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_team is not null and p_team not in ('bar','kitchen') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'team';
  end if;
  v_mgmt := app.is_staff_at(v_venue, 'manager','owner');
  if v_mgmt then
    v_teams := case when p_team is null then array['bar','kitchen'] else array[p_team] end;
  else
    v_teams := array[app.staff_team(app.staff_role())];
    if p_team is not null and p_team <> v_teams[1] then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
  end if;

  select count(*) into v_total
    from teachings t
   where t.venue_id = v_venue and t.team = any(v_teams) and t.archived_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          x.id,
           'team',        x.team,
           'title',       x.title,
           'body',        x.body,
           'photos',      to_jsonb(x.photos),
           'author_name', s.display_name,
           'created_at',  x.created_at,
           'updated_at',  x.updated_at,
           'mine',        x.author_id = auth.uid(),
           'editable',    x.author_id = auth.uid() or v_mgmt)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from teachings t
           where t.venue_id = v_venue and t.team = any(v_teams) and t.archived_at is null
           order by t.created_at desc, t.id
           limit v_limit offset v_offset) x
    left join staff s on s.id = x.author_id;

  return jsonb_build_object('teachings', v_rows, 'total', v_total);
end $teachings_for_me_0179$;

comment on function app.teachings_for_me(uuid, text, int, int) is
  'teachings (§2.24.3). The bar team (head_barista, barista) and the kitchen team (head_chef, chef) read their own team''s current teachings, MGMT both or the one p_team names: {teachings: [{id, team, title, body, photos, author_name, created_at, updated_at, mine, editable}], total}, newest first, p_limit 1 to 100. FORBIDDEN for anyone else and for another team; INVALID_ARGUMENT (hint team).';

revoke all on function app.teachings_for_me(uuid, text, int, int) from public, anon;
grant execute on function app.teachings_for_me(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Owner assistant: teachings joins the table_read allowlist (the 0144
--    statement, limited to this migration's table, §1.5).
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
   and c.table_name in ('teachings')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
