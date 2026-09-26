set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0144 — Touch Shop schema.
--
--   menu_categories.kind   'cafe' | 'shop'. A shop category never reaches the
--                          guest cafe menu and its lines never make a kitchen
--                          ticket (0146).
--   menu_item_variants     sku, barcode. Uniqueness per venue is checked in
--                          app.upsert_retail_variant (BARCODE_TAKEN / SKU_TAKEN):
--                          variants carry no venue_id (FK-derived through
--                          menu_items), so an index cannot express it.
--   ingredients.variant_id the retail variant that owns this stock row (unique:
--                          one ingredient per variant).
--   suppliers              venue-scoped; shared by shop goods-in and the
--                          receipt scanner (0147+). supplier_id is added beside
--                          the free-text supplier_name on ingredients and
--                          deliveries; supplier_name is still written.
--   tabs.kind              'cafe' | 'shop'. Only a shop tab may be opened with
--                          no table and no reservation (a counter sale, 0146).
--                          Deliberately NOT a CHECK on the anchor: open_tab has
--                          refused anchorless tabs only since 0084, and older
--                          rows on the client's database would fail VALIDATE.
--
-- Every new column is nullable or has a constant default, so each ALTER is a
-- catalogue-only change under the 3 s lock timeout.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. suppliers
-- ---------------------------------------------------------------------------
create table if not exists suppliers (
  id         uuid primary key default gen_random_uuid(),
  venue_id   uuid not null default app.current_venue() references venues(id),
  name       text not null check (char_length(btrim(name)) between 1 and 120),
  phone      text check (phone is null or char_length(phone) <= 32),
  notes      text check (notes is null or char_length(notes) <= 500),
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, venue_id)
);

comment on table suppliers is
  'Touch Shop / goods-in suppliers (0144). Venue-scoped; written only through '
  'app.upsert_supplier. Shared by retail goods-in and AI receipt scanning.';

alter table suppliers enable row level security;
grant select on suppliers to authenticated;

drop policy if exists suppliers_mgmt_read on suppliers;
create policy suppliers_mgmt_read on suppliers
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

-- ---------------------------------------------------------------------------
-- 2. menu_categories.kind
-- ---------------------------------------------------------------------------
alter table menu_categories
  add column if not exists kind text not null default 'cafe'
    constraint menu_categories_kind_chk check (kind in ('cafe','shop'));

-- ---------------------------------------------------------------------------
-- 3. menu_item_variants.sku / barcode
-- ---------------------------------------------------------------------------
alter table menu_item_variants
  add column if not exists sku text
    constraint menu_item_variants_sku_chk check (sku is null or sku ~ '^[A-Za-z0-9._/-]{1,64}$');
alter table menu_item_variants
  add column if not exists barcode text
    constraint menu_item_variants_barcode_chk check (barcode is null or barcode ~ '^[A-Za-z0-9-]{4,64}$');

-- ---------------------------------------------------------------------------
-- 4. ingredients.variant_id / supplier_id, deliveries.supplier_id
-- ---------------------------------------------------------------------------
alter table ingredients
  add column if not exists variant_id uuid unique references menu_item_variants(id);
alter table ingredients
  add column if not exists supplier_id uuid references suppliers(id);
alter table deliveries
  add column if not exists supplier_id uuid references suppliers(id);

-- ---------------------------------------------------------------------------
-- 5. tabs.kind
-- ---------------------------------------------------------------------------
alter table tabs
  add column if not exists kind text not null default 'cafe'
    constraint tabs_kind_chk check (kind in ('cafe','shop'));

-- ---------------------------------------------------------------------------
-- 6. Owner assistant: the new table and columns join the table_read allowlist
--    (the 0138 catch-up statement, verbatim; ON CONFLICT keeps it idempotent).
-- ---------------------------------------------------------------------------
insert into app.assistant_readable_columns (table_name, column_name, kind, is_default, data_type, ordinal, note)
select c.table_name,
       c.column_name,
       case when t.table_type = 'VIEW' then 'view' else 'table' end,
       not (c.column_name in ('before', 'after', 'payload', 'idempotency_key', 'device_id',
                              'client_ref', 'photo_path', 'photo_blur')
            or c.data_type = 'jsonb'),
       c.data_type,
       c.ordinal_position,
       col_description(format('public.%I', c.table_name)::regclass, c.ordinal_position)
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
 where c.table_schema = 'public'
   and t.table_type in ('BASE TABLE', 'VIEW')
   -- Secrets never enter the allowlist. The name patterns also match token
   -- COUNTERS (llm_usage.prompt_tokens, cafe_tables.token_version,
   -- venue_settings.table_token_ttl_minutes); a secret is text, a counter is
   -- a number, so numeric and boolean columns are kept.
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
