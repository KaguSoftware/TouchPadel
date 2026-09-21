# packages/db/bench — the database performance gate

Phase 2, Milestone 0, item 11. Four areas (booking, cafe, analytics, replay), a
committed baseline taken from the CI runner, a nightly workflow, and a 10 %
regression rule. `PHASE-2-PLAN.md` Part C+ is where the rows and the targets
come from.

The point is not the absolute numbers — a laptop, a hosted runner and the till
in Erbil will never agree — it is that a change which makes `hold_slot` 30 %
slower shows up as a diff the morning after, instead of as a complaint from the
venue in March.

## Running it

```sh
pnpm --filter @touch/db db:start              # Docker stack (from packages/db)
cd packages/db && npx supabase db reset       # migrations from clean
pnpm db:fixtures                              # ROOT: courts, menu, tables, stock
pnpm --filter @touch/db bench:seed            # the bench fixture
npx supabase functions serve &                # from packages/db; replay needs it
pnpm --filter @touch/db bench                 # measure
pnpm --filter @touch/db bench:compare         # diff against baseline.json
pnpm --filter @touch/db bench:teardown        # put the database back
```

`pnpm bench` from the repo root is an alias for the measure step.

Flags: `bench -- --area=booking|cafe|analytics|replay|all --out=<dir> --repeat=N`.
`--repeat=N` runs the whole suite N times and keeps the **median** of each row's
p95; the nightly uses 3.

## How long it takes

One full pass is roughly 15-25 minutes on a Windows laptop against Docker
Desktop, most of it in the booking area (30 rounds x 50 callers on four separate
rows is ~9,000 RPCs) and in the two analytics rows that time out. On a Linux
runner without the Docker Desktop network hop it is considerably less. The
nightly runs `--repeat=3` inside a 45-minute job; if that ever gets tight, drop
`repeat` to 1 on the dispatch rather than cutting the sample counts, because the
row ids and the counts are what the baseline is a baseline OF.

A row that times out gives up after 3 consecutive timeouts instead of taking all
20 samples: a full 8 s statement_timeout, twenty times, three repeats, is 8
minutes spent proving one thing twenty-four times.

Exit codes are the same everywhere: `0` clean, `1` regression or failed
invariant, `2` harness error (no stack, no baseline, a refused
`--update-baseline`).

## What each file is

