# Supabase Security Advisor — result and waiver

**Date** 2026-09-06 · **Project** hosted (`lczijabnorujcgmbuqlw`) · **Source** dashboard → Advisors → Security
**Box** Security Layer 1, Block 3 `[FREEZE]` (SEC-04)

## Result

**4 findings, all `security_definer_view`, all CRITICAL. All four are accepted by design.**

| View | Advisor severity | Disposition |
|---|---|---|
| `public.venue_settings_public` | CRITICAL | **Waived** — see §2 |
| `public.court_availability` | CRITICAL | **Waived** — see §2 |
| `public.cafe_settings_public` | CRITICAL | **Waived** — see §2 |
| `public.menu_item_availability` | CRITICAL | **Waived** — see §2 |

These are exactly the four named in `AUDITED_OWNER_RIGHTS_VIEWS` in
`packages/db/scripts/check-db-invariants.mjs`. A **fifth** owner-rights view fails CI.

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
Ten named columns. Withheld: `cash_rounding_iqd`, `hold_ttl_seconds`,
`expiring_soon_days`, `heartbeat_stale_seconds`, `waiter_call_cooldown_seconds`,
`tax_inclusive`, `id`. **`venue_settings` contains no credential of any kind** — the
withheld columns are operational tuning, not secrets. The exposed set (name, hours,
timezone, currency, phone, cancellation window) is what a venue publishes on its own
website.

### `menu_item_availability`
```sql
select item_id, orderable from app.menu_availability();
```
Two columns. Discloses whether an item can be ordered — which is what the menu shows a
guest anyway. No stock levels, no costs, no recipes.

## 3 · What would invalidate this waiver

It is scoped to these four views **as currently defined**. It does not survive:

- a column being **added** to any of the four projections;
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
`btree_gist` has already been relocated, so it is safe either way — but it has **not
been executed anywhere yet** (no local stack was available when it was written).

## Sign-off

```
The four security_definer_view findings above are accepted by design, on the basis
that each view's own projection is the complete access control for the rows it returns,
verified against the base tables on 2026-09-06.

DEV ______________________  Date __________
SEC ______________________  Date __________
```
