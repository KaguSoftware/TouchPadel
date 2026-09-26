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
- A new mutation type is registered in all six code copies, appended in the SAME order in each
  (the shell's test compares arrays): `packages/core/src/schemas/mutations.ts` (`MUTATION_TYPES` +
  a payload schema + an envelope variant), `src/lib/mutate.ts` (`DIRECT_RPC`),
  `packages/db/supabase/functions/replay/index.ts` (`MUTATION_RPCS`),
  `apps/operator-shell/src/main/ipc-validate.ts` (`MUTATION_TYPES`), `src/lib/queueResults.ts`
  (`RESULT_INVALIDATIONS`, registry keys only) and `src/features/admin/dayCloseLogic.ts`
  (`QUEUE_WRITE_KEY`, the word the day-close list shows; typed against `MutationType`).
- The one list is `packages/db/supabase/functions/_shared/mutation-types.json`;
  `src/lib/mutate.test.ts` fails when `DIRECT_RPC` drifts from it, `queueResults.test.ts` and
  `dayCloseLogic.test.ts` when their maps do, and the replay function refuses to boot.
- A refusal that arrives while `mutate()` is still waiting (8 s) throws to the caller and is shown
  beside the control; one that arrives later reaches `onFailedResult` (`src/lib/queueResults.ts`),
  which `components/QueueFailureToasts.tsx` turns into a toast and a screen may turn back into
  its own per-row message (OpenTabs removals, TabDetailPanel voids).
- Idempotency keys come from `src/lib/idem.ts` (`{station}:{mutation_type}:{ulid}`, real Crockford
  ULIDs); the queue validator and the replay function refuse anything else.
- Payloads never carry a price (`mutations.ts:13-14`) and only carry a `pin` where the server
  redacts it; a new secret field is added to `packages/db/supabase/functions/_shared/redact.ts`
  first.
- Server codes map through `MAPPED_CODES` (`src/lib/errors.ts:10`) to `op.errors.*` keys kept in
  both catalogs; edge functions are called through `src/lib/edge.ts`, which throws `EdgeError`.
- `electron`, `fs` and `node:fs` are restricted imports in the renderer (`eslint.config.mjs:21-27`);
  go through `src/ipc/bridge.ts`.
- `merge_tabs`, `record_drawer_open`, `open_day`, `close_day`, `open_till_shift`,
  `close_till_shift` and `close_till_shift_for` stay online-only by decision (Parsa 2026-09-20,
  the till shifts wave 5; the "Till online-only ops" row of the scope ledger in `HANDOFF.md`). Every
  other till money write is a queued type: `refund` (`payment.refund`), `cancel_tab`
  (`tab.cancel`), `settle_zero_tab` (`tab.settle_zero`), `void_after_send` (`order_item.void`) and
  `record_waste` (`stock.waste`) since Milestone 0 item 9 (migration 0120). A PIN-gated one carries
  `pin` in its payload; the replay function proves it first (0115).

## Queries and realtime

- Shared query keys live in `QK` (`src/lib/queryKeys.ts`, re-exported by `src/lib/queries.ts`); a
  feature-private key stays in its module. `src/lib/queueResults.ts` invalidates by mutation type
  and may only name registry keys (`queueResults.test.ts`), so a new type lists its keys there.
- Realtime topics (`kds`, `courts`, `floor`, `menu`) are subscribed through `src/lib/realtime.ts`,
  which owns auth and reconnect; do not open a channel elsewhere.

## Branches (multi-venue, 2026-09-26)

- The branch a screen shows is `useVenue().branchId` (`src/lib/venue.tsx`): a registered station's
  branch, else the owner's rail switcher choice, else the person's only branch. Every Supabase call
  carries `x-station-id` and `x-venue-scope` (`src/lib/venueScope.ts`, wired into `lib/supabase.ts`);
  the server narrows staff reads to that branch (0226) and files default-based writes there (0226
  step 2c). So a list query needs **no** `.eq('venue_id', …)`; do not add one, and do not read
  `venue_settings_public` (a definer view, one row per open branch) without `.eq('venue_id',
  currentBranchId())`.
- Switching branch resets the query cache (`VenueProvider`); a registered station never switches.
- Realtime `kds`, `floor` and `courts` are per branch: `useBroadcast` maps them with `branchTopic`;
  never subscribe to `'<topic>:' + id` by hand.
- An RPC argument that names a branch (`p_venue_id`) takes `currentBranchId()`; most need none
  because the server resolves it from the headers.
- The owner's "All branches" exists only on report and analytics pages (`ReportBranchScope`), never
  on an operational screen.
- Branch strings live in `ws.branches.*` (EN + AR).

## i18n and styling

- Strings are `ws.<lane>.*` keys from `packages/i18n/src/catalogs/ws/` (`shell`, `kit`, `courtDesk`,
  `cashier`, `prep`, `manager`, `owner`, `analytics`, `reports`, `team`), one `.en.ts` + `.ar.ts` pair per
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
