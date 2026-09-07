-- 0079_llm_spend_cap — SEC-29. A per-day call quota and a hard monthly spend
-- cap on the LLM insights function.
--
-- WHAT IS AND IS NOT AT RISK HERE. The §07 box said "every cafe guest holds an
-- `authenticated` JWT, so an uncapped model endpoint is an uncapped bill".
-- Checked: that is NOT the exposure. `analytics-insights` calls
-- `requireStaffRole(req, service, ['owner'])` on its first line, so a guest
-- cannot reach the model at all. Access control already holds; the box says so
-- itself two sentences later.
--
-- The real exposure is narrower and still real: ONE `insights` request fans out
-- to FIVE directed scan angles plus a revalidate pass, so a single button press
-- is six model calls. An owner leaning on the refresh button, a client retry
-- loop, or a stolen owner session turns that into a bill with no ceiling and no
-- signal until the invoice arrives. Groq bills per token; nothing in this
-- repository counted a single one before this migration.
--
-- WHY IT LIVES IN THE DATABASE. `analytics-insights` is deliberately STATELESS
-- (its own header says so) and a quota is, unavoidably, state. It cannot live in
-- the function's memory — edge instances are per-request — and it must not live
-- in the client, because a cap the caller enforces is not a cap. So the counter
-- lives here and the function calls into it with the service role.
--
-- ⚠ THE PRICE IS AN ESTIMATE AND MUST BE CHECKED.
-- `llm_cost_micros_per_mtok` defaults to 500000 micros — USD 0.50 per million
-- tokens — as a deliberately blended, conservative stand-in for the two models
-- in use (`openai/gpt-oss-120b` and `llama-3.1-8b-instant`). It is a SETTING,
-- not a constant, precisely because nobody in this repository can verify Groq's
-- current price list. Set it from the real one before the cap means money.
-- Until then the DAY QUOTA is the control that actually bites, because it counts
-- requests rather than dollars and needs no price to be correct.
--
-- covered by packages/db/tests/llm-spend-cap.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The limits, beside every other operational limit (venue_settings).
-- ---------------------------------------------------------------------------
-- Adding NOT NULL columns WITH a default is a catalog-only change in PG11+;
-- no table rewrite, no scan.
alter table venue_settings
  add column if not exists llm_daily_request_limit int not null default 200;
alter table venue_settings
  add column if not exists llm_monthly_cost_cap_micros bigint not null default 20000000;
alter table venue_settings
  add column if not exists llm_cost_micros_per_mtok bigint not null default 500000;

comment on column venue_settings.llm_daily_request_limit is
  '0079/SEC-29. Insight REQUESTS per calendar day (one request fans out to ~6 model calls). The control that bites without needing a price to be right. 0 disables the LLM path entirely.';
comment on column venue_settings.llm_monthly_cost_cap_micros is
  '0079/SEC-29. Hard month-to-date ceiling in USD micros (20000000 = USD 20). Enforced against llm_cost_micros_per_mtok, which is an ESTIMATE until somebody sets it from Groq''s real price list.';
comment on column venue_settings.llm_cost_micros_per_mtok is
  '0079/SEC-29. USD micros per 1,000,000 tokens, prompt and completion blended. A SETTING, not a constant: nobody in this repo can verify Groq''s price list, so the default is a conservative stand-in.';

-- ---------------------------------------------------------------------------
-- 2. The counter. One row per calendar day.
-- ---------------------------------------------------------------------------
create table if not exists llm_usage (
  usage_date        date primary key,
  requests          int    not null default 0,
  model_calls       int    not null default 0,
  prompt_tokens     bigint not null default 0,
  completion_tokens bigint not null default 0,
  cost_micros       bigint not null default 0,
  updated_at        timestamptz not null default now()
);

comment on table llm_usage is
  '0079/SEC-29. Per-day LLM consumption. Written only by app.llm_begin_request / app.llm_record_usage under the service role; the operator reads it through app.llm_usage_summary.';

alter table llm_usage enable row level security;
grant select on llm_usage to authenticated;

