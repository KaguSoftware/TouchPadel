-- 0069 — phone OTP base (DORMANT): send log, limits + kill switch, the two
-- service-role gates the Send-SMS hook calls, and the signup trigger learning
-- to read a phone-only user.
--
-- VENDOR ADDITION SCAFFOLD (2026-09-05). SOW L259-260 excludes "Phone / SMS
-- one-time-code login"; the owner asked for the base to exist so activation is
-- configuration, not code (design note docs/design/phone-otp-2026-09-05.md,
-- runbook docs/client/phone-otp-activation.md). Nothing here changes behaviour
-- for a single existing user: no client role can call anything in this file,
-- `app.sms_limits.enabled` ships FALSE, and the trigger change only fires for
-- an auth.users row that carries a phone and no metadata phone — a shape no
-- current sign-up path produces.
--
-- WHY A DATABASE GATE AND NOT JUST GOTRUE'S RATE LIMITS. Every OTP is a paid
-- message (80–250 IQD per SMS on the Iraqi carriers), and "SMS pumping" —
-- bots requesting codes to premium ranges — is the standard attack. GoTrue
-- caps sends per hour project-wide and sign-ins per IP; it cannot say "only
-- Iraqi mobiles", "five a day per number", "stop everything now". This file
-- can, and the hook (functions/send-sms-otp) asks it before every send:
--   app.sms_send_gate(p_phone_e164, p_user_id) -> jsonb
--     {allowed:true,  send_id}
--     {allowed:false, reason} with reason in
--       SMS_DISABLED       kill switch (enabled = false) — the default
--       PHONE_NOT_ALLOWED  country code not in allowed_prefixes ('{964}')
--       PHONE_RATE         per_phone_per_day reached for this canonical number
--       DAILY_CAP          daily_total reached across the project
--     A refusal is ALSO logged (status 'refused') so a pumping attempt is
--     visible in the same table as the spend.
--   app.sms_send_result(p_send_id, p_status, p_provider, p_provider_msg_id,
--                       p_error, p_cost_iqd)
--     Stamps the provider outcome on the queued row: sent | failed.
-- Both are SECURITY DEFINER with NO client grant (service role only), the
-- 0065 find_customer_by_phone pattern. check-rpc-authz.mjs sees neither.
--
-- WHY per_ip lives elsewhere: the hook receives GoTrue's request, not the
-- phone's; the client IP is not in the payload. IP throttling is GoTrue's
-- ([auth.rate_limit] sign_in_sign_ups per IP per 5 min) and stays there.
--
-- TRIGGER. app.handle_new_user (0004, body replaced by 0058) read the phone
-- from raw_user_meta_data only. A phone sign-up has no metadata at all and
-- carries the number in auth.users.phone (digits, no '+'); without this the
-- profile row would have phone NULL and confirm_booking would refuse the very
-- guest who just proved they own a phone (0059 PHONE_REQUIRED). Now: metadata
-- phone first (unchanged), else '+' || new.phone. Name falls back to '' for a
-- phone-only user (no email local part exists) — the app's complete-profile
-- step collects it, exactly as for an Apple relay sign-in.
--
-- Safety: new tables + functions; one pure function-body replacement (same
-- name, signature, definer, search_path — the 0004:56 trigger binding and the
-- 0004:150 revoke survive untouched). No table rewrite, no backfill, no lock
-- beyond DDL on the new objects.
--
-- Not in types.gen.ts until the next `db:types` run; no client code reads
-- these types (the hook uses an untyped service client).
--
-- Rollback: drop function app.sms_send_result, app.sms_send_gate; drop table
-- app.sms_sends, app.sms_limits; re-run the 0058 handle_new_user body.

-- ---------------------------------------------------------------------------
-- 1. Limits — one row, the kill switch and the caps. Edited by SQL only
--    (runbook step); an owner-facing screen is a later addition if wanted.
-- ---------------------------------------------------------------------------
create table app.sms_limits (
  id                 boolean primary key default true check (id),  -- single row
  enabled            boolean not null default false,
  per_phone_per_day  int     not null default 5  check (per_phone_per_day between 1 and 100),
  daily_total        int     not null default 500 check (daily_total between 1 and 100000),
  allowed_prefixes   text[]  not null default '{964}',
  updated_at         timestamptz not null default now()
);

