-- 0185 shopping_head_approval — the chef assistant's shopping lines wait for the
-- head chef's OK before the driver sees them.
--
-- Feature: protocols and the staff phone, lane J
-- (docs/design/protocols/build-contracts-2026-09-23.md §2.24.9, §2.15, §2.21, §2.22; plan #66, #26).
-- Depends on: staff_push_keys (J: shopping_to_approve, shopping_declined).
-- Re-issues (§2.18): the shopping_items status CHECK, app.add_shopping_item,
-- app.shopping_list and app.cancel_shopping_item from 0166, same signatures.
-- record_purchase is not re-issued: it takes open lines only, so a pending or
-- declined line can never be bought.
-- Re-runnable: drop constraint if exists before the status CHECK's add, add
-- column if not exists, guarded constraint adds and validates, create or
-- replace.
--
-- THE FLOW (#66). A chef's line (the chef assistant, #74) is pending: it
-- reaches no driver, and the venue's head chefs are told (or its managers
-- when it has none, PROPOSAL), once in 15 minutes however many lines go on.
-- The head chef or MGMT approves it, and it goes to the drivers as an open
-- line; or declines it with a reason, and the chef is told. The head roles'
-- and MGMT's lines still go straight to the driver (plan #26). Nobody
-- decides their own line: a head's or MGMT's line is never pending. The
-- barista still only reads the list (PROPOSAL).
--
-- No index on pending: an index on an existing table needs its own
-- migration, and the waiting list is small.
--
-- covered by packages/db/tests/shopping-head-approval.test.ts and
-- shopping-purchases.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. shopping_items: two more statuses and who decided a pending line.
-- ---------------------------------------------------------------------------
alter table shopping_items drop constraint if exists shopping_items_status_check;
alter table shopping_items
  add constraint shopping_items_status_check
  check (status in ('open','bought','cancelled','received','acknowledged','pending','declined'))
  not valid;

alter table shopping_items add column if not exists decided_by     uuid;
alter table shopping_items add column if not exists decided_at     timestamptz;
alter table shopping_items add column if not exists decline_reason text;

do $add_constraints_0185$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'shopping_items_decided_by_fkey'
                    and conrelid = 'public.shopping_items'::regclass) then
    alter table shopping_items
      add constraint shopping_items_decided_by_fkey
      foreign key (decided_by) references staff(id) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'shopping_items_decided_chk'
                    and conrelid = 'public.shopping_items'::regclass) then
    alter table shopping_items
      add constraint shopping_items_decided_chk
      check ((decided_by is null) = (decided_at is null)) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'shopping_items_decline_reason_chk'
                    and conrelid = 'public.shopping_items'::regclass) then
    alter table shopping_items
      add constraint shopping_items_decline_reason_chk
      check (decline_reason is null or length(decline_reason) <= 300) not valid;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'shopping_items_declined_chk'
                    and conrelid = 'public.shopping_items'::regclass) then
    alter table shopping_items
      add constraint shopping_items_declined_chk
      check (status <> 'declined'
             or (decided_by is not null and coalesce(length(btrim(decline_reason)),0) > 0)) not valid;
  end if;
end $add_constraints_0185$;

do $validate_constraints_0185$
declare
  c text;
begin
  foreach c in array array['shopping_items_status_check', 'shopping_items_decided_by_fkey',
                           'shopping_items_decided_chk', 'shopping_items_decline_reason_chk',
                           'shopping_items_declined_chk'] loop
    if exists (select 1 from pg_constraint
                where conname = c
                  and conrelid = 'public.shopping_items'::regclass
                  and not convalidated) then
      execute format('alter table shopping_items validate constraint %I', c);
    end if;
  end loop;
end $validate_constraints_0185$;

comment on column shopping_items.status is
  'open, bought (on a purchase), cancelled, received (its purchase line was received into stock), acknowledged (a non-stock line the manager acknowledged), pending (a chef assistant''s line waiting for the head chef''s OK, which no driver sees) or declined (the head chef or MGMT said no).';
