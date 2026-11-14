-- 0414 phone_sign_up_status — "this number already has an account" on the
-- phone's Create account screen, before a code is paid for (Majed,
-- 2026-11-13).
--
-- Until now the screen's first step called GoTrue's signInWithOtp with
-- shouldCreateUser true. For a number that already owned a whole account
-- GoTrue answered exactly as for a new one: it sent a code, and the code
-- signed the guest into the old account with a "Welcome back". The screen
-- could not say the number was taken, because nothing told it.
--
-- WHAT. app.phone_sign_up_status(p_phone) answers, before any code:
--   'taken'   an account owns this number and its profile is whole (a phone,
--             a name and a gender: the same three things the phone's
--             needsProfileCompletion asks for, apps/mobile/src/features/auth/
--             social.ts). The screen stops and offers Sign in.
--   'free'    nobody, or only a sign-up that was never finished. The screen
--             goes on as before (the code finishes that sign-up).
--   'unknown' the number is unreadable, or this caller asked too often. The
--             screen goes on as before; GoTrue still decides.
--
-- WHY ANON. The guest has no session yet. The answer tells a caller whether a
-- number has an account, which the Sign in and Forgot password screens
-- already tell anyone ("No account uses this number", GoTrue's "Signups not
-- allowed for otp"). What GoTrue has and this needs too is a per-caller
-- throttle, so a script cannot walk the number space through it:
--
-- THROTTLE. 20 lookups per caller per 10 minutes, the caller being a hash of
-- cf-connecting-ip from request.headers: Cloudflare, in front of the hosted
-- API, overwrites that header with the real client address, so a script
-- cannot change it. x-forwarded-for and x-real-ip are NOT used: a caller can
-- write anything in them and dodge the throttle. A request without the header
-- (the local stack, or if the platform ever stops passing it) shares one
-- bucket of 300. Past the cap the answer is 'unknown',
-- never an error, so a busy caller just gets the old flow. Rows older than an
-- hour are dropped on the way in. Only the hash is stored, never the address
-- or the number. No index: the table never holds more than an hour of rows
-- (the gate refuses a non-concurrent index, as at 0410).

set lock_timeout = '3s';
set statement_timeout = '60s';

create table if not exists app.phone_sign_up_lookups (
  id         bigint generated always as identity primary key,
  caller     text        not null,
  created_at timestamptz not null default now()
);

comment on table app.phone_sign_up_lookups is
  '0414: one row per app.phone_sign_up_status call, for its per-caller throttle. caller = md5 of cf-connecting-ip (or ''none''); no number, no address, no user. Rows live one hour.';

alter table app.phone_sign_up_lookups enable row level security;
revoke all on table app.phone_sign_up_lookups from public, anon, authenticated;

create or replace function app.phone_sign_up_status(p_phone text)
returns text
language plpgsql volatile security definer
set search_path = app, public, pg_temp
as $phone_sign_up_status_0414$
declare
  v_digits  text := app.phone_digits(p_phone);
  v_headers jsonb;
  v_addr    text;
  v_caller  text;
  v_cap     int;
begin
  -- 00 is the international access prefix, the same as a leading +.
  if v_digits like '00%' then
    v_digits := substr(v_digits, 3);
  end if;
  if v_digits is null or length(v_digits) < 6 or length(v_digits) > 15 then
    return 'unknown';
  end if;

  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_addr := nullif(trim(v_headers ->> 'cf-connecting-ip'), '');
  v_caller := case when v_addr is null then 'none' else md5(v_addr) end;
  v_cap := case when v_addr is null then 300 else 20 end;

  delete from app.phone_sign_up_lookups
   where created_at < now() - interval '1 hour';

  if (select count(*) from app.phone_sign_up_lookups l
       where l.caller = v_caller
         and l.created_at > now() - interval '10 minutes') >= v_cap then
    return 'unknown';
  end if;

  insert into app.phone_sign_up_lookups (caller) values (v_caller);

  if exists (
    select 1
      from auth.users u
      join public.profiles p on p.id = u.id
     where u.phone = v_digits
       and p.deleted_at is null
       and coalesce(trim(p.phone), '') <> ''
       and coalesce(trim(p.full_name), '') <> ''
       and p.gender is not null
  ) then
    return 'taken';
  end if;
  return 'free';
end $phone_sign_up_status_0414$;

comment on function app.phone_sign_up_status(text) is
  '0414: before a sign-up code, whether a whole account owns this number: taken | free | unknown (unreadable or throttled: 20 per caller per 10 min, 300 shared without an address). Anon by design; never raises.';

revoke all on function app.phone_sign_up_status(text) from public;
grant execute on function app.phone_sign_up_status(text) to anon, authenticated;
