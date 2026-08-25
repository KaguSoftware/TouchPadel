-- ===========================================================================
-- 0039 — Telegram authorization + a real line sequence
--
--   #14 order_items had no sequence column, so the Telegram snapshot ordered
--       lines by `ctid` — the physical tuple location. Any UPDATE moves a row
--       (override_price rewrites line_total_iqd, set_ticket_status stamps
--       ready_at), so the "insertion order" the kitchen reads could reshuffle
--       under them. This migration adds order_items.line_no and switches both
--       ctid call sites onto it.
--
--   #13 Nothing verified WHO was tapping the bot's buttons. telegram-callback
--       authenticated Telegram (via the webhook secret) but never checked that
--       the message came from the configured group, and telegram_apply_action
--       accepted any tg_user_id at all. `o:void` then voided every live line
--       with reason 'telegram' and authorizer NULL — so the manager-PIN gate
--       that protects void_after_send everywhere else was entirely absent on
--       this path, and the day-close adjustment report named nobody.
--
--       Now: the chat must match cafe_settings.telegram_chat_id, the tapper
--       must be an active telegram_staff row, and o:void additionally requires
--       that row to carry can_void. A voided line is attributed to the mapped
--       staff member.
--
-- OPERATIONAL — THIS MIGRATION FAILS CLOSED. From the moment it lands, every
-- Telegram button is refused until (a) cafe_settings.telegram_chat_id is set
-- and (b) telegram_staff is seeded via app.set_telegram_staff. That is the
-- correct posture, but it is a cut-over: seed in the same maintenance window.
-- See packages/db/supabase/functions/SETUP-telegram.md.
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- #14 — order_items.line_no
--
-- Order matters here. The trigger must exist BEFORE the backfill so that any
-- row inserted while this migration runs already carries a value; the backfill
-- then covers the pre-existing set; only then is NOT NULL safe.
--
-- Backfilling by ctid reproduces exactly what was rendered until now, so no
-- already-sent Telegram message changes meaning.
--
-- The read-then-insert in the trigger is not a race: all of one order's lines
-- are written by a single app.add_order_items call inside one transaction, and
-- the unique index below is the backstop if that ever stops being true.
-- ---------------------------------------------------------------------------
alter table order_items add column if not exists line_no int;

create or replace function app.trg_order_item_line_no() returns trigger
language plpgsql security definer set search_path = public as $line_no$
begin
  if new.line_no is null then
    select coalesce(max(line_no), 0) + 1 into new.line_no
      from order_items where order_id = new.order_id;
  end if;
  return new;
end $line_no$;

drop trigger if exists order_items_line_no on order_items;
create trigger order_items_line_no before insert on order_items
  for each row execute function app.trg_order_item_line_no();

with n as (
  select id, row_number() over (partition by order_id order by ctid) as rn
    from order_items
)
update order_items oi
   set line_no = n.rn
  from n
 where n.id = oi.id and oi.line_no is null;

create unique index if not exists order_items_order_line on order_items (order_id, line_no);
alter table order_items alter column line_no set not null;

comment on column order_items.line_no is
  '0039: 1-based line sequence within an order. Replaces the ctid ordering the Telegram snapshot used to rely on.';

-- ---------------------------------------------------------------------------
-- #13 — the Telegram staff allowlist
-- ---------------------------------------------------------------------------
create table if not exists telegram_staff (
  tg_user_id bigint primary key,
  staff_id   uuid not null references staff(id),
  label      text,
  can_void   boolean not null default false,   -- o:void is the PIN-equivalent action
  is_active  boolean not null default true,
  added_by   uuid references staff(id),
  created_at timestamptz not null default now()
);

alter table telegram_staff enable row level security;

drop policy if exists telegram_staff_mgmt_read on telegram_staff;
create policy telegram_staff_mgmt_read on telegram_staff
  for select to authenticated
  using (app.is_staff('manager','owner'));

grant select on telegram_staff to authenticated;
grant all    on telegram_staff to service_role;
-- No client write policy: the RPC below is the only way in.

