set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0308 profiles_username_unique — one live profile per username (0307). An
-- index in its own file (db CLAUDE.md, Migrations). The column is new and
-- empty, so the build meets no duplicate; app.set_my_username answers
-- USERNAME_TAKEN before this index does, and two racing writers get it from
-- the index itself.
--
-- Plain CREATE INDEX, not CONCURRENTLY (the 0279 and 0304 precedent): the
-- predicate matches no row today (username is NULL on every profile), so the
-- index is empty, though the build still takes SHARE on profiles for one scan
-- under lock_timeout 3s. The waiver goes in the pull request body:
--   MIGRATION-RISK-ACCEPTED: new column, partial index whose predicate matches
--   no row today (profiles.username is empty)

create unique index if not exists profiles_username_live
  on profiles (username)
  where deleted_at is null and username is not null;
