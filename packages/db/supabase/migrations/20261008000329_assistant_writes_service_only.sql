-- ===========================================================================
-- 0329 — assistant_messages and assistant_calls are written by the service
--        role only (review of the owner-assistant cost/speed work, 2026-10-08).
--
-- 0108 granted INSERT on both tables to authenticated, and its insert
-- policies (re-issued by 0234 with the initplan wrapper) check only
-- app.is_staff('owner'). A reviewer confirmed on the local stack that an owner
-- session could INSERT straight through PostgREST, gate column included:
--
--   * a planted assistant_messages row puts text into the model's history on
--     the conversation's next turn, and figures into the gate (the previous
--     answers' numbers are what the number gate trusts as "already shown");
--   * a planted assistant_calls row falsifies the per-call spend the usage
--     page and the per-message cost ceiling read.
--
-- No client writes either table. The operator and the phone only SELECT them
-- (apps/operator/src/features/assistant/api.ts, apps/mobile/src/features/
-- assistant/api.ts); every write is the service client in the edge functions
-- assistant-chat (the turn's messages, its calls) and assistant-job (the
-- job's answer message, its calls). The service role bypasses RLS and keeps
-- its own grants, so nothing it does changes here.
--
-- Defence in depth: since this change assistant-chat also HMAC-signs
-- gate.numbers (gate.sig) and trusts a prior turn's figures only when the
-- signature verifies, so a row written around this grant would still carry no
-- figures into the gate.
--
-- What stays: SELECT and the owner-only select policies (0234). 0108 never
-- granted UPDATE or DELETE on either table; the revoke below names them so a
-- later grant cannot slip in unnoticed. anon never had a grant; it is revoked
-- for the same reason. assistant_conversations (0325 narrowed its INSERT by
-- column) and assistant_jobs (select only) are not touched here.
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

revoke insert, update, delete on public.assistant_messages from authenticated, anon;
revoke insert, update, delete on public.assistant_calls    from authenticated, anon;

-- With no INSERT grant left the policies can never admit a row; drop them so
-- nobody reads them as a live path. Unpaired on purpose (check-migrations
-- flags it): RLS stays on and no INSERT policy remains, so the tables close
-- twice over rather than open; the SELECT policies are untouched.
drop policy if exists assistant_messages_insert_owner on public.assistant_messages;
drop policy if exists assistant_calls_insert_owner    on public.assistant_calls;

comment on table public.assistant_messages is
  '0108, 0329. One turn of a chat. content holds the provider''s content blocks verbatim (text, tool_use, tool_result, thinking) because the next turn must replay them unchanged; sources is the UI list of tool calls and cited chunks; gate is what the answer gate found (plan §4.5). Written only by the assistant-chat and assistant-job edge functions under the service role (0329 revoked the client INSERT 0108 granted: a planted row could put text into the model''s history or figures into the gate); the owner reads it under RLS.';
comment on table public.assistant_calls is
  '0108, 0329. One model call inside one assistant message (a turn can take several tool rounds). Written only by the assistant-chat and assistant-job edge functions under the service role (0329 revoked the client INSERT 0108 granted); the owner reads it under RLS. The four token kinds are what the price depends on (venue_settings.llm_pricing, 0111); cost_micros is what app.llm_price_micros said at the time.';
