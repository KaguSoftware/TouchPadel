set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0212_degraded_promotions_telegram_per_venue — multi-venue slice 2, steps 4–6.
--
-- (a) Degraded mode: is_degraded(uuid) and venue_mode(uuid) (0139) drop the
--     singleton fallback (`venue_settings where id`), which returns more than
--     one row once a second branch has a settings row. Every venue has its own
--     row (0208), and a venue with none falls back to the defaults in code.
--
-- (b) Promotions per branch (plan MV2): promotions gains venue_id, NULL meaning
--     "every branch". Existing promotions are backfilled to the default branch,
--     because their scope names that branch's courts, categories and items. New
--     rows take the writer's resolved venue (the price/promo apply sets
--     app.venue_id first). A promotion becomes chain-wide only through the new
--     owner RPC app.set_promotion_venue, and only when its scope names no
--     court, category or item (those ids belong to one branch).
--     eligible_promotions (0067) offers a tab its branch's promotions and the
--     chain-wide ones, judged on the tab's branch's clock; the staff read policy
--     gains the venue axis.
--
-- (c) Telegram per branch (plan MV3): the telegram_* keys are per branch since
--     0209. enqueue_telegram takes the branch from the order or waiter call (or
--     p_venue), reads that branch's switch and group, and files the outbox row
--     there; telegram_send_test tests one branch's group; retry_telegram_outbox
--     re-targets the row's own branch; telegram_apply_action checks the tap
--     against the group of the branch the order or call belongs to.

-- is_degraded: re-issued from 20260921000139_venue_axis_fixes.sql:189
create or replace function app.is_degraded(p_venue uuid) returns boolean
language sql stable security definer set search_path = public as $is_degraded_0212$
  select exists (select 1 from device_heartbeats
                  where venue_id = p_venue
                    and (is_till or device_id like 'TILL%'))
     and not exists (
       select 1 from device_heartbeats
        where venue_id = p_venue
          and (is_till or device_id like 'TILL%')
          and last_seen_at > now() - make_interval(
                secs => coalesce(
                  (select heartbeat_stale_seconds from venue_settings where venue_id = p_venue),
                  45))
     )
$is_degraded_0212$;

-- venue_mode: re-issued from 20260921000139_venue_axis_fixes.sql:209
create or replace function app.venue_mode(p_venue uuid) returns jsonb
language sql stable security definer set search_path = public as $venue_mode_0212$
  select jsonb_build_object(
    'degraded', app.is_degraded(p_venue),
    'degraded_since', (select started_at from degraded_periods
                        where ended_at is null
                          and venue_id = p_venue
                        order by started_at desc limit 1),
    'protected_horizon_hours', coalesce(
      (select protected_horizon_hours from venue_settings where venue_id = p_venue),
      48),
    'server_time', now())
$venue_mode_0212$;

-- ---------------------------------------------------------------------------
-- promotions.venue_id (MV2)
-- ---------------------------------------------------------------------------
alter table promotions add column if not exists venue_id uuid;

update promotions set venue_id = app.default_venue() where venue_id is null;

alter table promotions alter column venue_id set default app.current_venue();

do $promotions_venue$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'promotions_venue_id_fkey' and conrelid = 'promotions'::regclass) then
    alter table promotions add constraint promotions_venue_id_fkey
      foreign key (venue_id) references venues(id) not valid;
  end if;
  -- A chain-wide promotion cannot target one branch's courts, categories or items.
  if not exists (select 1 from pg_constraint
                  where conname = 'promotions_chain_scope_chk' and conrelid = 'promotions'::regclass) then
    alter table promotions add constraint promotions_chain_scope_chk
      check (venue_id is not null
             or (coalesce(jsonb_array_length(case when jsonb_typeof(scope->'courtIds') = 'array' then scope->'courtIds' end), 0) = 0
                 and coalesce(jsonb_array_length(case when jsonb_typeof(scope->'categoryIds') = 'array' then scope->'categoryIds' end), 0) = 0
                 and coalesce(jsonb_array_length(case when jsonb_typeof(scope->'itemIds') = 'array' then scope->'itemIds' end), 0) = 0)) not valid;
  end if;
