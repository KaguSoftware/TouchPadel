# Touch Padel — Phase 1 Data Model & Security Plan

Perspective: **data model + security**. All paths are in the planned monorepo at `c:/Users/p.mansouri/Desktop/kagu software/TouchPadel`. All DDL targets Supabase Postgres 15+, schema-first in `packages/db/supabase/migrations/`. All timestamps `timestamptz`, venue timezone `Asia/Baghdad` held in config, business logic in UTC.

---

## 0. Headline decisions (with reasons)

| Decision | Choice | Why |
|---|---|---|
| Bilingual content | **Paired columns `name_en` / `name_ar`** (+ `description_en/_ar`), not jsonb | Contract fixes exactly two locales; columns give `NOT NULL` enforcement per language, appear as typed fields in `supabase gen types` (a missing Arabic string is a compile error, matching the scope's "column change breaks the build"), index/search trivially, and map 1:1 to the side-by-side editor in the desktop app. Kurdish is a change request; if it lands, we add `_ku` columns in one migration — cheaper than migrating everything to jsonb speculatively. Fallback (missing translation → other language) is a 3-line helper in `packages/core/src/i18n/pickLocale.ts`, not a DB concern. |
| Role model | **`staff` table lookup via `SECURITY DEFINER` helper**, not JWT custom claims | Owner edits roles in the desktop app and they take effect on the next statement — no token refresh, no auth-hook admin API. One venue, ~10 staff rows: a `STABLE` function lookup per request is free. Shared-till short sessions make claim-staleness a real hazard. |
| Money | `bigint` whole IQD everywhere (domain `iqd`) | Zero-decimal currency; see §2. |
| Tax | integer basis points per tax group | `0` or `1000` (10%) or anything Touch's accountant decides; no floats. |
| Quantities (stock) | `numeric(12,3)` in base units g / ml / pc | Money is integer; physical quantities are not. |
| Hold expiry | Rows with `hold_expires_at` + lazy expiry inside the booking RPC + `pg_cron` sweeper | The exclusion constraint predicate cannot reference `now()`; see §1.3. |
| Realtime | **Broadcast-from-database** (`realtime.send` in triggers) on private topics; not `postgres_changes` | Topic-level RLS on `realtime.messages` is the only clean way to give an *anonymous* guest session its own order-status stream without granting table reads; also one mechanism serves KDS, guest page, and booking grid. See §1.10. |
| Write path for anything sensitive | **RPC (`SECURITY DEFINER`) only; no direct DML grants** | Prices, stock movements, PIN checks, degraded lockout, rate limits all live in functions in schema `app`; RLS is the backstop, functions are the front door. |

---

## 1. Schema draft

Organization: business tables in `public` (so `gen types` and PostgREST see them), functions + internal helpers in schema `app`, secrets in Supabase `vault`. Enums first.

### 1.0 Extensions and enums

```sql
-- 0001
create extension if not exists btree_gist;
create extension if not exists pgcrypto;      -- crypt() for PINs, gen_random_uuid()
-- pg_cron enabled via Supabase dashboard/config, referenced in 0017

-- 0002
create type staff_role         as enum ('cashier','prep','court_desk','manager','owner');
create type reservation_kind   as enum ('booking','hold','maintenance');
create type reservation_status as enum ('pending','confirmed','arrived','completed','cancelled','no_show','expired');
create type reservation_source as enum ('mobile','desk');
create type tab_status         as enum ('open','awaiting_payment','settled','void');
create type order_source       as enum ('guest_web','till');
create type order_status       as enum ('sent','preparing','ready','served','voided');
create type ticket_status      as enum ('queued','preparing','ready','completed','voided');
create type payment_method     as enum ('cash','card');
create type adjustment_kind    as enum ('discount_percent','discount_amount','price_override');
create type waiter_call_reason as enum ('order','bill','water','assistance');
create type waiter_call_status as enum ('raised','acknowledged','resolved');
create type ingredient_kind    as enum ('purchased','prepared');   -- 'prepared' = sub-recipe output
create type stock_unit         as enum ('g','ml','pc');
create type movement_type      as enum ('goods_in','production_in','sale_consumption','production_consume',
                                        'waste_spill','waste_spoilage','void_after_send','expired_writeoff',
                                        'count_adjustment','refund_reversal');
create type alert_kind         as enum ('negative_stock','low_stock','expiring_soon','replay_conflict');
create type day_status         as enum ('open','closing','closed');

create domain iqd as bigint check (value >= 0);          -- unsigned money
create domain iqd_signed as bigint;                       -- deltas
```

### 1.1 Identity, staff, audit

```sql
create table profiles (                       -- guests; 1:1 with auth.users
  id             uuid primary key references auth.users(id) on delete cascade,
  full_name      text not null,
  phone          text,                        -- captured day one per scope (future SMS identity)
  preferred_lang text not null default 'en' check (preferred_lang in ('en','ar')),
  expo_push_token text,
  created_at     timestamptz not null default now()
);

create table staff (
  id           uuid primary key references auth.users(id) on delete restrict,
  display_name text not null,
  role         staff_role not null,
  pin_hash     text,                          -- crypt(pin, gen_salt('bf')); managers/owners only need one
  is_active    boolean not null default true,
  created_by   uuid references staff(id),
  created_at   timestamptz not null default now()
);

create table audit_log (
  id           bigint generated always as identity primary key,
  at           timestamptz not null default now(),
  actor_id     uuid,                          -- staff or guest auth.uid()
  actor_role   text,
  authorizer_id uuid,                         -- who entered the PIN, when escalated
  action       text not null,                 -- 'discount.apply','reservation.move','stock.adjust',...
  entity       text not null,
  entity_id    text not null,
  before       jsonb,
  after        jsonb,
  reason_code  text,                          -- required for discounts/voids/overrides/adjustments (enforced in RPCs)
  device_id    text
);
-- Append-only enforcement: see §3.4
```

### 1.2 Venue config and tax

```sql
create table venue_settings (                 -- singleton
  id                       boolean primary key default true check (id),
  venue_name               text not null,
  currency                 char(3) not null default 'IQD',
  timezone                 text not null default 'Asia/Baghdad',
  opening_hours            jsonb not null,    -- {"mon":[["09:00","23:00"]],...} — config blob, jsonb OK here
  closed_dates             date[] not null default '{}',
  hold_ttl_seconds         int not null default 300,
  protected_horizon_hours  int not null default 48,      -- degraded-mode lockout window
  heartbeat_stale_seconds  int not null default 45,
  table_token_ttl_minutes  int not null default 90,      -- session inactivity expiry
  waiter_call_cooldown_seconds int not null default 120,
  cancellation_window_hours int not null default 12,
  cash_rounding_iqd        int not null default 250,
  expiring_soon_days       int not null default 3,
  tax_inclusive            boolean not null default false
);

create table tax_groups (
  id       uuid primary key default gen_random_uuid(),
  name_en  text not null, name_ar text not null,
  rate_bp  smallint not null default 0 check (rate_bp between 0 and 10000)  -- 1000 = 10%
);
```

### 1.3 Padel: courts, rates, reservations (the contractual core)

```sql
create table courts (
  id             uuid primary key default gen_random_uuid(),
  name_en        text not null, name_ar text not null,
  description_en text, description_ar text,
  indoor         boolean not null default true,
  photo_path     text,                        -- Supabase Storage key
  duration_options int[] not null default '{60,90,120}',   -- minutes
  sort_order     int not null default 0,
  is_active      boolean not null default true
);

create table rate_rules (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,                   -- 'Weekday off-peak' — internal, staff-facing
  court_id   uuid references courts(id),      -- NULL = all courts
  days_of_week int[] not null,                -- 0=Sun..6=Sat, venue-local
  start_time time not null, end_time time not null,
  priority   int not null default 0,          -- highest priority wins on overlap
  valid_from date, valid_to date,
  is_active  boolean not null default true
);

create table rate_rule_prices (               -- per-duration absolute prices, not multipliers
  rule_id      uuid not null references rate_rules(id) on delete cascade,
  duration_min int not null,
  price_iqd    iqd not null,
  primary key (rule_id, duration_min)
);

create table reservations (
  id             uuid primary key default gen_random_uuid(),
  court_id       uuid not null references courts(id),
  kind           reservation_kind not null,
  status         reservation_status not null default 'pending',
  start_at       timestamptz not null,
  end_at         timestamptz not null,
  period         tstzrange generated always as (tstzrange(start_at, end_at, '[)')) stored,
  guest_id       uuid references profiles(id),
  guest_name     text,                        -- walk-in without account
  guest_phone    text,
  created_by_staff_id uuid references staff(id),
  source         reservation_source not null,
  rate_rule_id   uuid references rate_rules(id),   -- PRICE PROVENANCE
  price_iqd      iqd,                              -- snapshot at confirm; explainable forever
  hold_expires_at timestamptz,                     -- kind='hold' only
  cancelled_at   timestamptz, cancellation_reason text,
  notes          text,
  device_id      text,
  idempotency_key text unique,                     -- degraded-mode replay
  created_at     timestamptz not null default now(),
  check (end_at > start_at),
  check (kind <> 'hold' or hold_expires_at is not null),
  check (kind <> 'booking' or (guest_id is not null or guest_name is not null))
);

-- THE contractual constraint, exactly:
alter table reservations
  add constraint reservations_no_overlap
  exclude using gist (court_id with =, period with &&)
  where (status in ('pending','confirmed','arrived'));
```

Notes:
- `completed`, `cancelled`, `no_show`, `expired` fall out of the predicate: history never blocks resale, a no-show frees the remaining slot the moment it is marked.
- **Hold TTL**: the predicate cannot contain `now()` (not immutable), so an expired-but-not-yet-flipped hold would still block. Three-layer answer:
  1. `app.expire_stale_holds(p_court uuid, p_period tstzrange)` — `update reservations set status='expired' where kind='hold' and status='pending' and hold_expires_at < now() and court_id = p_court and period && p_period;` Called **first inside** `app.hold_slot()` and `app.staff_create_reservation()`, same transaction, so a fresh writer always clears the corpse before inserting.
  2. `pg_cron` job every minute runs the unfiltered sweep so the grid frees proactively and broadcasts the freed slot.
  3. Availability reads filter `(kind <> 'hold' or hold_expires_at > now())`.
- **Hold→booking is an UPDATE in place** (`app.confirm_booking(hold_id, …)` flips `kind='booking', status='confirmed'`, stamps `rate_rule_id` + `price_iqd`), so exclusion protection is continuous — never delete-then-insert.
- Pricing: `app.price_slot(court_id, start_at, duration_min)` resolves the winning `rate_rule` (court-specific beats NULL-court, then `priority`), returns `(rule_id, price_iqd)`; the booking stores both. A historical price is explained by joining `rate_rule_id` even after rates change (rules are soft-retired via `valid_to`/`is_active`, never deleted).

### 1.4 Cafe menu (bilingual, paired columns throughout)

```sql
create table menu_categories (
  id uuid primary key default gen_random_uuid(),
  name_en text not null, name_ar text not null,
  tax_group_id uuid not null references tax_groups(id),
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references menu_categories(id),
  name_en text not null, name_ar text not null,
  description_en text, description_ar text,
  photo_path text,
  is_active boolean not null default true,
  unavailable_on date,          -- staff "86" for today; auto-restores because check is unavailable_on = current_date
  sort_order int not null default 0
);

create table menu_item_variants (          -- sizes; every item has ≥1 (a 'Regular' default)
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references menu_items(id) on delete cascade,
  name_en text not null, name_ar text not null,
  price_iqd iqd not null,                  -- absolute price per size, per scope
  is_default boolean not null default false,
  sort_order int not null default 0
);

create table modifier_groups (
  id uuid primary key default gen_random_uuid(),
  name_en text not null, name_ar text not null,
  min_select int not null default 0,
  max_select int not null default 1
);
create table modifiers (
  id uuid primary key default gen_random_uuid(),
  group_id uuid not null references modifier_groups(id) on delete cascade,
  name_en text not null, name_ar text not null,
  price_delta_iqd iqd not null default 0,
  sort_order int not null default 0,
  is_active boolean not null default true
);
create table menu_item_modifier_groups (
  item_id uuid references menu_items(id) on delete cascade,
  group_id uuid references modifier_groups(id) on delete cascade,
  sort_order int not null default 0,
  primary key (item_id, group_id)
);

create table allergens (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,               -- 'nuts','dairy','gluten','vegan','spicy',...
  label_en text not null, label_ar text not null
);
create table menu_item_allergens (
  item_id uuid references menu_items(id) on delete cascade,
  allergen_id uuid references allergens(id) on delete cascade,
  primary key (item_id, allergen_id)
);

create table addon_suggestions (
  item_id uuid references menu_items(id) on delete cascade,
  suggested_item_id uuid references menu_items(id) on delete cascade,
  sort_order int not null default 0,
  primary key (item_id, suggested_item_id),
  check (item_id <> suggested_item_id)
);
```

Ingredient-out greying is a **view**, not a flag (no sync bug possible):

```sql
create view menu_item_availability as
select mi.id as item_id,
       mi.is_active and coalesce(mi.unavailable_on <> current_date, true)
         and not exists (
           select 1 from app.item_required_ingredients(mi.id) ri   -- expands BOM incl. sub-recipes
           where app.ingredient_on_hand(ri.ingredient_id) <= 0
         ) as orderable
from menu_items mi;
```
`app.ingredient_on_hand(uuid)` = `sum(qty_remaining)` over active batches — cheap at one-venue scale; add a materialized cache only if profiling demands it.

### 1.5 Tables, signed tokens, anonymous sessions

```sql
create table cafe_tables (
  id            uuid primary key default gen_random_uuid(),
  table_number  text not null unique,        -- '9', 'T12', printed on QR
  zone          text,
  capacity      int,
  token_version int not null default 1,      -- ROTATION: bump ⇒ every printed QR for this table dies
  is_active     boolean not null default true
);

create table guest_sessions (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references cafe_tables(id),
  auth_user_id     uuid not null references auth.users(id),  -- Supabase ANONYMOUS sign-in user
  linked_profile_id uuid references profiles(id),            -- optional sign-in attaches account
  created_at       timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at       timestamptz not null,                     -- last_activity + table_token_ttl_minutes
  closed_at        timestamptz
);
create index on guest_sessions (auth_user_id) where closed_at is null;
```

**Token design** (problem #5): the QR encodes `https://<domain>/t/<token>` where `token = base64url(table_id || '.' || version || '.' || hmac_sha256(table_id || '.' || version, secret))`. The HMAC secret lives in Supabase **Vault** (`vault.secrets`, name `table_token_secret`); `app.generate_table_token(table_id)` (owner-only, used by the QR-artwork export in the operator app) and `app.verify_table_token(token)` both read it via `vault.decrypted_secrets` inside `SECURITY DEFINER`. Flow on scan:
1. Web app calls `supabase.auth.signInAnonymously()` (enable in Supabase auth config) → gets a real `auth.uid()`.
2. Calls RPC `app.open_table_session(token)` → verifies HMAC and `version = cafe_tables.token_version`, creates/refreshes `guest_sessions` row bound to `auth.uid()`, returns `session_id`, table number, expiry.
3. Every guest write RPC re-checks `exists(select 1 from guest_sessions where auth_user_id = auth.uid() and closed_at is null and expires_at > now())` and touches `last_activity_at`.

Rotation = `update cafe_tables set token_version = token_version + 1` (owner RPC, audited) + reprint. No token stored in the DB at all — nothing to leak.

### 1.6 Tabs, orders, tickets, payments, adjustments

```sql
create table day_sessions (
  id             uuid primary key default gen_random_uuid(),
  business_date  date not null unique,
  status         day_status not null default 'open',
  opened_at      timestamptz not null default now(),
  opened_by      uuid not null references staff(id),
  opening_float_iqd iqd not null,
  closed_at      timestamptz, closed_by uuid references staff(id),
  cash_expected_iqd iqd, cash_counted_iqd iqd,
  cash_variance_iqd iqd_signed,
  card_expected_iqd iqd, card_terminal_batch_iqd iqd,   -- manual entry from the terminal
  notes text
);

create table tabs (
  id           uuid primary key default gen_random_uuid(),
  day_session_id uuid not null references day_sessions(id),
  status       tab_status not null default 'open',
  table_id     uuid references cafe_tables(id),
  reservation_id uuid references reservations(id),       -- CHARGE CAFE TO COURT BOOKING
  label        text,                                     -- "by name"
  opened_by_staff_id uuid references staff(id),          -- null when guest-web opened it
  merged_into_tab_id uuid references tabs(id),           -- merge tables: donor points at survivor
  subtotal_iqd iqd, tax_iqd iqd, discount_iqd iqd, total_iqd iqd,   -- stamped at settle
  opened_at    timestamptz not null default now(),
  settled_at   timestamptz,
  device_id    text,
  idempotency_key text unique
);

create table orders (
  id            uuid primary key default gen_random_uuid(),
  tab_id        uuid not null references tabs(id),
  source        order_source not null,
  guest_session_id uuid references guest_sessions(id),
  placed_by_staff_id uuid references staff(id),
  status        order_status not null default 'sent',
  placed_at     timestamptz not null default now(),
  device_id     text,
  idempotency_key text unique,
  check ((source='guest_web') = (guest_session_id is not null))
);

create table order_items (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  menu_item_id  uuid not null references menu_items(id),
  variant_id    uuid not null references menu_item_variants(id),
  qty           int not null check (qty > 0),
  unit_price_iqd iqd not null,               -- SNAPSHOT from DB at send time — never client-supplied
  line_total_iqd iqd not null,               -- (unit + modifiers) * qty, computed server-side
  notes         text,
  voided        boolean not null default false,
  void_reason_code text,
  ready_at      timestamptz
);

create table order_item_modifiers (
  order_item_id uuid not null references order_items(id) on delete cascade,
  modifier_id   uuid not null references modifiers(id),
  qty           int not null default 1 check (qty > 0),   -- double shot = qty 2
  price_delta_iqd iqd not null,              -- snapshot
  primary key (order_item_id, modifier_id)
);

create table tickets (                        -- 1:1 with a sent order; the KDS unit of work
  id           uuid primary key default gen_random_uuid(),
  order_id     uuid not null unique references orders(id),
  status       ticket_status not null default 'queued',
  target_seconds int not null default 600,
  created_at   timestamptz not null default now(),
  started_at   timestamptz, ready_at timestamptz, completed_at timestamptz,
  actual_prep_seconds int,                    -- stamped at completion (scope: stored per ticket)
  device_id    text,
  idempotency_key text unique
);

create table tab_adjustments (                -- discounts / price overrides, PIN-gated
  id           uuid primary key default gen_random_uuid(),
  tab_id       uuid not null references tabs(id),
  order_item_id uuid references order_items(id),   -- null = whole-tab discount
  kind         adjustment_kind not null,
  value        int not null,                  -- percent (bp) or amount depending on kind
  amount_iqd   iqd not null,                  -- resolved effect, for day-close summing
  applied_by   uuid not null references staff(id),
  authorized_by uuid not null references staff(id),   -- PIN holder
  reason_code  text not null,
  created_at   timestamptz not null default now()
);

create table payments (
  id           uuid primary key default gen_random_uuid(),
  tab_id       uuid not null references tabs(id),
  day_session_id uuid not null references day_sessions(id),
  method       payment_method not null,
  amount_iqd   iqd not null,
  tendered_iqd iqd,                           -- cash only
  change_iqd   iqd,                           -- cash only; drawer-open record
  recorded_by  uuid not null references staff(id),
  created_at   timestamptz not null default now(),
  device_id    text,
  idempotency_key text unique
);

create table refunds (
  id           uuid primary key default gen_random_uuid(),
  payment_id   uuid not null references payments(id),
  amount_iqd   iqd not null,
  reason_code  text not null,
  refunded_by  uuid not null references staff(id),    -- manager+ enforced in RPC
  created_at   timestamptz not null default now()
);
create table refund_items (                   -- which lines came back → stock reversal
  refund_id uuid references refunds(id) on delete cascade,
  order_item_id uuid references order_items(id),
  qty int not null,
  primary key (refund_id, order_item_id)
);
```

Lifecycle rules (all enforced in `app.*` RPCs + status-transition triggers):
- `send_order` snapshots prices, creates the ticket, and fires stock consumption (§4).
- **Void before send**: item deleted (order still `draft` client-side only — drafts never hit the server; guest basket lives in the browser, till basket in Electron). Void after send: `voided=true`, ticket line struck, stock movement `void_after_send` (waste), audit row — never deleted.
- Day close (`app.close_day`) refuses while `exists(select 1 from tabs where day_session_id=$1 and status='open')` **or** the till reports unsynced queue items (Electron passes its queue depth; server also checks no `sync_replays` in-flight for its devices). Cash expected = float + Σcash payments − Σcash refunds.

### 1.7 Waiter calls (with rate-limit state)

```sql
create table waiter_calls (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references cafe_tables(id),
  guest_session_id uuid not null references guest_sessions(id),
  reason           waiter_call_reason not null,
  status           waiter_call_status not null default 'raised',
  raised_at        timestamptz not null default now(),
  acknowledged_at  timestamptz, acknowledged_by uuid references staff(id),
  resolved_at      timestamptz, resolved_by uuid references staff(id)
);
-- one live call per table — the hard stop:
create unique index waiter_calls_one_open on waiter_calls (table_id) where status = 'raised';
```
Cooldown (soft limit) in `app.raise_waiter_call`: reject if the table's latest call was raised within `waiter_call_cooldown_seconds`. The partial unique index is the race-proof backstop; the RPC turns the constraint violation into a friendly "staff already notified".

### 1.8 Stock: ingredients, recipes/BOM, batches, ledger, counts

```sql
create table ingredients (
  id            uuid primary key default gen_random_uuid(),
  kind          ingredient_kind not null default 'purchased',
  name_en       text not null, name_ar text not null,
  unit          stock_unit not null,                 -- base unit: g / ml / pc
  pack_size     numeric(12,3),                       -- e.g. 1000 (g) per bag
  pack_cost_iqd iqd,                                 -- supplier cost per pack (latest)
  supplier_name text,
  shelf_life_days int,                               -- default expiry at goods-in if none captured
  yield_percent numeric(5,2) not null default 100,   -- usable yield
  waste_allowance_percent numeric(5,2) not null default 0,  -- expected waste, separate from recorded
  par_level     numeric(12,3),
  low_stock_threshold numeric(12,3),
  is_active     boolean not null default true
);

-- One BOM table, three attachment points; CHECK enforces exactly one target.
create table recipe_lines (
  id            uuid primary key default gen_random_uuid(),
  variant_id    uuid references menu_item_variants(id) on delete cascade,  -- per-SIZE quantities, per scope
  modifier_id   uuid references modifiers(id) on delete cascade,           -- modifier-aware consumption
  output_ingredient_id uuid references ingredients(id) on delete cascade,  -- sub-recipe definition (kind='prepared')
  ingredient_id uuid not null references ingredients(id),
  qty           numeric(12,3) not null check (qty > 0),                    -- in ingredient base unit
  check (num_nonnulls(variant_id, modifier_id, output_ingredient_id) = 1)
);

create table deliveries (
  id uuid primary key default gen_random_uuid(),
  received_at timestamptz not null default now(),
  received_by uuid not null references staff(id),
  supplier_name text, notes text
);
create table delivery_lines (
  id uuid primary key default gen_random_uuid(),
  delivery_id uuid not null references deliveries(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  qty_expected numeric(12,3),
  qty_received numeric(12,3) not null,        -- short-delivery capture = expected − received
  unit_cost_iqd numeric(14,4) not null,       -- cost per base unit (fractional dinars OK internally; bills stay integer)
  expiry_date date                            -- captured, else calculated from shelf_life_days
);

create table stock_batches (
  id uuid primary key default gen_random_uuid(),
  ingredient_id uuid not null references ingredients(id),
  delivery_line_id uuid references delivery_lines(id),   -- null for production_in batches
  received_at timestamptz not null default now(),
  expiry_date date,
  qty_received numeric(12,3) not null,
  qty_remaining numeric(12,3) not null,
  unit_cost_iqd numeric(14,4) not null
);
create index stock_batches_fefo on stock_batches (ingredient_id, expiry_date asc nulls last, received_at asc)
  where qty_remaining > 0;

create table stock_movements (                -- APPEND-ONLY LEDGER; the only truth
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  ingredient_id uuid not null references ingredients(id),
  batch_id      uuid references stock_batches(id),   -- null only for negative-stock overdraft lines
  movement_type movement_type not null,
  qty_delta     numeric(12,3) not null,       -- + in, − out; never zero
  unit_cost_iqd numeric(14,4),                -- COGS at the moment of movement
  order_item_id uuid references order_items(id),
  ticket_id     uuid references tickets(id),
  delivery_line_id uuid references delivery_lines(id),
  count_id      uuid,                         -- FK added in counts migration
  refund_id     uuid references refunds(id),
  reason_code   text,
  staff_id      uuid references staff(id),
  device_id     text,
  check (qty_delta <> 0)
);

create table stock_counts (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  counted_by uuid not null references staff(id)
);
create table stock_count_lines (
  count_id uuid not null references stock_counts(id) on delete cascade,
  ingredient_id uuid not null references ingredients(id),
  theoretical_qty numeric(12,3) not null,     -- snapshot at count start
  counted_qty numeric(12,3) not null,
  primary key (count_id, ingredient_id)
);
-- finalize RPC writes one 'count_adjustment' movement per variant line and
-- reconciles batches (oldest-first drawdown / newest batch top-up).

create table manager_alerts (
  id uuid primary key default gen_random_uuid(),
  kind alert_kind not null,
  payload jsonb not null,                     -- {"ingredient_id":..,"shortfall":..} — machine payload, jsonb fine
  created_at timestamptz not null default now(),
  acknowledged_at timestamptz, acknowledged_by uuid references staff(id)
);
```

Derived reporting (views, week-3 track A): `v_ingredient_on_hand`, `v_variance_report` (theoretical vs counted per period with drill-through movement ids), `v_item_cogs` (BOM × latest batch costs, yield-adjusted: `qty / (yield_percent/100)`), `v_item_margin` (price − COGS), `v_expiring_soon` (window from `venue_settings.expiring_soon_days`).

### 1.9 Degraded mode, heartbeat, replay

```sql
create table device_heartbeats (
  device_id    text primary key,              -- 'TILL-01', 'DESK-01', 'KDS-01'
  last_seen_at timestamptz not null default now(),
  app_version  text
);

create table degraded_periods (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  ended_at   timestamptz,
  detected_by text not null default 'heartbeat_timeout'
);

create table sync_replays (                   -- one row per replayed queued write
  id bigint generated always as identity primary key,
  device_id text not null,
  idempotency_key text not null unique,
  entity text not null,                       -- 'order','payment','ticket_status','reservation'
  replayed_at timestamptz not null default now(),
  result text not null check (result in ('applied','duplicate','conflict')),
  conflict_detail jsonb
);
```
`app.is_degraded()` = `not exists(select 1 from device_heartbeats where device_id like 'TILL%' and last_seen_at > now() - make_interval(secs => (select heartbeat_stale_seconds from venue_settings)))`. Every guest-facing write RPC (`hold_slot`, `create_guest_order`, `raise_waiter_call`) checks it **server-side**: reservations only blocked inside `now() + protected_horizon_hours`; cafe ordering blocked outright. A `pg_cron` job opens/closes `degraded_periods` rows on state transitions. Replay: every queued write arrives through the same RPCs with its `device_id` + `idempotency_key`; unique constraints turn re-delivery into `result='duplicate'`; an exclusion-constraint failure on a replayed booking becomes `result='conflict'` + `manager_alerts('replay_conflict')` — exactly the scope's "shows the desk a conflict rather than an overwrite".

### 1.10 Realtime channels

Trigger-driven **broadcast from database** (`realtime.send`) — one migration (`0018`) creates `AFTER INSERT OR UPDATE` triggers:

| Event | Topic | Consumers | Authorization (`realtime.messages` RLS) |
|---|---|---|---|
| ticket insert/status | `kds` | KDS view, till | `app.staff_role() in ('prep','cashier','manager','owner')` |
| order status change | `session:{guest_session_id}` | guest's open page | topic suffix matches a live `guest_sessions` row for `auth.uid()` |
| reservation insert/cancel/expiry | `courts` | mobile grid, desk calendar | any authenticated user (payload is slot-freed/slot-taken only — court id + range, **no guest PII**) |
| waiter call raised/resolved | `floor` | till floor view | staff roles as above |
| menu/availability change | `menu` | website ISR revalidate + clients | public (anon) |

Why not `postgres_changes`: it would require granting anonymous guests SELECT on `orders`/`tickets` broadly enough for the subscription filter, and per-row RLS re-checks per subscriber. Broadcast topics carry exactly the payload we choose, authorized per topic — safer for anonymous sessions and it is the pattern Supabase now recommends. At one venue the volume is trivial either way; this choice is about the security envelope.

---

## 2. Money: integer IQD

- Every money column is `bigint` via domains `iqd` / `iqd_signed`. **No numeric, no floats, no decimals on bills.** Internal unit costs (`unit_cost_iqd numeric(14,4)`) are the one exception — cost *per gram* is fractional; every figure that reaches a bill, a report line, or the day close is rounded to integer dinars at computation time (`round()` half-up, in one place: `packages/core/src/money/`).
- Tax: `tax_iqd = round(subtotal_iqd * rate_bp / 10000.0)` per tax group per tab, half-up, computed once at settle and stamped.
- **Even splits** (`packages/core/src/money/splitEvenly.ts`, mirrored in `app.split_evenly` for server-side settle):
  - `unit = venue_settings.cash_rounding_iqd` (default **250** — smallest note in real circulation).
  - `base = round(total / n / unit) * unit` for shares 1..n−1; **last share = total − base × (n−1)**.
  - Invariant enforced by check + test: `Σ shares === total` exactly, and every share except possibly the last is a multiple of `unit`. Nobody's bill is invented or lost; the residue (< `unit × n`) lands visibly on the last payer's line.
- Split **by item** needs no rounding (line totals are already integers); cash `change_iqd` is exact (change is given from the tendered amount, no cash rounding applied to the bill itself in Phase 1 — the knob exists in `venue_settings` if Touch asks).

---

## 3. RLS strategy

### 3.1 Role resolution

```sql
create schema app;
create or replace function app.staff_role() returns staff_role
language sql stable security definer set search_path = public as $$
  select role from staff where id = auth.uid() and is_active
$$;
create or replace function app.is_staff(variadic roles staff_role[]) returns boolean
language sql stable security definer set search_path = public as $$
  select app.staff_role() = any(roles)
$$;
```
Role hierarchy is expressed at call sites (`app.is_staff('manager','owner')`), not inheritance magic. `revoke execute … from anon` on nothing here — these are safe reads — but every mutating `app.*` RPC gets explicit `revoke all from public; grant execute to authenticated;` (plus `anon` only where guests genuinely call it: `open_table_session` is the single anon-executable function; guest order/waiter RPCs require the anonymous *authenticated* session).

### 3.2 Policy matrix (sketch per table group)

| Table group | anon | guest (authenticated, incl. anonymous-session users) | cashier | prep | court_desk | manager | owner |
|---|---|---|---|---|---|---|---|
| `courts`, `rate_rules(+prices)`, `menu_*`, `allergens`, `tax_groups` | SELECT (active rows) | SELECT | SELECT | SELECT | SELECT | ALL via RPC | ALL via RPC |
| `venue_settings` | SELECT of a **public view** (opening hours, horizon) only | same | SELECT | SELECT | SELECT | UPDATE via RPC | same |
| `profiles` | — | own row (SELECT/UPDATE) | — | — | SELECT (walk-in lookup) | SELECT | SELECT |
| `reservations` | — | SELECT own (`guest_id = auth.uid()`); INSERT/cancel **RPC-only** | — | — | ALL via RPC | ALL via RPC | ALL |
| `guest_sessions` | — | SELECT own (`auth_user_id = auth.uid()`) | SELECT | — | — | SELECT | SELECT |
| `tabs`, `orders`, `order_items(+modifiers)` | — | SELECT rows of own `guest_session_id`; create **RPC-only** | ALL via RPC | SELECT | SELECT | ALL | ALL |
| `tickets` | — | SELECT own order's ticket status (via view) | SELECT/UPDATE-status via RPC | UPDATE status via RPC | — | ALL | ALL |
| `payments`, `refunds`, `tab_adjustments` | — | — | INSERT via RPC (refunds: no) | — | — | ALL via RPC | ALL |
| `waiter_calls` | — | INSERT via RPC + SELECT own | UPDATE ack/resolve via RPC | — | — | same | same |
| stock tables (`ingredients`…`stock_counts`) | — | — | waste-entry RPC only | — | — | ALL via RPC | ALL |
| `stock_movements`, `audit_log`, `sync_replays` | — | — | INSERT via definer RPC only | — | — | SELECT | SELECT |
| `day_sessions` | — | — | SELECT | — | — | open/close via RPC | same |
| `staff` | — | — | SELECT own row | own | own | SELECT all | ALL via RPC |
| `manager_alerts`, `degraded_periods`, `device_heartbeats` | — | — | heartbeat UPSERT (till device runs under a staff session) | — | — | SELECT/ack | same |

"RPC-only" means: **no INSERT/UPDATE policy exists at all** for that role on the base table; the `SECURITY DEFINER` function is the only path, and it validates session, degraded state, price integrity, rate limits, and writes audit rows atomically. RLS SELECT policies remain so Realtime-adjacent reads and the generated types stay honest. This is the single most important security posture in the system: *guests and cashiers can never write a price.*

### 3.3 PIN escalation

```sql
create or replace function app.verify_manager_pin(p_pin text) returns uuid  -- authorizer staff id
language plpgsql security definer as $$
declare v_id uuid;
begin
  select id into v_id from staff
   where role in ('manager','owner') and is_active
     and pin_hash = crypt(p_pin, pin_hash)
   limit 1;
  if v_id is null then raise exception 'PIN_INVALID' using errcode = 'P0001'; end if;
  return v_id;
end $$;
```
Sensitive RPCs — `app.apply_discount`, `app.override_price`, `app.void_after_send`, `app.refund`, `app.adjust_stock`, `app.override_reservation` — take `(…, p_pin text, p_reason_code text)`, call `verify_manager_pin`, record both `applied_by` (the logged-in cashier) and `authorized_by` (the PIN holder) plus the audit row, in one transaction. Rate-limit PIN attempts: an `app.pin_attempts` unlogged table, 5 failures / 5 minutes per device → `PIN_LOCKED`. PINs are 4–6 digits, bcrypt-hashed, set only by owner via `app.set_staff_pin`. Short-lived shared-till sessions are an auth-config + Electron concern (JWT expiry ~12h, till auto-locks to the staff-switch screen after idle), but the *PIN is what authorizes*, so a stale session alone can never discount.

### 3.4 Append-only enforcement (two independent layers)

```sql
-- Layer 1: privileges — nobody can even ask
revoke update, delete on audit_log, stock_movements, sync_replays, payments, refunds from anon, authenticated;
-- Layer 2: trigger — catches table owners / definer bugs / future grant mistakes
create or replace function app.forbid_mutation() returns trigger
language plpgsql as $$ begin raise exception '% is append-only', tg_table_name; end $$;
create trigger audit_log_ao before update or delete on audit_log
  for each statement execute function app.forbid_mutation();
-- same trigger on stock_movements, sync_replays, payments, refunds
```
(`payments` corrections happen via `refunds` rows, never edits.) The security reviewer's checklist item: confirm no policy, grant, or definer function ever issues UPDATE/DELETE against these five tables.

---

## 4. FEFO consumption

```sql
create or replace function app.consume_fefo(
  p_ingredient uuid, p_qty numeric, p_type movement_type,
  p_order_item uuid default null, p_ticket uuid default null,
  p_staff uuid default null, p_device text default null
) returns void language plpgsql security definer as $$
declare v_left numeric := p_qty; v_batch record; v_take numeric;
begin
  for v_batch in
    select id, qty_remaining, unit_cost_iqd
      from stock_batches
     where ingredient_id = p_ingredient and qty_remaining > 0
     order by expiry_date asc nulls last, received_at asc
     for update                                   -- serialize concurrent tickets on the same ingredient
  loop
    exit when v_left <= 0;
    v_take := least(v_left, v_batch.qty_remaining);
    update stock_batches set qty_remaining = qty_remaining - v_take where id = v_batch.id;
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id)
    values (p_ingredient, v_batch.id, p_type, -v_take,
            v_batch.unit_cost_iqd, p_order_item, p_ticket, p_staff, p_device);
    v_left := v_left - v_take;
  end loop;

  if v_left > 0 then                               -- NEGATIVE STOCK: record the truth, alert, never block a sale
    insert into stock_movements (ingredient_id, batch_id, movement_type, qty_delta,
                                 unit_cost_iqd, order_item_id, ticket_id, staff_id, device_id)
    values (p_ingredient, null, p_type, -v_left,
            (select unit_cost_iqd from stock_batches where ingredient_id = p_ingredient
              order by received_at desc limit 1),   -- best-effort COGS
            p_order_item, p_ticket, p_staff, p_device);
    insert into manager_alerts (kind, payload)
    values ('negative_stock', jsonb_build_object('ingredient_id', p_ingredient,
            'shortfall', v_left, 'order_item_id', p_order_item));
  end if;
end $$;
```

Driver: `app.consume_for_order_item(order_item_id)` expands the BOM —
- variant lines + modifier lines (× modifier qty: double shot = 2 × coffee line) × item qty;
- each raw quantity is **yield-adjusted**: `required = qty / (yield_percent / 100.0)`;
- `kind='prepared'` components consume **from their own batches FEFO** (a syrup batch made Tuesday expires before Friday's); they are *not* silently expanded to raws — production is explicit via `app.record_production(prepared_ingredient_id, qty, expiry)` which consumes component raws FEFO (`production_consume`) and creates a `production_in` batch costed at Σ component costs. If a prepared ingredient has no stock, the sale still proceeds → `negative_stock` alert (kitchen made it without booking production — a training signal, not a blocker);
- sub-recipe *definitions* may nest one level (`output_ingredient` lines referencing another prepared ingredient) — expansion in `record_production` uses a recursive CTE with a depth-guard of 3 and a cycle check (constraint trigger at `recipe_lines` insert).
- Reversal: `app.refund` calls the same expansion with positive deltas as `refund_reversal`, restocking into the **newest live batch** (or a zero-cost synthetic batch if none) — pragmatic, documented, and visible in the ledger.
- Expiry write-off: nightly `pg_cron` flags expired batches (`v_expired`); manager confirms via `app.write_off_expired(batch_id, p_pin, reason)` → `expired_writeoff` movement, separated from spillage/spoilage in the variance report exactly as the scope requires.

---

## 5. Migrations, seeds, generated types

### 5.1 Migration files (in `packages/db/supabase/migrations/`, timestamp-prefixed; logical order)

| # | File | Contents |
|---|---|---|
| 1 | `0001_extensions.sql` | `btree_gist`, `pgcrypto`; comment noting pg_cron enabled in config |
| 2 | `0002_enums_domains.sql` | every enum + `iqd` domains (§1.0) |
| 3 | `0003_app_schema.sql` | `create schema app`, `forbid_mutation`, `staff_role`, `is_staff`, grants baseline (`revoke all on schema public from anon` posture, then explicit grants) |
| 4 | `0004_profiles_staff.sql` | `profiles`, `staff`, auth trigger creating profile on signup, `set_staff_pin`, `verify_manager_pin`, `pin_attempts`; RLS |
| 5 | `0005_audit_log.sql` | `audit_log` + append-only layers + `app.write_audit(...)` helper |
| 6 | `0006_settings_tax.sql` | `venue_settings` (+ seed singleton), `tax_groups`, public settings view; RLS |
| 7 | `0007_courts_rates.sql` | `courts`, `rate_rules`, `rate_rule_prices`, `app.price_slot`; RLS |
| 8 | `0008_reservations.sql` | `reservations` + **exclusion constraint**, `expire_stale_holds`, `hold_slot`, `confirm_booking`, `staff_create_reservation`, `move/extend/cancel/mark_*` RPCs (audited), `app.is_degraded` stub check; RLS |
| 9 | `0009_menu.sql` | categories, items, variants, modifier groups/modifiers, allergens, addon suggestions, `menu_item_availability` view; RLS (public read) |
| 10 | `0010_tables_sessions.sql` | `cafe_tables`, `guest_sessions`, Vault secret bootstrap note, `generate_table_token`, `verify_table_token`, `open_table_session`, `rotate_table_token`; RLS |
| 11 | `0011_tabs_orders.sql` | `day_sessions`, `tabs`, `orders`, `order_items(+modifiers)`, `tickets`, `tab_adjustments`, `payments`, `refunds(+items)`; RPCs `open_tab`, `create_guest_order`, `till_add_items`, `send_order`, `ticket_status`, `merge_tabs`, `split_evenly`, `settle_tab`, `apply_discount`, `override_price`, `void_after_send`, `refund`; append-only layers on payments/refunds; RLS |
| 12 | `0012_waiter_calls.sql` | table + partial unique index + `raise_waiter_call`, `ack`, `resolve`; RLS |
| 13 | `0013_stock_core.sql` | `ingredients`, `recipe_lines` (+cycle guard), `deliveries`, `delivery_lines`, `stock_batches` (+FEFO index), `receive_delivery` RPC; RLS |
| 14 | `0014_stock_ledger_fefo.sql` | `stock_movements` (append-only), `consume_fefo`, `consume_for_order_item`, `record_production`, `record_waste`, `write_off_expired`, `manager_alerts`, low-stock trigger; wire `send_order` → consumption |
| 15 | `0015_counts_variance.sql` | `stock_counts(+lines)`, `start_count`, `finalize_count`, views `v_ingredient_on_hand`, `v_variance_report`, `v_item_cogs`, `v_item_margin`, `v_expiring_soon` |
| 16 | `0016_day_close.sql` | `open_day`, `close_day` (open-tab + unsynced-queue guards), day-close summary view (discounts/voids/refunds/waste with authoriser) |
| 17 | `0017_degraded_sync.sql` | `device_heartbeats`, `degraded_periods`, `sync_replays`, `heartbeat` RPC, `is_degraded` real implementation, degraded checks patched into guest RPCs, pg_cron jobs (hold sweep, degraded transitions, expiry flagging, nightly `unavailable_on` no-op check) |
| 18 | `0018_realtime.sql` | broadcast triggers + `realtime.messages` RLS policies per topic (§1.10) |
| 19 | `0019_hardening.sql` | final revoke sweep, `alter default privileges`, function `search_path` audit, `security_invoker` on views, RLS enabled-everywhere assertion (`do $$` block that raises if any public table has RLS off) — **the security reviewer owns this file's checklist** |

Rule: migrations only ever roll forward; local iteration uses `supabase db reset`. Client's future project links via `supabase link --project-ref <ref> && supabase db push` — nothing in any migration references a project ref, storage URL, or environment.

### 5.2 Seed & fixture strategy (no client inputs yet — hard swap points)

- `packages/db/supabase/seed.sql` — **environment-invariant reference data only**: venue_settings singleton (placeholder name), tax_groups (`Standard 0%`, `Restaurant 10%` inactive), allergen list, one owner + one staff account per role (dev password/PIN documented in the file header), device rows.
- `packages/db/fixtures/` — **clearly-marked replaceable business data**, applied only in dev/staging by `pnpm --filter @touchpadel/db run db:fixtures`:
  - `fixtures/courts.sql` — 4 courts (2 indoor / 2 outdoor), EN/AR names, rate rules: weekday off-peak / weekday peak (17:00–23:00) / weekend, prices in round IQD (e.g. 40 000 / 50 000 / 60 000 per hour).
  - `fixtures/menu.sql` — ~30 items across 6 categories (hot drinks, cold drinks, breakfast, mains, desserts, snacks), sizes on drinks, milk/shot/sides modifier groups, addon suggestions, real Arabic strings (not lorem — RTL bugs hide behind fake text).
  - `fixtures/stock.sql` — ~40 ingredients with plausible pack sizes/costs, measured-looking recipes for every fixture menu item, 2 sub-recipes (syrup, sauce), opening deliveries creating batches with staggered expiries.
  - `fixtures/tables.sql` — 12 cafe tables.
- **Hard swap point**: every fixture row carries `-- FIXTURE` header blocks and fixture UUIDs from a reserved prefix (`00000000-f1x7-…`). Swap procedure (documented in `packages/db/README.md`): truncate the fixture domains in dependency order, run the client-data import scripts (`packages/db/scripts/import-menu.ts`, `import-recipes.ts`, `import-courts.ts` — CSV in the exact template shapes issued to Touch in week 1/2), on staging first. Nothing outside these four fixture files may ever reference a fixture UUID.
- **Client-chase (data items only)**: court list/hours/rates/cancellation policy (wk 1 — blocks `fixtures→real` for module 2 testing), currency+tax confirmation (wk 1 — we build IQD-only per decision; a USD answer is a change-request flag immediately), menu with prices/sizes/modifiers (wk 1), table numbering/floor layout (wk 2 — QR artwork), measured recipes + ingredient pack/cost/shelf-life (wk 2 — the single biggest risk, template issued week 1), Supabase account in Touch's name (wk 1), staff list (wk 3). Printer model spec issued to Touch week 1 (80 mm ESC/POS raster-capable, per known-problem #3 — owned by the printing plan, listed here because `venue_settings` needs no schema change either way).

### 5.3 Generated types flow

- `packages/db/package.json` scripts: `db:start` (`supabase start`), `db:reset`, `db:types` = `supabase gen types typescript --local --schema public,app > src/database.types.ts`, `db:fixtures`.
- `packages/db/src/index.ts` re-exports `Database`, typed helpers (`Tables<'reservations'>`, RPC arg types). All three apps depend on `@touchpadel/db`; `packages/core` zod schemas are *hand-written to match* and unit-tested against the generated types with `expectTypeOf` so drift breaks CI.
- Turborepo: `db:types` is an input to every app's `typecheck`; CI job regenerates types and fails on `git diff --exit-code` — a migration merged without regenerated types cannot land.

---

## 6. Test plan (contractual acceptance items)

Tooling: **pgTAP** (via `supabase test db`, files in `packages/db/supabase/tests/*.sql`) for constraint and policy unit tests — fastest feedback, runs in the same transaction; **Vitest + supabase-js** (`packages/db/tests/*.test.ts`) against the local stack for true multi-connection concurrency and end-to-end RLS behavior through PostgREST/GoTrue (pgTAP cannot exercise real parallel sessions or real JWTs). Both wired into `turbo test:db`; CI boots `supabase start` in the runner.

### 6.1 Concurrency suite — booking path (acceptance item)

Vitest, each case with real parallel connections (`Promise.allSettled` over N distinct clients):

1. **N=20 simultaneous `hold_slot`** on the same court/slot → exactly 1 fulfilled, 19 rejected with the mapped `SLOT_TAKEN` error (exclusion violation `23P01`).
   The `23P01` is only guaranteed because writers serialize per court on a transaction advisory lock (`app.lock_court`, 0042): a GiST exclusion check inserts its tuple before scanning the index, so two unserialized overlapping inserters can wait on each other's xid and one dies with `40P01` — which bypasses the `exclusion_violation` handler and never maps to `SLOT_TAKEN`.
2. **Hold vs direct desk booking** race on one slot → exactly one write survives.
3. **Adjacent slots** (`[18:00,19:00)` + `[19:00,20:00)`) → both succeed (half-open range correctness).
4. **Expired-hold race**: create a hold, let TTL pass without the sweeper, fire 10 concurrent `hold_slot` → exactly one succeeds (lazy `expire_stale_holds` inside the RPC works under contention).
5. **Confirm-vs-expire race**: `confirm_booking` and the sweeper hit the same hold simultaneously → the booking either confirms or cleanly fails `HOLD_EXPIRED`; never both, never a lost confirmed booking.
6. **Move/extend overlap**: extend booking A into booking B concurrently with B's creation → one fails.
7. **Maintenance block vs guest booking** race → one write.
8. **Replay idempotency**: submit the same queued order/payment/booking twice with one `idempotency_key` → one row, second returns `duplicate`; replay a booking colliding with an online booking → `conflict` + `manager_alerts` row (degraded acceptance drill, automated).
9. **FEFO under contention**: 10 concurrent tickets consuming one ingredient with 3 batches → `Σ movements = Σ consumed`, no batch below zero, `FOR UPDATE` serialization proven; drive past zero → exactly one `negative_stock` alert per shortfall event.

pgTAP companions: constraint exists and is `USING gist`; predicate excludes each terminal status (insert cancelled over confirmed succeeds); `check` constraints on ranges; `waiter_calls_one_open` uniqueness.

### 6.2 RLS role-matrix tests (module 1 acceptance: "confirmed by a written role test")

Vitest harness `packages/db/tests/rls-matrix.test.ts`: create 8 principals (anon, guest-with-account, anonymous-session guest, cashier, prep, court_desk, manager, owner) via GoTrue, then execute a declarative matrix — `{table/rpc} × {operation} × {principal} → expect allow/deny` — generated from a checked-in `rls-matrix.ts` file that doubles as the *written role test deliverable* (exported to markdown for Mustafa's sign-off). Named critical cases:

- anon reads menu/courts; anon cannot read `reservations`, `tabs`, `stock_*`, `staff`, `audit_log` (expect zero rows, not error — RLS silence).
- anonymous-session guest: can `create_guest_order` for **their own** session's table; cannot for another session id; cannot read another session's orders; cannot call `raise_waiter_call` twice inside cooldown; loses everything after `expires_at`.
- guest cannot INSERT `reservations` directly (no policy) but succeeds via `hold_slot`; cannot set `price_iqd` (not an RPC arg — assert the arg list itself in a type test).
- prep can update ticket status, cannot read `payments` or stock costs.
- cashier can settle a tab; **cannot** apply a discount without a valid manager PIN (wrong PIN → `PIN_INVALID`; 6th wrong PIN → `PIN_LOCKED`); cannot read `staff.pin_hash` (column grant test).
- court_desk full reservation CRUD via RPCs; cannot touch tabs/stock.
- manager everything except staff administration; owner staff CRUD.
- append-only: UPDATE/DELETE on `audit_log`, `stock_movements`, `payments` fails for **every** principal including manager/owner (both the grant layer and, via a definer probe, the trigger layer).
- degraded lockout: with heartbeat stale, `hold_slot` inside horizon → `DEGRADED_LOCKOUT`; outside horizon → succeeds; `create_guest_order` → blocked.
- day close: refuses with an open tab; refuses with pending `sync_replays`.
- pgTAP sweep: every table in `public` has RLS enabled; every `app.*` function has `search_path` pinned; no function is `SECURITY DEFINER` without a `revoke from public`.

Team mapping for this workstream: the user + AI agents own migrations/RPCs/tests (track A); the **security reviewer's standing brief** is §3.4, `0019_hardening.sql`, the RLS matrix file, and the Vault/token design — reviewed at the end of weeks 1, 2 and 3 against the live local stack, not the SQL text alone.

---

### Critical Files for Implementation
- `packages/db/supabase/migrations/0008_reservations.sql` — exclusion constraint, holds, booking RPCs (the contractual core)
- `packages/db/supabase/migrations/0014_stock_ledger_fefo.sql` — append-only ledger + FEFO consumption
- `packages/db/supabase/migrations/0019_hardening.sql` — grants sweep, RLS-everywhere assertion (security reviewer's file)
- `packages/db/tests/concurrency.test.ts` — contractual concurrency acceptance suite
- `packages/db/tests/rls-matrix.test.ts` (+ `rls-matrix.ts`) — role-matrix acceptance deliverable
- `packages/core/src/money/splitEvenly.ts` — integer-IQD split/rounding invariants shared by till and server