set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0207_platform_settings — multi-venue slice 2, step 1 (plan: MV5).
--
-- venue_settings is still one row, but slice 2 makes it one row PER VENUE. A
-- handful of its columns are not a venue's business at all: the LLM budget and
-- price list (one Anthropic account, one bill), the chain's currency and the
-- per-guest hold cap (a guest is shared by every branch, so a per-branch cap
-- could be bypassed by booking at two). Those move here, to a singleton that
-- stays a singleton for good.
--
-- What changes:
--   * platform_settings (boolean-PK singleton, like venue_settings was),
--     backfilled from the current venue_settings row.
--   * Every LLM / assistant reader of those columns is re-issued against it,
--     each from its latest body: llm_begin_request (0079), llm_record_usage
--     both arities (0079, 0111), llm_usage_summary (0079), llm_price_calc
--     (0111), assistant_usage (0111), assistant_settings_read and
--     assistant_system_status (0109), assistant_model_allowed, assistant_models,
--     assistant_set_model, assistant_set_default_model (0140),
--     assistant_set_monthly_cap (0149), assistant_prewarm_nudge (0141).
--   * The LLM day is the chain's day: platform_settings.timezone, copied from
--     the venue today. A spend cap that rolls over per branch would be two caps.
--
-- What does NOT change yet: the old columns stay on venue_settings, unread by
-- any function after this file, so an edge function still on the previous
-- deploy keeps working until functions-deploy.yml has shipped the new ones. A
-- later migration drops them. hold_slot keeps reading max_live_holds_per_guest
-- from venue_settings until the booking family is re-issued (same slice).

-- ---------------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------------
create table if not exists platform_settings (
  id                          boolean primary key default true check (id),
  currency                    char(3) not null default 'IQD',
  timezone                    text    not null default 'Asia/Baghdad',
  max_live_holds_per_guest    int     not null default 3,
  llm_daily_request_limit     int     not null default 200,
  llm_monthly_cost_cap_micros bigint  not null default 20000000,
  llm_cost_micros_per_mtok    bigint  not null default 500000,
  llm_pricing                 jsonb   not null default '{}'::jsonb,
  llm_default_model           text    not null default 'claude-opus-5',
  updated_at                  timestamptz not null default now()
);

comment on table platform_settings is
  '0207 (multi-venue slice 2, MV5). The settings that belong to the whole chain, not one branch: currency, the chain''s accounting timezone for the LLM budget, the per-guest hold cap, and every LLM budget and price-list knob. Exactly one row. Written only by owner RPCs (assistant_set_default_model, assistant_set_monthly_cap) and migrations.';
comment on column platform_settings.timezone is
  '0207. The chain''s day for the global LLM budget (llm_usage is keyed by date). A branch''s own trading day uses venues.timezone.';
comment on column platform_settings.max_live_holds_per_guest is
  '0207 (from venue_settings, 0048/C1). How many live holds one guest may have across every branch. Global because the guest is.';
comment on column platform_settings.llm_daily_request_limit is
  '0207 (from venue_settings, 0079). Requests per chain day; 0 turns every LLM surface off.';
comment on column platform_settings.llm_monthly_cost_cap_micros is
  '0207 (from venue_settings, 0079). USD micros per calendar month (chain timezone).';
comment on column platform_settings.llm_cost_micros_per_mtok is
  '0207 (from venue_settings, 0079). Blended fallback rate for a model absent from llm_pricing.';
comment on column platform_settings.llm_pricing is
  '0207 (from venue_settings, 0111). Model -> four rates in USD micros per 1,000,000 tokens.';
comment on column platform_settings.llm_default_model is
  '0207 (from venue_settings, 0140). The model a new assistant chat uses. Must be a key of llm_pricing.';

-- Backfill from today's single venue_settings row (the default venue's, if a
-- second row ever exists by the time this runs).
insert into platform_settings (id, currency, timezone, max_live_holds_per_guest,
                               llm_daily_request_limit, llm_monthly_cost_cap_micros,
                               llm_cost_micros_per_mtok, llm_pricing, llm_default_model)
