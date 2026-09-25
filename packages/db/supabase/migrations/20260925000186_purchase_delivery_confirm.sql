-- 0186 purchase_delivery_confirm — the driver confirms a purchase was delivered to
-- the venue.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.10, §2.15, §2.22; plan #70).
-- Depends on: nothing.
-- Re-issues (§2.18): app.my_purchases and app.purchases_to_receive from 0166,
-- same signatures. record_purchase and receive_purchase are not re-issued:
-- receiving never waits for Delivered.
-- Re-runnable: add column if not exists, guarded constraint adds and
-- validates, create or replace.
--
-- THE DRIVER'S RUN (#70) is the phone's page over what exists: the open
-- shopping list shown as a checklist (its ticks are the phone's own state
-- until "Record purchase", PROPOSAL), one record_purchase per shop visit with
-- its receipt photo, then Delivered on each purchase. The buyer or MGMT
-- confirms; it works whether the purchase is still to receive or already
-- received, and a manager may receive first (PROPOSAL). It sends no push
-- (PROPOSAL): record_purchase already told the managers.
--
-- my_purchases now carries each purchase's receipt_path (the buyer reads
-- their own receipts as their uploader) and delivered_at;
-- purchases_to_receive carries delivered_at and delivered_by_name for Goods
-- in (I).
--
-- covered by packages/db/tests/purchase-delivery-confirm.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. purchases: who confirmed the delivery, and when.
-- ---------------------------------------------------------------------------
alter table purchases add column if not exists delivered_at timestamptz;
alter table purchases add column if not exists delivered_by uuid;

do $add_constraints_0186$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'purchases_delivered_by_fkey'
                    and conrelid = 'public.purchases'::regclass) then
    alter table purchases
      add constraint purchases_delivered_by_fkey
      foreign key (delivered_by) references staff(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'purchases_delivered_chk'
                    and conrelid = 'public.purchases'::regclass) then
    alter table purchases
      add constraint purchases_delivered_chk
      check ((delivered_by is null) = (delivered_at is null)) not valid;
  end if;
end $add_constraints_0186$;

do $validate_constraints_0186$
begin
  if exists (select 1 from pg_constraint
              where conname = 'purchases_delivered_by_fkey'
                and conrelid = 'public.purchases'::regclass and not convalidated) then
    alter table purchases validate constraint purchases_delivered_by_fkey;
  end if;
  if exists (select 1 from pg_constraint
              where conname = 'purchases_delivered_chk'
                and conrelid = 'public.purchases'::regclass and not convalidated) then
    alter table purchases validate constraint purchases_delivered_chk;
  end if;
end $validate_constraints_0186$;

comment on column purchases.delivered_at is
  'purchase_delivery_confirm (§2.24.10): when the buyer (or a manager) confirmed the purchase was delivered to the venue; NULL until then. Receiving never waits for it.';
comment on column purchases.delivered_by is
  'Who confirmed the delivery: the buyer, or a manager or the owner.';

