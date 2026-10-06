set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0304 profiles_phone_unique — one live profile per phone (loyalty contracts
-- §1.2, decision L-3). An index in its own file (db CLAUDE.md, Migrations).
--
-- 0303 account_identity filled profiles.phone_key and merged (or, for a
-- refused pair, cleared) every live duplicate, so the build cannot meet two
-- live rows with one key. From here on the zz_phone_key trigger answers
-- PHONE_TAKEN before this index does, handle_new_user stores NULL rather than
-- collide, and two racing writers get 23505 from the index itself.
--
-- tabs_customer_idx (contracts §1.3 ruling: "put it in file B") is not here:
-- tabs.customer_id is created by 0304 loyalty, which runs after this file, so
-- that index lands with its column.

create unique index if not exists profiles_phone_key_live
  on profiles (phone_key)
  where deleted_at is null and phone_key is not null;

comment on index profiles_phone_key_live is
  '0304. One live profile per canonical phone (app.phone_canon). Tombstones and profiles without a phone are outside it.';
