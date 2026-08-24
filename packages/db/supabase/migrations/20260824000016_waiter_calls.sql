-- 0016_waiter_calls — call-waiter button with rate-limit state (design §1.7).
--
-- Two independent limits:
--  * partial unique index waiter_calls_one_open — the race-proof HARD stop:
--    one live ('raised') call per table; the RPC maps the constraint violation
--    to a friendly ALREADY_NOTIFIED.
--  * cooldown (venue_settings.waiter_call_cooldown_seconds) — the SOFT limit
--    checked in the RPC against the table's latest call.

create table waiter_calls (
  id               uuid primary key default gen_random_uuid(),
  table_id         uuid not null references cafe_tables(id),
  guest_session_id uuid not null references guest_sessions(id),
  reason           waiter_call_reason not null,
  status           waiter_call_status not null default 'raised',
  raised_at        timestamptz not null default now(),
  acknowledged_at  timestamptz,
  acknowledged_by  uuid references staff(id),
  resolved_at      timestamptz,
  resolved_by      uuid references staff(id)
);

-- one live call per table — the hard stop:
create unique index waiter_calls_one_open on waiter_calls (table_id) where status = 'raised';
create index waiter_calls_table_recent on waiter_calls (table_id, raised_at desc);

-- ---------------------------------------------------------------------------
-- app.raise_waiter_call — guest-session-bound.
-- ---------------------------------------------------------------------------
create or replace function app.raise_waiter_call(p_reason waiter_call_reason)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_sess guest_sessions;
  v_cool int;
  v_last timestamptz;
  v_row  waiter_calls%rowtype;
begin
  -- DEGRADED GUARD: staff can't watch the floor screen while the till is
  -- offline. app.is_degraded() is the 0008 stub (false) until 0021.
  if app.is_degraded() then
    raise exception 'DEGRADED_LOCKOUT' using errcode = 'P0001',
      hint = 'please wave at the staff — the call screen is offline';
  end if;

  v_sess := app.touch_guest_session();         -- raises SESSION_EXPIRED / AUTH_REQUIRED

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

  return jsonb_build_object('call_id', v_row.id, 'status', v_row.status,
                            'raised_at', v_row.raised_at);
end $$;

-- ---------------------------------------------------------------------------
-- app.ack_waiter_call — floor staff acknowledges (raised -> acknowledged).
-- ---------------------------------------------------------------------------
create or replace function app.ack_waiter_call(p_call_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v waiter_calls%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from waiter_calls where id = p_call_id for update;
  if not found then
    raise exception 'CALL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status = 'acknowledged' then            -- idempotent double-tap
    return jsonb_build_object('duplicate', true, 'call_id', v.id, 'status', v.status);
  end if;
  if v.status <> 'raised' then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001',
      detail = format('%s -> acknowledged', v.status);
  end if;

  update waiter_calls
     set status = 'acknowledged', acknowledged_at = now(), acknowledged_by = auth.uid()
   where id = p_call_id
   returning * into v;

  return jsonb_build_object('duplicate', false, 'call_id', v.id, 'status', v.status);
end $$;

-- ---------------------------------------------------------------------------
-- app.resolve_waiter_call — raised/acknowledged -> resolved. Resolving frees
-- the table's slot under waiter_calls_one_open.
-- ---------------------------------------------------------------------------
create or replace function app.resolve_waiter_call(p_call_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v waiter_calls%rowtype;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select * into v from waiter_calls where id = p_call_id for update;
  if not found then
    raise exception 'CALL_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status = 'resolved' then                -- idempotent
    return jsonb_build_object('duplicate', true, 'call_id', v.id, 'status', v.status);
  end if;

  update waiter_calls
     set status = 'resolved', resolved_at = now(), resolved_by = auth.uid(),
         acknowledged_at = coalesce(acknowledged_at, now()),
         acknowledged_by = coalesce(acknowledged_by, auth.uid())
   where id = p_call_id
   returning * into v;

  return jsonb_build_object('duplicate', false, 'call_id', v.id, 'status', v.status);
end $$;

-- ---------------------------------------------------------------------------
-- Function grants
-- ---------------------------------------------------------------------------
revoke all on function app.raise_waiter_call(waiter_call_reason) from public, anon;
grant execute on function app.raise_waiter_call(waiter_call_reason) to authenticated;

revoke all on function app.ack_waiter_call(uuid) from public, anon;
grant execute on function app.ack_waiter_call(uuid) to authenticated;

revoke all on function app.resolve_waiter_call(uuid) from public, anon;
grant execute on function app.resolve_waiter_call(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Grants + RLS (matrix §3.2): guest INSERT via RPC + SELECT own; cashier/
-- manager/owner read + ack/resolve via RPC. No direct writes for anyone.
-- ---------------------------------------------------------------------------
alter table waiter_calls enable row level security;

grant select on waiter_calls to authenticated;

create policy waiter_calls_guest_read on waiter_calls for select to authenticated
  using (app.is_own_session(guest_session_id));
create policy waiter_calls_staff_read on waiter_calls for select to authenticated
  using (app.is_staff('cashier','manager','owner'));
