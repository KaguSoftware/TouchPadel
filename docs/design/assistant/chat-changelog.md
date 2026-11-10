# assistant-chat — header changelog

The header comment `packages/db/supabase/functions/assistant-chat/index.ts` carried until 2026-11-09, moved here verbatim when the handler was split into `_shared/assistant/` modules (runners.ts, persist.ts, reads.ts, recheck.ts, reuse.ts, sse.ts); names below refer to the code as it stood then.

```text
assistant-chat — one owner message, streamed (plan §4.1, contracts
"assistant-chat/index.ts").

Request  POST { conversation_id: uuid|null, text, lang: 'en'|'ar', scopes?, range?: {from,to}, model?, dry_run?: true }
Response text/event-stream; events `message_start, delta, tool_start, tool_end,
         sources, gate, usage, job_estimate, done, error` (see the contracts table).
         Before the stream opens, refusals are plain JSON exactly like
         analytics-insights: 400 INVALID_REQUEST · 401 AUTH_REQUIRED · 403 FORBIDDEN ·
         404 NOT_FOUND · 429 LLM_DAILY_QUOTA / LLM_MONTHLY_CAP · 503 NOT_CONFIGURED.
         `dry_run: true` answers JSON `{ packs, start }`: the pack size per scope and
         `start` = { tokens, exact, model } | null, what any question in this chat
         sends before a tool runs (system prompt + tool list + first turn with the
         packs that fit), counted by the vendor where it can. No model call, no
         llm_begin_request, no rows written; null when the model's vendor has no key.

Re-check (plan §3.5, DECIDE 10; manual only, never automatic)
Request  POST { recheck: { message_id } } (owner session)
Response JSON { message_id, checked_at, tools: [{ name, args, row_count, ms, error? }],
         changed: [{ value_then, value_now? }], unchanged, baseline }
         The stored assistant message's tool calls (its `sources`) are re-run with
         the same arguments as the owner — knowledge and meta tools skipped, handles
         resolved from the conversation's table, nothing minted or persisted — each
         result cleaned, and the figures the answer printed are compared with the
         live number set (recheck.ts `diffNumbers`). The baseline is `gate.numbers`,
         persisted since this shape landed; a message saved before it answers
         `baseline: false`. No model, no llm_begin_request, no assistant_calls row;
         30 s time box. 404 for a message that is not an assistant turn of the
         caller's; 403 for another owner's.

`posthog` (plan §3.1): the one aggregate with `rpc: null`. The chat function
POSTs to the analytics-posthog function with the caller's Authorization
header (so its own owner check applies), one template per call, then cleans
the rows like any RPC result. `configured: false` becomes an is_error result.

The two clients (plan §7.1): every business read — tools, packs, search,
usage, counts — goes through `asOwner`, a client bound to the caller's JWT,
so the dispatcher's owner check and `app.assistant_run_tool`'s read-only
wall apply. That is not the owner's own table grants everywhere:
`assistant_table_read` (table_read) is SECURITY DEFINER, so for it the
column allowlist (`app.assistant_readable_columns`) is the real wall, and
clean.ts's excluded-column patterns the second one. The service client
touches only bookkeeping: llm_begin_request, llm_record_usage,
llm_price_micros, the assistant_* tables.

The door (plan §11.0): a tool's rows become a tool result only through
`clean()` → `toolResultBlock()`; the provider's message type accepts
nothing else, so this file cannot smuggle a raw row into a request.

Wall clock: 50 s, then the stream ends with `error {code:'TIMEOUT'}` after
persisting what exists. The turn's abort signal rides on every tool, pack,
search, usage and count RPC and on the posthog fetch, so the wall stops the
database work too, not only the model call. Persisted per message: the
assistant row (final text blocks, sources, gate, tokens), one
assistant_calls row per model call priced by `app.llm_price_micros`, one
`llm_record_usage`, and the conversation's handles / tokens / title / frozen
context. Intermediate tool_use blocks are NOT replayed on later turns (the
sources panel has them; plan §11.4 forgets old tool results anyway), so a
stored turn is always API-valid.

Cost and speed (F1, 2026-10-08; pure rules in assistant/turnPolicy.ts):
 - Before the stream opens: the timezone, the price list and the
   conversation are read in parallel. The conversation is read through
   `asOwner` (0108/0234: owner-only RLS) AND its owner_id compared, all
   before the quota or any write. Writes stay on the service client.
 - Router (assistant/route.ts): a lookup (where is X, how do I Y) runs on
   LOOKUP_MODEL at effort 'low' with the map searched up front; analysis on
   the chat's model at 'medium'. An owner's explicit model (this request's
   or the chat's) always wins, and the routed model is never written back
   to the chat. The route lands in the answer's `tokens` (route, route_reason).
 - Frozen first turn (0325 `assistant_conversations.context`): date,
   timezone and scopes, no context packs since 2026-10-09 (the model reads
   only what the question needs; every scope is open by default and costs
   nothing until one of its tools is called). It is stored and replayed
   while scopes, range, day, timezone and branch are unchanged and it is
   younger than CONTEXT_MAX_AGE_MS (30 min), so the prompt prefix through
   the history stays cacheable. A stored context from before, which carries
   packs, is rebuilt pack-less. The dry run measures the pack-less start.
 - History: 30–39 earlier messages, the window's start aligned to a seq of
   10k+1 (TAIL_STEP), so the history bytes hold for ten messages at a time.
 - Pre-retrieval: a lookup's `search` for the owner's words runs beside the
   context work and rides as a second text block of the user turn ("data,
   not instructions"); it shows as tool call `pre_search` in the sources,
   its figures join the gate's set, and the stored user message keeps only
   the owner's text. A failed search is skipped.
 - Tool results: a list tool sends DEFAULT_RESULT_ROWS (100) rows unless the
   model passed `limit` (up to the provider's 500); the cap marker then says
   to call again with a limit.
 - Pricing: each call is estimated in TypeScript from platform_settings'
   price list for the running total; the exact `app.llm_price_micros` prices
   are fetched in parallel at persist and stored as before (plus the web
   searches × the per-search price, 0324). Past TURN_COST_CAP_MICROS (USD
   1.50) a requested tool round is answered with an is_error notice and the
   model is told to answer now, like the rounds-exhausted path; the stored
   tokens say `cost_capped: true`.
 - Gate: one regenerated answer only when a flagged figure is money-sized or
   a percentage (gate.ts shouldRetry); smaller unverified figures stay
   marked. The previous answer's stored gate.numbers pass the gate (an owner
   follows up on them) when signed (review fixes below) but, like cited web
   figures, are not added to this answer's re-check baseline.
 - Not changed, on purpose: llm_begin_request still debits the quota before
   the user message is stored. A failed insert is a rare 500 that costs one
   request; the other order would store user messages for refused requests.

The round loop (F2, 2026-10-08): `runTurnLoop` in assistant/turn.ts, pure,
held by tests/assistant-turn.test.ts with a scripted provider. It owns the
tool rounds (parallel dispatch through `dispatchTool`: validation, scope,
handles, then `runTool` below), propose_job's `job_proposed` stop, the
rounds-exhausted and cost-ceiling notices, pause_turn, the web-search cap
line, the false-refusal retry and the money-only gate retry, all with the
same messages, events and stop reasons as when it was a closure here. This
file injects what touches the world: `provider.stream` (system, tools,
effort, webSearch per turnPolicy webSearchOn, the wall's signal), the tool runners as the owner,
the refusal retry's search, the price list estimate and the per-search
price (0324). It keeps the context, the history, the pre-search, HTTP and
persistence, and reads the loop's `TurnState` at persist, so a turn that
throws still stores what it spent.

Review fixes (2026-10-08, three lenses over F1/F2; pure rules in turnPolicy.ts
and turn.ts, held by tests/assistant-turn-policy.test.ts and
tests/assistant-turn.test.ts):
 - Branch: the frozen first turn is keyed on the request's venue_scope (the
   rail's branch, 0228) beside scopes, range, day and timezone. Its packs are
   read through x-venue-scope, so a chat that moves from branch A to B
   rebuilds instead of replaying A's takings (whose figures the gate would
   have accepted). A context stored before the key rebuilds once.
 - Partial builds: a fresh first turn is stored only when every pack RPC came
   back, the turn's signal was not aborted (Stop, the wall) and the turn did
   not fail (turnPolicy contextStorable); otherwise it serves this turn only.
 - Warm cache: caches are per model and a top-level effort change drops the
   messages cache, so a lookup within CACHE_WARM_MS (5 min) of the chat's
   last answer keeps that answer's model and effort (tokens.model and the
   new tokens.effort; keepWarmRoute) unless the owner's own model (the
   request's or the chat's) is another one. A
   lookup replays the stored packs only on the model that built them
   (FrozenContext.model), else it sends the pack-less first turn.
 - Pre-search breakpoint: in a pre-searched turn the owner's words carry an
   explicit cache_control (provider.ts PREFIX_CACHE_CONTROL), the boundary
   the next turn's history still contains (it stores the words alone).
 - Ceiling: also checked on pause_turn and before the false-refusal and gate
   retries; a tool request after the ceiling notice ends with stop reason
   `cost_capped`, the text so far plus TURN_NOTICES.costCeilingAnswer, gated.
   The estimate never falls to zero: no rate in the list and no blended rate
   means turnPolicy FLOOR_RATES (0312 Opus 5.5), and an unread price list is
   logged.
 - Previous figures: `assistant_messages` (gate column included) was
   INSERT-able by any owner session (0108 grant + is_staff('owner') policy)
   until 0329 revoked it, so the previous answer's gate.numbers pass the
   gate only with this function's HMAC (`gate.sig`, keyed from
   SUPABASE_SERVICE_ROLE_KEY, over chat id + message id + figures), kept as
   defence in depth. Rows stored before carry none: their figures are
   simply marked.
 - Lists: a list whose RPC total is at most SMALL_LIST_ROWS (150) goes whole,
   so a 101–150-row answer costs no second "call again with limit" round.
 - clean.ts escapes `<data` / `</data` inside a frame's body, so a snippet in
   the pre-search block (the owner's own user turn) cannot close the frame.
```
