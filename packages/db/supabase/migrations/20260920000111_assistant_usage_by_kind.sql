-- ===========================================================================
-- 0111 — owner assistant: usage by token kind, prices in the database, the meter.
--
-- docs/design/assistant/owner-assistant-plan-2026-09-20.md §2.6, §5.6, §7.5
-- and build-contracts-2026-09-20.md "Lane A · 0111" (Decision 1: prices live
-- in venue_settings.llm_pricing).
--
-- WHY BY KIND. 0079 priced every token at one blended rate because the insights
-- function ran on Groq with no cache. The assistant runs on Claude with prompt
-- caching, where a cache read costs a tenth of a fresh input token and a cache
-- write a quarter more: a blended rate would misprice the monthly cap by a
-- factor the cap exists to prevent. So llm_usage counts four kinds, the price
-- per kind per model lives in venue_settings.llm_pricing (USD micros per
-- million tokens), and one function does the arithmetic for the recorder, the
-- meter and the UI's price calculator alike. llm_cost_micros_per_mtok stays as
-- the fallback for a model that is not in the map.
--
-- THE OLD PATH STAYS. app.llm_record_usage(int, bigint, bigint) is untouched;
-- analytics-insights keeps calling it until it migrates. The new overload has
-- distinct parameter names, so PostgREST resolves each call unambiguously.
--
-- Adding NOT NULL columns WITH a default is a catalog-only change in PG11+:
-- no rewrite of llm_usage or venue_settings.
--
-- covered by packages/db/tests/assistant-usage.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Two more kinds on the day counter
-- ---------------------------------------------------------------------------
alter table llm_usage add column if not exists cache_write_tokens bigint not null default 0;
alter table llm_usage add column if not exists cache_read_tokens  bigint not null default 0;

comment on column llm_usage.prompt_tokens is
  '0079/0111. UNCACHED input tokens for the day (the 0079 meaning is unchanged: cache writes and reads are counted separately since 0111).';
comment on column llm_usage.cache_write_tokens is '0111. Input tokens written to the prompt cache for the day.';
comment on column llm_usage.cache_read_tokens  is '0111. Input tokens served from the prompt cache for the day.';

-- ---------------------------------------------------------------------------
-- 2. The price list
-- ---------------------------------------------------------------------------
alter table venue_settings add column if not exists llm_pricing jsonb not null default '{}'::jsonb;

comment on column venue_settings.llm_pricing is
  '0111. Price per model in USD micros per 1,000,000 tokens, four kinds: {"claude-opus-5": {"input": 5000000, "cache_write": 6250000, "cache_read": 500000, "output": 25000000}}. A model absent here is priced at llm_cost_micros_per_mtok for every kind. Must change when the model changes.';

-- Seed the two Claude models so the cap prices correctly from day one. Only
-- keys not already present are added, so a venue that edited its prices
-- keeps them.
update venue_settings
   set llm_pricing = jsonb_build_object(
         'claude-opus-5',   jsonb_build_object('input', 5000000, 'cache_write', 6250000, 'cache_read', 500000,  'output', 25000000),
         'claude-sonnet-5', jsonb_build_object('input', 2000000, 'cache_write', 2500000, 'cache_read', 200000,  'output', 10000000))
       || llm_pricing
 where id is not null;

-- The new columns join the table_read allowlist (0109 seeded before they existed).
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name, c.column_name, 'table', c.data_type <> 'jsonb', c.data_type, c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
 where c.table_schema = 'public'
   and ((c.table_name = 'llm_usage' and c.column_name in ('cache_write_tokens', 'cache_read_tokens'))
     or (c.table_name = 'venue_settings' and c.column_name = 'llm_pricing'))
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. The arithmetic, once (definer-only), and its owner-callable face
-- ---------------------------------------------------------------------------
create or replace function app.llm_price_calc(
  p_model       text,
  p_input       bigint,
  p_cache_write bigint,
  p_cache_read  bigint,
  p_output      bigint
) returns bigint
language plpgsql stable set search_path = public as $llm_price_calc_0111$
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
    from venue_settings limit 1;

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
end $llm_price_calc_0111$;