end
$promotions_venue$;

alter table promotions validate constraint promotions_venue_id_fkey;
alter table promotions validate constraint promotions_chain_scope_chk;

comment on column promotions.venue_id is
  '0212 (MV2). The branch the promotion runs at; NULL = every branch (set only by app.set_promotion_venue, and only with a scope that names no court, category or item). Existing promotions were backfilled to the default branch.';

drop policy if exists promotions_staff_read on promotions;
create policy promotions_staff_read on promotions for select to authenticated
  using (app.staff_role() is not null
         and (venue_id is null or venue_id = any(app.staff_venue_ids())));

-- The owner's chain-wide switch.
create or replace function app.set_promotion_venue(p_promotion_id uuid, p_venue_id uuid)
returns promotions
language plpgsql security definer set search_path = public as $set_promotion_venue_0212$
declare
  v_before promotions%rowtype;
  v_row    promotions%rowtype;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_before from promotions where id = p_promotion_id for update;
  if not found then
    raise exception 'PROMOTION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_venue_id is not null and not exists (select 1 from venues v where v.id = p_venue_id) then
    raise exception 'VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_venue_id is null
     and (coalesce(jsonb_array_length(case when jsonb_typeof(v_before.scope->'courtIds') = 'array' then v_before.scope->'courtIds' end), 0) > 0
       or coalesce(jsonb_array_length(case when jsonb_typeof(v_before.scope->'categoryIds') = 'array' then v_before.scope->'categoryIds' end), 0) > 0
       or coalesce(jsonb_array_length(case when jsonb_typeof(v_before.scope->'itemIds') = 'array' then v_before.scope->'itemIds' end), 0) > 0) then
    raise exception 'PROMOTION_SCOPE_BRANCH' using errcode = 'P0001',
      hint = 'a promotion for every branch cannot name courts, categories or items';
  end if;

  update promotions set venue_id = p_venue_id, updated_at = now()
   where id = p_promotion_id
  returning * into v_row;

  perform set_config('app.venue_id', coalesce(p_venue_id, v_before.venue_id, app.default_venue())::text, true);
  perform app.write_audit('promotion.venue', 'promotions', p_promotion_id::text,
    jsonb_build_object('venue_id', v_before.venue_id), jsonb_build_object('venue_id', p_venue_id));
  return v_row;
end $set_promotion_venue_0212$;

comment on function app.set_promotion_venue(uuid, uuid) is
  '0212 (MV2). Owner-only: move a promotion to one branch, or (NULL) make it run at every branch. A chain-wide promotion may not name courts, categories or items (PROMOTION_SCOPE_BRANCH). Audited as promotion.venue.';

revoke all on function app.set_promotion_venue(uuid, uuid) from public, anon;
grant execute on function app.set_promotion_venue(uuid, uuid) to authenticated;

