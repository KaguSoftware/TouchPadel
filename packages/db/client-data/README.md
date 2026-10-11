# `client-data/` — Touch's real business data

The fourth data tier, and the only one that is **Touch's own information** rather than ours:

| Tier | Path | Loaded by | What it is |
|---|---|---|---|
| Reference | `supabase/seed.sql` | `supabase db reset` | Environment-invariant: tax groups, allergens, dev staff, **and the venue config Touch has confirmed** |
| Dev fixtures | `fixtures/*.sql` | `pnpm db:fixtures` | Replaceable demo business data, every UUID prefixed `f1f7` |
| Real cafe menu | `seeds/touch-cafe-menu.sql` | `pnpm db:menu` | The 13-category / 72-item menu from the approved design |
| **Client data** | **`client-data/*.sql`** | **`pnpm db:client`** | **What Touch sent us, verbatim** |

Reserved UUID prefix for this tier: **`70c4`** ("TOUCH"). As with `f1f7`, nothing outside this
directory may reference a `70c4` UUID.

## Why this is not applied by default

`pnpm db:client` is **deliberately not** part of `db:fixtures`. As of the 2026-08-30 pack Touch has
sent **courts but no rate rules** (the rates table is empty in both packs), so the real courts price
as `NO_RATE` and nothing can be booked on them. Until rates arrive, the `f1f7` fixtures remain the
dev and test default — they are the only coherent, fully-priced dataset in the repo.

Run `pnpm db:client` when you specifically want to see Touch's own data, and expect booking to fail
until `rates.sql` exists.

## The packs

Touch answers a Kagu OS intake pack; each export is a single JSON file. **Commit every pack here
verbatim, unedited** — it is the contractual record of what the client actually said, and the SOW
makes late or missing client input a schedule consequence (§11). Name them
`touch-padel-pack-YYYY-MM-DD.json`.

Packs are the source; the `.sql` files in this directory are **derived by hand** from them, with the
pack answer key quoted in a comment beside every value. A reusable JSON→SQL importer is not built
(see `../README.md` §"Fixture swap procedure" for the shape it would take).

### Pack ledger

| Pack | Answered | Landed | Notes |
|---|---|---|---|
| `touch-padel-pack-2026-08-29.json` | 8 / 21 | hours, cancellation window, currency, tax, phone, courts | `submittedAt: null`. Rates, menu, recipes, ingredients and staff all empty — see `docs/client/06-outstanding-2026-08-29.md` |
| `touch-padel-pack-2026-08-30.json` | 16 / 21 | Decisions pack — no new data files derivable. Confirms every 08-29 answer unchanged (13 answers added, 0 changed). Landed as records/docs: domain `touch-padel.com`, backups decision, Kurdish no, fonts/logo/photos received via WhatsApp, printer arrived, UPS, training yes, floor count 12, approver + hosting email, 4 operational notes | `submittedAt: null`. Rates, menu, recipes and staff STILL empty — see `docs/client/07-outstanding-2026-08-30.md`. Pack answer `pitr.mode = "pitr"` was **superseded by the owner 2026-08-30**: daily backups, no PITR |

> **Both pack files above are the clean Kagu OS originals** (verified UTF-8, intact Arabic),
> copied in byte-for-byte on 2026-08-30. The mojibake that kept the 2026-08-29 pack out of the
> repo existed only in a transcoded intermediary copy, not in the exports themselves. The Arabic
> court names in `courts.sql` are now verified against the originals (Court 1 follows the pack's
> own spelling, `الملعب الاول` — plain alef).

## Recipes (2026-09-25)

The kitchen sent its recipes as WhatsApp text in Arabic. Three files hold them:

| File | What it is |
|---|---|
| `recipes-2026-09-25.ar.txt` | The kitchen's text, verbatim. `---` only marks where one pasted block ends. |
| `recipes-2026-09-25.en.txt` | Line-for-line English. Numbers exactly as written; `[brackets]` are translator's notes. |
| `recipes-2026-09-25.json` | The structured form: ingredients, batch recipes, menu recipes, and the questions still open for the kitchen and the owner. Its `conventions` block explains every field. |

Migration `0190` is generated from the JSON. It removes every example ingredient and loads the real
ones, plus every recipe the JSON marks `ready`. It only acts where the real menu from
`seeds/touch-cafe-menu.sql` is present, so dev and CI fixtures are untouched. Recipes marked
`incomplete` or `needs-decision` wait on the JSON's `questions`, and land in a later migration once
they are answered.

## Monthly padel reports from before the system (2026-10-10)

Hussein al-Sarraf's monthly reports for the padel desk (قسم البدل), June to September 2026, sent by
Majed as four Word files. They are counts for a whole month (completed, cancelled, training, not
booked, free, no-show) plus, for July and August, an amount of money. They name no court, hour,
guest or price, so they are **not** turned into reservations: that would mean inventing all of it.
They land as what they are, in `legacy_reports` + `legacy_report_figures` (migration 0331), which
the owner and the owner assistant read and no live report adds into its figures.

| File | What it is |
|---|---|
| `padel-monthly-2026/originals/2026-0N.docx` | The four Word files. Byte-identical to what arrived except one field: `docProps/core.xml` `lastModifiedBy`, an email address, is blanked (personal data stays out of git). |
| `padel-monthly-2026/reports.json` | Their structured form. Every `*_stated` string is copied from the Word XML; every number is the digits of the string it came from; chart text is typed from the chart images. Its `_readme` and `discrepancies` explain the rest. |

Rules the data keeps: a blank table cell is a null count, never zero; where one part of a report
disagrees with another (August's table swaps "cancelled" and "not booked" against its summary and
chart; September's table calls the 61 no-shows "cancelled"), both are stored, each under the label
its own part gives it, and the report's `review_notes_en` / `review_notes_ar` say so. Nothing is
computed: no percentage, total or rate that the report does not write itself.

- `tests/legacy-reports-source.test.ts` proves the JSON against the Word files (no stack needed).
- `scripts/db-legacy-reports.mjs` loads it (`pnpm db:legacy-reports`), then reads every row back
  and fails on any difference. Local by default; production only with `--hosted` and
  `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`, when Majed says so.
- `tests/legacy-reports.test.ts` checks the rows, the owner-only read and the branch guard.

### Go-live order (when Majed says)

1. Push migration 0331 (a push to `main` migrates hosted; the push hold rules apply).
2. Erase the data collected from users and keep the setup: `scripts/wipe-user-data.mjs`
   (`fixtures/wipe-user-data.json` says what is kept and what goes, table by table). Run it on
   hosted as a **dry run** first (`DATABASE_URL=… pnpm db:wipe-user-data --hosted`): it performs
   the whole wipe, checks it, prints every count and every login it keeps, and rolls back. Read
   the kept logins (test staff accounts stay unless removed by hand). Then commit it with
   `--execute`, `WIPE_CONFIRM=<db host>`, `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` (the last
   two empty the avatars and staff-media buckets). Do it while the club is closed: it locks every
   wiped table for its length.
3. Load these reports: `SUPABASE_URL=… SUPABASE_SERVICE_ROLE_KEY=… pnpm db:legacy-reports load --hosted`.
4. After: stock on hand starts at zero (count it); the store-review guest account is gone
   (`scripts/create-review-account.mjs` makes a new one, or keep it with `--keep-email=` in step 2).

## Swap procedure

Same as `../README.md` §"Fixture swap procedure": on staging first, delete fixture rows children
before parents, refuse if any live reservation references a fixture court, run the import, re-run
the suites, then repeat on production. `courts.sql` performs that guard itself.
