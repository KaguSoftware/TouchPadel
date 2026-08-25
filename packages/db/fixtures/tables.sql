-- FIXTURE — replaceable business data, dev/staging ONLY. Never applied to prod.
--
-- Reserved fixture UUID prefix 'f1f7' (see courts.sql / packages/db/README.md).
-- Suffix namespace: cafe_tables 00000000ab01..ab12.
--
-- Content: 12 cafe tables T1-T12 — T1-T8 indoor, T9-T12 terrace. token_version
-- starts at 1 (bumping it via the owner RPC kills every printed QR).
-- bell_enabled (0031): on everywhere except T12, so the guest UI's "bell off"
-- state and raise_waiter_call's BELL_DISABLED path have a fixture to hit.

begin;

insert into cafe_tables (id, table_number, zone, capacity, token_version, bell_enabled, is_active) values
  ('f1f70000-0000-4000-8000-00000000ab01', 'T1',  'indoor',  2, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab02', 'T2',  'indoor',  2, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab03', 'T3',  'indoor',  4, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab04', 'T4',  'indoor',  4, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab05', 'T5',  'indoor',  4, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab06', 'T6',  'indoor',  6, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab07', 'T7',  'indoor',  6, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab08', 'T8',  'indoor',  8, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab09', 'T9',  'terrace', 2, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab10', 'T10', 'terrace', 4, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab11', 'T11', 'terrace', 4, 1, true,  true),
  ('f1f70000-0000-4000-8000-00000000ab12', 'T12', 'terrace', 6, 1, false, true)
on conflict (id) do update set bell_enabled = excluded.bell_enabled;

commit;