insert into app.sms_limits default values;

revoke all on app.sms_limits from public, anon, authenticated;
-- The runbook's `update app.sms_limits set enabled = true` runs in the SQL
-- editor; the test suite flips it through the service client, hence the grant.
grant select, update on app.sms_limits to service_role;

-- ---------------------------------------------------------------------------
-- 2. Send log — one row per hook call, refused or not. phone_canon is the
--    0065 identity form so a number typed three ways counts as one; the E.164
--    form is kept for the provider invoice reconciliation.
-- ---------------------------------------------------------------------------
create table app.sms_sends (
  id               bigint generated always as identity primary key,
  phone_e164       text not null,
  phone_canon      text not null,
  user_id          uuid,                                   -- auth.users.id when GoTrue sent one; no FK (the user may be deleted later)
  purpose          text not null default 'sms'
                   check (purpose in ('sms','phone_change','reauthentication')),
  channel          text not null default 'sms' check (channel in ('sms','whatsapp','telegram','log')),
  provider         text,
  provider_msg_id  text,
  status           text not null default 'queued'
                   check (status in ('queued','sent','failed','refused')),
  reason           text,                                   -- refusal reason or provider error
  cost_iqd         int,
  created_at       timestamptz not null default now()
);

create index sms_sends_phone_at on app.sms_sends (phone_canon, created_at desc);
create index sms_sends_at       on app.sms_sends (created_at desc);

revoke all on app.sms_sends from public, anon, authenticated;
-- Reads for the activation-day watch and the invoice reconciliation; delete so
-- the test suite can remove its own rows. Writes go through the two RPCs.
grant select, delete on app.sms_sends to service_role;

-- ---------------------------------------------------------------------------
-- 3. The gate. Counting window for the per-phone cap is a rolling 24 h; the
--    project cap is a rolling 24 h too (a "day" boundary in Asia/Baghdad would
--    let a burst straddle midnight for double the cap).
-- ---------------------------------------------------------------------------
create or replace function app.sms_send_gate(
  p_phone_e164 text,
  p_user_id    uuid default null,
  p_purpose    text default 'sms'
) returns jsonb
language plpgsql security definer set search_path = public as $sms_send_gate_0069$
declare
  v_limits  app.sms_limits%rowtype;
  v_digits  text := app.phone_digits(p_phone_e164);
  v_canon   text := app.phone_canon(p_phone_e164);
  v_e164    text;
  v_purpose text := case when p_purpose in ('sms','phone_change','reauthentication') then p_purpose else 'sms' end;
  v_reason  text;
  v_id      bigint;
begin
  if v_digits is null or v_canon is null then
    raise exception 'INVALID_PHONE' using errcode = 'P0001';
  end if;
  v_e164 := '+' || v_digits;

  -- Serialise on the single limits row: two hook calls for the same number
  -- must not both read "4 of 5" and both send.
  select * into v_limits from app.sms_limits where id for update;

  if not v_limits.enabled then
    v_reason := 'SMS_DISABLED';
  elsif not exists (select 1 from unnest(v_limits.allowed_prefixes) p where v_digits like p || '%') then
    v_reason := 'PHONE_NOT_ALLOWED';
  elsif (select count(*) from app.sms_sends s
          where s.phone_canon = v_canon
            and s.status in ('queued','sent')
            and s.created_at > now() - interval '24 hours') >= v_limits.per_phone_per_day then
    v_reason := 'PHONE_RATE';
  elsif (select count(*) from app.sms_sends s
          where s.status in ('queued','sent')
            and s.created_at > now() - interval '24 hours') >= v_limits.daily_total then
    v_reason := 'DAILY_CAP';
  end if;

  insert into app.sms_sends (phone_e164, phone_canon, user_id, purpose, status, reason)
  values (v_e164, v_canon, p_user_id, v_purpose,
          case when v_reason is null then 'queued' else 'refused' end, v_reason)
  returning id into v_id;

  if v_reason is not null then
    return jsonb_build_object('allowed', false, 'reason', v_reason, 'send_id', v_id);
  end if;
  return jsonb_build_object('allowed', true, 'send_id', v_id);
