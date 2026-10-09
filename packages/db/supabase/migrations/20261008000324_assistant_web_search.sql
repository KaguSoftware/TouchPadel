set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0324 — The owner assistant searches the web (owner call 2026-10-08).
--
-- assistant-chat now offers Anthropic's server-side web search
-- (`web_search_20260209`, at most five a request) for ideas and outside
-- context. A search is billed apart from tokens, so the spend cap has to see
-- it: one price column, a count beside the token counts, and a recorder the
-- edge function calls once per answer. Searches are added into
-- `llm_usage.cost_micros`, the figure `llm_begin_request` holds against the
-- monthly cap and `assistant_usage` reports, so the cap needs no change.
--
-- `llm_record_usage` keeps its 0207 body and the new recorder is a separate
-- service-role function; `assistant_usage` (0207) is re-issued so the usage
-- page shows searches beside the token kinds.

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.platform_settings
  add column if not exists llm_web_search_micros bigint not null default 10000;

comment on column public.platform_settings.llm_web_search_micros is
  '0324. USD micros one assistant web search costs (Anthropic: $10 per 1,000 searches = 10000). Read by app.llm_record_web_search for the spend cap and by assistant-chat for the per-call meter.';

alter table public.llm_usage
  add column if not exists web_searches int not null default 0;

comment on column public.llm_usage.web_searches is
  '0324. Assistant web searches run that day; their price is already inside cost_micros.';

alter table public.assistant_calls
  add column if not exists web_searches int not null default 0;

comment on column public.assistant_calls.web_searches is
  '0324. Web searches the server ran during this model call; their price is inside cost_micros.';

-- The new columns join the table_read allowlist (the 0111 statement, limited to them).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'table', c.data_type <> 'jsonb', c.data_type, c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and ((c.table_name = 'platform_settings' and c.column_name = 'llm_web_search_micros')
     or (c.table_name = 'llm_usage'         and c.column_name = 'web_searches')
     or (c.table_name = 'assistant_calls'   and c.column_name = 'web_searches'))
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 2. app.llm_record_web_search — the searches of one answer onto today's row
-- ---------------------------------------------------------------------------
create or replace function app.llm_record_web_search(p_searches int)
returns bigint
language plpgsql security definer set search_path = public as $llm_record_web_search_0324$
declare
  v_today date;
  v_price bigint;
  v_n     int := greatest(coalesce(p_searches, 0), 0);
  v_cost  bigint;
begin
  select (now() at time zone timezone)::date, greatest(coalesce(llm_web_search_micros, 0), 0)
    into v_today, v_price
    from platform_settings
   where id;

  if v_today is null then
    raise exception 'VENUE_SETTINGS_MISSING' using errcode = 'P0001';
  end if;

  if v_n = 0 then
    return 0;
  end if;

  v_cost := v_n::bigint * v_price;

  insert into llm_usage (usage_date, web_searches, cost_micros)
  values (v_today, v_n, v_cost)
      on conflict (usage_date) do update set
        web_searches = llm_usage.web_searches + excluded.web_searches,
        cost_micros  = llm_usage.cost_micros  + excluded.cost_micros,
        updated_at   = now();

  return v_cost;
end $llm_record_web_search_0324$;

comment on function app.llm_record_web_search(int) is
  '0324. Service role only. Adds one answer''s web searches to today''s llm_usage row, priced at platform_settings.llm_web_search_micros, into cost_micros so the monthly cap counts them; returns the micros recorded. Never raises on the count.';

revoke all on function app.llm_record_web_search(int) from public, anon, authenticated;
grant execute on function app.llm_record_web_search(int) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_usage — re-issued from 20260926000207_platform_settings.sql
--    with web_searches per day and for the month, and the per-search price
-- ---------------------------------------------------------------------------
create or replace function app.assistant_usage(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_usage_0324$
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
               'web_searches',       u.web_searches,
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
               'web_searches',       coalesce(sum(u.web_searches), 0),
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
    'fallback_micros_per_mtok', v_ps.llm_cost_micros_per_mtok,
    'web_search_micros',        v_ps.llm_web_search_micros);
end $assistant_usage_0324$;

comment on function app.assistant_usage(date, date) is
  '0111, 0207, 0324. Owner-only, read-only. The meter: per-day rows for [p_from, p_to] (default: the current month to date) with web searches beside the token kinds, the month-to-date sums, the standing cap, the price map, the fallback rate and the per-search price (platform_settings) — everything the usage page and the assistant''s own `usage` tool show.';

revoke all on function app.assistant_usage(date, date) from public, anon;
grant execute on function app.assistant_usage(date, date) to authenticated;
