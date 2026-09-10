# UpperDeck reference spec (extracted 2026-08-25 from github.com/KaguSoftware/UpperDeck @ b7416e9)

Part A — backend

# UpperDeck — Backend Functional Spec

Repo root (all paths below are relative to it):
`<upperdeck-clone>`

Stack: Next.js 16 (app router, `proxy.ts` instead of `middleware.ts`), React 19, Supabase (Postgres + Auth + Realtime + Storage + Edge Functions), Telegram Bot API, Zod v4, PostHog, Groq (analytics LLM). No `.github/`, no `vercel.json`, no test/lint scripts. Scripts are only `dev`, `build`, `start` (`package.json`).

---

## 0. Five things that will bite you when porting (read first)

1. **`settings` table has NO migration.** It's used everywhere (`hero_*`, `waiter_disabled_tables`, `analytics_*`) but was created out-of-band in the Supabase dashboard. Inferred DDL: `settings(key text primary key, value text)` — every read is `.select("key, value").eq("key", …)` and every write is `.upsert({key, value}, { onConflict: "key" })`. It's not in `src\types\database.ts`, hence the `as any` casts at `src\lib\settings\queries.ts:9`, `src\app\(dashboard)\admin\settings\actions.ts:52`.
2. **`submitOrder` is dead in the UI.** `src\lib\orders\submit.ts` is only referenced by `src\app\api\diag\route.ts`. The live cart button calls `callWaiter(table, "order")` (`src\components\PhoneMenu\components.tsx:243`). So in production, `orders` rows are (currently) only created by the diag route / SQL. The whole order pipeline exists and works, it's just unwired from the cart.
3. **`/admin/orders` route does not exist.** Only `_client.tsx` and `loading.tsx` live in `src\app\(dashboard)\admin\orders\`; there is no `page.tsx`. `OrdersClient` is never imported anywhere. The Telegram "📋 Open" button links to `/admin/orders/{id}` which 404s.
4. **`OrdersClient` status buttons are optimistic-only** — `handleStatusChange` (`src\app\(dashboard)\admin\orders\_client.tsx:316`) mutates local state and never writes to Supabase. Only Telegram callbacks actually change `orders.status`.
5. **There is no per-waiter Telegram registration.** No `/start` deep link, no `chat_id` table. One `TELEGRAM_CHAT_ID` env var = one staff group. Details in §5.

---

## 1. DATABASE

Migrations in `supabase\migrations\`, applied in filename order.

### 1.1 `20260426000000_init.sql`

Extension `pgcrypto`. Enum:
```sql
create type public.user_role as enum ('admin', 'owner');
```

```sql
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role public.user_role not null default 'owner',   -- later changed to 'admin'
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name_en text not null,
  name_tr text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index categories_sort_idx on public.categories (sort_order);

