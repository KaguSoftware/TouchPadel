set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0393 — dev monitoring (Majed, 2026-11-01, launch findings F-15, F-26, F-43,
-- F-55; DECISIONS.md "Monitoring contract").
--
-- Before this, a crash on a phone, a till or the web site went nowhere
-- (telemetry.ts's reporter was never set), an edge function's 500 lived only
-- in the function log, and a failed cron run only in cron.job_run_details.
-- Now every app reports to ONE table, and the dev role (0392) and the owner
-- read it on the operator's Monitoring page.
--
--   app.monitoring_events   the events. RLS on; dev and owner may select;
--                           nobody writes it but the functions below.
--   app.report_event(...)   the public door: anon and authenticated (every
--                           app, signed in or not) and service_role (edge
--                           functions). NEVER raises to the caller, whatever
--                           it is handed: an app reporting a crash must not
--                           crash again. Rate-limited per caller (30 events in
--                           10 minutes, 10 more for "Report crash" presses)
--                           and per source (2,000 in 10 minutes), size-capped
--                           (message 1,000 chars, detail 8 KB, else cut down
--                           to its key names), and scrubbed: keys naming a
--                           PIN, token, password, phone, email, card are
--                           dropped, values that look like one are masked
--                           (app.monitor_scrub / app.monitor_scrub_text).
--                           A client may only claim source operator, mobile
--                           or web; edge, db and cron are the server's.
--   app.monitor(...)        the SQL door for migrations, RPCs and cron bodies:
--                           the same insert, no rate limit, never raises.
--   app.monitoring_events_page / app.monitoring_summary
--                           the panel's reads (dev, owner).
--   app.monitor_cron_failures()
--                           cron tp_monitor_cron (every 5 minutes): each pg_cron
--                           run that FAILED since the last look becomes one
--                           event per job (kind cron_failed, source cron), so
--                           an uncaught error in any of the ~28 tp_* jobs is
--                           seen without touching their bodies. 0394 adds
--                           app.monitor to the sweeps that CATCH their errors.
--   app.monitoring_prune()  cron tp_monitoring_prune (daily): events older than
--                           90 days go, in batches.
--   Setup failures (F-55) are 0385's: app.setup_check reports them here
--   through app.monitor, and both jobs below go through app.ensure_cron.
--
-- Email to contact@kagusoftware.com is LATER (DECISIONS.md): the one seam is
-- notifyByEmail in supabase/functions/_shared/monitoring.ts, called by nothing.
--
-- covered by packages/db/tests/monitoring.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. The table.
-- ---------------------------------------------------------------------------
create table if not exists app.monitoring_events (
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  source        text        not null,
  level         text        not null,
  kind          text        not null,
  message       text        not null,
  detail        jsonb       not null default '{}'::jsonb,
  app_version   text,
  venue_id      uuid references public.venues(id) on delete set null,
  staff_id      uuid references public.staff(id) on delete set null,
  -- No foreign key: the account merge guard (account-merge.test.ts) wants every
  -- FK to profiles named by app.profile_merge_columns, and a diagnostic row
  -- needs none. Retention (90 days) clears it.
  profile_id    uuid,
  user_reported boolean     not null default false,
  -- md5 of who sent it (account, else the forwarded address), for the rate
  -- limit only; never shown, never reversible to an address.
  caller_key    text,
  constraint monitoring_events_source_chk check (source in ('operator', 'mobile', 'web', 'edge', 'db', 'cron')),
  constraint monitoring_events_level_chk check (level in ('error', 'warn', 'info')),
  constraint monitoring_events_kind_chk check (kind ~ '^[a-z][a-z0-9_.]{0,47}$'),
  constraint monitoring_events_message_len check (char_length(message) between 1 and 1000),
  constraint monitoring_events_detail_obj check (jsonb_typeof(detail) = 'object'),
  constraint monitoring_events_detail_len check (octet_length(detail::text) <= 9000),
  constraint monitoring_events_version_len check (app_version is null or char_length(app_version) <= 40),
  constraint monitoring_events_caller_len check (caller_key is null or char_length(caller_key) <= 64)
);

comment on table app.monitoring_events is
  '0393: dev monitoring. One row per reported event from the operator, the phone, the web site, '
  'the edge functions, SQL (app.monitor) and the cron watcher. Written only by app.report_event and '
  'app.monitor; read by the dev role and the owner (Monitoring page). Pruned after 90 days.';

-- Plain CREATE INDEX on the table this file creates: it is empty, so the SHARE
-- lock is free (the 0364 precedent). The waiver for check:migrations:
--   MIGRATION-RISK-ACCEPTED: three indexes on app.monitoring_events, a table
--   created empty in the same migration
create index if not exists monitoring_events_at on app.monitoring_events (at desc);
create index if not exists monitoring_events_caller on app.monitoring_events (caller_key, at desc) where caller_key is not null;
create index if not exists monitoring_events_source_at on app.monitoring_events (source, at desc);

alter table app.monitoring_events enable row level security;
revoke all on table app.monitoring_events from public, anon, authenticated;
grant select on table app.monitoring_events to authenticated;
grant select, insert, delete on table app.monitoring_events to service_role;

drop policy if exists monitoring_events_dev_read on app.monitoring_events;
create policy monitoring_events_dev_read on app.monitoring_events
  for select to authenticated
  using ((select app.is_staff('dev', 'owner')));

-- The cron watcher's bookmark: the last cron.job_run_details.runid it read.
create table if not exists app.monitoring_cursor (
  id         boolean primary key default true,
  last_runid bigint  not null default 0,
  checked_at timestamptz,
  constraint monitoring_cursor_one check (id)
);
alter table app.monitoring_cursor enable row level security;
revoke all on table app.monitoring_cursor from public, anon, authenticated;
insert into app.monitoring_cursor (id, last_runid) values (true, 0) on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Scrubbing. Pure; granted to nobody but the definer bodies below.
-- ---------------------------------------------------------------------------
create or replace function app.monitor_scrub_text(p_text text) returns text
language plpgsql immutable set search_path = public as $monitor_scrub_text_0393$
declare
  -- A canonical UUID (8-4-4-4-12 hex) is an id and an ISO date (2026-11-01,
  -- with an optional time) a date, never a phone or card number: both are set
  -- aside before the digit-run mask and put back after, or a digit-heavy id
  -- (c0000000-0000-4000-8000-000000000001) came out as c[number]. Mirrored by
  -- scrubText in @touch/core/monitoring.
  c_uuid constant text := '[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}'
                          || '|[0-9]{4}-[0-9]{2}-[0-9]{2}([T ][0-9]{2}:[0-9]{2}(:[0-9]{2}(\.[0-9]+)?)?)?';
  c_hold constant text := chr(1);
  v      text := replace(coalesce(p_text, ''), chr(1), '');
  v_ids  text[];
  v_id   text;
begin
  select array_agg(m[1] order by n) into v_ids
    from regexp_matches(v, '(' || c_uuid || ')', 'g') with ordinality as r(m, n);
  -- (m[1] is the whole match: the outer group.)
  v := regexp_replace(v, c_uuid, c_hold, 'g');
  v := regexp_replace(v, '\meyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}', '[token]', 'g');
  v := regexp_replace(v, '\m[Bb]earer\s+[A-Za-z0-9._~+/=-]{8,}', 'Bearer [token]', 'g');
  v := regexp_replace(v, '\m(sb_secret_|sb_publishable_|sk-|sk_live_|pk_live_)[A-Za-z0-9_-]{6,}', '[key]', 'g');
  v := regexp_replace(v, '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[email]', 'g');
  -- Eight or more digits, perhaps led by + and broken by spaces or dashes: a
  -- phone or card number.
  v := regexp_replace(v, '\+?[0-9]([ -]?[0-9]){7,}', '[number]', 'g');
  if v_ids is not null then
    foreach v_id in array v_ids loop
      v := overlay(v placing v_id from strpos(v, c_hold) for 1);
    end loop;
  end if;
  return v;
end
$monitor_scrub_text_0393$;

revoke all on function app.monitor_scrub_text(text) from public, anon, authenticated;

create or replace function app.monitor_key_is_secret(p_key text) returns boolean
language sql immutable set search_path = public as $monitor_key_is_secret_0393$
  with w as (
    select array_remove(
             string_to_array(
               regexp_replace(lower(regexp_replace(coalesce(p_key, ''), '([a-z0-9])([A-Z])', '\1_\2', 'g')),
                              '[^a-z0-9]+', '_', 'g'),
               '_'),
             '') as words
  )
  select (select words from w) && array[
           'pin', 'pins', 'pass', 'passwd', 'password', 'passcode', 'secret', 'secrets', 'token',
           'tokens', 'jwt', 'bearer', 'authorization', 'authorisation', 'apikey', 'cookie', 'cookies',
           'session', 'otp', 'phone', 'phones', 'msisdn', 'email', 'emails', 'mail', 'cvv', 'iban',
           'pan', 'card']::text[]
      or array_to_string((select words from w), '_')
           ~ '(^|_)(api|access|private|refresh)_key(_|$)|(^|_)service_role(_|$)|(^|_)mobile_number(_|$)';
$monitor_key_is_secret_0393$;

revoke all on function app.monitor_key_is_secret(text) from public, anon, authenticated;

create or replace function app.monitor_scrub(p_value jsonb, p_depth int default 0) returns jsonb
language plpgsql immutable set search_path = public as $monitor_scrub_0393$
declare
  v_out jsonb;
  r     record;
begin
  if p_value is null then
    return 'null'::jsonb;
  end if;
  case jsonb_typeof(p_value)
    when 'string' then
      return to_jsonb(left(app.monitor_scrub_text(p_value #>> '{}'), 500));
    when 'object' then
      if p_depth >= 4 then return to_jsonb('[deep]'::text); end if;
      v_out := '{}'::jsonb;
      for r in select key, value from jsonb_each(p_value) limit 60 loop
        if not app.monitor_key_is_secret(r.key) then
          v_out := v_out || jsonb_build_object(left(r.key, 64), app.monitor_scrub(r.value, p_depth + 1));
        end if;
      end loop;
      return v_out;
    when 'array' then
      if p_depth >= 4 then return to_jsonb('[deep]'::text); end if;
      select coalesce(jsonb_agg(app.monitor_scrub(e.value, p_depth + 1) order by e.ord), '[]'::jsonb)
        into v_out
        from jsonb_array_elements(p_value) with ordinality as e(value, ord)
       where e.ord <= 20;
      return v_out;
    else
      return p_value;
  end case;
end
$monitor_scrub_0393$;

revoke all on function app.monitor_scrub(jsonb, int) from public, anon, authenticated;

-- The detail as stored: scrubbed, an object, and at most 8 KB (a bigger one
-- is cut down to its key names).
create or replace function app.monitor_detail(p_detail jsonb) returns jsonb
language plpgsql immutable set search_path = public as $monitor_detail_0393$
declare
  v jsonb;
begin
  if p_detail is null or jsonb_typeof(p_detail) <> 'object' then
    v := case when p_detail is null or p_detail = 'null'::jsonb then '{}'::jsonb
              else jsonb_build_object('value', app.monitor_scrub(p_detail, 1)) end;
  else
    v := app.monitor_scrub(p_detail, 0);
  end if;
  if octet_length(v::text) > 8000 then
    v := jsonb_build_object(
      'truncated', true,
      'bytes', octet_length(v::text),
      'keys', (select coalesce(jsonb_agg(k), '[]'::jsonb)
                 from (select k from jsonb_object_keys(v) as k limit 40) s));
  end if;
  return v;
exception when others then
  return '{}'::jsonb;
end
$monitor_detail_0393$;

revoke all on function app.monitor_detail(jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. The insert both doors share. Never raises; answers the new id or NULL.
-- ---------------------------------------------------------------------------
create or replace function app.monitor_insert(
  p_source        text,
  p_level         text,
  p_kind          text,
  p_message       text,
  p_detail        jsonb,
  p_app_version   text,
  p_user_reported boolean,
  p_caller_key    text
) returns bigint
language plpgsql security definer set search_path = public as $monitor_insert_0393$
declare
  v_source  text := lower(btrim(coalesce(p_source, '')));
  v_level   text := lower(btrim(coalesce(p_level, '')));
  v_kind    text := lower(btrim(coalesce(p_kind, '')));
  v_message text;
  v_uid     uuid;
  v_staff   uuid;
  v_venue   uuid;
  v_id      bigint;
begin
  if v_source not in ('operator', 'mobile', 'web', 'edge', 'db', 'cron') then
    v_source := 'db';
  end if;
  if v_level not in ('error', 'warn', 'info') then
    v_level := 'error';
  end if;
  if v_kind !~ '^[a-z][a-z0-9_.]{0,47}$' then
    v_kind := 'unknown';
  end if;
  v_message := left(btrim(app.monitor_scrub_text(coalesce(p_message, ''))), 1000);
  if v_message = '' then
    v_message := v_kind;
  end if;

  begin
    v_uid := auth.uid();
  exception when others then
    v_uid := null;
  end;
  if v_uid is not null then
    begin
      if app.staff_role() is not null then
        v_staff := v_uid;
      end if;
    exception when others then
      v_staff := null;
    end;
  end if;
  begin
    v_venue := app.resolve_venue();
  exception when others then
    v_venue := null;
  end;

  insert into app.monitoring_events
    (source, level, kind, message, detail, app_version, venue_id, staff_id, profile_id, user_reported, caller_key)
  values
    (v_source, v_level, v_kind, v_message, app.monitor_detail(p_detail),
     nullif(left(btrim(coalesce(p_app_version, '')), 40), ''),
     v_venue, v_staff,
     case when exists (select 1 from profiles where id = v_uid) then v_uid end,
     coalesce(p_user_reported, false), left(p_caller_key, 64))
  returning id into v_id;
  return v_id;
exception when others then
  raise warning 'monitor_insert: % (%)', sqlerrm, sqlstate;
  return null;
end
$monitor_insert_0393$;

revoke all on function app.monitor_insert(text, text, text, text, jsonb, text, boolean, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.report_event — the public door.
-- ---------------------------------------------------------------------------
create or replace function app.report_event(
  p_source        text,
  p_level         text,
  p_kind          text,
  p_message       text,
  p_detail        jsonb   default '{}'::jsonb,
  p_app_version   text    default null,
  p_user_reported boolean default false
) returns void
language plpgsql security definer set search_path = public as $report_event_0393$
declare
  -- The JWT's role, never current_user: inside a definer body that is the
  -- owner for every caller.
  v_service boolean := coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', '') = 'service_role';
  v_source  text := lower(btrim(coalesce(p_source, '')));
  v_uid     uuid;
  v_fwd     text;
  v_key     text;
  v_recent  int;
  v_user    boolean := coalesce(p_user_reported, false);
begin
  -- Anyone may report; nobody is refused with an error. Everything below
  -- either stores the event or drops it silently.
  if not v_service and v_source not in ('operator', 'mobile', 'web') then
    return;
  end if;
  if v_service and v_source not in ('operator', 'mobile', 'web', 'edge', 'db', 'cron') then
    v_source := 'edge';
  end if;

  -- A body that is plainly too big is dropped before any work is done on it.
  if octet_length(coalesce(p_message, '')) > 20000
     or octet_length(coalesce(p_detail::text, '')) > 64000 then
    return;
  end if;

  if not v_service then
    begin
      v_uid := auth.uid();
    exception when others then
      v_uid := null;
    end;
    begin
      v_fwd := split_part(coalesce(app.req_header('x-forwarded-for'), ''), ',', 1);
    exception when others then
      v_fwd := '';
    end;
    v_key := md5(coalesce(v_uid::text, 'ip:' || nullif(btrim(v_fwd), ''), 'anon'));

    -- Per caller: 30 events in 10 minutes, and 10 more pressed by a person
    -- (a crash loop must not use up the button).
    select count(*) into v_recent
      from app.monitoring_events
     where caller_key = v_key
       and user_reported = v_user
       and at > now() - interval '10 minutes';
    if v_recent >= (case when v_user then 10 else 30 end) then
      return;
    end if;

    -- Per source: 2,000 in 10 minutes, so a flood from many callers cannot
    -- fill the table either.
    select count(*) into v_recent
      from app.monitoring_events
     where source = v_source
       and at > now() - interval '10 minutes';
    if v_recent >= 2000 then
      return;
    end if;
  end if;

  perform app.monitor_insert(v_source, p_level, p_kind, p_message, p_detail, p_app_version, v_user, v_key);
exception when others then
  -- Never raises to the caller (the contract).
  return;
end
$report_event_0393$;

revoke all on function app.report_event(text, text, text, text, jsonb, text, boolean) from public;
grant execute on function app.report_event(text, text, text, text, jsonb, text, boolean) to anon, authenticated, service_role;

comment on function app.report_event(text, text, text, text, jsonb, text, boolean) is
  '0393: dev monitoring''s public door (anon, authenticated, service_role). Stores one event in '
  'app.monitoring_events or drops it silently; never raises. Clients may claim source operator, '
  'mobile or web; the service role any. Rate-limited per caller (30 per 10 minutes, 10 more '
  'user-reported) and per source (2,000 per 10 minutes); message capped at 1,000 chars, detail at '
  '8 KB; PINs, tokens, passwords, phones, emails and card numbers are dropped or masked.';

-- ---------------------------------------------------------------------------
-- 5. app.monitor — the SQL door (migrations, RPCs, cron bodies). Never raises.
-- ---------------------------------------------------------------------------
create or replace function app.monitor(
  p_source  text,
  p_level   text,
  p_kind    text,
  p_message text,
  p_detail  jsonb default '{}'::jsonb
) returns void
language plpgsql security definer set search_path = public as $monitor_0393$
begin
  perform app.monitor_insert(p_source, p_level, p_kind, p_message, p_detail, null, false, null);
exception when others then
  return;
end
$monitor_0393$;

revoke all on function app.monitor(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app.monitor(text, text, text, text, jsonb) to service_role;

comment on function app.monitor(text, text, text, text, jsonb) is
  '0393: store one dev-monitoring event from SQL (a cron sweep that caught an error, a setup check). '
  'Internal: service role and definer bodies only. No rate limit; never raises.';

-- ---------------------------------------------------------------------------
-- 6. The panel's reads (dev and owner).
-- ---------------------------------------------------------------------------
create or replace function app.monitoring_events_page(
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_source        text        default null,
  p_level         text        default null,
  p_kind          text        default null,
  p_user_reported boolean     default null,
  p_before_id     bigint      default null,
  p_limit         int         default 50
) returns jsonb
language plpgsql stable security definer set search_path = public as $monitoring_events_page_0393$
declare
  v_limit int := least(greatest(coalesce(p_limit, 50), 1), 200);
  v_rows  jsonb;
  v_next  bigint;
begin
  if not app.is_staff('dev', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  with page as (
    select e.*
      from app.monitoring_events e
     where (p_from is null or e.at >= p_from)
       and (p_to is null or e.at <= p_to)
       and (p_source is null or e.source = p_source)
       and (p_level is null or e.level = p_level)
       and (p_kind is null or e.kind = p_kind)
       and (p_user_reported is null or e.user_reported = p_user_reported)
       and (p_before_id is null or e.id < p_before_id)
     order by e.id desc
     limit v_limit + 1
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', p.id,
           'at', p.at,
           'source', p.source,
           'level', p.level,
           'kind', p.kind,
           'message', p.message,
           'detail', p.detail,
           'appVersion', p.app_version,
           'venueId', p.venue_id,
           'venueName', v.name_en,
           'staffId', p.staff_id,
           'staffName', s.display_name,
           'signedIn', p.profile_id is not null,
           'userReported', p.user_reported
         ) order by p.id desc) filter (where p.rn <= v_limit), '[]'::jsonb),
         case when count(*) > v_limit then min(p.id) filter (where p.rn <= v_limit) end
    into v_rows, v_next
    from (select page.*, row_number() over (order by page.id desc) as rn from page) p
    left join venues v on v.id = p.venue_id
    left join staff s on s.id = p.staff_id;

  return jsonb_build_object('rows', v_rows, 'nextBeforeId', v_next, 'serverTime', now());
end
$monitoring_events_page_0393$;

revoke all on function app.monitoring_events_page(timestamptz, timestamptz, text, text, text, boolean, bigint, int) from public, anon;
grant execute on function app.monitoring_events_page(timestamptz, timestamptz, text, text, text, boolean, bigint, int) to authenticated;

create or replace function app.monitoring_summary(
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_bucket        text        default 'hour',
  p_source        text        default null,
  p_level         text        default null,
  p_kind          text        default null,
  p_user_reported boolean     default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $monitoring_summary_0393$
declare
  v_to     timestamptz := coalesce(p_to, now());
  v_from   timestamptz;
  v_bucket text := case when p_bucket = 'day' then 'day' else 'hour' end;
  v_counts jsonb;
  v_kinds  jsonb;
  v_src    jsonb;
  v_totals jsonb;
begin
  if not app.is_staff('dev', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_from := coalesce(p_from, v_to - case when v_bucket = 'day' then interval '30 days' else interval '48 hours' end);
  if v_to - v_from > interval '92 days' then
    v_from := v_to - interval '92 days';
  end if;

  with w as (
    select e.at, e.level, e.kind, e.source, e.user_reported
      from app.monitoring_events e
     where e.at >= v_from and e.at <= v_to
       and (p_source is null or e.source = p_source)
       and (p_level is null or e.level = p_level)
       and (p_kind is null or e.kind = p_kind)
       and (p_user_reported is null or e.user_reported = p_user_reported)
  ),
  b as (
    select date_trunc(v_bucket, w.at at time zone 'Asia/Baghdad') at time zone 'Asia/Baghdad' as bucket,
           count(*) filter (where w.level = 'error') as error,
           count(*) filter (where w.level = 'warn')  as warn,
           count(*) filter (where w.level = 'info')  as info,
           count(*) as total
      from w group by 1
  ),
  k as (
    select w.kind, count(*) as n, max(w.at) as last_at
      from w group by w.kind order by count(*) desc, w.kind limit 30
  ),
  s as (
    select w.source, count(*) as n, max(w.at) as last_at from w group by w.source
  )
  select
    (select coalesce(jsonb_agg(jsonb_build_object(
              'bucket', b.bucket, 'error', b.error, 'warn', b.warn, 'info', b.info, 'total', b.total)
              order by b.bucket), '[]'::jsonb) from b),
    (select coalesce(jsonb_agg(jsonb_build_object('kind', k.kind, 'count', k.n, 'lastAt', k.last_at)
              order by k.n desc, k.kind), '[]'::jsonb) from k),
    (select coalesce(jsonb_agg(jsonb_build_object('source', s.source, 'count', s.n, 'lastAt', s.last_at)
              order by s.source), '[]'::jsonb) from s),
    (select jsonb_build_object(
              'total', count(*),
              'error', count(*) filter (where w.level = 'error'),
              'warn', count(*) filter (where w.level = 'warn'),
              'info', count(*) filter (where w.level = 'info'),
              'userReported', count(*) filter (where w.user_reported)) from w)
    into v_counts, v_kinds, v_src, v_totals;

  return jsonb_build_object(
    'from', v_from, 'to', v_to, 'bucket', v_bucket,
    'counts', v_counts, 'kinds', v_kinds, 'sources', v_src, 'totals', v_totals,
    'cronCheckedAt', (select checked_at from app.monitoring_cursor where id),
    'serverTime', now());
end
$monitoring_summary_0393$;

revoke all on function app.monitoring_summary(timestamptz, timestamptz, text, text, text, text, boolean) from public, anon;
grant execute on function app.monitoring_summary(timestamptz, timestamptz, text, text, text, text, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. The cron watcher: failed pg_cron runs become events.
-- ---------------------------------------------------------------------------
create or replace function app.monitor_cron_failures() returns int
language plpgsql security definer set search_path = public as $monitor_cron_failures_0393$
declare
  v_last  bigint;
  v_max   bigint;
  v_n     int := 0;
  r       record;
begin
  if to_regclass('cron.job_run_details') is null then
    return 0;
  end if;
  select last_runid into v_last from app.monitoring_cursor where id for update;
  v_last := coalesce(v_last, 0);
  execute 'select coalesce(max(runid), 0) from cron.job_run_details' into v_max;
  -- A pruned or rebuilt run table restarts its ids: start again from there.
  if v_max < v_last then
    v_last := 0;
  end if;

  for r in execute $q$
    select j.jobname,
           count(*)                                    as failures,
           max(d.end_time)                             as last_end,
           (array_agg(d.return_message order by d.runid desc))[1] as last_message
      from cron.job_run_details d
      left join cron.job j on j.jobid = d.jobid
     where d.runid > $1 and d.runid <= $2 and d.status = 'failed'
     group by j.jobname
  $q$ using v_last, v_max
  loop
    perform app.monitor('cron', 'error', 'cron_failed',
      coalesce(r.jobname, 'cron job') || ' failed'
        || case when r.failures > 1 then ' ' || r.failures || ' times' else '' end
        || ': ' || coalesce(left(r.last_message, 600), 'no message'),
      jsonb_build_object('job', r.jobname, 'failures', r.failures, 'lastEnd', r.last_end));
    v_n := v_n + 1;
  end loop;

  update app.monitoring_cursor set last_runid = v_max, checked_at = now() where id;
  return v_n;
exception when others then
  perform app.monitor('cron', 'error', 'cron_failed', 'monitor_cron_failures: ' || sqlerrm,
                      jsonb_build_object('sqlstate', sqlstate));
  return 0;
end
$monitor_cron_failures_0393$;

revoke all on function app.monitor_cron_failures() from public, anon, authenticated;
grant execute on function app.monitor_cron_failures() to service_role;

-- ---------------------------------------------------------------------------
-- 8. Retention: 90 days, in batches.
-- ---------------------------------------------------------------------------
create or replace function app.monitoring_prune() returns int
language plpgsql security definer set search_path = public as $monitoring_prune_0393$
declare
  v_n int;
begin
  delete from app.monitoring_events
   where id in (select id from app.monitoring_events
                 where at < now() - interval '90 days'
                 order by id
                 limit 50000);
  get diagnostics v_n = row_count;
  return v_n;
exception when others then
  perform app.monitor('cron', 'error', 'cron_failed', 'monitoring_prune: ' || sqlerrm,
                      jsonb_build_object('sqlstate', sqlstate));
  return 0;
end
$monitoring_prune_0393$;

revoke all on function app.monitoring_prune() from public, anon, authenticated;
grant execute on function app.monitoring_prune() to service_role;

-- ---------------------------------------------------------------------------
-- 9. The schedules, through 0385's app.ensure_cron (F-55): a job that does not
-- land fails this migration loudly and is registered for the hourly
-- tp_setup_check, instead of a NOTICE nobody reads.
-- ---------------------------------------------------------------------------
do $monitoring_cron_0393$
begin
  perform app.ensure_cron('tp_monitor_cron', '*/5 * * * *', 'select app.monitor_cron_failures();');
  perform app.ensure_cron('tp_monitoring_prune', '55 3 * * *', 'select app.monitoring_prune();');
end $monitoring_cron_0393$;

-- Start the watcher at the present, so years of old failures are not replayed.
do $monitoring_cursor_start_0393$
begin
  if to_regclass('cron.job_run_details') is not null then
    execute 'update app.monitoring_cursor set last_runid = (select coalesce(max(runid), 0) from cron.job_run_details) where id';
  end if;
exception when others then
  null;
end $monitoring_cursor_start_0393$;
