-- ===========================================================================
-- 0109 — owner assistant: the read-only wall, the count, the list RPCs and
--        the readable-columns allowlist.
--
-- docs/design/assistant/owner-assistant-plan-2026-09-20.md §2.2, §2.3, §2.5
-- (audit search column), §3.1 and build-contracts-2026-09-20.md "Lane A ·
-- 0109 dispatcher, count, list RPCs, readable columns".
--
-- THE ONE DOOR. app.assistant_run_tool is the only function the assistant's
-- edge function calls for numbers. It is STABLE (PostgREST wraps it in a
-- read-only transaction), and — because "STABLE" is a promise Postgres does
-- not enforce — its first statement after the owner guard turns
-- transaction_read_only ON for the rest of the transaction, so a direct
-- `select app.assistant_run_tool(...)` from any client is read-only too. It
-- dispatches over a FIXED `case` of catalog names (packages/core/src/assistant/
-- tools.ts DISPATCHED_RPCS; a test pins the two lists to each other) and calls
-- each existing RPC by name with typed arguments. An unknown name raises
-- ASSISTANT_UNKNOWN_TOOL. Every dispatched RPC keeps its own guard, and the
-- edge function calls with the OWNER's JWT, so auth.uid() is the owner.
--
-- NEW READ RPCs. Five paged list readers over rows the pages only aggregate
-- (bookings, tabs, payments, breaks, audit with full text), three lookups
-- (settings, courts and rates, system status), and two generic readers:
-- assistant_table_read (any table or view, every identifier validated against
-- app.assistant_readable_columns BEFORE format('%I')) and assistant_stock_view
-- (the five stock views by short name). They are SECURITY DEFINER and
-- owner-guarded but are NOT granted to any client role: the dispatcher reaches
-- them as definer, so they are not registry entries.
--
-- AUDIT FULL TEXT. audit_log gains a stored generated tsvector over action,
-- entity, entity id, reason code and the top-level keys of before/after, with
-- a GIN index, so "who changed the opening hours" is a text search at zero
-- embedding cost. audit_log is append-only (app.forbid_mutation refuses UPDATE
-- and DELETE); adding a generated column is DDL, not a row mutation, and the
-- trigger does not fire.
--
-- MIGRATION-RISK-ACCEPTED: audit_log search column, one-time rewrite, run
-- off-hours. Adding a STORED generated column rewrites audit_log once under
-- ACCESS EXCLUSIVE, and the GIN index build takes SHARE on it; audit rows are
-- written by every till action, so schedule this deploy outside service.
-- The other indexes below are on the brand-new, empty allowlist table.
--
-- TIMEOUTS. The dispatcher sets statement_timeout = 8 s locally; the
-- `authenticated` role already carries statement_timeout = 8s in its role
-- config, which is the bound that actually applies to the statement in
-- flight (a GUC changed mid-statement binds the NEXT statement).
--
-- covered by packages/db/tests/assistant-wall.test.ts, assistant-catalog.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. audit_log.search_text — full text over the ledger
-- ---------------------------------------------------------------------------
-- jsonb_object_keys is not usable inside a generated column expression (it
-- is a set-returning function); this wrapper is IMMUTABLE by declaration —
-- the keys of a jsonb value never depend on anything but the value.
create or replace function app.jsonb_top_keys_text(p jsonb)
returns text
language sql immutable parallel safe set search_path = public as $jsonb_top_keys_text_0109$
  select case when p is null or jsonb_typeof(p) <> 'object' then ''
              else coalesce((select string_agg(k, ' ' order by k) from jsonb_object_keys(p) k), '')
         end;
$jsonb_top_keys_text_0109$;

