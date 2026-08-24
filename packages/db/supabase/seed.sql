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
update venue_settings
   set venue_name    = 'Touch Padel',
       currency      = 'IQD',
       timezone      = 'Asia/Baghdad',
       opening_hours = '{"mon":[["09:00","23:00"]],"tue":[["09:00","23:00"]],"wed":[["09:00","23:00"]],
                         "thu":[["09:00","23:00"]],"fri":[["09:00","23:00"]],"sat":[["09:00","23:00"]],
                         "sun":[["09:00","23:00"]]}'::jsonb,
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