end $sms_send_gate_0069$;

revoke all on function app.sms_send_gate(text, uuid, text) from public, anon, authenticated;
-- Functions do not inherit the 0012 blanket table grants (0051's lesson).
grant execute on function app.sms_send_gate(text, uuid, text) to service_role;

create or replace function app.sms_send_result(
  p_send_id         bigint,
  p_status          text,
  p_provider        text default null,
  p_channel         text default null,
  p_provider_msg_id text default null,
  p_error           text default null,
  p_cost_iqd        int  default null
) returns void
language plpgsql security definer set search_path = public as $sms_send_result_0069$
begin
  if p_status not in ('sent','failed') then
    raise exception 'INVALID_STATUS' using errcode = 'P0001', hint = 'sent | failed';
  end if;
  update app.sms_sends
     set status          = p_status,
         provider        = coalesce(p_provider, provider),
         channel         = case when p_channel in ('sms','whatsapp','telegram','log') then p_channel else channel end,
         provider_msg_id = coalesce(p_provider_msg_id, provider_msg_id),
         reason          = coalesce(p_error, reason),
         cost_iqd        = coalesce(p_cost_iqd, cost_iqd)
   where id = p_send_id
     and status = 'queued';
  if not found then
    raise exception 'SEND_NOT_FOUND' using errcode = 'P0001';
  end if;
end $sms_send_result_0069$;

revoke all on function app.sms_send_result(bigint, text, text, text, text, text, int)
  from public, anon, authenticated;
grant execute on function app.sms_send_result(bigint, text, text, text, text, text, int) to service_role;

-- ---------------------------------------------------------------------------
-- 4. Signup trigger: a phone-only user gets its phone on the profile.
--    Body replacement only (see header). The 0058 name cascade is unchanged.
-- ---------------------------------------------------------------------------
create or replace function app.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_meta  jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  v_email text  := coalesce(new.email, '');
  v_name  text;
  v_phone text;
begin
  if coalesce(new.is_anonymous, false) then
    return new;                                -- cafe anonymous sessions: no profile
  end if;

  v_name := coalesce(
    nullif(btrim(v_meta->>'full_name'), ''),                                          -- email/password sign-up; Google
    nullif(btrim(v_meta->>'name'), ''),                                               -- Google `name` claim
    nullif(btrim(concat_ws(' ', v_meta->>'given_name', v_meta->>'family_name')), ''), -- standard OIDC, belt and braces
    case when v_email ilike '%@privaterelay.appleid.com' then null                     -- a relay token is not a name; the app's complete-profile step fills it
         else nullif(split_part(v_email, '@', 1), '') end,                              -- historical fallback kept: admin-created staff users (staff-admin edge fn passes no metadata) rely on it
    '');

  -- 0069: a phone sign-up (GoTrue signInWithOtp) has no metadata; the verified
  -- number sits in auth.users.phone as digits without '+'. Metadata still wins
  -- when present (the email/password form sends it).
  v_phone := coalesce(
    nullif(btrim(v_meta->>'phone'), ''),
    case when nullif(btrim(coalesce(new.phone, '')), '') is not null
         then '+' || app.phone_digits(new.phone) end);

  insert into public.profiles (id, full_name, phone, preferred_lang)
  values (
    new.id,
    v_name,
    v_phone,
    case when v_meta->>'preferred_lang' in ('en','ar')
         then v_meta->>'preferred_lang' else 'en' end
  )
  on conflict (id) do nothing;
  return new;
end $$;
-- Grants + trigger binding unchanged (0004:56, 0004:150): replace preserves them.