| File                        | What it is                                                                                                                                                 |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stats.ts`                  | Pure arithmetic: nearest-rank percentile, `summarize`, warmup trimming, the regression rule. No I/O, so `tests/bench-stats.test.ts` runs it with no stack. |
| `types.ts`                  | The row, result and baseline shapes.                                                                                                                       |
| `harness.ts`                | `timeIt` / `runSerial` / `runConcurrent`, invariant collection, the JSON writer and the `meta` block.                                                      |
| `areas/*.ts`                | One file per area; each is only the calls it wants timed.                                                                                                  |
| `run.ts`                    | Argument parsing, area order, repeat folding, the summary table.                                                                                           |
| `compare.ts`                | The diff, and `--update-baseline`.                                                                                                                         |
| `seed.sql` / `teardown.sql` | The fixture, `bec4`-prefixed, and its removal.                                                                                                             |
| `baseline.json`             | Committed. **Today it is a local placeholder** — see below.                                                                                                |
| `results/`                  | Gitignored; every run overwrites `results.json`.                                                                                                           |

## The rule

A row regresses when **both** halves are true:

```
p95 > baseline.p95 * 1.10   AND   (p95 - baseline.p95) > 10 ms
```

The ratio alone fires on a 4.0 → 4.5 ms row every time the runner is busy. The
floor alone lets a 500 ms report crawl to 509 ms every night until it is a
second slow. `p50` is printed and never judged; it is the number that tells a
human _why_ a p95 moved.

The comparison also fails on:

- a row in the baseline that this run did not produce (a deleted benchmark, an
  area that threw, or an edge runtime that was down — none of those is a clean
  night);
- a row this run produced that the baseline does not have (a new benchmark is
  adopted deliberately, with `mode: baseline`);
- a changed `outcome` in either direction;
- `invariants.ok === false`;
- errors on a row the baseline had clean.

`meta` is never compared.

Percentiles are **nearest-rank**, never interpolated:
`idx = min(n-1, max(0, ceil(p/100 * n) - 1))` on the sorted samples, so every
reported number is a call that actually happened.

Warmup: the first 5 serial samples and the first 2 concurrent rounds are
dropped. Counts: 60 serial samples; 30 rounds at N=10 and N=50 (per-call **and**
per-round percentiles); 20 per analytics row; one drain of 500 for replay.

## The invariants

Two rows assert a property, not a clock, and a failure there fails the run
whatever the p95 says:

- **`booking.contention@50.same_slot`** — 50 callers, one slot, 30 rounds:
  exactly 1 winner and 49 losers every round, every loss carrying `SLOT_TAKEN`,
  and zero `40P01` / `40001` / `57014`. A deadlock here would mean
  `app.lock_court`'s ordering had broken; a serialization failure would mean the
  exclusion constraint was being reached without the advisory lock in front of
  it. Neither is visible in a percentile.
- **`replay.drain_500`** — after 500 sequential POSTs, `order_items` on the
  bench tab and `sync_replays` for `device_id = 'BENCH1'` have each grown by
  exactly 500; 50 of the keys are then re-POSTed verbatim and every one comes
  back `duplicate` with neither count moving. Counts are compared as **deltas**,
  because `sync_replays` is append-only and a second run cannot clear the first.

## Replacing the placeholder baseline

**The committed `baseline.json` is a local placeholder** (`meta.runner:
"local-placeholder"`). It exists so `bench:compare` and
`tests/bench-contract.test.ts` have something to read; its numbers are from a
Windows laptop and mean nothing as a gate. Replace it with the first real run:

1. GitHub → **Actions** → **Bench (db)**.
2. **Run workflow**.
3. Set **mode** to `baseline` (leave `repeat` at 3).
4. When it finishes, download the `bench-baseline-<run_id>` artifact.
5. Copy `baseline.json` out of it over `packages/db/bench/baseline.json` and
   commit that one file.

`compare.ts` refuses to write a baseline outside GitHub Actions unless you pass
`--force`, which is how the placeholder was made, and it prints a warning on
every comparison against a placeholder.

## The fixture

`bench:seed` writes, all under the reserved `bec4` uuid prefix and `bench-`
names:

- 4 courts and 4 court-scoped rate rules at priority −90 valid from
  `current_date - 400`. **Court-scoped, never all-courts**: an all-courts rule
  prices every slot on every court at every instant in history, which is how
  three deliberate "nothing prices this" cases in `fixtures/pricing-golden.json`
  once went green by accident (`tests/helpers.ts` ~L166-178).
- ~12,800 bookings over 400 days × 4 courts (8 of the 14 hourly slots
  09:00–22:00, rotated per day and court) and ~1,200 expired mobile holds, which
  is what `analytics_courts_summary` reads for the lost-demand half of its
  heatmap.
- 300 bench **profiles**, and every identified booking carries `guest_id` rather
  than `guest_phone`. That is a performance decision, not a stylistic one:
  `app.analytics_guest_ident` short-circuits on `guest_id`, but falls back to a
  `profiles` scan with `app.phone_canon` applied per row when it only has a
  phone. Measured here, 6,400 phone-only bookings cost **5.85 s** in that
  branch against 20 ms for `phone_canon` alone — enough to push
  `analytics_courts_endings` and `analytics_courts_guests` past the 8 s
  statement timeout and turn `tests/analytics-courts.test.ts` and
  `tests/assistant-wall.test.ts` red while the bench fixture was loaded.
- 281 closed cafe days from `current_date - 400` to `current_date - 120`, ~10
  settled tabs each with an order, 3 lines, a ticket and a payment. The band
  stops 120 days short of today because `day_sessions.business_date` is UNIQUE
  and `tests/cafe-stock-analytics.test.ts` plants fixed dates in the recent past.
- A bench menu with no recipe lines (so the seeded tickets consume no stock), a
  bench cafe table, one open bench day, a 40-line tab for `compute_tab_totals`
  and an empty tab for the replay drain.

Triggers stay on throughout. `bench:teardown` removes all of it, including the
dependency closure of the open bench day — any suite that ran in between opened
its tabs there, because `ensureOpenDay` reuses whatever day is open.

**`bench:seed` and `bench:teardown` only ever touch a local stack**:
`scripts/db-fixtures.mjs` keeps its `isLocalTarget()` guard, and the bench files
go through that same loader rather than a second runner with a second copy of
the guard.

## What the first local run found

Taken on a Windows laptop against the fixture above — indicative, not a
baseline, but two of them are findings rather than numbers:

- **`analytics_courts_endings` and `analytics_courts_guests` do not complete at
  12 months.** Both hit the `authenticated` role's 8 s `statement_timeout`
  (migration 0109). The cause is the returning-guest test,
  `exists (select 1 from hist h where h.ident = b.ident and h.start_at <
b.start_at)`: the planner inlines `hist` into a correlated `SubPlan`, index-scans
  `reservations_start_at_idx` for every row before the outer one, and evaluates
  `app.analytics_guest_ident` **twice per candidate row**. Cost is quadratic in
  bookings over the window. These two rows are recorded with
  `outcome: 'timeout'`, so the baseline defends the finding in both directions —
  the day either starts returning, `compare.ts` says so.
- **`analytics_courts_summary` over 400 days does NOT time out on this
  fixture.** `PHASE-2-CHECKLIST.md` carries that as a finding to bring into the
  bench; on 12,800 bookings and 4 bench courts it returns in well under a
  second. What made the earlier measurement slow was court COUNT, not row count:
  `app.analytics_open_minutes` cross-joins every court with every hour of the
  window, and a database that has been through the test suite has dozens of
  courts from `createTestCourt`. On such a stack `analytics_open_minutes` alone
  measured 3.9 s over 365 days. The row records `expect` as what it MEASURED, not what the
  checklist predicted; the checklist line should be re-worded to name the court
  count rather than the date span.