create or replace function app.set_telegram_staff(
  p_tg_user_id bigint,
  p_staff_id   uuid,
  p_label      text default null,
  p_can_void   boolean default false,
  p_is_active  boolean default true,
  p_device_id  text default null
) returns jsonb
language plpgsql security definer set search_path = public as $set_tg_staff$
declare
  v_before jsonb;
  v_row    telegram_staff%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_tg_user_id is null then
    raise exception 'TG_USER_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from staff where id = p_staff_id and is_active) then
    raise exception 'STAFF_NOT_FOUND' using errcode = 'P0001';
  end if;

  select to_jsonb(t) into v_before from telegram_staff t where t.tg_user_id = p_tg_user_id;

  insert into telegram_staff (tg_user_id, staff_id, label, can_void, is_active, added_by)
  values (p_tg_user_id, p_staff_id, p_label, coalesce(p_can_void, false),
          coalesce(p_is_active, true), auth.uid())
  on conflict (tg_user_id) do update
    set staff_id  = excluded.staff_id,
        label     = excluded.label,
        can_void  = excluded.can_void,
        is_active = excluded.is_active
  returning * into v_row;

  perform app.write_audit('telegram.staff_set', 'telegram_staff', p_tg_user_id::text,
                          v_before, to_jsonb(v_row), null, null, p_device_id);

  return to_jsonb(v_row);
end $set_tg_staff$;

revoke all on function app.set_telegram_staff(bigint, uuid, text, boolean, boolean, text)
  from public, anon;
