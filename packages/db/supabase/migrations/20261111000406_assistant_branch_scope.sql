set lock_timeout = '3s';
set statement_timeout = '60s';

-- ===========================================================================
-- 0406 assistant_branch_scope — the assistant's list tools read the branches
-- in scope, by the rule the report tools use.
--
-- The assistant-chat edge function sends the branch the operator's rail shows
-- as x-venue-scope, so the owner's tools read that branch. The report and
-- analytics tools honour it (`venue_id = any(v_rv)`, v_rv :=
-- app.report_venues(), 0219/0228). Six SECURITY DEFINER list tools had no
-- branch predicate, and RLS does not apply inside a definer body, so with one
-- branch selected one answer mixed that branch's report figures with
-- chain-wide rows. Each now reads only rows of app.report_venues():
--
--   * assistant_bookings_list  (0147) reservations.venue_id
--   * assistant_tabs_list      (0109) tabs.venue_id
--   * assistant_payments_list  (0109) payments.venue_id (as reports_figures, 0265)
--   * assistant_break_history  (0109) staff_breaks.venue_id
--   * assistant_audit_page     (0109) audit_log.venue_id (a chain-wide action
--     is filed at the branch app.current_venue_or_default() gave it when it
--     was written, and shows under that branch only)
--   * assistant_table_read     (0109) any table or view in
--     app.assistant_readable_columns that has a venue_id column, looked up in
--     the catalog at run time; `venue_id is null` stays in (promotions: NULL is
--     every branch, 0212); a table without venue_id is read as before.
--
-- app.report_venues() is the same set the reports read: with x-venue-scope =
-- a branch, that branch (a branch the caller may not read: none); 'all' or
-- 'all:<id>', every branch; no header and no station, the one open branch, or
-- every branch not closed when several are open. Each body is its latest
-- definition re-issued verbatim with only that predicate (and its variable)
-- added; signatures, STABLE, SECURITY DEFINER, search_path, the owner guard and
-- the revokes are unchanged. app.assistant_count counts through these same
-- bodies (p_count_only), so a job estimate counts what the tool returns.
--
-- covered by packages/db/tests/assistant-branch-scope.test.ts
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- 1. app.assistant_bookings_list — re-issued from
--    20260922000147_drop_reservation_players.sql:1334, + reservations.venue_id
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
language plpgsql stable security definer set search_path = public as $assistant_bookings_list_0406$
declare
  v_b      record;
  v_status reservation_status;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
  v_rv     uuid[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_rv := app.report_venues();  -- 0406: the branches in scope, as the reports read them
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
   where r.venue_id = any(v_rv)
     and r.kind = 'booking'
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
       where r.venue_id = any(v_rv)
         and r.kind = 'booking'
         and r.start_at >= v_b.ts_from and r.start_at < v_b.ts_to
         and (p_court_id is null or r.court_id = p_court_id)
         and (v_status is null or r.status = v_status)
         and (p_customer_id is null or r.guest_id = p_customer_id)
       order by r.start_at, r.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join courts   c  on c.id  = x.court_id
    left join profiles pr on pr.id = x.guest_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_bookings_list_0406$;

comment on function app.assistant_bookings_list(date, date, uuid, text, uuid, int, int, boolean) is
  '0109, 0406. Owner-only (reached through app.assistant_run_tool). Bookings (kind = booking) of the branches in app.report_venues() whose start falls on a business day in [p_from, p_to], optional court / status / customer filters, ordered by start, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_bookings_list(date, date, uuid, text, uuid, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. app.assistant_tabs_list — re-issued from
--    20260920000109_assistant_dispatcher.sql:253, + tabs.venue_id
-- ---------------------------------------------------------------------------
create or replace function app.assistant_tabs_list(
  p_from       date,
  p_to         date,
  p_status     text    default null,
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_count_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_tabs_list_0406$
declare
  v_b      record;
  v_status tab_status;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
  v_rv     uuid[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_rv := app.report_venues();  -- 0406: the branches in scope, as the reports read them
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
   where t.venue_id = any(v_rv)
     and ds.business_date between p_from and p_to
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
       where t.venue_id = any(v_rv)
         and ds.business_date between p_from and p_to
         and (v_status is null or t.status = v_status)
       order by t.opened_at, t.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join cafe_tables ct on ct.id = x.table_id
    left join staff       s  on s.id  = x.opened_by_staff_id;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_tabs_list_0406$;

comment on function app.assistant_tabs_list(date, date, text, int, int, boolean) is
  '0109, 0406. Owner-only (reached through app.assistant_run_tool). Tabs of the branches in app.report_venues() by the business date of their day session in [p_from, p_to], optional status, ordered by opening time, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_tabs_list(date, date, text, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. app.assistant_payments_list — re-issued from
--    20260920000109_assistant_dispatcher.sql:334, + payments.venue_id
-- ---------------------------------------------------------------------------
create or replace function app.assistant_payments_list(
  p_from       date,
  p_to         date,
  p_method     text    default null,
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_count_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_payments_list_0406$
declare
  v_b      record;
  v_method payment_method;
  v_page   record;
  v_total  bigint;
  v_rows   jsonb;
  v_rv     uuid[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_rv := app.report_venues();  -- 0406: the branches in scope, as the reports read them
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
   where p.venue_id = any(v_rv)
     and ds.business_date between p_from and p_to
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
       where p.venue_id = any(v_rv)
         and ds.business_date between p_from and p_to
         and (v_method is null or p.method = v_method)
       order by p.created_at, p.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join staff s on s.id = x.recorded_by
    left join lateral (
      select sum(r.amount_iqd) as refunded_iqd from refunds r where r.payment_id = x.id) rf on true;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_payments_list_0406$;

comment on function app.assistant_payments_list(date, date, text, int, int, boolean) is
  '0109, 0406. Owner-only (reached through app.assistant_run_tool). Payments of the branches in app.report_venues() by the business date of their day session in [p_from, p_to], optional method (cash/card), with the refunded total per payment, ordered by time, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_payments_list(date, date, text, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.assistant_break_history — re-issued from
--    20260920000109_assistant_dispatcher.sql:410, + staff_breaks.venue_id
-- ---------------------------------------------------------------------------
create or replace function app.assistant_break_history(
  p_from       date,
  p_to         date,
  p_staff_id   uuid    default null,
  p_limit      int     default 50,
  p_offset     int     default 0,
  p_count_only boolean default false
) returns jsonb
language plpgsql stable security definer set search_path = public as $assistant_break_history_0406$
declare
  v_b     record;
  v_page  record;
  v_total bigint;
  v_rows  jsonb;
  v_rv    uuid[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_rv := app.report_venues();  -- 0406: the branches in scope, as the reports read them
  select * into strict v_b from app.analytics_bounds(p_from, p_to);
  select * into v_page from app.assistant_page(p_limit, p_offset);

  select count(*) into v_total
    from staff_breaks b
   where b.venue_id = any(v_rv)
     and b.business_date between p_from and p_to
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
       where b.venue_id = any(v_rv)
         and b.business_date between p_from and p_to
         and (p_staff_id is null or b.staff_id = p_staff_id)
       order by b.started_at, b.id
       limit v_page.o_limit offset v_page.o_offset) x
    left join staff s on s.id = x.staff_id
    left join staff c on c.id = x.covered_by;

  return jsonb_build_object('rows', v_rows, 'total', v_total, 'limit', v_page.o_limit, 'offset', v_page.o_offset);
end $assistant_break_history_0406$;

comment on function app.assistant_break_history(date, date, uuid, int, int, boolean) is
  '0109, 0406. Owner-only (reached through app.assistant_run_tool). Break rows (0105) of the branches in app.report_venues() by business date in [p_from, p_to], optional staff member, with minutes taken and who covered, paged 1..500. p_count_only returns only total.';

revoke all on function app.assistant_break_history(date, date, uuid, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.assistant_audit_page — re-issued from
--    20260920000109_assistant_dispatcher.sql:474, + audit_log.venue_id
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
language plpgsql stable security definer set search_path = public as $assistant_audit_page_0406$
declare
  v_page  record;
  v_total bigint;
  v_rows  jsonb;
  v_q     tsquery;
  v_rv    uuid[];
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_rv := app.report_venues();  -- 0406: the branches in scope, as the reports read them
  if p_from is not null and p_to is not null and p_to < p_from then
    raise exception 'INVALID_RANGE' using errcode = 'P0001';
  end if;
  select * into v_page from app.assistant_page(p_limit, p_offset);
  if nullif(btrim(p_text), '') is not null then
    v_q := websearch_to_tsquery('simple', p_text);
  end if;

  select count(*) into v_total
    from audit_log l
   where l.venue_id = any(v_rv)
     and (p_from is null or l.at >= p_from)
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
       where l.venue_id = any(v_rv)
         and (p_from is null or l.at >= p_from)
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
end $assistant_audit_page_0406$;

comment on function app.assistant_audit_page(timestamptz, timestamptz, uuid, text, text, int, int, boolean) is
  '0109, 0406. Owner-only (reached through app.assistant_run_tool). The audit rows of the branches in app.report_venues(), in app.audit_log_page''s row shape WITHOUT the before/after bodies, plus changed_keys (top-level keys whose value differs) and p_text full-text search over audit_log.search_text (websearch syntax, simple config). Paged 1..500, newest first.';

revoke all on function app.assistant_audit_page(timestamptz, timestamptz, uuid, text, text, int, int, boolean) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.assistant_table_read — re-issued from
--    20260920000109_assistant_dispatcher.sql:676, + venue_id where the
--    relation has one (catalog lookup at run time; NULL kept: every branch)
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
language plpgsql stable security definer set search_path = public as $assistant_table_read_0406$
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
  v_rv     uuid[];
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

  -- 0406: a relation with a venue_id column is read for the branches in scope
  -- only, as the reports read them (app.report_venues()). NULL stays in: on
  -- promotions it means every branch (0212); elsewhere the column is NOT NULL.
  -- p_table is already validated against the allowlist; the identifier goes
  -- through %I and the branch list through %L.
  if exists (select 1 from pg_attribute a
              where a.attrelid = to_regclass(format('public.%I', p_table))
                and a.attname = 'venue_id' and a.attnum > 0 and not a.attisdropped) then
    v_rv := app.report_venues();
    v_parts := v_parts || format('(%I is null or %I = any(%L::uuid[]))', 'venue_id', 'venue_id', v_rv);
    v_where := ' where ' || array_to_string(v_parts, ' and ');
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
end $assistant_table_read_0406$;

comment on function app.assistant_table_read(text, text[], jsonb, text, int, int, boolean) is
  '0109, 0406. Owner-only (reached through app.assistant_run_tool). SELECT over any table or view in app.assistant_readable_columns; a relation with a venue_id column returns only rows of the branches in app.report_venues() (or venue_id NULL, every branch); table, every column, every filter key and the order column are checked against the allowlist BEFORE format(''%I''); values go through format(''%L''). Unknown names raise ASSISTANT_UNKNOWN_TABLE / ASSISTANT_UNKNOWN_COLUMN. Default columns are is_default; paged 1..500.';

revoke all on function app.assistant_table_read(text, text[], jsonb, text, int, int, boolean) from public, anon, authenticated;