-- Owner reads it (it is spend, which is the owner's business); nobody writes it
-- from a client — the two definer functions below are the only write path.
create policy llm_usage_select_owner on llm_usage for select to authenticated
  using (app.is_staff('owner'));

-- ---------------------------------------------------------------------------
-- 3. app.llm_begin_request — the gate, called BEFORE any model call.
-- ---------------------------------------------------------------------------
create or replace function app.llm_begin_request()
returns jsonb
language plpgsql security definer set search_path = public as $llm_begin_request_0079$
declare
  v_today        date;
  v_day_limit    int;
  v_cap_micros   bigint;
  v_requests     int;
  v_month_micros bigint;
begin
  -- The venue's own day, not UTC: a cap that rolls over at 03:00 local is a cap
  -- the venue does not recognise.
  select (now() at time zone timezone)::date,
         llm_daily_request_limit,
         llm_monthly_cost_cap_micros
    into v_today, v_day_limit, v_cap_micros
    from venue_settings
   limit 1;

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
      hint = 'raise venue_settings.llm_monthly_cost_cap_micros, or wait for the month to roll';
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
      hint = 'raise venue_settings.llm_daily_request_limit, or try tomorrow';
  end if;

  return jsonb_build_object(
    'usage_date',            v_today,
    'requests_today',        v_requests,
    'daily_limit',           v_day_limit,
    'month_cost_micros',     v_month_micros,
    'monthly_cap_micros',    v_cap_micros);
end $llm_begin_request_0079$;

comment on function app.llm_begin_request() is
  '0079/SEC-29. Call once per insights request, BEFORE any model call. Raises LLM_DAILY_QUOTA or LLM_MONTHLY_CAP; otherwise reserves the slot and returns the standing budget. Service role only — the caller is analytics-insights, which has already checked the owner role.';

revoke all on function app.llm_begin_request() from public, anon, authenticated;
grant execute on function app.llm_begin_request() to service_role;

-- ---------------------------------------------------------------------------
-- 4. app.llm_record_usage — the actuals, called AFTER the model answers.
-- ---------------------------------------------------------------------------
create or replace function app.llm_record_usage(
  p_model_calls       int,
  p_prompt_tokens     bigint,
  p_completion_tokens bigint
) returns void
language plpgsql security definer set search_path = public as $llm_record_usage_0079$
declare
  v_today date;
  v_rate  bigint;
begin
  select (now() at time zone timezone)::date, llm_cost_micros_per_mtok
    into v_today, v_rate
    from venue_settings
   limit 1;

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
end $llm_record_usage_0079$;

comment on function app.llm_record_usage(int, bigint, bigint) is
  '0079/SEC-29. Records what a request actually consumed, so the NEXT one is measured against a real month-to-date figure. Never raises on the numbers — a failure to record must not fail a request the owner has already paid for.';

revoke all on function app.llm_record_usage(int, bigint, bigint) from public, anon, authenticated;
grant execute on function app.llm_record_usage(int, bigint, bigint) to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.llm_usage_summary — so the owner can see the bill building.
-- ---------------------------------------------------------------------------
create or replace function app.llm_usage_summary()
returns jsonb
language plpgsql stable security definer set search_path = public as $llm_usage_summary_0079$
declare
  v_today date;
  v_out   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select (now() at time zone timezone)::date into v_today from venue_settings limit 1;

  select jsonb_build_object(
           'usage_date',         v_today,
           'requests_today',     coalesce((select requests from llm_usage where usage_date = v_today), 0),
           'daily_limit',        (select llm_daily_request_limit from venue_settings limit 1),
           'month_cost_micros',  coalesce((select sum(cost_micros) from llm_usage
                                            where usage_date >= date_trunc('month', v_today)::date
                                              and usage_date <= v_today), 0),
           'monthly_cap_micros', (select llm_monthly_cost_cap_micros from venue_settings limit 1),
           'cost_micros_per_mtok', (select llm_cost_micros_per_mtok from venue_settings limit 1))
    into v_out;
  return v_out;
end $llm_usage_summary_0079$;

comment on function app.llm_usage_summary() is
  '0079/SEC-29. Owner-only read of the standing LLM budget: requests today against the day limit, month-to-date spend against the cap, and the price estimate the spend figure depends on.';

revoke all on function app.llm_usage_summary() from public, anon;
grant execute on function app.llm_usage_summary() to authenticated;