-- eligible_promotions: re-issued from 20260903000067_promotions.sql:580
create or replace function app.eligible_promotions(p_tab_id uuid, p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $eligible_promotions_0212$
declare
  v_tab      tabs%rowtype;
  v_court_id uuid;
  v_customer uuid;
  v_totals   record;
  v_gross    bigint;
  v_local    timestamp;
  v_dow      int;
  v_time     time;
  v_code     text := nullif(upper(btrim(p_code)), '');
  p          promotions%rowtype;
  v_base     bigint;
  v_amount   bigint;
  v_limit    bigint;
  v_out      jsonb := '[]'::jsonb;
  v_sorted   jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v_tab from tabs where id = p_tab_id;
  if not found then
    raise exception 'TAB_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v_code is not null and not exists (select 1 from promotions x where x.public_code = v_code) then
    raise exception 'CODE_INVALID' using errcode = 'P0001', detail = v_code;
  end if;

  if v_tab.reservation_id is not null then
    select r.court_id, r.guest_id into v_court_id, v_customer
      from reservations r where r.id = v_tab.reservation_id;
  end if;

  -- Gross = goods subtotal + court fee (what the guest is spending before any
  -- discount). The discount BASE is narrower (goods only; see promotion_base_iqd).
  select * into v_totals from app.compute_tab_totals(p_tab_id);
  v_gross := coalesce(v_totals.subtotal_iqd, 0) + coalesce(v_totals.court_iqd, 0);

  v_local := now() at time zone coalesce((select vs.timezone from venue_settings vs
                                            where vs.venue_id = v_tab.venue_id), 'Asia/Baghdad');
  v_dow   := extract(dow from v_local)::int;
  v_time  := v_local::time;

  for p in
    select pr.*
      from promotions pr
     where pr.enabled
       and (pr.venue_id is null or pr.venue_id = v_tab.venue_id)   -- 0212 (MV2)
       and (pr.starts_at is null or pr.starts_at <= now())
       and (pr.ends_at   is null or pr.ends_at   >  now())
       and (coalesce(array_length(pr.weekdays, 1), 0) = 0 or v_dow = any(pr.weekdays))
       and (pr.hour_from is null
            or (pr.hour_from < pr.hour_to and v_time >= pr.hour_from and v_time < pr.hour_to)
            or (pr.hour_from > pr.hour_to and (v_time >= pr.hour_from or v_time < pr.hour_to)))
       and (pr.auto or (v_code is not null and pr.public_code = v_code))
       and (jsonb_typeof(pr.scope->'courtIds') is distinct from 'array'
            or jsonb_array_length(pr.scope->'courtIds') = 0
            or (v_court_id is not null and (pr.scope->'courtIds') ? v_court_id::text))
     order by pr.created_at, pr.id
  loop
    -- Redemptions on OTHER tabs: this tab's own current promotion is about to
    -- be replaced by any apply, so it must never block a re-apply.
    if not p.auto and p.code_single_use and exists (
         select 1 from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) then
      continue;
    end if;

    v_limit := (p.limits->>'total')::bigint;
    if v_limit is not null and (
         select count(*) from promotion_redemptions r
          where r.promotion_id = p.id and r.tab_id <> p_tab_id) >= v_limit then
      continue;
    end if;

    v_limit := (p.limits->>'perCustomer')::bigint;
    if v_limit is not null then
      -- A per-customer cap needs a customer: a tab with no identified guest
      -- cannot be counted, so it is not eligible (the strict reading).
      if v_customer is null then
        continue;
      end if;
      if (select count(*) from promotion_redemptions r
           where r.promotion_id = p.id and r.customer_id = v_customer and r.tab_id <> p_tab_id)
         >= v_limit then
        continue;
      end if;
    end if;

    v_limit := (p.limits->>'minSpendIqd')::bigint;
    if v_limit is not null and v_gross < v_limit then
      continue;
    end if;

    v_base   := app.promotion_base_iqd(p_tab_id, p.scope);
    v_amount := app.promotion_amount_iqd(v_base, p.type, p.value);
    if v_amount < 1 then
      continue;
    end if;

    v_out := v_out || jsonb_build_object(
      'promotionId', p.id,
      'name_en',     p.name_en,
      'name_ar',     p.name_ar,
      'type',        p.type,
      'value',       p.value,
      'amountIqd',   v_amount);
  end loop;

  select coalesce(jsonb_agg(t.e order by (t.e->>'amountIqd')::bigint desc, t.ord), '[]'::jsonb)
    into v_sorted
    from jsonb_array_elements(v_out) with ordinality as t(e, ord);
  return v_sorted;
end $eligible_promotions_0212$;

-- enqueue_telegram: re-issued from 20260825000032_telegram.sql:293 with p_venue
drop function if exists app.enqueue_telegram(text, uuid, jsonb);

create or replace function app.enqueue_telegram(
  p_kind    text,
  p_ref_id  uuid,
  p_payload jsonb default null,
  p_venue   uuid default null
) returns bigint
language plpgsql security definer set search_path = public as $enqueue_telegram_0212$
declare
  v_chat    text;
  v_payload jsonb := p_payload;
  v_id      bigint;
  v_venue   uuid;
begin
  if p_kind is null or p_kind not in ('order_new','waiter_call','test') then
    raise exception 'INVALID_KIND' using errcode = 'P0001', detail = coalesce(p_kind, 'null');
  end if;

  -- 0212 (MV3): the branch the event happened at, and that branch's group.
  v_venue := coalesce(p_venue,
                      case p_kind
                        when 'order_new'   then (select o.venue_id from orders o where o.id = p_ref_id)
                        when 'waiter_call' then (select w.venue_id from waiter_calls w where w.id = p_ref_id)
                      end,
                      app.current_venue_or_default());

  if not coalesce(app.cafe_setting_bool('telegram_enabled', v_venue), false) then
    return null;
  end if;
  v_chat := nullif(app.cafe_setting_text('telegram_chat_id', v_venue), '');
  if v_chat is null then
    return null;
  end if;

  if v_payload is null then
    v_payload := case p_kind
                   when 'order_new'   then app.telegram_order_payload(p_ref_id)
                   when 'waiter_call' then app.telegram_call_payload(p_ref_id)
                   else '{}'::jsonb
                 end;
  end if;
  if v_payload is null then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001',
      detail = format('%s %s', p_kind, coalesce(p_ref_id::text, 'null'));
  end if;

  insert into telegram_outbox (venue_id, kind, ref_id, chat_id, payload)
  values (v_venue, p_kind, p_ref_id, v_chat, v_payload)
  on conflict do nothing                       -- telegram_outbox_one_per_ref: already enqueued
  returning id into v_id;

  if v_id is not null then
    perform app.telegram_nudge();
  end if;
  return v_id;
end $enqueue_telegram_0212$;

revoke all on function app.enqueue_telegram(text, uuid, jsonb, uuid) from public, anon, authenticated;

-- telegram_send_test: re-issued from 20260825000032_telegram.sql:1047 with p_venue_id
drop function if exists app.telegram_send_test();

create or replace function app.telegram_send_test(p_venue_id uuid default null) returns jsonb
language plpgsql security definer set search_path = public as $telegram_send_test_0212$
declare
  v_name text;
  v_id   bigint;
  v_venue uuid;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not coalesce(app.cafe_setting_bool('telegram_enabled', v_venue), false)
     or nullif(app.cafe_setting_text('telegram_chat_id', v_venue), '') is null then
    raise exception 'TELEGRAM_NOT_CONFIGURED' using errcode = 'P0001',
      hint = 'enable Telegram and set the group chat id first';
  end if;

  select display_name into v_name from staff where id = auth.uid();

  v_id := app.enqueue_telegram('test', null,
            jsonb_build_object('sent_by', coalesce(v_name, 'owner'), 'at', now()), v_venue);
  if v_id is null then
    raise exception 'TELEGRAM_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  -- enqueue_telegram already nudged on insert; nudge again is cheap and
  -- covers a row that raced with an in-flight sender.
  perform app.telegram_nudge();

  return jsonb_build_object('outbox_id', v_id);
end $telegram_send_test_0212$;

revoke all on function app.telegram_send_test(uuid) from public, anon;
grant execute on function app.telegram_send_test(uuid) to authenticated;

-- retry_telegram_outbox: re-issued from 20260913000091_telegram_diagnose.sql:43
create or replace function app.retry_telegram_outbox(p_id bigint) returns void
language plpgsql security definer set search_path = public as $retry_telegram_outbox_0212$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update telegram_outbox
     set status        = 'queued',
         attempts      = 0,
         scheduled_for = now(),
         last_error    = null,
         chat_id       = coalesce(nullif(app.cafe_setting_text('telegram_chat_id', venue_id), ''), chat_id)
   where id = p_id;
  if not found then
    raise exception 'OUTBOX_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform app.telegram_nudge();
end $retry_telegram_outbox_0212$;

-- telegram_apply_action: re-issued from 20260825000039_telegram_authz_line_no.sql:355
create or replace function app.telegram_apply_action(
  p_action  text,
  p_ref_id  uuid,
  p_actor   jsonb,
  p_chat_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $telegram_apply_action_0212$
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
  -- 0212 (MV3): the group of the branch the order or call belongs to.
  v_chat := nullif(app.cafe_setting_text('telegram_chat_id',
              coalesce((select o.venue_id from orders o where o.id = p_ref_id),
                       (select w.venue_id from waiter_calls w where w.id = p_ref_id))), '');
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
end $telegram_apply_action_0212$;

