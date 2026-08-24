-- 0015_tabs_orders — day sessions, tabs, orders, tickets, adjustments, payments,
-- refunds (design-data.md §1.6) + the till/guest ordering RPCs.
--
-- Posture:
--  * prices are ALWAYS snapshotted server-side from the menu tables at send
--    time — never client-supplied (the single most important invariant here).
--  * "send_order" semantics are FOLDED INTO order creation: drafts never hit
--    the server (guest basket lives in the browser, till basket in Electron),
--    so app.create_guest_order / app.till_add_items create the order already
--    'sent' WITH its ticket, atomically. There is no separate send RPC.
--  * PIN-gated RPCs (discount / override / void / refund) take (p_pin,
--    p_reason_code), call app.verify_manager_pin — NULL => raise PIN_INVALID
--    (the attempt row survives; see 0011) — and record applied_by +
--    authorized_by + an audit row.
--  * payments / refunds are append-only (grants + forbid_mutation trigger);
--    corrections are refund rows, never edits.
--  * day CLOSE is NOT here — app.close_day lands in 0020 with its open-tab and
--    unsynced-queue guards.
--  * stock wiring is NOT here — 0018 hooks consumption into order creation,
--    void_after_send waste, and refund reversal (hook comments below).

-- ---------------------------------------------------------------------------
-- Tables (§1.6, exactly)
-- ---------------------------------------------------------------------------
create table day_sessions (
  id                uuid primary key default gen_random_uuid(),
  business_date     date not null unique,
  status            day_status not null default 'open',
  opened_at         timestamptz not null default now(),
  opened_by         uuid not null references staff(id),
  opening_float_iqd iqd not null,
  closed_at         timestamptz,
  closed_by         uuid references staff(id),
  cash_expected_iqd iqd,
  cash_counted_iqd  iqd,
  cash_variance_iqd iqd_signed,
  card_expected_iqd iqd,
  card_terminal_batch_iqd iqd,                 -- manual entry from the terminal
  notes             text
);

create table tabs (
  id                 uuid primary key default gen_random_uuid(),
  day_session_id     uuid not null references day_sessions(id),
  status             tab_status not null default 'open',
  table_id           uuid references cafe_tables(id),
  reservation_id     uuid references reservations(id),     -- CHARGE CAFE TO COURT BOOKING
  label              text,                                 -- "by name"
  opened_by_staff_id uuid references staff(id),            -- null when guest-web opened it
  merged_into_tab_id uuid references tabs(id),             -- merge tables: donor points at survivor
  subtotal_iqd       iqd,                                  -- stamped at settle
  tax_iqd            iqd,
  discount_iqd       iqd,
  total_iqd          iqd,
  opened_at          timestamptz not null default now(),
  settled_at         timestamptz,
  device_id          text,
  idempotency_key    text unique
);

create table orders (
  id                 uuid primary key default gen_random_uuid(),
  tab_id             uuid not null references tabs(id),
  source             order_source not null,
  guest_session_id   uuid references guest_sessions(id),
  placed_by_staff_id uuid references staff(id),
  status             order_status not null default 'sent',
  placed_at          timestamptz not null default now(),
  device_id          text,
  idempotency_key    text unique,
  check ((source = 'guest_web') = (guest_session_id is not null))
);

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  menu_item_id     uuid not null references menu_items(id),
  variant_id       uuid not null references menu_item_variants(id),
  qty              int not null check (qty > 0),
  unit_price_iqd   iqd not null,               -- SNAPSHOT from DB at send time — never client-supplied
  line_total_iqd   iqd not null,               -- (unit + modifiers) * qty, computed server-side
  notes            text,
  voided           boolean not null default false,
  void_reason_code text,
  ready_at         timestamptz
);

create table order_item_modifiers (
  order_item_id   uuid not null references order_items(id) on delete cascade,
  modifier_id     uuid not null references modifiers(id),
  qty             int not null default 1 check (qty > 0),  -- double shot = qty 2
  price_delta_iqd iqd not null,                -- snapshot
  primary key (order_item_id, modifier_id)
);

create table tickets (                         -- 1:1 with a sent order; the KDS unit of work
  id              uuid primary key default gen_random_uuid(),
  order_id        uuid not null unique references orders(id),
  status          ticket_status not null default 'queued',
  target_seconds  int not null default 600,
  created_at      timestamptz not null default now(),
  started_at      timestamptz,
  ready_at        timestamptz,
  completed_at    timestamptz,
  actual_prep_seconds int,                     -- stamped at completion (scope: stored per ticket)
  device_id       text,
  idempotency_key text unique
);

create table tab_adjustments (                 -- discounts / price overrides, PIN-gated
  id            uuid primary key default gen_random_uuid(),
  tab_id        uuid not null references tabs(id),
  order_item_id uuid references order_items(id),   -- null = whole-tab discount
  kind          adjustment_kind not null,
  value         int not null,                  -- percent (bp) or amount depending on kind
  amount_iqd    iqd not null,                  -- resolved effect, for day-close summing
  applied_by    uuid not null references staff(id),
  authorized_by uuid not null references staff(id),   -- PIN holder
  reason_code   text not null,
  created_at    timestamptz not null default now()
);

create table payments (
  id              uuid primary key default gen_random_uuid(),
  tab_id          uuid not null references tabs(id),
  day_session_id  uuid not null references day_sessions(id),
  method          payment_method not null,
  amount_iqd      iqd not null,
  tendered_iqd    iqd,                         -- cash only
  change_iqd      iqd,                         -- cash only; drawer-open record
  recorded_by     uuid not null references staff(id),
  created_at      timestamptz not null default now(),
  device_id       text,
  idempotency_key text unique
);