create table if not exists public.menu_items (
  id uuid primary key default gen_random_uuid(),
  category_id uuid not null references public.categories(id) on delete restrict,
  name_en text not null, name_tr text not null,
  desc_en text not null default '', desc_tr text not null default '',
  emoji text not null default '🍽️',
  price numeric(10,2) not null check (price >= 0),
  spicy boolean not null default false,
  is_available boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
create index menu_items_category_idx on public.menu_items (category_id);
create index menu_items_available_idx on public.menu_items (is_available) where is_available;
```

Functions/triggers (init:56–93):
- `public.touch_updated_at()` — BEFORE UPDATE trigger, sets `new.updated_at = now()`. Attached as `profiles_touch`, `categories_touch`, `menu_items_touch` (and later to every new table).
- `public.handle_new_user()` — `security definer`, AFTER INSERT on `auth.users` (trigger `on_auth_user_created`); inserts a `profiles` row with `display_name = coalesce(raw_user_meta_data->>'display_name', split_part(email,'@',1))`.
- `public.current_role() returns public.user_role` — `stable security definer set search_path = public`, body `select role from public.profiles where id = auth.uid()`. **This is the single helper every RLS policy calls.**

RLS (init:95–131):

| Policy | Table | Cmd | Rule |
|---|---|---|---|
| `profiles_self_read` | profiles | SELECT | `auth.uid() = id or current_role() = 'admin'` |
| `profiles_self_update` | profiles | UPDATE | `using auth.uid() = id`, `with check auth.uid() = id and role = (select role from profiles where id = auth.uid())` — i.e. you can't self-promote |
| `profiles_admin_update` | profiles | UPDATE | `current_role() = 'admin'` |
| `categories_public_read` | categories | SELECT | `true` — **anon reads all categories** |
| `categories_staff_write` | categories | ALL | `current_role() in ('admin','owner')` |
| `menu_items_public_read` | menu_items | SELECT | `is_available or current_role() in ('admin','owner')` |
| `menu_items_staff_write` | menu_items | ALL | `current_role() in ('admin','owner')` |

Seeds 13 top-level categories (breakfast … cold-drinks) with `sort_order` 10..130.

### 1.2 `20260427000001_menu_image.sql`
Adds `menu_items.image_url text`; drops `emoji` (re-added in the next migration). Creates public Storage bucket:
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-images','menu-images', true, 5242880,
        array['image/jpeg','image/png','image/webp','image/gif']);
```
Storage policies on `storage.objects`: `menu_images_public_read` (SELECT where `bucket_id='menu-images'`), `menu_images_staff_write` (ALL, `bucket_id='menu-images' and current_role() in ('admin','owner')`).

### 1.3 `20260427000002_seed_menu_items.sql`
Re-adds `menu_items.emoji text not null default '🍽️'` (both emoji and image_url are kept; emoji is the placeholder). Then a big `do $$ … $$` block that resolves category slugs to ids and inserts the whole Upperdeck diner menu.

### 1.4 `20260427000003_highlight.sql`
```sql
alter table public.menu_items
  add column if not exists highlight text
  check (highlight in ('green-fill','orange-fill')) default null;
```

### 1.5 `20260427000004_hook_desc.sql`
Renames `desc_en/desc_tr` → `hook_en/hook_tr` (short 3-word card flavour, e.g. `'smoky · rich · savory'`), then adds fresh `desc_en/desc_tr text not null default ''` for the long modal copy. Rest of the file is bilingual `UPDATE … WHERE name_en = …` seeds.

### 1.6 `20260429000000_orders.sql`

```sql
create table if not exists public.orders (
  id           uuid primary key default gen_random_uuid(),
  table_number int not null check (table_number between 1 and 999),
  items        jsonb not null,
  total        numeric(10,2) not null check (total >= 0),
  status       text not null default 'new'
                 check (status in ('new','seen','preparing','served','cancelled')),
  note         text not null default '',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  seen_at      timestamptz,
  served_at    timestamptz
);
create index orders_status_created_idx on public.orders (status, created_at desc);
create index orders_created_idx        on public.orders (created_at desc);
```

Trigger `orders_touch` (touch_updated_at) plus:
```sql
create or replace function public.touch_status_timestamps()
returns trigger language plpgsql as $$
begin
  if old.status = 'new' and new.status <> 'new' and new.seen_at is null then
    new.seen_at = now();
  end if;
  if new.status = 'served' and new.served_at is null then
    new.served_at = now();
  end if;
  return new;
end $$;
create trigger orders_status_timestamps before update on public.orders
  for each row execute function public.touch_status_timestamps();
```

RLS — **the anon-guest surface**:
```sql
create policy "orders_public_insert" on public.orders
  for insert with check (
    jsonb_array_length(items) > 0 and total > 0 and table_number between 1 and 999
  );
create policy "orders_staff_read"   on public.orders for select using (current_role() in ('admin','owner'));
create policy "orders_staff_update" on public.orders for update using (…) with check (…);
```
Note there is **no `to` clause**, so the insert policy applies to every role including `anon`. There is no public SELECT — a guest can insert an order but can never read one back.

Realtime: `alter publication supabase_realtime add table public.orders;` (guarded by `exception when duplicate_object`).

### 1.7 `20260429000001_order_webhook.sql` — the DB webhook (informational only)

The file contains **no executable DDL**; everything is commented. Two documented methods:

- **Method A (recommended, what's actually used):** Supabase Dashboard → Database → Webhooks → new hook, Name `order-notify`, Table `public.orders`, Events **INSERT only**, Type "Supabase Edge Functions", Function `order-notify`, Method POST, query param `secret = <WEBHOOK_SECRET>`. Resulting call: `https://<project-ref>.functions.supabase.co/order-notify?secret=<WEBHOOK_SECRET>`.
- **Method B (commented-out alternative):** `create extension pg_net`, then a `security definer` trigger function `public.notify_order_insert()` that builds
  `jsonb_build_object('type','INSERT','table','orders','schema','public','record',row_to_json(new)::jsonb,'old_record',null)`
  and `perform net.http_post(url := …, body := _body::text, headers := '{"Content-Type":"application/json"}')`, attached as `orders_notify_insert AFTER INSERT ON public.orders FOR EACH ROW`.

**There are no other database webhooks and no RPC functions anywhere in the repo.** `grep "\.rpc("` across `src/`, `scripts/`, `supabase/` returns nothing. The only Postgres functions are `touch_updated_at`, `handle_new_user`, `current_role`, `touch_status_timestamps` (+ the commented `notify_order_insert`). `scripts\_check-policies.mjs` calls an `exec_sql` RPC that does not exist in this repo.

### 1.8 `20260430000000_orders_allow_unknown_table.sql`
Widens the constraint to `check (table_number between 0 and 999)` and re-creates `orders_public_insert` with the same range. `0` = "guest never scanned a QR". Purpose per its header comment: order submission was failing when the diner hadn't scanned.

### 1.9 `20260430000001_role_hierarchy_fix.sql` — role hierarchy inversion
Comment block is the authority:
> `owner` = restaurant owner, full control (users, roles, everything)
> `admin` = manager/head staff, manages menu/categories/settings/orders, **cannot manage users**

Enum values unchanged. `profiles.role` default changed `'owner'` → `'admin'`, and `handle_new_user()` rewritten to insert `role = 'admin'` explicitly. So **new signups/invitees land as `admin` (the lower role)**.

### 1.10 `20260505000000_sold_out.sql`
`alter table public.menu_items add column if not exists sold_out boolean not null default false;` (separate from `is_available`: `sold_out` items are still rendered, just marked).

### 1.11 `20260505000001_addon_groups.sql` — addon modelling (v1)

```sql
create table if not exists public.addon_groups (
  id           uuid primary key default gen_random_uuid(),
  category_id  uuid references public.categories(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  label_en     text not null,
  label_tr     text not null,
  multi        boolean not null default false,
  sort_order   integer not null default 0,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint addon_groups_one_owner check (
    (category_id is not null)::int + (menu_item_id is not null)::int = 1
  )
);

create table if not exists public.addon_options (
  id             uuid primary key default gen_random_uuid(),
  addon_group_id uuid not null references public.addon_groups(id) on delete cascade,
  label_en       text not null,
  label_tr       text not null,
  price          numeric(10,2) not null default 0 check (price >= 0),
  sort_order     integer not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```
Indexes on `category_id`, `menu_item_id`, `addon_group_id`. `touch_updated_at` triggers on both. RLS: `public read addon_groups` / `public read addon_options` = `for select using (true)` (**anon reads all addons**); `staff write …` = `current_role() in ('admin','owner')`.

- `multi` = checkbox group (pick many) vs radio (pick one).

### 1.12 `20260507000000_addon_option_item_ref.sql` — `item_ref`
```sql
alter table public.addon_options
  add column if not exists menu_item_id uuid references public.menu_items(id) on delete set null;
create index addon_options_item_idx on public.addon_options (menu_item_id);
```
Purpose (header comment): "Allow addon_options to reference a menu_item for image/emoji display". Consumed at `src\lib\menu\queries.ts:128` via the embedded `menu_items(image_url, emoji)` join — the option inherits the referenced item's picture/emoji. It does **not** affect pricing.

### 1.13 `20260507000001_newsletter.sql`
```sql
create table if not exists public.newsletter (
  id         uuid primary key default gen_random_uuid(),
  email      text not null,
  created_at timestamptz not null default now(),
  constraint newsletter_email_unique unique (email)
);
alter table public.newsletter enable row level security;
create policy "insert_newsletter" on public.newsletter for insert with check (true);
```
Insert-only for everyone (anon included); **no select policy at all**, so only the service role can read the list. Used by `src\lib\newsletter\subscribe.ts` (server action, uses the *cookie* server client, so it inserts as `anon`). It lowercases/trims, regex-validates `^[^\s@]+@[^\s@]+\.[^\s@]+$`, and maps Postgres error `23505` → `{ ok: true, alreadySubscribed: true }`.

### 1.14 `20260507000002_suggested_groups.sql` — `suggested_groups`
Same shape as addon_groups minus `multi`:
```sql
create table if not exists public.suggested_groups (
  id uuid primary key default gen_random_uuid(),
  category_id  uuid references public.categories(id) on delete cascade,
  menu_item_id uuid references public.menu_items(id) on delete cascade,
  label_en text not null, label_tr text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint suggested_groups_one_owner check (
    (category_id is not null)::int + (menu_item_id is not null)::int = 1)
);
create table if not exists public.suggested_items (
  id uuid primary key default gen_random_uuid(),
  suggested_group_id uuid not null references public.suggested_groups(id) on delete cascade,
  menu_item_id       uuid not null references public.menu_items(id) on delete cascade,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```
Public read `using (true)`, staff write on `current_role() in ('admin','owner')`. This is the "Also try this" cross-sell block (`t.modal.alsoTry`). Note `suggested_groups` **keeps** its `menu_item_id` XOR constraint (unlike addon_groups, which drops it in 1.16).

### 1.15 `20260510000000_addon_groups_required.sql` — `required`
```sql
alter table public.addon_groups add column if not exists required boolean not null default false;
```
Enforced **client-side only** in the ItemModal ("Required" badge, `t.modal.requiredMissing`); it is carried into the cart item as `CartItemExtra.required` but there is no server or DB check.

### 1.16 `20260513000000_addon_group_multi_items.sql` — `multi_items` (join table)
Replaces `addon_groups.menu_item_id` with a many-to-many join so one addon group can serve several items:
```sql
create table addon_group_items (
  addon_group_id uuid not null references addon_groups(id) on delete cascade,
  menu_item_id   uuid not null references menu_items(id)   on delete cascade,
  primary key (addon_group_id, menu_item_id)
);
insert into addon_group_items (addon_group_id, menu_item_id)
  select id, menu_item_id from addon_groups where menu_item_id is not null;
alter table addon_groups drop constraint if exists addon_groups_one_owner;
alter table addon_groups drop column if exists menu_item_id;
```
RLS here uses a **different pattern** from the rest of the schema:
```sql
create policy "anon can read addon_group_items" on addon_group_items for select using (true);
create policy "authenticated can manage addon_group_items"
  on addon_group_items for all using (auth.role() = 'authenticated');
```
i.e. **any logged-in user** (not role-gated), and this one was never patched by the dev-role migration.

Resolution precedence at read time (`src\lib\menu\queries.ts:235–243`): if any group is linked to the item via `addon_group_items`, item-level groups win outright; otherwise fall back to groups attached to the item's category **or its parent category**.

### 1.17 `20260513000001_addon_option_reveals.sql` — `reveals`
```sql
create table addon_option_reveals (
  addon_option_id uuid not null references addon_options(id) on delete cascade,
  addon_group_id  uuid not null references addon_groups(id)  on delete cascade,
  sort_order      integer not null default 0,
  primary key (addon_option_id, addon_group_id)
);
create policy "anon can read addon_option_reveals" on addon_option_reveals for select using (true);
create policy "authenticated can manage addon_option_reveals"
  on addon_option_reveals for all using (auth.role() = 'authenticated');
```
Header comment: "When an addon option is selected, it can reveal additional addon groups. Example: selecting *Upgrade to Meal* reveals a *Pick a Drink* group." Conditional/cascading modifiers, one level deep as materialised (`src\lib\menu\queries.ts:137–167` builds a `groupById` map first, then a second pass fills `revealedGroups` — so cycles are representable in the DB but the client renders whatever the tree gives it).

### 1.18 `20260517000000_orders_table_number_to_text.sql` — table ids become strings
```sql
drop policy if exists "orders_public_insert" on public.orders;   -- policy blocks the type change
alter table public.orders drop constraint if exists orders_table_number_check;
alter table public.orders alter column table_number type text using table_number::text;
alter table public.orders add constraint orders_table_number_check
  check (char_length(table_number) <= 50);
create policy "orders_public_insert" on public.orders
  for insert with check (
    jsonb_array_length(items) > 0 and total > 0 and char_length(table_number) <= 50
  );
```
Now `''` (empty string) is the unknown-table sentinel, not `0`. IDs like `S1`, `T3`, `KAMARA` are valid.

### 1.19 `20260525000000_sales_entries.sql` — real POS money

Purpose (header): the menu is browse + call-waiter only, no checkout, so `orders` holds *intents, not money*. The owner enters real POS revenue here so analytics can compare actual revenue against menu engagement.

```sql
create table if not exists public.sales_entries (
  id          uuid primary key default gen_random_uuid(),
  entry_date  date not null unique,           -- one figure per day; re-import upserts
  total_sales numeric(12,2) not null check (total_sales >= 0),
  covers      int check (covers is null or covers >= 0),
  source      text not null default 'manual' check (source in ('manual','excel')),
  created_by  uuid references public.profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index sales_entries_date_idx on public.sales_entries (entry_date desc);

create table if not exists public.sales_entry_items (
  id        uuid primary key default gen_random_uuid(),
  entry_id  uuid not null references public.sales_entries(id) on delete cascade,
  item_name text not null,
  qty       int not null check (qty >= 0),
  revenue   numeric(12,2) check (revenue is null or revenue >= 0)
);
```
RLS: `sales_entries_staff_all` / `sales_entry_items_staff_all` = ALL for `current_role() in ('admin','owner')` (later `+ 'dev'`). Writes go through server actions in `src\app\(dashboard)\admin\analytics\sales\actions.ts`, gated `requireRole(["owner","dev"])`. XLSX import via the `xlsx` package; `public\sales-template.csv` is the template.

### 1.20 `20260704000000_add_dev_role.sql` + `20260704000001_dev_role_grants.sql` — the `dev` role
```sql
alter type public.user_role add value if not exists 'dev';
```
Must be its own migration — Postgres can't use a new enum value in the transaction that adds it. The grants migration then:
- Assigns `dev` to two hardcoded emails: `update public.profiles p set role='dev' from auth.users u where u.id=p.id and lower(u.email) in ('majedahdab.kagu@gmail.com','parsaa.mansourii@gmail.com');`
- Rewrites **every** role-gated policy from `('admin','owner')` → `('admin','owner','dev')`: categories, menu_items (read + write), orders (read + update), sales_entries, sales_entry_items, addon_groups, addon_options, suggested_groups, suggested_items, and `storage.objects` menu_images.
- On profiles it uses `('admin','dev')` (note: **not** `owner`) for `profiles_self_read` and `profiles_admin_update` — an inherited quirk from the pre-inversion policy text.
- Does **not** touch `addon_group_items` / `addon_option_reveals` (they use `auth.role()='authenticated'`).

**Final role hierarchy (as enforced by app + DB):**

| Role | Menu/categories/addons/suggested/settings/QR | Orders read/update | Analytics tab | Users/roles |
|---|---|---|---|---|
| `admin` (default for new users) | yes | yes | **no** | **no** |
| `owner` | yes | yes | yes | yes |
| `dev` | yes | yes | yes | yes |

App-layer gates (`grep requireRole`): admin layout = `["admin","owner","dev"]`; `/admin/users` pages + actions = `["owner","dev"]`; all `/admin/analytics/**` pages + actions = `["owner","dev"]`; everything else (menu, categories, addons, suggested, settings, qr) = `["admin","owner","dev"]`. Nav in `src\app\(dashboard)\admin\layout.tsx:12,21` hides Analytics and Kullanıcılar unless `owner|dev`.

### 1.21 `20260705000000_analytics_insights.sql` + `20260720000000_..._owner_access.sql` + `20260810000001_..._compare_basis.sql`

```sql
create table public.analytics_insights (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  range_from date not null,
  range_to   date not null,
  insights   jsonb not null,   -- array of strings
  created_by uuid references public.profiles(id) on delete set null
);
create index analytics_insights_created_at_idx on public.analytics_insights (created_at desc);
```
**What it's for:** history of LLM-generated business findings for a date range, so later generations can reference what was advised before ("garlic items were flagged last week — still not selling"). Initially `analytics_insights_dev_all` (dev only); `20260720000000` replaces it with `analytics_insights_staff_all` for `('owner','dev')` because otherwise insight generation would silently fail under RLS for owners.

`20260810000001` adds:
```sql
alter table public.analytics_insights
  add column if not exists compare_basis text not null default 'prev'
  check (compare_basis in ('prev','4w','52w'));
drop index if exists analytics_insights_range_idx;
create index analytics_insights_range_idx
  on public.analytics_insights (range_from, range_to, compare_basis, created_at desc);
```
Rationale: findings *name* their baseline ("4 hafta öncesine göre %12 arttı"), so a set generated under one baseline must not be replayed under another. Lookup key is (range_from, range_to, compare_basis, newest first) — see `loadStoredSet()` at `src\app\(dashboard)\admin\analytics\actions.ts:188–207`; insert at `:608` and `:710`.

### 1.22 `20260722000000_analytics_patterns.sql`
```sql
create table if not exists public.analytics_patterns (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  range_from date not null, range_to date not null,
  patterns jsonb not null,  -- array of { id, kind, text, subjects[], metrics{}, strength }
  created_by uuid references public.profiles(id) on delete set null
);
create index analytics_patterns_range_idx on public.analytics_patterns (range_from, range_to, created_at desc);
create policy "analytics_patterns_staff_all" on public.analytics_patterns
  for all using (public.current_role() in ('owner','dev')) with check (…);
```
**What it's for:** persisted "Kalıplar" (Patterns) card sets. Sibling to `analytics_insights`, but stores validated pattern *objects* (sentence + kind + subjects + supporting numbers), not just strings, so a page reload redraws the cards without re-mining the data or re-billing the LLM judge. Keyed by range only (no compare_basis). Read `loadStoredPatterns()` at `actions.ts:798–816`, insert at `:960`.

Pattern mining lives in `src\lib\analytics\patterns.ts` (e.g. `mineBasketLift`, which reads `orders.items` for co-occurrence lift ≫ 1).

### 1.23 `20260810000000_menu_item_cost.sql` — `menu_item_cost`
```sql
alter table public.menu_items
  add column if not exists cost numeric(10,2) check (cost is null or cost >= 0);
comment on column public.menu_items.cost is
  'Owner-entered unit food cost in TRY. NULL = not entered; margin math treats it as unknown, never as zero.';
```
Header comment is the design intent: adds the *margin* axis to the popularity axis, producing the standard menu-engineering quadrants (star / plowhorse / puzzle / dog). **Deliberately nullable and NULL is never coerced to 0** — treating unknown as free would report 100% margin and rank an un-costed item as the most profitable thing on the menu. Items without a cost are dropped from every margin calc, and the analytics tab reports what % of revenue the matrix can actually speak for. See `src\lib\analytics\menu-matrix.ts`; the TS type carries the same warning at `src\types\database.ts:73–75`.

### 1.24 `20260811000000_analytics_insight_rejections.sql`
```sql
create table public.analytics_insight_rejections (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  text text not null,       -- the rejected sentence, verbatim as shown
  text_key text not null,   -- normalized dedupe key (lowercased, punctuation/ws collapsed)
  reason text,              -- optional owner note on WHY it was bad
  created_by uuid references public.profiles(id) on delete set null
);
create unique index analytics_insight_rejections_text_key_idx
  on public.analytics_insight_rejections (text_key);
create index analytics_insight_rejections_created_at_idx
  on public.analytics_insight_rejections (created_at desc);
create policy "analytics_insight_rejections_staff_all" on public.analytics_insight_rejections
  for all using (public.current_role() in ('owner','dev')) with check (…);
```
**What it's for:** an owner-curated "don't write findings like this" list — concrete negative examples fed back into every later LLM generation. Two deliberate design notes worth porting:
- `text_key` is a **real column**, not a unique index on `md5(text)`, because PostgREST's `on_conflict` only accepts column names, so an expression index would be unusable from the client and every re-rejection would 409. Normalization must mirror `normalizeFinding()` in `src\lib\analytics\insights.ts`.
- **Not keyed by date range** (unlike `analytics_insights`): a rejection judges the *shape* of a sentence, which stays true across ranges and bases.

Flow: `rejectInsightAction()` at `src\app\(dashboard)\admin\analytics\actions.ts:668–730` — persists the rejection **before** any model call (upsert `{text, text_key: normalizeFinding(text), reason, created_by}` with `{ onConflict: "text_key", ignoreDuplicates: true }`), writes the reduced set through to `analytics_insights` immediately, then optionally asks for a replacement. Reads: `loadRejections()` at `:219–243`, `MAX_REJECTIONS_LOADED = 60`, newest first, degrades to `[]` if the table is missing.

### 1.25 `analytics-catch-up.sql` (repo root)
Not a migration — a **hand-run idempotent catch-up script** for the Supabase SQL editor. Header says it covers the five migrations that "were never applied" on the live DB: `20260705000000`, `20260720000000`, `20260722000000`, `20260810000000`, `20260810000001`. Differences from the originals: every statement is `if not exists`; `add constraint` is wrapped in `do $$ … exception when duplicate_object then null; end $$` (Postgres has no `ADD CONSTRAINT IF NOT EXISTS`); it drops both the old dev-only and staff policies before recreating. Ends with a 4-row verification `SELECT … 'OK'/'MISSING'` for `menu_items.cost`, `analytics_insights`, `analytics_insights.compare_basis`, `analytics_patterns`. Its comment at line 87 names the live bug it fixed: "menu_items.cost — THIS is the 500 on the menu form."

### 1.26 `settings` (undeclared, but required)
Key/value store, `upsert(..., { onConflict: "key" })`. Full key inventory found in code:

| Key | Written by | Read by | Value format |
|---|---|---|---|
| `hero_mode` | `admin\settings\actions.ts:37` | `lib\menu\queries.ts:30` | `none` \| `media` \| `featured` |
| `hero_media_url` | ″ | ″ | URL or `""` |
| `featured_item_id` | ″ | ″ | uuid or `""` |
| `featured_label` | ″ | ″ | text ≤200 |
| `featured_badge` | ″ | ″ | text ≤60 |
| `featured_discount` | ″ | ″ | int 0–99 as string |
| `open_hours_tr` / `open_hours_en` | ″ | ″ | text ≤80 |
| `waiter_disabled_tables` | `admin\qr\actions.ts:25` | `lib\settings\queries.ts:12` | JSON `string[]` of table ids (tolerates legacy `number[]`) |
| `analytics_business_day_start` | — | `lib\analytics\business-day.ts:21,67` | hour |
| `analytics_excluded_items` | `analytics\actions.ts:988` | `lib\analytics\exclusions.ts:31` | JSON array |
| `analytics_auto_exclude_offmenu` | `analytics\actions.ts:1016` | `exclusions.ts:32` | `"1"` / `"0"` |
| `analytics_offmenu_overrides` | `analytics\actions.ts:1017,1046` | `exclusions.ts:33` | JSON array |
| `analytics_last_import_review` | `analytics\sales\actions.ts:375` | `import-review.ts:27` | JSON blob |
| `analytics_item_aliases` | `sales\actions.ts:424` | `import-review.ts:29` | JSON map |
| `analytics_force_item_names` | — | `import-review.ts:31` | JSON array |

Cache tags: `settings` (waiter-disabled tables, users), `hero` (hero settings), `menu` (public menu). `updateTag(...)` is the Next 16 invalidation call.

---

## 2. TABLE AUTH / QR

### 2.1 `src\lib\table-auth.ts` — signing primitives

Two independent HMAC-SHA256 schemes with **two different secrets**:

- `TOKEN_VERSION = "v2"` (line 21) — bumped when the ID scheme changes so QRs signed under a previous version are rejected.
- **QR token** (lines 24–34), signed with `env.QR_SECRET`:
  ```ts
  generateToken(table) → { tok: hmac(QR_SECRET, `v2|table=${table}&w=0`).hex.slice(0,16), w: 0 }
  verifyToken(table, w, tok) → w === "0" && timingSafeEqual(expected, tok)
  ```
  **Permanent, never expires** (`w` is always `0`; the `w` param is a vestige of a rotating-window design). 16 hex chars = 64 bits.
- **Table session cookie** (lines 44–66), signed with `env.COOKIE_SECRET`:
  ```ts
  signTableCookie(table) → `${base64url({v:"v2", table, exp: now + 28800})}.${hmac(COOKIE_SECRET, payload)}`
  verifyTableCookie(raw) → null unless: sig matches (timing-safe), v === "v2",
                                        now <= exp, table is a 1..50-char string
  ```
  `WINDOW_SECS = 28800` = **8 hours**. Split on `lastIndexOf(".")`.

`safeEqual` guards `timingSafeEqual` with a length check and a try/catch (non-hex input throws).

### 2.2 `src\lib\tables.ts` — the master table list
```ts
export const TABLE_IDS = [
  "S1","S2","S3","S4",
  "T1","T2","T3","T4","T5","T6","T7","T8","T9","T10",
  "KAMARA",
  "1","4","6","7","8","9","10","11","12","13","14","15","16",
] as const;   // 28 tables; order drives QR print order
export function isValidTableId(value: string): boolean   // Set lookup
```
`""` is reserved as the unknown/no-table sentinel and must not appear in the list.

### 2.3 `src\app\(public)\[locale]\scan\route.ts` — how a guest gets bound
```
GET /:locale/scan?t=<table>&w=0&tok=<16 hex>
  if (!isValidTableId(t) || !verifyToken(t, w, tok))
      → 303 redirect to /:locale?scan_error=1        (no cookie set)
  else
      → 303 redirect to /:locale
        Set-Cookie: table_session=<signed>; HttpOnly; SameSite=Lax; Path=/; Max-Age=28800
```
So: **the QR carries a permanent signed token; the scan endpoint exchanges it for an 8-hour HttpOnly signed cookie.** No DB row, no session table, no server state at all. `scan_error=1` is set on the URL but nothing in `page.tsx` currently reads it.

### 2.4 Reading the binding — `src\app\(public)\[locale]\page.tsx:34–42`
```ts
const rawT = typeof sp.t === "string" ? sp.t : "";
const urlTable = isValidTableId(rawT) ? rawT : undefined;
const cookieTable = rawCookie ? verifyTableCookie(rawCookie) : null;
const initialTableNumber = cookieTable ?? urlTable;   // cookie wins
```
The raw `?t=` fallback is documented as "for dev/staff" — it bypasses the HMAC entirely (only `isValidTableId` is checked), so anyone who knows a table name can self-assign. Page is `export const dynamic = "force-dynamic"`.

Client side, `PhoneMenu` (`src\components\PhoneMenu\components.tsx:59–60,96–126`):
- `tableNumber` state seeded from `initialTableNumber`; `tableLocked = initialTableNumber !== undefined` → drives the "from QR" badge and disables manual editing.
- On mount, hydrates cart from `sessionStorage["upperdeck-cart-v2"]` (`{cartItems, tableNumber, note}`, debounced 200 ms save). A persisted `tableNumber` is only accepted if `initialTableNumber === undefined` **and** `isValidTableId(t)`. The `-v2` suffix exists to drop legacy numeric sessions.

### 2.5 Browsing without a table — `QrRequiredModal`
Yes, **a guest can browse the entire menu with no table binding**. The menu, categories, addons, and suggested items are all `select using (true)` for anon. What's gated is *acting*:

- `handleCartClick` (`PhoneMenu:229–236`): if `!tableNumber` → `setQrModalOpen(true)` and return, cart never opens.
- `WaiterButton.onBeforeOpen` (`PhoneMenu:504–510`): same — the bell sheet won't open without a table.

`src\components\QrRequiredModal\components.tsx` is a purely presentational bottom sheet (drag-to-dismiss >80 px, hand-drawn 21×21 SVG QR bitmap). Copy from `src\i18n\en.ts`: title "Please scan QR code", body "Scan the QR code on your table to place an order or call a waiter."

Per-table bell kill switch: `disabledTables` (from `settings.waiter_disabled_tables`) hides the bell entirely (`PhoneMenu:501`) and suppresses `BellTutorial` (`:580–586`).

### 2.6 `orders_allow_unknown_table`
Named after migration `20260430000000_orders_allow_unknown_table.sql` (§1.8). It is **not** a feature flag or a settings key — it is the schema change that made `table_number = 0` (later `''`) legal, so an order placed before scanning still inserts instead of failing the CHECK + the INSERT policy. Downstream, `''` renders as `"Unknown Table"` in `src\lib\orders\submit.ts:76` and `supabase\functions\order-notify\index.ts:75`, and `"Bilinmeyen Masa"` in `src\lib\waiter\call.ts:8`. Since the UI now blocks both the cart and the bell without a table, the unknown path is only reachable via the API/diag route.

### 2.7 QR generation

**Live path — `src\app\(dashboard)\admin\qr\page.tsx`** (server component, gated by the admin layout):
```ts
const baseUrl = env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
for each TABLE_IDS id:
  const { tok, w } = generateToken(id);
  const url = `${baseUrl}/tr/scan?t=${encodeURIComponent(id)}&w=${w}&tok=${tok}`;
  QRCode.toDataURL(url, { width: 360, margin: 2, errorCorrectionLevel: "H" })
```
Hardcoded `/tr/` locale. ECC level H so the Upperdeck logo can be overlaid in the centre. Print CSS hides nav/aside/header/`[data-no-print]` and forces a 4-column grid. Each cell carries a `TableWaiterToggle`.

`src\app\(dashboard)\admin\qr\actions.ts` — `setTableWaiterDisabled(tableNumber, disabled)`: `requireRole(["admin","owner","dev"])`, read-modify-write of `settings.waiter_disabled_tables` (JSON string[], dedup via `Set`), then `updateTag("settings")`.

**Stale path — `scripts\generate-table-qrs.mjs`.** Env: `BASE_URL` (default `https://example.com`), `TABLE_COUNT` (default 20), `QR_SECRET` (required, exits 1 if absent). **Its token scheme is incompatible with the current verifier:** it signs `table=${n}&w=${w}` with no `v2|` prefix and uses a rotating window `w = floor(now/28800)` (lines 24–29), whereas `verifyToken` demands `w === "0"` and the `v2|` prefix. It also iterates numbers 1..N instead of `TABLE_IDS`. Output: `scripts/qrs.html` (gitignored), 4-column print grid. **Treat it as dead code; port `admin/qr/page.tsx` instead.**

### 2.8 `src\proxy.ts` (Next 16 replacement for middleware.ts)
```ts
const SKIP_LOCALE_PREFIXES  = ["/admin","/login","/logout","/auth","/api"];
const ADMIN_PATHS           = ["/admin"];
const SKIP_SESSION_PREFIXES = ["/api/telegram","/api/health"];
export const config = { matcher: ["/((?!_next|.*\\..*).*)"] };
```
Order of operations:
1. `/api/telegram*` and `/api/health*` → `NextResponse.next()` immediately, **no Supabase session work** (keeps the cron keep-alive and the Telegram webhook cheap and cookie-free).
2. Otherwise `refreshSession(request)` → `{ response, user }`.
3. `/admin*` and no user → redirect `/login?next=<pathname>`.
4. Path in `SKIP_LOCALE_PREFIXES` → return response as-is.
5. Path already `/en` or `/tr` → return response.
6. Else redirect to `/${defaultLocale}${pathname}`.

`src\lib\supabase\proxy.ts` — `refreshSession()` builds a `createServerClient` whose `setAll` mirrors cookies onto both the request and a freshly-rebuilt `NextResponse.next({ request })`, then calls `supabase.auth.getUser()` and returns `{ response, user }`.

Note: `defaultLocale` is **`"tr"`** (`src\i18n\config.ts:3`) — both `docs\ARCHITECTURE.md:209` and the ARCHITECTURE prose claim `en`; the code is right, the docs are stale. There is no `Accept-Language` detection despite what ARCHITECTURE.md §3 says.

### 2.9 The four Supabase clients (do not merge)
| File | Context | Key | Purpose |
|---|---|---|---|
| `src\lib\supabase\client.ts` | browser, memoized singleton | publishable/anon | Realtime, storage uploads |
| `src\lib\supabase\server.ts` → `getServerClient()` | server components/actions, cookie-aware | anon + user cookies | RLS-respecting work |
| `src\lib\supabase\server.ts` → `getCacheClient()` | inside `unstable_cache()` | anon, **no cookies**, `persistSession:false` | shared/public cached reads |
| `src\lib\supabase\proxy.ts` | `proxy.ts` only | anon + request cookies | session refresh |
| `src\lib\supabase\admin.ts` | `server-only` | `SUPABASE_SERVICE_ROLE_KEY` | bypass RLS: order inserts, user invites/list/delete; throws a clear error if the key is missing |

---

## 3. ORDERS

### 3.1 Cart types — `src\components\CartDrawer\types.ts`
```ts
export type CartItemExtra = { id: string; label: string; price: number; required?: boolean; groupLabel?: string };
export type CartItem = {
  id: string;            // synthetic cart line id, see below
  menu_item_id: string;
  name: string;
  price: number;         // ALREADY includes discount + all extras
  qty: number;
  extras?: CartItemExtra[];
  itemNote?: string;
};
```
Cart-line identity (`PhoneMenu:278–299`):
```ts
basePrice      = discountPct ? Math.round(price * (1 - discountPct/100)) : price;
extrasTotal    = sum(extras.price);
effectivePrice = basePrice + extrasTotal;
cartId = (extras.length > 0 || itemNote)
  ? `${menu_item_id}__${extras.map(e=>e.id).join("_")}${itemNote ? "__note"+itemNote.slice(0,8) : ""}`
  : menu_item_id;
```
Same `cartId` → increment qty; else push a new line. Note the `__note` key truncates to 8 chars, so two long notes differing after char 8 merge.

### 3.2 Order payload + validation — `src\lib\orders\submit.ts`
```ts
const ItemSchema = z.object({
  menu_item_id: z.string().uuid(),
  name_en: z.string().min(1),
  name_tr: z.string().min(1),
  price: z.number().nonnegative(),
  qty: z.int().min(1).max(50),
});
const OrderSchema = z.object({
  table_number: z.string().max(50),
  items: z.array(ItemSchema).min(1),
  note: z.string().max(200).default(""),
  total: z.number().nonnegative(),
  _simulateFailure: z.boolean().optional(),
});
export type SubmitOrderResult =
  | { ok: true }
  | { ok: false; error: "validation" | "network" | "server"; message?: string };
```
Behaviour:
1. `safeParse`; on failure → `{ok:false, error:"validation", message: issues[0].message}`.
2. `_simulateFailure && NODE_ENV === "development"` → `{ok:false, error:"network", message:"simulated"}` (dev-only escape hatch, exposed as "DEV: simulate failure" per README:123).
3. **Server recomputes the total** — `serverTotal = Σ price*qty` — and the server figure is what is stored. A client/server mismatch >0.01 only `console.warn`s (`[submitOrder] client/server total mismatch`); it does not reject.
4. Insert via **`getAdminClient()` (service role, bypasses RLS)**: `{ table_number, items, note, total: serverTotal }`. Comment at :51 states the rationale explicitly.
5. Best-effort Telegram ping (§5.2). Failures there don't affect the result.
6. Returns `{ok:true}`. All throws → `{ok:false, error:"server", message:String(err)}`.

**Note the payload shape mismatch:** `CartItem` (`{id, menu_item_id, name, price, qty, extras, itemNote}`) is *not* `ItemSchema` (`{menu_item_id, name_en, name_tr, price, qty}`). There is no mapper in the repo — the code that would have flattened extras into the snapshot is gone along with the checkout button. **There is no coupon field anywhere in the order payload** (coupons are newsletter bait only, §3.6).

### 3.3 What's stored in `orders`
- `items` is a **JSONB snapshot** of `{menu_item_id, name_en, name_tr, price, qty}[]` — bilingual names and unit price are frozen at order time, so later menu edits don't rewrite history. Analytics relies on this (`src\lib\analytics\basket.ts:47`, `src\lib\analytics\patterns.ts:315` read `it.name_tr || it.name_en`).
- Extras/addons are **not** modelled in the snapshot; they'd have to be folded into the line price (as `effectivePrice` already does) or into `note`.
- `note` is a single order-level free-text field (≤200 chars, enforced by Zod and by the textarea's `.slice(0,200)` at `CartDrawer/components.tsx:238`). Per-item `itemNote` has no home in the DB.
- `total` is server-computed.

### 3.4 Status lifecycle
`new → seen → preparing → served`, with `cancelled` reachable at any point (CHECK constraint). Timestamps auto-filled by `touch_status_timestamps` (§1.6): first transition off `new` sets `seen_at`; reaching `served` sets `served_at`. `updated_at` by `orders_touch`.

Who can move status:
- Telegram inline buttons → `telegram-callback` Edge Function → service-role PATCH. Only `seen` and `served` (`VALID_STATUSES`).
- The admin board's four buttons (`seen`, `preparing`, `served`, `cancelled`) are **local-state only** — no write. To port properly you need a server action or a direct `supabase.from("orders").update({status})` (RLS already allows it for `admin|owner|dev`).

### 3.5 Admin orders board — `src\app\(dashboard)\admin\orders\_client.tsx`

Constants (lines 11–14): `STALE_SECS = 90`, `STALE_REPEAT_MS = 30_000`, `RECONNECT_MIN_MS = 4_000`, `RECONNECT_MAX_MS = 7_000`.

- **Realtime, not polling.** `supabase.channel("orders-stream")` with two `postgres_changes` listeners (`INSERT` prepends, `UPDATE` replaces by id) on `public.orders` (lines 243–302). Requires the table to be in the `supabase_realtime` publication (§1.6) and the anon/user role to satisfy `orders_staff_read`.
- **Reconnect:** on `CHANNEL_ERROR | TIMED_OUT | CLOSED`, sets state `disconnected` and starts a `setInterval` with jittered delay `4000 + rand*3000` ms that removes and re-subscribes the channel while still disconnected. On `SUBSCRIBED` → `connected` + clear the timer. (Banner text says "her 5 saniyede" / every 5 s.)
- **Sound.** `public/notification.mp3` — the repo only ships `public\notification.mp3.txt`, a TODO placeholder ("Format: MP3, Duration ≤ 2 seconds"). Autoplay policy requires a one-time **"Vardiyayı Başlat" (Start shift)** click (`handleStartShift`, :305–313), which constructs `new Audio("/notification.mp3")`, plays it at volume 0.01 to unlock, stores it in a ref and sets `audioArmed`. After that: play on every INSERT, and a per-order repeating alarm every 30 s for any `new` order older than 90 s (`syncStaleTimers`, :196–215), reconciled both on every `orders` change and on a 10 s interval so an order can cross the threshold with no realtime traffic.
- **UI:** document title becomes `(${unseenCount}) Orders · Upperdeck`; orange stale banner "⚠ N siparişe bakılması gerekiyor"; connection pill `Bağlanıyor… / Canlı / Bağlantı Kesildi`; per-card table number, status pill, elapsed badge (ticks every 10 s, `şimdi / Ns / Nd / Ns`), bilingual item lines `qty× name_en / name_tr`, total, note, four action buttons. Turkish status labels: `Yeni / Görüldü / Hazırlanıyor / Teslim Edildi / İptal`.

### 3.6 Coupons
`src\components\CartDrawer\CouponSection.tsx` — the coupon input **never validates anything**. `handleApply()` just sets `attempted` and opens the newsletter panel ("No offer found. Subscribe to our newsletter…"). Subscribing calls `subscribeNewsletter(email)` → `newsletter` table. There is no coupons table, no discount logic in `submitOrder`. The only real discount is `featured_discount` from `settings`, applied client-side to the featured item's cart price (`PhoneMenu:281`).

### 3.7 `src\lib\broadcast.ts`
```ts
export async function broadcastMenuUpdate() {
  const supabase = createClient(URL, SERVICE_ROLE_KEY ?? PUBLISHABLE_KEY, {auth:{persistSession:false,autoRefreshToken:false}});
  await supabase.channel("menu-updates").send({ type: "broadcast", event: "refresh", payload: {} });
  // swallowed on error — non-critical
}
```
Server-only, fire-and-forget push so open diner phones refresh after an admin edit. Receiver: `PhoneMenu:87–93` subscribes to `menu-updates`, and on `refresh` calls `router.refresh()`. Currently only invoked from `src\app\(dashboard)\admin\settings\actions.ts:56` (`void broadcastMenuUpdate()`), not from the menu/category actions.

---

## 4. WAITER CALL

### 4.1 `src\lib\waiter\call.ts` — the entire server side (16 lines)
```ts
"use server";
export type CallReason = "bill" | "waiter" | "order";

export async function callWaiter(tableNumber: string, reason: CallReason): Promise<boolean> {
  const table = tableNumber ? `Masa ${tableNumber}` : "Bilinmeyen Masa";
  const msg =
    reason === "bill"   ? `💳 <b>Hesap İsteniyor — ${table}</b>`
  : reason === "order"  ? `🍽️ <b>${table} sipariş vermek istiyor</b>`
  :                       `🙋 <b>Garson Çağrısı — ${table}</b>`;
  return sendTelegramMessage(msg);
}
```
**No DB write, no persistence, no auth, no server-side rate limit.** It does not verify the `table_session` cookie — the table string comes straight from the client. Returns the boolean from `sendTelegramMessage` (false when Telegram env is unset or the API call fails).

### 4.2 Rate limiting — client-side only
`src\components\WaiterButton\constants.ts`: `WAITER_COOLDOWN_MS = 10_000` (10 s). In `WaiterButton` it's wrapped as `COOLDOWNS_MS = [WAITER_COOLDOWN_MS]` with `COOLDOWNS_MS[Math.min(callCount, len-1)]` — an escalating-cooldown ladder with exactly one rung.

Cooldown is owned by `PhoneMenu` and shared across both entry points (`secondsLeft` prop + `onWaiterCalled(cooldownMs)` callback):
- `handleWaiterCalled` (`PhoneMenu:171–181`) sets `waiterCooldownUntil.current = Date.now() + ms`, seeds `waiterSecondsLeft`, and **persists to `localStorage[\`waiter_t${tableNumber}\`]` as `{until, count}`** — so the cooldown survives a reload (restored at `:141–154`).
- A 1 s ticker (`:157–169`) counts down; the bell shows a `m:ss` badge and both sheet buttons are disabled while `secondsLeft > 0`.
- Trivially bypassable (clear localStorage / new device). Server-side there is nothing.

### 4.3 The two entry points

**Bell sheet — `src\components\WaiterButton\components.tsx`.** Floating 48×48 bell, `absolute bottom-4 left-4`. Hidden when the footer is visible, an item modal is open, or the table is in `disabledTables`. `onBeforeOpen` returns false (and opens `QrRequiredModal`) when there's no table. Phases `idle → open → sending → done|failed → idle` (auto-reset after 2500 ms). Two buttons: **bill** (`t.waiter.bill`) and **waiter** (`t.waiter.call`). On tap: `track.waiterCalled(reason)` (PostHog), `await callWaiter(table, reason)`, apply cooldown, `buzz()` haptic, show ✓/✗. Sheet is a drag-dismissible bottom sheet (>80 px).

**Cart button — `handleCartCallWaiter`** (`PhoneMenu:238–255`). The cart's primary CTA is "Call Waiter", not "Send Order": guards on `submitting || waiterSecondsLeft > 0 || !tableNumber`, dynamically imports `@/lib/waiter/call`, fires `callWaiter(tableNumber, "order")`, tracks, applies the 10 s cooldown, buzzes, toasts `t.cart.waiterCalled` ("Waiter notified — on the way!") or `t.cart.error_send`. After the call, the CTA is replaced by the green `callWaiterHeadedLabel` banner ("A waiter is headed your way to place your order!") for the cooldown duration (`CartDrawer/components.tsx:268–298`, `waiterCalled = waiterCooldownSeconds > 0`).

### 4.4 `BellTutorial` — `src\components\BellTutorial\components.tsx`
First-scan coach mark. Shown once per session, gated in `PhoneMenu:116–124` + `:580–586` on: `sessionStorage["bellTutorial_seen"] !== "true"` **and** a resolved table **and** that table not in `disabledTables` **and** no item modal / cart / QR modal open. Full-screen radial-gradient spotlight punched out around the bell's screen position (`circle 64px at 40px calc(100% - 80px)`), an animated hand-drawn SVG arrow pointing to it, headline from `t.bellTutorial`, `AUTO_DISMISS_MS = 6_000`, `FADE_OUT_MS = 200`, dismissed by tap-anywhere or timeout; dismissal writes `sessionStorage["bellTutorial_seen"] = "true"`.

---

## 5. TELEGRAM (exhaustive)

### 5.1 Two independent delivery paths to the same chat

| | Path A — Next.js server actions | Path B — Supabase Edge Functions |
|---|---|---|
| Trigger | in-process, right after the order insert / on a waiter tap | DB webhook on `orders` INSERT |
| Code | `src\lib\telegram.ts` ← `orders\submit.ts`, `waiter\call.ts` | `supabase\functions\order-notify\index.ts` |
| Secrets from | Next `process.env` | `supabase secrets` (Deno env) |
| Buttons | none | inline keyboard |
| Fires for | orders **and** waiter calls | orders only |

**If both are configured, every order produces two Telegram messages** — a plain one from `submitOrder` and a button-bearing one from `order-notify`. There is no dedupe between them.

### 5.2 `src\lib\telegram.ts` (31 lines, the whole outbound helper)
```ts
const API = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}`;

export async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn("[telegram] skipped — TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set");
    return false;
  }
  const res = await fetch(`${API}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text, parse_mode: "HTML" }),
  });
  if (!res.ok) { console.error("[telegram] sendMessage failed", res.status, await res.text()); return false; }
  return true;
}
```
**Retry/dedupe: none.** One attempt, no backoff, no queue, no idempotency key, no persisted outbox. Network throw → logged `[telegram] fetch threw` → `false`. `API` is computed at module load, so `undefined` is baked into the URL if the token is missing — harmless because of the guard. Text is `parse_mode: "HTML"` and **user input is never escaped** — an order note containing `<` will break the message (Telegram 400) and drop the notification.

### 5.3 Order message template — Path A (`src\lib\orders\submit.ts:72–79`)
```ts
const itemLines = items
  .map((i) => `  • ${i.qty}× ${i.name_en} — ${(i.price * i.qty).toLocaleString()} ₺`)
  .join("\n");
const noteLine  = note?.trim() ? `\n📝 <i>${note.trim()}</i>` : "";
const tableLabel = table_number ? `Table ${table_number}` : "Unknown Table";

`🛎 <b>New Order — ${tableLabel}</b>\n\n${itemLines}${noteLine}\n\n💰 <b>Total: ${serverTotal.toLocaleString()} ₺</b>`
```
Rendered example:
```
🛎 New Order — Table S1

  • 2× Crispy Burger — 740 ₺
  • 1× Oreo Milkshake — 220 ₺
📝 no onions

💰 Total: 960 ₺
```

### 5.4 Order message template — Path B (`supabase\functions\order-notify\index.ts`)

Full contract:
- **Deploy:** `supabase functions deploy order-notify --no-verify-jwt` (required — DB webhooks carry no Supabase JWT).
- **Auth:** `?secret=` query param compared to `Deno.env.get("WEBHOOK_SECRET")`; missing or mismatched → `401 {"error":"Unauthorized"}`. An unset `WEBHOOK_SECRET` fails closed.
- **Body:** the standard Supabase webhook envelope `{ type, table, schema, record, old_record }`. Rejects `type !== "INSERT" || !record?.id` with `400`.
- **Message** (lines 64–81):
```ts
const shortId  = order.id.slice(0, 8);
const itemLines = order.items.map((item) => `${item.qty}× ${item.name_en}`).join("\n");
const noteLine  = order.note?.trim() ? `\n📝 ${order.note.trim()}` : "";
const tableLabel = order.table_number ? `Table ${order.table_number}` : "Unknown Table";

const text =
  `🔔 <b>NEW ORDER</b> · #${shortId}\n` +
  `<b>${tableLabel}</b> · ₺${Number(order.total).toFixed(2)}\n` +
  `—\n` +
  `${itemLines}` +
  `${noteLine}`;
```
Rendered:
```
🔔 NEW ORDER · #3f9ab12c
Table S1 · ₺960.00
—
2× Crispy Burger
1× Oreo Milkshake
📝 no onions
```
- **Inline keyboard** (lines 84–93) — one row of three:
```ts
const appUrl = (Deno.env.get("PUBLIC_APP_URL") ?? "").replace(/\/$/, "");
reply_markup = { inline_keyboard: [[
  { text: "✓ Seen",   callback_data: `seen:${order.id}` },
  { text: "🍽 Served", callback_data: `served:${order.id}` },
  { text: "📋 Open",   url: `${appUrl}/admin/orders/${order.id}` },
]]};
```
(There is **no Accept/Reject** pair — the verbs are Seen / Served / Open. And the Open URL points at a route that doesn't exist, §0.3.)
- **Send:** POST `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage` with `{chat_id: TELEGRAM_CHAT_ID, text, parse_mode:"HTML", reply_markup}`. Non-OK → log + `500 {"error":"Telegram delivery failed"}`; throw → `500 {"error":"Network error"}`. Success → `200 {"ok":true}`. **No retry** (Supabase's webhook layer may retry on 5xx, which is the only redundancy).

### 5.5 Waiter-call message formats
All three go through Path A only, HTML, no keyboard, Turkish copy (`src\lib\waiter\call.ts:8–14`):

| reason | Message | Fired from |
|---|---|---|
| `bill` | `💳 <b>Hesap İsteniyor — Masa S1</b>` | bell sheet, "Hesap (Bill)" |
| `waiter` | `🙋 <b>Garson Çağrısı — Masa S1</b>` | bell sheet, "Call Waiter" |
| `order` | `🍽️ <b>Masa S1 sipariş vermek istiyor</b>` | **cart drawer primary CTA** |

No table → `Masa X` becomes `Bilinmeyen Masa`.

### 5.6 `supabase\functions\telegram-callback\index.ts` — what the buttons do
- **Deploy:** `supabase functions deploy telegram-callback --no-verify-jwt`. Zero dependencies (raw `fetch`, no supabase-js, "keeps cold-start minimal").
- **Auth:** same `?secret=` vs `WEBHOOK_SECRET` → `401` on mismatch.
- Ignores everything but `update.callback_query` (returns `200 {"ok":true}` for other update types).
- Parses `callback_data` on the **first** `:` → `status = data.slice(0, idx)`, `orderId = data.slice(idx+1)`. `VALID_STATUSES = new Set(["seen","served"])`. Invalid → `answerCallbackQuery(… "Unknown action")` and stop.
- **Writes via PostgREST directly, not supabase-js:**
```
PATCH ${SUPABASE_URL}/rest/v1/orders?id=eq.${encodeURIComponent(orderId)}
headers: Content-Type, apikey: SERVICE_ROLE_KEY, Authorization: Bearer SERVICE_ROLE_KEY, Prefer: return=minimal
body:    {"status": status}
```
Service role → bypasses `orders_staff_update`. The `touch_status_timestamps` trigger fills `seen_at`/`served_at`.
- On failure: `answerCallbackQuery(… "⚠️ Update failed" / "⚠️ Network error")` and returns HTTP **200** with `{"ok":false}` (deliberate — a non-2xx makes Telegram retry the update forever).
- On success: `answerCallbackQuery(id, \`Marked as ${status}\`)` (silences the client spinner, shows a toast) then `editMessageReplyMarkup(chat_id, message_id, { inline_keyboard: [] })` — **removes the buttons so the same order can't be double-actioned.** That empty-keyboard edit is the only dedupe mechanism in the whole Telegram layer.
- Both helper calls are individually try/caught and log-and-continue.

### 5.7 Waiter registration — there isn't one
- `src\app\api\telegram\register\route.ts` is **not** a waiter registration endpoint. It's a one-shot admin helper: `GET /api/telegram/register` → validates `TELEGRAM_BOT_TOKEN` and `NEXT_PUBLIC_SITE_URL` (500 with a JSON error if either is missing), then POSTs `setWebhook` with `{ url: \`${NEXT_PUBLIC_SITE_URL}/api/telegram/webhook\` }` and returns Telegram's raw response. **No `secret_token`, and the endpoint is unauthenticated** (excluded from session handling by `SKIP_SESSION_PREFIXES` in `proxy.ts`) — anyone can hit it and repoint the webhook at the app.
- `src\app\api\telegram\webhook\route.ts` is a 7-line stub: `POST` → `NextResponse.json({ ok: true })`. Comment: "we just acknowledge — order notifications are push-only (sent from submitOrder). Extend this handler for bot commands later."
- **Conflict:** `/api/telegram/register` and the SETUP.md `setWebhook` (Step 6, pointing at the `telegram-callback` Edge Function) both claim the bot's single webhook slot. Whichever ran last wins. If the Next route wins, inline buttons silently stop working.
- **No `/start`, no deep link, no `chat_id` table, no per-waiter identity.** One `TELEGRAM_CHAT_ID` → one group. `CallbackQuery.from` (`{id, first_name}`) is typed but never read, so the DB has no record of *which* waiter pressed a button. Getting the chat id is manual (SETUP.md Step 2: add the bot to the group, send a message, `curl .../getUpdates`, copy the negative id).

### 5.8 Secrets/env matrix

| Name | Where set | Used by | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Next env **and** `supabase secrets` | `lib\telegram.ts`, `api\telegram\register`, both Edge Functions | optional in Zod (`min(10)`) — absent ⇒ Path A no-ops |
| `TELEGRAM_CHAT_ID` | Next env **and** `supabase secrets` | `lib\telegram.ts`, `order-notify` | negative group id, **include the minus sign** |
| `WEBHOOK_SECRET` | `supabase secrets` only | both Edge Functions | `openssl rand -hex 32`; guards Supabase→function and Telegram→function |
| `PUBLIC_APP_URL` | `supabase secrets` only | `order-notify` "📋 Open" button | **must not end with `/`** (also `.replace(/\/$/,"")` defensively) |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | auto-injected into Edge Functions | `telegram-callback` PATCH | |
| `NEXT_PUBLIC_SITE_URL` | Next env | `api\telegram\register`, `admin\qr\page.tsx`, `users\actions.ts` invite `redirectTo` | |

### 5.9 `supabase\functions\SETUP.md` — the 8 steps verbatim
1. **@BotFather** → `/newbot`, name "Upperdeck Orders", username ending in `bot` (e.g. `upperdeck_orders_bot`); copy the token.
2. Create/choose a staff group, add the bot, send a message, `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"`, take the **negative** `chat.id`.
3. `openssl rand -hex 32` → `WEBHOOK_SECRET`.
4. `supabase functions deploy order-notify --no-verify-jwt` and `… telegram-callback --no-verify-jwt`.
5. `supabase secrets set TELEGRAM_BOT_TOKEN=… TELEGRAM_CHAT_ID=… WEBHOOK_SECRET=… PUBLIC_APP_URL=https://your-domain.com`.
6. `curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<project-ref>.functions.supabase.co/telegram-callback?secret=<WEBHOOK_SECRET>"`; verify with `getWebhookInfo` (`url` set, `pending_update_count` 0).
7. Dashboard DB webhook per §1.7 Method A.
8. End-to-end test: insert an order in the SQL editor; expect a Telegram message in seconds, ✓ Seen / 🍽 Served to update status and strip the buttons, 📋 Open to hit `/admin/orders`.

Troubleshooting table maps: no message → order-notify logs; "Unauthorized" → `WEBHOOK_SECRET` mismatch; buttons dead → telegram-callback logs + `setWebhook` missing `?secret=`; wrong chat → re-read `getUpdates`.

### 5.10 `src\lib\admin\notify.ts` / `client-notify.ts` — unrelated to Telegram
These are the **admin toast** plumbing, despite the name:
```ts
// notify.ts
export function notifyOk(path, label): never  { redirect(`${path}?ok=1&label=${encodeURIComponent(label)}`); }
export function notifyErr(path, label): never { redirect(`${path}?err=1&label=${encodeURIComponent(label)}`); }
export const ADMIN_TOAST_EVENT = "admin:toast";
export type AdminToastDetail = { kind: "ok" | "err"; label: string };
// client-notify.ts
export function clientToast(detail) { window.dispatchEvent(new CustomEvent(ADMIN_TOAST_EVENT, { detail })); }
```
Server actions end with `notifyOk("/admin/users", "Rol güncellendi")`; `src\app\(dashboard)\admin\_toast.tsx` (rendered inside a `<Suspense>` in the admin layout) reads the query params and/or listens for the custom event.

---

## 6. ENV + OPS

### 6.1 `src\lib\env.ts` — complete variable list

```ts
const PublicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL:             z.string().url(),                 // required
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(20),               // required
  NEXT_PUBLIC_SITE_URL:                 z.string().url().optional(),
  NEXT_PUBLIC_POSTHOG_KEY:              pre(emptyToUndefined, z.string().min(10).optional()),
  NEXT_PUBLIC_POSTHOG_HOST:             pre(emptyToUndefined, z.string().url().optional()),
});
const ServerSchema = PublicSchema.extend({
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20).optional(),
  TELEGRAM_BOT_TOKEN:        z.string().min(10).optional(),
  TELEGRAM_CHAT_ID:          z.string().optional(),
  QR_SECRET:                 z.string().min(16),   // required
  COOKIE_SECRET:             z.string().min(16),   // required
  POSTHOG_PERSONAL_API_KEY:  pre(emptyToUndefined, z.string().min(10).optional()),
  POSTHOG_PROJECT_ID:        pre(emptyToUndefined, z.string().optional()),
  GROQ_API_KEY:              pre(emptyToUndefined, z.string().min(10).optional()),
});
```
**Four hard-required vars:** `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `QR_SECRET`, `COOKIE_SECRET`. `emptyToUndefined` treats `""` as absent (common .env footgun).

Three-mode failure (lines 30–80):
- `NEXT_PHASE === "phase-production-build"` → write a warning to stderr and return a stub `{URL:"", KEY:"", QR_SECRET:"", COOKIE_SECRET:""} as Env` so CI builds without runtime secrets succeed.
- production runtime → `throw new Error("Missing or invalid environment variables: …")`.
- development → same throw plus "Copy .env.local.example to .env.local and fill in the values." (that example file is **not in the repo**).

Evaluated once at module load: `export const env: Env = getEnv()`.

Note the naming drift: `README.md:16` still says `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the code wants `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Also `src\lib\supabase\client.ts` reads `process.env.*!` directly rather than going through `env` (browser bundle constraint).

### 6.2 `src\app\api\health\route.ts`
`export const dynamic = "force-dynamic"`. `getServerClient()` → `.from("categories").select("id").limit(1).maybeSingle()`. Error → `503 {ok:false, error}`; success → `200 {ok:true, ts:<ISO>, db:"ok"}`. Always `Cache-Control: no-store`. Skipped by `proxy.ts` session handling.

Ops purpose (README:82–98): Supabase free tier pauses after 7 days idle. Set up **cron-job.org** → GET `https://<deploy>/api/health` every 6 hours, email-on-failure enabled. The `SELECT` counts as activity and resets the clock; the alert gives a ≤6 h detection window.

### 6.3 `src\app\api\diag\route.ts`
Debug-only, **unauthenticated, and it writes real rows.** Picks the first `menu_items` row with `price > 0`, builds a payload for table `S1` with `note: "diag-three-paths"`, then exercises three code paths and returns all results as JSON:
- **A** — raw `getServerClient().from("orders").insert(...)` (cookie/RLS path).
- **B** — direct `await submitOrder(payload)`.
- **C** — reflectively finds the `submitOrder` server-action id by reading `.next/server/app/(public)/[locale]/page/server-reference-manifest.json` (falling back to `.next/dev/...`) and matching `exportedName === "submitOrder"`, then POSTs `/en` with headers `Accept: text/x-component`, `Next-Action: <id>`, forwarded `Cookie`.

This exists because order submission was silently failing in prod (see `memory\project_supabase_orders.md`). **Do not port as-is** — it inserts orders and leaks schema.

### 6.4 `scripts\_check-policies.mjs`
22 lines. Hand-parses `.env.local` (split on the first `=`, skip blanks/`#`), then POSTs to `${NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql` with the service-role key and body
```sql
select policyname, cmd, roles, qual, with_check from pg_policies where tablename = 'orders'
```
printing status and raw text. **Requires an `exec_sql` RPC that this repo never creates** — it must have been added manually, or the script simply 404s.

### 6.5 CI / deploy
No `.github/`, no `vercel.json`, no Dockerfile. Deployed to Vercel (evidence: `@vercel/analytics` dependency, `upper-deck.vercel.app` in `.claude\settings.local.json`, `.vercel` in `.gitignore`). `README.md:109` flags that Vercel Hobby is non-commercial-only and suggests Vercel Pro ($20/mo) or Cloudflare Pages for a paying client. `memory\feedback_no_github.md` records a standing instruction never to push to GitHub. `next.config.ts`: `typedRoutes:false`, image `remotePatterns` for `**.supabase.co/storage/v1/object/public/**`, `qualities:[75,90]`, `minimumCacheTTL: 2592000` (30 days, because Supabase objects send no TTL), `optimizePackageImports: ["lucide-react"]`.

---

## 7. AUTH / ROLES FOR THE DASHBOARD

### 7.1 `src\lib\auth\require-session.ts`
```ts
export async function requireSession(callbackUrl = "/admin") {
  const supabase = await getServerClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) redirect(`/login?next=${encodeURIComponent(callbackUrl)}`);
  return { user: data.user, supabase };
}

export async function requireRole(allowed: Role | Role[], callbackUrl = "/admin") {
  const { user, supabase } = await requireSession(callbackUrl);
  const { data: profile } = await supabase.from("profiles")
    .select("id, role, display_name").eq("id", user.id).single();
  if (!profile) redirect("/login?error=no_profile");
  if (!(Array.isArray(allowed) ? allowed : [allowed]).includes(profile.role))
    redirect("/admin?error=forbidden");
  return { user, profile, supabase };
}
```
`server-only`. Note that the profile read itself goes through RLS (`profiles_self_read`, which always allows `auth.uid() = id`). Both CLAUDE.md:81 and ARCHITECTURE.md:126 stress: **RLS is the authoritative gate; `requireRole()` exists for UX (redirect instead of 403), never as the only gate.**

### 7.2 Login flow
- `src\app\(dashboard)\login\actions.ts` — `signIn(formData)`: Zod `{email: email().trim().toLowerCase(), password: min(8), next?}`; parse failure → `redirect("/login?error=Enter a valid email and 8+ char password.")`; `supabase.auth.signInWithPassword(...)`; error → `redirect("/login?error=" + message)`; success → `redirect(next.startsWith("/") ? next : "/admin")` (open-redirect guard).
- `src\app\(dashboard)\logout\route.ts` — `POST` only: `supabase.auth.signOut()` then 303 to `/login`. Invoked by `<form action="/logout" method="post">` in the sidebar.
- `src\app\auth\callback\route.ts` — PKCE/OAuth: reads `?code`, `exchangeCodeForSession(code)`, redirects to `?next` (must start with `/`) else `/admin`; on any failure `/login?error=oauth_failed`.
- `src\app\(dashboard)\auth\set-password\page.tsx` — invite landing (client). Subscribes to `onAuthStateChange` for `SIGNED_IN | PASSWORD_RECOVERY | USER_UPDATED`; in parallel manually parses `window.location.hash` for `access_token`/`refresh_token` and calls `setSession(...)` as a fallback; if neither, checks `getSession()` and otherwise shows "Invalid or expired invite link." Then password ≥8 + confirm match → `supabase.auth.updateUser({password})` → `router.replace("/admin")`.
- Route protection: `proxy.ts` redirects unauthenticated `/admin*` → `/login?next=…`; `src\app\(dashboard)\admin\layout.tsx:7` then does `requireRole(["admin","owner","dev"])`.

### 7.3 Users admin — `src\app\(dashboard)\admin\users\`

`page.tsx` (`requireRole(["owner","dev"])`, `dynamic = "force-dynamic"`): uses `getAdminClient()` to `auth.admin.listUsers({perPage: 200})` joined against `profiles` (id, role, display_name) by id, sorted by email. If the service-role key is missing it catches and renders a "Yapılandırma Gerekli / SUPABASE_SERVICE_ROLE_KEY" panel instead of crashing. Three role-description cards render the canonical Turkish definitions:
- **Sahip (owner)** — "Tam erişim. Personel davet eder, rolleri yönetir, her şeyi kontrol eder."
- **Admin** — "Menü, kategoriler, ayarlar ve siparişleri yönetir. **Kullanıcıları yönetemez.**"
- **Dev** — "Geliştirici — tüm yetkiler ve Analitik sekmesine erişim."

`actions.ts` — all three gated `requireRole(["owner","dev"])`, all use `getAdminClient()`, `RoleSchema = z.enum(["admin","owner","dev"])`:

| Action | Rules |
|---|---|
| `setRole(formData)` | uuid + role parse; **throws if `userId === actor.id`** ("You cannot change your own role."); if the new role isn't `owner`, counts existing owners and throws "Cannot remove the last owner." when the target is the sole owner; `profiles.update({role})`; `updateTag("settings")`; `notifyOk("/admin/users","Rol güncellendi")` |
| `removeUser(formData)` | same self-guard ("You cannot remove yourself.") and last-owner guard; `admin.auth.admin.deleteUser(userId)`; `updateTag("settings")`; `notifyOk(…, "Kullanıcı kaldırıldı")` |
| `inviteUser(prevState, formData)` | `useActionState` shape `{error, success}`; `admin.auth.admin.inviteUserByEmail(email, { data: { display_name: email.split("@")[0] }, redirectTo: \`${NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"}/auth/set-password\` })`; then `profiles.update({role})` on the new user id (the `handle_new_user` trigger has already created the row as `admin`); returns errors instead of throwing |

The last-owner check has a TOCTOU race (two concurrent demotions could both pass) and there is no DB-level constraint backing it.

### 7.4 Per-route permission summary

| Route / action group | Gate |
|---|---|
| `/admin` (layout, whole tree) | `["admin","owner","dev"]` |
| `/admin/menu/**` actions | `["admin","owner","dev"]` |
| `/admin/categories/**` actions | `["admin","owner","dev"]` |
| `/admin/addons/**` actions (8 actions) | `["admin","owner","dev"]` |
| `/admin/suggested/**` actions (6 actions) | `["admin","owner","dev"]` |
| `/admin/settings` `saveHeroSettings` | `["admin","owner","dev"]` |
| `/admin/qr` `setTableWaiterDisabled` | `["admin","owner","dev"]` |
| `/admin/analytics` page + all actions | `["owner","dev"]` |
| `/admin/analytics/sales` page + actions + detail-actions | `["owner","dev"]` |
| `/admin/users` page + `setRole`/`removeUser`/`inviteUser` | `["owner","dev"]` |
| `/admin/orders` | **route missing** |

---

## 8. Porting checklist / gotchas

1. Write a real migration for `settings` (`key text primary key, value text`) plus RLS — it's load-bearing for hero, waiter kill-switch, and every analytics preference.
2. Decide the ordering model up front: either wire the cart to `submitOrder` (and write the `CartItem[] → ItemSchema[]` mapper, deciding how `extras`/`itemNote` are snapshotted) or keep the waiter-call-only flow and treat `orders` as an analytics artefact.
3. Add `/admin/orders/page.tsx` (server component fetching initial orders, gated `["admin","owner","dev"]`) and make the four status buttons actually write.
4. Pick **one** Telegram path. Running both double-notifies. Path B is strictly better (buttons + status write-back); Path A is the only one that handles waiter calls.
5. Pick **one** owner of the bot's webhook slot — `/api/telegram/register` and SETUP.md Step 6 fight over it. If you keep the Next route, add a `secret_token` and auth-gate the register endpoint.
6. HTML-escape all user text before `parse_mode: "HTML"` (order notes and table ids reach Telegram unescaped today).
7. `callWaiter` trusts the client's table string and has no server-side rate limit — verify the signed `table_session` cookie server-side and add a real limiter if you care.
8. Ship an actual `public/notification.mp3` (only a `.txt` TODO exists).
9. `scripts\generate-table-qrs.mjs` signs tokens the current verifier rejects — port `admin\qr\page.tsx` instead, or fix the script to use `v2|…&w=0` and `TABLE_IDS`.
10. `addon_group_items` and `addon_option_reveals` use `auth.role() = 'authenticated'` instead of `current_role() in (...)` — any signed-in user can write them. Normalise if you want consistent role gating.
11. `defaultLocale` is `tr`, `/admin/qr` hardcodes `/tr/scan`, and the whole admin UI is Turkish — the docs claiming `en` are stale.
12. Two dev emails are hardcoded in `20260704000001_dev_role_grants.sql:15` — parameterise for your own deployment.
---

Part B — frontend / analytics / admin

I have a complete picture. Here is the spec.

---

# UpperDeck — functional spec for re-implementation

**Repo root (all paths below are relative to this absolute root):**
`<upperdeck-clone>`

Referred to as `<ROOT>`. Single commit: `b7416e9 analytics update v3.8`.

Stack: **Next.js 16.2.0 (app router, `proxy.ts` replaces `middleware.ts`) · React 19.2.4 · Tailwind v4 (`@tailwindcss/postcss`, no `tailwind.config`) · Supabase (Postgres+Auth+Realtime+Storage) · PostHog (posthog-js + HogQL Query API) · Recharts 3 · Groq LLM · Telegram Bot API · zod 4 · xlsx**.

Two docs worth reading first: `<ROOT>/docs/ARCHITECTURE.md` and `<ROOT>/CLAUDE.md`. ⚠️ Both are partially stale — see "Doc/code discrepancies" at the end.

---

# 1. GUEST-FACING FRONTEND

## 1.1 Route shell

**`<ROOT>/src/proxy.ts`** (Next 16 proxy convention, matcher `/((?!_next|.*\..*).*)`)
- L12-14: skips session refresh for `/api/telegram`, `/api/health`.
- L16: `refreshSession(request)` (`<ROOT>/src/lib/supabase/proxy.ts`) rotates Supabase auth cookies.
- L18-26: `/admin/*` with no user → redirect `/login?next=<path>`.
- L28-30: pass-through for `/admin`, `/login`, `/logout`, `/auth`, `/api`.
- L32-39: any other path without an `/en` or `/tr` prefix → **redirect to `/${defaultLocale}${pathname}`**. No `Accept-Language` sniffing (the docs claim otherwise).

**`<ROOT>/src/app/(public)/[locale]/layout.tsx`**
- Fonts via `next/font/google` (L2, L8-24): `Alfa_Slab_One` → `--font-alfa-slab` (hero display), `Teko` → `--font-bowlby-one` (condensed display; the CSS var name is a legacy of Bowlby One), `Inter` → `--font-inter-next` (UI).
- L26-30 metadata: title "Upperdeck American Diner", icon `/upperdeck-logo.png`.
- L47: `<html lang="en" data-locale={lang}>` — **deliberately `lang="en"` even for Turkish**, so CSS `text-transform:uppercase` uses Latin casing (i→I not i→İ). Documented at `<ROOT>/src/app/globals.css` L30-32.
- L48: `<body className="no-scroll">` (`overflow:hidden`, globals.css L34-36) — the app is a fixed viewport with an internal scroll container.
- L50: `<Analytics />` from `@vercel/analytics/next`.

**`<ROOT>/src/app/(public)/[locale]/page.tsx`** (server, `dynamic = "force-dynamic"`)
- L27-32 parallel: `getMessages(lang)`, `getPublicMenu(lang)`, `getHeroSettings()`, `getWaiterDisabledTables()`.
- L34-42 table resolution: `?t=<id>` validated by `isValidTableId`, **but the signed `table_session` cookie wins**; URL param is the dev/staff fallback.
- L44-45: locale-specific opening-hours override from settings.
- L47-63: passes everything to `<PhoneMenu>`.

**`<ROOT>/src/app/(public)/[locale]/loading.tsx`** — full-screen `Loader size="lg"` + wordmark "UPPER<span orange>DECK</span>" in `font-hero`.

**`<ROOT>/src/app/(public)/[locale]/scan/route.ts`** — the QR landing endpoint. `GET /:locale/scan?t=&w=&tok=`; verifies the HMAC token (`verifyToken`), then sets an httpOnly `table_session` cookie signed with `COOKIE_SECRET`, `maxAge` 28800 (8 h), and 303-redirects to `/${locale}`. Invalid → redirect with `?scan_error=1`.

**`<ROOT>/src/lib/table-auth.ts`** — HMAC-SHA256, `TOKEN_VERSION = "v2"`; `generateToken(table)` produces a permanent 16-hex token (`w` always 0); `signTableCookie` / `verifyTableCookie` produce `base64url(payload).hexsig` with `exp`, `timingSafeEqual` comparison.
**`<ROOT>/src/lib/tables.ts`** — hard-coded `TABLE_IDS` (S1-S4, T1-T10, KAMARA, 1,4,6…16) drives both QR printing and validation. `""` reserved as "unknown table".

## 1.2 Page structure, top to bottom (what the guest sees)

`<ROOT>/src/components/PhoneMenu/components.tsx` is the single orchestrator (599 lines, ~15 `useState` hooks, deliberately un-abstracted). Layout: `fixed inset-0 flex flex-col` (L421).

1. **`<PostHogProvider>`** (L422) — renders null, initializes analytics.
2. **`<TopBar>`** (L424-433) — fixed header, `shrink-0`.
3. **Scroll container** (L437-441): `h-full overflow-y-auto bg-bg`, scrollbars hidden, `overflowAnchor: none`. `onScroll={handleScroll}`.
   - **`<Hero>`** (L442-458)
   - hero sentinel div (L459) — IntersectionObserver target
   - **`<FilterPills>`** in a `sticky top-0 z-10` wrapper (L460-468)
   - **`<MenuStage>`** (L469-477)
   - **`<Footer>`** (L478)
4. **Scroll-to-top FAB** (L480-492) — bottom-right, `w-10 h-10 bg-green`, appears when `scrolledDown && !footerVisible && !activeItem`, opacity/translate transition 300 ms.
5. **`<WaiterButton>`** (L493-513) — bell FAB bottom-left.
6. **`<CartDrawer>`** (L515-554) — bottom sheet.
7. **`<ItemModal>`** (L555-570) — bottom sheet.
8. **`<QrRequiredModal>`** (L571-576).
9. **`<Toast>`** (L577), **`<OfflineBanner>`** (L578).
10. **`<Ticker>`** (L579) — bottom marquee strip, part of the flex column (always visible, `h-8`).
11. **`<BellTutorial>`** (L580-596) — conditional first-scan overlay.

## 1.3 Component-by-component

### TopBar — `<ROOT>/src/components/TopBar/components.tsx` (server component)
Props (`./types.ts`): `cartCount, onCartClick, onTopClick, brandMain, brandAccent, brandSub, orderLabel, locale`.
- Left: logo in a white circle (`next/image`, `unoptimized`, `quality 100`) + wordmark `brandMain` + orange `brandAccent`, sub-line `brandSub` at 8 px / `tracking-[0.28em]`. Whole block is a button → `onTopClick` (smooth scroll to top).
- Right: `<Suspense><LocaleSwitcher/></Suspense>` + orange "ORDER" button with a white count chip (L48-57). Border-bottom 2 px green.

### LocaleSwitcher — `<ROOT>/src/components/TopBar/LocaleSwitcher.tsx` (client)
- Globe icon + current code + caret; click toggles a dropdown (`absolute right-0 top-full`, `z-999999`).
- `hrefFor(locale)` (L24-29) rewrites only the leading `/en|/tr` segment and preserves the query string — so `?t=` survives a language switch. Plain `<a>` (full navigation, not client-side).
- Outside-click closes via a `mousedown` document listener (L16-22). Flags 🇬🇧/🇹🇷.
- **No analytics event is fired on locale switch** — locale is a PostHog super-property instead.

### Hero — `<ROOT>/src/components/Hero/components.tsx`
Three modes, chosen by `heroMode` from the `settings` table:
- **`media`** (L22-35): 176 px-tall `<BrandImage fill>` banner, `max-h-56`.
- **`featured`** (L37-97): tappable item photo (h-44) with emoji fallback; optional orange **badge** pill bottom-right; below it an **8 px-tall dark-green marquee** repeating `featuredLabel` ×3 with `animate-[tick_18s_linear_infinite]` and a `✦` separator via `after:content`. Computes `discountedPrice` when `featuredDiscount` is set. Click → `onFeaturedClick`.
- **`none`** (L99-122): four-line `font-hero` 38 px headline where line 2 is orange and line 3 is an **outlined** word (`[-webkit-text-stroke:2px_#395A66] text-transparent`), then a row with `openHours` on the left and `<b>{itemCount}</b> items` on the right.
- All three collapse via `max-h-0` + `transition-all duration-500` when `collapsed` — though PhoneMenu always passes `collapsed={false}` (L443); collapse is instead expressed by FilterPills' `compact`.

### Ticker — `<ROOT>/src/components/Ticker/components.tsx`
A permanently visible bottom marquee strip (h-8, bg `#243845`, `border-t-2 border-orange`). Takes `tags: readonly string[]` (from `t.ticker` in the i18n bundle — 9 marketing phrases like "Smashed Burgers", "Open Late"). Tripled (`[...tags,...tags,...tags]`) and animated with `animate-[tick_22s_linear_infinite]`; the `tick` keyframe translates `-100%/3` (globals.css L52-55) so the loop is seamless. Each span gets a `✱` separator via `after:content`. `constants.ts` holds `TICKER_DURATION_S = 22`.

### FilterPills — `<ROOT>/src/components/FilterPills/components.tsx`
**They are NOT dietary filters.** They are a horizontally-scrolling **category jump-nav / scroll-spy**:
- One pill per top-level category: `{ id: slug, label: name, image_url, emoji }` (PhoneMenu L418).
- Pill = 96 px-wide thumbnail (56 px tall) over a wrapped label. Active pill inverts to `bg-green text-bg`.
- **`compact` prop** collapses the thumbnail to `height: 0` with a 300 ms transition once the hero scrolls out (L25-28) — the pill rail shrinks to a text-only bar.
- A right-edge gradient fade hints at overflow (L50).
- Click → `handlePillSelect` (PhoneMenu L332-352): fires `track.categorySelected(slug)`, sets `activeSlug`, sets an `isAutoScrolling` guard for 800 ms, smooth-scrolls the stage so the section header lands just under the sticky pill bar, and centers the pill itself (`scrollPillIntoView`, L321-330, using `CSS.escape` + `scrollBy`).
- Scroll-spy: `handleScroll` (L392-416) walks `[data-cat]` headers and sets `activeSlug` to the last one above the fold; `useEffect` L354-356 re-centers the pill.
- `constants.ts` only exports the unused `ALL_CATEGORY = "All"`.

### MenuStage — `<ROOT>/src/components/MenuStage/components.tsx`
Renders category sections. Note `constants.ts` still contains a **dead** absolute-positioning "scattered card" layout system (`SIZE_PX`, `ROTATION_RANGE`, `Y_JITTER`) plus `<ROOT>/src/lib/rng.ts` (`mulberry32`, `hashStr`) — the current implementation is a plain vertical list (`rot/w/h/x/y` are all set to 0, L17).
- L10-39 `sections` memo: groups items by `cat` slug, then by `subcat` when a category has subcategories; applies `enrich()` which maps `highlight` → `fill` and injects `discountPct` for the single featured item.
- Section header (L63-105): full-width category image (`h-28`) with emoji fallback, then a row with the category name (`font-bowlby` 22 px) + "N items" in orange + a `▾` chevron that rotates 180°. The whole header is a button that **collapses the section**.
- Collapse animation: the CSS-grid trick — `grid` with `gridTemplateRows: isCollapsed ? "0fr" : "1fr"` and `transition-[grid-template-rows] duration-350` (L108-112). Sub-groups use the same trick at `duration-300` (L136-139).
- Sub-categories: own tappable header (`bg-bg-deep`, `border-l-4 border-green/20` on the body), **default-collapsed** (L46-54).

### MenuCard — `<ROOT>/src/components/MenuCard/components.tsx`
Horizontal row card, full width, 1 px green border, `active:scale-[1.02]` with a 250 ms cubic-bezier transition.
- `data-item={card.id}` — the hook the featured-hero scroll uses.
- **Image preloading** (L4-9, L35-36): on `touchstart`/`mouseenter` it constructs `/_next/image?url=…&w=384&q=80` and warms it in a `new Image()` so the modal opens instantly.
- 128×128 thumbnail with emoji fallback; **sold-out stamp** = an absolutely-positioned double-bordered `#CC2222` box rotated −15° with `mixBlendMode: multiply` and a white text-shadow halo (L60-98).
- Text: `font-bowlby` 17 px name + optional 🌶 chip (circle, green or orange depending on card fill), `line-clamp-2` description at 13 px.
- Price column: plain orange price, or — when `discountPct` — struck-through original, orange discounted price, and a `-N%` line (L140-156).
- `fill` (`green-fill` / `orange-fill`, from `menu_items.highlight`) tints the card `bg-green/10` or `bg-orange/10` and adds an `inset 0 0 0 4px` box-shadow ring (L15-20).

### ItemModal — `<ROOT>/src/components/ItemModal/components.tsx` (719 lines, the richest component)
Bottom sheet: `absolute inset-x-0 top-0 bottom-8` (bottom-8 leaves the Ticker visible), backdrop `rgba(31,46,38,0.78)`, sheet `max-h-[90dvh]`, entrance `animation: slideUp 0.25s cubic-bezier(0.2,0.8,0.2,1)` (L417).
State: `showStamp, lightbox, selected (Record<optionId, boolean>), itemNote, atBottom, imageLoaded`. All reset on `item?.id` change (L226-233).

- **Drag-to-close** (L337-396): armed **only** from the header ref (drag handle + image), never the body, so horizontal add-on rails and the textarea aren't hijacked. Direction intent is resolved after 8 px (`vertical` vs `horizontal`); >80 px down closes.
- **Header**: 3 px drag pill; hero image rendered as *three* stacked layers — a blurred `scale-110 blur-sm` placeholder, a branded `<Loader size="md" tone="onDark">` overlay, and the full-res image that fades in on `onLoad` (L428-459). An expand glyph bottom-right.
- **ImageLightbox** (L13-196): full-screen `z-2000` `bg-green/95`. Implements pinch-zoom (1×–5× via `pinchDist`), double-tap zoom to 2.5×, pan with `clampPan()`, drag-to-dismiss (>100 px in either direction slides out and closes), backdrop opacity tied to drag distance, and correct 2→1-finger baseline re-seeding (L132-138).
- **Sold-out stamp** (L463-487): appears 300 ms after open with `animation: stampSlam 0.4s` (globals.css L88-92: scale 4 → 0.95 → 1 while rotated −15°).
- **Sticky name header** (L497-504): category eyebrow (+ `· 🌶 Spicy`), 28 px `font-bowlby` name — stays put while the body scrolls.
- **Body** (scrollable, hidden scrollbar): `hook` (11 px, uppercase, `tracking-[0.18em]` — the short "sweet · crispy · caramel" flavour line) then `desc` (12 px paragraph).
- **Add-on groups** (L518-622):
  - Group header = label + a **Required** chip that turns `bg-orange text-white` when unsatisfied.
  - Options render in a horizontal scroll rail. Two variants: **media tile** (80 px wide, 64 px image/emoji, label + `+N₺`) when the option has an image/emoji, or a compact **text chip** otherwise. Selected → `border-green` + `bg-green` label plate.
  - `multi` group = checkbox semantics; single = radio (selecting clears siblings, L311-324).
  - **Reveals** (L571-617): selecting an option can expose nested sub-groups, rendered indented with `border-l-2 border-orange/40`, orange labels, and their own required chips. Deselecting the parent clears all revealed selections (L308-310, L316-318, L321-323).
  - `revealedGroups` are de-duplicated by group id (L255-271); `selectedExtras` merges main + revealed picks and tags each with `required` + `groupLabel` (L273-281); `missingRequired` blocks the CTA (L285-291).
- **Special instructions** textarea, 2 rows, hard-capped at 120 chars (L629-635).
- **"Also try this" rail** (L639-671): suggested items as 80 px tiles; click closes the modal and opens the suggested item (`onSuggestedClick`).
- **Price row** (L673-683): `Price` label vs. `font-bowlby` 24 px total = base (discounted if applicable) + `extrasTotal`.
- **CTA**: full-width orange button, disabled when `sold_out` or `missingRequired.length > 0`; label becomes `SOLD OUT`.
- **Scroll hint** (L700-713): a bouncing chevron over a bottom gradient, fading out when `atBottom`.

### CartDrawer — `<ROOT>/src/components/CartDrawer/components.tsx`
Bottom sheet from `top: topOffset` (the TopBar height, PhoneMenu L541) down, `z-99999`, `animate-[slideUp_0.25s…]`.
- Drag-to-close (L47-90): only armed when the list isn't scrolled or the touch started in the header; >80 px closes; backdrop opacity tracks the drag and is **explicitly reset** on close (L77, with a comment explaining the stale-opacity bug).
- Header: drag pill on a green bar, "Your Order" title, orange × button.
- **Table row** (L137-151): only rendered when a table is set; shows the number in orange plus a "from QR" chip. There is **no free-text table entry** in the current UI (`onTableChange` is passed but unused).
- **Empty state** (L155-168): 🍽️ emoji, "Your order is empty", a "Browse the menu" button.
- **Line items** (L170-229): name, per-extra sub-lines (`Group: Label` for required picks, `+ Label` for optional ones), italic orange item note, then `−  qty  +` controls, line total, and an `×` remove.
- **Order note** textarea inside the scroll area, 200-char cap with a live `n/200` counter (L233-248).
- **Submitting overlay**: `bg-bg/80` + `Loader size="md"` (L251-255).
- **Footer** (L258-298): Subtotal, then `<CouponSection>`, then the primary CTA.
- ⚠️ **The primary CTA is "Call Waiter", not "Place order".** `handleCartCallWaiter` (PhoneMenu L238-255) dynamically imports `callWaiter(table, "order")` → a Telegram ping "🍽️ Masa X sipariş vermek istiyor". After it fires, the button is replaced by a green banner "A waiter is headed your way to place your order!" plus a cooldown line. **`submitOrder` is never called from the guest UI** — it survives only in `<ROOT>/src/app/api/diag/route.ts`.

### CouponSection — `<ROOT>/src/components/CartDrawer/CouponSection.tsx`
A **deliberate newsletter-capture funnel, not a real coupon engine**:
- Uppercase text input + "Apply" button. `handleApply` (L40-44) does **no validation and no lookup** — it just sets `attempted` and opens the newsletter panel.
- Below the input, a persistent hint: "No coupon? Subscribe to our newsletter **here**".
- Panel (L97-145): when `attempted`, headline "No offer found"; body "Subscribe to our newsletter and be the first to get exclusive deals"; email input + orange Subscribe button (`useTransition`, `Loader size="xs"` while pending) → `subscribeNewsletter(email)`.
- `<ROOT>/src/lib/newsletter/subscribe.ts` — server action, regex email check, inserts into the `newsletter` table (RLS: anon insert allowed, migration `20260507000001_newsletter.sql`); PG error `23505` (duplicate) is treated as success with `alreadySubscribed: true`.

### WaiterButton — `<ROOT>/src/components/WaiterButton/components.tsx`
- Floating 48 px green bell FAB, bottom-left, `z-99999`. Hidden (opacity 0 + `translate-y-4` + `pointer-events-none`) when the footer is visible, an item modal is open, or the table is in `disabledTables`. A cooldown badge (`m:ss`) sits at its top-right.
- `onBeforeOpen` (PhoneMenu L504-510) gates on a table: no table → opens `QrRequiredModal` and returns false.
- **WaiterSheet** (L11-69): pointer-events drag-to-close (>80 px), `slideUp` entrance, `min-h-[340px]`. `position` flips `fixed`↔`absolute` based on `heroCollapsed` (L46) — a workaround for the scroll container.
- Two big buttons: **"Hesap (Bill)"** (orange, `callWaiter(table,"bill")` → `💳 Hesap İsteniyor — Masa X`) and **"Call Waiter"** (outlined, `→ 🙋 Garson Çağrısı — Masa X`).
- Phase machine `idle | open | sending | done | failed` (L99); `done`/`failed` show a ✓/✗ panel and auto-return to `idle` after 2500 ms. Fires `track.waiterCalled(reason)` and `buzz()` haptics.
- `WAITER_COOLDOWN_MS = 10_000` (`constants.ts`). Cooldown state is owned by PhoneMenu and **persisted in `localStorage` under `waiter_t<table>`** (PhoneMenu L141-181), restored on mount and ticked down by a 1 s interval.

### BellTutorial — `<ROOT>/src/components/BellTutorial/components.tsx`
One-shot coach-mark shown on first scan of a valid, waiter-enabled table (PhoneMenu L116-124; `sessionStorage["bellTutorial_seen"]`). Also suppressed while any modal/cart is open (L580-586).
- Full-screen `z-99997` overlay whose background is a **radial-gradient spotlight punched out around the bell** (L34-37): `radial-gradient(circle 64px at 40px calc(100% - 80px), transparent 36px, …0.94) 160px)`.
- Centred copy: orange eyebrow + white 30 px `font-bowlby` title, both with text-shadow.
- A hand-drawn curved SVG arrow from the text down to the bell, stroke-dash animated (`arrowDraw 0.9s`), with an arrowhead that fades in at 0.85 s, the whole group floating via `tutorialFloat 1.8s infinite` (L73-109).
- Bottom-right hint "tap anywhere to continue"; auto-dismiss after 6000 ms, fade-out 200 ms (L5-6, L24-28).

### QrRequiredModal — `<ROOT>/src/components/QrRequiredModal/components.tsx`
Bottom sheet (`z-[999999]`) with pointer drag-to-close. Body renders **`QrIllustration`** — a hand-authored 21×21 SVG bitmap of a fake QR code (three finder patterns + noise, L12-67) drawn in `var(--color-green)`. Copy: "Please scan QR code / Scan the QR code on your table to place an order or call a waiter."

### OfflineBanner — `<ROOT>/src/components/OfflineBanner/components.tsx`
`useEffect` reads `navigator.onLine` and subscribes to `online`/`offline` window events. When offline, renders a fixed top orange bar (`z-100000`, `role="status" aria-live="polite"`) with `t.offline.banner`. Renders `null` otherwise. **There is no service worker and no manifest** — this is purely a connectivity notice.

### Toast — `<ROOT>/src/components/Toast/components.tsx`
`fixed left-1/2 bottom-28 -translate-x-1/2`, green pill, `z-100000`, `role="status"`. Shows/hides with `translate-y-[140%] + opacity + visibility` over 350 ms. `TOAST_DURATION_MS = 1700` (`constants.ts`). Driven by `flashToast` (PhoneMenu L183-188).

### Loader — `<ROOT>/src/components/Loader/components.tsx`
Brand loader: the logo PNG pulsing (`logoPulse 1.6s`) inside a rotating SVG arc ring (`spinRing 1.2s linear`, dash array = 28 % of the circumference). Sizes `xs|sm|md|lg` from `SIZE_MAP` (14/28/52/88 px logo), tones `onLight` (orange stroke) / `onDark` (cream). Optional `label` under it. Used in loading.tsx, BrandImage, ItemModal, CartDrawer, WaiterButton, all admin submit buttons, and the analytics range switcher.

### Footer — `<ROOT>/src/components/Footer/components.tsx`
Green block, cream text. Contact (email + phone as `mailto:`/`tel:`), Socials (inline SVG paths for Instagram / TikTok / WhatsApp), a divider, and an absolutely-positioned **"Developed by KAGU"** credit linking to `kagusoftware.com` with the logo inverted via `filter: brightness(0) invert(1)`. All brand strings are hard-coded here (not i18n).

### BrandImage — `<ROOT>/src/components/BrandImage/components.tsx`
The universal image wrapper. Discriminated props: `{fill: true}` or `{width, height}`. Behavior:
- While `!loaded && !errored`: an absolutely-positioned `bg-bg-deep` box with a `<Loader>` at `loaderSize`.
- The `next/image` itself is `opacity-0 → opacity-100` with a 300 ms transition on `onLoad`.
- On `onError`, if a `fallback` node was supplied it replaces the image entirely (the emoji fallback everywhere).
- Defaults: `quality=90`, `lazy=true` (→ `loading="lazy"` unless `priority`).
- Remote Supabase URLs are allowed by `<ROOT>/next.config.ts` L8-12 (`**.supabase.co/storage/v1/object/public/**`), with `qualities: [75, 90]` and `minimumCacheTTL: 2592000` (30 days, because Supabase objects send no TTL).

### ConfirmDialog — `<ROOT>/src/components/ConfirmDialog/components.tsx`
Centred modal (`z-100000`, `bg-black/50`), Escape-to-cancel, backdrop click cancels, confirm button `autoFocus` and orange when `destructive`. **Guest-side unused**; it is the admin destructive-action pattern (menu list, categories list, addon group delete, user removal).

### Haptics — `<ROOT>/src/lib/haptics.ts`
Two functions only: `tap()` → `navigator.vibrate?.(10)`, `buzz()` → `navigator.vibrate?.([12,40,12])`. Both `?.`-guarded. `tap()` fires on add-to-cart (PhoneMenu L297); `buzz()` fires on every waiter/bill call (PhoneMenu L246, WaiterButton L121).

**Animation summary: there is no framer-motion.** Everything is CSS keyframes in `globals.css` (L52-164: `tick, slideUp, pulse-border, flicker, shimmer, logoPulse, spinRing, stampSlam, screenShake, shockwave×3, redFlash, sparkFly, arrowBounce, fadeIn/Out, arrowDraw, tutorialPulse, tutorialFloat, fireGlow`) plus Tailwind transitions and direct `style.transform` writes during touch drags. Several keyframes (`screenShake`, `shockwave*`, `sparkFly`, `fireGlow`, `flicker`) are currently unused leftovers.

## 1.4 Data model behind the guest menu

`<ROOT>/src/lib/menu/queries.ts` (294 lines, `server-only`, both queries wrapped in `unstable_cache` with tags `menu` / `hero`, read through a **cookie-free anon `getCacheClient()`**).

**`getHeroSettings()`** (L25-64) reads 8 keys from the `settings` k/v table: `hero_mode`, `hero_media_url`, `featured_item_id`, `featured_label`, `featured_badge`, `featured_discount`, `open_hours_tr`, `open_hours_en`. When mode is `featured`, it additionally fetches the item row.

**`getPublicMenu(locale)`** (L95-288):
- Categories: `select(id, slug, name_<n>, sort_order, emoji, image_url, parent_id)`; `parent_id` builds the two-level hierarchy (L184-212).
- Items: `is_available = true` only; selects `name_<n>, hook_<n>, desc_<n>, emoji, highlight, image_url, price, spicy, sold_out`.
- **`highlight`** is `'green-fill' | 'orange-fill' | null` (migration `20260427000003_highlight.sql`) → drives MenuCard tint/ring and ItemModal header colour.
- **`hook` vs `desc`** (migration `20260427000004_hook_desc.sql`): the original `desc_*` columns were **renamed to `hook_*`** (a 3-word flavour line: "sweet · crispy · caramel") and new `desc_*` columns were added for the long modal paragraph. The card shows `desc` (line-clamped 2); the modal shows `hook` then `desc`.
- Sorting (L217-228): top-category sort_order → sub-category sort_order → item sort_order → localized name.
- **Add-ons** (L123-167): one deep query on `addon_groups` with `addon_group_items(menu_item_id)`, `addon_options!addon_group_id(... menu_items(image_url, emoji), addon_option_reveals(sort_order, addon_group_id))`. Two passes: build a `groupById` map, then resolve `revealedGroups` by id (avoids infinite nesting). Option imagery is inherited from a linked `menu_item` (`addon_options.menu_item_id`).
- **Resolution precedence** (L235-243): item-scoped groups win; otherwise category-scoped groups (checking the item's own category *and* its parent).
- **Suggested items** (L169-267): same precedence, flattened, self-excluded, de-duplicated by id.

**`<ROOT>/src/lib/settings/queries.ts`** — `getWaiterDisabledTables()` reads the `waiter_disabled_tables` settings key (JSON array), tolerating legacy `number[]`.

**Live menu refresh:** PhoneMenu L87-93 subscribes to a Supabase broadcast channel `menu-updates` / event `refresh` and calls `router.refresh()`. Every admin mutation calls `broadcastMenuUpdate()` (`<ROOT>/src/lib/broadcast.ts`) plus `updateTag("menu")`.

## 1.5 Cart persistence

- Key: `"upperdeck-cart-v2"` in **`sessionStorage`** (PhoneMenu L31). Shape `{ cartItems, tableNumber, note }` (L33-37).
- Hydration on mount (L96-126), URL/cookie table always wins over the stored one; stored table ids are re-validated with `isValidTableId`.
- Save is **debounced 200 ms** on any change to `cartItems | tableNumber | note` (L129-138), wrapped in try/catch for quota errors.
- Cart-item identity (L285-288): plain items key on `menu_item_id`; items with extras or a note get `${id}__${extraIds.join("_")}__note<first 8 chars>` so variants never merge.
- Effective price (L281-283): `round(price × (1 − discountPct/100)) + Σ extras`.
- Separate persistence: `waiter_t<table>` in `localStorage`, `bellTutorial_seen` in `sessionStorage`.

## 1.6 i18n

- `<ROOT>/src/i18n/config.ts`: `locales = ["en","tr"] as const`, **`defaultLocale = "tr"`** (the docs say `en`).
- `<ROOT>/src/i18n/en.ts` — the shape is defined by the `EnShape` type (L1-44) and exported as `Messages`; `tr.ts` is typed `const tr: Messages` so it can never drift. Namespaces: `brand, hero, topbar, filter, stage, modal, coupon, cart, toast, ticker, waiter, qrRequired, bellTutorial, offline, categories`.
- `<ROOT>/src/i18n/index.ts` — `getMessages(locale)` with an `?? messages.en` fallback. No ICU, no interpolation library; the two placeholder strings (`{count}`) are unused, and pluralisation is done in the caller (PhoneMenu L474: `count > 1 ? t.stage.items : t.stage.item`).
- Content i18n is **parallel DB columns** (`name_en/name_tr`, `hook_*`, `desc_*`, `label_*`) selected dynamically via `` `name_${n}` ``.
- Locale is a PostHog super-property (see §2a). `t.categories` is a legacy map, no longer used (categories come from the DB).

## 1.7 Styling

- `<ROOT>/postcss.config.mjs` — the only build config: `{ plugins: { "@tailwindcss/postcss": {} } }`. **Tailwind v4, CSS-first — there is no `tailwind.config.*`.**
- `<ROOT>/src/app/globals.css` (186 lines): `@import "tailwindcss"` then an `@theme` block (L3-15) defining the whole design system:
  - `--color-bg:#F6F6F6`, `--color-bg-deep:#E8E8E8`, `--color-green:#395A66`, `--color-green-deep:#243845`, `--color-green-dark:#1f2e26`, `--color-orange:#FF5138`, `--color-ink:#1f2e26`.
  - `--font-bowlby` (Teko), `--font-hero` (Alfa Slab One), `--font-ui` (Inter).
  - These generate `bg-bg`, `text-green`, `border-orange`, `font-bowlby`, etc.
- `input, textarea, select { font-size: 16px }` (L26-28) — prevents iOS focus zoom.
- `.shimmer` skeleton (L166-175) and `.shadow-hard` (L180-186) — the analytics dashboard's hard-edged 4 px offset "printed" shadow that deepens on hover.
- **Light theme only.** No dark mode, no `prefers-color-scheme`, no theme toggle.
- **No PWA**: no `manifest.json`, no `next-pwa`, no service worker anywhere in the repo.

---

# 2. ANALYTICS

## 2a. Client tracking

**`<ROOT>/src/components/analytics/PostHogProvider.tsx`** (51 lines)
- Mounted **only inside `PhoneMenu`** (L422) — never in the admin tree, so staff activity is never tracked (stated in the file header).
- No-ops entirely when `NEXT_PUBLIC_POSTHOG_KEY` is absent. Host defaults to `https://eu.i.posthog.com`.
- Init options (L29-37): `person_profiles: "identified_only"`, `capture_pageview: true`, `capture_pageleave: true`, **`autocapture: false`**.
- A **second** effect (L42-48) registers super-properties `locale` and (when known) `table_number`. This ordering matters and is exploited downstream: the opening `$pageview` fires *before* `table_number` exists, which is why every seated-diner filter is **session-level**, not event-level (`posthog.ts` L182-188).
- **No consent gate, no opt-out UI, no cookie banner.** The only "consent" is the absence of the env key.

**`<ROOT>/src/lib/analytics/track.ts`** (75 lines) — thin wrapper. `ph()` returns null unless `posthog.__loaded`; `capture()` swallows every error with a `console.warn` ("Analytics must never break the menu").

| Event | Properties | Fired from |
|---|---|---|
| `item_viewed` | `item_id, item_name, price, category, discount_pct` | `openItem` (PhoneMenu L208) on every modal open; also from `handleSuggestedClick` (L306) |
| `item_view_abandoned` | `item_id, item_name, dwell_ms` | `flushDwell` (L196-202) — only when the modal was closed **without** an add-to-cart and dwell ≥ 5000 ms (<5 s is treated as a mistake tap and dropped client-side). Also flushed on `visibilitychange → hidden` (L221-227) so a phone-lock still records it (posthog-js `sendBeacon` on pagehide) |
| `item_added_to_cart` | `item_id, item_name, price, qty, extras_count, discount_pct` | `handleAdd` (L294) |
| `item_removed_from_cart` | `item_id, item_name` | `handleRemove` (L260) |
| `category_selected` | `category` (slug) | `handlePillSelect` (L334) |
| `cart_opened` | — | `handleCartClick` (L234), only when a table exists |
| `waiter_called` | `kind: "order" \| "bill" \| "waiter"` | cart CTA (L244, kind `order`) and the bell sheet (WaiterButton L117) |
| `featured_item_clicked` | `item_id` | `handleFeaturedClick` (L364) |
| `suggested_item_clicked` | `item_id` | `handleSuggestedClick` (L304) |
| `order_submitted` | `total, item_count` | **dead code** — nothing calls it |
| `order_failed` | `error_type` | **dead code** |

Plus PostHog's own `$pageview` / `$pageleave`. **No scroll-depth event.** Session/table identity = `$session_id` + `distinct_id` + the `table_number`/`locale` super-properties.

## 2b. Admin analytics pages

`<ROOT>/src/app/(dashboard)/admin/analytics/` — auth gate is `requireRole(["owner","dev"])` (page.tsx L86; the `admin` role is excluded, and the sidebar hides the link for it).

### `page.tsx` (470 lines, server, `force-dynamic`)
Order of operations:
1. `requireRole(["owner","dev"])`, then **`loadBusinessDayStart(supabase)` before anything else** (L91) — it decides where a day starts and therefore what "today" means.
2. `resolveRange(sp)` + `resolveCompare(sp, range)`.
3. `engagementWindow(range)` for both current and comparison windows; `engagementComparable` is false when the PostHog data floor makes them unequal lengths → **all engagement deltas become null** rather than a fabricated 10× jump (L100-109).
4. `getExclusionRules(supabase)` serially (the basket query needs `keep` at aggregation time), then **one 32-way `Promise.all`** (L127-235).
5. A second small wave: `getHiddenGems`, `getMenuEngineering`, `getMenuPositionAnalysis` — all fed the already-fetched deep sold list so they cost one extra menu read, not another pass over sales (L257-261).
6. Assembles a single `AnalyticsData` object (L355-458) handed to `<AnalyticsClient>`.

Data sources: **PostHog HogQL** for engagement, **Supabase `sales_entries` / `sales_entry_items`** for real money, **Supabase `orders`** for baskets, **`menu_items` / `categories`** for names/prices/costs/positions, **`settings`** for all owner toggles, and **`analytics_insights` / `analytics_patterns` / `analytics_insight_rejections`** for LLM state.

### `_client.tsx` (2555 lines) — the whole dashboard UI
**Control deck** (L2231-2341), `sticky top-0 z-10` with `backdrop-blur`:
- Row 1: presets `Bugün / 7 Gün / 30 Gün / 90 Gün` (L151-156) + a custom `from`–`to` date pair with an "Uygula" button. Range lives in the URL (`?range=&from=&to=`); switching wraps in `useTransition` and dims the page behind a pinned `Loader` (L2234-2241).
- Row 2: `IgnoreItemsMenu` · `ComparePicker` · `CoversMultiplier` (only when covers are estimated) · `BusinessDayPicker` · `AutoRefresh`. On mobile a `ZoneNav` chip bar is appended.
- **`AutoRefresh`** (L215-309): options Kapalı/1/2/5 dk persisted in `localStorage["analytics-auto-refresh"]`; countdown pill; skips the fetch while the tab is hidden but still re-arms; **disabled entirely on a finished range** (`live=false`, computed server-side by `isLiveRange` to avoid a hydration mismatch).
- **`ComparePicker`** (L324-380): `prev | 4w | 52w`, written to `?cmp=`; shows a warning when the baseline window has no POS data.
- **`BusinessDayPicker`** (L382-425): hours `[0,4,5,6,7,8]` → `setBusinessDayStartAction`.
- **`CoversMultiplier`** (L427-458): `[1, 1.1, 1.25, 1.5, 1.75, 2]`, default **1.1**, key `analytics-covers-multiplier-v2`. Only used to estimate covers from unique visits when no real covers were entered.
- **`IgnoreItemsMenu`** (L1185-1431): searchable checkbox list of every item name seen this range ∪ already-excluded, with an "also ignore off-menu items" auto toggle and per-item overrides.

**Missing-data banner** (L2348-2368): rendered first, listing the days with no POS import and linking to `/admin/analytics/sales`.

**Five "Zones"** (`Zone` component L2054, anchor ids `bolum-01`…`bolum-05`, jump-nav `ZoneNav` L1997-2052 with an IntersectionObserver scroll-spy):

- **01 Nabız (pulse)** — 8 `Kpi` cards (L2408-2444): `Gerçek Satış ₺`, `Kişi` (real or `~`-prefixed estimate), `Kişi Başı ₺`, `Tekil Ziyaret`, `Menü Görüntüleme`, `Medyan Süre`, `Garson Çağrısı`, `Sepet → Çağrı %`. Each carries a delta badge (▲/▼/•, green/orange) with a "vs 13 Haz – 12 Tem" sub-line; sales deltas are **muted grey** when POS coverage is below 90 %. Above them, notices for "PostHog not configured", "engagement tracking started on X so these five cards cover a shorter window", and one line stating where the business day starts.
- **02 Yapay Zekâ** — `Overview` (deterministic verdict, no model call) + `AiInsights` (Groq findings) + `PatternsCard` (mined patterns).
- **03 Menü Kararları** — `MenuMatrix` (Kasavana–Smith 2×2), `MenuPositionCard`, `ConversionTable`, then a card grid of `TopProfit`, `HiddenGems`, `Momentum`, `BoughtTogether`, `PromoPerformance`.
- **04 Satış & Etkileşim** — `SalesVsEngagementChart` full-width, then `En Çok Satılan`, `Bakıp Almayanlar`, `Masa Aktivitesi`, `Etkileşim Hunisi`, `Fiyat Aralığına Göre Satış Dönüşümü`, `Kategori Popülerliği`.
- **05 Zaman & Dil** — `LocalePrefs` + `WeekHeatmapChart`.

### `_charts.tsx` (611 lines) — all Recharts wrappers
- Brand colours re-declared as literals (`GREEN #395A66`, `GREEN_DEEP #243845`, `ORANGE #FF5138`, `GRID #39556622`) because Recharts can't read CSS vars (L21-24).
- `useIsMobile()` (L89-99) — `matchMedia(max-width:639px)`, starts false and corrects in an effect to avoid hydration mismatch. Recharts' `ResponsiveContainer` fixes height, so every chart picks a mobile height.
- `ChartCard` (L101) — the standard `border-2 border-green bg-white shadow-hard` card with an orange square bullet in the heading.
- `SalesVsEngagementChart` (L151-265) — `ComposedChart`: revenue bars on a left axis, views + waiter-calls lines on a right axis. **On mobile it degrades to one series at a time on a single axis**, picked from chips that double as the legend.
- `RevenueAreaChart` (L267) — gradient area, currently unused on the page.
- `HBarChart` (L300-324) — horizontal bars with a `CategoryTick` that truncates at 24 chars and adds an SVG `<title>` so the full name stays reachable.
- `AbandonedViewsChart` (L332-362) — stacked bars by dwell bucket (5-10 s = photo problem, 10-20 s = description problem, +20 s = content/price problem) with that legend spelled out under the chart.
- `FunnelBars` (L364-392) — hand-rolled bars with per-step conversion %.
- `ConversionBars` (L416-489) — price-band views→**real sales** rate, **capped at 100 %**, with the surplus surfaced as a separate `menüsüz %N` chip ("sold without the menu page ever being opened"). Expandable per-band item drill-down.
- `WeekHeatmapChart` (L497-583) — weekday × hour grid, sequential green ramp, busiest cell flips orange; on mobile it narrows to only the hours that contain data and pins the day-label column.
- `PeakHoursChart` (L585-611) — 24-bar chart, peak hour coloured orange via `<Cell>`.

### `_conversion-table.tsx` (309 lines)
Per-item table, **explicitly not a funnel** — the header row labels the two source populations separately (`Menü (QR) · bakan kişiler` vs `POS (kasa) · tüm müşteriler`) because sold routinely exceeds carts. Columns: Ürün, Görüntüleme, Sepet, Satılan, **Satış/Görünt.** (an *index* like `1,2×`, never a percentage — `saleRatio`, L33-39). Features: sort on any column, search, "Az Satan Üste" one-click sort, **CSV export** (semicolon-separated + BOM + Turkish decimal comma so Excel-TR opens it), collapse at 15 rows with "show all", sticky first column on mobile, colour coding (orange when ≥5 views and 0 sold, green when ratio ≥ 1), and a collapsible "Nasıl okunur?" explainer.

### `_position-card.tsx` (425 lines)
"Does menu position sell?" — a **tile grid of categories** (one compact tile with a verdict + a slot-profile micro-bar chart) with a single expanded ladder panel below. Explicitly refuses a scatter plot; each rung carries a `rankGap` marker. Copy uses "ilişkili" (related), never causal language.

### `actions.ts` (1082 lines) — server actions
`generateInsightsAction` (load/recheck), `rejectInsightAction`, `generatePatternsAction` (load/rescan), `setExcludedItemsAction`, `setAutoExcludeOffMenuAction`, `setOffMenuOverridesAction`, `setBusinessDayStartAction`. All gated on `requireRole(["owner","dev"])` and all call `loadBusinessDayStart` before resolving a range.

### `loading.tsx` — centred `Loader size="lg"` in a `min-h-[60vh]` grid.

### Range handling
**`<ROOT>/src/lib/analytics/range.ts`** (199 lines): `TZ = "Europe/Istanbul"`; `businessTodayISO()` shifts now by the business-day start hour before formatting with `Intl.DateTimeFormat("en-CA")`; `isLiveRange`, `datesInRange`, `salesCoverage` (+ `RELIABLE_COVERAGE = 0.9`), `previousRange`, `rangeLength`, `resolveRange` (presets today/7d/30d/90d/custom, default 30d), and `CompareBasis`/`COMPARE_BASES`/`resolveCompare` with the **weekday-aligned** 28-day and 364-day offsets (the doc comment L119-132 explains why calendar-month/year offsets produce fake movement).

**`<ROOT>/src/lib/analytics/business-day.ts`** (74 lines): module-level `startHour` (0 = calendar day; options `[0,4,5,6,7,8]`, max 12). `loadBusinessDayStart()` reads settings key `analytics_business_day_start` once per request into process state; `posthog.ts` and `range.ts` read it back synchronously. At 0 the shifted SQL expression collapses to the original, so opting out changes nothing.

## 2c. `src/lib/analytics/*` — one paragraph each

- **`posthog.ts`** (768 lines) — the HogQL client and every engagement query. Own 30 s in-process query cache (deliberately *not* Next's fetch cache, because stale-while-revalidate made the dashboard look frozen), 3-attempt retry on 5xx only. Two population scopes with a stated rule: `scope()` = "range + sessions that scanned a table QR" for **counts of diners**; `eventScope()` = range only for **counts of events** (because bell-sheet `waiter_called` fires in sessions that never carried a table and the strict filter zeroed those KPIs). `ENGAGEMENT_DATA_FLOOR = "2026-07-05"` clips every window. Visits are stitched per `distinct_id` at a 2-hour gap (`VISIT_GAP_SECONDS`) because posthog-js clamps session idle to 30 min and a meal runs 60-120; median duration deliberately stays on the `$session_id` grain. Exports `getTopViewedItems`, `getTopCartedItems`, `getAbandonedViews(ByDay)`, `getTableActivity`, `getCartConversion`, `getCategoryPopularity`, `getLocaleSplit`, `getEngagementFunnel`, `getSessionStats`, `getDailyEngagement`, `getItemViewsWithPrice`, `getItemViewDiscountDays`, `getWeekHeatmap`, `getPromoEngagement`, `getLocalePreferences`, `getPeakHours`.
- **`basket.ts`** (96 lines) — market-basket affinity from the `orders` JSONB (the only true basket signal, since POS rows are day-level totals). Tallies unordered pairs across non-cancelled orders, reports confidence from the *rarer* item's side, returns `{pairs, orders, itemNames}`; names are canonicalized so an exclusion catches both spellings.
- **`categories.ts`** (34 lines) — maps `category_selected` slugs (`cold-drinks`, `dog-bun`) to the owner's localized category names so the chart axis isn't raw English identifiers on a Turkish page.
- **`clean-sales.ts`** (223 lines) — the POS row cleaner. `NOTE_PATTERNS` (order notes exported as items: `^mesaj`, `müşteri notu`), `MODIFIER_PATTERNS` (`+15 TL` suffixes, `^no|without|extra|add`, `^ekstra|ilave|az|bol|çift`, `soğan yok`, list bullets), an `INVISIBLE` control/format-char strip, `normalizeItemName` (Turkish-aware title case), `canonicalItemName` (folds kitchen-name aliases), and `cleanItemRows` which returns kept rows + `DroppedRow[]` with a reason + `CleanStats`. Dropped rows are **kept, not discarded**, because the heuristics are fallible and modifier lines carry real demand.
- **`compare.ts`** (265 lines) — the PostHog↔POS join layer, keyed on `canonicalItemName().toLocaleLowerCase("tr")`. `getItemConversion` (views/carts/sold per item), `getAbandonedViewsNet` (drops the (item, day) pairs the item actually sold on), `getHiddenGems` (converts well but under-exposed), `getItemMomentum` (per-item view momentum vs the previous window, with a `comparable` flag), `getSalesVsEngagement` (the headline daily series; days with engagement but no entered sales get `revenue: null` so the chart draws a gap).
- **`confidence.ts`** (106 lines) — pure arithmetic, no queries, no `server-only`, so client and server reason from the identical object. `buildDataBasis` returns range days, days with POS data, weekday occurrence counts, sessions, engagement days, items with sales. Constants `MIN_WEEKDAY_DAYS = 4`, `MIN_TREND_DAYS = 7`, `THIN_PERIOD_DAYS = 10`. Used three ways: shown to the model, **enforced in code after the model answers**, and printed on the AI card.
- **`exclusions.ts`** (240 lines) — the owner's "ignore these items" system. Three settings keys: `analytics_excluded_items` (manual list), `analytics_auto_exclude_offmenu` (rule), `analytics_offmenu_overrides` (per-item exceptions, wiped whenever the rule is toggled). Exports `getExclusionRules`, `makeKeepFilter`, `pickOffMenu`, `exclusionSignature` (folded into AI cache keys), `dropExcludedMentions` (strips findings quoting an ignored item). Deliberately **never touches money/amount aggregates** — only item-level views.
- **`food.ts`** (61 lines) — a "real food" predicate for Hidden Gems, classifying by menu *category slug* (`cold-drinks`, `hot-drinks`, `milkshakes`, `mocktails`, `extra`, `breakfast-extra`, `sauces` are non-food) with two name exceptions (fries live under `shared`; `menü kalemi`/upgrade lines are combos). Unknown names are kept, so a mismatch never hides a real dish.
- **`import-review.ts`** (273 lines) — builds the post-import audit report: every distinct product name with qty/revenue/day-count and a `ReviewStatus` of `matched | unmatched | modifier | note | zero`, plus fuzzy menu candidates for the unmatched ones. Stored as a single latest-import document in settings key `analytics_last_import_review`; also owns `analytics_item_aliases` and `analytics_force_item_names`.
- **`insights.ts`** (1024 lines) — the LLM layer. **Groq**, plain `fetch` against `https://api.groq.com/openai/v1/chat/completions`, no SDK. `MODEL = "openai/gpt-oss-120b"` for generation, `JUDGE_MODEL = "llama-3.1-8b-instant"` for the pattern judge (separate models because Groq meters rate limits per model). Five directed **scan angles** — `profit, conversion, pricing, movement, structural` — each a focused system-prompt suffix with only its own tables, replacing an earlier temperature-only loop that just re-treaded itself. Post-model gates: `isStrong`, `dropLowConfidenceClaims` (a weekday claim needs ≥4 occurrences of that weekday; a trend word needs ≥7 recorded days), `dropRejectedFindings` (exact normalized match against the owner's ban list), `rankFindings` (sorts by the largest ₺ amount the sentence cites — with Turkish digit-grouping parsed correctly — and cuts to `MAX_FINDINGS = 8`). Also `revalidateFindings` (ongoing/resolved/added) and `validatePatterns` (the judge).
- **`menu-match.ts`** (237 lines) — "is this still on the menu?" fuzzy matcher for the auto-ignore rule. Folds Turkish diacritics, drops punctuation/`&`, strips suffixes (`lari, leri, lar, ler, li, lu, si, su`), removes noise words (`kizartmasi, sos, fincan, porsiyon…`), sorts tokens, then falls back to token containment and one-typo tolerance. **Deliberately biased toward matching** — a false miss silently hides a product still being sold.
- **`menu-matrix.ts`** (346 lines) — Kasavana–Smith menu engineering from `menu_items.cost`. Quadrants `star | plowhorse | puzzle | dog`. Both axes relative: popularity vs `1/N × 0.7` of an even split, margin vs the **weighted** average contribution margin. Two honesty rules: a missing cost is *unknown, never zero* (item is excluded and `coverage` reports how much revenue the matrix speaks for, `RELIABLE_COST_COVERAGE = 0.6`), and the selling price comes from POS revenue ÷ qty when available, not the list price.
- **`menu-position.ts`** (558 lines) — Spearman's ρ between an item's slot and its units sold, computed **within a category** (comparing a starter's slot 3 to a dessert's slot 40 measures courses, not position) and pooled. Includes its own `spearman` and `spearmanP`. States its own limitation loudly: `sort_order` is *now*, sales are historical, and there is no position-history table, so `positionAsOf` is reported and the UI declares the assumption.
- **`overview.ts`** (286 lines) — the **deterministic** verdict card. No model call: reads the numbers already on the page and emits `{tone, headline, strengths[], push[], watch[]}`. Leads with profit lines wherever cost data exists. Thresholds `MOVE = 5 %`, `MIN_VIEWS = 5`. Pure and side-effect free, so the client renders it from the same data the server hands the model as "already said, don't repeat".
- **`parse-pos.ts`** (145 lines) — pure `xlsx` parsing, no Supabase, so it can be dry-run from a node script. Detects three shapes: `"gelir-merkezi"` (the real POS per-item-per-day report, read by **positional column indices** `{day:5, month:6, year:7, serial:4, name:13, qty:15, gross:16}` because the Turkish headers aren't stable), `"simple"` (the hand-made template), and `"summary"` (the monthly report, rejected with an explanatory toast). Also exports `toIsoDate` and `num` (parses `1.234,50` / `₺500`).
- **`patterns.ts`** (885 lines) — the deterministic pattern miner behind "Kalıplar". **Never an LLM** — the LLM only rejects and phrases. Five families: `co-move`, `basket`, `time` (weekday skew), `segment` (locale/price/discount), `margin`. Two guards: the **busy-day confound** (co-movement is measured on each item's daily *share*, not raw quantity, so "both were up because Saturday was packed" doesn't survive) and **sample size by disclosure** (`PatternConfidence high|medium|low`; thin patterns are shown but labelled "2 Çarşamba günü · düşük güven", ranked below solid ones, and phrased as hypotheses). Three widening `LEVELS` with progressively looser floors.
- **`price-bands.ts`** (222 lines) — bands `0–200 ₺ / 200–400 ₺ / 400+ ₺`. Measures views → **actually sold**, never views → cart (the menu has no checkout, so the cart is an optional scratchpad). Every item is banded once by a single price: menu price → tracked event price → POS revenue ÷ qty. Also exports `getDiscountSalesSplit`.
- **`promo.ts`** (49 lines) — combines `getPromoEngagement` with Supabase names: featured-banner and suggested-rail clicks, distinct sessions, and how many of those sessions went on to add anything to cart (`convPct`).
- **`sales.ts`** (318 lines) — the POS read side. `listSalesEntries`, `getRealSalesSummary`, `getRealSalesOverTime`, `getSoldItemsByDay`, `getSalesDayDetail`, `getRealBestSellers`. Notable: `fetchAllSaleItems` pages past PostgREST's 1000-row cap in 1000s ordered by `id`, because a busy month silently truncated and zeroed items sorting past the cap.

### The POS sales import
Pages: `<ROOT>/src/app/(dashboard)/admin/analytics/sales/{page,actions,detail-actions,_form,_list,_review}.tsx|ts`. Template: `<ROOT>/public/sales-template.csv` (`date,total_sales,covers` + 3 sample rows).
- **`_form.tsx`** — two side-by-side cards: **Manuel Giriş** (date / total ₺ / optional covers → `upsertSalesEntry`, upsert on `entry_date`) and **Excel İçe Aktar** (`.xlsx/.xls/.csv` → `importSalesExcel`), with copy naming the exact POS report to upload and explicitly warning that the monthly summary won't work.
- **`importSalesExcel`** (actions.ts L203+): detect → reject `summary` → for `gelir-merkezi`, `parseGelirMerkezi`, upsert `sales_entries` (source `excel`), map dates→ids, load owner overrides + all menu names, `persistItems` (which runs `cleanItemRows`), `buildImportReview`, `saveImportReview`, and return a toast summarizing days / item rows / rounded fractional qty / dropped rows / merged duplicates / unmatched count.
- **`_review.tsx`** (316 lines) — the audit UI. Four buckets: **TANINMAYAN** (kept but no menu match — map it with fuzzy candidates, or mark it not-a-product), **AYRILAN** (removed as modifier/note/zero — one click to restore; also where the modifier demand signal lives, "Mayonezsiz ×43"), **EŞLEŞEN** (collapsed). **Mapping is permanent and retroactive**: the alias applies to future imports *and* renames already-stored rows.
- **`_list.tsx`** (285 lines) — saved entries with a lazy per-day drill-down (`detail-actions.ts` → `getSalesDayDetailAction`) showing each item's ₺ difference **against its own recent baseline**, sorted by impact ascending (biggest loss first). Items that sold nothing today but normally do are included at zero — usually the actual cause of a bad day.

### "Insights" vs "Patterns" vs "Rejections"
- **Insights** = **LLM-generated (Groq)**. Persisted per `(range_from, range_to, compare_basis)` in `analytics_patterns`'s sibling table `analytics_insights` so repeat visits show the *same* findings; `isInsightFresh` now returns true for any stored row ("age is not a reason to regenerate" — findings move only when asked). Buttons: **Yorum Oluştur / Tekrar Kontrol Et / Tekrar Dene**. In-memory 1 h cache keyed by range + basis + exclusion signature.
- **Patterns (Kalıplar)** = **rules/math first, LLM second**. `minePatterns` computes candidates with real statistics; the judge only rejects the obvious ones and writes one sentence each. **Without `GROQ_API_KEY` it still works**, falling back to templated Turkish sentences.
- **Rejections** = the owner clicking "✕ Böyle bulgu isteme" on a finding, optionally with a reason (`window.prompt`). `rejectInsightAction` **persists first, then tries to generate a replacement**, so a Groq failure still leaves the finding struck. Stored in `analytics_insight_rejections` with a `text_key` unique index; fed back as negative prompt examples *and* as a hard filter.
- **LLM provider: Groq only.** `grep` finds no `@anthropic-ai`, no `openai` SDK, no Gemini — just `GROQ_API_KEY` in `<ROOT>/src/lib/env.ts` L25 and the raw fetch in `insights.ts`.

## 2d. Charting library
**Recharts `^3.9.0`** (`ComposedChart, AreaChart, BarChart, Area, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Cell, ResponsiveContainer`). The heatmap, funnel bars, conversion bars and slot profiles are **hand-rolled CSS grid / divs**, not Recharts.

---

# 3. ADMIN DASHBOARD

## Shell & auth
- `<ROOT>/src/app/(dashboard)/layout.tsx` — its **own `<html>` root** (separate from the public tree), Teko + Inter only, `robots: {index:false}`.
- `<ROOT>/src/app/(dashboard)/admin/layout.tsx` — `requireRole(["admin","owner","dev"])` gates the whole subtree (L7) and builds the nav (L9-24), hiding **Analitik** and **Kullanıcılar** from the `admin` role. Renders `<AdminShell>` + a suspended `<AdminToast>`.
- `<ROOT>/src/lib/auth/require-session.ts` — `requireSession()` redirects to `/login?next=`, `requireRole()` additionally reads `profiles.role` and redirects to `/admin?error=forbidden` on a mismatch. **RLS is the authoritative gate**; this is for UX.
- `<ROOT>/src/app/(dashboard)/admin/_sidebar.tsx` — 240 px sidebar, `lg:sticky` / off-canvas below `lg` with a backdrop, auto-closing on `pathname` change (L25-27). Active item = `bg-bg` + `border-l-4 border-orange`. Footer block shows display name + role + a `SignOutButton` posting to `/logout`. Mobile gets a hamburger header.
- Nav order: Ana Panel · Analitik(owner/dev) · Menü · Kategoriler · Ekstra/Seçenek · Önerilen · Başlangıç Bölümü · Masa QR'ları · Kullanıcılar(owner/dev).

## UI patterns
- `<ROOT>/src/app/(dashboard)/admin/_components.tsx` — the whole admin design system in 209 lines: `Field`, `Textarea`, `Select`, `Checkbox`, `PrimaryButton` (orange, `useFormStatus`, inline `Loader size="xs"` when pending), `GhostButton` (outlined link), `DangerButton` (dark green), `PageHeader` (34 px `font-bowlby` title + tracking-heavy subtitle + optional action slot). All inputs are `border-2 border-green bg-bg` turning white on focus.
- **Toasts**: server actions end with `notifyOk(path, label)` / `notifyErr(path, label)` (`<ROOT>/src/lib/admin/notify.ts`) which `redirect()` to `path?ok=1&label=…`. `<ROOT>/src/app/(dashboard)/admin/_toast.tsx` reads those params, shows a fixed top-right pill for 3 s, then `router.replace()`s them away so a refresh can't replay it. Client-side code dispatches the same toast through a `CustomEvent("admin:toast")` (`<ROOT>/src/lib/admin/client-notify.ts`).
- **Confirm dialogs**: `ConfirmDialog` for every destructive action, with optimistic removal + snapshot rollback on failure (see `menu/_list.tsx` L73-93).
- **Server-action convention**: `parse (zod) → requireRole → mutate → updateTag("menu"|"hero"|"settings") → broadcastMenuUpdate() → notifyOk/redirect`.

## Pages

**Overview — `admin/page.tsx`** (53 lines): three count cards (Menü Ürünleri / Mevcut / Kategoriler) as links, each a `count: "exact", head: true` query. Shows a forbidden banner when `?error=forbidden`.

**Menu — `admin/menu/`**
- `page.tsx`: `unstable_cache(["admin-menu-list"], {tags:["menu"]})`; sort toggle `Kategori | Alfabetik` via `?sort=`; subtitle reports **how many items still have no cost** ("kâr analizi için gerekli").
- `_list.tsx` (237 lines): client-side search over name+category, thumbnail, name + Acılı chip, category, price with a **margin chip** underneath (`%N kâr`, colour-banded at 60/35, or a grey "maliyet yok"), a **sold-out toggle switch** (hand-styled inline, red when on) with optimistic update + rollback, Düzenle link, Sil with ConfirmDialog and a 200 ms fade-out.
- `_form.tsx` (112 lines): category select, image field, `name_en/tr`, `hook_en/tr` ("Slogan", placeholder "örn. tatlı · çıtır · cesur"), `desc_en/tr` textareas, `price`, **`cost` (optional, blank ≠ 0)**, `sort_order`, checkboxes Acılı / Mevcut / Tükendi, and a three-swatch **Vurgulama** radio (— / Yeşil / Turuncu → `highlight`).
- `_image-field.tsx` (130 lines): client upload. Max input 10 MB → `browser-image-compression` to `maxSizeMB 0.5`, `maxWidthOrHeight 1200`, **`fileType: image/webp`**, `useWebWorker` → uploads to Supabase Storage bucket **`menu-images`** at `crypto.randomUUID().webp` with `cacheControl: "2592000"` → `getPublicUrl` → stored in a hidden `image_url` input. Preview tile is click-to-upload; "Kaldır" clears it.
- `actions.ts`: `createItem`, `updateItem`, `toggleSoldOut`, `toggleAvailability`, `deleteItem`. The cost field uses `z.preprocess` to keep blank as `null`.

**Categories — `admin/categories/`**: hierarchical (`parent_id`), `slug` regex-validated `^[a-z0-9-]+$`, bilingual names, emoji, image (reuses `ImageField`), parent select. `sort_order` is auto-assigned as max+1 on create (L38-46 of actions.ts) and changed only by **`moveCategoryUp/Down`**, which swaps the two `sort_order` values with neighbours scoped to the same level (L79-119).

**Add-ons — `admin/addons/`**
- `page.tsx`: groups split into **category-scoped** and **item-scoped** lists, each showing scope name and option count.
- `new/_form.tsx`: a scope radio (`Kategori` vs `Menü Ürünleri`), and for item scope a **multi-select checklist** submitted as repeated `menu_item_ids[]` inputs. Pre-fills from `?item_id=` / `?category_id=`.
- `[id]/edit/page.tsx` (280 lines): group settings form (labels, `multi`, `required`, `sort_order`), item assignment (`_edit-items-form.tsx`), the option list with `_option-form.tsx` + `_reorder-buttons.tsx`, and the **reveals** editor — sub-groups are identified as "groups with no `category_id` and no `addon_group_items` rows" (L92-95) and attached to an option via checkboxes.
- `actions.ts`: `createGroup` (inserts group then the `addon_group_items` join rows, redirects to the editor), `updateGroup` (delete-all-then-reinsert the joins), `deleteGroup`, `createOption`, `updateOption` (same delete-then-reinsert for `addon_option_reveals`), `reorderOption` (swap adjacent `sort_order`), `createRevealedGroup` (creates an unscoped internal group and links it), `deleteOption`.

**Suggested — `admin/suggested/`**: identical shape to add-ons but one level shallower — `suggested_groups` (category- or item-scoped, XOR-constrained) containing ordered `suggested_items` that point at `menu_items`. Actions: `createGroup/updateGroup/deleteGroup/createItem/deleteItem/reorderItem`.

**Orders — `admin/orders/_client.tsx`** (391 lines). ⚠️ **There is no `page.tsx` in this folder**, so `/admin/orders` is not routed and the sidebar has no link — it is fully-built dead code. What it does when mounted:
- Supabase Realtime channel `orders-stream` on `postgres_changes` INSERT + UPDATE (L243-302), with auto-resubscribe on `CHANNEL_ERROR|TIMED_OUT|CLOSED` at a jittered 4-7 s interval and a connection pill (Bağlanıyor / Canlı / Bağlantı Kesildi).
- Cards per order: table number in 42 px orange, status pill, live elapsed badge, line items, total, note, and four action buttons `Görüldü / Hazırlanıyor / Teslim Edildi / İptal` (optimistic local update only — the real status change comes from the Telegram callback edge function).
- **Staleness**: any `new` order older than 90 s pulses orange, raises a banner, and starts a repeating audio alarm every 30 s until it clears (`syncStaleTimers`, L196-215).
- Requires a one-time **"Vardiyayı Başlat"** click to arm `/notification.mp3` (browser autoplay policy, L305-313). Unseen count is mirrored into `document.title`.

**QR — `admin/qr/`**: server-renders a QR per `TABLE_IDS` entry with `qrcode` (`toDataURL`, 360 px, `errorCorrectionLevel: "H"`) pointing at `${NEXT_PUBLIC_SITE_URL}/tr/scan?t=&w=&tok=`, with the logo overlaid in the centre (the H error correction is why that works). A print stylesheet forces a 4-column grid and hides chrome (L31-38); `_print-button.tsx` calls `window.print()`. Each cell carries `_table-toggles.tsx` — a **🔔 Zil Açık / 🔕 Zil Kapalı** toggle writing the `waiter_disabled_tables` settings key via `setTableWaiterDisabled`, which is what hides the bell FAB for that table on the guest side.

**Settings ("Başlangıç Bölümü") — `admin/settings/`**: one form containing `<HeroConstructor>` + a save button.
- **The "hero constructor"** (`_hero-constructor.tsx`, 310 lines) is a live-preview builder for the guest hero. It renders **all three mode panels at once** and toggles them with `hidden`, keeping hidden inputs (`hero_mode`, `hero_media_url`) always submitted so nothing is lost when switching modes. Sections: **Açılış Saatleri** (TR + EN, 80 chars, override the i18n default), **Hero Modu** three-button toggle (Yok / Görsel / Öne Çıkan Ürün) each with an explanatory line, **media panel** (upload to `menu-images/hero/<uuid>.webp`, compressed at 0.8 MB / 1600 px), and **featured panel** (item `<select>` with a live thumbnail+name preview, **Kayan Yazı** = the marquee sentence, **İndirim %** 0-99, **Rozet Metni** = the badge pill).
- `actions.ts` writes all 8 keys as a single `settings` upsert on `key`, then `updateTag("hero")` + `broadcastMenuUpdate()`.
- **The only settings that exist are hero + opening hours** (plus the QR bell toggles and the analytics-only keys). **There is no Telegram settings page** — Telegram is env-var only (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`).

**Users — `admin/users/`**: `requireRole(["owner","dev"])`. Lists `auth.admin.listUsers({perPage:200})` joined to `profiles`, with three role explainer cards (Sahip / Admin / Dev). `actions.ts`: `setRole` (blocks self-edit and blocks removing the **last owner**), `removeUser` (same guards, then `auth.admin.deleteUser`), `inviteUser` (a `useActionState`-style action → `auth.admin.inviteUserByEmail` with `redirectTo: ${SITE_URL}/auth/set-password`, then sets the role). All three go through the **service-role** client.

**Auth**: `login/page.tsx` + `actions.ts` + `submit-button.tsx`; `logout/route.ts`; `auth/set-password/page.tsx` (176 lines, the invite completion flow); `app/auth/callback/route.ts`.

**API routes**: `api/health` (DB liveness probe for a cron keep-alive), `api/diag` (calls `submitOrder` two ways and digs the action id out of the Next server-reference manifest), `api/telegram/webhook` + `api/telegram/register`.

**Edge functions**: `<ROOT>/supabase/functions/order-notify/index.ts` (Postgres trigger → richer Telegram message with inline status buttons) and `telegram-callback/index.ts` (button tap → `orders.status` update → Realtime broadcast).

---

# 4. TESTS & DEPENDENCIES

- **`<ROOT>/test-results/.last-run.json`** contains only `{"status":"failed","failedTests":[]}` — a stray Playwright artifact. **There is no `playwright.config.*`, no `vitest.config.*`, no jest, no eslint config file, and no test files anywhere in the repo.** `CLAUDE.md` states outright: "No lint, test, or format scripts exist yet."
- **Scripts** (`<ROOT>/package.json`): `dev` → `next dev --turbopack`, `build` → `next build`, `start` → `next start`. That is all three.
- Helper scripts (not npm-wired): `<ROOT>/scripts/generate-table-qrs.mjs`, `<ROOT>/scripts/_check-policies.mjs`.

```json
"dependencies": {
  "@supabase/ssr": "^0.10.2",
  "@supabase/supabase-js": "^2.104.1",
  "@tailwindcss/postcss": "^4.2.4",
  "@vercel/analytics": "^2.0.1",
  "browser-image-compression": "^2.0.2",
  "lucide-react": "^1.14.0",
  "next": "16.2.0",
  "postcss": "^8.5.10",
  "posthog-js": "^1.393.5",
  "posthog-node": "^5.21.2",
  "qrcode": "^1.5.4",
  "react": "19.2.4",
  "react-dom": "19.2.4",
  "recharts": "^3.9.0",
  "tailwindcss": "^4.2.4",
  "xlsx": "^0.18.5",
  "zod": "^4.3.6"
},
"devDependencies": {
  "@types/node": "^20",
  "@types/qrcode": "^1.5.6",
  "@types/react": "^19",
  "@types/react-dom": "^19",
  "typescript": "^5"
}
```

(`posthog-node` is declared but never imported — server queries go through raw `fetch` in `posthog.ts`. `lucide-react` is used for exactly one icon, the `Bell` in WaiterButton, and is in `optimizePackageImports`.)

**Environment contract** — `<ROOT>/src/lib/env.ts` (zod, validated at module load; warns instead of throwing during `next build`):
required `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `QR_SECRET` (≥16), `COOKIE_SECRET` (≥16);
optional `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST`, `SUPABASE_SERVICE_ROLE_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `GROQ_API_KEY`.

---

## Doc/code discrepancies to know before porting

1. **`defaultLocale` is `"tr"`** (`src/i18n/config.ts` L3), not `en` as both README and ARCHITECTURE claim. The proxy does **no** `Accept-Language` detection.
2. **The guest cart does not place orders.** The CTA calls the waiter (`callWaiter(table,"order")` → Telegram). `submitOrder`, `track.orderSubmitted`, `track.orderFailed`, and the whole `orders`-insert pipeline described in ARCHITECTURE §6 are only reachable via `/api/diag` and the (unrouted) orders board. The `orders` table is still written to historically and is what `basket.ts` mines.
3. **`/admin/orders` has no `page.tsx`** — the real-time board is unreachable and unlinked.
4. `MenuStage/constants.ts` + `src/lib/rng.ts` describe a scattered/rotated card layout that no longer exists.
5. `env.ts` requires `QR_SECRET` and `COOKIE_SECRET`, which neither doc mentions — the app will not boot without them.
6. The `dev` role exists in code and RLS (migrations `20260704000000/1`) but not in `types/database.ts`'s doc comments or either markdown file.