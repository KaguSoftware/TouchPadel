-- 0187 marketing_requests — staff ask marketing for something, marketing answers,
-- and marketing reads what its campaigns reached, in counts only.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.11, §2.17, §2.21, §2.22; plan #73).
-- Depends on: staff_push_keys (J: marketing_request_new and
-- marketing_request_answered), staff_media_folders (J: the requests folder
-- and the marketing_request: read rule in app.staff_media_visible).
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- REQUESTS. Every staff role but marketing asks (PROPOSAL: marketing does not
-- ask itself): a title, what is wanted, an optional date and an optional menu
-- item, and up to four photos. Marketing answers each one done or declined,
-- with an answer; the asker may withdraw an open one. MGMT reads them all.
-- "Approval" (§0 P7) is parked: nothing here makes a campaign live.
--
-- RESULTS (#73, PROPOSAL). marketing_campaign_results gives marketing and
-- MGMT the venue's campaigns with the counts of 0073's
-- marketing_campaign_performance (sends, delivered, failed, redemptions) and
-- no money: no discount, no revenue, no tab or order figure. It neither calls
-- nor re-issues that MGMT-only function. This revises §2.17's "no campaign
-- performance read" to counts only.
--
-- WHO READS. marketing_requests is MGMT at the venue; the asker reads their
-- own and marketing the venue's through the RPCs below. No client holds a
-- write grant.
--
-- covered by packages/db/tests/marketing-requests.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists marketing_requests (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  requested_by  uuid not null references staff(id),
  title         text not null check (length(btrim(title)) between 1 and 120),
  body          text not null check (length(btrim(body)) between 1 and 2000),
  want_by       date,
  menu_item_id  uuid references menu_items(id) on delete set null,
  photos        text[] not null default '{}' check (cardinality(photos) <= 4),
  status        text not null default 'open'
                check (status in ('open','done','declined','withdrawn')),
  answer        text check (answer is null or length(answer) <= 2000),
  answered_by   uuid references staff(id),
  answered_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint marketing_requests_answered_chk check ((status in ('done','declined')) = (answered_by is not null)),
  constraint marketing_requests_answered_at_chk check ((answered_by is null) = (answered_at is null)),
  constraint marketing_requests_answer_chk
    check (status not in ('done','declined') or coalesce(length(btrim(answer)),0) > 0)
);

create index if not exists marketing_requests_venue_status_idx
  on marketing_requests (venue_id, status, created_at);

comment on table marketing_requests is
  'marketing_requests (§2.24.11, #73): what staff ask marketing for, and marketing''s answer. Asked through app.add_marketing_request by any role but marketing, answered done or declined by marketing (app.answer_marketing_request), withdrawn by the asker. Read by MGMT at the venue; the asker and marketing read through RPCs.';
comment on column marketing_requests.id is 'Request id.';
comment on column marketing_requests.venue_id is 'The venue.';
comment on column marketing_requests.requested_by is 'Who asked.';
comment on column marketing_requests.title is 'What it is, as typed (1 to 120 characters).';
comment on column marketing_requests.body is 'What is wanted, as typed in the asker''s language (1 to 2000 characters).';
comment on column marketing_requests.want_by is 'The day it is wanted by, if any.';
comment on column marketing_requests.menu_item_id is 'The menu item it is about, if any.';
comment on column marketing_requests.photos is 'Photos: staff-media paths in the requests folder (at most 4).';
comment on column marketing_requests.status is 'open, done or declined (marketing answered), or withdrawn (the asker took it back).';
comment on column marketing_requests.answer is 'Marketing''s answer, as typed (at most 2000 characters); required once done or declined.';
comment on column marketing_requests.answered_by is 'The marketing staff member who answered.';
comment on column marketing_requests.answered_at is 'When it was answered.';
comment on column marketing_requests.created_at is 'When it was asked.';

alter table marketing_requests enable row level security;

drop policy if exists marketing_requests_mgmt_read on marketing_requests;
create policy marketing_requests_mgmt_read on marketing_requests
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

grant select on marketing_requests to authenticated;
grant all on marketing_requests to service_role;

-- ---------------------------------------------------------------------------
-- 2. app.add_marketing_request — any active staff member at the venue except
--    marketing. Tells marketing at the venue.
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
language plpgsql security definer set search_path = public as $add_marketing_request_0187$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_title  text := nullif(btrim(coalesce(p_title, '')), '');
  v_body   text := nullif(btrim(coalesce(p_body, '')), '');
  v_photos text[];
  v_id     uuid;
  v_result jsonb;
begin
  if app.staff_role() is null or app.is_staff('marketing') then
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
end $add_marketing_request_0187$;

comment on function app.add_marketing_request(text, text, date, uuid, text[], uuid, text) is
  'marketing_requests (§2.24.11). Any active staff member at the venue except marketing: asks marketing for something (title 1 to 120, body 1 to 2000, an optional want-by day not in the past, an optional menu item of the venue, up to 4 photos in the requests folder) and tells marketing at the venue (staff_task / marketing_request_new). Returns {id}. Idempotent by key. FORBIDDEN, TEXT_REQUIRED, TEXT_TOO_LONG (hint title or body), INVALID_ARGUMENT (hint want_by or photos), ITEM_NOT_FOUND, PHOTO_PATH_INVALID. Audit marketing.request.add.';

revoke all on function app.add_marketing_request(text, text, date, uuid, text[], uuid, text) from public, anon;
grant execute on function app.add_marketing_request(text, text, date, uuid, text[], uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.withdraw_marketing_request — the asker, while it is open.
-- ---------------------------------------------------------------------------
create or replace function app.withdraw_marketing_request(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $withdraw_marketing_request_0187$
declare
  v_row marketing_requests%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from marketing_requests where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if v_row.requested_by is distinct from auth.uid() then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.status <> 'open' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;

  update marketing_requests set status = 'withdrawn' where id = p_id;

  perform app.write_audit('marketing.request.withdraw', 'marketing_request', p_id::text,
                          jsonb_build_object('status', 'open'),
                          jsonb_build_object('status', 'withdrawn'));
  return jsonb_build_object('status', 'withdrawn');
end $withdraw_marketing_request_0187$;

comment on function app.withdraw_marketing_request(uuid) is
  'marketing_requests (§2.24.11). The asker takes back an open request. Returns {status}. REF_NOT_FOUND (unknown or elsewhere), FORBIDDEN (not theirs), SUBMISSION_DECIDED (already answered or withdrawn). Audit marketing.request.withdraw.';

revoke all on function app.withdraw_marketing_request(uuid) from public, anon;
grant execute on function app.withdraw_marketing_request(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.answer_marketing_request — marketing at the request's venue: done or
--    declined, with an answer. Tells the asker.
-- ---------------------------------------------------------------------------
create or replace function app.answer_marketing_request(
  p_id      uuid,
  p_outcome text,
  p_answer  text
) returns jsonb
language plpgsql security definer set search_path = public as $answer_marketing_request_0187$
declare
  v_row    marketing_requests%rowtype;
  v_answer text := nullif(btrim(coalesce(p_answer, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from marketing_requests where id = p_id for update;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  if not app.is_staff_at(v_row.venue_id, 'marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_row.venue_id::text, true);
  if v_row.status <> 'open' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  if p_outcome is null or p_outcome not in ('done','declined') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'outcome';
  end if;
  if v_answer is null then
    raise exception 'TEXT_REQUIRED' using errcode = 'P0001', hint = 'answer';
  end if;
  if length(v_answer) > 2000 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'answer';
  end if;

  update marketing_requests
     set status = p_outcome, answer = v_answer, answered_by = auth.uid(), answered_at = now()
   where id = p_id
   returning * into v_row;

  perform app.write_audit('marketing.request.answer', 'marketing_request', p_id::text,
                          jsonb_build_object('status', 'open'),
                          jsonb_build_object('status', p_outcome));

  perform app.notify_staff(
    array[v_row.requested_by],
    'staff_decided',
    jsonb_build_object(
      'route', 'staff',
      'id', v_row.id,
      'title_key', 'marketing_request_answered',
      'params', jsonb_build_object('title', v_row.title)));

  return jsonb_build_object('status', v_row.status, 'answered_at', v_row.answered_at);
end $answer_marketing_request_0187$;

comment on function app.answer_marketing_request(uuid, text, text) is
  'marketing_requests (§2.24.11). Marketing at the request''s venue: answers an open request done or declined, with an answer (1 to 2000), and tells the asker (staff_decided / marketing_request_answered). Returns {status, answered_at}. REF_NOT_FOUND, FORBIDDEN, SUBMISSION_DECIDED (already answered or withdrawn), INVALID_ARGUMENT (hint outcome), TEXT_REQUIRED, TEXT_TOO_LONG (hint answer). Audit marketing.request.answer.';

revoke all on function app.answer_marketing_request(uuid, text, text) from public, anon;
grant execute on function app.answer_marketing_request(uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.my_marketing_requests — the asker's own requests at the venue,
--    newest first, with marketing's answers.
-- ---------------------------------------------------------------------------
create or replace function app.my_marketing_requests(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_marketing_requests_0187$
declare
  v_venue uuid;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows  jsonb;
begin
  if app.staff_role() is null or app.is_staff('marketing') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               x.id,
           'title',            x.title,
           'body',             x.body,
           'want_by',          x.want_by,
           'menu_item_id',     x.menu_item_id,
           'item_name_en',     m.name_en,
           'item_name_ar',     m.name_ar,
           'photos',           to_jsonb(x.photos),
           'status',           x.status,
           'answer',           x.answer,
           'answered_by_name', s.display_name,
           'answered_at',      x.answered_at,
           'created_at',       x.created_at)
         order by x.created_at desc, x.id), '[]'::jsonb)
    into v_rows
    from (select * from marketing_requests r
           where r.venue_id = v_venue and r.requested_by = auth.uid()
           order by r.created_at desc, r.id
           limit v_limit) x
    left join menu_items m on m.id = x.menu_item_id
    left join staff s on s.id = x.answered_by;

  return jsonb_build_object('requests', v_rows);
end $my_marketing_requests_0187$;

comment on function app.my_marketing_requests(uuid, int) is
  'marketing_requests (§2.24.11). Any active staff member at the venue except marketing: {requests: [{id, title, body, want_by, menu_item_id, item_name_en, item_name_ar, photos, status, answer, answered_by_name, answered_at, created_at}]}, the caller''s own, newest first, p_limit 1 to 100 (default 30). FORBIDDEN for marketing and anyone else.';

revoke all on function app.my_marketing_requests(uuid, int) from public, anon;
grant execute on function app.my_marketing_requests(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.marketing_requests_page — marketing and MGMT at the venue: open,
--    answered (done or declined) or all, with who asked.
-- ---------------------------------------------------------------------------
create or replace function app.marketing_requests_page(
  p_venue_id uuid default null,
  p_filter   text default 'open',
  p_limit    int  default 50,
  p_offset   int  default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $marketing_requests_page_0187$
declare
  v_venue    uuid;
  v_filter   text := coalesce(p_filter, 'open');
  v_statuses text[];
  v_limit    int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_offset   int := greatest(coalesce(p_offset, 0), 0);
  v_rows     jsonb;
  v_total    int;
  v_open     int;
begin
  if not app.is_staff('marketing','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'marketing','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_statuses := case v_filter
                  when 'open'     then array['open']
                  when 'answered' then array['done','declined']
                  when 'all'      then array['open','done','declined','withdrawn']
                end;
  if v_statuses is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'filter';
  end if;

  select count(*) into v_total
    from marketing_requests r where r.venue_id = v_venue and r.status = any(v_statuses);
  select count(*) into v_open
    from marketing_requests r where r.venue_id = v_venue and r.status = 'open';

  -- Open ones oldest first (what has waited longest); the rest newest first.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                x.id,
           'title',             x.title,
           'body',              x.body,
           'want_by',           x.want_by,
           'menu_item_id',      x.menu_item_id,
           'item_name_en',      m.name_en,
           'item_name_ar',      m.name_ar,
           'photos',            to_jsonb(x.photos),
           'status',            x.status,
           'answer',            x.answer,
           'answered_by_name',  a.display_name,
           'answered_at',       x.answered_at,
           'created_at',        x.created_at,
           'requested_by_name', q.display_name,
           'requested_by_role', q.role)
         order by x.ord), '[]'::jsonb)
    into v_rows
    from (select r.*,
                 row_number() over (order by
                   case when v_filter = 'open' then r.created_at end asc,
                   case when v_filter <> 'open' then r.created_at end desc,
                   r.id) as ord
            from marketing_requests r
           where r.venue_id = v_venue and r.status = any(v_statuses)
           order by ord
           limit v_limit offset v_offset) x
    left join menu_items m on m.id = x.menu_item_id
    left join staff a on a.id = x.answered_by
    left join staff q on q.id = x.requested_by;

  return jsonb_build_object('requests', v_rows, 'open_count', v_open, 'total', v_total);
end $marketing_requests_page_0187$;

comment on function app.marketing_requests_page(uuid, text, int, int) is
  'marketing_requests (§2.24.11). Marketing and MGMT at the venue: {requests: [{id, title, body, want_by, menu_item_id, item_name_en, item_name_ar, photos, status, answer, answered_by_name, answered_at, created_at, requested_by_name, requested_by_role}], open_count, total} for p_filter open (oldest first), answered (done or declined) or all (newest first), p_limit 1 to 200. INVALID_ARGUMENT (hint filter); FORBIDDEN for anyone else.';

revoke all on function app.marketing_requests_page(uuid, text, int, int) from public, anon;
grant execute on function app.marketing_requests_page(uuid, text, int, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.marketing_campaign_results — marketing and MGMT at the venue: the
--    venue's campaigns with reach and redemption counts, no money.
-- ---------------------------------------------------------------------------
create or replace function app.marketing_campaign_results(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $marketing_campaign_results_0187$
declare
  v_venue uuid;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows  jsonb;
begin
  if not app.is_staff('marketing','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'marketing','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0073's counts: the sends, and for a campaign with a promotion the
  -- redemptions inside its window. A campaign without one has no
  -- redemptions to count (null, not 0), as marketing_campaign_performance
  -- says. Never the discount, the revenue or a tab.
  select coalesce(jsonb_agg(jsonb_build_object(
           'campaign_id',     c.id,
           'name_en',         c.name_en,
           'name_ar',         c.name_ar,
           'channel',         c.channel,
           'status',          c.status,
           'starts_at',       c.starts_at,
           'ends_at',         c.ends_at,
           'sends',           sd.sends,
           'delivered',       sd.delivered,
           'failed',          sd.failed,
           'last_sent_at',    sd.last_sent_at,
           'attributable',    c.promotion_id is not null,
           'redemptions',     case when c.promotion_id is null then null
                                   else (select count(*)
                                           from promotion_redemptions pr
                                          where pr.promotion_id = c.promotion_id
                                            and pr.redeemed_at >= coalesce(c.starts_at, c.created_at)
                                            and (c.ends_at is null or pr.redeemed_at < c.ends_at)) end,
           'suggested_by_me', c.suggested_by is not distinct from auth.uid())
         order by c.created_at desc, c.id), '[]'::jsonb)
    into v_rows
    from (select * from marketing_campaigns
           where venue_id = v_venue
           order by created_at desc, id
           limit v_limit) c
    cross join lateral (
      select coalesce(sum(s.recipients), 0) as sends,
             coalesce(sum(s.delivered), 0)  as delivered,
             coalesce(sum(s.failed), 0)     as failed,
             max(s.at)                      as last_sent_at
        from marketing_sends s
       where s.campaign_id = c.id) sd;

  return jsonb_build_object('campaigns', v_rows);
end $marketing_campaign_results_0187$;

comment on function app.marketing_campaign_results(uuid, int) is
  'marketing_requests (§2.24.11, #73). Marketing and MGMT at the venue: {campaigns: [{campaign_id, name_en, name_ar, channel, status, starts_at, ends_at, sends, delivered, failed, last_sent_at, attributable, redemptions, suggested_by_me}]}, the venue''s campaigns newest first, p_limit 1 to 100 (default 30). Counts only: redemptions of the campaign''s promotion inside its window (NULL without a promotion), never a discount, revenue, tab or order figure. FORBIDDEN for anyone else.';

revoke all on function app.marketing_campaign_results(uuid, int) from public, anon;
grant execute on function app.marketing_campaign_results(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Owner assistant: marketing_requests joins the table_read allowlist (the
--    0144 statement, limited to this migration's table, §1.5).
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
   and c.table_name in ('marketing_requests')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
