-- FIXTURE — dev logins for the six staff roles 0155 added, and the two wave 5 added
-- (staff_roles_assistant_waiter). Local and staging ONLY; never prod.
--
-- docs/design/protocols/build-contracts-2026-09-23.md §1.2 (lane B, PROPOSAL): seed.sql signs
-- in owner, manager, cashier, prep and court desk; nothing signed in as head barista, barista,
-- head chef, chef, driver or marketing, so the staff phone and the kitchen board could not be
-- tried as one of them by hand. Password for every account: touch-dev-password (as seed.sql).
--
--   head_barista  head-barista@dev.touch.local
--   barista       barista@dev.touch.local
--   head_chef     head-chef@dev.touch.local
--   chef          chef@dev.touch.local
--   driver        driver@dev.touch.local
--   marketing     marketing@dev.touch.local
--   assistant_barista  assistant-barista@dev.touch.local  (wave 5, §2.1.6 of
--   waiter             waiter@dev.touch.local              wave5-addendum-2026-09-25)
--
-- Ids continue seed.sql's staff series (…0001 to …0007), so they never meet a test's own
-- accounts (tests/new-roles.test.ts creates and deletes its own per run). The 0123 trigger
-- (staff_default_venue) files each at the default venue, as it did the seed's staff. No PINs:
-- the phone never asks for one, and a PIN for a station is set on the Staff page.
--
-- NOT IN THE DEFAULT FIXTURE LIST: rls-matrix.ts keeps its eight principals, and counting
-- tests read the seeded staff as they are.
--
-- Apply:  pnpm --filter @touch/db db:fixtures fixtures/staff-roles.sql
-- Undo:   pnpm --filter @touch/db db:reset && pnpm --filter @touch/db db:fixtures
-- Re-runnable: every insert is `on conflict do nothing`.

begin;

insert into auth.users
  (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
   raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
   confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current)
select '00000000-0000-0000-0000-000000000000', v.id, 'authenticated', 'authenticated', v.email,
       extensions.crypt('touch-dev-password', extensions.gen_salt('bf')), now(),
       '{"provider":"email","providers":["email"]}', jsonb_build_object('full_name', v.name), now(), now(),
       '', '', '', '', ''
  from (values
    ('a0000000-0000-4000-8000-000000000008'::uuid, 'head-barista@dev.touch.local', 'Dev Head Barista'),
    ('a0000000-0000-4000-8000-000000000009'::uuid, 'barista@dev.touch.local',      'Dev Barista'),
    ('a0000000-0000-4000-8000-00000000000a'::uuid, 'head-chef@dev.touch.local',    'Dev Head Chef'),
    ('a0000000-0000-4000-8000-00000000000b'::uuid, 'chef@dev.touch.local',         'Dev Chef'),
    ('a0000000-0000-4000-8000-00000000000c'::uuid, 'driver@dev.touch.local',       'Dev Driver'),
    ('a0000000-0000-4000-8000-00000000000d'::uuid, 'marketing@dev.touch.local',    'Dev Marketing'),
    ('a0000000-0000-4000-8000-00000000000e'::uuid, 'assistant-barista@dev.touch.local', 'Dev Assistant Barista'),
    ('a0000000-0000-4000-8000-00000000000f'::uuid, 'waiter@dev.touch.local',       'Dev Waiter')
  ) as v(id, email, name)
on conflict (id) do nothing;

-- An identities row per user, or GoTrue refuses the email sign-in (seed.sql does the same).
insert into auth.identities
  (provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
select u.id::text, u.id,
       jsonb_build_object('sub', u.id::text, 'email', u.email, 'email_verified', true),
       'email', now(), now(), now()
  from auth.users u
 where u.id in ('a0000000-0000-4000-8000-000000000008',
                'a0000000-0000-4000-8000-000000000009',
                'a0000000-0000-4000-8000-00000000000a',
                'a0000000-0000-4000-8000-00000000000b',
                'a0000000-0000-4000-8000-00000000000c',
                'a0000000-0000-4000-8000-00000000000d',
                'a0000000-0000-4000-8000-00000000000e',
                'a0000000-0000-4000-8000-00000000000f')
on conflict (provider_id, provider) do nothing;

insert into staff (id, display_name, role, is_active) values
  ('a0000000-0000-4000-8000-000000000008', 'Dev Head Barista', 'head_barista', true),
  ('a0000000-0000-4000-8000-000000000009', 'Dev Barista',      'barista',      true),
  ('a0000000-0000-4000-8000-00000000000a', 'Dev Head Chef',    'head_chef',    true),
  ('a0000000-0000-4000-8000-00000000000b', 'Dev Chef',         'chef',         true),
  ('a0000000-0000-4000-8000-00000000000c', 'Dev Driver',       'driver',       true),
  ('a0000000-0000-4000-8000-00000000000d', 'Dev Marketing',    'marketing',    true),
  ('a0000000-0000-4000-8000-00000000000e', 'Dev Assistant Barista', 'assistant_barista', true),
  ('a0000000-0000-4000-8000-00000000000f', 'Dev Waiter',       'waiter',       true)
on conflict (id) do nothing;

commit;