comment on column shopping_items.decided_by is
  'shopping_head_approval (§2.24.9): the head chef or manager who approved or declined a pending line.';
comment on column shopping_items.decided_at is
  'When a pending line was approved or declined.';
comment on column shopping_items.decline_reason is
  'Why a pending line was declined, as typed (at most 300 characters); required on a decline.';

-- ---------------------------------------------------------------------------
-- 2. app.shopping_list — 0166 verbatim, plus pending and declined for the
--    bar and kitchen family and MGMT (never the driver), pending_count, and
--    each line's decline reason.
-- ---------------------------------------------------------------------------
create or replace function app.shopping_list(
  p_venue_id uuid default null,
  p_status   text default 'open'
) returns jsonb
language plpgsql stable security definer set search_path = public as $shopping_list_0185$
declare
  v_venue   uuid;
  v_status  text := coalesce(p_status, 'open');
  v_items   jsonb;
  v_open    int;
  v_pending int;
  v_driver  boolean;
begin
  if not app.is_staff('head_barista','barista','head_chef','chef','driver','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','barista','head_chef','chef','driver','manager','owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if v_status not in ('open','bought','cancelled','received','acknowledged','pending','declined') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'status';
  end if;
  -- shopping_head_approval: the driver never sees a line before its OK.
  v_driver := app.is_staff('driver');
  if v_driver and v_status in ('pending','declined') then
    raise exception 'FORBIDDEN' using errcode = 'P0001', hint = 'status';
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
           'mine',              x.mine,
           'decline_reason',    x.decline_reason)
         order by x.ord), '[]'::jsonb)
    into v_items
    from (select si.id, si.ingredient_id, i.name_en, i.name_ar, si.label, si.qty, si.unit, si.note,
                 s.display_name as requested_by_name, si.requested_at, si.status,
                 si.requested_by = auth.uid() as mine,
                 si.decline_reason,
                 row_number() over (order by
                   case when v_status in ('open','pending') then si.requested_at end asc,
                   case when v_status not in ('open','pending') then si.requested_at end desc,
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
  select count(*) into v_pending
    from shopping_items si
   where si.venue_id = v_venue and si.status = 'pending' and not v_driver;

  return jsonb_build_object('items', v_items, 'open_count', v_open, 'pending_count', v_pending);
end $shopping_list_0185$;

comment on function app.shopping_list(uuid, text) is
  'shopping_purchases (§2.15), re-issued by shopping_head_approval (§2.24.9). The bar and kitchen family, the driver and MGMT at the venue: {items: [{id, ingredient_id, name_en, name_ar, label, qty, unit, note, requested_by_name, requested_at, status, mine, decline_reason}], open_count, pending_count} for one status (default open; open and pending oldest first, the others newest first; at most 200). pending and declined are refused to the driver (FORBIDDEN, hint status), whose pending_count is 0. No price. INVALID_ARGUMENT (hint status); FORBIDDEN for anyone else.';

revoke all on function app.shopping_list(uuid, text) from public, anon;
grant execute on function app.shopping_list(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.add_shopping_item — 0166 verbatim, plus the chef: a chef's line is
--    pending and goes to the head chefs (or the managers) for an OK; the
--    heads' and MGMT's lines still go straight to the drivers.
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
language plpgsql security definer set search_path = public as $add_shopping_item_0185$
declare
  v_venue   uuid;
  v_replay  jsonb;
  v_ing     ingredients%rowtype;
  v_label   text := nullif(btrim(coalesce(p_label, '')), '');
  v_note    text := nullif(btrim(coalesce(p_note, '')), '');
  v_unit    text := lower(btrim(coalesce(p_unit, '')));
  v_pending boolean;
  v_heads   uuid[];
  v_id      uuid;
  v_result  jsonb;
begin
  if not app.is_staff('head_barista','head_chef','chef','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not (v_venue = any(app.staff_venue_ids())
          and app.is_staff_at(v_venue, 'head_barista','head_chef','chef','manager','owner')) then
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

  -- shopping_head_approval (#66): the chef assistant's line waits for an OK.
  v_pending := app.is_staff('chef');

  insert into shopping_items (venue_id, ingredient_id, label, qty, unit, note, requested_by, status)
  values (v_venue, v_ing.id, v_label, round(p_qty, 3), v_unit, v_note, auth.uid(),
          case when v_pending then 'pending' else 'open' end)
  returning id into v_id;

  perform app.write_audit('shopping.add', 'shopping_item', v_id::text, null,
                          jsonb_build_object('ingredient_id', v_ing.id, 'qty', round(p_qty, 3), 'unit', v_unit,
                                             'status', case when v_pending then 'pending' else 'open' end));

  if v_pending then
    v_heads := app.staff_ids_with_roles(v_venue, array['head_chef']::staff_role[]);
    if cardinality(v_heads) = 0 then
      v_heads := app.staff_ids_with_roles(v_venue, array['manager']::staff_role[]);
    end if;
    perform app.notify_staff(
      v_heads,
      'staff_decide',
      jsonb_build_object('route', 'staff-shopping', 'title_key', 'shopping_to_approve',
                         'params', jsonb_build_object('name', (select display_name from staff where id = auth.uid()))),
      'shopping-approve:' || v_venue::text);
  else
    perform app.notify_staff(
      app.staff_ids_with_roles(v_venue, array['driver']::staff_role[]),
      'staff_task',
      jsonb_build_object('route', 'staff-shopping', 'title_key', 'shopping_new', 'params', '{}'::jsonb),
      'shopping:' || v_venue::text);
  end if;

  v_result := jsonb_build_object('id', v_id);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $add_shopping_item_0185$;

comment on function app.add_shopping_item(uuid, uuid, text, numeric, text, text, text) is
  'shopping_purchases (§2.15), re-issued by shopping_head_approval (§2.24.9). The head barista, the head chef, the chef and MGMT at the venue: puts a line on the shopping list, an active ingredient of the venue (unit its base unit or pack) or a label (at most 80), with a quantity and an optional note (at most 200). A head''s or MGMT''s line is open and tells the venue''s drivers (staff_task / shopping_new, deduped shopping:<venue>); a chef''s line is pending and tells the venue''s head chefs, or its managers when it has none (staff_decide / shopping_to_approve, deduped shopping-approve:<venue>), and no driver sees it until app.decide_shopping_item. Returns {id}. Idempotent by key. INGREDIENT_NOT_FOUND, SHOPPING_LABEL_REQUIRED, INVALID_QTY, INVALID_ARGUMENT (hint unit), TEXT_TOO_LONG. Audit shopping.add.';

revoke all on function app.add_shopping_item(uuid, uuid, text, numeric, text, text, text) from public, anon;
grant execute on function app.add_shopping_item(uuid, uuid, text, numeric, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.cancel_shopping_item — 0166 verbatim, plus a pending line.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_shopping_item(p_id uuid)
returns void
language plpgsql security definer set search_path = public as $cancel_shopping_item_0185$
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
  if v_item.status not in ('open', 'pending') then
    raise exception 'SHOPPING_ITEM_NOT_OPEN' using errcode = 'P0001';
  end if;

  update shopping_items
     set status = 'cancelled', cancelled_by = auth.uid(), cancelled_at = now()
   where id = p_id;

  perform app.write_audit('shopping.cancel', 'shopping_item', p_id::text,
                          jsonb_build_object('status', v_item.status),
                          jsonb_build_object('status', 'cancelled'));
end $cancel_shopping_item_0185$;

comment on function app.cancel_shopping_item(uuid) is
  'shopping_purchases (§2.15), re-issued by shopping_head_approval (§2.24.9). The requester, or MGMT at the venue: takes an open or pending line off the shopping list. SHOPPING_ITEM_NOT_OPEN for a line that is neither (or at a venue the caller does not work at); FORBIDDEN for anyone else. Audit shopping.cancel.';

revoke all on function app.cancel_shopping_item(uuid) from public, anon;
grant execute on function app.cancel_shopping_item(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.decide_shopping_item — the head chef or MGMT at the line's venue:
--    the OK (the line goes to the drivers) or a decline with a reason (the
--    chef is told).
-- ---------------------------------------------------------------------------
create or replace function app.decide_shopping_item(
  p_id      uuid,
  p_approve boolean,
  p_reason  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $decide_shopping_item_0185$
declare
  v_item   shopping_items%rowtype;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Row-addressed: an unknown line, or one elsewhere, answers as not open
  -- (the 0166 convention).
  select * into v_item from shopping_items where id = p_id for update;
  if not found or not (v_item.venue_id = any(app.staff_venue_ids())) then
    raise exception 'SHOPPING_ITEM_NOT_OPEN' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_item.venue_id, 'head_chef', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_item.venue_id::text, true);
  if v_item.status <> 'pending' then
    raise exception 'SUBMISSION_DECIDED' using errcode = 'P0001';
  end if;
  -- A line is pending only while its requester is a chef, so this holds by
  -- construction; it guards a chef who became head chef since.
  if v_item.requested_by = auth.uid() then
    raise exception 'CANNOT_DECIDE_OWN' using errcode = 'P0001';
  end if;
  if p_approve is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'approve';
  end if;

  if p_approve then
    update shopping_items
       set status = 'open', decided_by = auth.uid(), decided_at = now()
     where id = p_id
     returning * into v_item;
    perform app.write_audit('shopping.approve', 'shopping_item', p_id::text,
                            jsonb_build_object('status', 'pending'),
                            jsonb_build_object('status', 'open'));
    perform app.notify_staff(
      app.staff_ids_with_roles(v_item.venue_id, array['driver']::staff_role[]),
      'staff_task',
      jsonb_build_object('route', 'staff-shopping', 'title_key', 'shopping_new', 'params', '{}'::jsonb),
      'shopping:' || v_item.venue_id::text);
  else
    if v_reason is null then
      raise exception 'REASON_REQUIRED' using errcode = 'P0001';
    end if;
    if length(v_reason) > 300 then
      raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
    end if;
    update shopping_items
       set status = 'declined', decided_by = auth.uid(), decided_at = now(), decline_reason = v_reason
     where id = p_id
     returning * into v_item;
    perform app.write_audit('shopping.decline', 'shopping_item', p_id::text,
                            jsonb_build_object('status', 'pending'),
                            jsonb_build_object('status', 'declined'));
    perform app.notify_staff(
      array[v_item.requested_by],
      'staff_decided',
      jsonb_build_object('route', 'staff-shopping', 'title_key', 'shopping_declined', 'params', '{}'::jsonb));
  end if;

  return jsonb_build_object('id', v_item.id, 'status', v_item.status);
end $decide_shopping_item_0185$;

comment on function app.decide_shopping_item(uuid, boolean, text) is
  'shopping_head_approval (§2.24.9). The head chef or MGMT at the line''s venue: approves a pending line (open; the drivers get staff_task / shopping_new, deduped shopping:<venue>) or declines it with a reason (at most 300; the requester gets staff_decided / shopping_declined). Returns {id, status}. SHOPPING_ITEM_NOT_OPEN (unknown or elsewhere), FORBIDDEN, SUBMISSION_DECIDED (not pending), CANNOT_DECIDE_OWN, INVALID_ARGUMENT (hint approve), REASON_REQUIRED, TEXT_TOO_LONG. Audit shopping.approve or shopping.decline.';

revoke all on function app.decide_shopping_item(uuid, boolean, text) from public, anon;
grant execute on function app.decide_shopping_item(uuid, boolean, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Owner assistant: shopping_items' new columns join its table_read rows
--    (the 0144 statement, limited to this table; the existing rows stay).
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
   and c.table_name in ('shopping_items')
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;