create table refunds (
  id          uuid primary key default gen_random_uuid(),
  payment_id  uuid not null references payments(id),
  amount_iqd  iqd not null,
  reason_code text not null,
  refunded_by uuid not null references staff(id),    -- manager+ enforced in RPC
  created_at  timestamptz not null default now()
);

create table refund_items (                    -- which lines came back -> stock reversal (0018)
  refund_id     uuid references refunds(id) on delete cascade,
  order_item_id uuid references order_items(id),
  qty           int not null,
  primary key (refund_id, order_item_id)
);

create index tabs_day_open on tabs (day_session_id) where status = 'open';
create index tabs_table_open on tabs (table_id) where status = 'open';
create index orders_tab on orders (tab_id);
create index order_items_order on order_items (order_id);
create index tickets_live on tickets (status, created_at) where status in ('queued','preparing','ready');
create index tab_adjustments_tab on tab_adjustments (tab_id);
create index payments_tab on payments (tab_id);
create index payments_day on payments (day_session_id);
create index refunds_payment on refunds (payment_id);

-- Append-only (design §3.4): payments corrections are refunds; refunds are final.
create trigger payments_ao
  before update or delete on payments
  for each statement execute function app.forbid_mutation();
create trigger refunds_ao
  before update or delete on refunds
  for each statement execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- RLS-policy helpers (definer: no recursive policy evaluation).
-- ---------------------------------------------------------------------------
create or replace function app.order_is_callers(p_order_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from orders o
      join guest_sessions gs on gs.id = o.guest_session_id
     where o.id = p_order_id and gs.auth_user_id = auth.uid()
  )
$$;

create or replace function app.tab_is_callers(p_tab_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1
      from orders o
      join guest_sessions gs on gs.id = o.guest_session_id
     where o.tab_id = p_tab_id and gs.auth_user_id = auth.uid()
  )
$$;

-- ---------------------------------------------------------------------------
-- app.current_open_day — INTERNAL: the single open day session, or NULL.
-- ---------------------------------------------------------------------------
create or replace function app.current_open_day() returns uuid
language sql stable security definer set search_path = public as $$
  select id from day_sessions where status = 'open' order by opened_at desc limit 1
$$;

-- ---------------------------------------------------------------------------
-- app.add_order_items — INTERNAL: validate + snapshot + insert the lines of one
-- order. p_items: [{"variant_id": uuid, "qty": int, "notes": text,
--                   "modifiers": [{"modifier_id": uuid, "qty": int}]}]
-- Prices come from menu tables ONLY. Returns the order's total in integer IQD.
-- ---------------------------------------------------------------------------
create or replace function app.add_order_items(p_order_id uuid, p_items jsonb)
returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_item     jsonb;
  v_mod      jsonb;
  v_variant  menu_item_variants%rowtype;
  v_mi       menu_items%rowtype;
  v_modifier modifiers%rowtype;
  v_qty      int;
  v_mqty     int;
  v_unit     bigint;
  v_mods     bigint;
  v_line     bigint;
  v_oi_id    uuid;
  v_total    bigint := 0;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;

  for v_item in select * from jsonb_array_elements(p_items) loop
    v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
    if v_qty < 1 or v_qty > 99 then
      raise exception 'INVALID_QTY' using errcode = 'P0001';
    end if;

    select * into v_variant from menu_item_variants
     where id = (v_item->>'variant_id')::uuid;
    if not found then
      raise exception 'VARIANT_NOT_FOUND' using errcode = 'P0001',
        detail = v_item->>'variant_id';
    end if;

    select * into v_mi from menu_items where id = v_variant.item_id;
    if not v_mi.is_active
       or v_mi.unavailable_on = current_date
       or not exists (select 1 from menu_categories c where c.id = v_mi.category_id and c.is_active) then
      raise exception 'ITEM_UNAVAILABLE' using errcode = 'P0001',
        detail = v_mi.id::text;
    end if;

    v_unit := v_variant.price_iqd;             -- SNAPSHOT: server price, never client-supplied
    v_mods := 0;

    insert into order_items (order_id, menu_item_id, variant_id, qty,
                             unit_price_iqd, line_total_iqd, notes)
    values (p_order_id, v_mi.id, v_variant.id, v_qty, v_unit, 0,
            nullif(v_item->>'notes', ''))
    returning id into v_oi_id;

    for v_mod in select * from jsonb_array_elements(coalesce(v_item->'modifiers', '[]'::jsonb)) loop
      v_mqty := coalesce(nullif(v_mod->>'qty', '')::int, 1);
      if v_mqty < 1 or v_mqty > 9 then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;

      -- Modifier must be active AND belong to a group linked to this item.
      select m.* into v_modifier
        from modifiers m
        join menu_item_modifier_groups img
          on img.group_id = m.group_id and img.item_id = v_mi.id
       where m.id = (v_mod->>'modifier_id')::uuid and m.is_active;
      if not found then
        raise exception 'MODIFIER_INVALID' using errcode = 'P0001',
          detail = v_mod->>'modifier_id';
      end if;

      insert into order_item_modifiers (order_item_id, modifier_id, qty, price_delta_iqd)
      values (v_oi_id, v_modifier.id, v_mqty, v_modifier.price_delta_iqd);
      -- PK (order_item_id, modifier_id) raises on a duplicate modifier in the payload.

      v_mods := v_mods + v_modifier.price_delta_iqd * v_mqty;
    end loop;

    -- min/max per linked group (distinct choices count; a doubled modifier is one choice).
    if exists (
      select 1
        from menu_item_modifier_groups img
        join modifier_groups g on g.id = img.group_id
        left join lateral (
          select count(*) as chosen
            from order_item_modifiers oim
            join modifiers m2 on m2.id = oim.modifier_id
           where oim.order_item_id = v_oi_id and m2.group_id = g.id
        ) c on true
       where img.item_id = v_mi.id
         and (c.chosen < g.min_select or c.chosen > g.max_select)
    ) then
      raise exception 'MODIFIER_SELECTION' using errcode = 'P0001',
        hint = 'modifier choices violate a group min/max';
    end if;

    v_line := (v_unit + v_mods) * v_qty;
    update order_items set line_total_iqd = v_line where id = v_oi_id;
    v_total := v_total + v_line;
  end loop;

  return v_total;