comment on function app.jsonb_top_keys_text(jsonb) is
  '0109. The top-level keys of a jsonb object joined by spaces ('''' for anything else). IMMUTABLE so audit_log.search_text can be a stored generated column.';

-- A generated column's expression runs as the INSERTING role, so every role
-- that may write audit_log (app.write_audit's owner, the service role in the
-- test harness) must be able to execute this helper. It is IMMUTABLE, not
-- SECURITY DEFINER, reads nothing and can leak nothing: public execute is safe.
grant execute on function app.jsonb_top_keys_text(jsonb) to public;

alter table audit_log
  add column if not exists search_text tsvector
  generated always as (
    to_tsvector('simple',
      coalesce(action, '') || ' ' || coalesce(entity, '') || ' ' || coalesce(entity_id, '') || ' ' ||
      coalesce(reason_code, '') || ' ' ||
      app.jsonb_top_keys_text(before) || ' ' || app.jsonb_top_keys_text(after))
  ) stored;

comment on column audit_log.search_text is
  '0109. Generated: simple-config tsvector over action, entity, entity_id, reason_code and the top-level keys of before/after. Searched by app.assistant_audit_page(p_text). Never the values inside before/after.';

create index if not exists audit_log_search_text_idx on audit_log using gin (search_text);

-- ---------------------------------------------------------------------------
-- 2. app.assistant_readable_columns — what table_read may name
-- ---------------------------------------------------------------------------
create table if not exists app.assistant_readable_columns (
  table_name  text not null,
  column_name text not null,
  kind        text not null check (kind in ('table', 'view')),
  is_default  boolean not null default true,
  data_type   text,
  ordinal     int,
  note        text,
  primary key (table_name, column_name)
);

comment on table app.assistant_readable_columns is
  '0109. The allowlist app.assistant_table_read builds its SELECT from: every public table and view column except secrets (pin_hash, push tokens, *token*, *secret*, password*, *_hash of text type). is_default = false marks columns returned only when asked for by name (before/after, payload, idempotency keys, device ids, photo paths, any jsonb). Seeded by migration, never by the model.';
comment on column app.assistant_readable_columns.kind is 'table or view.';
comment on column app.assistant_readable_columns.is_default is 'Returned when p_columns is null. False for blobs and bookkeeping columns.';
comment on column app.assistant_readable_columns.data_type is 'information_schema data_type at seed time, for describe().';
comment on column app.assistant_readable_columns.ordinal is 'Column position at seed time; the default projection keeps table order.';
comment on column app.assistant_readable_columns.note is 'The column comment at seed time, for describe().';

alter table app.assistant_readable_columns enable row level security;
grant select on app.assistant_readable_columns to authenticated;
grant usage on schema app to authenticated;

create policy assistant_readable_columns_select_owner on app.assistant_readable_columns
  for select to authenticated using (app.is_staff('owner'));

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
   -- Secrets never enter the allowlist. The name patterns also match token
   -- COUNTERS (llm_usage.prompt_tokens, cafe_tables.token_version,
   -- venue_settings.table_token_ttl_minutes); a secret is text, a counter is
   -- a number, so numeric and boolean columns are kept.
   and not (
     (c.column_name in ('pin_hash', 'expo_push_token')
      or c.column_name like '%token%'
      or c.column_name like '%secret%'
      or c.column_name like 'password%'
      or c.column_name like '%\_hash')
     and c.data_type not in ('integer', 'bigint', 'smallint', 'numeric', 'boolean'))
on conflict (table_name, column_name) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Paging helper (definer-only)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_page(p_limit int, p_offset int, out o_limit int, out o_offset int)
language sql immutable parallel safe set search_path = public as $assistant_page_0109$
  select least(greatest(coalesce(p_limit, 50), 1), 500), greatest(coalesce(p_offset, 0), 0);
$assistant_page_0109$;

comment on function app.assistant_page(int, int) is
  '0109. Clamps a list tool''s page to 1..500 rows (default 50) and a non-negative offset.';

revoke all on function app.assistant_page(int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.assistant_bookings_list
-- ---------------------------------------------------------------------------
create or replace function app.assistant_bookings_list(
  p_from        date,
  p_to          date,
  p_court_id    uuid    default null,
  p_status      text    default null,
  p_customer_id uuid    default null,
  p_limit       int     default 50,
  p_offset      int     default 0,
  p_count_only  boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_bookings_list_0109$
declare
  v_b      record;
  v_status reservation_status;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_status is not null then
    begin
      v_status := p_status::reservation_status;
    exception when invalid_text_representation then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
    end;
  end if;
  select * into v_page from app.assistant_page(p_limit, p_offset);

  select count(*) into v_total
    from reservations r
   where r.kind = 'booking'
     and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
     and (p_court_id is null or r.court_id = p_court_id)
     and (v_status is null or r.status = v_status)
     and (p_customer_id is null or r.guest_id = p_customer_id);

  if p_count_only then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', v_total);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  x.id,
           'court_id',            x.court_id,
           'court_name_en',       c.name_en,
           'court_name_ar',       c.name_ar,
           'kind',                x.kind,
           'status',              x.status,
           'start_at',            x.start_at,
           'end_at',              x.end_at,
           'guest_id',            x.guest_id,
           'guest_name',          coalesce(x.guest_name, pr.full_name),
           'guest_phone',         coalesce(x.guest_phone, pr.phone),
           'players',             x.players,
           'price_iqd',           x.price_iqd,
           'source',              x.source,
           'series_id',           x.series_id,
           'created_by_staff_id', x.created_by_staff_id,
           'created_at',          x.created_at,
           'cancelled_at',        x.cancelled_at,
           'cancellation_reason', x.cancellation_reason
         ) order by x.start_at, x.id), '[]'::jsonb)
    into v_rows
    from (
      select r.*
        from reservations r
       where r.kind = 'booking'
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (p_court_id is null or r.court_id = p_court_id)
         and (v_status is null or r.status = v_status)
         and (p_customer_id is null or r.guest_id = p_customer_id)
       order by r.start_at, r.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join courts   c  on c.id  = x.court_id
    left join profiles pr on pr.id = x.guest_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_bookings_list_0109$;

comment on function app.assistant_bookings_list(date, date, uuid, text, uuid, int, int, boolean) is
  '0109. Owner-only (reached through app.assistant_run_tool). Bookings (kind = booking) whose start falls on a business day in [p_from, p_to], optional court / status / customer filters, ordered by start, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_bookings_list(date, date, uuid, text, uuid, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.assistant_tabs_list
-- ---------------------------------------------------------------------------
create or replace function app.assistant_tabs_list(
  p_from       date,
  p_to         date,
  p_status     text    default null,
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_count_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_tabs_list_0109$
declare
  v_b      record;
  v_status tab_status;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_status is not null then
    begin
      v_status := p_status::tab_status;
    exception when invalid_text_representation then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_status';
    end;
  end if;
  select * into v_page from app.assistant_page(p_limit, p_offset);

  select count(*) into v_total
    from tabs t
    join day_sessions ds on ds.id = t.day_session_id
   where ds.business_date between p_from and p_to
     and (v_status is null or t.status = v_status);

  if p_count_only then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', v_total);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                 x.id,
           'day_session_id',     x.day_session_id,
           'business_date',      x.business_date,
           'status',             x.status,
           'table_id',           x.table_id,
           'table_label',        ct.table_number,
           'reservation_id',     x.reservation_id,
           'label',              x.label,
           'opened_by_staff_id', x.opened_by_staff_id,
           'opened_by_name',     s.display_name,
           'subtotal_iqd',       x.subtotal_iqd,
           'tax_iqd',            x.tax_iqd,
           'discount_iqd',       x.discount_iqd,
           'court_iqd',          x.court_iqd,
           'total_iqd',          x.total_iqd,
           'opened_at',          x.opened_at,
           'settled_at',         x.settled_at
         ) order by x.opened_at, x.id), '[]'::jsonb)
    into v_rows
    from (
      select t.*, ds.business_date
        from tabs t
        join day_sessions ds on ds.id = t.day_session_id
       where ds.business_date between p_from and p_to
         and (v_status is null or t.status = v_status)
       order by t.opened_at, t.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join cafe_tables ct on ct.id = x.table_id
    left join staff       s  on s.id  = x.opened_by_staff_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_tabs_list_0109$;

comment on function app.assistant_tabs_list(date, date, text, int, int, boolean) is
  '0109. Owner-only (reached through app.assistant_run_tool). Tabs by the business date of their day session in [p_from, p_to], optional status, ordered by opening time, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_tabs_list(date, date, text, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.assistant_payments_list
-- ---------------------------------------------------------------------------
create or replace function app.assistant_payments_list(
  p_from       date,
  p_to         date,
  p_method     text    default null,
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_count_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_payments_list_0109$
declare
  v_b      record;
  v_method payment_method;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  if p_method is not null then
    begin
      v_method := p_method::payment_method;
    exception when invalid_text_representation then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_method';
    end;
  end if;
  select * into v_page from app.assistant_page(p_limit, p_offset);

  select count(*) into v_total
    from payments p
    join day_sessions ds on ds.id = p.day_session_id
   where ds.business_date between p_from and p_to
     and (v_method is null or p.method = v_method);

  if p_count_only then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', v_total);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',               x.id,
           'tab_id',           x.tab_id,
           'day_session_id',   x.day_session_id,
           'method',           x.method,
           'amount_iqd',       x.amount_iqd,
           'tendered_iqd',     x.tendered_iqd,
           'change_iqd',       x.change_iqd,
           'recorded_by',      x.recorded_by,
           'recorded_by_name', s.display_name,
           'created_at',       x.created_at,
           'refunded_iqd',     coalesce(rf.refunded_iqd, 0)
         ) order by x.created_at, x.id), '[]'::jsonb)
    into v_rows
    from (
      select p.*
        from payments p
        join day_sessions ds on ds.id = p.day_session_id
       where ds.business_date between p_from and p_to
         and (v_method is null or p.method = v_method)
       order by p.created_at, p.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join staff s on s.id = x.recorded_by
    left join lateral (
      select sum(r.amount_iqd) as refunded_iqd from refunds r where r.payment_id = x.id) rf on true;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_payments_list_0109$;

comment on function app.assistant_payments_list(date, date, text, int, int, boolean) is
  '0109. Owner-only (reached through app.assistant_run_tool). Payments by the business date of their day session in [p_from, p_to], optional method (cash/card), with the refunded total per payment, ordered by time, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_payments_list(date, date, text, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.assistant_break_history
-- ---------------------------------------------------------------------------
create or replace function app.assistant_break_history(
  p_from       date,
  p_to         date,
  p_staff_id   uuid    default null,
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_count_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_break_history_0109$
declare
  v_b     record;
  v_page  record;
  v_total bigint;
  v_rows  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  select * into v_page from app.assistant_page(p_limit, p_offset);

  select count(*) into v_total
    from staff_breaks b
   where b.business_date between p_from and p_to
     and (p_staff_id is null or b.staff_id = p_staff_id);

  if p_count_only then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', v_total);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              x.id,
           'staff_id',        x.staff_id,
           'staff_name',      s.display_name,
           'station_id',      x.station_id,
           'business_date',   x.business_date,
           'started_at',      x.started_at,
           'ended_at',        x.ended_at,
           'minutes',         round(extract(epoch from (coalesce(x.ended_at, now()) - x.started_at)) / 60)::int,
           'covered_by',      x.covered_by,
           'covered_by_name', c.display_name
         ) order by x.started_at, x.id), '[]'::jsonb)
    into v_rows
    from (
      select b.*
        from staff_breaks b
       where b.business_date between p_from and p_to
         and (p_staff_id is null or b.staff_id = p_staff_id)
       order by b.started_at, b.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join staff s on s.id = x.staff_id
    left join staff c on c.id = x.covered_by;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_break_history_0109$;

comment on function app.assistant_break_history(date, date, uuid, int, int, boolean) is
  '0109. Owner-only (reached through app.assistant_run_tool). Break rows (0105) by business date in [p_from, p_to], optional staff member, with minutes taken and who covered, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_break_history(date, date, uuid, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 8. app.assistant_audit_page — audit_log_page minus the blobs, plus text search
-- ---------------------------------------------------------------------------
create or replace function app.assistant_audit_page(
  p_from          timestamptz default null,
  p_to            timestamptz default null,
  p_actor_id      uuid        default null,
  p_action_prefix text        default null,
  p_text          text        default null,
  p_limit         int         default 50,
  p_offset        int         default 0,
  p_count_only    boolean     default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_audit_page_0109$
declare
  v_page  record;
  v_total bigint;
  v_rows  jsonb;
  v_q     tsquery;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  select * into v_page from app.assistant_page(p_limit, p_offset);
  if nullif(btrim(p_text), '') is not null then
    v_q := websearch_to_tsquery('simple', p_text);
  end if;

  select count(*) into v_total
    from audit_log l
   where (p_from is null or l.at >= p_from)
     and (p_to   is null or l.at <  p_to)
     and (p_actor_id is null or l.actor_id = p_actor_id or l.authorizer_id = p_actor_id)
     and (p_action_prefix is null or l.action like p_action_prefix || '%')
     and (v_q is null or l.search_text @@ v_q);

  if p_count_only then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', v_total);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',             x.id,
           'at',             x.at,
           'actorId',        x.actor_id,
           'actorRole',      x.actor_role,
           'actorName',      coalesce(sa.display_name, pa.full_name),
           'authorizerId',   x.authorizer_id,
           'authorizerName', su.display_name,
           'action',         x.action,
           'entity',         x.entity,
           'entityId',       x.entity_id,
           'reasonCode',     x.reason_code,
           'deviceId',       x.device_id,
           'changed_keys',   coalesce((
              select array_agg(k order by k)
                from (
                  select jsonb_object_keys(case when jsonb_typeof(x.before) = 'object' then x.before else '{}'::jsonb end) k
                  union
                  select jsonb_object_keys(case when jsonb_typeof(x.after)  = 'object' then x.after  else '{}'::jsonb end)
                ) ks
               where (x.before -> k) is distinct from (x.after -> k)), '{}'::text[])
         ) order by x.at desc, x.id desc), '[]'::jsonb)
    into v_rows
    from (
      select l.*
        from audit_log l
       where (p_from is null or l.at >= p_from)
         and (p_to   is null or l.at <  p_to)
         and (p_actor_id is null or l.actor_id = p_actor_id or l.authorizer_id = p_actor_id)
         and (p_action_prefix is null or l.action like p_action_prefix || '%')
         and (v_q is null or l.search_text @@ v_q)
       order by l.at desc, l.id desc
       limit v_page.o_limit offset v_page.o_offset) x
    left join staff    sa on sa.id = x.actor_id
    left join profiles pa on pa.id = x.actor_id
    left join staff    su on su.id = x.authorizer_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_audit_page_0109$;

comment on function app.assistant_audit_page(timestamptz, timestamptz, uuid, text, text, int, int, boolean) is
  '0109. Owner-only (reached through app.assistant_run_tool). app.audit_log_page''s row shape WITHOUT the before/after bodies, plus changed_keys (top-level keys whose value differs) and p_text full-text search over audit_log.search_text (websearch syntax, simple config). Paged 1..500, newest first.';

revoke all on function app.assistant_audit_page(timestamptz, timestamptz, uuid, text, text, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 9. app.assistant_settings_read
-- ---------------------------------------------------------------------------
create or replace function app.assistant_settings_read()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_settings_read_0109$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'venue',      (select to_jsonb(vs) from venue_settings vs limit 1),
    'cafe',       (select coalesce(jsonb_object_agg(cs.key, cs.value), '{}'::jsonb) from cafe_settings cs),
    'tax_groups', (select coalesce(jsonb_agg(to_jsonb(tg) order by tg.name_en), '[]'::jsonb) from tax_groups tg));
end $assistant_settings_read_0109$;

comment on function app.assistant_settings_read() is
  '0109. Owner-only (reached through app.assistant_run_tool). The whole venue_settings row, every cafe_settings key with its value, and the tax groups — the settings pages, read whole.';

revoke all on function app.assistant_settings_read() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 10. app.assistant_courts_and_rates
-- ---------------------------------------------------------------------------
create or replace function app.assistant_courts_and_rates()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_courts_and_rates_0109$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  return jsonb_build_object(
    'courts', (select coalesce(jsonb_agg(to_jsonb(c) order by c.sort_order, c.name_en), '[]'::jsonb) from courts c),
    'rate_rules', (
      select coalesce(jsonb_agg(
               to_jsonb(rr) || jsonb_build_object(
                 'court_name_en', c.name_en,
                 'prices', coalesce((
                   select jsonb_agg(jsonb_build_object('duration_min', p.duration_min, 'price_iqd', p.price_iqd)
                                    order by p.duration_min)
                     from rate_rule_prices p where p.rule_id = rr.id), '[]'::jsonb))
               order by rr.priority desc, rr.name), '[]'::jsonb)
        from rate_rules rr
        left join courts c on c.id = rr.court_id));
end $assistant_courts_and_rates_0109$;

comment on function app.assistant_courts_and_rates() is
  '0109. Owner-only (reached through app.assistant_run_tool). Every court row and every rate rule with its duration prices nested — the court settings pages, read whole.';

revoke all on function app.assistant_courts_and_rates() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 11. app.assistant_system_status
-- ---------------------------------------------------------------------------
create or replace function app.assistant_system_status()
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_system_status_0109$
declare
  v_stale   int;
  v_cron    jsonb := '[]'::jsonb;
  v_index_q bigint := null;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select heartbeat_stale_seconds into v_stale from venue_settings limit 1;

  -- 0110 creates the index queue; until then the depth is null, not an error.
  if to_regclass('public.assistant_index_queue') is not null then
    execute 'select count(*) from public.assistant_index_queue where claimed_at is null' into v_index_q;
  end if;

  -- pg_cron keeps its ledger in the cron schema, absent on some stacks.
  if to_regclass('cron.job_run_details') is not null then
    execute $cron$
      select coalesce(jsonb_agg(jsonb_build_object(
               'jobname', j.jobname, 'schedule', j.schedule,
               'last_run', d.start_time, 'status', d.status) order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (
          select r.start_time, r.status from cron.job_run_details r
           where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
    $cron$ into v_cron;
  end if;

  return jsonb_build_object(
    'venue_mode',  app.venue_mode(),
    'is_degraded', app.is_degraded(),
    'day_session', (select to_jsonb(ds) from day_sessions ds
                     where ds.status <> 'closed' order by ds.opened_at desc limit 1),
    'heartbeats',  (select coalesce(jsonb_agg(jsonb_build_object(
                       'device_id',    h.device_id,
                       'last_seen_at', h.last_seen_at,
                       'stale',        h.last_seen_at < now() - make_interval(secs => coalesce(v_stale, 45)),
                       'is_till',      h.is_till,
                       'queue_depth',  h.queue_depth,
                       'app_version',  h.app_version,
                       'staff_id',     h.staff_id,
                       'staff_name',   s.display_name) order by h.device_id), '[]'::jsonb)
                      from device_heartbeats h left join staff s on s.id = h.staff_id),
    'outbox', jsonb_build_object(
       'push_pending',    (select count(*) from notification_outbox where sent_at is null),
       'telegram_queued', (select count(*) from telegram_outbox where status = 'queued'),
       'index_queued',    v_index_q),
    'cron', v_cron,
    'server_time', now());
end $assistant_system_status_0109$;

comment on function app.assistant_system_status() is
  '0109. Owner-only (reached through app.assistant_run_tool). Right-now state of the system: venue mode and degraded flag, the open day session, every device heartbeat with a stale flag, outbox depths (push, Telegram, assistant index) and the last run of every cron job when the cron schema exists.';

revoke all on function app.assistant_system_status() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 12. app.assistant_table_read — any allowlisted table or view
-- ---------------------------------------------------------------------------
create or replace function app.assistant_table_read(
  p_table      text,
  p_columns    text[]  default null,
  p_filters    jsonb   default null,
  p_order      text    default null,
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_count_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_table_read_0109$
declare
  v_cols   text[];
  v_col    text;
  v_parts  text[] := '{}';
  v_where  text := '';
  v_order  text := '';
  v_ord    text[];
  v_key    text;
  v_val    jsonb;
  v_op     text;
  v_opv    jsonb;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
  v_list   text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The table: validated before it goes anywhere near format('%I').
  if p_table is null or not exists (
       select 1 from app.assistant_readable_columns rc where rc.table_name = p_table) then
    raise exception 'ASSISTANT_UNKNOWN_TABLE' using errcode = 'P0001',
      detail = coalesce(p_table, 'null'),
      hint   = 'a table or view listed in app.assistant_readable_columns';
  end if;

  -- The columns: the defaults, or every requested name checked one by one.
  if p_columns is null then
    select array_agg(rc.column_name order by rc.ordinal, rc.column_name) into v_cols
      from app.assistant_readable_columns rc
     where rc.table_name = p_table and rc.is_default;
  else
    foreach v_col in array p_columns loop
      if v_col is null or not exists (
           select 1 from app.assistant_readable_columns rc
            where rc.table_name = p_table and rc.column_name = v_col) then
        raise exception 'ASSISTANT_UNKNOWN_COLUMN' using errcode = 'P0001',
          detail = p_table || '.' || coalesce(v_col, 'null');
      end if;
    end loop;
    select array_agg(distinct c) into v_cols from unnest(p_columns) c;
  end if;
  if v_cols is null or cardinality(v_cols) = 0 then
    raise exception 'ASSISTANT_UNKNOWN_COLUMN' using errcode = 'P0001',
      detail = p_table || ': no default columns; name them in p_columns';
  end if;

  -- The filters: {"col": scalar} = eq; {"col": {"op": value}} with
  -- eq|neq|gt|gte|lt|lte|in|is_null; {"col": null} = is null; {"col": [..]} = in.
  if p_filters is not null then
    if jsonb_typeof(p_filters) <> 'object' then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_filters',
        hint = '{"column": value} or {"column": {"op": value}}';
    end if;
    for v_key, v_val in select * from jsonb_each(p_filters) loop
      if not exists (select 1 from app.assistant_readable_columns rc
                      where rc.table_name = p_table and rc.column_name = v_key) then
        raise exception 'ASSISTANT_UNKNOWN_COLUMN' using errcode = 'P0001',
          detail = p_table || '.' || v_key;
      end if;
      case jsonb_typeof(v_val)
        when 'null' then
          v_parts := v_parts || format('%I is null', v_key);
        when 'array' then
          v_parts := v_parts || app.assistant_in_list(v_key, v_val);
        when 'object' then
          for v_op, v_opv in select * from jsonb_each(v_val) loop
            case v_op
              when 'eq'  then v_parts := v_parts || format('%I = %L',  v_key, v_opv #>> '{}');
              when 'neq' then v_parts := v_parts || format('%I <> %L', v_key, v_opv #>> '{}');
              when 'gt'  then v_parts := v_parts || format('%I > %L',  v_key, v_opv #>> '{}');
              when 'gte' then v_parts := v_parts || format('%I >= %L', v_key, v_opv #>> '{}');
              when 'lt'  then v_parts := v_parts || format('%I < %L',  v_key, v_opv #>> '{}');
              when 'lte' then v_parts := v_parts || format('%I <= %L', v_key, v_opv #>> '{}');
              when 'in'  then
                if jsonb_typeof(v_opv) <> 'array' then
                  raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
                    detail = v_key || '.in', hint = 'an array of values';
                end if;
                v_parts := v_parts || app.assistant_in_list(v_key, v_opv);
              when 'is_null' then
                v_parts := v_parts || format(case when v_opv = 'false'::jsonb then '%I is not null' else '%I is null' end, v_key);
              else
                raise exception 'INVALID_ARGUMENT' using errcode = 'P0001',
                  detail = v_key || '.' || v_op,
                  hint   = 'eq, neq, gt, gte, lt, lte, in, is_null';
            end case;
          end loop;
        else
          v_parts := v_parts || format('%I = %L', v_key, v_val #>> '{}');
      end case;
    end loop;
    if cardinality(v_parts) > 0 then
      v_where := ' where ' || array_to_string(v_parts, ' and ');
    end if;
  end if;

  -- The order: "col" or "col desc".
  if nullif(btrim(p_order), '') is not null then
    v_ord := regexp_split_to_array(btrim(p_order), '\s+');
    if cardinality(v_ord) > 2
       or not exists (select 1 from app.assistant_readable_columns rc
                       where rc.table_name = p_table and rc.column_name = v_ord[1]) then
      raise exception 'ASSISTANT_UNKNOWN_COLUMN' using errcode = 'P0001',
        detail = p_table || '.' || v_ord[1];
    end if;
    if cardinality(v_ord) = 2 and lower(v_ord[2]) not in ('asc', 'desc') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_order',
        hint = '"column" or "column desc"';
    end if;
    v_order := format(' order by %I %s', v_ord[1], coalesce(lower(v_ord[2]), 'asc'));
  end if;

  select * into v_page from app.assistant_page(p_limit, p_offset);

  execute format('select count(*) from public.%I%s', p_table, v_where) into v_total;

  if p_count_only then
    return jsonb_build_object('rows', '[]'::jsonb, 'total', v_total, 'columns', to_jsonb(v_cols));
  end if;

  select string_agg(format('%I', c), ', ') into v_list from unnest(v_cols) c;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select %s from public.%I%s%s limit %s offset %s) x',
    v_list, p_table, v_where, v_order, v_page.o_limit, v_page.o_offset) into v_rows;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'columns', to_jsonb(v_cols),
                            'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_table_read_0109$;

comment on function app.assistant_table_read(text, text[], jsonb, text, int, int, boolean) is
  '0109. Owner-only (reached through app.assistant_run_tool). SELECT over any table or view in app.assistant_readable_columns; table, every column, every filter key and the order column are checked against the allowlist BEFORE format(''%I''); values go through format(''%L''). Unknown names raise ASSISTANT_UNKNOWN_TABLE / ASSISTANT_UNKNOWN_COLUMN. Default columns are is_default; paged 1..500.';

revoke all on function app.assistant_table_read(text, text[], jsonb, text, int, int, boolean) from public, anon, authenticated;

-- `col in (…)` from a jsonb array of scalars; an empty list matches nothing.
create or replace function app.assistant_in_list(p_col text, p_values jsonb)
returns text
language sql immutable parallel safe set search_path = public as $assistant_in_list_0109$
  select case when jsonb_array_length(p_values) = 0 then 'false'
              else format('%I in (%s)', p_col,
                          (select string_agg(format('%L', v), ', ') from jsonb_array_elements_text(p_values) v))
         end;
$assistant_in_list_0109$;

comment on function app.assistant_in_list(text, jsonb) is
  '0109. Builds the `col in (…)` fragment for app.assistant_table_read; the column name is validated by the caller, the values are %L literals.';

revoke all on function app.assistant_in_list(text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 13. app.assistant_stock_view — the five stock views by short name
-- ---------------------------------------------------------------------------
create or replace function app.assistant_stock_view(
  p_view   text,
  p_limit  int default 50,
  p_offset int default 0
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_stock_view_0109$
declare
  v_name  text;
  v_order text;
  v_page  record;
  v_total bigint;
  v_rows  jsonb;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  case p_view
    when 'on_hand'       then v_name := 'v_ingredient_on_hand'; v_order := 'name_en';
    when 'variance'      then v_name := 'v_variance_report';    v_order := 'period_end desc, name_en';
    when 'item_margin'   then v_name := 'v_item_margin';        v_order := 'margin_percent asc nulls last, item_name_en';
    when 'expiring_soon' then v_name := 'v_expiring_soon';      v_order := 'expiry_date, name_en';
    when 'expired'       then v_name := 'v_expired';            v_order := 'expiry_date, name_en';
    else
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_view',
        hint = 'on_hand, variance, item_margin, expiring_soon, expired';
  end case;
  select * into v_page from app.assistant_page(p_limit, p_offset);

  execute format('select count(*) from public.%I', v_name) into v_total;
  execute format(
    'select coalesce(jsonb_agg(to_jsonb(x)), ''[]''::jsonb) from (select * from public.%I order by %s limit %s offset %s) x',
    v_name, v_order, v_page.o_limit, v_page.o_offset) into v_rows;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'view', v_name,
                            'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_stock_view_0109$;

comment on function app.assistant_stock_view(text, int, int) is
  '0109. Owner-only (reached through app.assistant_run_tool). Pages one of the stock views by short name: on_hand (v_ingredient_on_hand), variance (v_variance_report), item_margin (v_item_margin), expiring_soon (v_expiring_soon), expired (v_expired).';

revoke all on function app.assistant_stock_view(text, int, int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 14. app.assistant_run_tool — THE dispatcher (plan §2.2)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_run_tool(p_tool text, p_args jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_run_tool_0109$
declare
  a           jsonb := coalesce(p_args, '{}'::jsonb);
  v_result    jsonb;
  v_path      text;                 -- the catalog's rows_path for this tool
  v_count     int;
  v_truncated boolean;
  v_scope     text;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- The wall. STABLE is a promise; this is the enforcement: from here to the
  -- end of the transaction any INSERT/UPDATE/DELETE/DDL reached through a
  -- dispatched RPC fails with 25006 read_only_sql_transaction.
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '8000', true);

  if jsonb_typeof(a) <> 'object' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_args', hint = 'an object of p_* keys';
  end if;

  case p_tool
    -- ── Money and headline ────────────────────────────────────────────────
    when 'panel_headline' then
      v_path := 'figures';
      v_result := app.panel_headline((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_compare', 'none'));
    when 'report_revenue' then
      v_path := 'rows';
      v_result := app.report_revenue((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     coalesce(a ->> 'p_group', 'day'), coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_compare' then
      v_result := app.report_compare(a ->> 'p_report', (a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                     a ->> 'p_compare', coalesce(a ->> 'p_group', 'day'),
                                     coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'report_drill' then
      -- The RPC's row array is 'transactions' (the catalog says 'rows'; the
      -- dispatcher follows the RPC so row_count is real, and the mismatch is
      -- reported to the catalog's owner).
      v_path := 'transactions';
      v_result := app.report_drill(a ->> 'p_figure', a ->> 'p_key', (a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'assistant_payments_list' then
      v_path := 'rows';
      v_result := app.assistant_payments_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_method',
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Cafe ──────────────────────────────────────────────────────────────
    when 'report_cafe' then
      v_result := app.report_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_daily_sales' then
      v_path := '$';
      v_result := app.analytics_daily_sales((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_sold_items' then
      v_path := '$';
      v_result := app.analytics_sold_items((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_best_sellers' then
      v_path := '$';
      v_result := app.analytics_best_sellers((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                             coalesce((a ->> 'p_limit')::int, 20), coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_item_margins' then
      v_result := app.analytics_item_margins((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_price_bands' then
      v_path := '$';
      v_result := app.analytics_price_bands((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a ->> 'p_basis', 'settled'));
    when 'analytics_hourly' then
      v_path := '$';
      v_result := app.analytics_hourly((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'analytics_bought_together' then
      v_path := '$';
      -- The RPC's basket scope is 'order' | 'tab'; anything else falls back to
      -- its default rather than failing the whole turn.
      v_scope := case when a ->> 'p_scope' in ('order', 'tab') then a ->> 'p_scope' else 'order' end;
      v_result := app.analytics_bought_together((a ->> 'p_from')::date, (a ->> 'p_to')::date,
                                                coalesce((a ->> 'p_min_support')::int, 3),
                                                coalesce((a ->> 'p_limit')::int, 30), v_scope);
    when 'analytics_menu_snapshot' then
      v_result := app.analytics_menu_snapshot();
    when 'assistant_tabs_list' then
      v_path := 'rows';
      v_result := app.assistant_tabs_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_status',
                                          (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Courts ────────────────────────────────────────────────────────────
    when 'report_courts' then
      v_result := app.report_courts((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'analytics_courts_summary' then
      v_result := app.analytics_courts_summary((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_demand' then
      v_result := app.analytics_courts_demand((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_endings' then
      v_result := app.analytics_courts_endings((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_guests' then
      v_result := app.analytics_courts_guests((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'analytics_courts_cafe' then
      v_result := app.analytics_courts_cafe((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid);
    when 'assistant_bookings_list' then
      v_path := 'rows';
      v_result := app.assistant_bookings_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid,
                                              a ->> 'p_status', (a ->> 'p_customer_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);
    when 'booking_bill' then
      v_result := app.booking_bill((a ->> 'p_reservation_id')::uuid);
    when 'series_detail' then
      v_result := app.series_detail((a ->> 'p_series_id')::uuid);
    when 'assistant_courts_and_rates' then
      v_result := app.assistant_courts_and_rates();

    -- ── Stock ─────────────────────────────────────────────────────────────
    when 'report_stock' then
      v_result := app.report_stock((a ->> 'p_from')::date, (a ->> 'p_to')::date, coalesce(a -> 'p_filters', '{}'::jsonb));
    when 'assistant_stock_view' then
      v_path := 'rows';
      v_result := app.assistant_stock_view(a ->> 'p_view', (a ->> 'p_limit')::int, (a ->> 'p_offset')::int);

    -- ── Staff and ops ─────────────────────────────────────────────────────
    when 'ops_overview' then
      v_result := app.ops_overview();
    when 'list_staff' then
      v_path := '$';
      select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) into v_result from app.list_staff() s;
    when 'staff_requests_page' then
      v_path := 'requests';   -- the RPC returns {requests, total, pending}; the catalog says the same
      v_result := app.staff_requests_page(a ->> 'p_status', coalesce((a ->> 'p_limit')::int, 50),
                                          coalesce((a ->> 'p_offset')::int, 0));
    when 'report_staff_activity' then
      v_path := 'rows';
      v_result := app.report_staff_activity((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid);
    when 'assistant_break_history' then
      v_path := 'rows';
      v_result := app.assistant_break_history((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid,
                                              (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Audit ─────────────────────────────────────────────────────────────
    when 'assistant_audit_page' then
      v_path := 'rows';
      v_result := app.assistant_audit_page((a ->> 'p_from')::timestamptz, (a ->> 'p_to')::timestamptz,
                                           (a ->> 'p_actor_id')::uuid, a ->> 'p_action_prefix', a ->> 'p_text',
                                           (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Customers ─────────────────────────────────────────────────────────
    when 'customer_search' then
      v_path := '$';
      select coalesce(jsonb_agg(x), '[]'::jsonb) into v_result
        from app.customer_search(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 12)) x;
    when 'customer_record' then
      v_result := app.customer_record((a ->> 'p_customer_id')::uuid);

    -- ── Marketing ─────────────────────────────────────────────────────────
    when 'analytics_promo' then
      v_result := app.analytics_promo((a ->> 'p_from')::date, (a ->> 'p_to')::date);
    when 'marketing_overview' then
      v_result := app.marketing_overview();
    when 'marketing_campaign_performance' then
      v_result := app.marketing_campaign_performance((a ->> 'p_campaign')::uuid);

    -- ── Settings, system, any table ───────────────────────────────────────
    when 'assistant_settings_read' then
      v_result := app.assistant_settings_read();
    when 'assistant_system_status' then
      v_result := app.assistant_system_status();
    when 'assistant_table_read' then
      v_path := 'rows';
      v_result := app.assistant_table_read(
                    a ->> 'p_table',
                    case when a ? 'p_columns' and jsonb_typeof(a -> 'p_columns') = 'array'
                         then array(select jsonb_array_elements_text(a -> 'p_columns')) end,
                    a -> 'p_filters', a ->> 'p_order',
                    (a ->> 'p_limit')::int, (a ->> 'p_offset')::int, false);

    -- ── Meter (0111) ──────────────────────────────────────────────────────
    when 'assistant_usage' then
      v_path := 'days';
      v_result := app.assistant_usage((a ->> 'p_from')::date, (a ->> 'p_to')::date);

    else
      raise exception 'ASSISTANT_UNKNOWN_TOOL' using errcode = 'P0001', detail = coalesce(p_tool, 'null');
  end case;

  -- row_count: the length of the array rows_path points at, when known.
  v_count := case
               when v_path = '$' and jsonb_typeof(v_result) = 'array' then jsonb_array_length(v_result)
               when v_path is not null and v_path <> '$' and jsonb_typeof(v_result -> v_path) = 'array'
                 then jsonb_array_length(v_result -> v_path)
             end;
  -- truncated: a paged list whose total exceeds what this page returned.
  v_truncated := case
                   when v_count is not null and jsonb_typeof(v_result) = 'object' and (v_result ->> 'total') ~ '^\d+$'
                     then (v_result ->> 'total')::bigint > coalesce((v_result ->> 'offset')::bigint, coalesce((a ->> 'p_offset')::bigint, 0)) + v_count
                   else false
                 end;

  return jsonb_build_object('tool', p_tool, 'data', v_result, 'row_count', v_count, 'truncated', v_truncated);
end $assistant_run_tool_0109$;

comment on function app.assistant_run_tool(text, jsonb) is
  '0109. Owner-only. THE read-only wall for the assistant: turns transaction_read_only on, then dispatches over the fixed catalog of read RPC names (packages/core/src/assistant/tools.ts DISPATCHED_RPCS) with arguments pulled from p_args by p_* name. Unknown names raise ASSISTANT_UNKNOWN_TOOL. Returns {tool, data, row_count, truncated}. Called with the owner''s JWT by the assistant-chat edge function.';

revoke all on function app.assistant_run_tool(text, jsonb) from public, anon;
grant execute on function app.assistant_run_tool(text, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 15. app.assistant_count — how many rows would a list tool produce (plan §2.3)
-- ---------------------------------------------------------------------------
create or replace function app.assistant_count(p_tool text, p_args jsonb default '{}'::jsonb)
returns bigint
language plpgsql stable security definer set search_path = public as $assistant_count_0109$
declare
  a jsonb := coalesce(p_args, '{}'::jsonb);
  r jsonb;
  n bigint;
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('transaction_read_only', 'on', true);
  perform set_config('statement_timeout', '8000', true);

  -- p_tool is the CATALOG tool name (COUNTABLE_TOOL_NAMES), not the rpc name.
  case p_tool
    when 'bookings_list' then
      r := app.assistant_bookings_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_court_id')::uuid,
                                       a ->> 'p_status', (a ->> 'p_customer_id')::uuid, 1, 0, true);
      n := (r ->> 'total')::bigint;
    when 'tabs_list' then
      r := app.assistant_tabs_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_status', 1, 0, true);
      n := (r ->> 'total')::bigint;
    when 'payments_list' then
      r := app.assistant_payments_list((a ->> 'p_from')::date, (a ->> 'p_to')::date, a ->> 'p_method', 1, 0, true);
      n := (r ->> 'total')::bigint;
    when 'break_history' then
      r := app.assistant_break_history((a ->> 'p_from')::date, (a ->> 'p_to')::date, (a ->> 'p_staff_id')::uuid, 1, 0, true);
      n := (r ->> 'total')::bigint;
    when 'audit_page' then
      r := app.assistant_audit_page((a ->> 'p_from')::timestamptz, (a ->> 'p_to')::timestamptz, (a ->> 'p_actor_id')::uuid,
                                    a ->> 'p_action_prefix', a ->> 'p_text', 1, 0, true);
      n := (r ->> 'total')::bigint;
    when 'table_read' then
      r := app.assistant_table_read(a ->> 'p_table',
                                    case when a ? 'p_columns' and jsonb_typeof(a -> 'p_columns') = 'array'
                                         then array(select jsonb_array_elements_text(a -> 'p_columns')) end,
                                    a -> 'p_filters', null, 1, 0, true);
      n := (r ->> 'total')::bigint;
    when 'stock_view' then
      r := app.assistant_stock_view(a ->> 'p_view', 1, 0);
      n := (r ->> 'total')::bigint;
    -- The four list tools that wrap RPCs without a count flag: count what they return.
    when 'staff_requests_page' then
      r := app.staff_requests_page(a ->> 'p_status', 1, 0);
      n := (r ->> 'total')::bigint;
    when 'report_drill' then
      r := app.report_drill(a ->> 'p_figure', a ->> 'p_key', (a ->> 'p_from')::date, (a ->> 'p_to')::date);
      n := case when jsonb_typeof(r -> 'transactions') = 'array' then jsonb_array_length(r -> 'transactions') else 0 end;
    when 'list_staff' then
      select count(*) into n from app.list_staff();
    when 'customer_search' then
      select count(*) into n from app.customer_search(a ->> 'p_query', coalesce((a ->> 'p_limit')::int, 50));
    else
      raise exception 'ASSISTANT_NOT_COUNTABLE' using errcode = 'P0001', detail = coalesce(p_tool, 'null');
  end case;

  return coalesce(n, 0);
end $assistant_count_0109$;

comment on function app.assistant_count(text, jsonb) is
  '0109. Owner-only, read-only. The row count a list TOOL (catalog name: bookings_list, tabs_list, payments_list, break_history, audit_page, table_read, stock_view, staff_requests_page, report_drill, list_staff, customer_search) would produce for p_args — the estimator''s input before a job is priced. Others raise ASSISTANT_NOT_COUNTABLE.';

revoke all on function app.assistant_count(text, jsonb) from public, anon;
grant execute on function app.assistant_count(text, jsonb) to authenticated;
