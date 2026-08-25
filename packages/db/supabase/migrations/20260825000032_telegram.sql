-- 0032_telegram — Telegram staff-group notifications (cafe rebuild, db-slice §0032).
--
-- What lands here (additive only; no enum edits, no drops):
--  * telegram_outbox   — durable outbox (0024 pattern). Rows are ENQUEUED by
--                        create_guest_order / raise_waiter_call / send_test with
--                        a render SNAPSHOT (app.telegram_*_payload) and a chat-id
--                        snapshot; the `telegram-send` edge function CLAIMS due
--                        rows (app.claim_due_telegram, service role) and stamps
--                        sent/failed/skipped directly. A Telegram outage can never
--                        roll back an order or a call: every enqueue call site is
--                        wrapped in `begin … exception when others then raise
--                        warning` (0022 posture).
--  * telegram_actions  — ledger of every button tap (including duplicates).
--  * app.telegram_nudge — pg_net POST to telegram-send ONLY when a due row
--                        exists; called from the enqueue path (latency ~1-3 s) and
--                        by pg_cron `tp_telegram_sweep` every 10 s (fallback per
--                        minute on pg_cron < 1.5). Idle = zero invocations.
--  * app.secret(name)  — generalised Vault -> app.secrets lookup (no bootstrap):
--                        `service_role_key`, `functions_base_url`.
--  * Internal state machines split out of the staff RPCs so the Telegram
--                        write-back (service role, auth.uid() = NULL) can reuse
--                        them without the is_staff guard:
--                          ticket_transition        <- set_ticket_status
--                          void_order_item_internal <- void_after_send
--                          waiter_call_transition   <- ack/resolve_waiter_call
--                        The staff RPCs keep their signatures, grants, checks
--                        and return shapes: guard (+ PIN) + call.
--  * app.telegram_apply_action — service-role only write-back for the callback
--                        edge function; always writes a telegram_actions row.
--  * Telegram actor: NO synthetic staff rows (staff.id -> auth.users). New
--                        nullable label columns tickets.last_actor_label,
--                        waiter_calls.acknowledged_label / resolved_label carry
--                        'Telegram: <first name>'; the *_by staff FKs stay NULL.
--                        Audit rows for Telegram-driven changes go through
--                        app.write_audit_external (actor_id NULL, actor_role
--                        'telegram') — audit_log already allows both (0005).
--  * Re-creations owned by this migration (full latest bodies copied):
--                          app.create_guest_order  (0015) + guarded enqueue
--                          app.raise_waiter_call   (0016) + BELL_DISABLED + enqueue
--                          app.set_ticket_status   (0015) -> guard + call
--                          app.void_after_send     (0026) -> guard + PIN + call
--                          app.ack_waiter_call     (0016) -> guard + call
--                          app.resolve_waiter_call (0016) -> guard + call
--  * Owner RPCs: app.telegram_send_test, app.retry_telegram_outbox.
--
-- Depends on: 0029 (app.cafe_setting_bool/_text, keys telegram_enabled /
-- telegram_chat_id), 0030 (order_items.discount_pct), 0031
-- (cafe_tables.bell_enabled).

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Tables + label columns
-- ═══════════════════════════════════════════════════════════════════════════
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

-- Double-enqueue guard: one message per (kind, ref). Test messages carry no ref.
create unique index telegram_outbox_one_per_ref
  on telegram_outbox (kind, ref_id) where ref_id is not null;
-- The claim query's working set: queued, under the retry cap.
create index telegram_outbox_due
  on telegram_outbox (scheduled_for) where status = 'queued' and attempts < 8;

comment on table telegram_outbox is
  'Outbox for the Telegram staff group (0032). Enqueued with a render snapshot by create_guest_order / raise_waiter_call / telegram_send_test; claimed by the telegram-send edge function via app.claim_due_telegram (service role), which stamps status/sent_at/telegram_message_id/text/reply_markup. Clients: manager|owner SELECT only.';
comment on column telegram_outbox.payload is
  'Render snapshot taken at enqueue time (app.telegram_order_payload / app.telegram_call_payload / {sent_by, at} for test). The sender never re-reads live rows.';
comment on column telegram_outbox.text is
  'Exact HTML the sender delivered — the callback appends a status footer to it via editMessageText.';

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

create index telegram_actions_ref on telegram_actions (ref_id, at desc);

