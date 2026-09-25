-- 0166 shopping_purchases — the shopping list, what the driver bought, and the
-- manager receiving it into stock.
--
-- Feature: protocols and the staff phone, lane C
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.15, §2.21; plan §6.4, §7.2).
-- Depends on: staff_push (G: app.notify_staff, app.staff_ids_with_roles),
-- staff_media_bucket (G: app.claim_staff_media, the receipt photo),
-- staff_ingredient_options (A: the phone's ingredient picker and the driver's
-- pack helper read through it). The phone's staff-shopping and
-- staff-purchase (H) and the operator's Goods in "Bought by the driver" (I)
-- read and write through the RPCs below.
-- Re-runnable: create … if not exists, create or replace, drop policy if
-- exists, on conflict do nothing.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on new, empty tables
--
-- THE FLOW. A head barista, a head chef or a manager adds a line to the list;
-- it goes straight to the venue's drivers, with no approval and no suggested
-- quantity (plan #11). The driver buys, and records what was bought, what was
-- paid, where, and a photo of the receipt: record_purchase marks the list's
-- lines bought and tells the managers. It never touches the till, the drawer
-- or day close; paying the driver back happens outside the system. The
-- manager then receives the purchase in Goods in: receive_purchase books every
-- stock line through app.receive_delivery in ONE transaction and links the
-- delivery to the purchase; a line that is not stock (cleaning supplies) is
-- acknowledged instead, and so is a stock line whose ingredient was switched
-- off after it was bought, before the rest is received.
--
-- BASE UNITS. A purchase line of a stock ingredient is recorded in the
-- ingredient's base unit (g, ml or pc), because delivery_lines.unit_cost_iqd
-- is a cost per base unit (0017:108): receiving passes price ÷ quantity.
--
-- WHO READS. The three tables are MGMT at the venue; a driver also reads the
-- purchases they made, with their lines (their own prices). Everyone else on
-- the list reads it through shopping_list, which carries no price. No client
-- holds an insert, update or delete grant: every write is a definer RPC.
--
-- covered by packages/db/tests/shopping-purchases.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. Tables. purchases first: shopping_items points at the purchase that
--    bought it.
-- ---------------------------------------------------------------------------
create table if not exists purchases (
  id            uuid primary key default gen_random_uuid(),
  venue_id      uuid not null references venues(id),
  staff_id      uuid not null references staff(id),
  bought_at     timestamptz not null,
  shop_name     text check (shop_name is null or length(shop_name) <= 80),
  total_iqd     iqd not null,
  receipt_path  text,
  status        text not null default 'to_receive' check (status in ('to_receive','done')),
  delivery_id   uuid references deliveries(id),
  received_by   uuid references staff(id),
  received_at   timestamptz,
  created_at    timestamptz not null default now(),
  constraint purchases_received_chk check ((received_by is null) = (received_at is null))
);

create table if not exists shopping_items (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id),
  ingredient_id  uuid references ingredients(id),
  label          text check (label is null or length(label) <= 80),
  qty            numeric(12,3) not null check (qty > 0),
  unit           text not null check (unit in ('g','ml','pc','pack')),
  note           text check (note is null or length(note) <= 200),
  requested_by   uuid not null references staff(id),
  requested_at   timestamptz not null default now(),
  status         text not null default 'open'
                 check (status in ('open','bought','cancelled','received','acknowledged')),
  purchase_id    uuid references purchases(id),
  cancelled_by   uuid references staff(id),
  cancelled_at   timestamptz,
  constraint shopping_items_what_chk
    check (ingredient_id is not null or coalesce(length(btrim(label)),0) > 0)
);

create table if not exists purchase_lines (
  id                uuid primary key default gen_random_uuid(),
  purchase_id       uuid not null references purchases(id) on delete cascade,
  shopping_item_id  uuid references shopping_items(id),
  ingredient_id     uuid references ingredients(id),
  label             text check (label is null or length(label) <= 80),
  qty               numeric(12,3) not null check (qty > 0),
  price_iqd         iqd not null,
  status            text not null default 'to_receive'
                    check (status in ('to_receive','received','acknowledged')),
  -- No delivery_line_id: the link is purchases.delivery_id. receive_delivery
  -- returns only {delivery_id, batch_ids} and delivery_lines has no order and
  -- no back reference (0017:103-111), so two lines of one ingredient could
  -- not be matched to theirs.
  constraint purchase_lines_what_chk
    check (ingredient_id is not null or coalesce(length(btrim(label)),0) > 0)
);

