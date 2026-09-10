# Ready-to-paste prompts — for the sessions that land the remaining client data

Each block below is a complete prompt for a fresh Claude Code chat, written 2026-08-30 while the
context was hot. Paste the whole block (plus the client's data) when the corresponding answers
arrive. Each prompt assumes the session starts with `/handoff` — keep that line first.

---

## Prompt 1 — when the RATE RULES arrive

```text
/handoff

Touch has finally sent the padel rate rules (pasted below / attached). Derive
packages/db/client-data/rates.sql from them. This unblocks the #1 data blocker: every booking on
the real courts currently fails NO_RATE.

Follow the established pattern exactly:
- Template: packages/db/client-data/courts.sql (header citing the pack/message source, a
  WHAT-THE-CLIENT-SAID table, !!-warnings, begin/commit, idempotent upserts). UUIDs use the
  reserved 70c4 prefix (e.g. 70c40000-0000-4000-8000-00000000a001 for rules).
- Tables: rate_rules (court_id NULL = all courts; days_of_week int[] 0=Sun..6=Sat venue-local;
  start_time/end_time; priority; check start_time < end_time) + rate_rule_prices
  (rule_id, duration_min, price_iqd). See migration 20260824000007_courts_rates.sql.
- MIDNIGHT SPLIT: Touch trades 09:00→02:00. Any price window crossing midnight becomes TWO rows,
  and the post-midnight row carries the FOLLOWING weekday (a slot starting 00:30 Monday is the
  tail of Sunday night). Reference: packages/db/fixtures/courts.sql:50-59 and the HOURS gotcha in
  HANDOFF.md. A wrapping window (21:00→02:00 in one row) is rejected by a CHECK constraint.
- The real courts have duration_options = '{60}', so only duration_min = 60 prices are usable.
  If the client's rules mention 90/120-minute prices, that contradicts the courts table — update
  courts.sql duration_options in the same change and say so. Also check
  docs/client/07-outstanding-2026-08-30.md §1 for the unresolved "court times differ across
  courts" question — if the rules reveal the answer (per-court prices/durations), record it.
- COVERAGE CHECK: after writing the file, verify every open hour of every day (00:00-02:00 and
  09:00-24:00, all 7 days) is covered by at least one rule for each active court. Any gap =
  NO_RATE at that hour. List uncovered windows if any and ask before inventing prices.
- Do NOT deactivate anything beyond what courts.sql already deactivates.

Then: pnpm --filter @touch/db db:client against the local stack, and probe prices via
app.price_slot for a few representative slots (peak, off-peak, the 00:00-02:00 tail on a Friday
night) comparing against the client's stated prices. Also run the @touch/core rateRules parity
check (packages/core) — SQL and TS must agree on every probe.

Update: client-data/README.md ledger, docs/client/07-outstanding (rates row done),
HANDOFF.md (the NO_RATE blocker line + scope ledger "Business data" row), and the memory index.
Commits are authored by Parsa alone — NO AI co-author trailers.
```

---

## Prompt 2 — when the MENU rows / RECIPES arrive

```text
/handoff

Touch has sent menu rows (and/or recipes/sub-recipes/ingredients) from the intake pack (pasted
below / attached). Integrate them as client data.

Menu:
- Target file: packages/db/client-data/menu.sql (auto-loaded by db-client.mjs). UUID prefix 70c4.
- Structure reference: packages/db/seeds/touch-cafe-menu.sql (its 13-category/72-item seed is OUR
  transcription of the design PDF, f1f7-prefixed). The client's rows are the confirmed truth —
  where they conflict with the transcription, the client wins; produce a short diff table
  (item, our price, their price) in the file header for the record.
- Tables: menu_categories, menu_items, menu_item_variants (sizes), and — unlike the seed, which
  deliberately has none — modifier groups/options if the client sent add-ons: see
  packages/db/fixtures/menu.sql for the modifier + reveals shape (depth-1 invariant!) and
  allergen link tables. Photos/sold-out/cost have their OWN RPCs and columns
  (set_item_photo / set_item_sold_out / set_item_cost; costs live in menu_item_costs, never on
  menu_items).
- Tax: all categories point at the Standard 0% group b0000000-0000-4000-8000-000000000001
  (confirmed zero-tax decision).
- Bilingual: paired _en/_ar columns; the pack's Arabic is authoritative — packs in client-data/
  are clean UTF-8 (verified 2026-08-30), read Arabic from the committed pack JSON, not from any
  transcoded copy.

Recipes (if present):
- Target: packages/db/client-data/recipes.sql. Tables: ingredients, sub_recipes + their lines,
  recipe lines per menu item+variant. Check the intake pack's tables section for the exact
  columns the client filled (qty/unit g|ml|pc, pack size, pack cost, supplier, shelf life).
- Recipes are the SOW's #1 risk (item 11) — if only partial data arrived, land what exists and
  list precisely what is still missing per item in docs/client/07-outstanding successor.
- Stock-sorting requirement: check whether the "per Hussain's request" question
  (07-outstanding §2) was answered; if yes, record it in the stock module design notes
  (docs/design/operator-audit-2026-08-28.md §C3 context) before anyone builds the stock UI.

Verify: supabase db reset + db:fixtures + db:client + db:menu ordering still works; the guest
menu renders the client categories in EN and AR locally; pnpm --filter @touch/db test stays
green. Update the ledger/outstanding/HANDOFF/memory as usual. No AI co-author trailers.
```

---

## Prompt 3 — when the STAFF LIST arrives

```text
/handoff

Touch has sent the staff list (names + roles, pasted below). Land it end to end — this also
unblocks re-pointing the Telegram allowlist away from the dev seed staff.

Role mapping (client wording → staff_role enum): till → cashier, kitchen → prep,
manager → manager, admin → owner. court_desk exists too — ask me if anyone is desk-only.
Check docs/client/07-outstanding-2026-08-30.md §2-3: Hussain (stock requester) should appear on
this list with the right role.

Two halves, in order:
1. ACCOUNTS — hosted project accounts are created via the staff-admin edge function
   (packages/db/supabase/functions/staff-admin/index.ts: POST action=create, owner-gated,
   min 10-char passwords, no email invite by design), NOT by SQL insert. PINs only for
   manager/owner (demotion clears them — 0051). Generate per-person initial passwords, hand them
   to me out-of-band (never commit them).
2. RECORD — packages/db/client-data/staff.sql documents the intended list (names, roles, the
   pack citation) for the contractual record, guarded so it never inserts auth users directly.

Then the Telegram allowlist: telegram_staff currently has one row pointing at Dev Owner
(tg 1381081738). Re-point to the real staff in the SAME session. GOTCHA (HANDOFF): 
app.set_telegram_staff cannot be called from the SQL editor (needs an owner JWT) and has no
operator UI — either call it authenticated as the new real owner account, or do the direct
insert and note the missing telegram.staff_set audit row. Get each staff member's tg_user_id
from me. can_void only for manager/owner.

Finally: rotate the seeded dev PINs/passwords on the hosted project (packages/db/README.md
§handover) and verify a real staff login works on the operator app before deactivating any dev
account — never lock the last owner out (LAST_OWNER guard exists, rely on it).
Update ledger/outstanding/HANDOFF/memory. No AI co-author trailers.
```
