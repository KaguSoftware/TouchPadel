-- ===========================================================================
-- 0114 — replay ledger hygiene: purge recorded PINs, drop app.log_replay.
--
-- Two of the Phase 1 criticals (PHASE-2-PLAN.md A3, S2 and S5), closed together
-- because both live in the same table.
--
-- S2. The replay edge function used to write the WHOLE queued payload into
-- sync_replays.conflict_detail on every failed attempt, and adjustment.apply
-- payloads carry the manager's PIN by design. So a mistyped discount left a
-- six-digit manager PIN in a manager-readable table, and the same JSON was
-- echoed back over HTTP to whichever till replayed that key next. The function
-- now redacts before it records (functions/_shared/redact.ts); this migration
-- removes what is already there. sync_replays is append-only by a statement
-- trigger (0021), so the purge disables that trigger for exactly the one
-- statement and re-enables it in the same transaction — the same shape the
-- multi-venue backfill will need on every append-only table.
--
-- S5. app.log_replay was granted to `authenticated` with zero production
-- callers (two tests). Its guard is "any active staff", so any cashier session
-- could insert an arbitrary idempotency_key row that the replay function then
-- treats as "already handled": a poisoned dedupe ledger that silently drops a
-- colleague's queued sale. The replay function writes sync_replays itself as
-- the service role and has since 0021; nothing else may. The service role
-- cannot use the function either (its guard needs a staff auth.uid()), so a
-- revoke would leave dead code with a live grant in the registry: drop it.
--
-- Not changed: sync_replays itself, the replay function's dedupe read, or
-- manager_alerts('replay_conflict') rows written by the function (those carry
-- pgErr.details only, never the payload). manager_alerts rows written by
-- app.log_replay in tests carried the whole detail: purged below too.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- S2: purge PINs already recorded. Pre-flight for the reviewer:
--   select id, replayed_at from sync_replays where conflict_detail #> '{payload,pin}' is not null;
-- The trigger is BEFORE UPDATE OR DELETE ... FOR EACH STATEMENT (0021:50-52).
-- ---------------------------------------------------------------------------
alter table sync_replays disable trigger sync_replays_ao;

update sync_replays
   set conflict_detail = jsonb_set(conflict_detail, '{payload,pin}', '"[redacted]"'::jsonb, false)
 where conflict_detail #> '{payload,pin}' is not null
   and conflict_detail #>> '{payload,pin}' <> '[redacted]';

alter table sync_replays enable trigger sync_replays_ao;

update manager_alerts
   set payload = jsonb_set(payload, '{detail,payload,pin}', '"[redacted]"'::jsonb, false)
 where kind = 'replay_conflict'
   and payload #> '{detail,payload,pin}' is not null
   and payload #>> '{detail,payload,pin}' <> '[redacted]';

-- ---------------------------------------------------------------------------
-- S5: close the client-callable write into the dedupe ledger.
-- ---------------------------------------------------------------------------
revoke all on function app.log_replay(text, text, text, text, jsonb) from public, anon, authenticated;
drop function if exists app.log_replay(text, text, text, text, jsonb);

comment on table sync_replays is
  '0021/0114: one row per replayed queued write, written ONLY by the replay edge '
  'function as the service role. Append-only (grants + sync_replays_ao). '
  'conflict_detail never carries a payload secret since 0114 (redacted at write; '
  'historic rows purged here).';
