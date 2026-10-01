# Coaching: where the build stands, and how to continue it

Phase 2 milestone 5 (change-order item 2). Planned and approved by Parsa on 2026-10-01. The plan is
`~/.claude/plans/which-features-are-left-eventual-wigderson.md`; the binding names are
`build-contracts-2026-10-01.md` §1.

## Where things stand

| Piece | State |
| --- | --- |
| Decisions | Settled with Parsa over six rounds, approved 2026-10-01: C-1…C-20 and defaults CD-1…CD-12 in §0 of `build-contracts-2026-10-01.md`; C-21…C-31 (§0.2b) answered the reviews' questions the same day. |
| Binding names | §1 of `build-contracts-2026-10-01.md`: migrations 0270–0286, tables, statuses, locks, RPCs, push, error codes, client names. |
| Lane contracts | **Written 2026-10-01**: `db.md`, `money.md`, `guest.md`, `operator.md` (about 7,100 lines). Their additions and contradictions were merged as rulings R1–R23 in §1.12; §1 was patched to match. The lane files themselves still need the consistency pass. |
| Adversarial review | **Done 2026-10-01**: `drafts/review-concurrency-money-2026-10-01.md` (1 blocker, 9 majors) and `drafts/review-rules-privacy-2026-10-01.md` (4 blockers). Parsa answered their ten questions (C-21…C-31, §0.2b). Their fixes are rulings R24–R63 in §1.13. |
| Consistency pass | **Done 2026-10-01**: each lane file aligned with §1.12–§1.13 and C-21…C-31; what the passes left open is settled by the closing rulings R64–R80 (§1.14). **Step 1 is complete.** Authority order for a builder: §0 decisions → §1.14 → §1.13 → §1.12 → §1.1–§1.11 → the lane file. |
| Coverage | `assistant-coverage.json` has an `excluded` entry for every file under `docs/design/coaching/` (R53); `check:assistant-coverage` passes. |
| Database (step 2) | Not started. Next free ordinal **0270** (check the directory first: the team pushes to `main` too). |
| Apps (step 3) | Not started. |
| Integration (step 4) | Not started. |
| Hosted | Nothing. Coaching ships off on every branch (`coaching_enabled = false`). |

## How to run it

### Step 1. Finish the design

1. The four lane contracts, each against §1. New names go under "Additions to §1"; the merge folds
   them back into §1.
2. An adversarial review in two parts:
   - concurrency and money: lock order, the lesson guards, double counting, refunds;
   - rules, privacy and decisions.
   Their fixes become rulings R1… in a new §1.12 of the contracts.
3. A consistency pass over the four lane files against §1 and the rulings.

### Step 2. Database, in order (each sub-step: migrations, tests, gates green on the local stack)

0270 → 0271 → 0272 → 0273 → 0274 → 0275 → 0276 → 0277 → 0278 → 0279 → 0280 → 0281 → 0282 → 0283
→ 0284 → 0285 → 0286. Regenerate `types.gen.ts` after 0275 and after every migration that changes a
signature. The widenings (0270–0273) are each alone, ahead of anything that uses them.

### Step 3. The apps (after `types.gen.ts`; lanes can run side by side)

- Core: `packages/core/src/coaching/`, the `mutations.ts` kind enum, `slotGrid.ts`.
- Mobile guest and coach mode (`guest.md`).
- Web `/coaching` and `/c/[id]` (`guest.md`).
- Operator (`operator.md`).
- Edge: `lesson-begin`, the `send-push` guest strings.

### Step 4. Put it together

A fresh `db:reset` + `node scripts/db-fixtures.mjs`; every db gate; the full db suite with
`TP_REQUIRE_STACK=1`; root `pnpm typecheck`, `lint`, `test`, `security`;
`pnpm --filter @touch/mobile test:smoke`; `pnpm e2e` (EN + AR) with the coaching spec;
`pnpm db:types` with no diff; `pnpm --filter @touch/db assistant:map`.

### Step 5. Paperwork, commit, push

`PHASE-2-CHECKLIST.md`, `PHASE-2-PLAN.md` (status block), `HANDOFF.md` (a Day entry, the scope
ledger rows, the file map), the change order (EN + AR), `packages/db/CLAUDE.md` (the latest-ordinal
line). Commits authored by Parsa, no co-author trailer. Push per the root `CLAUDE.md` "Pushing".

## Owner and client steps (never run by an agent)

- **Client:**
  - the coach list;
  - lesson types and prices;
  - written confirmation of the 60 % coach share;
  - the tax group for lessons;
  - Mustafa's OK to show lesson prices on the website (C-11);
  - review of every DRAFT-AR string.
- **Parsa:**
  - the operator tag;
  - the production `eas build` (coach mode, guest coaching, the `/c/` links);
  - Qi secrets, if lessons are to be paid online;
  - `coaching_enabled` at one branch for the TestFlight trial.
