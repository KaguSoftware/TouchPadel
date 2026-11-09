# Brooks-Lint whole-system audit — 2026-11-07

**Mode:** Tech Debt Assessment (brooks-lint, github.com/hyhmrright/brooks-lint) · read-only · 8 lanes
**Scope:** apps/{operator,operator-shell,mobile,web}, packages/{core,ui,court3d,config,i18n,db} (~950k lines; applied migrations assessed by latest body only)
**Composite Health Score:** 40/100 (mean of lanes, balanced preset)

The code inside each feature is mostly tidy and copy-paste is low (0.42%, jscpd). The decay sits
*between* modules: the same business decision is made by hand in many places, and those copies have
already drifted into real bugs. `packages/core` is the source of truth for money and pricing only.

| Lane | Score | Critical | Warning | Suggestion | Report |
|---|---|---|---|---|---|
| Operator core (routes, kit, lib, Electron shell) | 47 | 0 | 9 | 8 | operator-core.md |
| Mobile screens (app/**, staff) | 46 | 0 | 9 | 9 | mobile-screens.md |
| Shared packages + web | 45 | 0 | 9 | 10 | shared-and-web.md |
| Operator features (coaching, protocols, matches…) | 42 | 0 | 10 | 8 | operator-features.md |
| Operator money (till, desk, shop, stock, safe…) | 41 | 0 | 10 | 9 | operator-money.md |
| Operator management (admin, analytics, reports…) | 37 | 0 | 11 | 8 | operator-management.md |
| Mobile core (features, components, lib) | 32 | 0 | 12 | 8 | mobile-core.md |
| DB (scripts, edge functions, schema state) | 26 | 1 | 11 | 4 | db.md |
| **Total** | **40** | **1** | **81** | **64** | + cross-cutting.md (jscpd, knip) |

## Verified bugs (re-checked against the code after the lanes reported)

1. **Critical — second job bypasses shop-only limits in 7 RPCs.** Since 0345 `app.is_staff` counts
   `extra_roles`, but `upsert_menu_item`, `upsert_variant` (0246) and `receive_delivery`, `start_count`,
   `record_waste`, `finalize_count`, `discard_count` (0245; still the latest bodies) apply the shop limit
   with `app.staff_role() = 'shop_staff'` (main role only). A cashier/barista/etc. with shop_staff as a
   second job gets manager-level menu edits and café/bakery counts and waste. 87 other bodies read
   `staff_role()` and are unchecked.
2. **Shop till part payments always refused.** `ShopTill.tsx:333` sends the amount still owed as
   `expectedTotalIqd`; `settle_tab` (0281:916) compares it with the full total → `TOTAL_CHANGED`.
3. **Owner assistant chats persisted to the phone's plaintext cache.** `apps/mobile/src/lib/queryClient.ts:336`
   deny-list lacks `'assistant'`.
4. **Arabic-Indic digits stripped to 0** in money inputs: `DayClose.tsx:537`, `PromotionEditor.tsx:516`,
   till `PaymentPane.tsx:128`, `ManagerActions.tsx:243,281,393` (`/\D/g` instead of `digitsOnly`/`asciiDigits`).
5. **Phone staff pages read the main role only** while the gate admits second jobs: `staff-purchase.tsx:48`,
   `content/logic.ts:33`, `staff-start.tsx:625` (42 `staff.role` reads in total).
6. **Refusal notice names the wrong role:** `ROLE_ORDER` (`routes/__root.tsx:2045`) omits `shop_staff`, `dev`.
7. **web ships operator strings:** one 1.66 MB chunk (484 KB gz) of the whole i18n catalog on every public route.

Reported by lanes, not re-verified by me: `protocols/formModel.ts:238` uses the station time zone;
phone reads tournament `class` not `classes` (0359); Safe/Shift forms reuse retry keys across corrected
amounts; the migration gate's dollar-tag regex misses digit tags (`check-migrations.mjs:509`);
`packages/db/CLAUDE.md` latest-body pointers are stale; coach vs guest "trading night" rules differ.

## Systemic patterns (where the spaghetti actually is)

- **Roles/permissions are hand-copied everywhere** — 8 operator tables, ~25 phone lists, 29 literal role
  sets across 448 SQL bodies, "management = owner|manager" declared 10+ times. Second jobs (0345) exposed it.
- **Business day / venue timezone** decided 4 ways in SQL, 13+ ways in apps, 11 `'Asia/Baghdad'` literals.
- **Shared code living inside features** (`ops/OpsVisuals` 50 importers, `deductions/venueDate`,
  `roleExtras` readers, `protocols/errors`, `coaching/lessonPayloads`) → 21 operator features in one import
  cycle; 43 two-way module pairs in mobile; no boundary lint.
- **Adding one page/query family = hand-editing 5–12 files** (operator route registry; mobile query-key defaults).
- **Small helpers re-written 10–70×** — payload readers `num/str` (67, disagreeing on null vs 0), bilingual
  name pick (~30), digit conversion (5), retry-key binding (3 forms).
- **God components** — `routes/__root.tsx` 2,093, `kit.tsx` 2,532 (278 importers), `DeskCalendar` 1,332,
  `TournamentStartSheet` 1,373, `DayClose` 1,328, `MarketingPanel` 1,303, `assistant-chat` edge fn 1,701.
- **Core exists but is bypassed** — status machines, `calcTaxIqd`, `splitByItems`, `pickBestPromotion`
  have no production consumer; apps redeclare statuses and bill maths.

## Looks bad but is fine
core↔edge insights copies (header-documented, parity-tested); Court3D/booking sheet size (deliberate perf
work); CoachEditor size (split by section on purpose); server-side `price_slot`/`split_evenly`; Safe going
negative while wages block (Majed's 0387 decisions). Each lane report lists more.
