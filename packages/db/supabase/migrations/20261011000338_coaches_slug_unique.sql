set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0338 coaches_slug_key — one coach per share link name (0337). An index in
-- its own file (db CLAUDE.md, Migrations). app.coach_update and the coaches_slug
-- trigger answer COACH_SLUG_TAKEN before this index does; two racing writers
-- get it from the index itself.
--
-- Plain CREATE INDEX, not CONCURRENTLY (the 0304 and 0315 precedent): coaches
-- holds a handful of rows, written only by the coach admin RPCs, so the SHARE
-- lock is one tiny scan under lock_timeout 3s. The waiver goes in the pull
-- request body:
--   MIGRATION-RISK-ACCEPTED: unique index on coaches.slug, a table of a few
--   rows written only by the coach admin RPCs

create unique index if not exists coaches_slug_key on coaches (slug);
