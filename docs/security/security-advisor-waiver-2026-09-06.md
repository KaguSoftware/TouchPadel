# Supabase Security Advisor — result and waiver

**Date** 2026-09-06 · **Project** hosted (`lczijabnorujcgmbuqlw`) · **Box** Security Layer 1, Block 3 `[FREEZE]` (SEC-04)

> **Evidence provenance.** The finding list below comes from a **screenshot** of
> dashboard → Advisors → Security, sent by a colleague on 2026-09-06. Nobody who
> signs this ran the advisor themselves, and **the screenshot may have been filtered
> by severity** — see §4, which is the reason this box is not yet ticked in
> `security-layer-1.md`. The per-view analysis in §2 was performed independently
> against the migrations and does not depend on the screenshot.

## Result

**4 findings, all `security_definer_view`, all CRITICAL. All four are accepted by design.**

| View                            | Advisor severity | Disposition         |
| ------------------------------- | ---------------- | ------------------- |
| `public.venue_settings_public`  | CRITICAL         | **Waived** — see §2 |
| `public.court_availability`     | CRITICAL         | **Waived** — see §2 |
| `public.cafe_settings_public`   | CRITICAL         | **Waived** — see §2 |
| `public.menu_item_availability` | CRITICAL         | **Waived** — see §2 |

These are exactly the four named in `AUDITED_OWNER_RIGHTS_VIEWS` in
`packages/db/scripts/check-db-invariants.mjs`, which is written to fail on a **fifth**
owner-rights view.

> ✅ **That gate has now been executed — 2026-09-07.** A container runtime was installed and
> `pnpm --filter @touch/db check:invariants` ran for the first time:
>
> ```
> views          12 total · 8 security_invoker=on · 4 owner-rights
> definer fns    215 total · 215 with a pinned search_path
> PASS
> ```
>
> The four owner-rights views the advisor flagged are **exactly** the four in
> `AUDITED_OWNER_RIGHTS_VIEWS` — no fifth, and no drift between what this waiver covers and
> what the database holds. "A fifth view fails CI" is now a property of a script that runs,
> rather than a claim about one that never had. **This precondition for signing is met.**

## 1 · Why the advisor flags them, and why it is right to

A view without `security_invoker = on` executes with its OWNER's rights, so it reads
straight past the RLS policies of whoever queries it. The advisor cannot know whether
that is deliberate, so it flags all of them at CRITICAL. That is the correct default:
this is the shape a real RLS bypass takes, and the diff that introduces one looks
exactly like the diff that introduces these.

## 2 · Why each is nevertheless correct

All four must be readable **before the caller has any identity** — a guest scanning a
table QR, or anyone opening the booking page. RLS on the base tables is precisely what
would stop the menu and the availability calendar rendering at all.

The security argument is therefore not "RLS protects it" but: **the view's own
projection IS the complete access control for every row it can return.** Verified
2026-09-06 by reading each definition against its base table:

### `court_availability` — the one that matters most

```sql
select court_id, start_at, end_at, kind from reservations
 where status in ('pending','confirmed','arrived')
   and (kind <> 'hold' or hold_expires_at > now());
```

`reservations` carries `guest_id`, `guest_name`, `guest_phone`, `price_iqd`, `notes`,
`device_id`, `created_by_staff_id`. **None is selected.** The view answers "is this
court busy" and cannot answer "who booked it, for how much". Free/busy is the whole
point of a public booking calendar; the identity columns are the thing that had to be
kept out, and they are.

### `cafe_settings_public`

```sql
select key, value from cafe_settings where is_public;
```

A row-level filter, and `is_public` is not guest-writable: the base table is
manager/owner **read-only** under RLS with no client write grant, and every write goes
through `app.set_cafe_settings`, which is in the `guarded` set and is proven to refuse a
guest by `check:authz` on every CI run.

### `venue_settings_public`