comment on table telegram_actions is
  'Ledger of every Telegram inline-button tap handled by app.telegram_apply_action (0032), duplicates included. Telegram users are not staff rows; tg_user_id / tg_first_name identify the tapper. Clients: manager|owner SELECT only.';

alter table waiter_calls
  add column if not exists acknowledged_label text,
  add column if not exists resolved_label     text;
alter table tickets
  add column if not exists last_actor_label text;   -- 'Telegram: Ahmed' when a tap moved the ticket

comment on column waiter_calls.acknowledged_label is
  'Free-text actor label when the ack came from outside the staff table (e.g. ''Telegram: Ahmed''); acknowledged_by stays NULL in that case.';
comment on column waiter_calls.resolved_label is
  'Free-text actor label when the resolve came from outside the staff table; resolved_by stays NULL in that case.';
comment on column tickets.last_actor_label is
  'Label of the last non-staff actor that moved this ticket (''Telegram: Ahmed''). NULL when only staff devices touched it.';

-- ---------------------------------------------------------------------------
-- RLS + grants: manager|owner read (the operator Telegram page lists recent
-- deliveries/failures; payloads hold order data staff already see). No client
-- writes. service_role gets everything explicitly (belt over 0012 defaults).
-- ---------------------------------------------------------------------------
alter table telegram_outbox  enable row level security;
alter table telegram_actions enable row level security;

grant select on telegram_outbox, telegram_actions to authenticated;

create policy telegram_outbox_mgmt_read on telegram_outbox for select to authenticated
  using (app.is_staff('manager','owner'));
create policy telegram_actions_mgmt_read on telegram_actions for select to authenticated
  using (app.is_staff('manager','owner'));

grant all on telegram_outbox, telegram_actions to service_role;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. app.secret — Vault first (guarded: stacks without Vault), app.secrets
--    fallback, NULL if absent. NO bootstrap (unlike table_token_secret): the
--    owner sets `service_role_key` / `functions_base_url` per SETUP-telegram.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.secret(p_name text) returns text
language plpgsql security definer set search_path = public as $tg_secret$
declare
  v text;
begin
  if p_name is null or p_name = '' then
    return null;
  end if;

  -- 1. Vault, if present.
  begin
    select decrypted_secret into v
      from vault.decrypted_secrets
     where name = p_name
     limit 1;
  exception when others then
    v := null;                                 -- vault schema/view missing or unreadable
  end;
  if v is not null then
    return v;
  end if;

  -- 2. Fallback table (definer-only, 0014).
  select value into v from app.secrets where name = p_name;
  return v;                                    -- NULL when unset: callers degrade, never bootstrap
