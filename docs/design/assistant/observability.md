# Assistant observability: route/cost report and the weekly scored eval

Written 2026-11-11. Two instruments for the owner assistant, both outside the edge functions.

## 1. Route and cost report

`packages/db/scripts/assistant-route-report.mjs` reads `assistant_messages`, `assistant_calls` and
`platform_settings.llm_web_search_micros` over the last N days and prints plain tables. It only
issues GET requests. It is also the way to re-measure the cost profile: the 2026-10-16 profile
predates the 2026-11-09 batch (router tiers, one streaming client, the per-turn cost ceilings).

Run it about two weeks after go-live traffic starts to build up (from roughly 2026-11-23, after
the 2026-11-09 batch has real use):

```
SUPABASE_URL=https://<project-ref>.supabase.co SUPABASE_SERVICE_ROLE_KEY=<service key> \
  pnpm --filter @touch/db assistant:route-report -- --days=14
```

The key comes from the environment or the git-ignored `packages/db/scripts/.env.local`, never
`apps/web/.env.local`. There is no default key or URL: it refuses to run without both and prints the
project URL first. Flags: `--days=N` (default 14), `--limit=N` (rows per candidate list, default
15), `--no-text` (leave the owner's words out of the candidate lists).

Tables printed:

1. Messages per tier (lookup, cheap analysis, deep, unrouted, reused) with shares and model calls.
2. Cost per tier: sum, share of spend, median, p95 and max per message, cost-capped count, plus a
   cross-check against the sum of `assistant_calls.cost_micros` and a per-model split.
3. Web searches: count, messages that searched, cost (searches times the current per-search price).
4. Gate outcomes: verified, unverified, retried, retried then verified, no verdict.
5. Misroute candidates: (a) lookup-routed messages whose `sources` show a data tool; (b)
   deep-routed messages with at most two model calls, one aggregate tool and no search.

Tier rule: `tokens.route = lookup` is lookup; `analysis` with a `route_reason` in the deep set
(`advice-signal`, `why-signal`, `outside-signal`, `long-question`, `empty`) is deep; every other
analysis is cheap analysis. The set is copied from `_shared/assistant/route.ts` (`DEEP_REASONS`);
change both together.

What it cannot see, and says so in its output: whether a data tool was needed by a lookup; the route
the router would pick today (rows keep the stored verdict only); a sticky warm-cache route that kept
the previous turn's model; answer quality (whether Sonnet would have answered a deep message as well
stays a human call: read the owner words before moving a rule); a search price that changed inside the
window; a turn cut off before it was stored. A new tool is non-aggregate until added to the
`AGGREGATE` pattern in the script.

## 2. Weekly scored eval

`.github/workflows/assistant-eval.yml`: Mondays 03:00 UTC and by hand (`workflow_dispatch`, with
optional `kind` or `only`). It starts the local stack on the runner like the CI db job, serves the
functions with the model key, runs `packages/db/scripts/assistant-eval.mjs` (40 questions, ship gate
36/40 with zero unverified figures on the numeric set) and uploads the scored JSON as the artifact
`assistant-eval-<run id>` for 90 days, with the headline in the job summary. The script has no
history feature, so comparing with the previous run is done by opening two artifacts.

- Secret to add: `ASSISTANT_EVAL_ANTHROPIC_KEY` (repository secret). Without it the run logs a
  notice and ends green; nothing runs and nothing is spent.
- Local only: no hosted secret, no `supabase link`. Spend is capped by setting the throwaway local
  stack's monthly cap to USD 6 and daily request limit to 80 before the run (past it the function
  answers 429 and the eval stops), on top of the per-turn ceilings. Give the key its own low limit at
  the vendor too.
- Expected cost: about USD 2 to 4 a run, so USD 10 to 16 a month. Not yet measured: the eval set has
  never been scored with a real key, so read the first run's cost line and adjust the cap.
