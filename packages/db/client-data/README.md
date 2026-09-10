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

## Swap procedure

Same as `../README.md` §"Fixture swap procedure": on staging first, delete fixture rows children
before parents, refuse if any live reservation references a fixture court, run the import, re-run
the suites, then repeat on production. `courts.sql` performs that guard itself.
