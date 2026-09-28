# Open matches: continue the build

**For the next session.** Parsa says "continue open matches" (or runs `/continue-open-matches`), and
the build picks up from here. Paused 2026-09-28 at Parsa's request, after step 0 (design) and before
any code. Nothing in `packages/`, `apps/` or `e2e/` has been touched for open matches yet.

## Where things stand

| Piece | State |
| --- | --- |
| Decisions | Settled with Parsa over 11 rounds, approved 2026-09-27. §0 of `build-contracts-2026-09-27.md` (OM-3…OM-48, DF-1…DF-21). |
| Binding names | §1 of `build-contracts-2026-09-27.md`: tables, statuses, RPC names and arguments, error codes, lock order, push keys, migrations 0249–0261. The merge rulings in §1.12 amend it. |
| Lane drafts | `drafts/db-2026-09-28.md`, `drafts/money-2026-09-28.md`, `drafts/guest-2026-09-28.md`, `drafts/operator-2026-09-28.md`. Written against §1 before §1.12; **not merged and not reviewed.** |
| Adversarial review of the ticket model | **Not done.** Two reviewers were running when the build paused. If `drafts/review-*.md` exist, they finished; otherwise run them again (step 1). |
| Paperwork | Done: change order revised (EN + AR), `PHASE-2-PLAN.md` status 2026-09-27, `PHASE-2-CHECKLIST.md` milestones 6 and 7, Qi questions in `docs/client/qi-card-activation.md` (A8). |
| Code | None. The next free migration ordinal is **0249** (0248 is `fa86fe09`). Check it again before writing: `ls packages/db/supabase/migrations | tail -3`. |

