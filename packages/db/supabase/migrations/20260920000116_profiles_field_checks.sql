-- ===========================================================================
-- 0116 — profiles: bounded, well-formed guest-writable fields (S7).
--
-- THE GAP. `grant update (full_name, phone, preferred_lang, expo_push_token)
-- on profiles to authenticated` (0004:161) lets every signed-in guest write
-- three free-text columns with no length or shape rule at all. 0080 strips
-- control and bidi characters and collapses whitespace, and 0059 requires a
-- phone before a booking is confirmed — but a multi-megabyte name still
-- renders in desk search, in Telegram and in a push title; the phone guard is
-- satisfied by the letter "x"; and expo_push_token accepts any string, which
-- the send-push function then hands to Expo as a device token.
--
-- THE RULE. Three CHECK constraints, added NOT VALID so the ADD never blocks on
-- existing rows, then VALIDATEd in the same file after a bounded fix-up:
--   full_name         at most 80 characters (0080 already trims; a minimum is
--                     the app's job — an empty name is a UX defect, not an
--                     abuse vector, and refusing it here would reject the
--                     social sign-in bootstrap that writes a blank name).
--   phone             NULL, or 7 to 15 digits once app.phone_digits() has
--                     folded Arabic-Indic digits and dropped everything else
--                     (coalesced to '' first: phone_digits returns NULL for a
--                     digitless string, and NULL ~ pattern is NULL, which a
--                     CHECK would wave through) —
--                     the same rule the desk applies before it creates an
--                     account (functions/desk-customer-create/phone.ts).
--   expo_push_token   NULL, or an Expo token: Expo[nent]PushToken[<id>].
--
-- WHY THE GRANT. A CHECK expression runs as the ROLE executing the write, so a
-- guest's UPDATE evaluates app.phone_digits() as `authenticated`. 0065 revoked
-- it along with everything else in the schema by default posture; it is a pure
-- text function with no data access, so granting EXECUTE is safe and is the
-- only way the constraint can hold for the writers it exists to bound.
--
-- FIX-UP BEFORE VALIDATE. Rows that would fail are repaired, not left to break
-- the push: a name longer than 80 is cut to 80 (0080's own header calls a
-- longer one abuse); a phone with fewer than 7 or more than 15 digits is set
-- NULL (it never reached anyone — 0059 then asks the guest for a real one at
-- their next booking); a malformed push token is set NULL (Expo refuses it
-- anyway; the app re-registers on next launch). Each repair is audited.
--
-- PRE-FLIGHT on hosted, so the numbers are known before the push:
--   select count(*) from profiles where char_length(full_name) > 80;
--   select count(*) from profiles where phone is not null
--                                  and coalesce(app.phone_digits(phone), '') !~ '^[0-9]{7,15}$';
--   select count(*) from profiles where expo_push_token is not null
--                                  and expo_push_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,64}\]$';
--
-- Clients: the mobile profile screen already caps the name field and stores
-- the phone as E.164; a refusal here surfaces as the generic error, which is
-- the honest answer to a client that bypassed the app.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

grant execute on function app.phone_digits(text) to anon, authenticated;

comment on function app.phone_digits(text) is
  '0065/0116. Arabic-Indic digits folded to ASCII, every non-digit dropped. Pure text, no data access. Granted to anon/authenticated since 0116 because the profiles_phone_format CHECK evaluates it as the writing role.';

-- ---------------------------------------------------------------------------
-- Fix-up, audited, bounded by WHERE.
-- ---------------------------------------------------------------------------
do $fixup_0116$
declare
  r record;
begin
  for r in select id, full_name from profiles where char_length(full_name) > 80 loop
    update profiles set full_name = left(full_name, 80) where id = r.id;
    perform app.write_audit('profile.fixup_0116', 'profiles', r.id::text,
                            jsonb_build_object('full_name_length', char_length(r.full_name)),
                            jsonb_build_object('full_name_length', 80), 'name_truncated', null, null);
  end loop;

  for r in select id, phone from profiles
            where phone is not null and coalesce(app.phone_digits(phone), '') !~ '^[0-9]{7,15}$' loop
    update profiles set phone = null where id = r.id;
    perform app.write_audit('profile.fixup_0116', 'profiles', r.id::text,
                            jsonb_build_object('phone_digits', char_length(app.phone_digits(r.phone))),
                            jsonb_build_object('phone', null), 'phone_unusable', null, null);
  end loop;

  for r in select id from profiles
            where expo_push_token is not null
              and expo_push_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,64}\]$' loop
    update profiles set expo_push_token = null where id = r.id;
    perform app.write_audit('profile.fixup_0116', 'profiles', r.id::text,
                            jsonb_build_object('expo_push_token', 'malformed'),
                            jsonb_build_object('expo_push_token', null), 'push_token_malformed', null, null);
  end loop;
end $fixup_0116$;

-- ---------------------------------------------------------------------------
-- The constraints: NOT VALID, then VALIDATE (idempotent guard, 0092 pattern).
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profiles_full_name_len') then
    alter table profiles
      add constraint profiles_full_name_len
      check (char_length(full_name) <= 80) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_phone_format') then
    alter table profiles
      add constraint profiles_phone_format
      check (phone is null or coalesce(app.phone_digits(phone), '') ~ '^[0-9]{7,15}$') not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profiles_push_token_format') then
    alter table profiles
      add constraint profiles_push_token_format
      check (expo_push_token is null
             or expo_push_token ~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]{1,64}\]$') not valid;
  end if;
end $$;

alter table profiles validate constraint profiles_full_name_len;
alter table profiles validate constraint profiles_phone_format;
alter table profiles validate constraint profiles_push_token_format;

comment on constraint profiles_full_name_len on profiles is
  '0116/S7. Guest-writable; 0080 trims and strips controls, this bounds the length.';
comment on constraint profiles_phone_format on profiles is
  '0116/S7. 7-15 digits after app.phone_digits(); the desk applies the same rule before creating an account.';
comment on constraint profiles_push_token_format on profiles is
  '0116/S7. An Expo push token or NULL; anything else would be handed to Expo by send-push.';
