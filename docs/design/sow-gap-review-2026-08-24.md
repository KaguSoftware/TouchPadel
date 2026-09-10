Review complete. Findings below, verified against the SOW text (`docs/scope/touch-padel-phase1-scope-of-work.txt`) and every migration, RPC, edge function, test suite, and app surface.

---

## 1. CONTRACT GAPS — no implementation anywhere

| SOW promise | Evidence of absence |
|---|---|
| **Staff accounts created and managed by the owner role** (L233; Owner role L192-193) | No staff-admin RPC exists anywhere (grep `create_staff/upsert_staff/...` = 0 hits). `0004_profiles_staff.sql:161-162` says it "lands with the admin drop" — it never landed. Staff exist only via `packages/db/supabase/seed.sql` direct inserts. Module-1 acceptance can't pass. |
| **Error tracking & uptime monitoring on booking/ordering paths** (L256-257; L609) | Zero Sentry/monitoring code or config in any app or package. |
| **Installable to the home screen** (L596-597) | `apps/web/public/` contains only `brand/`; no manifest.json, no `manifest` in `apps/web/app/[locale]/layout.tsx` metadata. |
| **Print-ready QR artwork per table, in Touch's branding** (L383-384) | `app.generate_table_token` / `app.rotate_table_token` (0014) are never called from any app; no artwork/export pipeline. |
| **Court records configurable** (L299-300) | No `upsert_court` RPC or UI (0007 comment defers it; 0013's "admin drop" delivered rates/hours/menu only). Courts are seed-only; photos never rendered (`apps/mobile/app/(app)/index.tsx:37` is a placeholder). |
| **Opening hours and closed days** enforced on bookings (L319) | `venue_settings.closed_dates` and `opening_hours` are stored/edited (`app.set_opening_hours`) but **no booking write checks them** — `app.hold_slot` (0008:102-191) and `staff_create_reservation` validate only rate-rule existence. |
| **Split a bill by item** (L444) | No by-item split anywhere: server has only `split_evenly` + free-amount `settle_tab`; TillScreen offers cash/card/split-evenly only. |
| **Automated backups with PITR** (L258) | Nothing in repo; HANDOFF.md:122-123 itself flags PITR as an unresolved paid-add-on cost gap. |
| Missing migration **0023** — numbering jumps 0022→0024; confirm nothing was dropped silently. | `packages/db/supabase/migrations/` listing. |

## 2. HALF-TRUTHS — implemented, but diverging from the SOW's words

1. **"Every override written to the audit log with actor and reason"** (L313; L240-243): `move_reservation`, `extend_reservation`, `mark_reservation` (0008:411-415, 459-461, 554-555) write audit **without any reason code** — only cancel takes one. `set_staff_pin` (0004:76-93) writes **no audit row at all** despite the file's own promise (0004:73-74).
2. **"Charge a cafe order to a court booking so a group settles courts and drinks in one payment"** (L445-446, L131): `tabs.reservation_id` exists (0015:47) but (a) `app.compute_tab_totals` (0015:315-358) **never adds the court price** to the bill, and (b) `NewTabDialog` (TillScreen.tsx:612-680) has **no reservation picker** — `p_reservation_id` is never passed. The one-payment promise is unmet end to end.
3. **"Day and week calendar"** (L307): `DeskCalendar.tsx` is day-view only. Also "move, **shorten**, extend" (L310): move keeps the original duration (line 684), extend is hardcoded +30 min — no shorten path in UI.
4. **"Mark item ready … notifying the floor and the guest"** (L460): KDS item-ready marks are **local component state only** (`KdsBoard.tsx:68`, comment line 3) — nothing persisted, nobody notified; only whole-ticket status is real.
5. **Day close "summary of discounts, voids, refunds and waste with the authoriser named"** (L468-469): the DB view `v_day_close_summary` (0020:116-163) delivers exactly this, but `DayClose.tsx` renders only cash/card/variance — the view is queried by **nothing**.
6. **"Signing in is optional and attaches the order to an existing account"** (L387-388): cafe web is anonymous-only; no sign-in surface exists (`CafeApp.tsx`; grep = 0). `guest_sessions.linked_profile_id` can never be set from the web.
7. **"Add-on suggestions attached to an item"** (L366-367): schema + `app.set_addon_suggestions` (0013) exist; **no guest surface queries `addon_suggestions`** (grep across apps = 0).
8. **Mobile degraded message "with the venue's phone number"** (L677-678): `venue_settings_public` (0006:46-55) has no phone column; `availability.tsx:30-31` TODO falls back to the short message.
9. **"Short-lived sessions on shared till machines"** (L237): operator uses a standard persistent Supabase session (`lib/auth.tsx`) — no idle timeout/lock. (PIN for sensitive actions ✓.)
10. **Photographs** (L299, L361): `photo_path` is fetched (`apps/web/src/lib/menu.ts:78`) but never rendered in `CafeMenuRow`/`ItemSheet`/mobile.
11. **Degraded banner + queued count in operator** (L688): nothing in `__root.tsx` renders mode/queue state (bridge mock returns `{depth:0, degraded:false}` — beyond the known shell deferral, no banner UI exists at all).

## 3. WIRING GAPS

**DB done, no surface (all of Module 5's UI):** `apps/operator/src/routes/stock.tsx` is a **placeholder `<h1>`**. Unreachable from any UI: `receive_delivery` (goods-in + short delivery + batch expiry), `record_production`, `record_waste`, `write_off_expired`, `start_count`/`finalize_count`, and every reporting view — `v_variance_report`, `v_ingredient_on_hand`, `v_item_cogs`/`v_item_margin`, `v_expiring_soon`, `v_expired` (0017-0019). Module-5 acceptance (L509-514) is currently undemonstrable except via SQL.
Also surface-less: `app.refund` + `refund_items` (L453 — no refund UI), `app.override_price` (L450-451 — no UI), `app.merge_tabs` (L444 — no UI), **`ack_waiter_call`/`resolve_waiter_call` — no floor view calls them anywhere** (grep = 0; guests poll a call nobody can resolve — breaks Module-3 acceptance L357-358), `manager_alerts` (negative-stock, replay-conflict, expiring-soon — no reader), `audit_log` (no viewer), `sync_replays`/`degraded_periods` (no ops view), table-token generate/rotate (no UI).

**Surface expects DB that isn't there / wrong names (replay edge function, `functions/replay/index.ts`):**
- `'ticket.status'` → RPC `ticket_status` (line 111) — **real name is `set_ticket_status`** → replay of KDS bumps 404s.
- `'payment.record'` → RPC `record_payment` (line 116) — **does not exist** (payments go through `settle_tab`).
- `'stock.waste'`, `'adjustment.apply'` spread `common(c)` → pass `p_idempotency_key` to `record_waste` / `apply_discount` / `override_price`, **which have no such parameter** → PostgREST function-match failure on every replay of waste/discount/override.

## 4. TOP 5 RISKS in what exists

1. **Manager-PIN brute force via device rotation** — `app.verify_manager_pin` (0004:100-131) rate-limits per *client-supplied* `p_device_id`. Any authenticated cashier calls `apply_discount` with a fresh random device id per guess: 5 free guesses per string, unlimited strings → a 4-digit PIN falls in ~2000 calls, yielding manager authority over discounts, voids, price overrides, expired write-offs. Fix: key attempts on `auth.uid()` (or uid+device).
2. **Unsettleable-tab deadlock blocks day close** — sequence: `settle_tab` partial payment (split share), then `void_after_send` (allowed while `awaiting_payment`, 0015:1126) shrinks the total below the amount already paid → next `settle_tab` computes `v_due <= 0` → `ALREADY_PAID` raises, tab never flips to `settled`, `close_day` refuses forever (`DAY_OPEN_TABS`, 0020:51-54). No refund UI exists to unwind it. (0015:864-867 vs 906-914.)
3. **Replay path will fail on first real outage** — the three RPC-name/parameter mismatches in section 3 mean queued KDS bumps, payments, waste and adjustments cannot replay once the Electron shell ships; only reservation mutations were tested. Conflict handling (`isExclusionConflict`) also only covers reservations — a queued order against a since-closed day errors out with no `sync_replays` record.
4. **Degraded detection hinges on an unenforced device-naming convention and has no sender** — `app.is_degraded()` (0021:55-64) counts only `device_id LIKE 'TILL%'`; nothing in the schema or replay contract enforces that name, and no operator code calls `app.heartbeat` yet (only shell stubs). If the shipped shell registers as `DESK-01`/`STATION-1`, the venue is *never* marked degraded and the module-7 double-sell protection (L666-668) silently doesn't exist. Conversely a mis-named KDS device `TILL-02` that stays online masks a real till outage.
5. **Bookings can be created outside trading reality** — no server check of `closed_dates`/`opening_hours` (risk of guest bookings on a closed day whenever a rate rule matches the weekday), and `staff_create_reservation` (0008:323-329) silently stores `price_iqd = NULL` when no rule prices the range — an unpriced booking that no till path can ever charge (the promised "price override RPC … with the till drop" never landed for reservations).

## 5. QUICK WINS (<30 min each)

1. Fix `functions/replay/index.ts` route map: `ticket_status`→`set_ticket_status`, `record_payment`→`settle_tab`, and stop spreading `p_idempotency_key` into `record_waste`/`apply_discount`/`override_price`.
2. Add `p_reason` to `move_reservation`/`extend_reservation`/`mark_reservation` audit calls, and an audit row in `set_staff_pin` (satisfies SOW L240-243/313 verbatim).
3. Floor view: a small waiter-calls panel in TillScreen (`waiter_calls` select where `status != 'resolved'` + Ack/Resolve buttons — RPCs and the `floor` broadcast already exist).
4. Reservation picker in `NewTabDialog` passing `p_reservation_id` (RPC already accepts it) — unblocks half of the charge-to-booking promise.
5. Render `v_day_close_summary` fields (discounts/voids/refunds/waste + `authorizer_names`) in the DayClose success panel.
6. `manifest.json` + metadata link in `apps/web` → home-screen install (L596-597).
7. Add `phone` to `venue_settings` + `venue_settings_public` view → mobile degraded message with venue phone (their own TODO, `availability.tsx:30`).
8. Closed-date/opening-hours guard function called from `hold_slot` and `staff_create_reservation`.
9. Key `app.pin_attempts` on `coalesce(auth.uid()::text,'') || ':' || device` — closes the brute-force hole in one line.
10. Fetch `addon_suggestions` in web `ItemSheet` and render as chips (table, RLS grant and admin editor RPC all exist).

**Coverage that IS solid** (for calibration): reservations exclusion + concurrency suite (9 cases, `tests/concurrency.test.ts`), RLS matrix, PIN lockout fix (0011), snapshot pricing, FEFO + modifier-aware consumption with tests (`cafe-flow.test.ts:216`), degraded server-side lockout + recovery with tests, idempotent RPCs throughout, append-only ledgers with dual guards, push outbox, bilingual `_en/_ar` everywhere with side-by-side editing in MenuEditor, and the signed table-token design.