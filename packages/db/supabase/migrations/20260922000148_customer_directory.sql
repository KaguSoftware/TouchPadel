-- 0148_customer_directory: the whole customer book in one lean read, for the
-- desk's Customers screen.
--
-- WHAT. `app.customer_directory(p_limit)` returns every live customer (a
-- `profiles` row that is not a 0077 tombstone and is not an active staff
-- account — every staff login has a profile too, and "Dev Cashier" in the
-- customer book reads as a guest), name order, as one jsonb
-- document: `{ rows, total, truncated }`. Each row carries what the list shows
-- and nothing more: id, full_name, phone, email, flags, counts — the same
-- field names `customer_search` uses, so the screen renders both with one row
-- component.
--
-- WHY. The screen used to open on an empty search box: the desk had to know a
-- name before it could see anyone (owner call, 2026-09-22: "list the
-- customers"). The screen asks for this once and keeps it in memory, filtering
-- locally as the desk types, so reopening the screen or typing a name costs no
-- round trip at all; `customer_search` stays for the booking dialog's picker
-- and for a book too large to list.
--
-- SHAPE OF THE QUERY. Counts and flags are grouped once over `reservations`
-- and `customer_flags` and joined, instead of calling the per-customer
-- helpers (customer_counts, customer_flags_json) once per row: those are one
-- scan each, and at a few thousand customers that is a few thousand scans.
-- The count filters are 0065's customer_counts, verbatim; the flag object is
-- 0065's customer_flags_json, verbatim.
--
-- CAP. p_limit defaults to 5000 and is clamped to 1..5000. `total` is the real
-- number of live customers and `truncated` says the list stopped short, so the
-- screen can fall back to the server search rather than filter an incomplete
-- list and report "no match" for a customer who exists.
--
-- GUARD. Same roles as customer_search (court_desk, cashier, manager, owner);
-- a guest is refused before anything is read.
--
-- Posture: one new function, no table change, no lock taken.
--
-- covered by packages/db/tests/customer-directory.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.customer_directory(p_limit int default 5000)
returns jsonb
language plpgsql stable security definer set search_path = public as $customer_directory_0148$
declare
  v_limit int := least(greatest(coalesce(p_limit, 5000), 1), 5000);
  v_total bigint;
  v_rows  jsonb;
begin
  if not app.is_staff('court_desk','cashier','manager','owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  select count(*) into v_total
    from profiles p
   where p.deleted_at is null
     and not exists (select 1 from staff s where s.id = p.id and s.is_active);

  with page as (
    select p.id, p.full_name, p.phone
      from profiles p
     where p.deleted_at is null
       and not exists (select 1 from staff s where s.id = p.id and s.is_active)
     -- a nameless account last, as the screen lists it, so the cap drops those first
     order by (btrim(coalesce(p.full_name, '')) = ''), p.full_name, p.created_at desc
     limit v_limit
  ),
  counts as (
    select r.guest_id,
           count(*) filter (where r.kind = 'booking'
                              and r.status in ('pending','confirmed','arrived','completed')) as bookings,
           count(*) filter (where r.kind = 'booking' and r.status = 'cancelled')          as cancellations,
           count(*) filter (where r.kind = 'booking' and r.status = 'no_show')            as no_shows
      from reservations r
      join page on page.id = r.guest_id
     group by r.guest_id
  ),
  flags as (
    select f.customer_id,
           jsonb_agg(jsonb_build_object('type', f.type, 'label', f.label) order by f.type) as flags
      from customer_flags f
      join page on page.id = f.customer_id
     group by f.customer_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        page.id,
           'full_name', page.full_name,
           'phone',     page.phone,
           'email',     u.email,
           'flags',     coalesce(fl.flags, '[]'::jsonb),
           'counts',    jsonb_build_object(
                          'bookings',      coalesce(c.bookings, 0),
                          'cancellations', coalesce(c.cancellations, 0),
                          'noShows',       coalesce(c.no_shows, 0)))
           order by page.full_name), '[]'::jsonb)
    into v_rows
    from page
    left join auth.users u on u.id = page.id
    left join counts c     on c.guest_id = page.id
    left join flags fl     on fl.customer_id = page.id;

  return jsonb_build_object(
    'rows',      v_rows,
    'total',     v_total,
    'truncated', v_total > v_limit);
end $customer_directory_0148$;

revoke all on function app.customer_directory(int) from public, anon;
grant execute on function app.customer_directory(int) to authenticated;
