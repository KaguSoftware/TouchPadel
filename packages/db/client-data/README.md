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

`pnpm db:client` is **deliberately not** part of `db:fixtures`. As of the 2026-08-29 pack Touch has
sent **courts but no rate rules**, so the real courts price as `NO_RATE` and nothing can be booked
on them. Until rates arrive, the `f1f7` fixtures remain the dev and test default — they are the only
coherent, fully-priced dataset in the repo.

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

> **The 2026-08-29 pack file is not yet in this directory.** It reached the build through a
> transcoded copy in which every Arabic string was mojibake'd (UTF-8 read as Latin-1, lossily), so
> re-serialising it here would have committed corrupted Arabic as the contractual record. Export it
> again from Kagu OS and drop the original in, then check the reconstructed Arabic in `courts.sql`
> against it.

## Swap procedure

Same as `../README.md` §"Fixture swap procedure": on staging first, delete fixture rows children
before parents, refuse if any live reservation references a fixture court, run the import, re-run
the suites, then repeat on production. `courts.sql` performs that guard itself.