`venue_settings` has **18 columns**; the view exposes **10** and withholds **8**. Full
enumeration, because a column projection is only as good as the list you checked it
against — an earlier draft of this section listed seven withheld columns and had missed
`max_live_holds_per_guest`, which is exactly the error this table now prevents:

| Exposed (10)                                                                                                                                                                                  | Withheld (8)                                                                                                                                                                |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `venue_name`, `currency`, `timezone`, `opening_hours`, `closed_dates`, `phone`, `protected_horizon_hours`, `cancellation_window_hours`, `table_token_ttl_minutes`, `max_booking_horizon_days` | `id`, `hold_ttl_seconds`, `heartbeat_stale_seconds`, `waiter_call_cooldown_seconds`, `cash_rounding_iqd`, `expiring_soon_days`, `tax_inclusive`, `max_live_holds_per_guest` |

Sources: `0006` (create table, 15 columns), `0026` (`phone`), `0048`
(`max_live_holds_per_guest`, `max_booking_horizon_days`).

**No column in the table is a credential** — verified against the complete list above,
not a partial one. The withheld eight are operational tuning (rounding, heartbeat
interval, hold limits); `id` is a `boolean primary key` singleton guard. The exposed ten
are what a venue publishes on its own website, and `phone` is the **venue's** number,
not a guest's.

Note that the projection is a genuine decision rather than an accident: `hold_ttl_seconds`
and `max_live_holds_per_guest` are the booking anti-abuse parameters and are deliberately
NOT told to the client, while `max_booking_horizon_days` and `cancellation_window_hours`
are, because the booking UI has to render them.

### `menu_item_availability`

```sql
select item_id, orderable from app.menu_availability();
```

Two columns. Discloses whether an item can be ordered — which is what the menu shows a
guest anyway. No stock levels, no costs, no recipes.

## 3 · What would invalidate this waiver

It is scoped to these four views **as currently defined**. It does not survive:

- a column being **added** to any of the four projections;
- a column being added to `venue_settings` and swept into the view by a future
  `select *` — the table has already grown three columns since `0006`;
- `court_availability` gaining any `reservations` identity or price column;
- a credential column being added to `venue_settings`;
- a **fifth** owner-rights view (CI fails — that is the gate, not this document).

Re-read the definitions when the advisor is next run at freeze.

## 4 · Not present in this run: `extension_in_public`

Security Layer 1 Block 3 expected a **second** finding — `extension_in_public` for
`btree_gist` (`0001:5`). It does not appear.

**Do not record this as fixed.** Two explanations, and they need different responses:

1. **The advisor list was filtered to CRITICAL.** `extension_in_public` is a lower
   severity. Most likely. → Re-run with the severity filter cleared.
2. **The hosted database genuinely differs from the repository.** → That is drift, and
   it is a bigger finding than anything above.

Migration `20260904000069_btree_gist_schema_fix.sql` is idempotent and is a no-op if
`btree_gist` has already been relocated, so it is safe either way.

> ⚠ **Update 2026-09-07 — it was executed for the first time, and it FAILED.** Its post-check
> named `app.reservations`, a relation that does not exist (the table is in `public`), so the
> migration aborted with 42P01 and took the whole stack down with it. Had explanation 1 above
> been acted on by pushing 0069 to the hosted project, it would have failed there in the same
> way. Fixed and re-run clean; `btree_gist` now relocates and the reservations exclusion
> constraint is verified intact afterwards. **This strengthens explanation 1** — the advisor
> list was almost certainly filtered, because 0069 had never successfully run anywhere and so
> could not have fixed `extension_in_public`. Re-run the advisor unfiltered to confirm.

## Sign-off

```
The four security_definer_view findings above are accepted by design, on the basis
that each view's own projection is the complete access control for the rows it returns,
verified against the base tables on 2026-09-06.

DEV ______________________  Date __________
SEC ______________________  Date __________
```
