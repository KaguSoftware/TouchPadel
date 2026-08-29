-- seed.sql — ENVIRONMENT-INVARIANT reference data only. Applied by `supabase db reset`
-- after migrations, and by the prod baseline at link-time (staff emails/passwords are
-- replaced for real environments — see packages/db/README.md).
--
-- DEV CREDENTIALS (local/staging ONLY — never ship these to Touch's project):
--   password for every staff account:  touch-dev-password
--   owner   owner@dev.touch.local     PIN 111111
--   manager manager@dev.touch.local   PIN 222222
--   cashier cashier@dev.touch.local   (no PIN — cashiers escalate via manager PIN)
--   prep    prep@dev.touch.local
--   desk    desk@dev.touch.local      (court_desk role)
--
-- Staff need auth.users rows. Locally we insert them directly the documented
-- GoTrue-compatible way (bcrypt via crypt(); identities row per user so email
-- sign-in works). On a hosted project, create staff via the Auth admin API and
-- insert the matching `staff` rows instead.

-- ---------------------------------------------------------------------------
-- 1. venue_settings singleton (row created in 0006; pin values here)
-- ---------------------------------------------------------------------------
--
-- HOURS. Touch trades 09:00 -> 02:00 the NEXT morning, seven days a week (client intake pack
-- 2026-08-29, `touch-padel.hours.*`; the record is packages/db/client-data/).
--
-- opening_hours windows are measured from each day's OWN local midnight, and app.assert_bookable
-- fits every per-calendar-day segment of a booking inside a single window of that day. An
-- overnight night is therefore stored as TWO windows on ADJACENT days:
--
--     ["00:00","02:00"]  the tail of the PREVIOUS day's night
--     ["09:00","24:00"]  this day's evening, closing exactly at midnight
--
-- '24:00'::interval is 24 hours, which is precisely what a full-day segment compares against, so
-- SQL needs no special case. The TS side agrees since @touch/core parseHHMM accepts '24:00'.
-- Conversion to and from the way a human says it lives in @touch/core time/openingHours.ts --
-- never hand-roll it.
--
-- CANCELLATION. "When somone books they can maximum cancel before 4 hours of their booked time"
-- (pack `touch-padel.policy.cancelNote`). Down from the 12 h default.
--
-- PHONE. Named approver Mustafa Awad, Owner (pack `touch-padel.filler.contact`). Surfaced to
-- guests through venue_settings_public -- it is the number shown in degraded mode.
-- !! UNVERIFIED: 00995419010203 parses as +995 (Georgia), not +964 (Iraq). Confirm with Mustafa
-- !! before go-live; see docs/client/06-outstanding-2026-08-29.md.
--
-- closed_dates is deliberately left EMPTY. The pack names four closures -- 9 and 10 Muharram,
-- Arbaeen, Wafat al-Rasool -- but gives no Gregorian dates, and they follow the Hijri calendar on
-- local moon sighting. A guessed closure either turns away paying guests or takes a booking the
-- venue cannot honour, so the dates are chased, not computed.
update venue_settings
   set venue_name    = 'Touch Padel',
       currency      = 'IQD',                   -- confirmed by Mustafa (pack currency.mode)
       timezone      = 'Asia/Baghdad',
       opening_hours = '{"mon":[["00:00","02:00"],["09:00","24:00"]],
                         "tue":[["00:00","02:00"],["09:00","24:00"]],
                         "wed":[["00:00","02:00"],["09:00","24:00"]],
                         "thu":[["00:00","02:00"],["09:00","24:00"]],
                         "fri":[["00:00","02:00"],["09:00","24:00"]],
                         "sat":[["00:00","02:00"],["09:00","24:00"]],
                         "sun":[["00:00","02:00"],["09:00","24:00"]]}'::jsonb,
       cancellation_window_hours = 4,           -- pack policy.cancelNote
       phone         = '00995419010203',        -- pack filler.contact -- see UNVERIFIED note above
       cash_rounding_iqd = 1                    -- resolved override #1: rounding OFF
 where id;