end $$;

-- ---------------------------------------------------------------------------
-- app.compute_tab_totals — INTERNAL: live totals for a tab. Tax per design §2:
-- per tax group, round(group_subtotal * rate_bp / 10000) half-up, computed on
-- the non-voided line subtotal. tax_inclusive => tax is display-only (already
-- inside the prices), total = subtotal - discount.
-- ---------------------------------------------------------------------------
create or replace function app.compute_tab_totals(p_tab_id uuid)
returns table (subtotal_iqd bigint, discount_iqd bigint, tax_iqd bigint, total_iqd bigint)
language plpgsql stable security definer set search_path = public as $$
declare
  v_subtotal  bigint;
  v_discount  bigint;
  v_tax       bigint;
  v_inclusive boolean;
begin
  select coalesce(sum(oi.line_total_iqd), 0) into v_subtotal
    from order_items oi
    join orders o on o.id = oi.order_id
   where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided;

  select coalesce(sum(a.amount_iqd), 0) into v_discount
    from tab_adjustments a
   where a.tab_id = p_tab_id
     and a.kind in ('discount_percent','discount_amount');
  -- price_override adjustments already changed the line totals themselves.

  select coalesce(sum(round((g.grp_subtotal::numeric * tg.rate_bp) / 10000.0)), 0)::bigint
    into v_tax
    from (
      select mc.tax_group_id, sum(oi.line_total_iqd) as grp_subtotal
        from order_items oi
        join orders o on o.id = oi.order_id
        join menu_items mi on mi.id = oi.menu_item_id
        join menu_categories mc on mc.id = mi.category_id
       where o.tab_id = p_tab_id and o.status <> 'voided' and not oi.voided
       group by mc.tax_group_id
    ) g
    join tax_groups tg on tg.id = g.tax_group_id;

  select tax_inclusive into v_inclusive from venue_settings;

  subtotal_iqd := v_subtotal;
  discount_iqd := least(v_discount, v_subtotal);
  tax_iqd      := v_tax;
  total_iqd    := greatest(
    v_subtotal - discount_iqd
      + case when coalesce(v_inclusive, false) then 0 else v_tax end,
    0);
  return next;
end $$;

-- ---------------------------------------------------------------------------
-- app.open_day — manager/owner. One open day at a time; business_date defaults
-- to the venue-local date. Idempotent on the date.
-- ---------------------------------------------------------------------------
create or replace function app.open_day(
  p_opening_float_iqd bigint,
  p_business_date     date default null,
  p_device_id         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_date date;
  v_row  day_sessions%rowtype;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_opening_float_iqd is null or p_opening_float_iqd < 0 then
    raise exception 'INVALID_FLOAT' using errcode = 'P0001';
  end if;

  v_date := coalesce(p_business_date,
                     (now() at time zone coalesce((select timezone from venue_settings), 'Asia/Baghdad'))::date);

  select * into v_row from day_sessions where business_date = v_date;
  if found then
    return jsonb_build_object('duplicate', true, 'day_session_id', v_row.id,
                              'status', v_row.status);
  end if;

  if exists (select 1 from day_sessions where status in ('open','closing')) then
    raise exception 'PREVIOUS_DAY_OPEN' using errcode = 'P0001',
      hint = 'close the previous day before opening a new one';
  end if;

  insert into day_sessions (business_date, opened_by, opening_float_iqd)
  values (v_date, auth.uid(), p_opening_float_iqd)
  returning * into v_row;

  perform app.write_audit('day.open', 'day_sessions', v_row.id::text,
                          null, to_jsonb(v_row), null, null, p_device_id);

  return jsonb_build_object('duplicate', false, 'day_session_id', v_row.id,
                            'business_date', v_row.business_date);
end $$;
-- app.close_day (open-tab + unsynced-queue guards, cash expected math) lands in 0020.

-- ---------------------------------------------------------------------------
-- app.open_tab — staff opens a tab (table / by-name / charge-to-reservation).
-- Guest-web tabs are opened implicitly by create_guest_order.
-- ---------------------------------------------------------------------------
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_day  uuid;
  v_row  tabs%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from tabs where idempotency_key = p_idempotency_key;
    if found then
      return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
    end if;
  end if;

  v_day := app.current_open_day();
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null and not exists (select 1 from reservations where id = p_reservation_id) then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_table_id is null and p_label is null and p_reservation_id is null then
    raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001',
      hint = 'a tab needs a table, a label, or a reservation';
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key)
    values (v_day, p_table_id, p_reservation_id, p_label,
            auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_row;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_row from tabs where idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
      end if;
    end if;
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id);
end $$;

