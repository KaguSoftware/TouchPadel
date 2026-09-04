-- 0065_customers — the desk's customer surface (spec 06.8 CustomerSearchScreen,
-- 06.9 CustomerRecordScreen, 06.10 CustomerCreateScreen; build plan §4 "0065").
--
-- The desk has searched `profiles` straight through PostgREST since day 1
-- (DeskCalendar: `full_name.ilike / phone.ilike`), which matches nothing when
-- the operator types "770 123" against a stored "+9647701234567", nothing when
-- they type Arabic-Indic digits, and cannot show the email at all because it
-- lives in auth.users. Spec 06.8 puts the tolerance server-side ("you render
-- what comes back"); this migration is that server side, plus the two
-- staff-only tables 06.9 needs.
--
--   TABLES
--   customer_notes  — free text by a named staff author; edits stamp
--                     edited_at/edited_by and are audited before/after.
--   customer_flags  — one row per (customer, type), type in vip | birthday |
--                     payment_note | special_request, optional label.
--   Both: RLS on, SELECT granted to `authenticated` but the policy admits
--   STAFF ONLY (court_desk, cashier, manager, owner). A café guest and a
--   booking guest are `authenticated` too and get RLS silence — spec 06.9:
--   "never rendered on any guest-facing surface". Writes are RPC-only.
--
--   RPCs (schema app, SECURITY DEFINER, guard on the first line)
--   customer_search(p_query text, p_limit int default 12) -> setof jsonb
--     {id, full_name, phone, email, preferred_lang, flags:[{type,label}],
--      counts:{bookings,cancellations,noShows}}
--     Matches ANY of: name (app.search_norm on both sides — lower-case,
--     Arabic-Indic digits folded, harakat/tatweel stripped, alef/ta-marbuta/
--     alef-maqsura folded, spaces ignored, so "Abdul Rahman" finds
--     "Abdulrahman" and "أحمد" finds "احمد"); phone (app.phone_digits on both
--     sides — digits only, partial, 3+ digits); email (ilike, from auth.users,
--     which a definer can read). Roles: court_desk, cashier, manager, owner.
--   customer_record(p_customer_id uuid) -> jsonb
--     {customer:{id, full_name, phone, email, preferred_lang, created_at},
--      flags:[{type,label}], counts:{bookings,cancellations,noShows},
--      upcoming:[reservation…], history:[reservation… (last 50)],
--      cafeOrders:[{id, opened_at, total_iqd, status, reservation_id}],
--      notes:[{id, body, author_id, author_name, created_at, edited_at,
--              edited_by, edited_by_name}],
--      series:[]}   -- kept for 0066; the series lane fills it
--     reservation = {id, court_id, court_name_en, court_name_ar, start_at,
--                    end_at, status, kind, price_iqd, source}
--     upcoming = start_at >= now() and status in (pending, confirmed, arrived);
--     history  = everything else except expired/pending holds (kind='hold'),
--                newest first, 50 rows.
--     cafeOrders = tabs charged to this customer's reservations
--                  (tabs.reservation_id), newest first. total_iqd is the
--                  settle-time stamp and is null while a tab is open.
--   add_customer_note(p_customer_id, p_body) -> uuid     (court_desk, manager, owner)
--   edit_customer_note(p_note_id, p_body) -> jsonb       (same; audited before/after)
--   set_customer_flags(p_customer_id, p_flags jsonb) -> jsonb   replace-all, audited
--
--   SERVICE-ROLE ONLY (no client grant; the desk-customer-create edge function)
--   find_customer_by_phone(p_phone) -> uuid  — duplicate pre-check on the
--     CANONICAL number (app.phone_canon: digits, then the 00 / 964 country
--     prefix and the trunk 0 dropped), so "0770 123 4567", "+964 770 123 4567"
--     and "٠٧٧٠١٢٣٤٥٦٧" are one phone. Search stays a partial digits match.
--   desk_register_customer(p_customer_id, p_full_name, p_phone,
--                          p_preferred_lang, p_actor_id) -> jsonb
--     Called right after auth.admin.createUser. The 0058 signup trigger has
--     already created the profile from user_metadata; this upserts the three
--     fields anyway (a trigger that ran without metadata leaves a bare row),
--     refuses DUPLICATE_PHONE / INVALID_PHONE, and writes the audit row with
--     the desk operator named as actor (the service role has no auth.uid()).
--
--   counts: bookings = kind 'booking' in (pending, confirmed, arrived,
--   completed); cancellations = status 'cancelled'; noShows = 'no_show'.
--
-- covered by packages/db/tests/customers.test.ts and rls-matrix.ts (drop 5)

-- ---------------------------------------------------------------------------
-- 1. Tables + RLS
-- ---------------------------------------------------------------------------
create table customer_notes (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references profiles(id) on delete cascade,
  body        text not null check (length(body) between 1 and 2000),
  author_id   uuid not null references staff(id),
  created_at  timestamptz not null default now(),
  edited_at   timestamptz,
  edited_by   uuid references staff(id),
  check ((edited_at is null) = (edited_by is null))
);

create index customer_notes_customer on customer_notes (customer_id, created_at desc);

create table customer_flags (
  customer_id uuid not null references profiles(id) on delete cascade,
  type        text not null check (type in ('vip','birthday','payment_note','special_request')),
  label       text check (label is null or length(label) <= 120),
  created_by  uuid not null references staff(id),
  created_at  timestamptz not null default now(),
  primary key (customer_id, type)
);

alter table customer_notes enable row level security;
alter table customer_flags enable row level security;

-- SELECT is granted to `authenticated` because staff ARE `authenticated`; the
-- policy is the wall. No INSERT/UPDATE/DELETE grant for anyone: RPC-only.
grant select on customer_notes to authenticated;
grant select on customer_flags to authenticated;

create policy customer_notes_select_staff on customer_notes for select to authenticated
  using (app.is_staff('court_desk','cashier','manager','owner'));
create policy customer_flags_select_staff on customer_flags for select to authenticated
  using (app.is_staff('court_desk','cashier','manager','owner'));

-- ---------------------------------------------------------------------------
-- 2. Normalisers — pure, immutable, no client grant (internal to the RPCs).
-- ---------------------------------------------------------------------------

-- Digits only, Arabic-Indic (U+0660–U+0669) and Extended Arabic-Indic
-- (U+06F0–U+06F9) folded to ASCII. NULL when nothing is left.
create or replace function app.phone_digits(p_phone text) returns text
language sql immutable as $phone_digits_0065$
  select nullif(
           regexp_replace(
             translate(coalesce(p_phone, ''), '٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹', '01234567890123456789'),
             '[^0-9]', '', 'g'),
           '')
$phone_digits_0065$;

revoke all on function app.phone_digits(text) from public, anon, authenticated;

-- The identity form of an Iraqi number for the DUPLICATE rule: digits, minus
-- an international prefix written as 00 or +, minus the 964 country code,
-- minus the trunk 0 — so 07701234567, 009647701234567 and +964 770 123 4567
-- all become 7701234567. A number from any other country keeps its own code
-- and still compares with itself consistently. NULL when nothing is left.
create or replace function app.phone_canon(p_phone text) returns text
language sql immutable as $phone_canon_0065$
  select nullif(
           regexp_replace(
             regexp_replace(coalesce(app.phone_digits(p_phone), ''), '^00', ''),
             '^(964|0)', ''),
           '')
$phone_canon_0065$;

revoke all on function app.phone_canon(text) from public, anon, authenticated;

-- Name key for both scripts. Lower-case; Arabic-Indic digits to ASCII;
-- tatweel / harakat / superscript alef deleted (same class as
-- app.normalize_finding, 0034); أ إ آ ٱ -> ا, ة -> ه, ى -> ي; every run of
-- whitespace collapsed and trimmed. Callers strip the remaining spaces so
-- spacing differences never split a match.
create or replace function app.search_norm(p_text text) returns text
language sql immutable as $search_norm_0065$
  select btrim(regexp_replace(
           translate(
             regexp_replace(lower(coalesce(p_text, '')), '[ـً-ْٰ]', '', 'g'),
             'أإآٱةى٠١٢٣٤٥٦٧٨٩۰۱۲۳۴۵۶۷۸۹',
             'ااااهي01234567890123456789'),
           '\s+', ' ', 'g'))
$search_norm_0065$;

revoke all on function app.search_norm(text) from public, anon, authenticated;

-- LIKE metacharacters in operator input are literal characters, not wildcards.
create or replace function app.like_escape(p_text text) returns text
language sql immutable as $like_escape_0065$
  select replace(replace(replace(coalesce(p_text, ''), '\', '\\'), '%', '\%'), '_', '\_')
$like_escape_0065$;

revoke all on function app.like_escape(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Per-customer fragments shared by search and record. Definer, no client
--    grant — they are only ever called from the guarded RPCs below.
-- ---------------------------------------------------------------------------
create or replace function app.customer_counts(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = public as $customer_counts_0065$
  select jsonb_build_object(
           'bookings',      count(*) filter (where kind = 'booking'
                                               and status in ('pending','confirmed','arrived','completed')),
           'cancellations', count(*) filter (where kind = 'booking' and status = 'cancelled'),
           'noShows',       count(*) filter (where kind = 'booking' and status = 'no_show'))
    from reservations
   where guest_id = p_customer_id
$customer_counts_0065$;

revoke all on function app.customer_counts(uuid) from public, anon, authenticated;

create or replace function app.customer_flags_json(p_customer_id uuid) returns jsonb
language sql stable security definer set search_path = public as $customer_flags_json_0065$
  select coalesce(
           (select jsonb_agg(jsonb_build_object('type', f.type, 'label', f.label) order by f.type)
              from customer_flags f
             where f.customer_id = p_customer_id),
           '[]'::jsonb)
$customer_flags_json_0065$;

revoke all on function app.customer_flags_json(uuid) from public, anon, authenticated;

create or replace function app.customer_reservation_json(r reservations, c courts) returns jsonb
language sql immutable as $customer_reservation_json_0065$
  select jsonb_build_object(
           'id',            (r).id,
           'court_id',      (r).court_id,
           'court_name_en', (c).name_en,
           'court_name_ar', (c).name_ar,
           'start_at',      (r).start_at,
           'end_at',        (r).end_at,
           'status',        (r).status,
           'kind',          (r).kind,
           'price_iqd',     (r).price_iqd,
           'source',        (r).source)
$customer_reservation_json_0065$;

revoke all on function app.customer_reservation_json(reservations, courts) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. customer_search
-- ---------------------------------------------------------------------------
create or replace function app.customer_search(p_query text, p_limit int default 12)
returns setof jsonb
language plpgsql stable security definer set search_path = public as $customer_search_0065$
declare
  v_query  text := btrim(coalesce(p_query, ''));
  v_name   text;
  v_digits text;
  v_email  text;
  v_limit  int  := least(greatest(coalesce(p_limit, 12), 1), 50);
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  -- One character matches half the venue; the screen's `idle` state covers it.
  if length(v_query) < 2 then
    return;
  end if;

  v_name   := app.like_escape(replace(app.search_norm(v_query), ' ', ''));
  v_digits := app.phone_digits(v_query);
  v_email  := app.like_escape(lower(v_query));

  return query
    select jsonb_build_object(
             'id',             p.id,
             'full_name',      p.full_name,
             'phone',          p.phone,
             'email',          u.email,
             'preferred_lang', p.preferred_lang,
             'flags',          app.customer_flags_json(p.id),
             'counts',         app.customer_counts(p.id))
      from profiles p
      left join auth.users u on u.id = p.id
     where (v_name <> ''
            and replace(app.search_norm(p.full_name), ' ', '') like '%' || v_name || '%')
        or (v_digits is not null and length(v_digits) >= 3
            and app.phone_digits(p.phone) like '%' || v_digits || '%')
        or ((position('@' in v_query) > 0 or length(v_query) >= 3)
            and u.email is not null and lower(u.email) like '%' || v_email || '%')
     order by
       -- prefix hits first, then substring hits, then by name
       case
         when v_name <> '' and replace(app.search_norm(p.full_name), ' ', '') like v_name || '%' then 0
         when v_digits is not null and app.phone_digits(p.phone) like v_digits || '%' then 1
         else 2
       end,
       p.full_name,
       p.created_at desc
     limit v_limit;
end $customer_search_0065$;

revoke all on function app.customer_search(text, int) from public, anon;
grant execute on function app.customer_search(text, int) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. customer_record
-- ---------------------------------------------------------------------------
create or replace function app.customer_record(p_customer_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $customer_record_0065$
declare
  v_customer jsonb;
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select jsonb_build_object(
           'id',             p.id,
           'full_name',      p.full_name,
           'phone',          p.phone,
           'email',          u.email,
           'preferred_lang', p.preferred_lang,
           'created_at',     p.created_at)
    into v_customer
    from profiles p
    left join auth.users u on u.id = p.id
   where p.id = p_customer_id;
  if v_customer is null then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  return jsonb_build_object(
    'customer', v_customer,
    'flags',    app.customer_flags_json(p_customer_id),
    'counts',   app.customer_counts(p_customer_id),
    'upcoming', coalesce(
      (select jsonb_agg(app.customer_reservation_json(r, c) order by r.start_at)
         from reservations r
         join courts c on c.id = r.court_id
        where r.guest_id = p_customer_id
          and r.start_at >= now()
          and r.status in ('pending','confirmed','arrived')),
      '[]'::jsonb),
    'history', coalesce(
      (select jsonb_agg(h.payload order by h.start_at desc)
         from (select app.customer_reservation_json(r, c) as payload, r.start_at
                 from reservations r
                 join courts c on c.id = r.court_id
                where r.guest_id = p_customer_id
                  and r.kind <> 'hold'
                  and not (r.start_at >= now() and r.status in ('pending','confirmed','arrived'))
                order by r.start_at desc
                limit 50) h),
      '[]'::jsonb),
    'cafeOrders', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             t.id,
                          'opened_at',      t.opened_at,
                          'total_iqd',      t.total_iqd,
                          'status',         t.status,
                          'reservation_id', t.reservation_id)
                        order by t.opened_at desc)
         from tabs t
        where t.reservation_id in (select r.id from reservations r where r.guest_id = p_customer_id)),
      '[]'::jsonb),
    'notes', coalesce(
      (select jsonb_agg(jsonb_build_object(
                          'id',             n.id,
                          'body',           n.body,
                          'author_id',      n.author_id,
                          'author_name',    a.display_name,
                          'created_at',     n.created_at,
                          'edited_at',      n.edited_at,
                          'edited_by',      n.edited_by,
                          'edited_by_name', e.display_name)
                        order by n.created_at desc)
         from customer_notes n
         join staff a on a.id = n.author_id
         left join staff e on e.id = n.edited_by
        where n.customer_id = p_customer_id),
      '[]'::jsonb),
    -- 0066 (series lane) fills this; the key exists now so the screen can bind to it.
    'series', '[]'::jsonb);
end $customer_record_0065$;

revoke all on function app.customer_record(uuid) from public, anon;
grant execute on function app.customer_record(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. add_customer_note
-- ---------------------------------------------------------------------------
create or replace function app.add_customer_note(p_customer_id uuid, p_body text) returns uuid
language plpgsql security definer set search_path = public as $add_customer_note_0065$
declare
  v_body text := btrim(coalesce(p_body, ''));
  v_id   uuid;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 2000 then
    raise exception 'NOTE_LENGTH' using errcode = 'P0001',
      hint = 'a note is 1-2000 characters';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- auth.uid() IS a staff id here: app.is_staff only passes an active staff row.
  insert into customer_notes (customer_id, body, author_id)
  values (p_customer_id, v_body, auth.uid())
  returning id into v_id;

  perform app.write_audit('customer.note_add', 'customer_notes', v_id::text, null,
                          jsonb_build_object('customer_id', p_customer_id, 'body', v_body));
  return v_id;
end $add_customer_note_0065$;

revoke all on function app.add_customer_note(uuid, text) from public, anon;
grant execute on function app.add_customer_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. edit_customer_note — any desk-writing role may edit any note; the edit
--    is stamped on the row AND recorded before/after in the audit log, which
--    is what spec 06.9 "edits are recorded" asks for.
-- ---------------------------------------------------------------------------
create or replace function app.edit_customer_note(p_note_id uuid, p_body text) returns jsonb
language plpgsql security definer set search_path = public as $edit_customer_note_0065$
declare
  v_body   text := btrim(coalesce(p_body, ''));
  v_before customer_notes%rowtype;
  v_after  customer_notes%rowtype;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_body) = 0 or length(v_body) > 2000 then
    raise exception 'NOTE_LENGTH' using errcode = 'P0001',
      hint = 'a note is 1-2000 characters';
  end if;

  select * into v_before from customer_notes where id = p_note_id for update;
  if not found then
    raise exception 'NOTE_NOT_FOUND' using errcode = 'P0001';
  end if;

  update customer_notes
     set body      = v_body,
         edited_at = now(),
         edited_by = auth.uid()
   where id = p_note_id
   returning * into v_after;

  perform app.write_audit('customer.note_edit', 'customer_notes', p_note_id::text,
                          jsonb_build_object('customer_id', v_before.customer_id,
                                             'body', v_before.body,
                                             'edited_at', v_before.edited_at,
                                             'edited_by', v_before.edited_by),
                          jsonb_build_object('customer_id', v_after.customer_id,
                                             'body', v_after.body,
                                             'edited_at', v_after.edited_at,
                                             'edited_by', v_after.edited_by));

  return jsonb_build_object('id', v_after.id, 'body', v_after.body,
                            'edited_at', v_after.edited_at, 'edited_by', v_after.edited_by);
end $edit_customer_note_0065$;

revoke all on function app.edit_customer_note(uuid, text) from public, anon;
grant execute on function app.edit_customer_note(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. set_customer_flags — replace-all. p_flags is a jsonb array of
--    {type, label?}; an empty array clears every flag. Returns the flags as
--    stored, in the same shape customer_search / customer_record use.
-- ---------------------------------------------------------------------------
create or replace function app.set_customer_flags(p_customer_id uuid, p_flags jsonb) returns jsonb
language plpgsql security definer set search_path = public as $set_customer_flags_0065$
declare
  v_flags  jsonb := coalesce(p_flags, '[]'::jsonb);
  v_flag   jsonb;
  v_type   text;
  v_label  text;
  v_before jsonb;
  v_after  jsonb;
begin
  if not app.is_staff('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if jsonb_typeof(v_flags) <> 'array' then
    raise exception 'INVALID_FLAGS' using errcode = 'P0001',
      hint = 'p_flags is an array of {type, label}';
  end if;
  if not exists (select 1 from profiles where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Validate everything before touching the table: a refused call leaves the
  -- previous flags exactly as they were.
  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_type := v_flag->>'type';
    if v_type is null or v_type not in ('vip','birthday','payment_note','special_request') then
      raise exception 'INVALID_FLAG' using errcode = 'P0001',
        detail = coalesce(v_type, 'null'),
        hint = 'type is vip | birthday | payment_note | special_request';
    end if;
    if length(coalesce(v_flag->>'label', '')) > 120 then
      raise exception 'LABEL_LENGTH' using errcode = 'P0001',
        hint = 'a flag label is at most 120 characters';
    end if;
  end loop;
  if (select count(*) from jsonb_array_elements(v_flags))
     <> (select count(distinct f->>'type') from jsonb_array_elements(v_flags) f) then
    raise exception 'DUPLICATE_FLAG' using errcode = 'P0001',
      hint = 'each flag type may appear once';
  end if;

  v_before := app.customer_flags_json(p_customer_id);

  delete from customer_flags where customer_id = p_customer_id;

  for v_flag in select * from jsonb_array_elements(v_flags) loop
    v_label := nullif(btrim(coalesce(v_flag->>'label', '')), '');
    insert into customer_flags (customer_id, type, label, created_by)
    values (p_customer_id, v_flag->>'type', v_label, auth.uid());
  end loop;

  v_after := app.customer_flags_json(p_customer_id);

  if v_before is distinct from v_after then
    perform app.write_audit('customer.flags_set', 'customer_flags', p_customer_id::text,
                            v_before, v_after);
  end if;

  return v_after;
end $set_customer_flags_0065$;

revoke all on function app.set_customer_flags(uuid, jsonb) from public, anon;
grant execute on function app.set_customer_flags(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Service-role pair for the desk-customer-create edge function.
--
--    Account creation needs the GoTrue admin API, so it cannot be an RPC
--    (same reasoning as 0051's register_staff). The edge function has already
--    done `requireStaffRole(req, service, ['court_desk','manager','owner'])`;
--    these two run as the service role, which has no JWT, so the operator is
--    named explicitly as p_actor_id for the audit row.
-- ---------------------------------------------------------------------------

-- The duplicate pre-check, so a refused create never has to create-then-delete
-- an auth user. Canonical-number compare on both sides (app.phone_canon).
create or replace function app.find_customer_by_phone(p_phone text) returns uuid
language sql stable security definer set search_path = public as $find_customer_by_phone_0065$
  select p.id
    from profiles p
   where app.phone_canon(p_phone) is not null
     and app.phone_canon(p.phone) = app.phone_canon(p_phone)
   order by p.created_at
   limit 1
$find_customer_by_phone_0065$;

revoke all on function app.find_customer_by_phone(text) from public, anon, authenticated;
grant execute on function app.find_customer_by_phone(text) to service_role;

create or replace function app.desk_register_customer(
  p_customer_id    uuid,
  p_full_name      text,
  p_phone          text,
  p_preferred_lang text,
  p_actor_id       uuid
) returns jsonb
language plpgsql security definer set search_path = public as $desk_register_customer_0065$
declare
  v_name   text := btrim(coalesce(p_full_name, ''));
  v_phone  text := btrim(coalesce(p_phone, ''));
  v_digits text := app.phone_digits(p_phone);
  v_canon  text := app.phone_canon(p_phone);
  v_lang   text := coalesce(p_preferred_lang, 'en');
  v_actor  staff%rowtype;
  v_dup    uuid;
  v_row    profiles%rowtype;
begin
  select * into v_actor from staff where id = p_actor_id and is_active;
  if not found or v_actor.role not in ('court_desk','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if length(v_name) = 0 or length(v_name) > 80 then
    raise exception 'NAME_LENGTH' using errcode = 'P0001',
      hint = 'full name must be 1-80 characters';
  end if;
  if v_digits is null or length(v_digits) < 7 or length(v_digits) > 15 then
    raise exception 'INVALID_PHONE' using errcode = 'P0001',
      hint = '7-15 digits';
  end if;
  if v_lang not in ('en','ar') then
    raise exception 'INVALID_LANG' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users where id = p_customer_id) then
    raise exception 'AUTH_USER_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- Re-check under the write: the edge function's pre-check and this call are
  -- two round trips, and two desks can type the same walk-in at once.
  select p.id into v_dup
    from profiles p
   where p.id <> p_customer_id
     and app.phone_canon(p.phone) = v_canon
   limit 1;
  if v_dup is not null then
    raise exception 'DUPLICATE_PHONE' using errcode = 'P0001',
      detail = v_dup::text;
  end if;

  -- The 0058 trigger normally created this row from user_metadata already;
  -- the upsert makes the outcome the same either way.
  insert into profiles (id, full_name, phone, preferred_lang)
  values (p_customer_id, v_name, v_phone, v_lang)
  on conflict (id) do update
    set full_name      = excluded.full_name,
        phone          = excluded.phone,
        preferred_lang = excluded.preferred_lang
  returning * into v_row;

  insert into audit_log (actor_id, actor_role, action, entity, entity_id, before, after)
  values (p_actor_id, v_actor.role::text, 'customer.create', 'profiles', p_customer_id::text, null,
          jsonb_build_object('full_name', v_row.full_name, 'phone', v_row.phone,
                             'preferred_lang', v_row.preferred_lang, 'source', 'desk'));

  return jsonb_build_object('id', v_row.id, 'full_name', v_row.full_name,
                            'phone', v_row.phone, 'preferred_lang', v_row.preferred_lang);
end $desk_register_customer_0065$;

revoke all on function app.desk_register_customer(uuid, text, text, text, uuid)
  from public, anon, authenticated;
-- Functions do not inherit the 0012 blanket table grants (0051's lesson).
grant execute on function app.desk_register_customer(uuid, text, text, text, uuid) to service_role;