comment on function app.llm_price_calc(text, bigint, bigint, bigint, bigint) is
  '0111. Definer-only arithmetic: USD micros for four token counts at venue_settings.llm_pricing -> p_model, or the blended llm_cost_micros_per_mtok when the model is absent. Shared by llm_record_usage, llm_price_micros and assistant_usage.';

revoke all on function app.llm_price_calc(text, bigint, bigint, bigint, bigint) from public, anon, authenticated;

create or replace function app.llm_price_micros(
  p_model       text,
  p_input       bigint,
  p_cache_write bigint,
  p_cache_read  bigint,
  p_output      bigint
) returns bigint
language plpgsql stable security definer set search_path = public as $llm_price_micros_0111$
begin
  -- The owner (the UI's calculator) or the service role (the edge functions
  -- pricing each model call — the job tick and the pre-warm carry no owner JWT).
  if not (app.is_staff('owner') or auth.role() = 'service_role') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.llm_price_calc(p_model, p_input, p_cache_write, p_cache_read, p_output);
end $llm_price_micros_0111$;

comment on function app.llm_price_micros(text, bigint, bigint, bigint, bigint) is
  '0111. Owner-only. The price in USD micros of four token counts on one model, from the database''s own price list, so the UI''s calculator never duplicates a rate.';

revoke all on function app.llm_price_micros(text, bigint, bigint, bigint, bigint) from public, anon;
grant execute on function app.llm_price_micros(text, bigint, bigint, bigint, bigint) to authenticated;
grant execute on function app.llm_price_micros(text, bigint, bigint, bigint, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 4. app.llm_record_usage — the by-kind overload (service role only)
-- ---------------------------------------------------------------------------
create or replace function app.llm_record_usage(
  p_model       text,
  p_input       bigint,
  p_cache_write bigint,
  p_cache_read  bigint,
  p_output      bigint,
  p_model_calls int,
  p_surface     text default 'assistant'
) returns bigint
language plpgsql security definer set search_path = public as $llm_record_usage_0111$
declare
  v_today date;
  v_cost  bigint;
begin
  select (now() at time zone timezone)::date into v_today from venue_settings limit 1;
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
end $llm_record_usage_0111$;

comment on function app.llm_record_usage(text, bigint, bigint, bigint, bigint, int, text) is
  '0111. Service role only. Records one request''s tokens by kind on today''s llm_usage row, priced from llm_pricing -> p_model (fallback: llm_cost_micros_per_mtok), and returns the cost in micros it recorded. p_surface names the caller (assistant, insights) and is reserved for a per-surface breakdown; it is not stored yet. The 0079 three-argument overload stays for analytics-insights.';

revoke all on function app.llm_record_usage(text, bigint, bigint, bigint, bigint, int, text) from public, anon, authenticated;
grant execute on function app.llm_record_usage(text, bigint, bigint, bigint, bigint, int, text) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.assistant_usage — the meter (owner-only, read-only)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_usage(p_from date default null, p_to date default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_usage_0111$
declare
  v_today date;
  v_from  date;
  v_to    date;
  v_vs    venue_settings%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_vs from venue_settings limit 1;
  v_today := (now() at time zone v_vs.timezone)::date;
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
      'daily_limit',       v_vs.llm_daily_request_limit,
      'monthly_cap_micros', v_vs.llm_monthly_cost_cap_micros,
      'month_cost_micros', coalesce((select sum(cost_micros) from llm_usage
                                      where usage_date >= date_trunc('month', v_today)::date
                                        and usage_date <= v_today), 0)),
    'pricing',                  v_vs.llm_pricing,
    'fallback_micros_per_mtok', v_vs.llm_cost_micros_per_mtok);
end $assistant_usage_0111$;

comment on function app.assistant_usage(date, date) is
  '0111. Owner-only, read-only. The meter: per-day rows for [p_from, p_to] (default: the current month to date), the month-to-date sums, the standing cap, the price map and the fallback rate — everything the usage page and the assistant''s own `usage` tool show.';

revoke all on function app.assistant_usage(date, date) from public, anon;
grant execute on function app.assistant_usage(date, date) to authenticated;
