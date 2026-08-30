# Cross-Plan Review — Touch Padel Phase 1

## 1. Contradictions between plans

**Naming / structure**
- ~~Operator layout: A = two packages (`apps/operator` SPA + `apps/operator-shell` Electron); C = single `apps/operator` with `src/main/queue.ts`.~~ **RESOLVED: layout A shipped** — two packages, the queue at `apps/operator-shell/src/main/queue.ts`, and plain `tsc` rather than electron-vite (noted 2026-08-28).
- Package scope: A `@touch/*` vs B `@touchpadel/*`.
- Staff table: A/C `staff_members` (+ C separate `staff_pins` table) vs B `staff` with `pin_hash` inline.
- Degraded-state table: A `venue_status` (singleton) vs B `device_heartbeats` + computed `is_degraded()` vs C `venue_state`.
- Reservation kinds: B `booking/hold/maintenance` vs C `booking/hold/block`.
- Station IDs: A `TILL1` vs B `TILL-01`; A `{station}-{ulid}` vs C `{deviceId}_{ulid}`.
- Migration files disagree (A `0002_reservations.sql`, B `0008_reservations.sql`, C `0004_reservations.sql`) — C's "Critical Files" cite paths that contradict both A and B.

**Tech choices**
- Table token: A = ES256 JWS, public key verified in Next middleware, binding stamped into anonymous-user `app_metadata` via admin API, no expiry in printed token. B = HMAC-SHA256 with secret in Supabase Vault, verified in RPC, binding in a `guest_sessions` table. C = "JWT, `kid` per table" and SEC Gate 2 reviews token *expiry* (impossible for a printed card, as A notes). Three incompatible designs for the same QR.
- Realtime: B mandates broadcast-from-database everywhere and explicitly rejects `postgres_changes` for guests; C mandates `postgres_changes` on `orders`/`waiter_calls`/`reservations` with broadcast "only for KDS LAN"; A mixes both. B vs C is a direct architectural conflict on the anonymous-guest security envelope.
- PIN verification: A = argon2id hashes cached in till SQLite, verified **locally** (offline-capable) + HMAC `pin_proof`; B = bcrypt via `crypt()` verified **server-side only** in `verify_manager_pin`; C unspecified. B's design cannot authorize a discount/void during an outage — conflicts with M7 "till keeps trading."
- Heartbeat: A 10 s interval / 30 s stale / pg_cron 15 s; B 45 s stale, lazy evaluation; C "≤30 s". 
- Replay: A dedicated `/replay` edge function + `processed_mutations` returning stored results; B per-RPC `idempotency_key` uniques + `sync_replays`; C generic `apply_queued_write` with `on conflict do nothing` — which silently swallows duplicates and can't distinguish duplicate from conflict (contradicts A's result-echo and the SOW's conflict-surfacing, line 656–658).
- LAN KDS: port 47810 + PSK auth + KDS status writes routed through till's queue (A) vs port 8433, no auth, no KDS write path (C).
- Bill split remainder: A largest-remainder; B residue on **last** share in multiples of 250; C remainder on **first** line, rounding applied to payable total with delta on payment row (B says explicitly *no* bill rounding in Phase 1). Three different bills for the same split — the money tests cannot all pass.
- Till auth: A machine signs in as a 6th `station` role; B "till device runs under a staff session." Different RLS models.

**Sequencing**
- Concurrency suite green: A Week 1; C Week 2.
- Operator staffing: A splits desk→FE1, till/KDS→FE2; C gives all operator renderer UI to FE2. FE1's week 3–4 load differs materially between plans.
- Supabase link to client project: A targets week 2–3 ("one-hour operation"); C forbids mid-build linking, handover W5. Opposite policies.
- SQLite queue build: A skeleton W2, replay W3; C entire offline subsystem in W4.

## 2. SOW capabilities missing from ALL three plans

- **Menu/content/rates editor UI in the desktop app** — M1 (line 249–251, "edited side by side in the desktop app"), M3 (line 372), M2 rates/opening-hours config (lines 314–319), and SOW Track D Week 2 itself ("menu and content editor", line 858–860). B grants "ALL via RPC" but no plan schedules a single editor screen: menu CRUD, variant/modifier editing, rate-rule editor, opening-hours/closed-days admin. This is a full feature area with zero budgeted days in any plan.
- **Server-side push delivery + booking reminder scheduler** — M2 line 306 ("confirmation, reminder and cancellation"). B stores `expo_push_token`; A's edge-function list (heartbeat, table-token, replay) has no push sender; nobody plans the outbox, the Expo Push API caller, or the cron that fires *reminders* before a booking. C names it as an FE1 client task only — the backend doesn't exist in any plan.
- **Locale formatting + bidi** — M1 lines 246–248: bidirectional handling of Latin fragments inside Arabic, numeral system (Arabic-Indic vs Western digits), date/time/currency formatting per locale. All three plans say "RTL, logical properties" and stop; no plan decides numerals or bidi isolation — this hits receipts, bills, and the day close.
- **Supabase Storage design** — deliverable line 118 ("database, auth, storage"), court photographs (line 299), menu photos (line 360). No plan defines buckets, storage RLS, upload UI in the operator, or image sizing ("images optimised and served at device size", line 598–599).
- **Add-on suggestions in the basket** — M3 line 366. B has the `addon_suggestions` table; no plan schedules the web upsell UI.
- **Merge tables UI** — M4 line 444. B has the RPC; C's exhaustive till task list omits it; A never mentions it.
- **Week calendar view** — M2 line 307 ("Day and week calendar across all courts"). All plans build a day grid only.
- **Availability generation logic** — opening hours × closed dates × per-court duration options → slot grid (lines 297, 302, 319). B stores `opening_hours` jsonb and never references it again; no plan owns the algorithm that produces the bookable grid.
- **Waste allowance applied in variance** — M5 line 518 ("held separately from recorded waste"). B stores the column; no plan's variance report uses it.
- **Website → store links** — M6 line 605. Absent from all three (trivial, but contractual).