-- ---------------------------------------------------------------------------
-- app.create_guest_order — the QR ordering write path. Guest-session-bound;
-- creates tab (if the table has none), order ('sent'), snapshot-priced items,
-- and the KDS ticket atomically.
-- ---------------------------------------------------------------------------
create or replace function app.create_guest_order(
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sess   guest_sessions;
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_total  bigint;
begin
  -- DEGRADED GUARD: cafe ordering is blocked outright while the till is
  -- offline. app.is_degraded() is the 0008 stub (false) until 0021 replaces it
  -- with the real heartbeat check — the guard is already wired here so 0021
  -- changes behaviour without touching this function.
  if app.is_degraded() then
    raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
      hint = 'ordering is paused — please order with staff';
  end if;

  v_sess := app.touch_guest_session();         -- raises SESSION_EXPIRED / AUTH_REQUIRED

  if p_idempotency_key is not null then
    select * into v_order from orders where idempotency_key = p_idempotency_key;
    if found then
      select * into v_ticket from tickets where order_id = v_order.id;
      return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
        'tab_id', v_order.tab_id, 'ticket_id', v_ticket.id, 'status', v_order.status);
    end if;
  end if;

  v_day := app.current_open_day();
  if v_day is null then
    raise exception 'CAFE_CLOSED' using errcode = 'P0001';
  end if;

  -- The table's open tab for today, or a fresh guest-opened one.
  select * into v_tab
    from tabs
   where table_id = v_sess.table_id and day_session_id = v_day
     and status = 'open' and merged_into_tab_id is null
   order by opened_at desc
   limit 1
   for update;
  if not found then
    insert into tabs (day_session_id, table_id, device_id)   -- opened_by_staff_id null: guest-web
    values (v_day, v_sess.table_id, p_device_id)
    returning * into v_tab;
  end if;

  begin
    insert into orders (tab_id, source, guest_session_id, device_id, idempotency_key)
    values (v_tab.id, 'guest_web', v_sess.id, p_device_id, p_idempotency_key)
    returning * into v_order;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_order from orders where idempotency_key = p_idempotency_key;
      if found then
        select * into v_ticket from tickets where order_id = v_order.id;
        return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
          'tab_id', v_order.tab_id, 'ticket_id', v_ticket.id, 'status', v_order.status);
      end if;
    end if;
    raise;
  end;

  v_total := app.add_order_items(v_order.id, p_items);

  insert into tickets (order_id, device_id)
  values (v_order.id, p_device_id)
  returning * into v_ticket;

  -- STOCK HOOK (0018): app.consume_for_order_item per line ('sale_consumption')
  -- is wired into this function by the stock drop.

  return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
    'tab_id', v_tab.id, 'ticket_id', v_ticket.id, 'total_iqd', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- app.till_add_items — staff adds a round to an existing tab. Same snapshot
-- pricing, same folded send semantics (order arrives 'sent' with its ticket).
-- ---------------------------------------------------------------------------
create or replace function app.till_add_items(
  p_tab_id          uuid,
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tab    tabs%rowtype;
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_total  bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_order from orders where idempotency_key = p_idempotency_key;
    if found then
      select * into v_ticket from tickets where order_id = v_order.id;
      return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
        'ticket_id', v_ticket.id, 'status', v_order.status);
    end if;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001',
      detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  begin
    insert into orders (tab_id, source, placed_by_staff_id, device_id, idempotency_key)
    values (v_tab.id, 'till', auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_order;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_order from orders where idempotency_key = p_idempotency_key;
      if found then
        select * into v_ticket from tickets where order_id = v_order.id;
        return jsonb_build_object('duplicate', true, 'order_id', v_order.id,
          'ticket_id', v_ticket.id, 'status', v_order.status);
      end if;
    end if;
    raise;
  end;

  v_total := app.add_order_items(v_order.id, p_items);

  insert into tickets (order_id, device_id)
  values (v_order.id, p_device_id)
  returning * into v_ticket;

  -- STOCK HOOK (0018): consumption wired here too.

  return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
    'tab_id', v_tab.id, 'ticket_id', v_ticket.id, 'total_iqd', v_total);
end $$;