-- ---------------------------------------------------------------------------
-- 2. Indexes (new, empty tables: the header's waiver).
-- ---------------------------------------------------------------------------
create index if not exists shopping_items_open_idx   on shopping_items (venue_id) where status = 'open';
create index if not exists purchases_venue_status_idx on purchases (venue_id, status);
create index if not exists purchase_lines_purchase_idx on purchase_lines (purchase_id);

-- ---------------------------------------------------------------------------
-- 3. Comments.
-- ---------------------------------------------------------------------------
comment on table purchases is
  'shopping_purchases (§2.15): one shop visit by the driver (or a manager): where, when, the total paid and the receipt photo. Recorded by app.record_purchase; received into stock by app.receive_purchase, which links the delivery. Never touches the till, the drawer or day close. Read by MGMT at the venue, and by the staff member who made it.';
comment on column purchases.id is 'Purchase id.';
comment on column purchases.venue_id is 'The venue the purchase was for.';
comment on column purchases.staff_id is 'Who bought it (the driver, or a manager).';
comment on column purchases.bought_at is 'When it was bought.';
comment on column purchases.shop_name is 'Where it was bought, as typed (at most 80 characters); suppliers stay management''s.';
comment on column purchases.total_iqd is 'What the receipt came to, in IQD. Paying the driver back happens outside the system.';
comment on column purchases.receipt_path is 'The receipt photo: a staff-media path in the receipts folder, read by its uploader and management only.';
comment on column purchases.status is 'to_receive until every line is received or acknowledged, then done.';
comment on column purchases.delivery_id is 'The delivery app.receive_purchase booked its stock lines into (one purchase, one delivery).';
comment on column purchases.received_by is 'The manager or owner who received it.';
comment on column purchases.received_at is 'When it was received.';
comment on column purchases.created_at is 'When it was recorded.';

comment on table shopping_items is
  'shopping_purchases (§2.15): the shopping list. Added by the head barista, the head chef or management through app.add_shopping_item and sent straight to the venue''s drivers, with no approval. Read by MGMT at the venue; the bar and kitchen family and the driver read it through app.shopping_list.';
comment on column shopping_items.id is 'Shopping line id.';
comment on column shopping_items.venue_id is 'The venue it is for.';
comment on column shopping_items.ingredient_id is 'The stock ingredient to buy; NULL for something that is not stock, named by the label.';
comment on column shopping_items.label is 'What to buy, as typed (at most 80 characters): required when there is no ingredient.';
comment on column shopping_items.qty is 'How much to buy, in the unit.';
comment on column shopping_items.unit is 'g, ml, pc or pack. For an ingredient, its base unit or pack.';
comment on column shopping_items.note is 'An optional note for the driver (at most 200 characters).';
comment on column shopping_items.requested_by is 'Who added it.';
comment on column shopping_items.requested_at is 'When it was added.';
comment on column shopping_items.status is 'open, bought (on a purchase), cancelled, received (its purchase line was received into stock) or acknowledged (a non-stock line the manager acknowledged).';
comment on column shopping_items.purchase_id is 'The purchase that bought it.';
comment on column shopping_items.cancelled_by is 'Who took it off the list (the requester or management).';
comment on column shopping_items.cancelled_at is 'When it was taken off the list.';

comment on table purchase_lines is
  'shopping_purchases (§2.15): what one purchase bought, line by line, and what each cost. A stock line''s quantity is in the ingredient''s base unit. Read by MGMT at the venue and by the purchase''s buyer.';
comment on column purchase_lines.id is 'Purchase line id.';
comment on column purchase_lines.purchase_id is 'The purchase.';
comment on column purchase_lines.shopping_item_id is 'The shopping-list line it bought, if any.';
comment on column purchase_lines.ingredient_id is 'The stock ingredient bought; NULL for a line that is not stock.';
comment on column purchase_lines.label is 'What was bought, as typed, when it is not stock (or as a note beside the ingredient).';
comment on column purchase_lines.qty is 'How much was bought: the ingredient''s base unit (g, ml or pc) for a stock line.';
comment on column purchase_lines.price_iqd is 'What this line cost, in IQD. Receiving books price ÷ quantity as the cost per base unit.';
comment on column purchase_lines.status is 'to_receive, received (booked into stock) or acknowledged (not stock).';

-- ---------------------------------------------------------------------------
-- 4. RLS: select-only. MGMT at the venue on all three; a buyer also reads
--    their own purchases and their lines.
-- ---------------------------------------------------------------------------
alter table purchases      enable row level security;
alter table shopping_items enable row level security;
alter table purchase_lines enable row level security;

drop policy if exists shopping_items_mgmt_read on shopping_items;
create policy shopping_items_mgmt_read on shopping_items
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists purchases_mgmt_read on purchases;
create policy purchases_mgmt_read on purchases
  for select to authenticated
  using (app.is_staff('manager','owner') and venue_id = any(app.staff_venue_ids()));

drop policy if exists purchases_read_own on purchases;
create policy purchases_read_own on purchases
  for select to authenticated
  using (staff_id = auth.uid());

drop policy if exists purchase_lines_read on purchase_lines;
create policy purchase_lines_read on purchase_lines
  for select to authenticated
  using (exists (select 1 from purchases p
                  where p.id = purchase_lines.purchase_id
                    and (p.staff_id = auth.uid()
                         or (app.is_staff('manager','owner')
                             and p.venue_id = any(app.staff_venue_ids())))));

grant select on purchases, shopping_items, purchase_lines to authenticated;
grant all on purchases, shopping_items, purchase_lines to service_role;

-- ---------------------------------------------------------------------------
-- 5. app.shopping_list — the bar and kitchen family, the driver and MGMT at
--    the venue. No price anywhere: the list says what to buy, not what it
--    cost.
-- ---------------------------------------------------------------------------
create or replace function app.shopping_list(
  p_venue_id uuid default null,
  p_status   text default 'open'
) returns jsonb
language plpgsql stable security definer set search_path = public as $shopping_list_0166$
declare
  v_venue  uuid;
  v_status text := coalesce(p_status, 'open');
  v_items  jsonb;
  v_open   int;
begin
  if not app.is_staff('head_barista','barista','head_chef','chef','driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','barista','head_chef','chef','driver','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_status not in ('open','bought','cancelled','received','acknowledged') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'status';
  end if;

  -- The open list oldest first (what has waited longest); the others newest
  -- first. 200 at most.
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                x.id,
           'ingredient_id',     x.ingredient_id,
           'name_en',           x.name_en,
           'name_ar',           x.name_ar,
           'label',             x.label,
           'qty',               x.qty,
           'unit',              x.unit,
           'note',              x.note,
           'requested_by_name', x.requested_by_name,
           'requested_at',      x.requested_at,
           'status',            x.status,
           'mine',              x.mine)
         order by x.ord), '[]'::jsonb)
    into v_items
    from (select si.id, si.ingredient_id, i.name_en, i.name_ar, si.label, si.qty, si.unit, si.note,
                 s.display_name as requested_by_name, si.requested_at, si.status,
                 si.requested_by = auth.uid() as mine,
                 row_number() over (order by
                   case when v_status = 'open' then si.requested_at end asc,
                   case when v_status <> 'open' then si.requested_at end desc,
                   si.id) as ord
            from shopping_items si
            left join ingredients i on i.id = si.ingredient_id
            left join staff s on s.id = si.requested_by
           where si.venue_id = v_venue
             and si.status = v_status
           order by ord
           limit 200) x;

  select count(*) into v_open
    from shopping_items si
   where si.venue_id = v_venue and si.status = 'open';

  return jsonb_build_object('items', v_items, 'open_count', v_open);