select true, vs.currency, vs.timezone, vs.max_live_holds_per_guest,
       vs.llm_daily_request_limit, vs.llm_monthly_cost_cap_micros,
       vs.llm_cost_micros_per_mtok, vs.llm_pricing, vs.llm_default_model
  from venue_settings vs
 order by (vs.venue_id = app.default_venue()) desc nulls last
 limit 1
on conflict (id) do nothing;

-- A database with no venue_settings row (none should exist) still gets the row.
insert into platform_settings (id) values (true) on conflict (id) do nothing;

alter table platform_settings enable row level security;
grant select on platform_settings to authenticated;
grant all on platform_settings to service_role;

-- Any active staff member may read it (0156's role-agnostic form); nobody
-- writes it from a client.
create policy platform_settings_staff_read on platform_settings for select to authenticated
  using (app.staff_role() is not null);

comment on column venue_settings.llm_daily_request_limit is
  'DEPRECATED 0207: moved to platform_settings; no function reads it. Dropped by a later migration.';
comment on column venue_settings.llm_monthly_cost_cap_micros is
  'DEPRECATED 0207: moved to platform_settings; no function reads it. Dropped by a later migration.';
comment on column venue_settings.llm_cost_micros_per_mtok is
  'DEPRECATED 0207: moved to platform_settings; no function reads it. Dropped by a later migration.';
comment on column venue_settings.llm_pricing is
  'DEPRECATED 0207: moved to platform_settings; no function reads it. Dropped by a later migration.';
comment on column venue_settings.llm_default_model is
  'DEPRECATED 0207: moved to platform_settings; no function reads it. Dropped by a later migration.';

-- The assistant's table_read allowlist (0109:94) learns the new table, the
-- 0111 way: every column, jsonb ones off by default.
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'table', c.data_type <> 'jsonb', c.data_type, c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and c.table_name = 'platform_settings'
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. The LLM budget (0079 bodies, one source changed)
-- ---------------------------------------------------------------------------
create or replace function app.llm_begin_request()
returns jsonb
language plpgsql security definer set search_path = public as $llm_begin_request_0207$
declare
  v_today        date;
  v_day_limit    int;
  v_cap_micros   bigint;
  v_requests     int;
  v_month_micros bigint;
begin
  -- The chain's own day, not UTC: a cap that rolls over at 03:00 local is a cap
  -- the owner does not recognise.
  select (now() at time zone timezone)::date,
         llm_daily_request_limit,
         llm_monthly_cost_cap_micros
    into v_today, v_day_limit, v_cap_micros
    from platform_settings
   where id;

  if v_today is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  -- Month-to-date spend BEFORE this request. Read first: a request that would
  -- start over the cap must not be counted as if it ran.
  select coalesce(sum(cost_micros), 0) into v_month_micros
    from llm_usage
   where usage_date >= date_trunc('month', v_today)::date
     and usage_date <= v_today;

  if v_month_micros >= v_cap_micros then
    raise exception 'LLM_MONTHLY_CAP' using errcode = 'P0001',
      detail = format('%s of %s micros spent this month', v_month_micros, v_cap_micros),
      hint = 'raise platform_settings.llm_monthly_cost_cap_micros, or wait for the month to roll';
  end if;

  -- Reserve the slot in the same statement that reads it, so two concurrent
  -- requests cannot both see the last one as free.
  insert into llm_usage (usage_date, requests)
  values (v_today, 1)
      on conflict (usage_date)
      do update set requests = llm_usage.requests + 1, updated_at = now()
   returning requests into v_requests;

  if v_requests > v_day_limit then
    -- Give the reservation back: this request is refused and did not run.
    update llm_usage set requests = requests - 1 where usage_date = v_today;
    raise exception 'LLM_DAILY_QUOTA' using errcode = 'P0001',
      detail = format('%s requests already made today, limit %s', v_requests - 1, v_day_limit),
      hint = 'raise platform_settings.llm_daily_request_limit, or try tomorrow';
  end if;

  return jsonb_build_object(
    'usage_date',            v_today,
    'requests_today',        v_requests,
    'daily_limit',           v_day_limit,
    'month_cost_micros',     v_month_micros,
    'monthly_cap_micros',    v_cap_micros);
end $llm_begin_request_0207$;

comment on function app.llm_begin_request() is
  '0079/SEC-29, 0207. Call once per insights request, BEFORE any model call. Raises LLM_DAILY_QUOTA or LLM_MONTHLY_CAP; otherwise reserves the slot and returns the standing budget (platform_settings). Service role only — the caller is analytics-insights, which has already checked the owner role.';

revoke all on function app.llm_begin_request() from public, anon, authenticated;
grant execute on function app.llm_begin_request() to service_role;

create or replace function app.llm_record_usage(
  p_model_calls       int,
  p_prompt_tokens     bigint,
  p_completion_tokens bigint
) returns void
language plpgsql security definer set search_path = public as $llm_record_usage_0207$
declare
  v_today date;
  v_rate  bigint;
begin
  select (now() at time zone timezone)::date, llm_cost_micros_per_mtok
    into v_today, v_rate
    from platform_settings
   where id;

  if v_today is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  insert into llm_usage (usage_date, model_calls, prompt_tokens, completion_tokens, cost_micros)
  values (
    v_today,
    greatest(coalesce(p_model_calls, 0), 0),
    greatest(coalesce(p_prompt_tokens, 0), 0),
    greatest(coalesce(p_completion_tokens, 0), 0),
    -- Integer arithmetic throughout: micros are the smallest unit, and a
    -- rounding drift on a spend cap is a bug that only shows up as money.
    ((greatest(coalesce(p_prompt_tokens, 0), 0)
      + greatest(coalesce(p_completion_tokens, 0), 0)) * v_rate) / 1000000)
      on conflict (usage_date) do update set
        model_calls       = llm_usage.model_calls       + excluded.model_calls,
        prompt_tokens     = llm_usage.prompt_tokens     + excluded.prompt_tokens,
        completion_tokens = llm_usage.completion_tokens + excluded.completion_tokens,
        cost_micros       = llm_usage.cost_micros       + excluded.cost_micros,
        updated_at        = now();
end $llm_record_usage_0207$;

comment on function app.llm_record_usage(int, bigint, bigint) is
  '0079/SEC-29, 0207. Records what a request actually consumed, so the NEXT one is measured against a real month-to-date figure. Never raises on the numbers — a failure to record must not fail a request the owner has already paid for.';

revoke all on function app.llm_record_usage(int, bigint, bigint) from public, anon, authenticated;
grant execute on function app.llm_record_usage(int, bigint, bigint) to service_role;

create or replace function app.llm_usage_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $llm_usage_summary_0207$
declare
  v_today date;
  v_out   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select (now() at time zone timezone)::date into v_today from platform_settings where id;

  select jsonb_build_object(
           'usage_date',         v_today,
           'requests_today',     coalesce((select requests from llm_usage where usage_date = v_today), 0),
           'daily_limit',        (select llm_daily_request_limit from platform_settings where id),
           'month_cost_micros',  coalesce((select sum(cost_micros) from llm_usage
                                            where usage_date >= date_trunc('month', v_today)::date
                                              and usage_date <= v_today), 0),
           'monthly_cap_micros', (select llm_monthly_cost_cap_micros from platform_settings where id),
           'cost_micros_per_mtok', (select llm_cost_micros_per_mtok from platform_settings where id))
    into v_out;
  return v_out;
end $llm_usage_summary_0207$;

comment on function app.llm_usage_summary() is
  '0079/SEC-29, 0207. Owner-only read of the standing LLM budget: requests today against the day limit, month-to-date spend against the cap, and the price estimate the spend figure depends on.';

revoke all on function app.llm_usage_summary() from public, anon;
grant execute on function app.llm_usage_summary() to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Pricing and the by-kind meter (0111 bodies, one source changed)
-- ---------------------------------------------------------------------------
create or replace function app.llm_price_calc(
  p_model       text,
  p_input       bigint,
  p_cache_write bigint,
  p_cache_read  bigint,
  p_output      bigint
) returns bigint
language plpgsql stable set search_path = public as $llm_price_calc_0207$
declare
  v_prices   jsonb;
  v_fallback bigint;
  v_in       bigint := greatest(coalesce(p_input, 0), 0);
  v_cw       bigint := greatest(coalesce(p_cache_write, 0), 0);
  v_cr       bigint := greatest(coalesce(p_cache_read, 0), 0);
  v_out      bigint := greatest(coalesce(p_output, 0), 0);
begin
  select llm_pricing -> p_model, llm_cost_micros_per_mtok
    into v_prices, v_fallback
    from platform_settings where id;

  if v_prices is null or jsonb_typeof(v_prices) <> 'object' then
    -- Not in the map: the 0079 blended rate over every kind.
    return ((v_in + v_cw + v_cr + v_out) * coalesce(v_fallback, 0)) / 1000000;
  end if;

  -- Integer arithmetic, one division at the end: micros are the smallest
  -- unit and a rounding drift on a spend cap only ever shows up as money.
  return (  v_in  * coalesce((v_prices ->> 'input')::bigint,       coalesce(v_fallback, 0))
          + v_cw  * coalesce((v_prices ->> 'cache_write')::bigint, coalesce(v_fallback, 0))
          + v_cr  * coalesce((v_prices ->> 'cache_read')::bigint,  coalesce(v_fallback, 0))
          + v_out * coalesce((v_prices ->> 'output')::bigint,      coalesce(v_fallback, 0))) / 1000000;
end $llm_price_calc_0207$;

comment on function app.llm_price_calc(text, bigint, bigint, bigint, bigint) is
  '0111, 0207. Definer-only arithmetic: USD micros for four token counts at platform_settings.llm_pricing -> p_model, or the blended llm_cost_micros_per_mtok when the model is absent. Shared by llm_record_usage, llm_price_micros and assistant_usage.';

revoke all on function app.llm_price_calc(text, bigint, bigint, bigint, bigint) from public, anon, authenticated;

create or replace function app.llm_record_usage(
  p_model       text,
  p_input       bigint,
  p_cache_write bigint,
  p_cache_read  bigint,
  p_output      bigint,
  p_model_calls int,
  p_surface     text default 'assistant'
) returns bigint
language plpgsql security definer set search_path = public as $llm_record_usage_0207b$
declare
  v_today date;
  v_cost  bigint;
begin
  select (now() at time zone timezone)::date into v_today from platform_settings where id;
  if v_today is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  v_cost := app.llm_price_calc(p_model, p_input, p_cache_write, p_cache_read, p_output);

  insert into llm_usage (usage_date, model_calls, prompt_tokens, cache_write_tokens, cache_read_tokens,
                         completion_tokens, cost_micros)
  values (v_today,
          greatest(coalesce(p_model_calls, 0), 0),
          greatest(coalesce(p_input, 0), 0),
          greatest(coalesce(p_cache_write, 0), 0),
          greatest(coalesce(p_cache_read, 0), 0),
          greatest(coalesce(p_output, 0), 0),
          v_cost)
      on conflict (usage_date) do update set
        model_calls        = llm_usage.model_calls        + excluded.model_calls,
        prompt_tokens      = llm_usage.prompt_tokens      + excluded.prompt_tokens,
        cache_write_tokens = llm_usage.cache_write_tokens + excluded.cache_write_tokens,
        cache_read_tokens  = llm_usage.cache_read_tokens  + excluded.cache_read_tokens,
        completion_tokens  = llm_usage.completion_tokens  + excluded.completion_tokens,
        cost_micros        = llm_usage.cost_micros        + excluded.cost_micros,
        updated_at         = now();

  return v_cost;
end $llm_record_usage_0207b$;

comment on function app.llm_record_usage(text, bigint, bigint, bigint, bigint, int, text) is
  '0111, 0207. Service role only. Records one request''s tokens by kind on today''s llm_usage row (chain day, platform_settings.timezone), priced from llm_pricing -> p_model (fallback: llm_cost_micros_per_mtok), and returns the cost in micros it recorded. p_surface names the caller (assistant, insights) and is reserved for a per-surface breakdown; it is not stored yet. The 0079 three-argument overload stays for analytics-insights.';

revoke all on function app.llm_record_usage(text, bigint, bigint, bigint, bigint, int, text) from public, anon, authenticated;
grant execute on function app.llm_record_usage(text, bigint, bigint, bigint, bigint, int, text) to service_role;

create or replace function app.assistant_usage(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_usage_0207$
declare
  v_today date;
  v_from  date;
  v_to    date;
  v_ps    platform_settings%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_ps from platform_settings where id;
  v_today := (now() at time zone v_ps.timezone)::date;
  v_to    := coalesce(p_to, v_today);
  v_from  := coalesce(p_from, date_trunc('month', v_to)::date);
  if v_to < v_from or (v_to - v_from) > 400 then
    raise exception 'INVALID_RANGE' using errcode = 'P0001',
      hint = 'p_from <= p_to and at most 400 days apart';
  end if;

  return jsonb_build_object(
    'range', jsonb_build_object('from', v_from, 'to', v_to),
    'days', (
      select coalesce(jsonb_agg(jsonb_build_object(
               'usage_date',         u.usage_date,
               'requests',           u.requests,
               'model_calls',        u.model_calls,
               'input_tokens',       u.prompt_tokens,
               'cache_write_tokens', u.cache_write_tokens,
               'cache_read_tokens',  u.cache_read_tokens,
               'output_tokens',      u.completion_tokens,
               'cost_micros',        u.cost_micros) order by u.usage_date), '[]'::jsonb)
        from llm_usage u where u.usage_date between v_from and v_to),
    'month', (
      select jsonb_build_object(
               'from',               date_trunc('month', v_today)::date,
               'to',                 v_today,
               'requests',           coalesce(sum(u.requests), 0),
               'model_calls',        coalesce(sum(u.model_calls), 0),
               'input_tokens',       coalesce(sum(u.prompt_tokens), 0),
               'cache_write_tokens', coalesce(sum(u.cache_write_tokens), 0),
               'cache_read_tokens',  coalesce(sum(u.cache_read_tokens), 0),
               'output_tokens',      coalesce(sum(u.completion_tokens), 0),
               'cost_micros',        coalesce(sum(u.cost_micros), 0))
        from llm_usage u
       where u.usage_date >= date_trunc('month', v_today)::date and u.usage_date <= v_today),
    'cap', jsonb_build_object(
      'usage_date',        v_today,
      'requests_today',    coalesce((select requests from llm_usage where usage_date = v_today), 0),
      'daily_limit',       v_ps.llm_daily_request_limit,
      'monthly_cap_micros', v_ps.llm_monthly_cost_cap_micros,
      'month_cost_micros', coalesce((select sum(cost_micros) from llm_usage
                                      where usage_date >= date_trunc('month', v_today)::date
                                        and usage_date <= v_today), 0)),
    'pricing',                  v_ps.llm_pricing,
    'fallback_micros_per_mtok', v_ps.llm_cost_micros_per_mtok);
end $assistant_usage_0207$;

comment on function app.assistant_usage(date, date) is
  '0111, 0207. Owner-only, read-only. The meter: per-day rows for [p_from, p_to] (default: the current month to date), the month-to-date sums, the standing cap, the price map and the fallback rate (platform_settings) — everything the usage page and the assistant''s own `usage` tool show.';

revoke all on function app.assistant_usage(date, date) from public, anon;
grant execute on function app.assistant_usage(date, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Assistant settings and status (0109 bodies)
-- ---------------------------------------------------------------------------
-- 'venue' becomes 'venues': every branch's settings row, keyed by venue id,
-- plus the chain's row under 'platform'. cafe_settings is still one key space
-- until the cafe_settings_per_venue step of this slice re-issues this again.
create or replace function app.assistant_settings_read()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_settings_read_0207$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'platform',   (select to_jsonb(ps) from platform_settings ps where ps.id),
    'venues',     (select coalesce(jsonb_agg(to_jsonb(vs) || jsonb_build_object(
                             'venue_name_en', v.name_en, 'venue_name_ar', v.name_ar)
                           order by v.created_at), '[]'::jsonb)
                     from venue_settings vs join venues v on v.id = vs.venue_id),
    'cafe',       (select coalesce(jsonb_object_agg(cs.key, cs.value), '{}'::jsonb) from cafe_settings cs),
    'tax_groups', (select coalesce(jsonb_agg(to_jsonb(tg) order by tg.name_en), '[]'::jsonb) from tax_groups tg));
end $assistant_settings_read_0207$;

comment on function app.assistant_settings_read() is
  '0109, 0207. Owner-only (reached through app.assistant_run_tool). The chain''s platform_settings row, every branch''s venue_settings row (with its name), every cafe_settings key with its value, and the tax groups.';

-- Staleness is judged against each heartbeat's OWN branch threshold, and every
-- branch's open day is listed (one per venue since 0134).
create or replace function app.assistant_system_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_system_status_0207$
declare
  v_cron    jsonb := '[]'::jsonb;
  v_index_q bigint := null;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- 0110 creates the index queue; until then the depth is null, not an error.
  if to_regclass('public.assistant_index_queue') is not null then
    execute 'select count(*) from public.assistant_index_queue where claimed_at is null' into v_index_q;
  end if;

  -- pg_cron keeps its ledger in the cron schema, absent on some stacks.
  if to_regclass('cron.job_run_details') is not null then
    execute $cron$
      select coalesce(jsonb_agg(jsonb_build_object(
               'jobname', j.jobname, 'schedule', j.schedule,
               'last_run', d.start_time, 'status', d.status) order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (
          select r.start_time, r.status from cron.job_run_details r
           where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
    $cron$ into v_cron;
  end if;

  return jsonb_build_object(
    'venue_mode',  app.venue_mode(),
    'is_degraded', app.is_degraded(),
    'venues',      (select coalesce(jsonb_agg(jsonb_build_object(
                       'venue_id',    v.id,
                       'name_en',     v.name_en,
                       'venue_mode',  app.venue_mode(v.id),
                       'is_degraded', app.is_degraded(v.id)) order by v.created_at), '[]'::jsonb)
                      from venues v where v.is_active),
    'day_session', (select to_jsonb(ds) from day_sessions ds
                     where ds.status <> 'closed' order by ds.opened_at desc limit 1),
    'day_sessions', (select coalesce(jsonb_agg(to_jsonb(ds) order by ds.opened_at desc), '[]'::jsonb)
                       from day_sessions ds where ds.status <> 'closed'),
    'heartbeats',  (select coalesce(jsonb_agg(jsonb_build_object(
                       'device_id',    h.device_id,
                       'venue_id',     h.venue_id,
                       'last_seen_at', h.last_seen_at,
                       'stale',        h.last_seen_at < now() - make_interval(secs => coalesce(vs.heartbeat_stale_seconds, 45)),
                       'is_till',      h.is_till,
                       'queue_depth',  h.queue_depth,
                       'app_version',  h.app_version,
                       'staff_id',     h.staff_id,
                       'staff_name',   s.display_name) order by h.device_id), '[]'::jsonb)
                      from device_heartbeats h
                      left join staff s on s.id = h.staff_id
                      left join venue_settings vs on vs.venue_id = h.venue_id),
    'outbox', jsonb_build_object(
       'push_pending',    (select count(*) from notification_outbox where sent_at is null),
       'telegram_queued', (select count(*) from telegram_outbox where status = 'queued'),
       'index_queued',    v_index_q),
    'cron', v_cron,
    'server_time', now());
end $assistant_system_status_0207$;

comment on function app.assistant_system_status() is
  '0109, 0207. Owner-only (reached through app.assistant_run_tool). Venue mode and degraded state (the default branch, and every active branch under venues), open day sessions (day_session = the newest, day_sessions = all of them), every heartbeat judged against its own branch''s staleness threshold, outbox depths, cron runs.';

-- ---------------------------------------------------------------------------
-- 5. Model choice (0140 bodies) and the monthly cap (0149 body)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_model_allowed(p_model text)
returns boolean
language sql stable security definer set search_path = public as $assistant_model_allowed_0207$
  select p_model is not null
     and exists (select 1 from platform_settings ps where ps.id and ps.llm_pricing ? p_model)
$assistant_model_allowed_0207$;

comment on function app.assistant_model_allowed(text) is
  '0140, 0207. True when platform_settings.llm_pricing has rates for the model — the only test the assistant applies to a model name.';

create or replace function app.assistant_models()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_models_0207$
declare
  v_out jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select jsonb_build_object(
           'default_model', ps.llm_default_model,
           'models',        coalesce((select jsonb_agg(k order by k) from jsonb_object_keys(ps.llm_pricing) k), '[]'::jsonb))
    into v_out
    from platform_settings ps
   where ps.id;
  return coalesce(v_out, jsonb_build_object('default_model', null, 'models', '[]'::jsonb));
end $assistant_models_0207$;

create or replace function app.assistant_set_model(p_id uuid, p_model text)
returns assistant_conversations
language plpgsql security definer set search_path = public as $assistant_set_model_0207$
declare
  v_row assistant_conversations;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_model is not null and not app.assistant_model_allowed(p_model) then
    raise exception 'ASSISTANT_MODEL_NOT_PRICED' using errcode = 'P0001',
      detail = p_model, hint = 'add the model''s four rates to platform_settings.llm_pricing first';
  end if;
  update assistant_conversations
     set model = p_model, updated_at = now()
   where id = p_id and owner_id = auth.uid() and archived_at is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'NOT_FOUND' using errcode = 'P0001', detail = 'conversation';
  end if;
  return v_row;
end $assistant_set_model_0207$;

create or replace function app.assistant_set_default_model(p_model text)
returns void
language plpgsql security definer set search_path = public as $assistant_set_default_model_0207$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not app.assistant_model_allowed(p_model) then
    raise exception 'ASSISTANT_MODEL_NOT_PRICED' using errcode = 'P0001',
      detail = p_model, hint = 'add the model''s four rates to platform_settings.llm_pricing first';
  end if;
  update platform_settings set llm_default_model = p_model, updated_at = now() where id;
end $assistant_set_default_model_0207$;

create or replace function app.assistant_set_monthly_cap(p_cap_micros bigint)
returns jsonb
language plpgsql security definer set search_path = public as $assistant_set_monthly_cap_0207$
declare
  v_before bigint;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_cap_micros is null or p_cap_micros <= 0 or p_cap_micros > 10000000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
      detail = 'monthly cap must be more than 0 and at most 10000000000 micros (USD 10,000)';
  end if;

  select llm_monthly_cost_cap_micros into v_before from platform_settings where id;
  if v_before is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  update platform_settings set llm_monthly_cost_cap_micros = p_cap_micros, updated_at = now() where id;

  perform app.write_audit('settings.llm_monthly_cap', 'platform_settings', 'singleton',
    jsonb_build_object('monthly_cap_micros', v_before),
    jsonb_build_object('monthly_cap_micros', p_cap_micros));

  return jsonb_build_object('monthly_cap_micros', p_cap_micros, 'previous_cap_micros', v_before);
end $assistant_set_monthly_cap_0207$;

comment on function app.assistant_set_monthly_cap(bigint) is
  '0149, 0207. Owner-only: set the assistant''s monthly spend cap (platform_settings.llm_monthly_cost_cap_micros, USD micros). More than 0, at most USD 10,000. Audited as settings.llm_monthly_cap.';

-- ---------------------------------------------------------------------------
-- 6. The pre-warm nudge (0141 body): the chain's 03:30, not a branch's
-- ---------------------------------------------------------------------------
create or replace function app.assistant_prewarm_nudge()
returns void
language plpgsql security definer set search_path = public as $assistant_prewarm_nudge_0207$
declare
  v_base text;
  v_key  text;
  v_tz   text;
begin
  begin
    select timezone into v_tz from platform_settings where id;
    -- 03:30 chain time: cron.timezone is GMT, so the row fires every hour at
    -- :30 and only the chain's own 3 o'clock posts.
    if extract(hour from (now() at time zone coalesce(v_tz, 'Asia/Baghdad'))) <> 3 then
      return;
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
      url                  := rtrim(v_base, '/') || '/assistant-component',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"prewarm":true}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'assistant_prewarm_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $assistant_prewarm_nudge_0207$;
