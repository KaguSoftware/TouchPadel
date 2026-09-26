set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0232 (multi-venue audit, 2026-09-26): a Telegram tap works at its order's or
-- call's branch.
--
-- telegram_apply_action runs as the service role with no caller, and never
-- named a branch. With two open branches a "void" tap failed: the void
-- trigger's stock movement defaults its venue_id through app.current_venue(),
-- which had nothing to resolve (VENUE_REQUIRED), and the handler re-raised it,
-- so Telegram retried the webhook. The tap's telegram_actions row and audit
-- row were filed at the default branch. Now the branch of the order or call is
-- asserted (app.venue_id) before anything is written, so every row lands
-- there, and a branch refusal is a 'refused' toast like the others.

-- telegram_apply_action: re-issued from 20260926000212_degraded_promotions_telegram_per_venue.sql
create or replace function app.telegram_apply_action(p_action text, p_ref_id uuid, p_actor jsonb, p_chat_id text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $telegram_apply_action_0232$
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
  v_venue    uuid;
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
  -- 0212 (MV3): the group of the branch the order or call belongs to.
  v_venue := coalesce((select o.venue_id from orders o where o.id = p_ref_id),
                      (select w.venue_id from waiter_calls w where w.id = p_ref_id));
  -- 0232: every row this tap writes (stock movements, the ledger, the audit)
  -- lands at the order's or call's branch.
  if v_venue is not null then
    perform set_config('app.venue_id', v_venue::text, true);
  end if;
  v_chat := nullif(app.cafe_setting_text('telegram_chat_id', v_venue), '');
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
                if sqlerrm in ('VOID_REQUIRES_REFUND', 'TAB_NOT_OPEN', 'TAB_MOVED',
                               'VENUE_REQUIRED', 'VENUE_MISMATCH') then
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
end $telegram_apply_action_0232$;