## 3. Out-of-scope additions (gold-plating)

- **A: cash-drawer kick pulse (`ESC p`)** — explicitly excluded, M4 line 474–475 ("integrated or automated cash drawer hardware control"). A even quotes the exclusion and adds it anyway.
- **A: per-staff rotated HMAC secrets + `pin_proof` + `station` machine accounts** — SOW asks for "a PIN for sensitive actions" (line 237–238). A builds a key-distribution/rotation system on top. It's the only offline-capable design, but the proof machinery is unbudgeted crypto plumbing.
- **A: full auto-update stack** (electron-updater channels, 03:00–06:00 install windows, Task Scheduler watchdog). SOW requires a deployment pipeline, not fleet auto-update for two machines in one venue; a runbook reinstall covers Phase 1.
- **B: depth-3 recursive sub-recipe nesting with cycle-detection triggers** — SOW's sub-recipe is one level ("a syrup or sauce batch… consumed by many products", lines 519–520).
- **A/B/C: cash rounding to 250 IQD with reconciliation lines** — nowhere in the SOW; each plan invents a different version (see contradiction above). Cut it or agree one rule in one hour.

(Justified addition worth keeping, not cutting: C's in-app account deletion — not in the SOW but Apple-mandated for submission; flag as unbudgeted-but-required.)

## 4. Five most dangerous underestimates

1. **Offline read side.** All three plans engineer the *write* queue superbly and the *read* path not at all. M7 (lines 671–675) requires the till to keep trading from cached data: the calendar, open tabs, and ticket list must render from `ref_cache` **plus an overlay of un-acked queued mutations** (read-your-writes: a queued order must appear on its tab; a queued desk booking must occupy its slot). That local merge layer is roughly as large as the queue itself and appears in no plan.
2. **Week-4 pileup.** C's Week 4 contains: entire offline subsystem, LAN KDS, all stock UI, day-close UI, kiosk hardening, load test, AND store submission — with stock (which the SOW calls "the largest module," line 926) and offline (which the SOW flags as deferrable precisely because it's big) stacked on the same two people. One slip and the review buffer becomes build time, which the SOW explicitly forbids (lines 896–903).
3. **Operator app surface area.** Till + KDS + desk calendar + stock + day close + PIN overlays + replay-conflict resolution UI + the entirely unplanned menu/rates editors (gap #1) — carried by fractions of two FE devs who also own the mobile app and the website. The SOW's Track D assumed a dedicated lane; the remap halves it without shrinking the surface.
4. **Sensitive actions during an outage.** B's server-only PIN check makes discounts/voids impossible while degraded; A's fix works but costs unbudgeted key-rotation machinery; C never addresses it. The contractual disconnection drill (C §5.2 step 4 takes orders "incl. modifiers" but never attempts a PIN action offline) would pass while the requirement fails.
5. **Client Supabase handover.** A calls `supabase link && db push` "a one-hour operation." Reality: JWT secret rotation kills every printed QR and every session (C catches this), storage object migration, edge-function secrets, SMTP config, pg_cron re-creation, and PITR is a paid add-on Touch must fund (SOW line 258 promises PITR; line 771 quotes "from $25/mo," which doesn't include it — **resolved 2026-08-30: owner declined PITR, daily backups only; deviation recorded and acknowledgment requested in `docs/client/07-outstanding-2026-08-30.md`**). This lands in W5 on top of store-rejection fixes.

### Critical Files for Implementation
- `docs/scope/touch-padel-phase1-scope-of-work.txt` (governing scope; all citations above). This
  line used to point at a temp scratchpad from the session that wrote it — a path that no longer
  exists on any machine.
- packages/db/supabase/migrations/*_reservations.sql (unify A/B/C naming, exclusion constraint, hold TTL)
- `apps/operator-shell/src/main/queue.ts` — location resolved (layout A). The read overlay is
  still unbuilt, and so is everything else past storage: see
  `docs/design/operator-audit-2026-08-28.md` C2.
- packages/core/src/money/splitEvenly.ts (pick ONE remainder/rounding rule before any till code)
- apps/operator/src/features/admin/ (the unplanned menu/rates/content editor — biggest missing work item)