The product in one line: waits-for-four matches on a free slot, no court held while filling (a normal
booking of the last free court bumps the match), booked at the 4th seat, every seat backed by a
reusable open-match ticket (bought once by Qi, about one seat's price, lost only on a no-show), full
shares paid at the desk.

## How to run it

Use workflows: ultracode has been on for this build. Every build step ends with its tests green on the
local stack (Docker Desktop, `supabase_*_touchpadel` containers; stop any other auto-started stack
first). Follow `packages/db/CLAUDE.md`, `apps/*/CLAUDE.md` and root `CLAUDE.md` throughout. **Do not
commit or push** until Parsa says so; when he does, follow the push rules in root `CLAUDE.md`
(gates first, then every run watched to green, never an AI co-author).

### Step 1. Finish the design (one doc, reviewed)

1. If there are no `drafts/review-*.md`, run two adversarial reviewers, read-only, over §0, §1 and the
   four drafts, checking every claim against the code:
   - **Concurrency, money and tickets:**
     - two players racing for the last seat;
     - a ticket locked twice, or ticket state drifting from seat state;
     - a purchase success racing a join;
     - approve-mode requests across matches;
     - a bump racing the 4th join;
     - `awaiting_court` against a hold that confirms or expires;
     - the sweep against desk marks and cascades (deadlocks, §1.4);
     - undoing an attendance mark after a forfeit;
     - call-off-short against a desk payment already taken;
     - a late leave refilled by a desk walk-in;
     - cash-out of a purchase with tickets in use;
     - account deletion with tickets in every state;
     - sandbox leakage;
     - `court_cap_iqd` tabs against day close;
     - the money invariants;
     - lock-order gate compliance, including service-role functions;
     - idempotency of every write.
   - **Decisions, rules and gates:**
     - every OM and DF implemented, or missing or contradicted;
     - every rules file and CI gate:
       - `check-migrations`;
       - rpc-registry overloads and re-issue chains;
       - authz guard-first;
       - lock order;
       - SEC-20/28/29;
       - error codes;
       - assistant coverage and map;
       - i18n parity and Arabic plurals;
       - mobile smoke and testIDs;
       - web page tests and applinks;
     - deploy order;
     - guest and staff UX states;
     - Arabic/RTL;
     - multi-venue;
     - legal and store copy.
2. Merge each draft into its section of `build-contracts-2026-09-27.md` (§2–§5), applying §1.12 and
   the reviewers' fixes, with one name for everything. Write §6 (rollout, tests, known limits).
   Anything that changes what players or staff experience goes to Parsa as a question; anything
   technical is decided and recorded in §1.12.
3. Mark the drafts superseded, or delete them, once merged.

### Step 2. Database, in order (each sub-step: migrations, tests, gates green)

| Sub-step | Contents |
| --- | --- |
| 2a | 0249, 0250, 0251 (CHECK widenings, each alone); `send-push` guest family (`_shared/guest-push.json`, `guestStrings.ts`) and the `match_report_new` staff key; 0252 profile names and gender; 0253 settings. |
| 2b | 0254 tables, the `booking_payments` anchor, `tabs.court_cap_iqd`, and the 0242 hooks scoped to deposit (`deposits.test.ts` stays green unmodified). |
| 2c | 0255 ticket purchase and cash-out; edge `ticket-begin`; `payments-fake` path. |
| 2d | 0256 core internals, 0257 guest RPCs (with `notify_staff` and `match_notify`). Tests: lifecycle, privacy, moderation, profile names. |
| 2e | 0258 desk and money RPCs and re-issues. Tests: desk, seat money invariants, day close not blocked. |
| 2f | 0259 triggers and sweep (tests include two connections booking courts A+B at once, which must bump exactly once), 0260 `delete_my_account`, 0261 reports. |
| 2g | Gates: `rls-matrix.ts`, rpc allowlist and coverage floor, assistant coverage, SEC-20 declarations, `check-lock-order` (new ranks, service-role walk), broadcast/analytics FORBIDDEN, the client error maps and their catalog keys (§1.12 R11). Then `pnpm db:types` and the full db suite. |

### Step 3. The apps (after `types.gen.ts`; lanes can run side by side)

- **Scaffolding first,** so the lanes don't collide: the i18n catalogs `matches.en/ar.ts` and
  `ws/matches.en/ar.ts` mounted, `packages/i18n/src/plural.ts`, and the `smoke/routes.ts` rows
  stubbed.
- **Mobile** (§4): Book tab choice sheet and chips, `matches`, `match/[id]`, `match-new`,
  `m/[token]`, `match-report`, `blocked-players`, `tickets`, pay/status ticket purpose, My
  Reservations, name fields, GenderAsk, push routing, `+native-intent.ts`, `app.config.ts` intent
  filters, `eas.json` `LINK_DOMAIN` ×3, smoke rows EN+AR.
- **Operator** (§5): seat chip, Today group, calendar strip, bump warning, Players panel, Take
  share, Assign, write-off, call off, `/desk/matches/$id`, customer record (tickets, cash-out, ban,
  gender), `MatchSettingsPanel`, Ops reports queue, day-close online card, Courts report Matches
  view, `e2e/tests/operator-matches.spec.ts` EN+AR.
- **Web and legal** (§4): `/[locale]/m/[token]`, `LINK_PATHS`, privacy and terms (tickets, conduct,
  names, gender), the terms version, store docs (UGC Yes), Play data safety.

### Step 4. Put it together

- Root `pnpm typecheck`, `lint`, `test`, `security`; `pnpm --filter @touch/mobile test:smoke`.
- The db suite and gates; `pnpm db:types` with no diff.
- The assistant map regenerated (`pnpm --filter @touch/db assistant:map`).
- e2e EN+AR.
- `HANDOFF.md` day entry and scope-ledger row (DF-11); `PHASE-2-CHECKLIST.md` ticks.
- A code review pass over the whole diff, then report to Parsa.

## Owner and client steps (never run by an agent)

- **ASK QI** (A8 in `docs/client/qi-card-activation.md`): fees, minimum amount, refund time limit,
  split refunds, prepaid passes under the merchant agreement.
- **Client:**
  - the ticket price;
  - the Arabic word for "ticket" and review of every DRAFT-AR string;
  - a consumer-law check on non-expiring, cash-back tickets;
  - tax on seat shares and forfeited tickets;
  - the App Store UGC "Yes";
  - signing the revised change order.
- **Parsa:**
  - the hosted push, in this order: `send-push` alone first, then the CHECK widenings, then the rest;
  - the operator tag;
  - the production `eas build`;
  - Qi secrets;
  - `matches_enabled` at one branch for the TestFlight trial;
  - the 1.0 store submission.
- **Open owner questions:**
  - headline revenue with written-off shares;
  - who bears Qi fees on a cash-out;
  - "settled another way" leaving no till movement;
  - tax on seat money.
