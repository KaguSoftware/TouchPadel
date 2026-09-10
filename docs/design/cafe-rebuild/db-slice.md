I have what I need. Below is the complete backend design plan.

# Touch Cafe rebuild — DB / Edge / Telegram / Analytics backend plan

Monorepo: `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel`. Everything below is additive on 0001–0026 (hosted `lczijabnorujcgmbuqlw` is production: no drops of tables/columns, no enum edits, no destructive data ops). Every new table gets RLS enabled; every new `app.*` function follows the 0013 pattern (`security definer set search_path = public`, `revoke all … from public, anon; grant execute … to authenticated` or service-role-only, first statement = role guard, `raise exception '<CODE>' using errcode='P0001'`, `app.write_audit`).

Key architectural calls (each justified inline below):

| Topic | Decision |
|---|---|
| Photo wipe bug | Remove `p_photo_path` from `upsert_menu_item`; dedicated `set_item_photo` / `set_category_photo` (null = clear). Same for `cost_iqd` (`set_item_cost`) and `sold_out` (`set_item_sold_out`) so no "forgot to pass it" wipe can recur. |
| Subcategories | SKIP `menu_categories.parent_id`. UpperDeck only used parents for addon-group inheritance, which our item-level `menu_item_modifier_groups` already covers; honouring it would ripple through fetchMenu, MenuEditor, tax-group inheritance and the e2e for no guest-visible gain. |
| Settings | Key/value `cafe_settings(key, value jsonb)` with a migration-owned spec registry (`app.cafe_setting_spec()`) doing typed validation + per-key role; public split via a definer view `cafe_settings_public`. Base table is staff-read only, so the RLS matrix can express the split exactly. |
| Enums | No enum changes anywhere (text + check constraints), so nothing needs a "separate transaction" migration. |
| Reveals depth | Strictly one level, enforced at write time (`REVEAL_DEPTH`) and at validation time (revealing option must belong to a base group). |
| Featured discount | Applied inside `add_order_items` for every order source (server is the single pricing authority); original price kept in `order_items.list_price_iqd`. |
| Telegram delivery | Outbox + `app.telegram_nudge()` (pg_net POST to `telegram-send` only when due rows exist) called from the enqueue path immediately AND by a pg_cron `10 seconds` sweep. Idle = zero function invocations; latency ~1–3 s when pg_net is on, ≤10 s otherwise. |
| Telegram actor | No synthetic staff rows (FK chain `staff.id -> auth.users` makes that impossible without fake logins). New `telegram_actions` ledger + nullable `*_label` columns on `waiter_calls` / `tickets`; existing `*_by` staff FKs stay NULL for Telegram-driven changes. |
| Roles | manager\|owner = content (menu, reveals, hero, photos, cost, bell, QR tokens, settings content keys); owner = Telegram keys/test, analytics functions, LLM tables, rejections. No new roles. |

---

## Wave 1 — Migrations 0027–0031 (schema + admin RPCs)

### `packages/db/supabase/migrations/20260825000027_menu_extensions.sql`

