-- 0240 scan_hardening — scanned paper (0236–0239), hardened after the
-- 2026-09-27 audit. Nothing new for staff to learn; the flow is the same.
--
--   1. scan_reads: every reading a person asked for. A paper is read at most
--      three times (SCAN_REREAD_LIMIT) and staff below MGMT ask for at most
--      100 readings a rolling day (SCAN_USER_DAILY_LIMIT), so one phone cannot
--      spend the chain's LLM budget, which the owner's assistant shares. A
--      reading that tried nothing (no model, the budget spent) is given back.
--   2. A lease: *_begin_reading returns reading_token (the scan_reads row);
--      *_store_reading and *_fail_reading refuse any other token
--      (READING_SUPERSEDED), so a stalled reading that answers after it was
--      taken over cannot overwrite the new one.
--   3. Nothing stays "reading": app.scan_sweep_stale (every minute,
--      tp_scan_sweep) ends a reading older than three minutes with
--      READ_ABANDONED. A reading that ends without lines on a paper that
--      already had some goes back to read (the old lines stay usable) rather
--      than hiding them behind "failed". The detail RPCs return
--      reading_started_at and server_now, so the screens know the deadline
--      without trusting the station's clock.
--   4. Stored readings are type-checked here too (a non-numeric quantity, a
--      date that is not a day, an unknown flag, a table number too long for
--      bigint): dropped, never a raw 22P02 that fails the whole reading.
--   5. send_order_slip: two cashiers sending to one empty table no longer
--      open two tabs (an advisory lock per table); a table with several open
--      tabs and none named is TAB_AMBIGUOUS, not silently a new tab; another
--      branch's tab or table is VENUE_MISMATCH up front. A cashier's send
--      teaches new wordings but never re-points one the branch already knows
--      (a manager's send may; every re-point is audited: menu_alias.repoint).
--   6. confirm_receipt: with no supplier chosen and no name typed, the
--      delivery keeps the supplier guessed from the reading; alias re-points
--      are audited (ingredient_alias.repoint).
--   7. Evidence: the photo behind a supplier receipt or an order slip cannot
--      be deleted from storage by a manager (staff_media_delete, as incidents).
--      Retention: unclaimed receipts/slips slots go after a day with the
--      other orphans; photos of papers set aside go after 30 days, of sent
--      slips after 90 days; a confirmed receipt's photo is kept (it backs a
--      delivery). All through the existing orphan purge (protocol-action).
--   8. The uploader's own read rules (tables, detail RPCs) need them to be
--      active staff still at that branch.
--   9. slips_to_send reads through its index (two arms, not an OR over a
--      coalesce), plus the indexes the scan queries and cascades use.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on small tables created three
-- migrations ago (0236/0238: supplier_receipts, order_slips and their lines
-- and aliases, all young) and on the new scan_reads.
--
-- covered by packages/db/tests/scan-hardening.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. scan_reads and the lease column.
-- ---------------------------------------------------------------------------
create table if not exists scan_reads (
  id           uuid primary key default gen_random_uuid(),
  venue_id     uuid not null references venues(id),
  kind         text not null check (kind in ('receipt','order_slip')),
  paper_id     uuid not null,
  requested_by uuid references staff(id) on delete set null,
  created_at   timestamptz not null default now()
);

comment on table scan_reads is
  'scan_hardening (0240): one reading of a scanned paper (supplier receipt or order slip) a person asked for, written by *_begin_reading and removed again when the reading tried nothing. Its id is the reading''s lease token. Counts the per-paper and per-person limits. Service role only.';
comment on column scan_reads.id is 'The reading, and its lease token (supplier_receipts / order_slips.reading_token).';
comment on column scan_reads.venue_id is 'The paper''s branch.';
comment on column scan_reads.kind is 'receipt (supplier_receipts) or order_slip (order_slips).';
comment on column scan_reads.paper_id is 'The receipt or slip read.';
comment on column scan_reads.requested_by is 'Who asked for it (the edge function''s caller).';
comment on column scan_reads.created_at is 'When it started.';

alter table scan_reads enable row level security;
grant all on scan_reads to service_role;

drop trigger if exists zz_branch_guard on public.scan_reads;
create trigger zz_branch_guard before insert or update or delete on public.scan_reads
  for each row execute function app.trg_branch_guard('scoped');

alter table supplier_receipts add column if not exists reading_token uuid;
alter table order_slips       add column if not exists reading_token uuid;
comment on column supplier_receipts.reading_token is
  'scan_hardening (0240): the lease of the current or last reading (a scan_reads id); only it may store or end the reading.';
comment on column order_slips.reading_token is
  'scan_hardening (0240): the lease of the current or last reading (a scan_reads id); only it may store or end the reading.';

comment on column supplier_receipts.error_code is
  'Why the last reading did not produce lines: READER_NOT_CONFIGURED, UNREADABLE, UPSTREAM, TIMEOUT, RATE_LIMITED, NOT_CONFIGURED, TRUNCATED, LLM_MONTHLY_CAP, LLM_DAILY_QUOTA, INVALID_READING, PHOTO_MISSING, STORE_FAILED, READ_ABANDONED (0240). On a read receipt: why the last re-read failed (its lines are the earlier reading).';
comment on column supplier_receipt_lines.flags is
  'Checks the edge function raised on the reading: ARITHMETIC (qty x price is not the total), NO_PRICE, TOTAL_MISMATCH, UNCLEAR (the model was not sure: handwriting), SMALL_AMOUNT (a price under 250 IQD: thousands shorthand?), TRUNCATED (the last line kept; the paper had more). Unknown flags are dropped (0240).';

-- ---------------------------------------------------------------------------
-- 2. Indexes.
-- ---------------------------------------------------------------------------
create index if not exists scan_reads_paper_idx on scan_reads (paper_id);
create index if not exists scan_reads_requester_idx on scan_reads (requested_by, created_at);
create index if not exists supplier_receipts_uploader_idx on supplier_receipts (uploaded_by, created_at);
create index if not exists supplier_receipts_reading_idx on supplier_receipts (reading_started_at) where status = 'reading';
create index if not exists order_slips_reading_idx on order_slips (reading_started_at) where status = 'reading';
create index if not exists ingredient_aliases_ingredient_idx on ingredient_aliases (ingredient_id);
create index if not exists menu_aliases_variant_idx on menu_aliases (variant_id);
create index if not exists supplier_receipt_lines_ingredient_idx on supplier_receipt_lines (ingredient_id);
create index if not exists order_slip_lines_variant_idx on order_slip_lines (variant_id);