-- ---------------------------------------------------------------------------
-- app.set_ticket_status — KDS lifecycle: queued -> preparing -> ready ->
-- completed ('ready' may skip 'preparing' in a small kitchen). Stamps
-- started_at / ready_at / completed_at + actual_prep_seconds, mirrors onto the
-- order status ('completed' => 'served'), and stamps order_items.ready_at.
-- 'voided' is NOT reachable here — that belongs to void_after_send.
-- ---------------------------------------------------------------------------
create or replace function app.set_ticket_status(
  p_ticket_id uuid,
  p_status    ticket_status,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v    tickets%rowtype;
  v_ok boolean;
begin
  if not app.is_staff('prep','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from tickets where id = p_ticket_id for update;
  if not found then
    raise exception 'TICKET_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v.status = p_status then                  -- idempotent replay of a bump
    return jsonb_build_object('duplicate', true, 'ticket_id', v.id, 'status', v.status);
  end if;

  v_ok := (p_status = 'preparing' and v.status = 'queued')
       or (p_status = 'ready'     and v.status in ('queued','preparing'))
       or (p_status = 'completed' and v.status = 'ready');
  if not v_ok then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_status);
  end if;

  update tickets
     set status       = p_status,
         started_at   = case when p_status = 'preparing' then coalesce(started_at, now()) else started_at end,
         ready_at     = case when p_status = 'ready'     then coalesce(ready_at, now())   else ready_at end,
         completed_at = case when p_status = 'completed' then coalesce(completed_at, now()) else completed_at end,
         actual_prep_seconds = case when p_status = 'completed'
                                    then extract(epoch from now() - created_at)::int
                                    else actual_prep_seconds end,
         device_id    = coalesce(p_device_id, device_id)
   where id = p_ticket_id
   returning * into v;

  -- Mirror onto the order (guest status page reads orders.status).
  update orders
     set status = case p_status
                    when 'preparing' then 'preparing'::order_status
                    when 'ready'     then 'ready'::order_status
                    when 'completed' then 'served'::order_status
                  end
   where id = v.order_id and status <> 'voided';

  if p_status = 'ready' then
    update order_items set ready_at = now()
     where order_id = v.order_id and not voided and ready_at is null;
  end if;

  return jsonb_build_object('duplicate', false, 'ticket_id', v.id, 'status', v.status,
    'actual_prep_seconds', v.actual_prep_seconds);
end $$;

-- ---------------------------------------------------------------------------
-- app.merge_tabs — merge tables: everything moves to the survivor; the donor
-- keeps a pointer (merged_into_tab_id) and leaves the open set as 'void' with
-- zero totals (it holds no lines after the move). Donor must be unpaid.
-- ---------------------------------------------------------------------------
create or replace function app.merge_tabs(
  p_donor_tab_id    uuid,
  p_survivor_tab_id uuid
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_donor    tabs%rowtype;
  v_survivor tabs%rowtype;
  v_before   jsonb;
  v_first    uuid;
  v_second   uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_donor_tab_id = p_survivor_tab_id then
    raise exception 'MERGE_SELF' using errcode = 'P0001';
  end if;

  -- Lock in a deterministic order to dodge deadlocks with a concurrent merge.
  v_first  := least(p_donor_tab_id, p_survivor_tab_id);
  v_second := greatest(p_donor_tab_id, p_survivor_tab_id);
  perform 1 from tabs where id = v_first for update;
  perform 1 from tabs where id = v_second for update;

  select * into v_donor from tabs where id = p_donor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_donor_tab_id::text;
  end if;
  select * into v_survivor from tabs where id = p_survivor_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001', detail = p_survivor_tab_id::text;
  end if;

  if v_donor.status <> 'open' or v_survivor.status <> 'open' then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;
  if v_donor.day_session_id <> v_survivor.day_session_id then
    raise exception 'TAB_DAY_MISMATCH' using errcode = 'P0001';
  end if;
  if exists (select 1 from payments where tab_id = v_donor.id) then
    raise exception 'DONOR_HAS_PAYMENTS' using errcode = 'P0001',
      hint = 'settle or refund the donor tab first';
  end if;

  v_before := to_jsonb(v_donor);

  update orders set tab_id = v_survivor.id where tab_id = v_donor.id;
  update tab_adjustments set tab_id = v_survivor.id where tab_id = v_donor.id;

  update tabs
     set status = 'void', merged_into_tab_id = v_survivor.id,
         subtotal_iqd = 0, tax_iqd = 0, discount_iqd = 0, total_iqd = 0
   where id = v_donor.id
   returning * into v_donor;

  perform app.write_audit('tab.merge', 'tabs', v_donor.id::text,
                          v_before, to_jsonb(v_donor));

  return jsonb_build_object('donor_tab_id', v_donor.id,
                            'survivor_tab_id', v_survivor.id);
end $$;

-- ---------------------------------------------------------------------------
-- app.split_evenly — EXACT integer largest-remainder, mirroring
-- packages/core/src/money/split.ts (resolved override: NO 250-IQD rounding):
--   base = floor(total / n); the first (total mod n) shares get base + 1.
-- Invariants: sum(shares) = total exactly; shares differ by at most 1.
-- ---------------------------------------------------------------------------
create or replace function app.split_evenly(p_tab_id uuid, p_n int)
returns bigint[]
language plpgsql stable security definer set search_path = public as $$
declare
  v_tab   tabs%rowtype;
  v_total bigint;
  v_base  bigint;
  v_rem   bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_n is null or p_n < 1 or p_n > 50 then
    raise exception 'INVALID_SPLIT_COUNT' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Settled tabs use the stamped total; open tabs the live computation.
  if v_tab.total_iqd is not null then
    v_total := v_tab.total_iqd;
  else
    select t.total_iqd into v_total from app.compute_tab_totals(p_tab_id) t;
  end if;

  v_base := v_total / p_n;                     -- bigint division truncates = floor for non-negatives
  v_rem  := v_total % p_n;

  return (
    select array_agg(case when i <= v_rem then v_base + 1 else v_base end order by i)
      from generate_series(1, p_n) i
  );
end $$;

-- ---------------------------------------------------------------------------
-- app.settle_tab — cash/card settle. Computes + stamps subtotal/discount/tax/
-- total ONCE (design §2), records the payment (with cash change calc), flips
-- the tab to settled when fully paid ('awaiting_payment' while a split-payment
-- remainder is due).
-- ---------------------------------------------------------------------------
create or replace function app.settle_tab(
  p_tab_id          uuid,
  p_method          payment_method,
  p_tendered_iqd    bigint default null,
  p_amount_iqd      bigint default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_tab      tabs%rowtype;
  v_totals   record;
  v_paid     bigint;
  v_due      bigint;
  v_amount   bigint;
  v_change   bigint;
  v_payment  payments%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_payment from payments where idempotency_key = p_idempotency_key;
    if found then
      select * into v_tab from tabs where id = v_payment.tab_id;
      return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
        'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
    end if;
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.merged_into_tab_id is not null then
    raise exception 'TAB_MERGED' using errcode = 'P0001', detail = v_tab.merged_into_tab_id::text;
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  -- Compute once; re-stamp (identical inputs => identical stamp) so a
  -- split-payment sequence keeps one consistent bill.
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  update tabs
     set subtotal_iqd = v_totals.subtotal_iqd,
         discount_iqd = v_totals.discount_iqd,
         tax_iqd      = v_totals.tax_iqd,
         total_iqd    = v_totals.total_iqd
   where id = p_tab_id
   returning * into v_tab;

  -- Paid NET of refunds (0026): a refunded payment no longer counts toward the
  -- bill, so the refund-then-void unwind path can settle the remainder instead
  -- of dead-ending on ALREADY_PAID.
  select coalesce(sum(p.amount_iqd), 0)
       - coalesce((select sum(r.amount_iqd)
                     from refunds r
                     join payments p2 on p2.id = r.payment_id
                    where p2.tab_id = p_tab_id), 0)
    into v_paid
    from payments p where p.tab_id = p_tab_id;
  v_due := v_tab.total_iqd - v_paid;
  if v_due <= 0 then
    raise exception 'ALREADY_PAID' using errcode = 'P0001';
  end if;

  v_amount := coalesce(p_amount_iqd, v_due);
  if v_amount < 1 or v_amount > v_due then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001',
      detail = format('due %s, got %s', v_due, v_amount);
  end if;

  if p_method = 'cash' then
    if p_tendered_iqd is null or p_tendered_iqd < v_amount then
      raise exception 'TENDER_SHORT' using errcode = 'P0001';
    end if;
    v_change := p_tendered_iqd - v_amount;     -- exact: cash_rounding_iqd default 1 = off
  else
    if p_tendered_iqd is not null then
      raise exception 'TENDER_CARD' using errcode = 'P0001',
        hint = 'tendered/change are cash-only fields';
    end if;
    v_change := null;
  end if;

  begin
    insert into payments (tab_id, day_session_id, method, amount_iqd, tendered_iqd,
                          change_iqd, recorded_by, device_id, idempotency_key)
    values (p_tab_id, v_tab.day_session_id, p_method, v_amount, p_tendered_iqd,
            v_change, auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_payment;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_payment from payments where idempotency_key = p_idempotency_key;
      if found then
        return jsonb_build_object('duplicate', true, 'payment_id', v_payment.id,
          'tab_id', v_tab.id, 'status', v_tab.status, 'change_iqd', v_payment.change_iqd);
      end if;
    end if;
    raise;
  end;

  if v_paid + v_amount >= v_tab.total_iqd then
    update tabs set status = 'settled', settled_at = now()
     where id = p_tab_id returning * into v_tab;
    perform app.write_audit('tab.settle', 'tabs', v_tab.id::text,
                            null, to_jsonb(v_tab), null, null, p_device_id);
  else
    update tabs set status = 'awaiting_payment'
     where id = p_tab_id returning * into v_tab;
  end if;

  return jsonb_build_object('duplicate', false, 'payment_id', v_payment.id,
    'tab_id', v_tab.id, 'status', v_tab.status,
    'subtotal_iqd', v_tab.subtotal_iqd, 'discount_iqd', v_tab.discount_iqd,
    'tax_iqd', v_tab.tax_iqd, 'total_iqd', v_tab.total_iqd,
    'amount_iqd', v_amount, 'change_iqd', v_change,
    'remaining_iqd', greatest(v_tab.total_iqd - v_paid - v_amount, 0));
end $$;

-- ---------------------------------------------------------------------------
-- app.apply_discount — PIN-gated. kind: discount_percent (value = basis points
-- of the item line / tab subtotal) or discount_amount (value = IQD).
-- ---------------------------------------------------------------------------
create or replace function app.apply_discount(
  p_tab_id        uuid,
  p_kind          adjustment_kind,
  p_value         int,
  p_pin           text,
  p_reason_code   text,
  p_order_item_id uuid default null,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_auth   uuid;
  v_tab    tabs%rowtype;
  v_base   bigint;
  v_amount bigint;
  v_adj    tab_adjustments%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_kind not in ('discount_percent','discount_amount') then
    raise exception 'INVALID_KIND' using errcode = 'P0001',
      hint = 'use app.override_price for price overrides';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);   -- raises PIN_LOCKED itself
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id for update;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  if p_order_item_id is not null then
    select oi.line_total_iqd into v_base
      from order_items oi
      join orders o on o.id = oi.order_id
     where oi.id = p_order_item_id and o.tab_id = p_tab_id and not oi.voided;
    if v_base is null then
      raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001';
    end if;
  else
    select t.subtotal_iqd into v_base from app.compute_tab_totals(p_tab_id) t;
  end if;

  if p_kind = 'discount_percent' then
    if p_value < 1 or p_value > 10000 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001',
        hint = 'percent discounts are basis points 1..10000';
    end if;
    v_amount := round((v_base::numeric * p_value) / 10000.0)::bigint;
  else
    if p_value < 1 then
      raise exception 'INVALID_VALUE' using errcode = 'P0001';
    end if;
    v_amount := least(p_value::bigint, v_base);
  end if;

  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (p_tab_id, p_order_item_id, p_kind, p_value, v_amount,
          auth.uid(), v_auth, p_reason_code)
  returning * into v_adj;

  perform app.write_audit('discount.apply', 'tab_adjustments', v_adj.id::text,
                          null, to_jsonb(v_adj), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('adjustment_id', v_adj.id, 'amount_iqd', v_amount);
end $$;

-- ---------------------------------------------------------------------------
-- app.override_price — PIN-gated. Rewrites the line's snapshot under manager
-- authority; the adjustment row records the resolved effect (clamped at 0 for
-- an upward override — day-close discount sums never go negative; the audit
-- row keeps the full before/after).
-- ---------------------------------------------------------------------------
create or replace function app.override_price(
  p_order_item_id      uuid,
  p_new_unit_price_iqd bigint,
  p_pin                text,
  p_reason_code        text,
  p_device_id          text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_auth     uuid;
  v_oi       order_items%rowtype;
  v_tab      tabs%rowtype;
  v_before   jsonb;
  v_mods     bigint;
  v_new_line bigint;
  v_adj      tab_adjustments%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_new_unit_price_iqd is null or p_new_unit_price_iqd < 0 then
    raise exception 'INVALID_PRICE' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  select oi.* into v_oi from order_items oi where oi.id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    raise exception 'ITEM_VOIDED' using errcode = 'P0001';
  end if;

  select t.* into v_tab
    from tabs t join orders o on o.tab_id = t.id
   where o.id = v_oi.order_id
   for update of t;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001';
  end if;

  v_before := to_jsonb(v_oi);

  select coalesce(sum(price_delta_iqd * qty), 0) into v_mods
    from order_item_modifiers where order_item_id = v_oi.id;
  v_new_line := (p_new_unit_price_iqd + v_mods) * v_oi.qty;

  update order_items
     set unit_price_iqd = p_new_unit_price_iqd, line_total_iqd = v_new_line
   where id = v_oi.id
   returning * into v_oi;

  insert into tab_adjustments (tab_id, order_item_id, kind, value, amount_iqd,
                               applied_by, authorized_by, reason_code)
  values (v_tab.id, v_oi.id, 'price_override', p_new_unit_price_iqd::int,
          greatest((v_before->>'line_total_iqd')::bigint - v_new_line, 0),
          auth.uid(), v_auth, p_reason_code)
  returning * into v_adj;

  perform app.write_audit('price.override', 'order_items', v_oi.id::text,
                          v_before, to_jsonb(v_oi), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('adjustment_id', v_adj.id,
    'order_item_id', v_oi.id, 'line_total_iqd', v_new_line);
end $$;

-- ---------------------------------------------------------------------------
-- app.void_after_send — PIN-gated. The item is STRUCK, never deleted; if the
-- whole order is struck the order + ticket flip to 'voided'.
-- (Void BEFORE send does not exist server-side: drafts never hit the server.)
-- 0026: a void that would drop the tab total below what is already paid (net
-- of refunds) raises VOID_REQUIRES_REFUND — otherwise the tab could never be
-- settled (due <= 0 forever) and would block day close forever. The unwind
-- path is app.refund first, then void, then settle the remainder.
-- ---------------------------------------------------------------------------
create or replace function app.void_after_send(
  p_order_item_id uuid,
  p_pin           text,
  p_reason_code   text,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_auth      uuid;
  v_oi        order_items%rowtype;
  v_order     orders%rowtype;
  v_tab       tabs%rowtype;
  v_before    jsonb;
  v_paid      bigint;
  v_new_total bigint;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  select * into v_oi from order_items where id = p_order_item_id for update;
  if not found then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_oi.voided then
    return jsonb_build_object('duplicate', true, 'order_item_id', v_oi.id);
  end if;

  select * into v_order from orders where id = v_oi.order_id for update;
  select * into v_tab from tabs where id = v_order.tab_id;
  if v_tab.status not in ('open','awaiting_payment') then
    raise exception 'TAB_NOT_OPEN' using errcode = 'P0001',
      hint = 'a settled line comes back via app.refund';
  end if;

  v_before := to_jsonb(v_oi);

  update order_items
     set voided = true, void_reason_code = p_reason_code
   where id = p_order_item_id
   returning * into v_oi;

  -- VOID-AFTER-PAYMENT GUARD (0026): with the line struck, the tab total must
  -- still cover what has already been paid net of refunds — otherwise raise
  -- (rolling the void back). app.refund is the unwind path.
  select coalesce(sum(p.amount_iqd), 0)
       - coalesce((select sum(r.amount_iqd)
                     from refunds r
                     join payments p2 on p2.id = r.payment_id
                    where p2.tab_id = v_tab.id), 0)
    into v_paid
    from payments p where p.tab_id = v_tab.id;
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(v_tab.id) t;
    if v_new_total < v_paid then
      raise exception 'VOID_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-void total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before voiding';
    end if;
  end if;

  -- STOCK HOOK (0018): a 'void_after_send' waste movement per consumed
  -- ingredient of this line is wired here by the stock drop (the food was
  -- already made — it is waste, not a stock reversal).

  if not exists (select 1 from order_items
                  where order_id = v_order.id and not voided) then
    update orders set status = 'voided' where id = v_order.id;
    update tickets set status = 'voided' where order_id = v_order.id
       and status <> 'voided';
  end if;

  perform app.write_audit('order_item.void', 'order_items', v_oi.id::text,
                          v_before, to_jsonb(v_oi), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('duplicate', false, 'order_item_id', v_oi.id);
end $$;

-- ---------------------------------------------------------------------------
-- app.refund — manager/owner only (matrix: cashiers cannot refund), still
-- PIN-confirmed. Partial refunds allowed up to the payment amount; optional
-- p_items [{"order_item_id": uuid, "qty": int}] records which lines came back.
-- ---------------------------------------------------------------------------
create or replace function app.refund(
  p_payment_id  uuid,
  p_amount_iqd  bigint,
  p_pin         text,
  p_reason_code text,
  p_items       jsonb default null,
  p_device_id   text default null
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_auth     uuid;
  v_payment  payments%rowtype;
  v_refunded bigint;
  v_refund   refunds%rowtype;
  v_item     jsonb;
  v_oi       order_items%rowtype;
  v_qty      int;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if p_amount_iqd is null or p_amount_iqd < 1 then
    raise exception 'INVALID_AMOUNT' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  select * into v_payment from payments where id = p_payment_id for update;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(sum(amount_iqd), 0) into v_refunded
    from refunds where payment_id = p_payment_id;
  if v_refunded + p_amount_iqd > v_payment.amount_iqd then
    raise exception 'REFUND_EXCEEDS_PAYMENT' using errcode = 'P0001',
      detail = format('paid %s, already refunded %s', v_payment.amount_iqd, v_refunded);
  end if;

  insert into refunds (payment_id, amount_iqd, reason_code, refunded_by)
  values (p_payment_id, p_amount_iqd, p_reason_code, auth.uid())
  returning * into v_refund;

  if p_items is not null and jsonb_typeof(p_items) = 'array' then
    for v_item in select * from jsonb_array_elements(p_items) loop
      v_qty := coalesce(nullif(v_item->>'qty', '')::int, 1);
      select oi.* into v_oi
        from order_items oi
        join orders o on o.id = oi.order_id
       where oi.id = (v_item->>'order_item_id')::uuid
         and o.tab_id = v_payment.tab_id;
      if not found then
        raise exception 'ITEM_NOT_ON_TAB' using errcode = 'P0001',
          detail = v_item->>'order_item_id';
      end if;
      if v_qty < 1 or v_qty > v_oi.qty then
        raise exception 'INVALID_QTY' using errcode = 'P0001';
      end if;
      insert into refund_items (refund_id, order_item_id, qty)
      values (v_refund.id, v_oi.id, v_qty);
    end loop;
  end if;

  -- STOCK HOOK (0018): 'refund_reversal' movements per refund_items line are
  -- wired here by the stock drop (restock into the newest live batch).

  perform app.write_audit('payment.refund', 'refunds', v_refund.id::text,
                          null, to_jsonb(v_refund), p_reason_code, v_auth, p_device_id);

  return jsonb_build_object('refund_id', v_refund.id, 'amount_iqd', p_amount_iqd,
    'remaining_refundable_iqd', v_payment.amount_iqd - v_refunded - p_amount_iqd);
end $$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function app.current_open_day() from public, anon, authenticated;
revoke all on function app.add_order_items(uuid, jsonb) from public, anon, authenticated;
revoke all on function app.compute_tab_totals(uuid) from public, anon, authenticated;

revoke all on function app.order_is_callers(uuid) from public, anon;
grant execute on function app.order_is_callers(uuid) to authenticated;   -- used in RLS policies

revoke all on function app.tab_is_callers(uuid) from public, anon;
grant execute on function app.tab_is_callers(uuid) to authenticated;     -- used in RLS policies

revoke all on function app.open_day(bigint, date, text) from public, anon;
grant execute on function app.open_day(bigint, date, text) to authenticated;

revoke all on function app.open_tab(uuid, text, uuid, text, text) from public, anon;
grant execute on function app.open_tab(uuid, text, uuid, text, text) to authenticated;

revoke all on function app.create_guest_order(jsonb, text, text) from public, anon;
grant execute on function app.create_guest_order(jsonb, text, text) to authenticated;

revoke all on function app.till_add_items(uuid, jsonb, text, text) from public, anon;
grant execute on function app.till_add_items(uuid, jsonb, text, text) to authenticated;

revoke all on function app.set_ticket_status(uuid, ticket_status, text) from public, anon;
grant execute on function app.set_ticket_status(uuid, ticket_status, text) to authenticated;

revoke all on function app.merge_tabs(uuid, uuid) from public, anon;
grant execute on function app.merge_tabs(uuid, uuid) to authenticated;

revoke all on function app.split_evenly(uuid, int) from public, anon;
grant execute on function app.split_evenly(uuid, int) to authenticated;

revoke all on function app.settle_tab(uuid, payment_method, bigint, bigint, text, text) from public, anon;
grant execute on function app.settle_tab(uuid, payment_method, bigint, bigint, text, text) to authenticated;

revoke all on function app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text) from public, anon;
grant execute on function app.apply_discount(uuid, adjustment_kind, int, text, text, uuid, text) to authenticated;

revoke all on function app.override_price(uuid, bigint, text, text, text) from public, anon;
grant execute on function app.override_price(uuid, bigint, text, text, text) to authenticated;

revoke all on function app.void_after_send(uuid, text, text, text) from public, anon;
grant execute on function app.void_after_send(uuid, text, text, text) to authenticated;

revoke all on function app.refund(uuid, bigint, text, text, jsonb, text) from public, anon;
grant execute on function app.refund(uuid, bigint, text, text, jsonb, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS (matrix §3.2). SELECT-only for clients everywhere; every write
-- above is RPC-only. payments/refunds additionally lose UPDATE/DELETE
-- explicitly (belt) on top of never being granted (braces) + the trigger.
-- ---------------------------------------------------------------------------
alter table day_sessions enable row level security;
alter table tabs enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table order_item_modifiers enable row level security;
alter table tickets enable row level security;
alter table tab_adjustments enable row level security;
alter table payments enable row level security;
alter table refunds enable row level security;
alter table refund_items enable row level security;

grant select on day_sessions, tabs, orders, order_items, order_item_modifiers,
                tickets, tab_adjustments, payments, refunds, refund_items
  to authenticated;

revoke update, delete on payments, refunds from anon, authenticated;

-- day_sessions: till + management read.
create policy day_sessions_staff_read on day_sessions for select to authenticated
  using (app.is_staff('cashier','manager','owner'));

-- tabs: guest sees a tab that carries one of their session's orders; staff see all.
create policy tabs_guest_read on tabs for select to authenticated
  using (app.tab_is_callers(id));
create policy tabs_staff_read on tabs for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));

-- orders: guest sees own session's orders.
create policy orders_guest_read on orders for select to authenticated
  using (guest_session_id is not null and app.is_own_session(guest_session_id));
create policy orders_staff_read on orders for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));

-- order_items (+modifiers): follow the order.
create policy order_items_guest_read on order_items for select to authenticated
  using (app.order_is_callers(order_id));
create policy order_items_staff_read on order_items for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));

create policy order_item_modifiers_guest_read on order_item_modifiers
  for select to authenticated
  using (exists (select 1 from order_items oi
                  where oi.id = order_item_id and app.order_is_callers(oi.order_id)));
create policy order_item_modifiers_staff_read on order_item_modifiers
  for select to authenticated
  using (app.is_staff('cashier','prep','court_desk','manager','owner'));

-- tickets: guest sees own order's ticket status; KDS + till read all.
create policy tickets_guest_read on tickets for select to authenticated
  using (app.order_is_callers(order_id));
create policy tickets_staff_read on tickets for select to authenticated
  using (app.is_staff('prep','cashier','manager','owner'));

-- money surfaces: staff only, never guests.
create policy tab_adjustments_staff_read on tab_adjustments for select to authenticated
  using (app.is_staff('cashier','manager','owner'));
create policy payments_staff_read on payments for select to authenticated
  using (app.is_staff('cashier','manager','owner'));
create policy refunds_staff_read on refunds for select to authenticated
  using (app.is_staff('cashier','manager','owner'));
create policy refund_items_staff_read on refund_items for select to authenticated
  using (app.is_staff('cashier','manager','owner'));
