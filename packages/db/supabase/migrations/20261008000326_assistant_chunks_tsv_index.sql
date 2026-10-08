-- ===========================================================================
-- 0326 — the GIN index on assistant_chunks.tsv, back after 0325 rebuilt the
--        column (dropping a generated column drops its index with it).
--
-- Its own file because a `create index` needs one (packages/db/CLAUDE.md,
-- scripts/check-migrations.mjs). Same name and shape as 0110's
-- assistant_chunks_tsv_idx; the @@ in app.assistant_search (0325) uses it.
--
-- MIGRATION-RISK-ACCEPTED: a plain GIN build on assistant_chunks, a few
-- thousand rows of map text that only the owner assistant reads (the index
-- function writes it, app.assistant_search reads it); the SHARE lock holds no
-- till, desk or guest write. CONCURRENTLY cannot run inside the migration's
-- transaction.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

create index if not exists assistant_chunks_tsv_idx on assistant_chunks using gin (tsv);
