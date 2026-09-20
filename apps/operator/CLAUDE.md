# apps/operator — rules for every change

The staff app (Vite + React, TanStack Router and Query) that runs inside `apps/operator-shell`
(Electron, the till) or in a browser tab for dev and tests. Written 2026-09-20 (Phase 2, Milestone 0
item 12) from `PHASE-2-PLAN.md` Part A5 plus the 09-20 code verification. Database-side rules are in
`packages/db/CLAUDE.md`.

## Commits

- No AI co-author trailer of any kind (`Co-Authored-By: Claude …`, Copilot, …). If a harness appends
  one, strip it. Root `CLAUDE.md`.
- Commit and push only when Parsa says "commit" or "push". Never run `git add`, `commit`, `stash`,
  `checkout`, `reset` or `clean` on your own.
- One commit carries the screen, its lane catalog pair
  (`packages/i18n/src/catalogs/ws/<lane>.en.ts` + `.ar.ts`) and, when an RPC changed, the
  regenerated `packages/db/src/types.gen.ts`.

## Roles and routes

- A route's roles live in `ROUTE_ROLES` (default deny) and `SUB_ROUTES`
  (`src/lib/auth.tsx:214,248`); a new screen is registered there and in `WORKSPACES`
  (`src/lib/workspaces.ts:272`) for the rail.
- `packages/db/scripts/check-assistant-coverage.mjs` reads the same route list, so a new route also
  needs a `packages/db/fixtures/assistant-coverage.json` entry.
- A capability gated inside a screen goes in `CAPABILITY_ROLES` (`src/lib/auth.tsx`, below line
  316). Never write `staff.role === '…'` inline: the RPC is the wall, this is the one place to
  change a permission (SOW L185). Four inline comparisons remain (Q4); do not add a fifth.
- What a failed role lookup means is decided in `src/lib/roleResolution.ts` (SEC-35), not by the
  caller.

## Writes

- Every business write is an `app.*` RPC through `appRpc` (`src/lib/appRpc.ts`) or a queued mutation
  through `mutate()` (`src/lib/mutate.ts:262`). Never `supabase.from(...).insert` in the renderer
  (`CONTRIBUTING.md`); reads are fine.
- A new mutation type is registered in all five copies: `packages/core/src/schemas/mutations.ts:17`,
  `src/lib/mutate.ts:75` (`DIRECT_RPC`), `packages/db/supabase/functions/replay/index.ts:49`,
  `apps/operator-shell/src/main/ipc-validate.ts:61` and `src/lib/queueResults.ts`.
- The one list is `packages/db/supabase/functions/_shared/mutation-types.json`;
  `src/lib/mutate.test.ts` fails when `DIRECT_RPC` drifts from it.
- Idempotency keys come from `src/lib/idem.ts` (`{station}:{mutation_type}:{ulid}`, real Crockford
  ULIDs); the queue validator and the replay function refuse anything else.
- Payloads never carry a price (`mutations.ts:13-14`) and only carry a `pin` where the server
  redacts it; a new secret field is added to `packages/db/supabase/functions/_shared/redact.ts`
  first.
- Server codes map through `MAPPED_CODES` (`src/lib/errors.ts:10`) to `op.errors.*` keys kept in
  both catalogs; edge functions are called through `src/lib/edge.ts`, which throws `EdgeError`.
- `electron`, `fs` and `node:fs` are restricted imports in the renderer (`eslint.config.mjs:21-27`);
  go through `src/ipc/bridge.ts`.
- `merge_tabs`, `record_drawer_open`, `open_day` and `close_day` stay online-only by decision
  (2026-09-20) and are listed in the scope ledger; `refund`, `cancel_tab`, `settle_zero_tab` and
  `void_after_send` become queued types in Milestone 0 item 9.

## Queries and realtime

- Shared query keys live in `QK` (`src/lib/queries.ts:35`); a feature-private key stays in its
  module. `src/lib/queueResults.ts` invalidates by mutation type, so a new type lists its keys there
  (its literals sit outside `QK` today; Milestone 0 item 10 moves them).
- Realtime topics (`kds`, `courts`, `floor`, `menu`) are subscribed through `src/lib/realtime.ts`,
  which owns auth and reconnect; do not open a channel elsewhere.

## i18n and styling

- Strings are `ws.<lane>.*` keys from `packages/i18n/src/catalogs/ws/` (`shell`, `kit`, `courtDesk`,
  `cashier`, `prep`, `manager`, `owner`, `analytics`, `reports`), one `.en.ts` + `.ar.ts` pair per
  lane so parallel lanes never edit one file.
- The Arabic file is typed `DeepMessages<typeof xEn>`, so a missing key fails `typecheck`;
  `packages/i18n/src/__tests__/t.test.ts:35` asserts parity on the assembled catalogs.
- Colour, type and spacing come from `var(--tp-*)` tokens (`packages/ui/src/tokens/operator.ts`);
  every new colour token needs a blue-mode value in `operatorBlue.ts` (`data-mode="blue"`,
  `docs/DESIGN.md` "Blue mode"). No raw hex, no font family name in app code.
- CSS logical properties only (`marginInlineStart`, not `marginLeft`); `rtlGuardRules` in
  `packages/config/src/eslint.js` fails `lint` on a physical property or
  `textAlign: 'left' | 'right'`.
- Before adding a primitive, grep `src/components/kit.tsx` and `src/components/ui.tsx`; both exist
  and already duplicate PIN and reason prompts (Q3).

## Tests

- `*.test.ts` run under node and `*.test.tsx` under jsdom (`vitest.config.ts:27`,
  `environmentMatchGlobs`). Keep screen logic in a pure sibling
  (`src/features/admin/dayCloseLogic.ts`) with a node test next to it.
- Run `pnpm --filter @touch/operator typecheck`, `lint` and `test` and report the exact result.
  Queue, sync worker and IPC validation are tested in `apps/operator-shell`: run
  `pnpm --filter @touch/operator-shell native:node` first, then `test`, then `native:electron`
  before any `dist`.
- Playwright journeys are `e2e/tests/operator-*.spec.ts` with EN and AR projects
  (`e2e/playwright.config.ts:55-64`); `pnpm e2e` from the root.
