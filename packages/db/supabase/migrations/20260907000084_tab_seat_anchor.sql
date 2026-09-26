-- 0084_tab_seat_anchor — a tab must be anchored to a SEAT.
--
-- THE PROBLEM. app.open_tab accepted any one of three anchors: a table, a
-- reservation, or a `label`. The label branch is the one that does not work.
--
--   1. A label is not an anchor, it is a display name. A tab carrying nothing
--      but "Ali" cannot be found by anyone who was not standing at the till
--      when it was opened — not by the waiter carrying the tray, not by the
--      cashier on the next shift, not by the open-tabs board, whose whole
--      organising idea is "which table is this".
--   2. The check was `p_label is null`, and ' ' is not null. A single space
--      typed into the till's "By name" field satisfied it, so the RPC would
--      open a tab with no table, no booking and no readable name — a blank row
--      on the board that nothing can be reconciled against at day close.
--
-- THE RULE. A table, or a reservation (which carries its own court, so the
-- booking IS the seat). The label survives as what it always was: the name
-- shown on the tab, now normalised so whitespace cannot masquerade as one.
--
-- NOT RETROACTIVE. `tabs.label`, `tabs.table_id` and `tabs.reservation_id` all
-- stay nullable and no CHECK is added: label-only tabs opened before this
-- migration are real trading history and must keep settling, reporting and
-- closing their day exactly as they do now. The gate is on OPENING a new one.
--
-- Mirrored client-side by tabOpenPayloadSchema (packages/core) and the till's
-- new-tab dialog; the replay edge function passes the payload through
-- unchanged, so this function is the authority for queued opens too.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0038 body + the seat rule + the label normalisation. Everything else —
-- the staff guard, scoped idempotent replay (#7), the locked day (#6) and the
-- unique_violation recovery — is carried over unchanged.
create or replace function app.open_tab(
  p_table_id        uuid default null,
  p_label           text default null,
  p_reservation_id  uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $opentab_0084$
declare
  v_day   uuid;
  v_row   tabs%rowtype;
  v_label text := nullif(btrim(p_label), '');   -- 0084: ' ' is not a name
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  if p_idempotency_key is not null then
    select * into v_row from tabs where idempotency_key = p_idempotency_key;
    if found then
      if v_row.opened_by_staff_id is distinct from auth.uid() then
        raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
          hint = 'that key belongs to another tab';
      end if;
      return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
    end if;
  end if;

  v_day := app.current_open_day_locked();      -- 0038 (#6)
  if v_day is null then
    raise exception 'NO_OPEN_DAY' using errcode = 'P0001';
  end if;

  if p_table_id is not null and not exists (select 1 from cafe_tables where id = p_table_id and is_active) then
    raise exception 'TABLE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if p_reservation_id is not null and not exists (select 1 from reservations where id = p_reservation_id) then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- 0084: the label no longer counts. A seat, or nothing.
  if p_table_id is null and p_reservation_id is null then
    raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001',
      hint = 'a tab needs a table or a reservation; a name alone is not an anchor';
  end if;

  begin
    insert into tabs (day_session_id, table_id, reservation_id, label,
                      opened_by_staff_id, device_id, idempotency_key)
    values (v_day, p_table_id, p_reservation_id, v_label,
            auth.uid(), p_device_id, p_idempotency_key)
    returning * into v_row;
  exception when unique_violation then
    if p_idempotency_key is not null then
      select * into v_row from tabs where idempotency_key = p_idempotency_key;
      if found then
        if v_row.opened_by_staff_id is distinct from auth.uid() then
          raise exception 'IDEMPOTENCY_CONFLICT' using errcode = 'P0001',
            hint = 'that key belongs to another tab';
        end if;
        return jsonb_build_object('duplicate', true, 'tab_id', v_row.id, 'status', v_row.status);
      end if;
    end if;
    raise;
  end;

  return jsonb_build_object('duplicate', false, 'tab_id', v_row.id);
end $opentab_0084$;

comment on function app.open_tab(uuid, text, uuid, text, text) is
  '0084. Opens a staff tab. The anchor is a seat — p_table_id or p_reservation_id; p_label is the display name only and a blank one is stored as NULL. Raises TAB_ANCHOR_REQUIRED when neither seat is given.';