DDL:
```sql
alter table menu_items
  add column if not exists hook_en   text not null default '',
  add column if not exists hook_ar   text not null default '',
  add column if not exists highlight text not null default 'none',
  add column if not exists sold_out  boolean not null default false,
  add column if not exists cost_iqd  iqd,               -- NULL = unknown; NEVER coerced to 0
  add column if not exists photo_blur text;             -- tiny data-URI / blurhash placeholder, <= 400 chars
alter table menu_items
  add constraint menu_items_highlight_chk check (highlight in ('none','blue','brown')),
  add constraint menu_items_hook_pair_chk check ((hook_en = '') = (hook_ar = '')),
  add constraint menu_items_photo_blur_len check (photo_blur is null or length(photo_blur) <= 400);
comment on column menu_items.cost_iqd is 'Owner-entered unit cost in IQD. NULL = not entered; margin math drops the item and reports coverage. Never treat as zero.';

alter table menu_categories
  add column if not exists photo_path text,
  add column if not exists photo_blur text;
```
`highlight` = brand tints (`blue` #3360AB, `brown` #603813).

Availability: `create or replace function app.menu_availability()` (0025 body) with `and not mi.sold_out` added. View `menu_item_availability` unchanged (same columns). Note: `sold_out` ≠ 86: 86 (`unavailable_on`) auto-restores tomorrow; `sold_out` is sticky and still rendered with a stamp.

Storage-path validator (shared by photos + hero): `app.is_media_path(p text) returns boolean` immutable — `p ~ '^(items|categories|hero)/[A-Za-z0-9][A-Za-z0-9/_-]{0,180}\.(webp|jpe?g|png|mp4|webm)$'`.

RPCs (manager|owner, audited):
- `app.upsert_menu_item(p_category_id uuid, p_name_en text, p_name_ar text, p_id uuid default null, p_description_en text default null, p_description_ar text default null, p_sort_order int default 0, p_is_active boolean default true, p_hook_en text default '', p_hook_ar text default '', p_highlight text default 'none') returns uuid` — **`drop function if exists app.upsert_menu_item(uuid,text,text,uuid,text,text,text,int,boolean)` first** (old overload must go or PostgREST calls become ambiguous; 0026 precedent). Never touches `photo_path`, `photo_blur`, `sold_out`, `cost_iqd`. Errors: existing + `INVALID_HIGHLIGHT`, `HOOK_TOO_LONG` (>80 chars either language). The operator's current call (no photo arg) keeps working; rls-matrix args `{p_category_id,p_name_en,p_name_ar}` still resolve.
- `app.set_item_photo(p_item_id uuid, p_photo_path text, p_photo_blur text default null) returns void` — null path = clear; `INVALID_PHOTO_PATH` unless `app.is_media_path` and prefix `items/`; audit `menu.item.photo`. Old object deletion is the operator app's job after success (SQL must not delete `storage.objects` rows — orphans the S3 file).
- `app.set_category_photo(p_category_id uuid, p_photo_path text, p_photo_blur text default null) returns void` — prefix `categories/`; audit `menu.category.photo`.
- `app.set_item_sold_out(p_item_id uuid, p_sold_out boolean) returns void` — audit `menu.item.sold_out`.
- `app.set_item_cost(p_item_id uuid, p_cost_iqd bigint) returns void` — null allowed (= unknown); `INVALID_COST` if < 0; audit `menu.item.cost`.
- `app.upsert_menu_category` unchanged (photo via `set_category_photo`).

Grants: revoke from public/anon, grant to authenticated for all five. RLS unchanged (guest SELECT sees the new columns; `cost_iqd` is the only sensitive one — **column-level revoke**: `revoke select (cost_iqd) on menu_items from anon, authenticated` is impossible without breaking `select *` in the web client… so instead keep `cost_iqd` readable? No: margin data must not leak to guests. Use the 0004 `staff` pattern: `revoke select on menu_items from anon, authenticated; grant select (id, category_id, name_en, name_ar, description_en, description_ar, photo_path, photo_blur, is_active, unavailable_on, sort_order, hook_en, hook_ar, highlight, sold_out) on menu_items to anon, authenticated; grant select (cost_iqd) on menu_items to authenticated` with a second policy? Column grants are not role-conditional per row, so `cost_iqd` would be readable by any authenticated user (guests are anonymous-auth users). **Chosen**: keep `cost_iqd` out of client column grants entirely and expose it to staff only through `app.analytics_menu_snapshot()` and a small `app.menu_item_costs()` (manager|owner) function. The web `fetchMenu` selects explicit columns already (menu.ts:78–86) so `select *` breakage is limited to the operator's MenuEditor (`useQuery(['adminMenu'])` selects explicit columns too — verify; the RLS matrix rule `select menu_items` uses `*` → change that rule to an explicit column list). Add a matrix rule `select menu_items columns 'cost_iqd'` expecting `denied` for everyone (mirrors the `pin_hash` rule).

### `…0028_modifier_reveals.sql`

```sql
create table modifier_reveals (
  modifier_id uuid not null references modifiers(id) on delete cascade,
  group_id    uuid not null references modifier_groups(id) on delete cascade,
  sort_order  int  not null default 0,
  primary key (modifier_id, group_id)
);
create index modifier_reveals_group on modifier_reveals (group_id);
alter table modifier_reveals enable row level security;
grant select on modifier_reveals to anon, authenticated;
create policy modifier_reveals_read on modifier_reveals for select to anon, authenticated using (true);
```
Belt trigger `app.trg_modifier_reveals_guard()` BEFORE INSERT/UPDATE: raises `REVEAL_SELF` when `group_id = (select group_id from modifiers where id = new.modifier_id)`.

RPC `app.set_modifier_reveals(p_modifier_id uuid, p_group_ids uuid[]) returns void` (manager|owner; wholesale replace, array order = `sort_order`; audit `menu.modifier.reveals` with before/after arrays). Errors: `MODIFIER_NOT_FOUND`, `GROUP_NOT_FOUND` (pre-check, not FK), `REVEAL_SELF`, `REVEAL_DEPTH` when (a) any target group's modifiers already have reveals, or (b) the revealing modifier's own group is itself a reveal target anywhere. This makes depth ≤ 1 a global invariant, so the validator and the guest UI can both be one-level.

Validation rule for orders (implemented in 0030, stated here): a chosen modifier `m` is valid for item `i` iff `m.is_active` and (`m.group_id` is linked to `i` via `menu_item_modifier_groups`) OR (there exists a chosen modifier `r` on the same line with `r.group_id` linked to `i` and `(r.id, m.group_id) ∈ modifier_reveals`). Min/max is enforced for every *active* group = linked groups ∪ groups revealed by a chosen linked-group modifier. A revealed group whose revealing option is not chosen is simply inactive (its `min_select` does not apply; any modifier from it is `MODIFIER_INVALID`).

### `…0029_cafe_settings.sql`

```sql
create table cafe_settings (
  key        text primary key,
  value      jsonb not null,
  is_public  boolean not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references staff(id)
);
alter table cafe_settings enable row level security;
grant select on cafe_settings to authenticated;
create policy cafe_settings_staff_read on cafe_settings for select to authenticated
  using (app.is_staff('manager','owner'));
create view cafe_settings_public with (security_invoker = off) as
  select key, value from cafe_settings where is_public;
grant select on cafe_settings_public to anon, authenticated;
```

Spec registry `app.cafe_setting_spec(p_key text) returns table (key text, is_public boolean, jtype text, min_role staff_role, default_value jsonb)` — a `values (...)` list; adding a key later = new migration replacing the function + `insert … on conflict do nothing` default row.

| key | public | type / validation | write role | default |
|---|---|---|---|---|
| `hero_mode` | yes | `'none'\|'media'\|'featured'` | manager | `"none"` |
| `hero_media_path` | yes | null or `app.is_media_path` with `hero/` prefix | manager | `null` |
| `hero_media_kind` | yes | `'image'\|'video'` | manager | `"image"` |
| `featured_item_id` | yes | null or uuid of an active `menu_items` row (`ITEM_NOT_FOUND`) | manager | `null` |
| `featured_label_en` / `_ar` | yes | text ≤ 200 | manager | `""` |
| `featured_badge_en` / `_ar` | yes | text ≤ 60 | manager | `""` |
| `featured_discount_pct` | yes | int 0–99 | manager | `0` |
| `ticker_en` / `ticker_ar` | yes | array ≤ 12 strings, each ≤ 120 chars | manager | `[]` |
| `bell_tutorial_enabled` | yes | bool | manager | `true` |
| `telegram_enabled` | no | bool | owner | `false` |
| `telegram_chat_id` | no | null or text matching `^-?[0-9]{5,20}$` | owner | `null` |
| `telegram_lang` | no | `'ar'\|'en'` (label language; item lines always bilingual) | owner | `"ar"` |
| `analytics_business_day_start_hour` | no | int 0–12 | owner | `4` |
| `analytics_excluded_item_ids` | no | array of uuid | owner | `[]` |

RPC `app.set_cafe_setting(p_key text, p_value jsonb) returns jsonb` — guard `is_staff('manager','owner')`, then `UNKNOWN_SETTING`, role check against `min_role` (`FORBIDDEN`), type/shape check (`INVALID_SETTING_VALUE` with `detail` = reason), upsert with `updated_by = auth.uid()`, `app.write_audit('settings.cafe', 'cafe_settings', p_key, before, after)`, returns the stored row as jsonb. `telegram_chat_id` never leaks: it is `is_public=false`, the base table is manager|owner-only, the view filters `is_public`, and a test asserts anon/guest cannot see any `telegram_%` key.

Internal typed accessors (definer, no client grants; used by 0030/0032/0034): `app.cafe_setting(p_key) returns jsonb`, `app.cafe_setting_text(p_key) returns text`, `app.cafe_setting_int(p_key) returns int`, `app.cafe_setting_bool(p_key) returns boolean` (all `coalesce(row value, spec default)`).

Seed in-migration: `insert into cafe_settings (key, value, is_public) select key, default_value, is_public from app.cafe_setting_spec(null)` — hmm, make `app.cafe_setting_specs()` (no arg, all rows) and `app.cafe_setting_spec(key)` a filter over it; seed with `on conflict (key) do nothing`.

### `…0030_order_pricing.sql` — `add_order_items` rewrite (sold_out + reveals + featured discount)

```sql
alter table order_items
  add column if not exists list_price_iqd  iqd,                       -- variant price at snapshot (NULL on pre-0030 rows)
  add column if not exists discount_pct    int  not null default 0 check (discount_pct between 0 and 99),
  add column if not exists discount_source text check (discount_source is null or discount_source in ('featured'));
```
Rounding helper `app.apply_pct_discount(p_list bigint, p_pct int) returns bigint immutable` = `(p_list * (100 - p_pct) + 50) / 100` (integer half-up, bigint only). TS twin in `packages/core/src/money/discount.ts`: `applyPctDiscountIqd(list, pct) = iqd(Math.floor((iqd(list) * (100 - pct) + 50) / 100))` with a unit test and a DB-parity test (money arithmetic stays in `packages/core` per project rule; `apps/web` basket preview imports it).

New `app.add_order_items(p_order_id uuid, p_items jsonb) returns bigint` body (same signature, `create or replace`):
1. `EMPTY_ORDER` / `INVALID_QTY` / `VARIANT_NOT_FOUND` as today.
2. `ITEM_UNAVAILABLE` if `not is_active or unavailable_on = current_date or sold_out or category inactive`.
3. Featured: read once per call `v_hero_mode := app.cafe_setting_text('hero_mode')`, `v_feat := app.cafe_setting_text('featured_item_id')::uuid`, `v_pct := app.cafe_setting_int('featured_discount_pct')`. If `v_hero_mode='featured' and v_feat = v_mi.id and v_pct > 0` → `v_unit := app.apply_pct_discount(v_list, v_pct)`, `discount_pct = v_pct`, `discount_source='featured'`; else `v_unit := v_list`. Insert `list_price_iqd = v_list`.
4. Modifier loop: only existence + `is_active` (`MODIFIER_INVALID`), qty 1–9, insert `order_item_modifiers` (PK catches duplicates).
5. After the loop, one validation query per line:
```sql
with base as (select group_id from menu_item_modifier_groups where item_id = v_mi.id),
     chosen as (select oim.modifier_id, m.group_id
                  from order_item_modifiers oim join modifiers m on m.id = oim.modifier_id
                 where oim.order_item_id = v_oi_id),
     revealed as (select r.group_id from modifier_reveals r
                    join chosen c on c.modifier_id = r.modifier_id
                    join base b on b.group_id = c.group_id),
     active as (select group_id from base union select group_id from revealed)
select ... 
```
   - any `chosen.group_id not in active` → `MODIFIER_INVALID` (detail = modifier id);
   - for each `active` group: distinct chosen count outside `[min_select, max_select]` → `MODIFIER_SELECTION` (detail = group id).
6. `line_total = (v_unit + v_mods) * v_qty`; return Σ.

Applies to guest and till orders alike (one pricing authority; the till basket preview should read `cafe_settings_public` — frontend follow-up). `compute_tab_totals` needs no change (line totals already net). `override_price` unchanged (rewrites `unit_price_iqd`; `list_price_iqd` keeps the original).

### `…0031_tables_storage.sql`

Tables:
```sql
alter table cafe_tables add column if not exists bell_enabled boolean not null default true;
```
- `app.set_table_bell(p_table_id uuid, p_enabled boolean) returns void` — manager|owner, `TABLE_NOT_FOUND`, audit `table.bell`.
- `app.upsert_cafe_table(p_table_number text, p_zone text default null, p_capacity int default null, p_id uuid default null, p_is_active boolean default true) returns uuid` — manager|owner, `TABLE_NUMBER_TAKEN` (unique violation mapped), audit `table.upsert`. (No admin table CRUD exists today; the QR page needs it.)
- `app.table_qr_tokens() returns jsonb` — manager|owner (same tier as `generate_table_token`; 0014's "owner-only" comment is stale, the body says manager|owner); returns `[{table_id, table_number, zone, capacity, is_active, bell_enabled, token_version, token}]` for active tables via `app.generate_table_token`. Least privilege: no service role anywhere; `scripts/qr-artwork.mjs` switches to a staff sign-in + this RPC (or is retired in favour of the operator print route).
- `app.open_table_session` re-created (same signature) to add `'bell_enabled', v_table.bell_enabled` to the returned jsonb. (Only this change here; `raise_waiter_call` is re-created in 0032 with BOTH the bell check and the enqueue — never split one function's edits across two migrations.)

Storage (guarded `do $$ … if to_regclass('storage.buckets') is null then raise notice … return`):
```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-media','menu-media', true, 26214400,
        array['image/webp','image/jpeg','image/png','video/mp4','video/webm'])
on conflict (id) do update set public = excluded.public,
  file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create policy menu_media_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'menu-media');
create policy menu_media_staff_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'menu-media' and app.is_staff('manager','owner')
              and (storage.foldername(name))[1] in ('items','categories','hero'));
create policy menu_media_staff_update on storage.objects for update to authenticated
  using (bucket_id = 'menu-media' and app.is_staff('manager','owner'))
  with check (bucket_id = 'menu-media' and app.is_staff('manager','owner'));
create policy menu_media_staff_delete on storage.objects for delete to authenticated
  using (bucket_id = 'menu-media' and app.is_staff('manager','owner'));
```
Each `create policy` wrapped in `exception when duplicate_object then null` and the whole block in `exception when insufficient_privilege then raise notice '… create storage policies via Dashboard'` (risk: on hosted, `db push` runs as `postgres`, which can create policies on `storage.objects` in current images; if not, the SETUP checklist has the dashboard fallback). Path conventions: `items/{item_id}/{ulid}.webp`, `categories/{category_id}/{ulid}.webp`, `hero/{ulid}.webp|mp4` — new name per upload (no cache-busting needed; old object removed by the operator after `set_*_photo` succeeds). Images are compressed client-side to ≤ 1600 px WebP (~≤ 400 KB); the 25 MiB bucket limit exists for hero video. Public URL: `{SUPABASE_URL}/storage/v1/object/public/menu-media/{path}`; image transforms (`/render/image/...`) are a Pro feature — do not depend on them.

`packages/db/supabase/config.toml` additions:
```toml
[storage.buckets.menu-media]
public = true
file_size_limit = "25MiB"
allowed_mime_types = ["image/webp", "image/jpeg", "image/png", "video/mp4", "video/webm"]
objects_path = "./buckets/menu-media"      # local placeholder seed (3–4 tiny brand-blue PNG/WebP)

[functions.telegram-callback]
verify_jwt = false                          # Telegram carries no Supabase JWT; secret_token header is the auth
[functions.telegram-send]
verify_jwt = true                           # pg_net posts with the service-role JWT
[functions.analytics-posthog]
verify_jwt = true
[functions.analytics-insights]
verify_jwt = true
```
Declaring `verify_jwt` in config.toml means `supabase functions deploy` applies it without remembering `--no-verify-jwt`.

---

## Wave 2 — Migrations 0032–0034 + fixtures + core helper

### `…0032_telegram.sql`

**Tables**
```sql
create table telegram_outbox (
  id                  bigint generated always as identity primary key,
  kind                text not null check (kind in ('order_new','waiter_call','test')),
  ref_id              uuid,                                  -- orders.id / waiter_calls.id / null (test)
  chat_id             text not null,                         -- snapshot of cafe_settings.telegram_chat_id at enqueue
  payload             jsonb not null,                        -- render snapshot (app.telegram_*_payload)
  text                text,                                  -- HTML actually sent (stamped by sender; needed for editMessageText)
  reply_markup        jsonb,                                 -- keyboard actually sent
  status              text not null default 'queued' check (status in ('queued','sent','failed','skipped')),
  attempts            int  not null default 0,
  last_error          text,
  telegram_message_id bigint,
  scheduled_for       timestamptz not null default now(),
  sent_at             timestamptz,
  created_at          timestamptz not null default now()
);
create unique index telegram_outbox_one_per_ref on telegram_outbox (kind, ref_id) where ref_id is not null;  -- double-enqueue guard
create index telegram_outbox_due on telegram_outbox (scheduled_for) where status = 'queued' and attempts < 8;

create table telegram_actions (                 -- every button tap, including duplicates
  id            bigint generated always as identity primary key,
  at            timestamptz not null default now(),
  action        text not null check (action in ('o:seen','o:served','o:void','w:ack','w:done')),
  ref_id        uuid not null,
  tg_user_id    bigint not null,
  tg_first_name text not null,
  tg_username   text,
  result        text not null check (result in ('applied','duplicate','invalid','not_found','refused')),
  detail        text
);

alter table waiter_calls add column if not exists acknowledged_label text, add column if not exists resolved_label text;
alter table tickets      add column if not exists last_actor_label text;  -- 'Telegram: Ahmed' when the tap moved the ticket
```
RLS: both new tables enabled; `grant select on telegram_outbox, telegram_actions to authenticated`; policy `is_staff('manager','owner')` (the operator Telegram page shows recent deliveries/failures; payloads hold order data staff already see). No client writes. `grant all on telegram_outbox, telegram_actions to service_role` explicitly (belt over 0012 default privileges).

**Secrets access**: `app.secret(p_name text) returns text` (definer, internal) = generalisation of `table_token_secret` lookup: Vault `vault.decrypted_secrets` first, `app.secrets` fallback, NULL if absent, no bootstrap. Names used: `service_role_key` (already documented in README for send-push cron), `functions_base_url` (`https://<ref>.supabase.co/functions/v1`; local `http://host.docker.internal:54321/functions/v1`).

**Payload snapshots** (definer, internal + `grant execute to service_role`):
- `app.telegram_order_payload(p_order_id uuid) returns jsonb` → `{order_id, short_id (upper(left(id::text,8))), table_number, placed_at, source, total_iqd, items:[{qty, name_en, name_ar, variant_en, variant_ar, variant_count, modifiers:[{name_en,name_ar,qty}], notes, line_total_iqd, discount_pct}]}` (non-voided lines, ordered by insertion).
- `app.telegram_call_payload(p_call_id uuid) returns jsonb` → `{call_id, table_number, reason, raised_at}`.

**Enqueue + nudge**
- `app.enqueue_telegram(p_kind text, p_ref_id uuid, p_payload jsonb default null) returns bigint` (internal): returns NULL (no-op) when `telegram_enabled=false` or `telegram_chat_id` null; builds payload via the snapshot fn when `p_payload` null; `insert … on conflict do nothing`; then `perform app.telegram_nudge()`. Callers wrap it in `begin … exception when others then raise warning` — a Telegram bookkeeping failure must never roll back an order or call (0022 posture).
- `app.telegram_nudge() returns void` (internal; also callable by cron): returns immediately unless `exists(select 1 from telegram_outbox where status='queued' and scheduled_for <= now())`; returns if `to_regnamespace('net') is null` or either secret is NULL; `perform net.http_post(url := base||'/telegram-send', headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer '||key), body := '{}'::jsonb, timeout_milliseconds := 5000)`; whole body in an exception guard (warning only).
- Cron (guarded like 0021): `cron.schedule('tp_telegram_sweep', '10 seconds', 'select app.telegram_nudge();')` with fallback to `'* * * * *'` if the seconds syntax raises (pg_cron < 1.5); `cron.schedule('tp_telegram_prune', '30 3 * * *', $$delete from telegram_outbox where sent_at < now() - interval '30 days'; delete from telegram_actions where at < now() - interval '90 days'$$)`.

**Claim (service-role only, mirrors 0024)**
`app.claim_due_telegram(p_limit int default 50) returns setof telegram_outbox` — `update … set attempts = attempts + 1 from (select id … where status='queued' and attempts < 8 and scheduled_for <= now() order by scheduled_for for update skip locked limit p_limit) …`. `revoke all … from public, anon, authenticated; grant execute … to service_role`. The sender stamps rows directly with the service client (send-push precedent): success → `status='sent', sent_at, telegram_message_id, text, reply_markup, last_error=null`; transient failure → `last_error, scheduled_for = now() + least(5s * 2^attempts, 5min)`; permanent 4xx (400 chat not found / parse error, 403 bot kicked) → `status='failed'`; token unset → `status='skipped', last_error='NOT_CONFIGURED'`; `attempts >= 8` → `failed`.

**Internal state-machine refactor** (so Telegram can reuse them without the `is_staff` guard; service-role callers have `auth.uid() = null`):
- `app.ticket_transition(p_ticket_id uuid, p_status ticket_status, p_device_id text, p_actor_label text default null) returns jsonb` = the 0015 `set_ticket_status` body minus the guard, plus `tickets.last_actor_label = coalesce(p_actor_label, last_actor_label)`. `app.set_ticket_status` becomes guard + call (same signature, `create or replace`).
- `app.void_order_item_internal(p_order_item_id uuid, p_reason_code text, p_authorizer uuid, p_device_id text, p_actor jsonb default null) returns jsonb` = the 0026 `void_after_send` body after the PIN step (VOID_REQUIRES_REFUND guard included; audit `order_item.void` with `after || jsonb_build_object('actor', p_actor)`). `app.void_after_send` = guard + PIN + call.
- Waiter ack/resolve: `app.waiter_call_transition(p_call_id uuid, p_to waiter_call_status, p_staff uuid, p_label text) returns jsonb`; `ack_waiter_call` / `resolve_waiter_call` become guard + call (`p_staff = auth.uid()`, `p_label = null`).

**Telegram write-back RPC (service-role only)**
`app.telegram_apply_action(p_action text, p_ref_id uuid, p_actor jsonb) returns jsonb` where `p_actor = {tg_user_id, first_name, username}`; label = `'Telegram: ' || first_name`. Every call inserts a `telegram_actions` row. Mapping:

| action | ref | effect | duplicate when | invalid when |
|---|---|---|---|---|
| `o:seen` | order id → its ticket | `queued → preparing` | ticket already preparing/ready/completed | ticket voided |
| `o:served` | order id | `queued\|preparing → ready → completed` (two internal transitions, one txn); `ready → completed` | already completed | voided |
| `o:void` | order id | every non-voided line via `void_order_item_internal(reason 'telegram', authorizer null)` → order + ticket `voided` (existing logic) | order already voided | tab not open; `VOID_REQUIRES_REFUND` → result `'refused'` |
| `w:ack` | call id | `raised → acknowledged`, `acknowledged_label` | already acknowledged/resolved | — |
| `w:done` | call id | `→ resolved`, `resolved_label` (+ ack label if missing) | already resolved | — |

Returns `{result, status, keyboard: 'order_seen'|'order_final'|'call_acked'|'call_final'|'unchanged', actor_label}`; unknown ref → `{result:'not_found'}`. Existing 0022 triggers (`tickets_rt`, `orders_rt`, `waiter_calls_rt`) fire on these updates, so KDS, till and the guest page update live with no extra work. Audit rows via `app.write_audit_external(p_actor_role text, …)` — a small sibling of `write_audit` that stamps `actor_id = null, actor_role = 'telegram', reason_code = 'telegram'` and the actor jsonb in `after`.

**RPC re-creations in this migration (each the single owner of that function's new body)**
- `app.create_guest_order` (same signature): after the ticket insert, `begin perform app.enqueue_telegram('order_new', v_order.id); exception when others then raise warning …; end;`. Enqueue-at-end (not an `orders` INSERT trigger) because at insert time neither items nor ticket exist and the payload snapshot would be empty.
- `app.raise_waiter_call` (same signature): after `touch_guest_session`, `if not (select bell_enabled from cafe_tables where id = v_sess.table_id) then raise exception 'BELL_DISABLED'`; after the insert, guarded `enqueue_telegram('waiter_call', v_row.id)`.
- `app.telegram_send_test() returns jsonb` — owner only; `TELEGRAM_NOT_CONFIGURED` when `telegram_chat_id` null; enqueues kind `test` with payload `{sent_by: staff.display_name, at: now()}` (no ref_id → no unique clash), nudges, returns `{outbox_id}`; the operator polls `telegram_outbox` by id (`status`, `sent_at`, `last_error`) to show "Sent" / "Failed: chat not found".

### `…0033_realtime_cafe.sql`

- `create or replace function app.rt_waiter_call()`: keep the `floor` send; add a second guarded `realtime.send(jsonb_build_object('call_id', new.id, 'status', new.status, 'reason', new.reason, 'acknowledged_at', new.acknowledged_at, 'resolved_at', new.resolved_at), 'waiter_call_status', 'session:' || new.guest_session_id::text, true)`. The existing `touchpadel_rt_guest_session` policy already authorises the topic; the guest page can drop its 20 s poll.
- `app.rt_menu_changed_any()` — like `rt_menu_changed` but payload `{table, op}` only (link tables / settings have no `id`); for `cafe_settings` fire only when `is_public`. Triggers: `menu_categories_rt`, `modifier_groups_rt`, `modifiers_rt`, `menu_item_modifier_groups_rt`, `modifier_reveals_rt`, `addon_suggestions_rt`, `cafe_settings_rt` (all `after insert or update or delete … for each row`). Clients should debounce `menu_changed` (~500 ms) — frontend note.

### `…0034_analytics.sql`

Helpers (internal): `app.business_date(p_at timestamptz) returns date` = `((p_at at time zone coalesce((select timezone from venue_settings),'Asia/Baghdad')) - make_interval(hours => app.cafe_setting_int('analytics_business_day_start_hour')))::date`; `app.analytics_guard()` raises `FORBIDDEN` unless `is_staff('owner')`; `app.analytics_excluded() returns uuid[]` from settings. Indexes: `orders_placed_at (placed_at)`, `payments_created_at (created_at)`, `refunds_created_at (created_at)`.

Sales basis parameter `p_basis text default 'settled'`: `'settled'` = lines of tabs with `status='settled'` (money truth; matches `payments`); `'served'` = non-voided lines of orders in status `served` OR on settled tabs (live "today so far"). Line filter always `not oi.voided and o.status <> 'voided'` and `menu_item_id <> all(excluded)` except in daily revenue (money is never excluded — UpperDeck rule).

Owner-only `security definer stable` functions returning jsonb (each: guard → `INVALID_RANGE` if `p_to < p_from` or span > 400 days → aggregate):
- `app.analytics_daily_sales(p_from date, p_to date)` → `[{business_date, revenue_iqd (Σ payments − Σ refunds by business day of their created_at), cash_iqd, card_iqd, tabs_settled, orders, items_qty, discount_iqd (tab_adjustments + Σ(list−unit)×qty), tax_iqd, visits (distinct guest_sessions with ≥1 non-voided order), guest_orders, till_orders}]`.
- `app.analytics_sold_items(p_from, p_to, p_basis)` → `[{business_date, menu_item_id, name_en, name_ar, category_id, qty, revenue_iqd, list_revenue_iqd, discount_iqd}]` (day grain; the client rolls up).
- `app.analytics_best_sellers(p_from, p_to, p_limit int default 20, p_basis)` → `[{menu_item_id, name_en, name_ar, category_id, qty, revenue_iqd, share_pct, orders}]`.
- `app.analytics_bought_together(p_from, p_to, p_min_support int default 3, p_limit int default 30, p_scope text default 'order')` → unordered item pairs co-occurring in the same order (`'tab'` scope = same tab) → `[{item_a, item_b, name_a_en/ar, name_b_en/ar, both, count_a, count_b, confidence_ab, confidence_ba, lift, orders_total}]`.
- `app.analytics_item_margins(p_from, p_to, p_basis)` → `{items:[{menu_item_id, names, qty, revenue_iqd, avg_price_iqd, cost_iqd (current cost — not snapshotted, stated in the payload as `cost_as_of`), cost_total_iqd, margin_iqd, margin_pct, has_cost}], coverage:{revenue_with_cost_pct, items_with_cost, items_total}}` — `has_cost=false` rows carry nulls, never 0.
- `app.analytics_price_bands(p_from, p_to, p_basis)` → bands on default-variant price `<3000 / 3000–5999 / 6000–9999 / ≥10000` → `[{band, items:[ids], qty, revenue_iqd}]`.
- `app.analytics_hourly(p_from, p_to)` → `[{dow (0=Sun), hour (venue-local), orders, qty, revenue_iqd}]` from `orders.placed_at` (heatmap + peak hours).
- `app.analytics_promo(p_from, p_to)` → featured lines `{qty, list_revenue_iqd, revenue_iqd, discount_iqd, orders, by_day:[…]}` from `discount_source='featured'`.
- `app.analytics_menu_snapshot()` → `[{menu_item_id, names, category_id, category_names, category_sort, item_sort, price_iqd (default variant), cost_iqd, is_active, sold_out, highlight, has_photo}]` — the client-side matrix / position analysis input.
- `app.menu_item_costs()` (manager|owner) → `[{menu_item_id, cost_iqd}]` for the editor (since `cost_iqd` is not client-selectable).

LLM tables (ported; owner RLS, RPC-only writes, `created_by uuid references staff(id)`):
```sql
create table analytics_insights (id uuid pk default gen_random_uuid(), created_at timestamptz default now(),
  range_from date not null, range_to date not null,
  compare_basis text not null default 'prev' check (compare_basis in ('prev','4w','52w')),
  insights jsonb not null, created_by uuid references staff(id));
create index analytics_insights_range on analytics_insights (range_from, range_to, compare_basis, created_at desc);
create table analytics_patterns (… range_from, range_to, patterns jsonb not null, created_by …);
create index analytics_patterns_range on analytics_patterns (range_from, range_to, created_at desc);
create table analytics_insight_rejections (id uuid pk, created_at, text text not null,
  text_key text not null unique, reason text, created_by uuid references staff(id));
```
RPCs (owner): `app.save_analytics_insights(p_range_from date, p_range_to date, p_compare_basis text, p_insights jsonb) returns uuid`; `app.save_analytics_patterns(p_range_from, p_range_to, p_patterns jsonb) returns uuid`; `app.reject_insight(p_text text, p_reason text default null) returns uuid` (`text_key = app.normalize_finding(p_text)` = lower, strip punctuation `[^[:alnum:][:space:]]`, collapse whitespace, trim; `on conflict (text_key) do nothing` then return the existing id); `app.unreject_insight(p_id uuid) returns void`. `text_key` is a real column for the same reason UpperDeck did it (client upsert on a named column; the edge function must mirror `normalize_finding` byte-for-byte — add a fixture string with Arabic + punctuation to the parity test).

### Fixtures (`packages/db/fixtures/menu.sql`, `tables.sql`, new `cafe_settings` block)
- `menu.sql`: add `hook_en/hook_ar` for all 30 items (e.g. Espresso `'bold · short · roasted' / 'قوي · قصير · محمّص'`, Kahi `'crispy · sweet · Baghdadi' / 'مقرمش · حلو · بغدادي'`); `highlight='blue'` on Kahi (e017), `'brown'` on Kunafa (e023); `sold_out=true` on Mixed Nuts (e030) (not used by e2e); `cost_iqd` on ~12 items (e.g. Espresso 700, Cappuccino 1100, Burger 4500), leave the rest NULL to exercise coverage; `photo_path='items/<id>/fixture.png'` for 3 items whose placeholders ship in `supabase/buckets/menu-media/items/<id>/fixture.png` (tiny brand-blue PNGs written by a new `scripts/make-placeholders.mjs`; committed, ~1 KB each) and `categories/<ca01>/fixture.png` for Hot Drinks.
- Reveal fixture: group `d004 'Make it a meal' / 'اجعلها وجبة' (0,1)` with modifier `d401 'Meal upgrade' / 'ترقية لوجبة' +3000` linked to Burger (e019) and Club (e018); group `d005 'Pick a drink' / 'اختر مشروبك' (1,1)` with `d501 Cola / كولا 0`, `d502 Water / ماء 0`, `d503 Iced tea / شاي مثلج 500`; `insert into modifier_reveals (d401, d005)`. `d005` is NOT linked to any item (pure reveal target).
- `cafe_settings` overrides (`insert … on conflict (key) do update`): `hero_mode='featured'`, `featured_item_id=e017`, labels `'A true Baghdadi breakfast' / 'فطور بغدادي أصيل'`, badge `'New' / 'جديد'`, `featured_discount_pct=15` (Kahi 8000 → 6800; e2e orders Cappuccino, unaffected), `ticker_en=["Fresh beans roasted weekly","Pay at the desk","Free Wi-Fi: touchcafe"]` + Arabic equivalents.
- `tables.sql`: `bell_enabled=false` on T12.
- `package.json` `db:fixtures` unchanged (same files).

---

## Wave 3 — Types, tests, RLS matrix

- `pnpm --filter @touch/db db:types` after `supabase db reset --local`; commit `src/types.gen.ts` (CI drift check).
- `tests/helpers.ts` additions: `addRevealGroup(svc, revealingModifierId, {min,max}, modifiers[])`, `setCafeSetting(ownerClient, key, value)`, `resetCafeSettings(svc)` (restore spec defaults), `ensureCafeProbeData` extended: probe reveal (`modifiers 106 → new group 107 with modifier 108`), probe `telegram_outbox` row (kind `test`, status `sent`), probe `telegram_actions`, probe `analytics_insights/patterns/rejections` rows, probe `cafe_settings` is seeded by migration already.
- New test files (disjoint from `cafe-flow.test.ts` so waves don't collide; `cafe-flow.test.ts` only gains one assertion: `order_items.list_price_iqd = unit_price_iqd` when no promo):
  - `tests/cafe-menu-ext.test.ts`: sold_out → `menu_item_availability.orderable=false` and `create_guest_order` raises `ITEM_UNAVAILABLE`; `set_item_photo` path validation + `upsert_menu_item` does NOT wipe photo/cost/sold_out; `cost_iqd` not selectable by cashier/guest, readable via `menu_item_costs` by manager; reveals: modifier from revealed group rejected (`MODIFIER_INVALID`) when the revealing option is absent, accepted with it, revealed group `min_select=1` enforced only when revealed (`MODIFIER_SELECTION`), `set_modifier_reveals` raises `REVEAL_SELF` / `REVEAL_DEPTH`; featured discount: set hero featured 15% on the test item → snapshot `unit_price_iqd = applyPctDiscountIqd(list,15)`, `list_price_iqd` kept, `discount_source='featured'`, parity against `@touch/core` for pct 1..99 × a few list prices; settings split: anon/guest read `cafe_settings_public` rows and no `telegram_%` key; manager `set_cafe_setting('telegram_chat_id')` → `FORBIDDEN`, owner ok; `INVALID_SETTING_VALUE` cases; storage: manager can upload `items/x/y.webp`, guest upload rejected, anon download ok (skip if storage API unreachable).
  - `tests/telegram.test.ts`: with `telegram_enabled=true` + chat id set: guest order enqueues one `order_new` row with payload items/table/total; idempotent replay of `create_guest_order` does not double-enqueue; waiter call enqueues `waiter_call`; `claim_due_telegram` as service role returns rows and bumps `attempts`, second immediate claim returns nothing, guest/staff clients get permission denied; `telegram_apply_action('o:seen')` → ticket preparing + `last_actor_label`, duplicate on repeat, `o:served` → completed/served, `w:ack`/`w:done` stamp labels with `*_by` NULL, `o:void` on a paid tab → `refused`; `telegram_actions` rows written; `BELL_DISABLED` on a table with the bell off; `telegram_send_test` owner-only; with `telegram_enabled=false` nothing is enqueued.
  - `tests/analytics.test.ts`: seed a closed day with a settled tab → `analytics_daily_sales` revenue equals payments; `analytics_bought_together` finds the seeded pair; margins coverage math with one NULL-cost item; manager → `FORBIDDEN`; `reject_insight` dedupes on `text_key`.
- `tests/rls-matrix.ts` appended rows (`drop: 4`): select `cafe_settings` (anon denied, manager/owner rows, others silence), `cafe_settings_public` (rows for all), `modifier_reveals` (rows for all), `telegram_outbox`/`telegram_actions` (anon denied, manager/owner rows, others silence; insert denied for all), `analytics_insights`/`analytics_patterns`/`analytics_insight_rejections` (owner rows only; writes denied), `menu_items` columns `cost_iqd` → denied for all; RPC rows: `set_cafe_setting` (manager execute on a content key), `set_modifier_reveals`, `set_item_photo`, `set_item_sold_out`, `set_item_cost`, `set_table_bell`, `table_qr_tokens`, `upsert_cafe_table` (manager|owner execute, others guarded, anon denied), `telegram_send_test` (owner execute only), `claim_due_telegram` + `telegram_apply_action` (denied for every principal), `analytics_daily_sales` + `save_analytics_insights` + `reject_insight` (owner execute, manager guarded). Add `WRITE_FILTERS` for `telegram_outbox` / `telegram_actions` (`['id', -1]`) and `cafe_settings` (`['key','__none__']`).
- `apps/operator/src/lib/errors.ts` `MAPPED_CODES` + both catalogs: `INVALID_HIGHLIGHT, HOOK_TOO_LONG, INVALID_PHOTO_PATH, INVALID_COST, REVEAL_SELF, REVEAL_DEPTH, UNKNOWN_SETTING, INVALID_SETTING_VALUE, TABLE_NUMBER_TAKEN, BELL_DISABLED, TELEGRAM_NOT_CONFIGURED, MODIFIER_INVALID, MODIFIER_NOT_FOUND, GROUP_NOT_FOUND`; web `RPC_ERROR_KEYS`: `BELL_DISABLED`.

---

## Wave 4 — Edge functions + docs

### `packages/db/supabase/functions/_shared/telegram.ts`
`esc(s)` (`& < >` only — all Telegram HTML needs), `fmtIqd(n)` (Latin digits, thousands separator), `fmtTime(iso)` (`Asia/Baghdad`, `HH:mm`), `renderOrder(payload, lang)`, `renderCall(payload, lang)`, `renderTest(payload)`, `orderKeyboard(orderId, stage)`, `callKeyboard(callId, stage)`, `statusFooter(action, actorLabel, at)`, `tg(method, body)` (fetch `https://api.telegram.org/bot${TOKEN}/${method}`, returns `{ok, result, error_code, description, retry_after}`), `truncateItems(lines, budget)` (keeps the message < 4000 chars, appends `… و N أصناف أخرى / +N more`).

**Templates (verbatim; `{ }` = substitutions, all user text passed through `esc`)**

Order (`kind = order_new`):
```
🛎 <b>طلب جديد · New order</b>  #{short_id}
🪑 <b>طاولة {table}</b> · Table {table}
🕒 {HH:mm}
────────────
{qty}× {name_ar} / {name_en}{ · variant_ar if variant_count > 1}{ · modifiers_ar joined by ' · ' (qty>1 → 'name ×2')}
   📝 «{notes}»                       ← only when the line has notes
────────────
💰 <b>المجموع: {total} د.ع</b> · Total {total} IQD
💵 الدفع عند الكاشير · Pay at the desk
```
Example: `2× كابتشينو / Cappuccino · كبير · حليب شوفان`. With `telegram_lang='en'` the variant/modifier fragment uses `_en` names; item lines are always bilingual.
Keyboard (one row): `✅ شوهد` → `o:seen:{order_id}`, `🍽 تم التقديم` → `o:served:{order_id}`, `❌ إلغاء` → `o:void:{order_id}` (max 45 bytes, under the 64-byte cap).

Waiter call (`kind = waiter_call`):
```
🙋 <b>نداء نادل · Waiter call</b>
🪑 <b>طاولة {table}</b> · Table {table}
{reason_line}
🕒 {HH:mm}
```
`reason_line`: order → `🍽 يريد الطلب · Wants to order`; bill → `💳 الحساب · The bill`; water → `💧 ماء · Water`; assistance → `🙋 مساعدة · Assistance`.
Keyboard: `✅ أنا قادم` → `w:ack:{call_id}`, `✔️ تم` → `w:done:{call_id}`.

Test (`kind = test`):
```
🔔 <b>رسالة تجريبية · Test message</b>
تم ربط تتش كافيه بهذه المجموعة بنجاح ✅
Touch Cafe is connected to this group.
🕒 {HH:mm} · بواسطة {sent_by}
```

Status footer appended by `editMessageText` after a tap (original HTML + `\n\n` + footer; keyboard reduced per `keyboard`): `✅ شوهد · Seen — {actor} · {HH:mm}`, `🍽 تم التقديم · Served — …`, `❌ أُلغي · Cancelled — …`, `✅ قادم · On the way — …`, `✔️ تم · Done — …`. Keyboards: `order_seen` → `[🍽 تم التقديم] [❌ إلغاء]`; `order_final` / `call_final` → none; `call_acked` → `[✔️ تم]`.
`answerCallbackQuery` toasts: applied `تم ✅`; duplicate `سبق تسجيله`; invalid `غير ممكن الآن`; not_found `غير موجود`; refused (paid tab) `الطلب مدفوع — الإلغاء من الكاشير`.

### `functions/telegram-send/index.ts`
POST only; `isServiceRoleRequest` else 403; if `TELEGRAM_BOT_TOKEN` unset → claim rows and mark `skipped` (`NOT_CONFIGURED`), return `{configured:false}`; `claim_due_telegram(50)`; per row render by `kind`, `sendMessage {chat_id, text, parse_mode:'HTML', reply_markup, disable_web_page_preview:true}`; result handling per the 0032 stamping rules (429 → `scheduled_for = now + retry_after`); returns `{claimed, sent, failed, skipped}`. Sequential sends (Telegram group limit ~20 msg/min; bursts are small).

### `functions/telegram-callback/index.ts`
Zero supabase-js on the hot path? No — use the shared service client (cold start is fine at this volume). Flow: POST; `req.headers.get('X-Telegram-Bot-Api-Secret-Token') === TELEGRAM_WEBHOOK_SECRET` else 401 (unset secret fails closed); parse update; non-`callback_query` → `200 {ok:true}`; `callback_data` must match `^(o:(seen|served|void)|w:(ack|done)):([0-9a-f-]{36})$` else answer "Unknown" + 200; call `app.telegram_apply_action(action, ref_id, {tg_user_id: from.id, first_name: from.first_name, username: from.username})` with the service client; `answerCallbackQuery(id, toast)`; if `keyboard !== 'unchanged'` → look up `telegram_outbox` by `(kind, ref_id)` for `text`, then `editMessageText {chat_id, message_id (from the update), text: text + footer, parse_mode:'HTML', reply_markup}`; on any internal error still return 200 with `{ok:false}` (a non-2xx makes Telegram retry the update indefinitely). Double taps: `apply_action` is idempotent (`duplicate`), and after the edit the buttons are gone.

### `functions/_shared/auth.ts`
`requireStaffRole(req, service, roles: StaffRole[]) → {userId, role} | Response(401/403)` using `getCallerUserId` + `staff` lookup (`is_active`). Used by both analytics proxies.

### `functions/analytics-posthog/index.ts`
Request `POST {query: QueryName, from: 'YYYY-MM-DD', to: 'YYYY-MM-DD', business_day_start_hour?: number, params?: Record<string,string|number>}`; auth owner only. Response `200 {configured: boolean, query, from, to, columns: string[], rows: unknown[][], cached_at: string}`; `configured:false` (empty rows) when `POSTHOG_PERSONAL_API_KEY` / `POSTHOG_PROJECT_ID` are unset; `POSTHOG_HOST` default `https://eu.posthog.com`. Named HogQL templates only (client never sends HogQL): `ping`, `daily_engagement` (views/carts/sessions per business day), `top_viewed_items`, `top_carted_items`, `abandoned_by_dwell` (`item_view_abandoned` bucketed 5–10 s / 10–20 s / 20 s+), `funnel` (pageview → item_viewed → item_added_to_basket → order_submitted), `locale_split`, `table_activity` (session-level `table_number` super-property), `week_heatmap` (weekday × hour of `$pageview`), `peak_hours`, `promo_engagement` (`featured_item_clicked`, `suggested_item_clicked` → sessions → added), `item_views_with_price`, `session_stats` (median duration). Business-day shift in HogQL: `toDate(toTimeZone(timestamp,'Asia/Baghdad') - interval {h} hour)`. 30 s in-memory cache keyed by `(query,from,to,h,params)`; 3 retries on 5xx. Event/property names follow decisions §5a (`item_id, item_name, price_iqd, category_id, discount_pct, dwell_ms, qty, table_number, locale`).

### `functions/analytics-insights/index.ts`
Request `POST {mode: 'insights'|'patterns'|'revalidate'|'replace_rejected', lang: 'ar'|'en', range_from, range_to, compare_basis, data: {kpis, daily, best_sellers, margins, bought_together, price_bands, promo, engagement?, prior_insights?: string[], rejections: string[], patterns?: Pattern[]}}` — the operator gathers SQL + PostHog data first and posts it (function stays stateless, testable, and never writes with the service role; persistence goes through the owner's `save_analytics_*` RPCs). Response `200 {degraded: boolean, model: string|null, insights: [{text, kind, subjects: string[], metrics: object, confidence: 'high'|'medium'|'low'}], patterns?: […]}`. Groq via raw fetch `https://api.groq.com/openai/v1/chat/completions`, `GROQ_MODEL` default `openai/gpt-oss-120b`, judge `llama-3.1-8b-instant`, JSON-mode output, post-filters: drop findings whose `normalizeFinding(text)` ∈ rejections (must equal `app.normalize_finding`), cap 8. Without `GROQ_API_KEY` → `degraded:true` with deterministic templated sentences from `data` (best seller, worst margin item, top pair, promo uplift) so the card still renders.

### `functions/SETUP-telegram.md` (owner checklist)
1. @BotFather → `/newbot` ("Touch Cafe Orders", username ending in `bot`) → copy token.
2. Create the staff group, add the bot, disable the bot's privacy mode is NOT required (callbacks work regardless), send any message, `curl https://api.telegram.org/bot<TOKEN>/getUpdates` → copy the negative `chat.id` (include the minus).
3. `openssl rand -hex 32` → webhook secret.
4. `cd packages/db && pnpm exec supabase secrets set TELEGRAM_BOT_TOKEN=… TELEGRAM_WEBHOOK_SECRET=…`.
5. Vault (SQL editor): `select vault.create_secret('<service-role-key>','service_role_key'); select vault.create_secret('https://<ref>.supabase.co/functions/v1','functions_base_url');` and enable `pg_net` + `pg_cron` under Database → Extensions.
6. `pnpm exec supabase functions deploy telegram-send telegram-callback` (verify_jwt from config.toml; confirm with `supabase functions list`).
7. `curl "https://api.telegram.org/bot<TOKEN>/setWebhook" -d url=https://<ref>.supabase.co/functions/v1/telegram-callback -d secret_token=<SECRET> -d allowed_updates='["callback_query"]'`; verify `getWebhookInfo` (`pending_update_count: 0`, no `last_error_message`).
8. Operator → Settings → Telegram: paste chat id, enable, press "Send test" → message arrives; then place a fixture order and tap `✅ شوهد` → KDS ticket flips to preparing.
9. Troubleshooting table: no message → `telegram_outbox.last_error` + `telegram-send` logs; buttons dead → `getWebhookInfo` / secret mismatch (401 in callback logs); wrong group → re-read `getUpdates`; slow (>10 s) → pg_net/Vault secrets missing (only the cron sweep is running).
Local dev: `supabase/functions/.env` (gitignored) with the two secrets; `pnpm exec supabase functions serve --env-file supabase/functions/.env`; set `functions_base_url` in `app.secrets` to `http://host.docker.internal:54321/functions/v1`; expose the callback with `ngrok`/`cloudflared` only when testing real taps.

`packages/db/README.md`: extend "Edge functions" with the four new functions, secrets matrix (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `POSTHOG_PERSONAL_API_KEY`, `POSTHOG_PROJECT_ID`, `POSTHOG_HOST`, `GROQ_API_KEY`, `GROQ_MODEL`), Vault names, cron jobs.

---

## Roles / RLS / grant matrix additions (summary)

| Surface | anon | guest (auth) | cashier/prep/desk | manager | owner |
|---|---|---|---|---|---|
| `menu_items` new cols except `cost_iqd` | select (active) | select | select | select | select |
| `menu_items.cost_iqd` | no | no | no | via `menu_item_costs()` | via RPC |
| `modifier_reveals` | select | select | select | select | select |
| `cafe_settings` (base) | denied | silence | silence | select | select |
| `cafe_settings_public` | select | select | select | select | select |
| `set_cafe_setting` content keys | – | guarded | guarded | execute | execute |
| `set_cafe_setting` telegram_*/analytics_* | – | guarded | guarded | FORBIDDEN | execute |
| `set_item_photo/sold_out/cost`, `set_category_photo`, `set_modifier_reveals`, `set_table_bell`, `upsert_cafe_table`, `table_qr_tokens` | – | guarded | guarded | execute | execute |
| `telegram_outbox`, `telegram_actions` | denied | silence | silence | select | select |
| `telegram_send_test` | – | guarded | guarded | guarded | execute |
| `claim_due_telegram`, `telegram_apply_action`, `telegram_*_payload`, `enqueue_telegram`, `telegram_nudge` | denied | denied | denied | denied | denied (service_role only) |
| `analytics_*` fns, `save_analytics_*`, `reject_insight` | – | guarded | guarded | guarded | execute |
| `analytics_insights/patterns/rejections` | denied | silence | silence | silence | select |
| `storage.objects` bucket `menu-media` | read | read | read | read/write | read/write |

---

## Wave sequencing and verification

Each wave touches disjoint files so agents can run in parallel within a wave.

**Wave 0 — baseline**: `cd packages/db && pnpm exec supabase start && pnpm exec supabase db reset && pnpm --filter @touch/db test` (289 green) — establishes the pre-change contract.

**Wave 1 (parallel, 5 agents)**: 0027, 0028, 0029, 0030, 0031 + `config.toml` + `packages/core/src/money/discount.ts` (+ export from `packages/core/src/index.ts`, unit test). Verify: `pnpm exec supabase db reset` (all migrations apply on a clean slate; 0030 depends on columns from 0027–0029 which apply earlier by number), then `pnpm --filter @touch/db test` must still be green (existing tests only), `pnpm --filter @touch/core test`.

**Wave 2 (parallel, 4 agents)**: 0032, 0033, 0034, fixtures (`menu.sql`, `tables.sql`, `scripts/make-placeholders.mjs`, `supabase/buckets/menu-media/**`). Verify: `db reset` + `pnpm --filter @touch/db db:fixtures` + existing tests green; `select app.telegram_order_payload(id) from orders limit 1` sanity via `supabase db query`; `select * from cron.job` shows `tp_telegram_sweep`.

**Wave 3 (sequential inside, parallel across files)**: `pnpm --filter @touch/db db:types` (commit), then `helpers.ts`, `rls-matrix.ts`, `cafe-menu-ext.test.ts`, `telegram.test.ts`, `analytics.test.ts`, `cafe-flow.test.ts` (one assertion), operator/web error-code maps. Verify: `pnpm --filter @touch/db test` (new suites + matrix green), `git diff --exit-code -- packages/db/src/types.gen.ts` after a second `db:types`.

**Wave 4 (parallel, 3 agents)**: `_shared/telegram.ts` + `telegram-send` + `telegram-callback`; `_shared/auth.ts` + `analytics-posthog` + `analytics-insights`; `SETUP-telegram.md` + README. Verify locally:
```
pnpm exec supabase functions serve --env-file supabase/functions/.env
# sender (service key from `supabase status`):
curl -X POST http://127.0.0.1:54321/functions/v1/telegram-send -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}'
# callback (order id from a fixture order):
curl -X POST http://127.0.0.1:54321/functions/v1/telegram-callback \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"update_id":1,"callback_query":{"id":"1","from":{"id":42,"first_name":"Ahmed"},"message":{"message_id":7,"chat":{"id":-1001}},"data":"o:seen:<order_uuid>"}}'
# expect 200 {"ok":true}, tickets.status = preparing, telegram_actions row, KDS broadcast
# wrong secret → 401; unknown data → 200 + "Unknown"
curl -X POST http://127.0.0.1:54321/functions/v1/analytics-posthog -H "Authorization: Bearer <owner JWT>" -d '{"query":"ping","from":"2026-08-01","to":"2026-08-25"}'   # {configured:false} without secrets; manager JWT → 403
```
`deno check supabase/functions/**/index.ts` for type errors.

**Wave 5 — hosted rollout (owner-run, sequential)**: `supabase link --project-ref lczijabnorujcgmbuqlw`; `supabase db push` (0027–0034, additive; verify `select count(*) from cafe_settings` = 15 and the bucket exists; if storage policies raised `insufficient_privilege`, create them from the Dashboard per SETUP); `supabase secrets set …`; `supabase functions deploy telegram-send telegram-callback analytics-posthog analytics-insights` (verify_jwt from config.toml — `telegram-callback` is the only one without JWT verification); Vault secrets + `pg_net`; `setWebhook` with `secret_token`; test message from the operator; `db-migrate.yml` needs no change (it pushes migrations on merge to main).

---

## Risks and mitigations

- **Telegram 4096-char limit**: big orders → `truncateItems` keeps ≤ 4000 chars with a "+N more" line; the full order is always in KDS.
- **HTML injection**: every guest string (notes, names) through `esc()`; item names come from the DB but are still escaped (an `&` in "Lemon & Mint" would otherwise 400 the whole message).
- **Double delivery**: partial unique index prevents double enqueue; claim increments attempts before the send; if `sendMessage` succeeds but the row update fails, the next sweep resends (rare; callback stays correct either way). Callback edits are idempotent.
- **Cron latency / cost**: 10-second cron runs SQL only (no HTTP when idle); pg_net nudge from the enqueue path gives ~1–3 s; without pg_net the floor is ~10 s (documented); `pg_cron` seconds syntax needs ≥ 1.5 (fallback to per-minute with a notice).
- **Service-role exposure**: never leaves the DB/edge layer — `service_role_key` lives in Vault (not in `cron.job` SQL), only `telegram-send` accepts it, the operator never holds it; `telegram_apply_action` and `claim_due_telegram` have no client EXECUTE (matrix rows assert it).
- **Hosted additive-only**: no drops except the `upsert_menu_item` overload replacement (function, not data); new NOT NULL columns all have defaults; `add_order_items` replacement keeps the signature; storage policy creation may need the dashboard on hosted.
- **Enum additions**: none (all text + check) — deliberately avoids the "new enum value in same transaction" trap.
- **Featured discount and the till**: till preview totals may differ from the server snapshot until the till reads `cafe_settings_public` — server is authoritative; frontend follow-up.
- **`cost_iqd` column revoke**: switching `menu_items` to a column grant list breaks any client `select *` on `menu_items` — audit `apps/operator` MenuEditor and `apps/web` fetchMenu (explicit columns today) and the rls-matrix `menu_items` rule (`*` → column list).
- **Function body ownership**: `create_guest_order` and `raise_waiter_call` are re-created only in 0032; `open_table_session` only in 0031; `set_ticket_status`/`void_after_send`/ack/resolve only in 0032 — a later migration must copy the full current body (0026 lesson).
- **PostHog/Groq absent** (no accounts yet): proxies return `configured:false` / `degraded:true`; nothing throws; dashboard renders empty-state cards.
- **Realtime fan-out**: more `menu_changed` triggers → burst on bulk edits; clients debounce.

### Critical Files for Implementation
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\packages\db\supabase\migrations\20260824000015_tabs_orders.sql` (bodies of `add_order_items`, `create_guest_order`, `set_ticket_status`, `void_after_send` that 0030/0032 re-create)
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\packages\db\supabase\migrations\20260824000024_push_outbox.sql` (outbox/claim pattern mirrored by `telegram_outbox` / `claim_due_telegram`)
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\packages\db\supabase\migrations\20260824000022_realtime.sql` (trigger/policy pattern extended in 0033)
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\packages\db\supabase\functions\send-push\index.ts` + `functions\_shared\supabase.ts` (edge-function skeleton for `telegram-send`, auth helper for the proxies)
- `C:\Users\p.mansouri\Desktop\kagu software\TouchPadel\packages\db\tests\rls-matrix.ts` + `tests\helpers.ts` (matrix rows and probe data for every new surface)