end $tg_secret$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 3. Payload snapshots (definer; internal + service_role)
-- ═══════════════════════════════════════════════════════════════════════════
-- {order_id, short_id, table_number, placed_at, source, total_iqd,
--  items:[{qty, name_en, name_ar, variant_en, variant_ar, variant_count,
--          modifiers:[{name_en, name_ar, qty}], notes, line_total_iqd, discount_pct}]}
-- Non-voided lines only, in insertion order (order_items has no sequence
-- column; physical order = insertion order at enqueue time). NULL when the
-- order does not exist.
create or replace function app.telegram_order_payload(p_order_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $tg_order_payload$
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
      select oi.ctid           as line_ord,
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
end $tg_order_payload$;

-- {call_id, table_number, reason, raised_at}; NULL when the call does not exist.
create or replace function app.telegram_call_payload(p_call_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $tg_call_payload$
declare
  v jsonb;
begin
  select jsonb_build_object(
           'call_id',      wc.id,
           'table_number', ct.table_number,
           'reason',       wc.reason,
           'raised_at',    wc.raised_at)
    into v
    from waiter_calls wc
    join cafe_tables ct on ct.id = wc.table_id
   where wc.id = p_call_id;
  return v;                                    -- NULL when not found
end $tg_call_payload$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 4. Nudge + enqueue
-- ═══════════════════════════════════════════════════════════════════════════
-- app.telegram_nudge — fire-and-forget POST to the sender, ONLY when a due
-- queued row exists (idle = no HTTP). Silently returns when pg_net or either
-- secret is missing (the cron sweep still runs; the sender is then invoked by
-- the sweep alone -> ~10 s floor). Whole body guarded: a nudge failure is a
-- warning, never an error for the enqueuing transaction.
create or replace function app.telegram_nudge() returns void
language plpgsql security definer set search_path = public as $tg_nudge$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from telegram_outbox
                    where status = 'queued' and attempts < 8 and scheduled_for <= now()) then
      return;
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed: cron sweep only
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured: cron sweep only
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/telegram-send',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'telegram_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $tg_nudge$;

-- app.enqueue_telegram — INTERNAL. NULL (no-op) when Telegram is disabled or
-- no chat id is configured; builds the render snapshot when p_payload is NULL;
-- `on conflict do nothing` on the (kind, ref_id) guard; nudges the sender when a
-- row was actually inserted. Callers MUST wrap it in an exception guard.
create or replace function app.enqueue_telegram(
  p_kind    text,
  p_ref_id  uuid,
  p_payload jsonb default null
) returns bigint
language plpgsql security definer set search_path = public as $tg_enqueue$
declare
  v_chat    text;
  v_payload jsonb := p_payload;
  v_id      bigint;
begin
  if p_kind is null or p_kind not in ('order_new','waiter_call','test') then
    raise exception 'INVALID_KIND' using errcode = 'P0001', detail = coalesce(p_kind, 'null');
  end if;

  if not coalesce(app.cafe_setting_bool('telegram_enabled'), false) then
    return null;
  end if;
  v_chat := nullif(app.cafe_setting_text('telegram_chat_id'), '');
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

  insert into telegram_outbox (kind, ref_id, chat_id, payload)
  values (p_kind, p_ref_id, v_chat, v_payload)
  on conflict do nothing                       -- telegram_outbox_one_per_ref: already enqueued
  returning id into v_id;

  if v_id is not null then
    perform app.telegram_nudge();
  end if;
  return v_id;
end $tg_enqueue$;

-- ---------------------------------------------------------------------------
-- pg_cron jobs — best-effort (0021/0024 guard): stacks without the extension
-- still reset. Unschedule-if-exists then schedule, so re-runs are clean.
--   tp_telegram_sweep — every 10 s (pg_cron >= 1.5 interval syntax); falls
--                       back to every minute when the seconds syntax raises.
--   tp_telegram_prune — nightly 03:30: sent outbox rows > 30 d, actions > 90 d.
-- ---------------------------------------------------------------------------
do $tg_cron$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - telegram jobs skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_telegram_sweep / tp_telegram_prune not scheduled';
    return;
  end if;

  perform cron.unschedule(jobid)
     from cron.job
    where jobname in ('tp_telegram_sweep', 'tp_telegram_prune');

  begin
    perform cron.schedule('tp_telegram_sweep', '10 seconds', 'select app.telegram_nudge();');
  exception when others then
    raise notice 'pg_cron seconds syntax unsupported (%) - tp_telegram_sweep falls back to every minute', sqlerrm;
    perform cron.schedule('tp_telegram_sweep', '* * * * *', 'select app.telegram_nudge();');
  end;

  perform cron.schedule('tp_telegram_prune', '30 3 * * *',
    $tg_prune$
      delete from telegram_outbox o
       where o.status = 'sent' and o.sent_at < now() - interval '30 days';
      delete from telegram_actions a
       where a.at < now() - interval '90 days';
    $tg_prune$);
end $tg_cron$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 5. app.claim_due_telegram — the sender's claim (mirrors 0024): queued,
--    attempts < 8, due, FOR UPDATE SKIP LOCKED; attempts bumped up front so a
--    sender that crashes mid-batch burns one attempt instead of retrying
--    forever. SERVICE-ROLE ONLY.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.claim_due_telegram(p_limit int default 50)
returns setof telegram_outbox
language sql security definer set search_path = public as $tg_claim$
  update telegram_outbox o
     set attempts = o.attempts + 1
    from (
      select id from telegram_outbox
       where status = 'queued' and attempts < 8 and scheduled_for <= now()
       order by scheduled_for
       for update skip locked
       limit p_limit
    ) due
   where o.id = due.id
  returning o.*;
$tg_claim$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 6. app.write_audit_external — sibling of app.write_audit for actors that are
--    not auth users (Telegram taps run under the service role: auth.uid() is
--    NULL). audit_log.actor_id is a nullable uuid and actor_role is free text
--    (0005), so no schema change is needed.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.write_audit_external(
  p_actor_role  text,
  p_action      text,
  p_entity      text,
  p_entity_id   text,
  p_before      jsonb default null,
  p_after       jsonb default null,
  p_reason_code text default null
) returns void
language sql security definer set search_path = public as $tg_audit_ext$
  insert into audit_log
    (actor_id, actor_role, authorizer_id, action, entity, entity_id,
     before, after, reason_code, device_id)
  values
    (null, p_actor_role, null, p_action, p_entity, p_entity_id,
     p_before, p_after, p_reason_code, null);
$tg_audit_ext$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 7. Internal state machines (no role guard) + the staff RPCs as guard + call
-- ═══════════════════════════════════════════════════════════════════════════
-- app.ticket_transition — the 0015 set_ticket_status body minus the guard,
-- plus last_actor_label. queued -> preparing -> ready -> completed ('ready' may
-- skip 'preparing'); stamps started_at / ready_at / completed_at +
-- actual_prep_seconds, mirrors onto orders.status ('completed' => 'served'),
-- stamps order_items.ready_at. 'voided' is NOT reachable here.
create or replace function app.ticket_transition(
  p_ticket_id   uuid,
  p_status      ticket_status,
  p_device_id   text,
  p_actor_label text default null
) returns jsonb
language plpgsql security definer set search_path = public as $tg_ticket_tr$
declare
  v    tickets%rowtype;
  v_ok boolean;
begin
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
         device_id    = coalesce(p_device_id, device_id),
         last_actor_label = coalesce(p_actor_label, last_actor_label)
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
end $tg_ticket_tr$;

-- app.set_ticket_status — same signature/attributes as 0015: guard + call.
create or replace function app.set_ticket_status(
  p_ticket_id uuid,
  p_status    ticket_status,
  p_device_id text default null
) returns jsonb
language plpgsql security definer set search_path = public as $tg_set_ticket$
begin
  if not app.is_staff('prep','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.ticket_transition(p_ticket_id, p_status, p_device_id, null);
end $tg_set_ticket$;

-- app.void_order_item_internal — the 0026 void_after_send body after the PIN
-- step: the item is STRUCK, never deleted; if the whole order is struck the
-- order + ticket flip to 'voided'. VOID_REQUIRES_REFUND guard kept. Audit
-- 'order_item.void' — via app.write_audit (actor = auth.uid(), authorizer =
-- p_authorizer) for staff, via app.write_audit_external('telegram') when
-- p_actor is given; the actor jsonb rides in `after`.
create or replace function app.void_order_item_internal(
  p_order_item_id uuid,
  p_reason_code   text,
  p_authorizer    uuid,
  p_device_id     text,
  p_actor         jsonb default null
) returns jsonb
language plpgsql security definer set search_path = public as $tg_void_int$
declare
  v_oi        order_items%rowtype;
  v_order     orders%rowtype;
  v_tab       tabs%rowtype;
  v_before    jsonb;
  v_after     jsonb;
  v_paid      bigint;
  v_new_total bigint;
begin
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
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
                                     v_oi.id::text, v_before, v_after, p_reason_code);
  else
    perform app.write_audit('order_item.void', 'order_items', v_oi.id::text,
                            v_before, v_after, p_reason_code, p_authorizer, p_device_id);
  end if;

  return jsonb_build_object('duplicate', false, 'order_item_id', v_oi.id);
end $tg_void_int$;

-- app.void_after_send — same signature/attributes as 0015/0026: guard + PIN +
-- call. (Void BEFORE send does not exist server-side: drafts never hit the server.)
create or replace function app.void_after_send(
  p_order_item_id uuid,
  p_pin           text,
  p_reason_code   text,
  p_device_id     text default null
) returns jsonb
language plpgsql security definer set search_path = public as $tg_void_after_send$
declare
  v_auth uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_reason_code is null or p_reason_code = '' then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;

  v_auth := app.verify_manager_pin(p_pin, p_device_id);   -- raises PIN_LOCKED itself
  if v_auth is null then
    raise exception 'PIN_INVALID' using errcode = 'P0001';
  end if;

  return app.void_order_item_internal(p_order_item_id, p_reason_code, v_auth, p_device_id, null);
end $tg_void_after_send$;

-- app.waiter_call_transition — the 0016 ack/resolve bodies minus the guard,
-- parameterised on the target status, the acting staff id (NULL for Telegram)
-- and a free-text label. Return shapes unchanged: {duplicate, call_id, status}.
create or replace function app.waiter_call_transition(
  p_call_id uuid,
  p_to      waiter_call_status,
  p_staff   uuid,
  p_label   text
) returns jsonb
language plpgsql security definer set search_path = public as $tg_call_tr$
declare
  v waiter_calls%rowtype;
begin
  select * into v from waiter_calls where id = p_call_id for update;
  if not found then
    raise exception 'CALL_NOT_FOUND' using errcode = 'P0001';
  end if;

  if p_to = 'acknowledged' then
    if v.status = 'acknowledged' then          -- idempotent double-tap
      return jsonb_build_object('duplicate', true, 'call_id', v.id, 'status', v.status);
    end if;
    if v.status <> 'raised' then
      raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
        detail = format('%s -> acknowledged', v.status);
    end if;

    update waiter_calls
       set status             = 'acknowledged',
           acknowledged_at    = now(),
           acknowledged_by    = p_staff,
           acknowledged_label = coalesce(p_label, acknowledged_label)
     where id = p_call_id
     returning * into v;

  elsif p_to = 'resolved' then
    if v.status = 'resolved' then              -- idempotent
      return jsonb_build_object('duplicate', true, 'call_id', v.id, 'status', v.status);
    end if;

    -- Resolving frees the table's slot under waiter_calls_one_open; an
    -- unacknowledged call gets its ack stamped by the resolver.
    update waiter_calls
       set status             = 'resolved',
           resolved_at        = now(),
           resolved_by        = p_staff,
           resolved_label     = coalesce(p_label, resolved_label),
           acknowledged_at    = coalesce(acknowledged_at, now()),
           acknowledged_by    = coalesce(acknowledged_by, p_staff),
           acknowledged_label = coalesce(acknowledged_label, p_label)
     where id = p_call_id
     returning * into v;

  else
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> %s', v.status, p_to);
  end if;

  return jsonb_build_object('duplicate', false, 'call_id', v.id, 'status', v.status);
end $tg_call_tr$;

-- app.ack_waiter_call — same signature as 0016: guard + call.
create or replace function app.ack_waiter_call(p_call_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tg_ack_call$
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.waiter_call_transition(p_call_id, 'acknowledged', auth.uid(), null);
end $tg_ack_call$;

-- app.resolve_waiter_call — same signature as 0016: guard + call.
create or replace function app.resolve_waiter_call(p_call_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tg_resolve_call$
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return app.waiter_call_transition(p_call_id, 'resolved', auth.uid(), null);
end $tg_resolve_call$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 8. app.telegram_apply_action — SERVICE-ROLE ONLY write-back for the
--    telegram-callback edge function. p_actor = {tg_user_id, first_name,
--    username}; label = 'Telegram: ' || first_name. ALWAYS writes a
--    telegram_actions row (result in applied|duplicate|invalid|not_found|
--    refused). Existing 0022 realtime triggers fire on the updates, so KDS,
--    till and the guest page update live with no extra work.
--
--    action    ref       effect                                   duplicate                 invalid / refused
--    o:seen    order id  queued -> preparing                      already preparing/ready/  ticket voided
--                                                                 completed
--    o:served  order id  queued|preparing -> ready -> completed   already completed         voided
--                        (one txn); ready -> completed
--    o:void    order id  every non-voided line via                order already voided      refused: tab not open /
--                        void_order_item_internal(reason                                    VOID_REQUIRES_REFUND
--                        'telegram', authorizer NULL)
--    w:ack     call id   raised -> acknowledged (+ label)         already acked/resolved    —
--    w:done    call id   -> resolved (+ labels)                   already resolved          —
--
--    Returns {result, status, keyboard, actor_label}; keyboard is
--    'order_seen' | 'order_final' | 'call_acked' | 'call_final' on applied,
--    'unchanged' otherwise. Unknown ref -> result 'not_found'.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.telegram_apply_action(
  p_action text,
  p_ref_id uuid,
  p_actor  jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $tg_apply$
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

  if left(p_action, 2) = 'o:' then
    v_entity := 'orders';
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
                   order by ctid
                loop
                  perform app.void_order_item_internal(v_oi.id, 'telegram', null, null, v_actor);
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
                if sqlerrm in ('VOID_REQUIRES_REFUND', 'TAB_NOT_OPEN') then
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
                                     'telegram');
  end if;

  return jsonb_build_object('result', v_result, 'status', v_status,
                            'keyboard', v_keyboard, 'actor_label', v_label);
end $tg_apply$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 9. app.create_guest_order — FULL 0015 body + guarded enqueue after the ticket
--    insert (enqueue-at-end, not an orders INSERT trigger: at insert time
--    neither items nor ticket exist and the snapshot would be empty).
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.create_guest_order(
  p_items           jsonb,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $tg_guest_order$
declare
  v_sess   guest_sessions;
  v_day    uuid;
  v_tab    tabs%rowtype;
  v_order  orders%rowtype;
  v_ticket tickets%rowtype;
  v_total  bigint;
begin
  -- DEGRADED GUARD: cafe ordering is blocked outright while the till is
  -- offline (app.is_degraded, real implementation since 0021/0026).
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

  -- STOCK HOOK (0018): the tickets_consume_stock trigger consumes the order's
  -- lines ('sale_consumption') on the ticket insert above.

  -- TELEGRAM (0032): enqueue the staff-group message. Bookkeeping only — a
  -- failure here must never roll back the order.
  begin
    perform app.enqueue_telegram('order_new', v_order.id);
  exception when others then
    raise warning 'telegram enqueue failed for order %: % (%)', v_order.id, sqlerrm, sqlstate;
  end;

  return jsonb_build_object('duplicate', false, 'order_id', v_order.id,
    'tab_id', v_tab.id, 'ticket_id', v_ticket.id, 'total_iqd', v_total);
end $tg_guest_order$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 10. app.raise_waiter_call — FULL 0016 body + BELL_DISABLED (0031
--     cafe_tables.bell_enabled) after touch_guest_session and before the
--     cooldown check + guarded enqueue after the insert.
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.raise_waiter_call(p_reason waiter_call_reason)
returns jsonb
language plpgsql security definer set search_path = public as $tg_raise_call$
declare
  v_sess guest_sessions;
  v_cool int;
  v_last timestamptz;
  v_row  waiter_calls%rowtype;
begin
  -- DEGRADED GUARD: staff can't watch the floor screen while the till is
  -- offline.
  if app.is_degraded() then
    raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
      hint = 'please wave at the staff — the call screen is offline';
  end if;

  v_sess := app.touch_guest_session();         -- raises SESSION_EXPIRED / AUTH_REQUIRED

  -- BELL (0031/0032): the table's bell can be switched off by management.
  if not coalesce((select bell_enabled from cafe_tables where id = v_sess.table_id), true) then
    raise exception 'BELL_DISABLED' using errcode = 'P0001',
      hint = 'the bell is off for this table — please wave at the staff';
  end if;

  select waiter_call_cooldown_seconds into v_cool from venue_settings;
  select max(raised_at) into v_last from waiter_calls where table_id = v_sess.table_id;
  if v_last is not null and v_last > now() - make_interval(secs => coalesce(v_cool, 120)) then
    raise exception 'CALL_COOLDOWN' using errcode = 'P0001',
      hint = 'staff already notified — give them a moment';
  end if;

  begin
    insert into waiter_calls (table_id, guest_session_id, reason)
    values (v_sess.table_id, v_sess.id, p_reason)
    returning * into v_row;
  exception when unique_violation then
    -- waiter_calls_one_open: a live call already exists for this table.
    raise exception 'ALREADY_NOTIFIED' using errcode = 'P0001',
      hint = 'staff already notified — give them a moment';
  end;

  -- TELEGRAM (0032): bookkeeping only — never roll back the call.
  begin
    perform app.enqueue_telegram('waiter_call', v_row.id);
  exception when others then
    raise warning 'telegram enqueue failed for waiter call %: % (%)', v_row.id, sqlerrm, sqlstate;
  end;

  return jsonb_build_object('call_id', v_row.id, 'status', v_row.status,
                            'raised_at', v_row.raised_at);
end $tg_raise_call$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 11. Owner RPCs — send a test message; retry a failed/skipped outbox row.
-- ═══════════════════════════════════════════════════════════════════════════
-- app.telegram_send_test — owner only. Enqueues kind 'test' (no ref_id => no
-- unique clash), nudges, returns {outbox_id}; the operator polls the row by id
-- (status / sent_at / last_error) to show "Sent" / "Failed: chat not found".
create or replace function app.telegram_send_test() returns jsonb
language plpgsql security definer set search_path = public as $tg_send_test$
declare
  v_name text;
  v_id   bigint;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if not coalesce(app.cafe_setting_bool('telegram_enabled'), false)
     or nullif(app.cafe_setting_text('telegram_chat_id'), '') is null then
    raise exception 'TELEGRAM_NOT_CONFIGURED' using errcode = 'P0001',
      hint = 'enable Telegram and set the group chat id first';
  end if;

  select display_name into v_name from staff where id = auth.uid();

  v_id := app.enqueue_telegram('test', null,
            jsonb_build_object('sent_by', coalesce(v_name, 'owner'), 'at', now()));
  if v_id is null then
    raise exception 'TELEGRAM_NOT_CONFIGURED' using errcode = 'P0001';
  end if;
  -- enqueue_telegram already nudged on insert; nudge again is cheap and
  -- covers a row that raced with an in-flight sender.
  perform app.telegram_nudge();

  return jsonb_build_object('outbox_id', v_id);
end $tg_send_test$;

-- app.retry_telegram_outbox — owner only. Re-queues a row (any status) from
-- scratch and nudges the sender.
create or replace function app.retry_telegram_outbox(p_id bigint) returns void
language plpgsql security definer set search_path = public as $tg_retry$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update telegram_outbox
     set status = 'queued', attempts = 0, scheduled_for = now(), last_error = null
   where id = p_id;
  if not found then
    raise exception 'OUTBOX_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform app.telegram_nudge();
end $tg_retry$;

-- ═══════════════════════════════════════════════════════════════════════════
-- 12. Function grants
-- ═══════════════════════════════════════════════════════════════════════════
-- Internal (definer-only): no client role may execute.
revoke all on function app.secret(text)                                  from public, anon, authenticated;
revoke all on function app.enqueue_telegram(text, uuid, jsonb)           from public, anon, authenticated;
revoke all on function app.write_audit_external(text, text, text, text, jsonb, jsonb, text)
                                                                          from public, anon, authenticated;
revoke all on function app.ticket_transition(uuid, ticket_status, text, text)
                                                                          from public, anon, authenticated;
revoke all on function app.void_order_item_internal(uuid, text, uuid, text, jsonb)
                                                                          from public, anon, authenticated;
revoke all on function app.waiter_call_transition(uuid, waiter_call_status, uuid, text)
                                                                          from public, anon, authenticated;

-- Internal + service role (the sender / callback edge functions).
revoke all on function app.telegram_order_payload(uuid) from public, anon, authenticated;
grant execute on function app.telegram_order_payload(uuid) to service_role;

revoke all on function app.telegram_call_payload(uuid) from public, anon, authenticated;
grant execute on function app.telegram_call_payload(uuid) to service_role;

revoke all on function app.telegram_nudge() from public, anon, authenticated;
grant execute on function app.telegram_nudge() to service_role;

-- Service-role only.
revoke all on function app.claim_due_telegram(int) from public, anon, authenticated;
grant execute on function app.claim_due_telegram(int) to service_role;

revoke all on function app.telegram_apply_action(text, uuid, jsonb) from public, anon, authenticated;
grant execute on function app.telegram_apply_action(text, uuid, jsonb) to service_role;

-- Staff / guest RPCs (role guard is the first statement of each body).
-- Re-created functions re-apply their original 0015 / 0016 grants.
revoke all on function app.create_guest_order(jsonb, text, text) from public, anon;
grant execute on function app.create_guest_order(jsonb, text, text) to authenticated;

revoke all on function app.set_ticket_status(uuid, ticket_status, text) from public, anon;
grant execute on function app.set_ticket_status(uuid, ticket_status, text) to authenticated;

revoke all on function app.void_after_send(uuid, text, text, text) from public, anon;
grant execute on function app.void_after_send(uuid, text, text, text) to authenticated;

revoke all on function app.raise_waiter_call(waiter_call_reason) from public, anon;
grant execute on function app.raise_waiter_call(waiter_call_reason) to authenticated;

revoke all on function app.ack_waiter_call(uuid) from public, anon;
grant execute on function app.ack_waiter_call(uuid) to authenticated;

revoke all on function app.resolve_waiter_call(uuid) from public, anon;
grant execute on function app.resolve_waiter_call(uuid) to authenticated;

revoke all on function app.telegram_send_test() from public, anon;
grant execute on function app.telegram_send_test() to authenticated;

revoke all on function app.retry_telegram_outbox(bigint) from public, anon;
grant execute on function app.retry_telegram_outbox(bigint) to authenticated;