end $shopping_list_0166$;

comment on function app.shopping_list(uuid, text) is
  'shopping_purchases (§2.15). The bar and kitchen family, the driver and MGMT at the venue: {items: [{id, ingredient_id, name_en, name_ar, label, qty, unit, note, requested_by_name, requested_at, status, mine}], open_count} for one status (default open: oldest first; the others newest first; at most 200). No price. INVALID_ARGUMENT (hint status); FORBIDDEN for anyone else.';

revoke all on function app.shopping_list(uuid, text) from public, anon;
grant execute on function app.shopping_list(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.add_shopping_item — the head barista, the head chef and MGMT at the
--    venue. Straight to the venue's drivers: one push per driver in 15
--    minutes however many lines are added (dedupe shopping:<venue>).
-- ---------------------------------------------------------------------------
create or replace function app.add_shopping_item(
  p_venue_id        uuid,
  p_ingredient_id   uuid,
  p_label           text,
  p_qty             numeric,
  p_unit            text,
  p_note            text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $add_shopping_item_0166$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_ing    ingredients%rowtype;
  v_label  text := nullif(btrim(coalesce(p_label, '')), '');
  v_note   text := nullif(btrim(coalesce(p_note, '')), '');
  v_unit   text := lower(btrim(coalesce(p_unit, '')));
  v_id     uuid;
  v_result jsonb;
begin
  if not app.is_staff('head_barista','head_chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  v_replay := app.claim_replay(p_idempotency_key, 'add_shopping_item');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_ingredient_id is not null then
    select * into v_ing from ingredients
     where id = p_ingredient_id and venue_id = v_venue and is_active;
    if not found then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif v_label is null then
    raise exception 'SHOPPING_LABEL_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_label) > 80 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'label';
  end if;
  if length(v_note) > 200 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  -- numeric(12,3): a quantity that rounds to nothing or overflows is refused
  -- here, never as a raw check or overflow error.
  if p_qty is null or round(p_qty, 3) <= 0 or p_qty >= 1000000000 then
    raise exception 'INVALID_QTY' using errcode = 'P0001';
  end if;
  if v_unit not in ('g','ml','pc','pack')
     or (v_ing.id is not null and v_unit not in (v_ing.unit::text, 'pack')) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'unit';
  end if;

  insert into shopping_items (venue_id, ingredient_id, label, qty, unit, note, requested_by)
  values (v_venue, v_ing.id, v_label, round(p_qty, 3), v_unit, v_note, auth.uid())
  returning id into v_id;

  perform app.write_audit('shopping.add', 'shopping_item', v_id::text, null,
                          jsonb_build_object('ingredient_id', v_ing.id, 'qty', round(p_qty, 3), 'unit', v_unit));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['driver']::staff_role[]),
    'staff_task',
    jsonb_build_object('route', 'staff-shopping', 'title_key', 'shopping_new', 'params', '{}'::jsonb),
    'shopping:' || v_venue::text);

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $add_shopping_item_0166$;

comment on function app.add_shopping_item(uuid, uuid, text, numeric, text, text, text) is
  'shopping_purchases (§2.15). The head barista, the head chef and MGMT at the venue: puts a line on the shopping list, an active ingredient of the venue (unit its base unit or pack) or a label (at most 80), with a quantity and an optional note (at most 200), and tells the venue''s drivers (staff_task / shopping_new, deduped shopping:<venue> for 15 minutes). Returns {id}. Idempotent by key. INGREDIENT_NOT_FOUND, SHOPPING_LABEL_REQUIRED, INVALID_QTY, INVALID_ARGUMENT (hint unit), TEXT_TOO_LONG. Audit shopping.add.';

revoke all on function app.add_shopping_item(uuid, uuid, text, numeric, text, text, text) from public, anon;
grant execute on function app.add_shopping_item(uuid, uuid, text, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.cancel_shopping_item — the requester, or MGMT at the venue; an open
--    line only.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_shopping_item(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $cancel_shopping_item_0166$
declare
  v_item shopping_items%rowtype;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_item from shopping_items where id = p_id for update;
  if not found or not (v_item.venue_id = any(app.staff_venue_ids())) then
    raise exception 'SHOPPING_ITEM_NOT_OPEN' using errcode = 'P0001';
  end if;
  if not (v_item.requested_by = auth.uid() or app.is_staff_at(v_item.venue_id, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_item.venue_id::text, true);
  if v_item.status <> 'open' then
    raise exception 'SHOPPING_ITEM_NOT_OPEN' using errcode = 'P0001';
  end if;

  update shopping_items
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_id;

  perform app.write_audit('shopping.cancel', 'shopping_item', p_id::text,
                          jsonb_build_object('status', 'open'),
                          jsonb_build_object('status', 'cancelled'));
end $cancel_shopping_item_0166$;

comment on function app.cancel_shopping_item(uuid) is
  'shopping_purchases (§2.15). The requester, or MGMT at the venue: takes an open line off the shopping list. SHOPPING_ITEM_NOT_OPEN for a line that is not open (or at a venue the caller does not work at); FORBIDDEN for anyone else. Audit shopping.cancel.';

revoke all on function app.cancel_shopping_item(uuid) from public, anon;
grant execute on function app.cancel_shopping_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.record_purchase — the driver and MGMT at the venue. One shop visit:
--    its lines (bought from the list or not), what each cost, the total, the
--    shop and the receipt photo. The list's lines become bought; the managers
--    are told. Nothing here touches the till, the drawer or day close.
-- ---------------------------------------------------------------------------
create or replace function app.record_purchase(
  p_venue_id        uuid,
  p_lines           jsonb,
  p_total_iqd       bigint,
  p_shop            text,
  p_receipt_path    text,
  p_bought_at       timestamptz default now(),
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $record_purchase_0166$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_venue   uuid;
  v_replay  jsonb;
  v_shop    text := nullif(btrim(coalesce(p_shop, '')), '');
  v_receipt text := nullif(btrim(coalesce(p_receipt_path, '')), '');
  v_at      timestamptz := coalesce(p_bought_at, now());
  v_id      uuid;
  v_el      jsonb;
  v_item    shopping_items%rowtype;
  v_ing     uuid;
  v_label   text;
  v_qty     numeric;
  v_price   numeric;
  v_n       int := 0;
  v_bought  int := 0;
  v_result  jsonb;
begin
  if not app.is_staff('driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'driver','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);

  -- Claimed before the list lines are checked: a retried save finds them
  -- bought by its own first attempt and must get that result, not
  -- SHOPPING_ITEM_NOT_OPEN.
  v_replay := app.claim_replay(p_idempotency_key, 'record_purchase');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array'
     or jsonb_array_length(p_lines) not between 1 and 40 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  if p_total_iqd is null or p_total_iqd < 0 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001', hint = 'total_iqd';
  end if;
  if length(v_shop) > 80 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'shop';
  end if;
  if v_at > now() + interval '5 minutes' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'bought_at';
  end if;

  insert into purchases (venue_id, staff_id, bought_at, shop_name, total_iqd, receipt_path)
  values (v_venue, auth.uid(), v_at, v_shop, p_total_iqd, v_receipt)
  returning id into v_id;

  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if coalesce(jsonb_typeof(v_el->'qty'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    v_qty := (v_el->>'qty')::numeric;
    if round(v_qty, 3) <= 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;
    if coalesce(jsonb_typeof(v_el->'price_iqd'), 'null') <> 'number' then
      raise exception 'INVALID_AMOUNT' using errcode = 'P0001', hint = 'price_iqd';
    end if;
    v_price := (v_el->>'price_iqd')::numeric;
    if v_price < 0 or v_price <> trunc(v_price) or v_price > 9000000000000000 then
      raise exception 'INVALID_AMOUNT' using errcode = 'P0001', hint = 'price_iqd';
    end if;

    v_ing   := null;
    v_label := nullif(btrim(coalesce(v_el->>'label', '')), '');
    v_item  := null;
    if nullif(v_el->>'shopping_item_id', '') is not null then
      if (v_el->>'shopping_item_id') !~ c_uuid then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'shopping_item_id';
      end if;
      select * into v_item from shopping_items
       where id = (v_el->>'shopping_item_id')::uuid and venue_id = v_venue
       for update;
      if not found or v_item.status <> 'open' then
        raise exception 'SHOPPING_ITEM_NOT_OPEN' using errcode = 'P0001';
      end if;
      v_ing   := v_item.ingredient_id;
      v_label := coalesce(v_label, v_item.label);
    end if;
    if nullif(v_el->>'ingredient_id', '') is not null then
      if (v_el->>'ingredient_id') !~ c_uuid then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'ingredient_id';
      end if;
      v_ing := (v_el->>'ingredient_id')::uuid;
    end if;
    if v_ing is not null
       and not exists (select 1 from ingredients i where i.id = v_ing and i.venue_id = v_venue and i.is_active) then
      raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v_ing is null and v_label is null then
      raise exception 'SHOPPING_LABEL_REQUIRED' using errcode = 'P0001';
    end if;
    if length(v_label) > 80 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'label';
    end if;

    insert into purchase_lines (purchase_id, shopping_item_id, ingredient_id, label, qty, price_iqd)
    values (v_id, v_item.id, v_ing, v_label, round(v_qty, 3), v_price::bigint);
    v_n := v_n + 1;

    if v_item.id is not null then
      update shopping_items set status = 'bought', purchase_id = v_id where id = v_item.id;
      v_bought := v_bought + 1;
    end if;
  end loop;

  if v_receipt is not null then
    perform app.claim_staff_media(array[v_receipt], v_venue, array['receipts'], 'purchase:' || v_id::text);
  end if;

  perform app.write_audit('purchase.record', 'purchase', v_id::text, null,
                          jsonb_build_object('lines', v_n, 'from_list', v_bought,
                                             'total_iqd', p_total_iqd, 'receipt', v_receipt is not null));

  perform app.notify_staff(
    app.staff_ids_with_roles(v_venue, array['manager']::staff_role[]),
    'staff_task',
    jsonb_build_object('route', 'staff', 'title_key', 'purchase_to_receive', 'params', '{}'::jsonb));

  v_result := jsonb_build_object('purchase_id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $record_purchase_0166$;

comment on function app.record_purchase(uuid, jsonb, bigint, text, text, timestamptz, text) is
  'shopping_purchases (§2.15). The driver and MGMT at the venue: records one purchase, p_lines [{shopping_item_id?, ingredient_id?, label?, qty, price_iqd}] (1 to 40; a stock line''s qty in the ingredient''s base unit), the total paid, the shop (at most 80) and the receipt photo (a receipts slot of the caller, claimed as purchase:<id>). Marks the list''s lines bought and tells the venue''s managers (staff_task / purchase_to_receive). Never touches the till, the drawer or day close. Returns {purchase_id}. Idempotent by key. SHOPPING_ITEM_NOT_OPEN, INGREDIENT_NOT_FOUND, SHOPPING_LABEL_REQUIRED, INVALID_QTY, INVALID_AMOUNT, INVALID_ARGUMENT (lines, bought_at), PHOTO_PATH_INVALID, TEXT_TOO_LONG. Audit purchase.record.';

revoke all on function app.record_purchase(uuid, jsonb, bigint, text, text, timestamptz, text) from public, anon;
grant execute on function app.record_purchase(uuid, jsonb, bigint, text, text, timestamptz, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.my_purchases — the driver's own purchases; MGMT sees every purchase
--    at the venue.
-- ---------------------------------------------------------------------------
create or replace function app.my_purchases(
  p_venue_id uuid default null,
  p_limit    int  default 30
) returns jsonb
language plpgsql stable security definer set search_path = public as $my_purchases_0166$
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
           'id',        p.id,
           'bought_at', p.bought_at,
           'shop_name', p.shop_name,
           'total_iqd', p.total_iqd,
           'status',    p.status,
           'lines',     (select coalesce(jsonb_agg(jsonb_build_object(
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
end $my_purchases_0166$;

comment on function app.my_purchases(uuid, int) is
  'shopping_purchases (§2.15). The driver (their own purchases) and MGMT (every purchase) at the venue: {purchases: [{id, bought_at, shop_name, total_iqd, status, lines: [{label, name_en, name_ar, qty, unit, price_iqd, status}]}]}, newest first, p_limit 1 to 100 (default 30). FORBIDDEN for anyone else.';

revoke all on function app.my_purchases(uuid, int) from public, anon;
grant execute on function app.my_purchases(uuid, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.purchases_to_receive — MGMT at the venue: Goods in's "Bought by the
--     driver" list, oldest first, with what receiving needs per line.
-- ---------------------------------------------------------------------------
create or replace function app.purchases_to_receive(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $purchases_to_receive_0166$
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
           'id',           p.id,
           'staff_name',   s.display_name,
           'bought_at',    p.bought_at,
           'shop_name',    p.shop_name,
           'total_iqd',    p.total_iqd,
           'receipt_path', p.receipt_path,
           'lines',        (select coalesce(jsonb_agg(jsonb_build_object(
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
   where p.venue_id = v_venue
     and p.status = 'to_receive';

  return jsonb_build_object('count', jsonb_array_length(v_rows), 'purchases', v_rows);
end $purchases_to_receive_0166$;

comment on function app.purchases_to_receive(uuid) is
  'shopping_purchases (§2.15). MGMT at the venue: {count, purchases: [{id, staff_name, bought_at, shop_name, total_iqd, receipt_path, lines: [{id, ingredient_id, ingredient_active, name_en, name_ar, unit, pack_size, label, qty, price_iqd, status}]}]}, the purchases still to receive, oldest first; ingredient_active false marks a stock line whose ingredient was switched off since (acknowledged, not received). FORBIDDEN for anyone else.';

revoke all on function app.purchases_to_receive(uuid) from public, anon;
grant execute on function app.purchases_to_receive(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. app.receive_purchase — MGMT at the venue. ONE transaction: lock the
--     purchase, book every stock line still to receive through the public
--     app.receive_delivery (0145) as one delivery, link it, mark the lines.
--     Two client calls (receive, then link) could leave a booked delivery
--     with the purchase still "to receive", and a second receive under a new
--     key would book the stock twice.
-- ---------------------------------------------------------------------------
create or replace function app.receive_purchase(
  p_purchase_id     uuid,
  p_lines           jsonb,
  p_supplier_id     uuid default null,
  p_supplier_name   text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $receive_purchase_0166$
declare
  c_uuid     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_replay   jsonb;
  v_p        purchases%rowtype;
  v_el       jsonb;
  v_lid      uuid;
  v_line     purchase_lines%rowtype;
  v_qty      numeric;
  v_exp      date;
  v_ids      uuid[] := '{}';
  v_payload  jsonb := '[]'::jsonb;
  v_sname    text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  v_delivery jsonb;
  v_status   text;
  v_result   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- Claimed before the purchase's state is read: a retry under the same key
  -- returns the first delivery; a new key finds the purchase received.
  v_replay := app.claim_replay(p_idempotency_key, 'receive_purchase');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_p from purchases where id = p_purchase_id for update;
  if not found or not (v_p.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_p.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- receive_delivery's inserts take venue_id from app.current_venue().
  perform set_config('app.venue_id', v_p.venue_id::text, true);

  if v_p.delivery_id is not null or v_p.status = 'done' then
    raise exception 'PURCHASE_ALREADY_RECEIVED' using errcode = 'P0001';
  end if;
  perform 1 from purchase_lines where purchase_id = v_p.id order by id for update;
  if not exists (select 1 from purchase_lines where purchase_id = v_p.id and ingredient_id is not null) then
    -- Nothing here is stock: its lines are acknowledged, not received.
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  -- A stock line whose ingredient was switched off after it was bought cannot
  -- be booked (receive_delivery takes active ingredients only). It is
  -- acknowledged first (acknowledge_purchase_line), or the ingredient is
  -- switched back on; until then the purchase is refused as a whole, so the
  -- one delivery never leaves a line behind. The detail names the line.
  select pl.id into v_lid
    from purchase_lines pl
    join ingredients i on i.id = pl.ingredient_id
   where pl.purchase_id = v_p.id and pl.status = 'to_receive' and not i.is_active
   order by pl.id
   limit 1;
  if found then
    raise exception 'INGREDIENT_NOT_FOUND' using errcode = 'P0001', hint = 'lines', detail = v_lid::text;
  end if;
  if length(v_sname) > 80 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'supplier_name';
  end if;
  if p_supplier_id is not null
     and not exists (select 1 from suppliers where id = p_supplier_id and venue_id = v_p.venue_id) then
    raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el->>'purchase_line_id', '') !~ c_uuid then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    v_lid := (v_el->>'purchase_line_id')::uuid;
    select * into v_line from purchase_lines where id = v_lid and purchase_id = v_p.id;
    if not found or v_lid = any(v_ids) then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if v_line.ingredient_id is null then
      -- A line that is not stock is acknowledged (acknowledge_purchase_line).
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    if v_line.status <> 'to_receive' then
      raise exception 'PURCHASE_ALREADY_RECEIVED' using errcode = 'P0001';
    end if;
    if coalesce(jsonb_typeof(v_el->'qty_received'), 'null') <> 'number' then
      raise exception 'INVALID_QTY' using errcode = 'P0001', hint = 'qty_received';
    end if;
    v_qty := (v_el->>'qty_received')::numeric;
    if v_qty < 0 or v_qty >= 1000000000 then
      raise exception 'INVALID_QTY' using errcode = 'P0001', hint = 'qty_received';
    end if;
    v_exp := null;
    if nullif(v_el->>'expiry_date', '') is not null then
      begin
        v_exp := (v_el->>'expiry_date')::date;
      exception when others then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'expiry_date';
      end;
    end if;

    v_ids := v_ids || v_lid;
    v_payload := v_payload || jsonb_build_array(jsonb_build_object(
      'ingredient_id', v_line.ingredient_id,
      'qty_expected',  v_line.qty,
      'qty_received',  v_qty,
      -- A cost per base unit (0017:108): the line's quantity is in base units.
      -- Four places, as Goods in rounds a pack price (unitCostFromPack).
      'unit_cost_iqd', round(v_line.price_iqd::numeric / v_line.qty, 4),
      'expiry_date',   v_exp));
  end loop;

  -- Every stock line still to receive is named, so one purchase makes exactly
  -- one delivery; a short line is a qty_received below what was bought.
  if exists (select 1 from purchase_lines
              where purchase_id = v_p.id and ingredient_id is not null
                and status = 'to_receive' and not (id = any(v_ids))) then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;

  -- The outer claim covers the whole call, so receive_delivery takes no key.
  -- The delivery is named by the typed name, else the chosen supplier (which
  -- receive_delivery fills in), else the shop the driver typed.
  v_delivery := app.receive_delivery(
    p_lines           => v_payload,
    p_supplier_name   => case when p_supplier_id is null then coalesce(v_sname, v_p.shop_name) else v_sname end,
    p_notes           => null,
    p_device_id       => null,
    p_supplier_id     => p_supplier_id,
    p_idempotency_key => null);

  update purchase_lines set status = 'received' where id = any(v_ids);
  update shopping_items si
     set status = 'received'
    from purchase_lines pl
   where pl.id = any(v_ids)
     and si.id = pl.shopping_item_id
     and si.status = 'bought';

  v_status := case when exists (select 1 from purchase_lines
                                 where purchase_id = v_p.id and status = 'to_receive')
                   then 'to_receive' else 'done' end;
  update purchases
     set delivery_id = (v_delivery->>'delivery_id')::uuid,
         received_by = auth.uid(),
         received_at = now(),
         status      = v_status
   where id = v_p.id;

  perform app.write_audit('purchase.receive', 'purchase', v_p.id::text,
                          jsonb_build_object('status', v_p.status),
                          jsonb_build_object('status', v_status,
                                             'delivery_id', v_delivery->>'delivery_id',
                                             'lines', cardinality(v_ids)));

  v_result := jsonb_build_object('delivery_id', (v_delivery->>'delivery_id')::uuid,
                                 'received_line_ids', to_jsonb(v_ids));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $receive_purchase_0166$;

comment on function app.receive_purchase(uuid, jsonb, uuid, text, text) is
  'shopping_purchases (§2.15). MGMT at the purchase''s venue, one transaction: p_lines [{purchase_line_id, qty_received, expiry_date?}] must name every stock line still to receive (a short line receives less than was bought); they are booked through app.receive_delivery as ONE delivery (cost per base unit = price ÷ quantity; named p_supplier_name, else the supplier p_supplier_id, else the shop), purchases.delivery_id links it, the lines become received and the purchase done once no line is left. Returns {delivery_id, received_line_ids}. Idempotent by key. PURCHASE_NOT_FOUND, PURCHASE_ALREADY_RECEIVED, INVALID_ARGUMENT (hint lines: a missing, unknown, repeated or non-stock line), INGREDIENT_NOT_FOUND (hint lines, detail the line: a stock line whose ingredient was switched off since, to acknowledge first), INVALID_QTY, SUPPLIER_NOT_FOUND and receive_delivery''s codes. Audit purchase.receive.';

revoke all on function app.receive_purchase(uuid, jsonb, uuid, text, text) from public, anon;
grant execute on function app.receive_purchase(uuid, jsonb, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. app.acknowledge_purchase_line — MGMT at the venue: a line that is not
--     stock, or can no longer be booked, is acknowledged, never booked.
-- ---------------------------------------------------------------------------
create or replace function app.acknowledge_purchase_line(p_line_id uuid)
returns void
language plpgsql security definer set search_path = public as $acknowledge_purchase_line_0166$
declare
  v_p      purchases%rowtype;
  v_line   purchase_lines%rowtype;
  v_status text;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The purchase first, then the line: receive_purchase's lock order.
  select p.* into v_p
    from purchases p
   where p.id = (select pl.purchase_id from purchase_lines pl where pl.id = p_line_id)
   for update;
  if not found or not (v_p.venue_id = any(app.staff_venue_ids())) then
    raise exception 'PURCHASE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_p.venue_id, 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_p.venue_id::text, true);

  select * into v_line from purchase_lines where id = p_line_id for update;
  if v_line.ingredient_id is not null
     and exists (select 1 from ingredients i where i.id = v_line.ingredient_id and i.is_active) then
    -- A stock line is received (receive_purchase), never acknowledged; one
    -- whose ingredient has been switched off since cannot be booked, so it is
    -- closed here like a line that is not stock.
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'line';
  end if;
  if v_line.status <> 'to_receive' then
    raise exception 'PURCHASE_ALREADY_RECEIVED' using errcode = 'P0001';
  end if;

  update purchase_lines set status = 'acknowledged' where id = p_line_id;
  if v_line.shopping_item_id is not null then
    update shopping_items set status = 'acknowledged'
     where id = v_line.shopping_item_id and status = 'bought';
  end if;

  v_status := case when exists (select 1 from purchase_lines
                                 where purchase_id = v_p.id and status = 'to_receive')
                   then 'to_receive' else 'done' end;
  if v_status = 'done' then
    update purchases
       set status      = 'done',
           received_by = coalesce(received_by, auth.uid()),
           received_at = coalesce(received_at, now())
     where id = v_p.id;
  end if;

  perform app.write_audit('purchase.acknowledge', 'purchase', v_p.id::text,
                          jsonb_build_object('line_id', p_line_id, 'status', 'to_receive'),
                          jsonb_build_object('line_id', p_line_id, 'status', 'acknowledged',
                                             'purchase_status', v_status));
end $acknowledge_purchase_line_0166$;

comment on function app.acknowledge_purchase_line(uuid) is
  'shopping_purchases (§2.15). MGMT at the purchase''s venue: acknowledges a purchase line that is not stock, or a stock line whose ingredient was switched off since it was bought (its shopping-list line becomes acknowledged); the purchase is done once no line is left to receive. PURCHASE_NOT_FOUND, PURCHASE_ALREADY_RECEIVED, INVALID_ARGUMENT (hint line: a stock line of an active ingredient is received, not acknowledged). Audit purchase.acknowledge.';

revoke all on function app.acknowledge_purchase_line(uuid) from public, anon;
grant execute on function app.acknowledge_purchase_line(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 13. Owner assistant: the three tables join the table_read allowlist (the
--     0144 statement, limited to this migration's tables, §1.5; never the
--     all-table catch-up).
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
   and c.table_name in ('shopping_items', 'purchases', 'purchase_lines')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