-- ---------------------------------------------------------------------------
-- 2. Tax groups: Standard 0% (active), Restaurant 10% (inactive until the
--    accountant says otherwise)
-- ---------------------------------------------------------------------------
insert into tax_groups (id, name_en, name_ar, rate_bp, is_active) values
  ('b0000000-0000-4000-8000-000000000001', 'Standard',   'قياسي', 0,    true),
  ('b0000000-0000-4000-8000-000000000002', 'Restaurant', 'مطعم',  1000, false)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Allergen reference list (allergens table lands in 0009_menu; guarded so
--    this seed works both before and after that migration)
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regclass('public.allergens') is not null then
    insert into allergens (code, label_en, label_ar) values
      ('nuts',    'Nuts',       'مكسرات'),
      ('dairy',   'Dairy',      'ألبان'),
      ('gluten',  'Gluten',     'غلوتين'),
      ('eggs',    'Eggs',       'بيض'),
      ('seafood', 'Seafood',    'مأكولات بحرية'),
      ('soy',     'Soy',        'صويا'),
      ('sesame',  'Sesame',     'سمسم'),
      ('spicy',   'Spicy',      'حار'),
      ('vegan',   'Vegan',      'نباتي صرف'),
      ('vegetarian', 'Vegetarian', 'نباتي')
    on conflict (code) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 4. One staff auth user per role + staff rows + PINs.
--    Empty-string token columns keep GoTrue's scanners happy on local stacks.
-- ---------------------------------------------------------------------------
insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
values
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000001',
   'authenticated', 'authenticated', 'owner@dev.touch.local',
   extensions.crypt('touch-dev-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Dev Owner"}', now(), now(),
   '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000002',
   'authenticated', 'authenticated', 'manager@dev.touch.local',
   extensions.crypt('touch-dev-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Dev Manager"}', now(), now(),
   '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000003',
   'authenticated', 'authenticated', 'cashier@dev.touch.local',
   extensions.crypt('touch-dev-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Dev Cashier"}', now(), now(),
   '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000004',
   'authenticated', 'authenticated', 'prep@dev.touch.local',
   extensions.crypt('touch-dev-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Dev Prep"}', now(), now(),
   '', '', '', '', ''),
  ('00000000-0000-0000-0000-000000000000', 'a0000000-0000-4000-8000-000000000005',
   'authenticated', 'authenticated', 'desk@dev.touch.local',
   extensions.crypt('touch-dev-password', extensions.gen_salt('bf')), now(),
   '{"provider":"email","providers":["email"]}', '{"full_name":"Dev Court Desk"}', now(), now(),
   '', '', '', '', '')
on conflict (id) do nothing;

insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.id in ('a0000000-0000-4000-8000-000000000001',
                'a0000000-0000-4000-8000-000000000002',
                'a0000000-0000-4000-8000-000000000003',
                'a0000000-0000-4000-8000-000000000004',
                'a0000000-0000-4000-8000-000000000005')
on conflict (provider_id, provider) do nothing;

insert into staff (id, display_name, role, is_active) values
  ('a0000000-0000-4000-8000-000000000001', 'Dev Owner',      'owner',      true),
  ('a0000000-0000-4000-8000-000000000002', 'Dev Manager',    'manager',    true),
  ('a0000000-0000-4000-8000-000000000003', 'Dev Cashier',    'cashier',    true),
  ('a0000000-0000-4000-8000-000000000004', 'Dev Prep',       'prep',       true),
  ('a0000000-0000-4000-8000-000000000005', 'Dev Court Desk', 'court_desk', true)
on conflict (id) do nothing;

-- Dev PINs (bcrypt). In real environments the owner sets PINs via app.set_staff_pin.
update staff set pin_hash = extensions.crypt('111111', extensions.gen_salt('bf'))
 where id = 'a0000000-0000-4000-8000-000000000001';
update staff set pin_hash = extensions.crypt('222222', extensions.gen_salt('bf'))
 where id = 'a0000000-0000-4000-8000-000000000002';