-- ---------------------------------------------------------------------------
-- 3. Internal helpers: a JSON number or nothing, a date or nothing, and the
--    per-paper / per-person limits that take a reading.
-- ---------------------------------------------------------------------------
create or replace function app.scan_num(p jsonb) returns numeric
language sql immutable set search_path = public as $scan_num_0240$
  select case when jsonb_typeof(p) = 'number' then (p #>> '{}')::numeric end
$scan_num_0240$;

comment on function app.scan_num(jsonb) is
  'scan_hardening (0240). Internal: a JSON number as numeric, NULL for anything else (a string, null, an object). Never raises.';

revoke all on function app.scan_num(jsonb) from public, anon, authenticated;

create or replace function app.scan_date(p text) returns date
language plpgsql immutable set search_path = public as $scan_date_0240$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then
    return null;
  end if;
  return p::date;
exception when others then
  return null;
end $scan_date_0240$;

comment on function app.scan_date(text) is
  'scan_hardening (0240). Internal: a YYYY-MM-DD that is a real day as a date, NULL for anything else. Never raises.';

revoke all on function app.scan_date(text) from public, anon, authenticated;

create or replace function app.scan_take_reading(
  p_kind         text,
  p_paper        uuid,
  p_venue        uuid,
  p_requested_by uuid
) returns uuid
language plpgsql security definer set search_path = public as $scan_take_reading_0240$
declare
  c_per_paper  constant int := 3;
  c_per_person constant int := 100;
  v_role staff_role;
  v_n    int;
  v_id   uuid;
begin
  select count(*) into v_n from scan_reads where paper_id = p_paper;
  if v_n >= c_per_paper then
    raise exception 'SCAN_REREAD_LIMIT' using errcode = 'P0001';
  end if;
  if p_requested_by is not null then
    select s.role into v_role from staff s where s.id = p_requested_by;
    if v_role is null or v_role not in ('manager','owner') then
      select count(*) into v_n
        from scan_reads
       where requested_by = p_requested_by and created_at > now() - interval '24 hours';
      if v_n >= c_per_person then
        raise exception 'SCAN_USER_DAILY_LIMIT' using errcode = 'P0001';
      end if;
    end if;
  end if;
  insert into scan_reads (venue_id, kind, paper_id, requested_by)
  values (p_venue, p_kind, p_paper, p_requested_by)
  returning id into v_id;
  return v_id;
end $scan_take_reading_0240$;

comment on function app.scan_take_reading(text, uuid, uuid, uuid) is
  'scan_hardening (0240). Internal: records one reading of a paper and returns its lease token. SCAN_REREAD_LIMIT when the paper was read three times already; SCAN_USER_DAILY_LIMIT when the person asking (not a manager or the owner) asked for 100 readings in the last 24 hours.';

revoke all on function app.scan_take_reading(text, uuid, uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. Begin: the limits and the lease. The one-argument forms are dropped;
--    receipt-scan passes who asked.
-- ---------------------------------------------------------------------------
drop function if exists app.receipt_begin_reading(uuid);

create or replace function app.receipt_begin_reading(p_id uuid, p_requested_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $receipt_begin_reading_0240$
declare
  v_r     supplier_receipts%rowtype;
  v_names jsonb;
  v_token uuid;
begin
  select * into v_r from supplier_receipts where id = p_id for update;
  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_r.status in ('confirmed','rejected') then
    raise exception 'RECEIPT_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_r.status = 'reading' and v_r.reading_started_at > now() - interval '3 minutes' then
    raise exception 'RECEIPT_BUSY' using errcode = 'P0001';
  end if;

  v_token := app.scan_take_reading('receipt', v_r.id, v_r.venue_id, p_requested_by);

  update supplier_receipts
     set status = 'reading', reading_started_at = now(), error_code = null, reading_token = v_token
   where id = p_id;

  -- The branch's supplier names help the model spell the header; at most 100.
  select coalesce(jsonb_agg(s.name order by s.name), '[]'::jsonb) into v_names
    from (select name from suppliers
           where venue_id = v_r.venue_id and is_active
           order by name limit 100) s;

  return jsonb_build_object('id', v_r.id, 'venue_id', v_r.venue_id,
                            'storage_path', v_r.storage_path, 'supplier_names', v_names,
                            'reading_token', v_token);
end $receipt_begin_reading_0240$;

comment on function app.receipt_begin_reading(uuid, uuid) is
  'receipt_scan (0237), re-issued by scan_hardening (0240). Service role (receipt-scan): takes a receipt for a reading (status reading) for p_requested_by and returns {id, venue_id, storage_path, supplier_names, reading_token}. RECEIPT_NOT_FOUND, RECEIPT_ALREADY_DONE (confirmed or rejected), RECEIPT_BUSY (another reading started less than three minutes ago), SCAN_REREAD_LIMIT, SCAN_USER_DAILY_LIMIT.';

revoke all on function app.receipt_begin_reading(uuid, uuid) from public, anon, authenticated;
grant execute on function app.receipt_begin_reading(uuid, uuid) to service_role;

drop function if exists app.slip_begin_reading(uuid);

create or replace function app.slip_begin_reading(p_id uuid, p_requested_by uuid default null)
returns jsonb
language plpgsql security definer set search_path = public as $slip_begin_reading_0240$
declare
  v_s     order_slips%rowtype;
  v_names jsonb;
  v_token uuid;
begin
  select * into v_s from order_slips where id = p_id for update;
  if not found then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_s.status in ('sent','rejected') then
    raise exception 'SLIP_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_s.status = 'reading' and v_s.reading_started_at > now() - interval '3 minutes' then
    raise exception 'SLIP_BUSY' using errcode = 'P0001';
  end if;

  v_token := app.scan_take_reading('order_slip', v_s.id, v_s.venue_id, p_requested_by);

  update order_slips
     set status = 'reading', reading_started_at = now(), error_code = null, reading_token = v_token
   where id = p_id;

  -- The cafe menu of the branch, "English / Arabic", at most 250 items.
  select coalesce(jsonb_agg(x.label order by x.sort_order, x.label), '[]'::jsonb) into v_names
    from (select mi.name_en || ' / ' || mi.name_ar as label, c.sort_order
            from menu_items mi
            join menu_categories c on c.id = mi.category_id
           where mi.venue_id = v_s.venue_id and mi.is_active
             and c.is_active and c.kind = 'cafe'
           order by c.sort_order, mi.sort_order
           limit 250) x;

  return jsonb_build_object('id', v_s.id, 'venue_id', v_s.venue_id,
                            'storage_path', v_s.storage_path, 'menu_names', v_names,
                            'reading_token', v_token);
end $slip_begin_reading_0240$;

comment on function app.slip_begin_reading(uuid, uuid) is
  'order_slip_rpcs (0239), re-issued by scan_hardening (0240). Service role (receipt-scan): takes a slip for a reading (status reading) for p_requested_by and returns {id, venue_id, storage_path, menu_names, reading_token} (the branch''s active cafe items, "English / Arabic", at most 250). SLIP_NOT_FOUND, SLIP_ALREADY_DONE (sent or rejected), SLIP_BUSY (another reading started less than three minutes ago), SCAN_REREAD_LIMIT, SCAN_USER_DAILY_LIMIT.';

revoke all on function app.slip_begin_reading(uuid, uuid) from public, anon, authenticated;
grant execute on function app.slip_begin_reading(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 5. Store: the lease, and every field type-checked.
-- ---------------------------------------------------------------------------
drop function if exists app.receipt_store_reading(uuid, jsonb, text);

create or replace function app.receipt_store_reading(
  p_id      uuid,
  p_reading jsonb,
  p_model   text,
  p_token   uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $receipt_store_reading_0240$
declare
  c_flags    constant text[] := array['ARITHMETIC','NO_PRICE','TOTAL_MISMATCH','UNCLEAR','SMALL_AMOUNT','TRUNCATED'];
  v_r        supplier_receipts%rowtype;
  v_line     jsonb;
  v_no       int := 0;
  v_text     text;
  v_qty      numeric;
  v_unit     numeric;
  v_ltot     numeric;
  v_total    numeric := app.scan_num(p_reading->'total_iqd');
  v_date     date := app.scan_date(p_reading->>'receipt_date');
  v_sname    text := left(nullif(btrim(coalesce(p_reading->>'supplier_name', '')), ''), 120);
  v_supplier uuid;
  v_matched  int;
begin
  select * into v_r from supplier_receipts where id = p_id for update;
  if not found then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_r.status <> 'reading' then
    raise exception 'RECEIPT_NOT_READING' using errcode = 'P0001';
  end if;
  if p_token is not null and v_r.reading_token is distinct from p_token then
    raise exception 'READING_SUPERSEDED' using errcode = 'P0001';
  end if;
  if p_reading is null or jsonb_typeof(p_reading) <> 'object'
     or jsonb_typeof(p_reading->'lines') is distinct from 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'reading';
  end if;

  delete from supplier_receipt_lines where receipt_id = p_id;

  for v_line in select e from jsonb_array_elements(p_reading->'lines') e limit 200 loop
    continue when jsonb_typeof(v_line) <> 'object';
    v_text := left(nullif(btrim(coalesce(v_line->>'text', '')), ''), 200);
    continue when v_text is null;
    v_no := v_no + 1;
    v_qty  := round(app.scan_num(v_line->'qty'), 3);
    v_unit := app.scan_num(v_line->'unit_price_iqd');
    v_ltot := app.scan_num(v_line->'line_total_iqd');
    insert into supplier_receipt_lines (receipt_id, line_no, text_read, qty_read, unit_read,
                                        unit_price_iqd_read, line_total_iqd_read, expiry_read, flags)
    values (p_id, v_no, v_text,
            case when v_qty > 0 and v_qty < 1000000000 then v_qty end,
            left(nullif(btrim(coalesce(v_line->>'unit', '')), ''), 20),
            case when v_unit between 0 and 10000000000 then round(v_unit)::bigint end,
            case when v_ltot between 0 and 10000000000 then round(v_ltot)::bigint end,
            app.scan_date(v_line->>'expiry_date'),
            coalesce((select array_agg(distinct f) from jsonb_array_elements_text(
                        case when jsonb_typeof(v_line->'flags') = 'array' then v_line->'flags' else '[]'::jsonb end) f
                       where f = any(c_flags)),
                     '{}'));
  end loop;

  -- The supplier, when the name read is close to one of the branch's.
  if v_sname is not null then
    select s.id into v_supplier
      from suppliers s
     where s.venue_id = v_r.venue_id and s.is_active
       and similarity(app.search_norm(s.name), app.search_norm(v_sname)) >= 0.5
     order by similarity(app.search_norm(s.name), app.search_norm(v_sname)) desc, s.id
     limit 1;
  end if;

  update supplier_receipts
     set status             = 'read',
         read_at            = now(),
         error_code         = null,
         model              = left(nullif(btrim(coalesce(p_model, '')), ''), 100),
         supplier_name_read = v_sname,
         supplier_id        = coalesce(v_supplier, supplier_id),
         receipt_date       = case when v_date <= current_date + 1 then v_date end,
         total_iqd_read     = case when v_total between 0 and 10000000000 then round(v_total)::bigint end
   where id = p_id;

  v_matched := app.match_receipt_lines(p_id);

  -- Logged at the receipt's branch (the service role has no station).
  perform set_config('app.venue_id', v_r.venue_id::text, true);
  perform app.write_audit('receipt.read', 'supplier_receipts', p_id::text, null,
                          jsonb_build_object('lines', v_no, 'matched', v_matched,
                                             'model', left(nullif(btrim(coalesce(p_model, '')), ''), 100)));
  return jsonb_build_object('id', p_id, 'lines', v_no, 'matched', v_matched);
end $receipt_store_reading_0240$;

comment on function app.receipt_store_reading(uuid, jsonb, text, uuid) is
  'receipt_scan (0237), re-issued by scan_hardening (0240). Service role (receipt-scan): replaces a reading receipt''s lines with {supplier_name?, receipt_date?, total_iqd?, lines: [{text, qty?, unit?, unit_price_iqd?, line_total_iqd?, expiry_date?, flags?}]} (at most 200 lines; empty text skipped; a field of the wrong type, a date that is not a day, a receipt date after tomorrow and unknown flags are dropped), guesses the supplier from the name (similarity at least 0.5), matches the lines and sets status read. p_token is the lease from receipt_begin_reading. Returns {id, lines, matched}. RECEIPT_NOT_FOUND, RECEIPT_NOT_READING, READING_SUPERSEDED, INVALID_ARGUMENT (hint reading).';

revoke all on function app.receipt_store_reading(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function app.receipt_store_reading(uuid, jsonb, text, uuid) to service_role;

drop function if exists app.slip_store_reading(uuid, jsonb, text);

create or replace function app.slip_store_reading(
  p_id      uuid,
  p_reading jsonb,
  p_model   text,
  p_token   uuid default null
) returns jsonb
language plpgsql security definer set search_path = public, extensions as $slip_store_reading_0240$
declare
  c_flags   constant text[] := array['UNCLEAR','NO_QTY','TRUNCATED'];
  v_s       order_slips%rowtype;
  v_line    jsonb;
  v_no      int := 0;
  v_text    text;
  v_qty     numeric;
  v_table   text := left(nullif(btrim(coalesce(p_reading->>'table_number', '')), ''), 20);
  v_digits  text;
  v_tid     uuid;
  v_matched int;
begin
  select * into v_s from order_slips where id = p_id for update;
  if not found then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v_s.status <> 'reading' then
    raise exception 'SLIP_NOT_READING' using errcode = 'P0001';
  end if;
  if p_token is not null and v_s.reading_token is distinct from p_token then
    raise exception 'READING_SUPERSEDED' using errcode = 'P0001';
  end if;
  if p_reading is null or jsonb_typeof(p_reading) <> 'object'
     or jsonb_typeof(p_reading->'lines') is distinct from 'array' then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'reading';
  end if;

  delete from order_slip_lines where slip_id = p_id;

  for v_line in select e from jsonb_array_elements(p_reading->'lines') e limit 60 loop
    continue when jsonb_typeof(v_line) <> 'object';
    v_text := left(nullif(btrim(coalesce(v_line->>'text', '')), ''), 200);
    continue when v_text is null;
    v_no := v_no + 1;
    v_qty := app.scan_num(v_line->'qty');
    insert into order_slip_lines (slip_id, line_no, text_read, qty_read, notes_read, flags)
    values (p_id, v_no, v_text,
            case when v_qty between 1 and 99 and v_qty = trunc(v_qty) then v_qty::int end,
            left(nullif(btrim(coalesce(v_line->>'notes', '')), ''), 200),
            coalesce((select array_agg(distinct f) from jsonb_array_elements_text(
                        case when jsonb_typeof(v_line->'flags') = 'array' then v_line->'flags' else '[]'::jsonb end) f
                       where f = any(c_flags)),
                     '{}'));
  end loop;

  -- The table, when its number (digits only, "T5" -> 5, leading zeros
  -- ignored) is one of the branch's. Compared as text: no bigint to overflow.
  v_digits := nullif(ltrim(regexp_replace(coalesce(v_table, ''), '\D', '', 'g'), '0'), '');
  if v_digits is not null then
    select t.id into v_tid
      from cafe_tables t
     where t.venue_id = v_s.venue_id and t.is_active
       and ltrim(regexp_replace(t.table_number, '\D', '', 'g'), '0') = v_digits
     order by t.table_number, t.id
     limit 1;
  end if;

  update order_slips
     set status            = 'read',
         read_at           = now(),
         error_code        = null,
         model             = left(nullif(btrim(coalesce(p_model, '')), ''), 100),
         table_number_read = v_table,
         table_id          = coalesce(v_tid, table_id)
   where id = p_id;

  v_matched := app.match_slip_lines(p_id);

  perform set_config('app.venue_id', v_s.venue_id::text, true);
  perform app.write_audit('order_slip.read', 'order_slips', p_id::text, null,
                          jsonb_build_object('lines', v_no, 'matched', v_matched,
                                             'table', v_table,
                                             'model', left(nullif(btrim(coalesce(p_model, '')), ''), 100)));
  return jsonb_build_object('id', p_id, 'lines', v_no, 'matched', v_matched);
end $slip_store_reading_0240$;

comment on function app.slip_store_reading(uuid, jsonb, text, uuid) is
  'order_slip_rpcs (0239), re-issued by scan_hardening (0240). Service role (receipt-scan): replaces a reading slip''s lines with {table_number?, lines: [{text, qty?, notes?, flags?}]} (at most 60 lines; empty text skipped; qty a whole 1..99; unknown flags dropped), finds the branch''s active table whose number''s digits are the number read (leading zeros ignored), matches the lines and sets status read. p_token is the lease from slip_begin_reading. Returns {id, lines, matched}. SLIP_NOT_FOUND, SLIP_NOT_READING, READING_SUPERSEDED, INVALID_ARGUMENT (hint reading). Audit order_slip.read.';

revoke all on function app.slip_store_reading(uuid, jsonb, text, uuid) from public, anon, authenticated;
grant execute on function app.slip_store_reading(uuid, jsonb, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 6. Fail: the lease; nothing tried gives the reading back (it does not
--    count); a paper that had lines keeps them (status read, error_code says
--    what the last try did).
-- ---------------------------------------------------------------------------
drop function if exists app.receipt_fail_reading(uuid, text, text);

create or replace function app.receipt_fail_reading(
  p_id     uuid,
  p_code   text,
  p_status text default 'failed',
  p_token  uuid default null
) returns void
language plpgsql security definer set search_path = public as $receipt_fail_reading_0240$
declare
  v_venue uuid;
  v_new   text;
  v_code  text := left(coalesce(nullif(btrim(p_code), ''), 'UPSTREAM'), 60);
begin
  if p_status is null or p_status not in ('uploaded','failed') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'status';
  end if;
  update supplier_receipts
     set status = case when read_at is not null then 'read' else p_status end,
         error_code = v_code
   where id = p_id and status = 'reading'
     and (p_token is null or reading_token = p_token)
  returning venue_id, status into v_venue, v_new;
  if v_venue is not null then
    if p_status = 'uploaded' and p_token is not null then
      delete from scan_reads where id = p_token;
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
    perform app.write_audit('receipt.read_failed', 'supplier_receipts', p_id::text, null,
                            jsonb_build_object('code', v_code, 'status', v_new));
  end if;
end $receipt_fail_reading_0240$;

comment on function app.receipt_fail_reading(uuid, text, text, uuid) is
  'receipt_scan (0237), re-issued by scan_hardening (0240). Service role (receipt-scan): ends a reading that stored no lines, with a code (see supplier_receipts.error_code): uploaded when nothing was tried (no model, budget spent; the reading is not counted), failed when the model could not read it; a receipt read before goes back to read with its earlier lines. Only the reading holding p_token (when given) is ended; a receipt no longer reading is left alone. INVALID_ARGUMENT (hint status). Audit receipt.read_failed.';

revoke all on function app.receipt_fail_reading(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function app.receipt_fail_reading(uuid, text, text, uuid) to service_role;

drop function if exists app.slip_fail_reading(uuid, text, text);

create or replace function app.slip_fail_reading(
  p_id     uuid,
  p_code   text,
  p_status text default 'failed',
  p_token  uuid default null
) returns void
language plpgsql security definer set search_path = public as $slip_fail_reading_0240$
declare
  v_venue uuid;
  v_new   text;
  v_code  text := left(coalesce(nullif(btrim(p_code), ''), 'UPSTREAM'), 60);
begin
  if p_status is null or p_status not in ('uploaded','failed') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'status';
  end if;
  update order_slips
     set status = case when read_at is not null then 'read' else p_status end,
         error_code = v_code
   where id = p_id and status = 'reading'
     and (p_token is null or reading_token = p_token)
  returning venue_id, status into v_venue, v_new;
  if v_venue is not null then
    if p_status = 'uploaded' and p_token is not null then
      delete from scan_reads where id = p_token;
    end if;
    perform set_config('app.venue_id', v_venue::text, true);
    perform app.write_audit('order_slip.read_failed', 'order_slips', p_id::text, null,
                            jsonb_build_object('code', v_code, 'status', v_new));
  end if;
end $slip_fail_reading_0240$;

comment on function app.slip_fail_reading(uuid, text, text, uuid) is
  'order_slip_rpcs (0239), re-issued by scan_hardening (0240). Service role (receipt-scan): ends a reading that stored no lines, with a code: uploaded when nothing was tried (not counted), failed when the model could not read it; a slip read before goes back to read with its earlier lines. Only the reading holding p_token (when given) is ended; a slip no longer reading is left alone. INVALID_ARGUMENT (hint status). Audit order_slip.read_failed.';

revoke all on function app.slip_fail_reading(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function app.slip_fail_reading(uuid, text, text, uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 7. app.scan_sweep_stale — every minute (tp_scan_sweep): a reading older
--    than three minutes (the worker was killed, the store failed and so did
--    ending it) is ended with READ_ABANDONED.
-- ---------------------------------------------------------------------------
create or replace function app.scan_sweep_stale()
returns int
language plpgsql security definer set search_path = public as $scan_sweep_stale_0240$
declare
  v_row record;
  v_n   int := 0;
begin
  for v_row in
    update supplier_receipts
       set status = case when read_at is not null then 'read' else 'failed' end,
           error_code = 'READ_ABANDONED'
     where status = 'reading' and reading_started_at < now() - interval '3 minutes'
    returning id, venue_id, status
  loop
    v_n := v_n + 1;
    perform set_config('app.venue_id', v_row.venue_id::text, true);
    perform app.write_audit('receipt.read_failed', 'supplier_receipts', v_row.id::text, null,
                            jsonb_build_object('code', 'READ_ABANDONED', 'status', v_row.status));
  end loop;
  for v_row in
    update order_slips
       set status = case when read_at is not null then 'read' else 'failed' end,
           error_code = 'READ_ABANDONED'
     where status = 'reading' and reading_started_at < now() - interval '3 minutes'
    returning id, venue_id, status
  loop
    v_n := v_n + 1;
    perform set_config('app.venue_id', v_row.venue_id::text, true);
    perform app.write_audit('order_slip.read_failed', 'order_slips', v_row.id::text, null,
                            jsonb_build_object('code', 'READ_ABANDONED', 'status', v_row.status));
  end loop;
  return v_n;
end $scan_sweep_stale_0240$;

comment on function app.scan_sweep_stale() is
  'scan_hardening (0240). pg_cron every minute (tp_scan_sweep) and the service role: ends every reading of a supplier receipt or order slip that started more than three minutes ago with READ_ABANDONED (status read when it had lines before, else failed). Returns how many. Audit receipt.read_failed / order_slip.read_failed.';

revoke all on function app.scan_sweep_stale() from public, anon, authenticated;
grant execute on function app.scan_sweep_stale() to service_role;

do $scan_sweep_cron_0240$
begin
  begin
    create extension if not exists pg_cron;
  exception when others then
    raise notice 'pg_cron unavailable (%) - scan sweep skipped', sqlerrm;
  end;

  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    raise notice 'pg_cron absent - tp_scan_sweep not scheduled';
    return;
  end if;

  -- cron.schedule upserts by job name (0021).
  perform cron.schedule('tp_scan_sweep', '* * * * *', 'select app.scan_sweep_stale();');
end $scan_sweep_cron_0240$;

-- ---------------------------------------------------------------------------
-- 8. The detail RPCs: reading_started_at and server_now (the screens end
--    their wait at the same three minutes as the server, on the server's
--    clock); the uploader reads their own paper only while staff there.
-- ---------------------------------------------------------------------------
create or replace function app.receipt_detail(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $receipt_detail_0240$
declare
  v_r     supplier_receipts%rowtype;
  v_lines jsonb;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_r from supplier_receipts where id = p_id;
  if not found
     or not ((v_r.uploaded_by = auth.uid() and v_r.venue_id = any(app.staff_venue_ids()))
             or app.is_staff_at(v_r.venue_id, 'manager','owner')) then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                  l.id,
           'line_no',             l.line_no,
           'text_read',           l.text_read,
           'qty_read',            l.qty_read,
           'unit_read',           l.unit_read,
           'unit_price_iqd_read', l.unit_price_iqd_read,
           'line_total_iqd_read', l.line_total_iqd_read,
           'expiry_read',         l.expiry_read,
           'flags',               to_jsonb(l.flags),
           'ingredient_id',       l.ingredient_id,
           'match_source',        l.match_source,
           'confidence',          l.confidence,
           'name_en',             i.name_en,
           'name_ar',             i.name_ar,
           'unit',                i.unit,
           'pack_size',           i.pack_size,
           'kind',                i.kind)
         order by l.line_no), '[]'::jsonb)
    into v_lines
    from supplier_receipt_lines l
    left join ingredients i on i.id = l.ingredient_id
   where l.receipt_id = p_id;

  return jsonb_build_object(
    'id',                 v_r.id,
    'venue_id',           v_r.venue_id,
    'status',             v_r.status,
    'error_code',         v_r.error_code,
    'source',             v_r.source,
    'storage_path',       v_r.storage_path,
    'created_at',         v_r.created_at,
    'read_at',            v_r.read_at,
    'reading_started_at', v_r.reading_started_at,
    'server_now',         now(),
    'model',              v_r.model,
    'supplier_name_read', v_r.supplier_name_read,
    'supplier_id',        v_r.supplier_id,
    'receipt_date',       v_r.receipt_date,
    'total_iqd_read',     v_r.total_iqd_read,
    'delivery_id',        v_r.delivery_id,
    'lines',              v_lines);
end $receipt_detail_0240$;

comment on function app.receipt_detail(uuid) is
  'receipt_scan (0237), re-issued by scan_hardening (0240). MGMT at the receipt''s branch, or the staff member who filed it while still staff there: {id, venue_id, status, error_code, source, storage_path, created_at, read_at, reading_started_at, server_now (the database clock, for the three-minute reading deadline), model, supplier_name_read, supplier_id, receipt_date, total_iqd_read, delivery_id, lines: [{id, line_no, text_read, qty_read, unit_read, unit_price_iqd_read, line_total_iqd_read, expiry_read, flags, ingredient_id, match_source, confidence, name_en, name_ar, unit, pack_size, kind}]}. RECEIPT_NOT_FOUND for anyone else (and for an unknown id); FORBIDDEN for a caller who is not staff.';

revoke all on function app.receipt_detail(uuid) from public, anon;
grant execute on function app.receipt_detail(uuid) to authenticated;

create or replace function app.slip_detail(p_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $slip_detail_0240$
declare
  v_s     order_slips%rowtype;
  v_lines jsonb;
  v_tnum  text;
begin
  if app.staff_role() is null then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_s from order_slips where id = p_id;
  if not found
     or not ((v_s.uploaded_by = auth.uid() and v_s.venue_id = any(app.staff_venue_ids()))
             or app.is_staff_at(v_s.venue_id, 'cashier','manager','owner')) then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              l.id,
           'line_no',         l.line_no,
           'text_read',       l.text_read,
           'qty_read',        l.qty_read,
           'notes_read',      l.notes_read,
           'flags',           to_jsonb(l.flags),
           'variant_id',      l.variant_id,
           'match_source',    l.match_source,
           'confidence',      l.confidence,
           'item_id',         mi.id,
           'item_name_en',    mi.name_en,
           'item_name_ar',    mi.name_ar,
           'variant_name_en', v.name_en,
           'variant_name_ar', v.name_ar)
         order by l.line_no), '[]'::jsonb)
    into v_lines
    from order_slip_lines l
    left join menu_item_variants v on v.id = l.variant_id
    left join menu_items mi on mi.id = v.item_id
   where l.slip_id = p_id;

  select table_number into v_tnum from cafe_tables where id = v_s.table_id;

  return jsonb_build_object(
    'id',                v_s.id,
    'venue_id',          v_s.venue_id,
    'status',            v_s.status,
    'error_code',        v_s.error_code,
    'storage_path',      v_s.storage_path,
    'created_at',        v_s.created_at,
    'read_at',           v_s.read_at,
    'reading_started_at', v_s.reading_started_at,
    'server_now',        now(),
    'model',             v_s.model,
    'table_number_read', v_s.table_number_read,
    'table_id',          v_s.table_id,
    'table_number',      v_tnum,
    'tab_id',            v_s.tab_id,
    'order_id',          v_s.order_id,
    'sent_at',           v_s.sent_at,
    'rejected_reason',   v_s.rejected_reason,
    'lines',             v_lines);
end $slip_detail_0240$;

comment on function app.slip_detail(uuid) is
  'order_slip_rpcs (0239), re-issued by scan_hardening (0240). The cashier and MGMT at the slip''s branch, or the staff member who took it while still staff there: {id, venue_id, status, error_code, storage_path, created_at, read_at, reading_started_at, server_now (the database clock, for the three-minute reading deadline), model, table_number_read, table_id, table_number, tab_id, order_id, sent_at, rejected_reason, lines: [{id, line_no, text_read, qty_read, notes_read, flags, variant_id, match_source, confidence, item_id, item_name_en, item_name_ar, variant_name_en, variant_name_ar}]}. SLIP_NOT_FOUND for anyone else (and an unknown id); FORBIDDEN for a caller who is not staff.';

revoke all on function app.slip_detail(uuid) from public, anon;
grant execute on function app.slip_detail(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. confirm_receipt: the guessed supplier is kept when the manager named
--    none; alias re-points are audited.
-- ---------------------------------------------------------------------------
create or replace function app.confirm_receipt(
  p_id              uuid,
  p_lines           jsonb,
  p_supplier_id     uuid default null,
  p_supplier_name   text default null,
  p_location        text default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $confirm_receipt_0240$
declare
  c_uuid     constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_replay   jsonb;
  v_r        supplier_receipts%rowtype;
  v_loc      stock_location;
  v_sname    text := nullif(btrim(coalesce(p_supplier_name, '')), '');
  v_el       jsonb;
  v_lid      uuid;
  v_ing      uuid;
  v_line     supplier_receipt_lines%rowtype;
  v_seen     uuid[] := '{}';
  v_payload  jsonb := '[]'::jsonb;
  v_learn    jsonb := '[]'::jsonb;
  v_delivery jsonb;
  v_result   jsonb;
  v_alias    text;
  v_supplier uuid := p_supplier_id;
  v_prev     uuid;
begin
  if not app.is_staff('manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_loc := app.parse_stock_location(p_location, 'cafe');

  -- Claimed before the receipt's state is read (receive_purchase, 0200): a
  -- retry under the same key returns the first delivery; a new key finds the
  -- receipt confirmed.
  v_replay := app.claim_replay(p_idempotency_key, 'confirm_receipt');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_r from supplier_receipts where id = p_id for update;
  if not found or not (v_r.venue_id = any(app.staff_venue_ids())) then
    raise exception 'RECEIPT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_r.venue_id, 'manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- receive_delivery_internal's inserts and the branch guard read it.
  perform set_config('app.venue_id', v_r.venue_id::text, true);

  if v_r.status in ('confirmed','rejected') then
    raise exception 'RECEIPT_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_r.status = 'reading' and v_r.reading_started_at > now() - interval '3 minutes' then
    raise exception 'RECEIPT_BUSY' using errcode = 'P0001';
  end if;
  if length(v_sname) > 80 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'supplier_name';
  end if;
  if p_supplier_id is not null then
    select coalesce(v_sname, s.name) into v_sname
      from suppliers s where s.id = p_supplier_id and s.venue_id = v_r.venue_id;
    if not found then
      raise exception 'SUPPLIER_NOT_FOUND' using errcode = 'P0001';
    end if;
  elsif v_sname is null and v_r.supplier_id is not null then
    -- No supplier chosen and no name typed: the one guessed from the
    -- reading, so the delivery and the aliases keep it (0240).
    select s.id, s.name into v_supplier, v_sname
      from suppliers s where s.id = v_r.supplier_id and s.venue_id = v_r.venue_id;
  end if;

  if p_lines is null or jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'EMPTY_DELIVERY' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_lines) > 200 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
  end if;
  for v_el in select e from jsonb_array_elements(p_lines) e loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el->>'ingredient_id', '') !~ c_uuid then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
    end if;
    v_ing := (v_el->>'ingredient_id')::uuid;
    if v_el ? 'line_id' and v_el->>'line_id' is not null then
      if v_el->>'line_id' !~ c_uuid then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
      end if;
      v_lid := (v_el->>'line_id')::uuid;
      select * into v_line from supplier_receipt_lines where id = v_lid and receipt_id = v_r.id;
      if not found or v_lid = any(v_seen) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'lines';
      end if;
      v_seen := v_seen || v_lid;
      v_learn := v_learn || jsonb_build_array(jsonb_build_object(
                   'line_id', v_lid, 'ingredient_id', v_ing,
                   'manual', v_line.ingredient_id is distinct from v_ing));
    end if;
    v_payload := v_payload || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                   'ingredient_id', v_ing,
                   'qty_received',  v_el->'qty_received',
                   'unit_cost_iqd', v_el->'unit_cost_iqd',
                   'expiry_date',   v_el->'expiry_date',
                   'cost_source',   'entered')));
  end loop;

  v_delivery := app.receive_delivery_internal(v_r.venue_id, v_loc, v_payload, v_sname,
                                              'receipt ' || v_r.id::text, null, v_supplier, 'receipt');

  -- What the manager accepted becomes the line's match, and its wording an
  -- alias of that ingredient (this supplier's when one was chosen).
  for v_el in select e from jsonb_array_elements(v_learn) e loop
    v_lid := (v_el->>'line_id')::uuid;
    v_ing := (v_el->>'ingredient_id')::uuid;
    update supplier_receipt_lines
       set ingredient_id = v_ing,
           match_source  = case when (v_el->>'manual')::boolean then 'manual' else match_source end,
           confidence    = case when (v_el->>'manual')::boolean then null else confidence end
     where id = v_lid;
    select left(app.search_norm(text_read), 200) into v_alias
      from supplier_receipt_lines where id = v_lid;
    continue when coalesce(v_alias, '') = '';
    -- A wording that already meant another ingredient is re-pointed, and
    -- the re-point audited (0240): only managers confirm, so it is theirs.
    select a.ingredient_id into v_prev
      from ingredient_aliases a
     where a.venue_id = v_r.venue_id
       and coalesce(a.supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)
           = coalesce(v_supplier, '00000000-0000-0000-0000-000000000000'::uuid)
       and a.alias_norm = v_alias;
    insert into ingredient_aliases (venue_id, supplier_id, alias_norm, ingredient_id, created_by)
    values (v_r.venue_id, v_supplier, v_alias, v_ing, auth.uid())
    on conflict (venue_id, (coalesce(supplier_id, '00000000-0000-0000-0000-000000000000'::uuid)), alias_norm)
    do update set ingredient_id = excluded.ingredient_id,
                  uses          = case when ingredient_aliases.ingredient_id = excluded.ingredient_id
                                       then ingredient_aliases.uses + 1 else 1 end,
                  last_used_at  = now();
    if v_prev is not null and v_prev <> v_ing then
      perform app.write_audit('ingredient_alias.repoint', 'ingredient_aliases', v_alias,
                              jsonb_build_object('ingredient_id', v_prev, 'supplier_id', v_supplier),
                              jsonb_build_object('ingredient_id', v_ing, 'receipt_id', v_r.id));
    end if;
  end loop;

  update supplier_receipts
     set status       = 'confirmed',
         delivery_id  = (v_delivery->>'delivery_id')::uuid,
         confirmed_by = auth.uid(),
         confirmed_at = now(),
         supplier_id  = coalesce(v_supplier, supplier_id)
   where id = v_r.id;

  perform app.write_audit('receipt.confirm', 'supplier_receipts', v_r.id::text,
                          jsonb_build_object('status', v_r.status),
                          jsonb_build_object('status', 'confirmed',
                                             'delivery_id', v_delivery->>'delivery_id',
                                             'lines', jsonb_array_length(v_payload),
                                             'supplier_id', v_supplier,
                                             'location', v_loc));

  v_result := jsonb_build_object('receipt_id', v_r.id,
                                 'delivery_id', v_delivery->'delivery_id',
                                 'batch_ids', v_delivery->'batch_ids');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $confirm_receipt_0240$;

comment on function app.confirm_receipt(uuid, jsonb, uuid, text, text, text) is
  'receipt_scan (0237), re-issued by scan_hardening (0240). MGMT at the receipt''s branch: books the manager''s lines [{line_id?, ingredient_id, qty_received (base unit), unit_cost_iqd (per base unit), expiry_date?}] as ONE delivery (source receipt, into p_location, default cafe) through receive_delivery_internal, records each receipt line''s accepted ingredient (manual when the manager changed it) and learns its normalised wording as an alias (per supplier when one is given; a re-pointed wording is audited as ingredient_alias.repoint). With no supplier and no name given, the supplier guessed from the reading is kept. Returns {receipt_id, delivery_id, batch_ids}. Idempotent by key. RECEIPT_NOT_FOUND, RECEIPT_ALREADY_DONE, RECEIPT_BUSY, SUPPLIER_NOT_FOUND, TEXT_TOO_LONG (hint supplier_name), EMPTY_DELIVERY, INVALID_ARGUMENT (hint lines), and receive_delivery_internal''s STORE_BEING_COUNTED, INGREDIENT_NOT_FOUND, INVALID_LINE. Audit receipt.confirm.';

revoke all on function app.confirm_receipt(uuid, jsonb, uuid, text, text, text) from public, anon;
grant execute on function app.confirm_receipt(uuid, jsonb, uuid, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 10. send_order_slip: one new tab per empty table, TAB_AMBIGUOUS, another
--     branch refused up front, cashiers never re-point an alias.
-- ---------------------------------------------------------------------------
create or replace function app.send_order_slip(
  p_id              uuid,
  p_items           jsonb,
  p_tab_id          uuid default null,
  p_table_id        uuid default null,
  p_idempotency_key text default null,
  p_device_id       text default null
) returns jsonb
language plpgsql security definer set search_path = public as $send_order_slip_0240$
declare
  c_uuid    constant text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_replay  jsonb;
  v_s       order_slips%rowtype;
  v_el      jsonb;
  v_lid     uuid;
  v_vid     uuid;
  v_seen    uuid[] := '{}';
  v_items   jsonb := '[]'::jsonb;
  v_learn   jsonb := '[]'::jsonb;
  v_line    order_slip_lines%rowtype;
  v_tab     uuid := p_tab_id;
  v_tabs    uuid[];
  v_open    jsonb;
  v_order   jsonb;
  v_alias   text;
  v_result  jsonb;
  v_mgmt    boolean;
  v_prev    uuid;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  v_replay := app.claim_replay(p_idempotency_key, 'send_order_slip');
  if v_replay is not null then
    return v_replay;
  end if;

  select * into v_s from order_slips where id = p_id for update;
  if not found or not (v_s.venue_id = any(app.staff_venue_ids())) then
    raise exception 'SLIP_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not app.is_staff_at(v_s.venue_id, 'cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_s.venue_id::text, true);

  if v_s.status in ('sent','rejected') then
    raise exception 'SLIP_ALREADY_DONE' using errcode = 'P0001';
  end if;
  if v_s.status = 'reading' and v_s.reading_started_at > now() - interval '3 minutes' then
    raise exception 'SLIP_BUSY' using errcode = 'P0001';
  end if;

  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'EMPTY_ORDER' using errcode = 'P0001';
  end if;
  if jsonb_array_length(p_items) > 60 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
  end if;
  for v_el in select e from jsonb_array_elements(p_items) e loop
    if jsonb_typeof(v_el) <> 'object' or coalesce(v_el->>'variant_id', '') !~ c_uuid then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
    end if;
    v_vid := (v_el->>'variant_id')::uuid;
    if v_el ? 'line_id' and v_el->>'line_id' is not null then
      if v_el->>'line_id' !~ c_uuid then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
      end if;
      v_lid := (v_el->>'line_id')::uuid;
      select * into v_line from order_slip_lines where id = v_lid and slip_id = v_s.id;
      if not found or v_lid = any(v_seen) then
        raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'items';
      end if;
      v_seen := v_seen || v_lid;
      v_learn := v_learn || jsonb_build_array(jsonb_build_object(
                   'line_id', v_lid, 'variant_id', v_vid,
                   'manual', v_line.variant_id is distinct from v_vid));
    end if;
    -- The till's item shape (add_order_items): no price, ever.
    v_items := v_items || jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
                 'variant_id', v_vid,
                 'qty',        coalesce(v_el->'qty', '1'::jsonb),
                 'notes',      nullif(btrim(coalesce(v_el->>'notes', '')), ''),
                 'modifiers',  case when jsonb_typeof(v_el->'modifiers') = 'array'
                                    then v_el->'modifiers' else '[]'::jsonb end)));
  end loop;

  -- Another branch's tab or table is refused up front (0240), before a tab
  -- or an order is built and rolled back.
  if exists (select 1 from tabs t where t.id = p_tab_id and t.venue_id <> v_s.venue_id)
     or exists (select 1 from cafe_tables t where t.id = p_table_id and t.venue_id <> v_s.venue_id) then
    raise exception 'VENUE_MISMATCH' using errcode = 'P0001';
  end if;

  -- The tab: the one named; else the table's only open tab; else a new tab on
  -- the table, opened by the till's own app.open_tab. Several open tabs and
  -- none named: the cashier picks one (TAB_AMBIGUOUS, 0240). Two sends to one
  -- table wait for each other, so an empty table gets one new tab, not two.
  if v_tab is null then
    if p_table_id is null then
      raise exception 'TAB_ANCHOR_REQUIRED' using errcode = 'P0001';
    end if;
    perform pg_advisory_xact_lock(hashtextextended('send_order_slip:' || p_table_id::text, 0));
    select array_agg(t.id order by t.id) into v_tabs
      from tabs t
     where t.table_id = p_table_id and t.venue_id = v_s.venue_id and t.status = 'open';
    if cardinality(v_tabs) > 1 then
      raise exception 'TAB_AMBIGUOUS' using errcode = 'P0001';
    elsif cardinality(v_tabs) = 1 then
      v_tab := v_tabs[1];
    else
      v_open := app.open_tab(p_table_id, null, null,
                             case when p_idempotency_key is not null then p_idempotency_key || ':tab' end,
                             p_device_id);
      v_tab := (v_open->>'tab_id')::uuid;
    end if;
  end if;

  v_order := app.till_add_items(v_tab, v_items,
                                case when p_idempotency_key is not null then p_idempotency_key || ':order' end,
                                p_device_id);

  -- A cashier's send teaches a new wording but never re-points one the branch
  -- already knows (one wrong send would otherwise make every later slip say
  -- the wrong item at confidence 1); a manager's or the owner's may, and
  -- every re-point is audited (0240).
  v_mgmt := app.is_staff_at(v_s.venue_id, 'manager','owner');
  for v_el in select e from jsonb_array_elements(v_learn) e loop
    v_lid := (v_el->>'line_id')::uuid;
    v_vid := (v_el->>'variant_id')::uuid;
    update order_slip_lines
       set variant_id   = v_vid,
           match_source = case when (v_el->>'manual')::boolean then 'manual' else match_source end,
           confidence   = case when (v_el->>'manual')::boolean then null else confidence end
     where id = v_lid;
    select left(app.search_norm(text_read), 200) into v_alias from order_slip_lines where id = v_lid;
    continue when coalesce(v_alias, '') = '';
    select a.variant_id into v_prev
      from menu_aliases a
     where a.venue_id = v_s.venue_id and a.alias_norm = v_alias
       for update;
    if not found then
      insert into menu_aliases (venue_id, alias_norm, variant_id, created_by)
      values (v_s.venue_id, v_alias, v_vid, auth.uid())
      on conflict (venue_id, alias_norm) do nothing;
    elsif v_prev = v_vid then
      update menu_aliases set uses = uses + 1, last_used_at = now()
       where venue_id = v_s.venue_id and alias_norm = v_alias;
    elsif v_mgmt then
      update menu_aliases set variant_id = v_vid, uses = 1, created_by = auth.uid(), last_used_at = now()
       where venue_id = v_s.venue_id and alias_norm = v_alias;
      perform app.write_audit('menu_alias.repoint', 'menu_aliases', v_alias,
                              jsonb_build_object('variant_id', v_prev),
                              jsonb_build_object('variant_id', v_vid, 'slip_id', v_s.id),
                              null, null, p_device_id);
    end if;
  end loop;

  update order_slips
     set status   = 'sent',
         tab_id   = v_tab,
         order_id = (v_order->>'order_id')::uuid,
         table_id = coalesce((select t.table_id from tabs t where t.id = v_tab), table_id),
         sent_by  = auth.uid(),
         sent_at  = now()
   where id = v_s.id;

  perform app.write_audit('order_slip.send', 'order_slips', v_s.id::text,
                          jsonb_build_object('status', v_s.status),
                          jsonb_build_object('status', 'sent', 'tab_id', v_tab,
                                             'order_id', v_order->>'order_id',
                                             'items', jsonb_array_length(v_items)),
                          null, null, p_device_id);

  v_result := jsonb_build_object('slip_id', v_s.id, 'tab_id', v_tab,
                                 'order_id', v_order->'order_id', 'ticket_id', v_order->'ticket_id',
                                 'total_iqd', v_order->'total_iqd');
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $send_order_slip_0240$;

comment on function app.send_order_slip(uuid, jsonb, uuid, uuid, text, text) is
  'order_slip_rpcs (0239), re-issued by scan_hardening (0240). The cashier and MGMT at the slip''s branch: sends the cashier''s items [{line_id?, variant_id, qty, notes?, modifiers?: [{modifier_id, qty}]}] (at most 60) as ONE order through app.till_add_items onto p_tab_id, or onto p_table_id''s only open tab, or a new tab opened there with app.open_tab (sends to one table are serialised; several open tabs and none named is TAB_AMBIGUOUS; another branch''s tab or table is VENUE_MISMATCH); records each slip line''s accepted variant (manual when changed) and learns its wording as an alias (a cashier adds new wordings only; a manager or the owner may re-point one, audited as menu_alias.repoint); sets the slip sent with its tab and order. Returns {slip_id, tab_id, order_id, ticket_id, total_iqd}. Idempotent by key (the tab and the order take <key>:tab and <key>:order). SLIP_NOT_FOUND, SLIP_ALREADY_DONE, SLIP_BUSY, EMPTY_ORDER, INVALID_ARGUMENT (hint items), TAB_ANCHOR_REQUIRED, TAB_AMBIGUOUS, VENUE_MISMATCH, and everything open_tab and till_add_items raise (NO_OPEN_DAY, TABLE_NOT_FOUND, TAB_NOT_OPEN, VARIANT_NOT_FOUND, ITEM_UNAVAILABLE, MODIFIER_SELECTION, …). Audit order_slip.send.';

revoke all on function app.send_order_slip(uuid, jsonb, uuid, uuid, text, text) from public, anon;
grant execute on function app.send_order_slip(uuid, jsonb, uuid, uuid, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 11. slips_to_send: read through its index (two arms), not every slip the
--     branch ever had.
-- ---------------------------------------------------------------------------
create or replace function app.slips_to_send(p_venue_id uuid default null)
returns jsonb
language plpgsql stable security definer set search_path = public as $slips_to_send_0240$
declare
  v_venue uuid;
  v_items jsonb;
begin
  if not app.is_staff('cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if not app.is_staff_at(v_venue, 'cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',                x.id,
           'status',            x.status,
           'error_code',        x.error_code,
           'storage_path',      x.storage_path,
           'uploaded_by_name',  x.uploaded_by_name,
           'created_at',        x.created_at,
           'table_number_read', x.table_number_read,
           'table_id',          x.table_id,
           'table_number',      x.table_number,
           'line_count',        x.line_count,
           'matched_count',     x.matched_count,
           'tab_id',            x.tab_id,
           'order_id',          x.order_id,
           'sent_by_name',      x.sent_by_name,
           'sent_at',           x.sent_at)
         order by x.done, x.created_at desc, x.id), '[]'::jsonb)
    into v_items
    from (select s.id, s.status, s.error_code, s.storage_path, u.display_name as uploaded_by_name,
                 s.created_at, s.table_number_read, s.table_id, t.table_number, s.tab_id, s.order_id,
                 b.display_name as sent_by_name, s.sent_at,
                 s.status in ('sent','rejected') as done,
                 (select count(*) from order_slip_lines l where l.slip_id = s.id) as line_count,
                 (select count(*) from order_slip_lines l where l.slip_id = s.id and l.variant_id is not null) as matched_count
            -- Two arms, each through order_slips_venue_status_idx: every slip
            -- still to send, and the done ones filed in the last 36 hours that
            -- were sent or set aside in the last 12.
            from (select * from order_slips o
                   where o.venue_id = v_venue
                     and o.status in ('uploaded','reading','read','failed')
                  union all
                  select * from order_slips o
                   where o.venue_id = v_venue
                     and o.status in ('sent','rejected')
                     and o.created_at > now() - interval '36 hours'
                     and coalesce(o.sent_at, o.rejected_at) > now() - interval '12 hours') s
            left join staff u on u.id = s.uploaded_by
            left join staff b on b.id = s.sent_by
            left join cafe_tables t on t.id = s.table_id
           order by s.status in ('sent','rejected'), s.created_at desc, s.id
           limit 100) x;

  return jsonb_build_object('slips', v_items);
end $slips_to_send_0240$;

comment on function app.slips_to_send(uuid) is
  'order_slip_rpcs (0239), re-issued by scan_hardening (0240). The cashier and MGMT at the branch: {slips: [{id, status, error_code, storage_path, uploaded_by_name, created_at, table_number_read, table_id, table_number, line_count, matched_count, tab_id, order_id, sent_by_name, sent_at}]}, every slip still to send (newest first), then those filed in the last 36 hours and sent or set aside in the last 12; at most 100. FORBIDDEN for anyone else.';

revoke all on function app.slips_to_send(uuid) from public, anon;
grant execute on function app.slips_to_send(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 12. The uploader's own rows: only while active staff at that branch (a
--     driver who left or moved no longer reads supplier prices).
-- ---------------------------------------------------------------------------
drop policy if exists supplier_receipts_read_own on supplier_receipts;
create policy supplier_receipts_read_own on supplier_receipts
  for select to authenticated
  using (uploaded_by = (select auth.uid())
         and (select app.staff_role()) is not null
         and venue_id = any ((select app.staff_venue_ids())::uuid[]));

drop policy if exists supplier_receipt_lines_read on supplier_receipt_lines;
create policy supplier_receipt_lines_read on supplier_receipt_lines
  for select to authenticated
  using (exists (select 1 from supplier_receipts r
                  where r.id = supplier_receipt_lines.receipt_id
                    and ((r.uploaded_by = (select auth.uid())
                          and (select app.staff_role()) is not null
                          and r.venue_id = any ((select app.staff_venue_ids())::uuid[]))
                         or ((select app.is_staff('manager','owner'))
                             and r.venue_id = any ((select app.visible_venue_ids())::uuid[])))));

drop policy if exists order_slips_read_own on order_slips;
create policy order_slips_read_own on order_slips
  for select to authenticated
  using (uploaded_by = (select auth.uid())
         and (select app.staff_role()) is not null
         and venue_id = any ((select app.staff_venue_ids())::uuid[]));

drop policy if exists order_slip_lines_read on order_slip_lines;
create policy order_slip_lines_read on order_slip_lines
  for select to authenticated
  using (exists (select 1 from order_slips s
                  where s.id = order_slip_lines.slip_id
                    and ((s.uploaded_by = (select auth.uid())
                          and (select app.staff_role()) is not null
                          and s.venue_id = any ((select app.staff_venue_ids())::uuid[]))
                         or ((select app.is_staff('cashier','manager','owner'))
                             and s.venue_id = any ((select app.visible_venue_ids())::uuid[])))));

-- ---------------------------------------------------------------------------
-- 13. Evidence: a photo that backs a supplier receipt or an order slip is
--     not deletable from storage by a manager, like an incident's (0196).
--     Retention removes them on schedule instead (14).
-- ---------------------------------------------------------------------------
create or replace function app.staff_media_is_evidence(p_name text)
returns boolean
language sql stable security definer set search_path = public as $staff_media_is_evidence_0240$
  select coalesce(app.staff_media_folder(p_name) = 'incidents'
                  or exists (select 1 from staff_media_uploads u
                              where u.path = p_name
                                and u.used_by ~ '^(receipt|order_slip):'),
                  false)
$staff_media_is_evidence_0240$;

comment on function app.staff_media_is_evidence(text) is
  'scan_hardening (0240). True for a staff-media photo nobody may delete by hand: an incident''s (0196), or one claimed by a supplier receipt or an order slip (0236/0238). Never raises. The staff_media_delete storage policy evaluates it as the deleting role, hence the authenticated grant.';

revoke all on function app.staff_media_is_evidence(text) from public, anon;
grant execute on function app.staff_media_is_evidence(text) to authenticated, service_role;

do $storage_delete_0240$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage schema absent - skipping the staff_media_delete re-issue';
    return;
  end if;
  begin
    drop policy if exists staff_media_delete on storage.objects;
    create policy staff_media_delete on storage.objects
      for delete to authenticated
      using (bucket_id = 'staff-media'
             and (select app.is_staff('manager','owner'))
             and app.staff_media_venue(name) = any(app.staff_venue_ids())
             and not app.staff_media_is_evidence(name));
  exception when insufficient_privilege then
    raise notice 'cannot recreate staff_media_delete as % (%) - replace it via Dashboard > Storage > Policies with: bucket_id = ''staff-media'' and app.is_staff(''manager'',''owner'') and app.staff_media_venue(name) = any(app.staff_venue_ids()) and not app.staff_media_is_evidence(name)',
      current_user, sqlerrm;
  end;
end $storage_delete_0240$;

-- ---------------------------------------------------------------------------
-- 14. Retention, through the orphan purge protocol-action already runs:
--     unclaimed receipts/slips slots after a day; the photo of a paper set
--     aside after 30 days, of a sent slip after 90; a confirmed receipt's
--     photo is kept (it backs a delivery).
-- ---------------------------------------------------------------------------
create or replace function app.scan_photos_expired(p_limit int default 200)
returns setof text
language sql stable security definer set search_path = public as $scan_photos_expired_0240$
  select x.path
    from (select r.storage_path as path
            from supplier_receipts r
           where r.status = 'rejected' and r.rejected_at < now() - interval '30 days'
          union all
          select s.storage_path
            from order_slips s
           where (s.status = 'rejected' and s.rejected_at < now() - interval '30 days')
              or (s.status = 'sent' and s.sent_at < now() - interval '90 days')) x
   where exists (select 1 from staff_media_uploads u
                  where u.path = x.path and u.used_by is distinct from 'orphan_purge')
   limit greatest(coalesce(p_limit, 200), 1)
$scan_photos_expired_0240$;

comment on function app.scan_photos_expired(int) is
  'scan_hardening (0240). Internal: the staff-media paths of scanned papers past retention whose slot is not yet held for the purge: supplier receipts and order slips set aside more than 30 days ago, order slips sent more than 90 days ago. Confirmed receipts are kept. At most p_limit.';

revoke all on function app.scan_photos_expired(int) from public, anon, authenticated;

create or replace function app.staff_media_orphan_purge_due(p_limit int default 50)
returns jsonb
language plpgsql security definer set search_path = public as $staff_media_orphan_purge_due_0240$
declare
  v_paths jsonb;
begin
  -- SKIP LOCKED: a slot a recording RPC is claiming right now is its.
  with due as (
    select u.path
      from staff_media_uploads u
     where (u.used_by is null
            and u.folder in ('incidents', 'campaigns', 'receipts', 'slips')
            and u.created_at < now() - interval '1 day')
        or u.used_by = 'orphan_purge'
        or u.path in (select app.scan_photos_expired(p_limit))
     order by u.created_at, u.path
     limit greatest(coalesce(p_limit, 50), 1)
       for update skip locked
  ), held as (
    update staff_media_uploads u
       set used_at = coalesce(u.used_at, now()),
           used_by = 'orphan_purge'
      from due
     where u.path = due.path
    returning u.path, u.created_at
  )
  select coalesce(jsonb_agg(h.path order by h.created_at, h.path), '[]'::jsonb) into v_paths
    from held h;
  return v_paths;
end $staff_media_orphan_purge_due_0240$;

comment on function app.staff_media_orphan_purge_due(int) is
  'incident_reports (review 2026-09-26), re-issued by scan_hardening (0240). Service role: ["<path>", …], at most p_limit (default 50), oldest first: the incidents, campaigns, receipts and slips upload slots no record claimed within a day, the photos of scanned papers past retention (app.scan_photos_expired), and those held earlier whose objects are not gone yet. Each is marked used by ''orphan_purge'', so a late claim is PHOTO_PATH_INVALID. protocol-action removes the objects, then calls app.staff_media_orphans_purged.';

revoke all on function app.staff_media_orphan_purge_due(int) from public, anon, authenticated;
grant execute on function app.staff_media_orphan_purge_due(int) to service_role;

create or replace function app.protocol_tick_nudge()
returns void
language plpgsql security definer set search_path = public as $protocol_tick_nudge_0240$
declare
  v_base text;
  v_key  text;
begin
  begin
    if not exists (select 1 from protocol_runs r
                    where r.kind = 'product_release' and r.status = 'scheduled'
                      and r.scheduled_for <= now())
       and not exists (select 1 from protocol_runs r
                        where r.status in ('stopped', 'withdrawn')
                          and r.finished_at + interval '90 days' <= now()
                          and r.photos_purged_at is null)
       and not exists (select 1 from incident_reports i
                        where i.purge_after <= now()
                          and i.photos_purged_at is null
                          and cardinality(i.photos) > 0)
       and not exists (select 1 from staff_media_uploads u
                        where (u.used_by is null
                               and u.folder in ('incidents', 'campaigns', 'receipts', 'slips')
                               and u.created_at < now() - interval '1 day')
                           or u.used_by = 'orphan_purge')
       and not exists (select 1 from app.scan_photos_expired(1)) then
      return;                                  -- nothing due: no HTTP
    end if;
    if to_regnamespace('net') is null then
      return;                                  -- pg_net not installed
    end if;
    v_key  := app.secret('service_role_key');
    v_base := app.secret('functions_base_url');
    if v_key is null or v_base is null then
      return;                                  -- not configured yet
    end if;

    perform net.http_post(
      url                  := rtrim(v_base, '/') || '/protocol-action',
      headers              := jsonb_build_object('Content-Type',  'application/json',
                                                 'Authorization', 'Bearer ' || v_key),
      body                 := '{"action":"tick"}'::jsonb,
      timeout_milliseconds := 5000);
  exception when others then
    raise warning 'protocol_tick_nudge failed: % (%)', sqlerrm, sqlstate;
  end;
end $protocol_tick_nudge_0240$;

comment on function app.protocol_tick_nudge() is
  'release_post_launch (§2.19), re-issued by incident_reports (wave5-addendum §2.6.2) and scan_hardening (0240). Every 5 minutes (tp_protocol_tick): asks protocol-action to launch the scheduled releases whose date has come, to remove the photos of runs stopped or withdrawn 90 days ago, to remove the photos of incident reports past purge_after, to remove the incidents, campaigns, receipts and slips photos nobody claimed within a day, and to remove scanned papers'' photos past retention. Posts nothing when nothing is due; silent without pg_net or the functions_base_url / service_role_key secrets; swallows its own errors.';

revoke all on function app.protocol_tick_nudge() from public, anon, authenticated;