-- ---------------------------------------------------------------------------
-- 2. app.confirm_purchase_delivery — the buyer, or MGMT at the purchase's
--    venue. State-idempotent: a confirmed purchase returns its first
--    confirmation.
-- ---------------------------------------------------------------------------
create or replace function app.confirm_purchase_delivery(p_purchase_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $confirm_purchase_delivery_0186$
declare
  v_p purchases%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_p from purchases where id = p_purchase_id for update;
  if not found or not (v_p.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not (v_p.staff_id = auth.uid() or app.is_staff_at(v_p.venue_id, 'manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_p.venue_id::text, true);

  if v_p.delivered_at is null then
    update purchases set delivered_at = now(), delivered_by = auth.uid()
     where id = v_p.id
     returning * into v_p;
    perform app.write_audit('purchase.deliver', 'purchase', v_p.id::text,
                            jsonb_build_object('delivered', false, 'status', v_p.status),
                            jsonb_build_object('delivered', true, 'status', v_p.status));
  end if;

  return jsonb_build_object('purchase_id', v_p.id,
                            'delivered_at', v_p.delivered_at,
                            'delivered_by_name', (select s.display_name from staff s where s.id = v_p.delivered_by));
end $confirm_purchase_delivery_0186$;

comment on function app.confirm_purchase_delivery(uuid) is
  'purchase_delivery_confirm (§2.24.10, #70). The purchase''s buyer, or MGMT at its venue: confirms the purchase was delivered to the venue, whether it is still to receive or already received. Returns {purchase_id, delivered_at, delivered_by_name}; a repeat returns the first confirmation. No push. PURCHASE_NOT_FOUND (unknown or elsewhere), FORBIDDEN. Audit purchase.deliver.';

revoke all on function app.confirm_purchase_delivery(uuid) from public, anon;
grant execute on function app.confirm_purchase_delivery(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.my_purchases — 0166 verbatim, plus each purchase's receipt_path and
--    delivered_at.
-- ---------------------------------------------------------------------------
create or replace function app.my_purchases(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_purchases_0186$
declare
  v_venue uuid;
  v_mgmt  boolean;
  v_limit int := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_rows  jsonb;
begin
  if not app.is_staff('driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'driver','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_mgmt := app.is_staff_at(v_venue, 'manager', 'owner');

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           p.id,
           'bought_at',    p.bought_at,
           'shop_name',    p.shop_name,
           'total_iqd',    p.total_iqd,
           'status',       p.status,
           'receipt_path', p.receipt_path,
           'delivered_at', p.delivered_at,
           'lines',        (select coalesce(jsonb_agg(jsonb_build_object(
                                     'label',     pl.label,
                                     'name_en',   i.name_en,
                                     'name_ar',   i.name_ar,
                                     'qty',       pl.qty,
                                     'unit',      coalesce(i.unit::text, si.unit),
                                     'price_iqd', pl.price_iqd,
                                     'status',    pl.status)
                                   order by coalesce(i.name_en, pl.label), pl.id), '[]'::jsonb)
                              from purchase_lines pl
                              left join ingredients i on i.id = pl.ingredient_id
                              left join shopping_items si on si.id = pl.shopping_item_id
                             where pl.purchase_id = p.id))
         order by p.bought_at desc, p.id), '[]'::jsonb)
    into v_rows
    from (select * from purchases p
           where p.venue_id = v_venue
             and (v_mgmt or p.staff_id = auth.uid())
           order by p.bought_at desc, p.id
           limit v_limit) p;

  return jsonb_build_object('purchases', v_rows);
end $my_purchases_0186$;

comment on function app.my_purchases(uuid, int) is
  'shopping_purchases (§2.15), re-issued by purchase_delivery_confirm (§2.24.10). The driver (their own purchases) and MGMT (every purchase) at the venue: {purchases: [{id, bought_at, shop_name, total_iqd, status, receipt_path, delivered_at, lines: [{label, name_en, name_ar, qty, unit, price_iqd, status}]}]}, newest first, p_limit 1 to 100 (default 30). The receipt is the buyer''s own, readable to them as its uploader. FORBIDDEN for anyone else.';

revoke all on function app.my_purchases(uuid, int) from public, anon;
grant execute on function app.my_purchases(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.purchases_to_receive — 0166 verbatim, plus delivered_at and
--    delivered_by_name.
-- ---------------------------------------------------------------------------
create or replace function app.purchases_to_receive(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $purchases_to_receive_0186$
declare
  v_venue uuid;
  v_rows  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                p.id,
           'staff_name',        s.display_name,
           'bought_at',         p.bought_at,
           'shop_name',         p.shop_name,
           'total_iqd',         p.total_iqd,
           'receipt_path',      p.receipt_path,
           'delivered_at',      p.delivered_at,
           'delivered_by_name', d.display_name,
           'lines',             (select coalesce(jsonb_agg(jsonb_build_object(
                                          'id',            pl.id,
                                          'ingredient_id', pl.ingredient_id,
                                          -- false: switched off since it was bought,
                                          -- so acknowledged rather than received.
                                          'ingredient_active', case when pl.ingredient_id is not null then i.is_active end,
                                          'name_en',       i.name_en,
                                          'name_ar',       i.name_ar,
                                          'unit',          coalesce(i.unit::text, si.unit),
                                          'pack_size',     i.pack_size,
                                          'label',         pl.label,
                                          'qty',           pl.qty,
                                          'price_iqd',     pl.price_iqd,
                                          'status',        pl.status)
                                        order by coalesce(i.name_en, pl.label), pl.id), '[]'::jsonb)
                                   from purchase_lines pl
                                   left join ingredients i on i.id = pl.ingredient_id
                                   left join shopping_items si on si.id = pl.shopping_item_id
                                  where pl.purchase_id = p.id))
         order by p.bought_at, p.id), '[]'::jsonb)
    into v_rows
    from purchases p
    left join staff s on s.id = p.staff_id
    left join staff d on d.id = p.delivered_by
   where p.venue_id = v_venue
     and p.status = 'to_receive';

  return jsonb_build_object('count', jsonb_array_length(v_rows), 'purchases', v_rows);
end $purchases_to_receive_0186$;

comment on function app.purchases_to_receive(uuid) is
  'shopping_purchases (§2.15), re-issued by purchase_delivery_confirm (§2.24.10). MGMT at the venue: {count, purchases: [{id, staff_name, bought_at, shop_name, total_iqd, receipt_path, delivered_at, delivered_by_name, lines: [{id, ingredient_id, ingredient_active, name_en, name_ar, unit, pack_size, label, qty, price_iqd, status}]}]}, the purchases still to receive, oldest first; ingredient_active false marks a stock line whose ingredient was switched off since (acknowledged, not received); delivered_at NULL means the buyer has not confirmed the delivery yet. FORBIDDEN for anyone else.';

revoke all on function app.purchases_to_receive(uuid) from public, anon;
grant execute on function app.purchases_to_receive(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Owner assistant: purchases' new columns join its table_read rows (the
--    0144 statement, limited to this table; the existing rows stay).
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
   and c.table_name in ('purchases')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