grant execute on function app.set_telegram_staff(bigint, uuid, text, boolean, boolean, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- app.write_audit_external — now carries an authorizer.
--
-- The 0032 version hardcoded authorizer_id = null, which is why a Telegram
-- void named nobody even once the caller knew who tapped. The parameter is
-- appended with a default, so the 7-argument call sites keep working — but a
-- defaulted 8th argument would make those calls ambiguous against the old
-- 7-argument function, so the old one is dropped rather than replaced.
-- ---------------------------------------------------------------------------
drop function if exists app.write_audit_external(text, text, text, text, jsonb, jsonb, text);

create or replace function app.write_audit_external(
  p_actor_role  text,
  p_action      text,
  p_entity      text,
  p_entity_id   text,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_reason_code text default null,
  p_authorizer  uuid default null
) returns void
language sql security definer set search_path = public as $tg_audit_ext_0039$
  insert into audit_log
    (actor_id, actor_role, authorizer_id, action, entity, entity_id,
     before, after, reason_code, device_id)
  values
    (null, p_actor_role, p_authorizer, p_action, p_entity, p_entity_id,
     p_before, p_after, p_reason_code, null);
$tg_audit_ext_0039$;

revoke all on function app.write_audit_external(text, text, text, text, jsonb, jsonb, text, uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.void_order_item_internal — 0038 body; the external-audit branch now
-- records the authorizer the caller resolved (#13).
-- ---------------------------------------------------------------------------
create or replace function app.void_order_item_internal(
  p_order_item_id uuid,
  p_reason_code   text,
  p_authorizer    uuid,
  p_device_id     text,
  p_actor         jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $void_0039$
declare
  v_oi        order_items%rowtype;
  v_order     orders%rowtype;
  v_tab       tabs%rowtype;
  v_tab_id    uuid;
  v_order_id  uuid;
  v_before    jsonb;
  v_after     jsonb;
  v_paid      bigint;
  v_new_total bigint;
begin
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  -- Resolve the owning tab WITHOUT locking anything, so we can then acquire
  -- the locks in the canonical order (0038): tabs -> orders -> order_items.
  select o.tab_id, o.id into v_tab_id, v_order_id
    from order_items oi
    join orders o on o.id = oi.order_id
   where oi.id = p_order_item_id;
  if v_tab_id is null then
    raise exception 'ITEM_NOT_FOUND' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = v_tab_id for update;
  select * into v_order from orders where id = v_order_id for update;
  select * into v_oi from order_items where id = p_order_item_id for update;

  if v_order.tab_id is distinct from v_tab.id then
    raise exception 'TAB_MOVED' using errcode = '40001',
      hint = 'the order moved to another tab mid-void; retry';
  end if;

  if v_oi.voided then
    return jsonb_build_object('duplicate', true, 'order_item_id', v_oi.id);
  end if;
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
  -- (rolling the void back). The tab lock above is what makes this read of
  -- `payments` trustworthy (0038).
  v_paid := app.tab_net_paid(v_tab.id);
  if v_paid > 0 then
    select t.total_iqd into v_new_total from app.compute_tab_totals(v_tab.id) t;
    if v_new_total < v_paid then
      raise exception 'VOID_REQUIRES_REFUND' using errcode = 'P0001',
        detail = format('paid %s, post-void total %s', v_paid, v_new_total),
        hint = 'refund the difference via app.refund before voiding';
    end if;
  end if;

  -- STOCK HOOK (0018): the order_items_void_stock trigger writes the waste
  -- reclass pair on the voided flip above (the food was already made).

  if not exists (select 1 from order_items
                  where order_id = v_order.id and not voided) then
    update orders set status = 'voided' where id = v_order.id;
    update tickets
       set status = 'voided',
           last_actor_label = coalesce(p_actor->>'label', last_actor_label)
     where order_id = v_order.id
       and status <> 'voided';
  end if;

  v_after := to_jsonb(v_oi)
          || case when p_actor is not null then jsonb_build_object('actor', p_actor)
                  else '{}'::jsonb end;

  if p_actor is not null then
    perform app.write_audit_external('telegram', 'order_item.void', 'order_items',
                                     v_oi.id::text, v_before, v_after, p_reason_code,
                                     p_authorizer);      -- 0039: was always null
  else
    perform app.write_audit('order_item.void', 'order_items', v_oi.id::text,
                            v_before, v_after, p_reason_code, p_authorizer, p_device_id);
  end if;

  return jsonb_build_object('duplicate', false, 'order_item_id', v_oi.id);
end $void_0039$;

revoke all on function app.void_order_item_internal(uuid, text, uuid, text, jsonb)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- app.telegram_order_payload — 0032 body, ordered by line_no (#14).
-- ---------------------------------------------------------------------------
create or replace function app.telegram_order_payload(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $tg_op_0039$
declare
  v_order orders%rowtype;
  v_table text;
  v_items jsonb;
  v_total bigint;
begin
  select * into v_order from orders where id = p_order_id;
  if not found then
    return null;
  end if;

  select ct.table_number into v_table
    from tabs t
    left join cafe_tables ct on ct.id = t.table_id
   where t.id = v_order.tab_id;

  select coalesce(jsonb_agg(l.line order by l.line_ord), '[]'::jsonb),
         coalesce(sum(l.line_total), 0)
    into v_items, v_total
    from (
      select oi.line_no        as line_ord,      -- 0039: was oi.ctid
             oi.line_total_iqd as line_total,
             jsonb_build_object(
               'order_item_id',  oi.id,
               'qty',            oi.qty,
               'name_en',        mi.name_en,
               'name_ar',        mi.name_ar,
               'variant_en',     v.name_en,
               'variant_ar',     v.name_ar,
               'variant_count',  (select count(*) from menu_item_variants vc where vc.item_id = mi.id),
               'modifiers',      coalesce((
                 select jsonb_agg(jsonb_build_object('name_en', m.name_en,
                                                     'name_ar', m.name_ar,
                                                     'qty',     oim.qty)
                                  order by m.sort_order, m.name_en)
                   from order_item_modifiers oim
                   join modifiers m on m.id = oim.modifier_id
                  where oim.order_item_id = oi.id), '[]'::jsonb),
               'notes',          oi.notes,
               'line_total_iqd', oi.line_total_iqd,
               'discount_pct',   coalesce(oi.discount_pct, 0)
             ) as line
        from order_items oi
        join menu_items mi         on mi.id = oi.menu_item_id
        join menu_item_variants v  on v.id  = oi.variant_id
       where oi.order_id = p_order_id and not oi.voided
    ) l;

  return jsonb_build_object(
    'order_id',     v_order.id,
    'short_id',     upper(left(v_order.id::text, 8)),
    'table_number', v_table,
    'placed_at',    v_order.placed_at,
    'source',       v_order.source,
    'total_iqd',    v_total,
    'items',        v_items);
end $tg_op_0039$;

-- ---------------------------------------------------------------------------
-- app.telegram_apply_action — signature change (p_chat_id appended), so the
-- 0026 precedent applies: drop, create, re-issue grants.
-- ---------------------------------------------------------------------------
drop function if exists app.telegram_apply_action(text, uuid, jsonb);

create or replace function app.telegram_apply_action(
  p_action  text,
  p_ref_id  uuid,
  p_actor   jsonb,
  p_chat_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $tg_apply_0039$
declare
  v_tg_id    bigint;
  v_first    text;
  v_user     text;
  v_label    text;
  v_actor    jsonb;
  v_result   text := 'invalid';
  v_status   text;
  v_keyboard text := 'unchanged';
  v_detail   text;
  v_entity   text;
  v_order    orders%rowtype;
  v_ticket   tickets%rowtype;
  v_tab      tabs%rowtype;
  v_call     waiter_calls%rowtype;
  v_oi       record;
  v_r        jsonb;
  v_voided   int := 0;
  v_chat     text;
  v_allow    telegram_staff%rowtype;
  v_allowed  boolean;
  v_tab_id   uuid;
begin
  if p_action is null or p_action not in ('o:seen','o:served','o:void','w:ack','w:done') then
    raise exception 'INVALID_ACTION' using errcode = 'P0001', detail = coalesce(p_action, 'null');
  end if;
  if p_ref_id is null then
    raise exception 'REF_REQUIRED' using errcode = 'P0001';
  end if;
  v_tg_id := nullif(p_actor->>'tg_user_id', '')::bigint;
  if v_tg_id is null then
    raise exception 'ACTOR_REQUIRED' using errcode = 'P0001',
      hint = 'p_actor must carry tg_user_id';
  end if;
  v_first := coalesce(nullif(btrim(p_actor->>'first_name'), ''), 'Telegram');
  v_user  := nullif(btrim(p_actor->>'username'), '');
  v_label := 'Telegram: ' || v_first;
  v_actor := jsonb_build_object('tg_user_id', v_tg_id, 'first_name', v_first,
                                'username', v_user, 'label', v_label);

  -- AUTHORIZATION (0039). A refusal is not an error: it falls through to the
  -- telegram_actions ledger below and returns result='refused', which the edge
  -- function renders as a toast. Raising here would make Telegram retry the
  -- webhook and storm us.
  v_chat := nullif(app.cafe_setting_text('telegram_chat_id'), '');
  select * into v_allow from telegram_staff where tg_user_id = v_tg_id and is_active;
  v_allowed := found;   -- captured now: the branches below run their own queries

  if v_chat is null or p_chat_id is null or p_chat_id <> v_chat then
    v_result := 'refused'; v_detail := 'wrong_chat';
  elsif not v_allowed then
    v_result := 'refused'; v_detail := 'not_allowlisted';
  elsif p_action = 'o:void' and not v_allow.can_void then
    v_result := 'refused'; v_detail := 'void_not_authorized';

  elsif left(p_action, 2) = 'o:' then
    v_entity := 'orders';

    -- LOCK ORDER (0038): tabs before orders. Only the void path reaches the
    -- tab, so only it needs the pre-lock.
    if p_action = 'o:void' then
      select o.tab_id into v_tab_id from orders o where o.id = p_ref_id;
      if v_tab_id is not null then
        perform 1 from tabs where id = v_tab_id for update;
      end if;
    end if;

    select * into v_order from orders where id = p_ref_id for update;
    if not found then
      v_result := 'not_found';
    else
      select * into v_ticket from tickets where order_id = v_order.id for update;
      if not found then
        v_result := 'not_found';               -- every sent order has a ticket (0015)
      else
        v_status := v_ticket.status::text;

        if p_action = 'o:seen' then
          if v_ticket.status = 'voided' then
            v_result := 'invalid';  v_detail := 'ticket voided';
          elsif v_ticket.status in ('preparing','ready','completed') then
            v_result := 'duplicate'; v_detail := 'ticket already ' || v_ticket.status;
          else
            v_r := app.ticket_transition(v_ticket.id, 'preparing', null, v_label);
            v_result := 'applied'; v_status := v_r->>'status'; v_keyboard := 'order_seen';
          end if;

        elsif p_action = 'o:served' then
          if v_ticket.status = 'voided' then
            v_result := 'invalid';  v_detail := 'ticket voided';
          elsif v_ticket.status = 'completed' then
            v_result := 'duplicate'; v_detail := 'ticket already completed';
          else
            if v_ticket.status in ('queued','preparing') then
              perform app.ticket_transition(v_ticket.id, 'ready', null, v_label);
            end if;
            v_r := app.ticket_transition(v_ticket.id, 'completed', null, v_label);
            v_result := 'applied'; v_status := v_r->>'status'; v_keyboard := 'order_final';
          end if;

        else                                   -- o:void
          if v_order.status = 'voided' or v_ticket.status = 'voided' then
            v_result := 'duplicate'; v_detail := 'order already voided';
          else
            select * into v_tab from tabs where id = v_order.tab_id;
            if v_tab.status not in ('open','awaiting_payment') then
              v_result := 'refused'; v_detail := 'TAB_NOT_OPEN';
            else
              begin
                for v_oi in
                  select id from order_items
                   where order_id = v_order.id and not voided
                   order by line_no, id          -- 0039: was ctid
                loop
                  -- 0039: the mapped staff member is the authorizer, so the
                  -- audit trail and v_day_close_adjustments name a human.
                  perform app.void_order_item_internal(v_oi.id, 'telegram',
                                                       v_allow.staff_id, null, v_actor);
                  v_voided := v_voided + 1;
                end loop;
                if v_voided = 0 then
                  v_result := 'duplicate'; v_detail := 'no live lines';
                else
                  v_result := 'applied'; v_status := 'voided'; v_keyboard := 'order_final';
                  v_detail := format('%s line(s) voided', v_voided);
                end if;
              exception when others then
                -- The block is a subtransaction: a refusal on line N rolls back
                -- lines 1..N-1 too (all-or-nothing void).
                if sqlerrm in ('VOID_REQUIRES_REFUND', 'TAB_NOT_OPEN', 'TAB_MOVED') then
                  v_result := 'refused'; v_detail := sqlerrm;
                else
                  raise;
                end if;
              end;
            end if;
          end if;
        end if;
      end if;
    end if;

  else                                         -- w:ack / w:done
    v_entity := 'waiter_calls';
    select * into v_call from waiter_calls where id = p_ref_id for update;
    if not found then
      v_result := 'not_found';
    else
      v_status := v_call.status::text;
      if p_action = 'w:ack' then
        if v_call.status in ('acknowledged','resolved') then
          v_result := 'duplicate'; v_detail := 'call already ' || v_call.status;
        else
          v_r := app.waiter_call_transition(v_call.id, 'acknowledged', null, v_label);
          v_result := 'applied'; v_status := v_r->>'status'; v_keyboard := 'call_acked';
        end if;
      else                                     -- w:done
        if v_call.status = 'resolved' then
          v_result := 'duplicate'; v_detail := 'call already resolved';
        else
          v_r := app.waiter_call_transition(v_call.id, 'resolved', null, v_label);
          v_result := 'applied'; v_status := v_r->>'status'; v_keyboard := 'call_final';
        end if;
      end if;
    end if;
  end if;

  -- Ledger: every tap, whatever the outcome.
  insert into telegram_actions (action, ref_id, tg_user_id, tg_first_name, tg_username, result, detail)
  values (p_action, p_ref_id, v_tg_id, v_first, v_user, v_result, v_detail);

  if v_result = 'applied' then
    perform app.write_audit_external('telegram', 'telegram.' || replace(p_action, ':', '.'),
                                     v_entity, p_ref_id::text, null,
                                     jsonb_build_object('action', p_action, 'status', v_status,
                                                        'actor', v_actor),
                                     'telegram', v_allow.staff_id);   -- 0039
  end if;

  return jsonb_build_object('result', v_result, 'status', v_status,
                            'keyboard', v_keyboard, 'actor_label', v_label);
end $tg_apply_0039$;

revoke all on function app.telegram_apply_action(text, uuid, jsonb, text)
  from public, anon, authenticated;
grant execute on function app.telegram_apply_action(text, uuid, jsonb, text) to service_role;
