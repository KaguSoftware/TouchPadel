-- 0033_realtime_cafe — cafe-rebuild broadcast additions (db-slice.md
-- "0033_realtime_cafe"; extends 0022_realtime).
--
--  1. app.rt_waiter_call re-created (body copied from 0022 — no later
--     migration touched it): the 'floor' send is kept verbatim; a SECOND
--     guarded send tells the guest's own page about status changes on
--     'session:{guest_session_id}' (event 'waiter_call_status'), so the guest
--     page can drop its 20 s poll. The 0022 policy touchpadel_rt_guest_session
--     already authorises that topic for the live session's auth user (it
--     filters on topic only, not on event) — no policy change.
--  2. app.rt_menu_changed_any — like 0022 app.rt_menu_changed but the payload
--     is {table, op} only: link tables (menu_item_modifier_groups,
--     modifier_reveals, addon_suggestions) have no `id`. Event 'menu_changed',
--     topic 'menu'.
--  3. app.rt_settings_changed — cafe_settings rows with is_public = true fan
--     out as 'settings_changed' on 'menu' with {table, key, op}; private rows
--     (telegram_*, analytics_*) never reach the wire. The 0022 policy
--     touchpadel_rt_menu grants anon + authenticated on topic 'menu' with no
--     event filter, so 'settings_changed' is covered — no policy change.
--
-- Every realtime.send is wrapped in BEGIN...EXCEPTION WHEN OTHERS THEN NULL —
-- a missing/unhealthy realtime schema must NEVER break a business write.
-- Existing triggers menu_items_rt / menu_item_variants_rt (0022) are untouched.
--
-- FRONTEND NOTE: a single admin save can fire several rows (e.g. a modifier
-- group re-link deletes + inserts link rows). Clients should DEBOUNCE
-- 'menu_changed' / 'settings_changed' (~500 ms) before re-fetching.
--
-- Additive only: function bodies re-created / added, triggers added. No drops
-- of tables, columns, policies or existing triggers.

set check_function_bodies = off;

-- ---------------------------------------------------------------------------
-- 1. waiter calls -> 'floor' (till floor view, unchanged from 0022)
--                 -> 'session:{guest_session_id}' (the guest's open page, NEW)
-- ---------------------------------------------------------------------------
create or replace function app.rt_waiter_call() returns trigger
language plpgsql security definer set search_path = public as $rt_wc$
begin
  -- 0022 body, verbatim: staff floor view.
  begin
    perform realtime.send(
      jsonb_build_object(
        'call_id',  new.id,
        'table_id', new.table_id,
        'reason',   new.reason,
        'status',   new.status,
        'raised_at', new.raised_at),
      'waiter_call',
      'floor',
      true);
  exception when others then null;
  end;

  -- NEW: the guest who raised the call (topic authorised by
  -- touchpadel_rt_guest_session while their session is live).
  if new.guest_session_id is not null then
    begin
      perform realtime.send(
        jsonb_build_object(
          'call_id',         new.id,
          'status',          new.status,
          'reason',          new.reason,
          'raised_at',       new.raised_at,
          'acknowledged_at', new.acknowledged_at,
          'resolved_at',     new.resolved_at),
        'waiter_call_status',
        'session:' || new.guest_session_id::text,
        true);
    exception when others then null;
    end;
  end if;

  return new;
end $rt_wc$;

-- Trigger waiter_calls_rt (0022: after insert or update of status) is kept
-- as-is; CREATE OR REPLACE swaps the body underneath it.

-- ---------------------------------------------------------------------------
-- 2. menu structure tables -> 'menu' (cache-bust hint, no id — link tables
--    have none; data comes from the tables)
-- ---------------------------------------------------------------------------
create or replace function app.rt_menu_changed_any() returns trigger
language plpgsql security definer set search_path = public as $rt_any$
begin
  begin
    perform realtime.send(
      jsonb_build_object('table', tg_table_name, 'op', tg_op),
      'menu_changed',
      'menu',
      true);
  exception when others then null;
  end;
  return coalesce(new, old);
end $rt_any$;

drop trigger if exists menu_categories_rt on menu_categories;
create trigger menu_categories_rt
  after insert or update or delete on menu_categories
  for each row execute function app.rt_menu_changed_any();

drop trigger if exists modifier_groups_rt on modifier_groups;
create trigger modifier_groups_rt
  after insert or update or delete on modifier_groups
  for each row execute function app.rt_menu_changed_any();

drop trigger if exists modifiers_rt on modifiers;
create trigger modifiers_rt
  after insert or update or delete on modifiers
  for each row execute function app.rt_menu_changed_any();

drop trigger if exists menu_item_modifier_groups_rt on menu_item_modifier_groups;
create trigger menu_item_modifier_groups_rt
  after insert or update or delete on menu_item_modifier_groups
  for each row execute function app.rt_menu_changed_any();

drop trigger if exists modifier_reveals_rt on modifier_reveals;
create trigger modifier_reveals_rt
  after insert or update or delete on modifier_reveals
  for each row execute function app.rt_menu_changed_any();

drop trigger if exists addon_suggestions_rt on addon_suggestions;
create trigger addon_suggestions_rt
  after insert or update or delete on addon_suggestions
  for each row execute function app.rt_menu_changed_any();

-- ---------------------------------------------------------------------------
-- 3. cafe_settings (public rows only) -> 'menu' as 'settings_changed'
--    coalesce(new, old): DELETE has no NEW row, INSERT has no OLD row.
-- ---------------------------------------------------------------------------
create or replace function app.rt_settings_changed() returns trigger
language plpgsql security definer set search_path = public as $rt_set$
begin
  if coalesce(new.is_public, old.is_public) then
    begin
      perform realtime.send(
        jsonb_build_object(
          'table', 'cafe_settings',
          'key',   coalesce(new.key, old.key),
          'op',    tg_op),
        'settings_changed',
        'menu',
        true);
    exception when others then null;
    end;
  end if;
  return coalesce(new, old);
end $rt_set$;

drop trigger if exists cafe_settings_rt on cafe_settings;
create trigger cafe_settings_rt
  after insert or update or delete on cafe_settings
  for each row execute function app.rt_settings_changed();

-- ---------------------------------------------------------------------------
-- Grants — trigger functions are never callable by clients (0022 posture).
-- ---------------------------------------------------------------------------
revoke all on function app.rt_waiter_call()      from public, anon, authenticated;
revoke all on function app.rt_menu_changed_any() from public, anon, authenticated;
revoke all on function app.rt_settings_changed() from public, anon, authenticated;
