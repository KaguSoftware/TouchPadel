-- 0180 suggestions — the staff suggestion box: every role posts, the manager and
-- the owner read and mark them seen.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.4; plan #63).
-- Depends on: nothing.
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- SIGNED, NOT ANONYMOUS (PROPOSAL): the manager can follow a suggestion up,
-- and the author sees whether it was seen. Nothing else (PROPOSAL): no
-- photo, no reply and no push; the badge is new_count. The form asks for no
-- guest names or phone numbers, in the same words as item notes (plan #43),
-- and nothing here stores any.
--
-- Not audited (PROPOSAL, §2.22): a suggestion and its seen mark keep who and
-- when on the row. Excluded from the owner assistant (§5.7, PROPOSAL): staff
-- free text for the manager and the owner, never sent to the LLM, so the
-- table gets no app.assistant_readable_columns rows.
--
-- WHO READS. The table is MGMT at the venue; an author reads their own
-- through my_suggestions. No client holds a write grant.
--
-- covered by packages/db/tests/suggestions.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists staff_suggestions (
  id          uuid primary key default gen_random_uuid(),
  venue_id    uuid not null references venues(id),
  author_id   uuid not null references staff(id),
  body        text not null check (length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now(),
  seen_by     uuid references staff(id),
  seen_at     timestamptz,
  constraint staff_suggestions_seen_chk check ((seen_by is null) = (seen_at is null))
);

create index if not exists staff_suggestions_venue_idx
  on staff_suggestions (venue_id, created_at desc);

comment on table staff_suggestions is
  'suggestions (§2.24.4, #63): the staff suggestion box. Any active staff member posts (app.add_suggestion), signed; the manager and the owner read every one and mark it seen. No photo, reply or push, and no guest data. Read by MGMT at the venue; an author reads their own through app.my_suggestions. Excluded from the owner assistant.';
comment on column staff_suggestions.id is 'Suggestion id.';
comment on column staff_suggestions.venue_id is 'The venue.';
comment on column staff_suggestions.author_id is 'Who posted it (suggestions are signed).';
comment on column staff_suggestions.body is 'The suggestion, as typed in the writer''s language (1 to 1000 characters).';
comment on column staff_suggestions.created_at is 'When it was posted.';
comment on column staff_suggestions.seen_by is 'The manager or owner who first marked it seen; NULL while new.';
comment on column staff_suggestions.seen_at is 'When it was first marked seen; NULL while new.';

alter table staff_suggestions enable row level security;

drop policy if exists staff_suggestions_mgmt_read on staff_suggestions;
create policy staff_suggestions_mgmt_read on staff_suggestions
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on staff_suggestions to authenticated;
grant all on staff_suggestions to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.add_suggestion — any active staff member at the venue.
-- ---------------------------------------------------------------------------
create or replace function app.add_suggestion(
  p_body            text,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $add_suggestion_0180$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_id     uuid;
  v_result jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'add_suggestion');
  if v_replay is not null then
    return v_replay;
  end if;

  if v_body is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'body';
  end if;
  if length(v_body) > 1000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'body';
  end if;

  insert into staff_suggestions (venue_id, author_id, body)
  values (v_venue, auth.uid(), v_body)
  returning id into v_id;

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $add_suggestion_0180$;

comment on function app.add_suggestion(text, uuid, text) is
  'suggestions (§2.24.4). Any active staff member at the venue: posts a signed suggestion (1 to 1000 characters). Returns {id}. Idempotent by key. FORBIDDEN, TEXT_REQUIRED, TEXT_TOO_LONG (hint body). Not audited; no push.';

revoke all on function app.add_suggestion(text, uuid, text) from public, anon;
grant execute on function app.add_suggestion(text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.my_suggestions — the author's own, newest first, and whether each
--    was seen.
-- ---------------------------------------------------------------------------
create or replace function app.my_suggestions(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_suggestions_0180$
declare
  v_venue uuid;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows  jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',         x.id,
           'body',       x.body,
           'created_at', x.created_at,
           'seen',       x.seen_at is not null,
           'seen_at',    x.seen_at)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from staff_suggestions s
           where s.venue_id = v_venue and s.author_id = auth.uid()
           order by s.created_at desc, s.id
           limit v_limit) x;

  return jsonb_build_object('suggestions', v_rows);
end $my_suggestions_0180$;

comment on function app.my_suggestions(uuid, int) is
  'suggestions (§2.24.4). Any active staff member at the venue: {suggestions: [{id, body, created_at, seen, seen_at}]}, their own, newest first, p_limit 1 to 100 (default 30). Who marked it seen is not shown. FORBIDDEN for anyone else.';

revoke all on function app.my_suggestions(uuid, int) from public, anon;
grant execute on function app.my_suggestions(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.suggestions_page — MGMT at the venue: new, seen or all, each with
--    its author's name and role.
-- ---------------------------------------------------------------------------
create or replace function app.suggestions_page(
  p_venue_id uuid default null,
  p_filter   text default 'new',
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $suggestions_page_0180$
declare
  v_venue  uuid;
  v_filter text := coalesce(p_filter, 'new');
  v_limit  int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_total  int;
  v_new    int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_filter not in ('new','seen','all') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'filter';
  end if;

  select count(*) into v_total
    from staff_suggestions s
   where s.venue_id = v_venue
     and (v_filter = 'all' or (v_filter = 'new') = (s.seen_at is null));
  select count(*) into v_new
    from staff_suggestions s
   where s.venue_id = v_venue and s.seen_at is null;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           x.id,
           'author_name',  a.display_name,
           'author_role',  a.role,
           'body',         x.body,
           'created_at',   x.created_at,
           'seen_by_name', sb.display_name,
           'seen_at',      x.seen_at)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from staff_suggestions s
           where s.venue_id = v_venue
             and (v_filter = 'all' or (v_filter = 'new') = (s.seen_at is null))
           order by s.created_at desc, s.id
           limit v_limit offset v_offset) x
    left join staff a  on a.id = x.author_id
    left join staff sb on sb.id = x.seen_by;

  return jsonb_build_object('suggestions', v_rows, 'new_count', v_new, 'total', v_total);
end $suggestions_page_0180$;

comment on function app.suggestions_page(uuid, text, int, int) is
  'suggestions (§2.24.4). MGMT at the venue: {suggestions: [{id, author_name, author_role, body, created_at, seen_by_name, seen_at}], new_count, total} for p_filter new, seen or all, newest first, p_limit 1 to 200. INVALID_ARGUMENT (hint filter); FORBIDDEN for anyone else.';

revoke all on function app.suggestions_page(uuid, text, int, int) from public, anon;
grant execute on function app.suggestions_page(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.mark_suggestion_seen — MGMT at its venue. State-idempotent: a
--    repeat keeps the first mark.
-- ---------------------------------------------------------------------------
create or replace function app.mark_suggestion_seen(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $mark_suggestion_seen_0180$
declare
  v_row staff_suggestions%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from staff_suggestions where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);

  if v_row.seen_at is null then
    update staff_suggestions set seen_by = auth.uid(), seen_at = now()
     where id = p_id
     returning * into v_row;
  end if;
  return jsonb_build_object('seen_at', v_row.seen_at);
end $mark_suggestion_seen_0180$;

comment on function app.mark_suggestion_seen(uuid) is
  'suggestions (§2.24.4). MGMT at the suggestion''s venue: marks it seen and returns {seen_at}; a repeat keeps the first mark. REF_NOT_FOUND (unknown or elsewhere), FORBIDDEN. Not audited.';

revoke all on function app.mark_suggestion_seen(uuid) from public, anon;
grant execute on function app.mark_suggestion_seen(uuid) to authenticated;
