-- 0343 main_cash — the branch's main cash (the safe): what is in it, every
-- cost paid out of it, and every move of cash between it, the drawers, the
-- bank and the owner.
--
-- Feature: main cash (Majed 2026-10-16: "additionally to the cash drawer at
-- the desk and at the cafe, these should be separate, there should be a main
-- cash like a safe which is managed by the owner and which the costs will be
-- accounted for; make it really easy to log a payment to somewhere").
-- Depends on: till drawers (0205, stations.mode 0222/0244), wages (0270).
-- 0344 links wages, advances and coach pay to it.
-- Re-runnable: create … if not exists, create or replace, drop … if exists,
-- guarded constraint adds.
--
-- MIGRATION-RISK-ACCEPTED: plain indexes on a new, empty table
--
-- THE MODEL. One ledger, main_cash_entries, one row per thing that happened.
-- delta_iqd is what the row did to the safe; the balance is the sum of the
-- live (not voided) deltas. The calls Majed made when asked:
--   1. Costs are paid from the safe or by bank transfer, never from a drawer.
--      A bank-paid cost is still a row (delta 0), so the month's costs are
--      complete in one list. The drawers, the till shifts and close_day are
--      untouched: a drawer only takes money in and hands it to the safe.
--   2. Cash reaches the safe at day close, one hand-in per box (the café
--      till, the court desk, the shop desk), and any time by hand.
--   3. Managers and the owner both pay and move; every row names who logged
--      it.
-- A box is the drawer kind, not a station: a payment's box is the mode of the
-- station it was taken at (desk, shop), and anything else is the café till.
--
-- KINDS. payment (a cost; paid_from safe or bank; category, payee), hand_in
-- (a drawer's cash into the safe; box), to_drawer (a float out to a drawer;
-- box), owner_in / owner_out (the owner adds or takes cash), bank_in /
-- bank_out (cash from or to the bank), count (someone counted the safe:
-- amount is the count, delta the difference from the balance, so the balance
-- after a count is the count).
--
-- SOURCES. manual (the Safe page), day_close (the hand-in step), and from
-- 0344 wage, wage_advance and coach_pay, written by those RPCs only. A linked
-- row is voided by undoing what it belongs to, never from the Safe page.
--
-- WHO READS. No client grant on the table: everything is read through
-- app.main_cash_overview, which hides the person on a wage or advance row
-- from a manager (wages are the owner's, 0270's LLM wall). Not readable by
-- the owner assistant.
--
-- covered by packages/db/tests/main-cash.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. The ledger.
-- ---------------------------------------------------------------------------
create table if not exists main_cash_entries (
  id             uuid primary key default gen_random_uuid(),
  venue_id       uuid not null references venues(id),
  kind           text not null,
  amount_iqd     iqd not null,
  delta_iqd      iqd_signed not null,
  paid_from      text,
  category       text,
  payee          text,
  note           text,
  box            text,
  day_session_id uuid references day_sessions(id),
  source         text not null default 'manual',
  source_id      uuid,
  occurred_on    date not null,
  logged_by      uuid not null references staff(id),
  logged_at      timestamptz not null default clock_timestamp(),
  voided_at      timestamptz,
  voided_by      uuid references staff(id),
  void_reason    text,
  constraint main_cash_kind_chk check (kind in
    ('payment','hand_in','to_drawer','owner_in','owner_out','bank_in','bank_out','count')),
  constraint main_cash_amount_chk check (amount_iqd <= 1000000000 and (kind = 'count' or amount_iqd > 0)),
  constraint main_cash_delta_chk check (case kind
    when 'payment'   then delta_iqd = case paid_from when 'safe' then -amount_iqd else 0 end
    when 'hand_in'   then delta_iqd = amount_iqd
    when 'owner_in'  then delta_iqd = amount_iqd
    when 'bank_in'   then delta_iqd = amount_iqd
    when 'to_drawer' then delta_iqd = -amount_iqd
    when 'owner_out' then delta_iqd = -amount_iqd
    when 'bank_out'  then delta_iqd = -amount_iqd
    else true end),
  constraint main_cash_payment_chk check ((kind = 'payment') = (paid_from is not null)
    and (kind = 'payment') = (category is not null)),
  constraint main_cash_paid_from_chk check (paid_from is null or paid_from in ('safe','bank')),
  constraint main_cash_category_chk check (category is null or category in
    ('shopping','supplier','rent','bills','repairs','marketing','other','wages','advance','coach_pay')),
  constraint main_cash_box_chk check ((kind in ('hand_in','to_drawer')) = (box is not null)
    and (box is null or box in ('cafe','desk','shop'))),
  constraint main_cash_source_chk check (source in ('manual','day_close','wage','wage_advance','coach_pay')
    and (source in ('manual','day_close')) = (source_id is null)
    and (source <> 'day_close' or (kind = 'hand_in' and day_session_id is not null))
    and (source not in ('wage','wage_advance','coach_pay') or kind = 'payment')),
  constraint main_cash_void_chk check ((voided_at is null) = (voided_by is null)
    and (voided_at is null) = (void_reason is null)),
  constraint main_cash_text_chk check (coalesce(length(payee), 0) <= 80
    and coalesce(length(note), 0) <= 300 and coalesce(length(void_reason), 0) <= 300)
);

-- One live row per linked payment, and one day-close hand-in per day and box.
create unique index if not exists main_cash_one_per_source
  on main_cash_entries (source, source_id) where source_id is not null and voided_at is null;
create unique index if not exists main_cash_one_hand_in_per_box
  on main_cash_entries (day_session_id, box) where source = 'day_close' and voided_at is null;
create index if not exists main_cash_venue_logged on main_cash_entries (venue_id, logged_at);

comment on table main_cash_entries is
  'main_cash_entries (0343): the branch''s main cash (the safe). One row per payment (a cost, paid from the safe or by bank transfer), hand-in from a drawer box, float out to a box, owner or bank move, or count. delta_iqd is the row''s effect on the safe; the balance is the sum of live deltas. Written by the app.main_cash_* RPCs (and 0344''s wage, advance and coach pay RPCs); read through app.main_cash_overview. No client grant. Never readable by the owner assistant or any LLM.';
comment on column main_cash_entries.kind is 'payment | hand_in | to_drawer | owner_in | owner_out | bank_in | bank_out | count.';
comment on column main_cash_entries.amount_iqd is 'The money that moved, IQD, above 0; for a count, the cash counted.';
comment on column main_cash_entries.delta_iqd is 'The row''s effect on the safe, IQD, signed: a bank-paid payment is 0; a count is the count minus the balance before it.';
comment on column main_cash_entries.paid_from is 'payment only: safe or bank.';
comment on column main_cash_entries.category is 'payment only: shopping, supplier, rent, bills, repairs, marketing, other; wages, advance and coach_pay from their own pages (0344).';
comment on column main_cash_entries.payee is 'Who was paid (at most 80 characters); a staff member''s name on a wage or advance row, hidden from managers.';
comment on column main_cash_entries.box is 'hand_in and to_drawer: the drawer box, cafe | desk | shop.';
comment on column main_cash_entries.day_session_id is 'A day-close hand-in: the day it hands in.';
comment on column main_cash_entries.source is 'manual (the Safe page), day_close, wage, wage_advance, coach_pay.';
comment on column main_cash_entries.source_id is 'The wage_payments, wage_advances or coach_statements row a linked payment belongs to.';
comment on column main_cash_entries.occurred_on is 'The branch''s business date when it was logged.';
comment on column main_cash_entries.voided_at is 'Taken back (logged in error); a voided row counts for nothing.';

alter table main_cash_entries enable row level security;
revoke all on main_cash_entries from anon, authenticated;
grant all on main_cash_entries to service_role;

drop trigger if exists zz_branch_guard on public.main_cash_entries;
create trigger zz_branch_guard before insert or update or delete on public.main_cash_entries
  for each row execute function app.trg_branch_guard('scoped', 'day_sessions', 'day_session_id');

-- ---------------------------------------------------------------------------
-- 2. Internals: the lock, the balance, a box, and the linked-payment writers.
-- ---------------------------------------------------------------------------
create or replace function app.lock_main_cash(p_venue uuid)
returns void
language plpgsql security definer set search_path = public as $lock_main_cash_0343$
begin
  if p_venue is not null then
    perform pg_advisory_xact_lock(hashtextextended('app.main_cash:' || p_venue::text, 0));
  end if;
end $lock_main_cash_0343$;

comment on function app.lock_main_cash(uuid) is
  'main cash (0343). Internal: a transaction advisory lock on one branch''s safe, taken by every write to main_cash_entries (after app.lock_wage when both are taken).';
revoke all on function app.lock_main_cash(uuid) from public, anon, authenticated;
grant execute on function app.lock_main_cash(uuid) to service_role;

create or replace function app.main_cash_balance(p_venue uuid)
returns bigint
language sql stable security definer set search_path = public as $main_cash_balance_0343$
  select coalesce(sum(e.delta_iqd), 0)::bigint
    from main_cash_entries e
   where e.venue_id = p_venue and e.voided_at is null;
$main_cash_balance_0343$;

comment on function app.main_cash_balance(uuid) is
  'main cash (0343). Internal: the safe''s balance at a branch, the sum of its live deltas, IQD.';
revoke all on function app.main_cash_balance(uuid) from public, anon, authenticated;
grant execute on function app.main_cash_balance(uuid) to service_role;

-- The drawer box a station's money belongs to.
create or replace function app.main_cash_box(p_station text)
returns text
language sql stable security definer set search_path = public as $main_cash_box_0343$
  select case (select s.mode from stations s where s.id = p_station)
           when 'desk' then 'desk'
           when 'shop' then 'shop'
           else 'cafe' end;
$main_cash_box_0343$;

comment on function app.main_cash_box(text) is
  'main cash (0343). Internal: the drawer box of a station, by stations.mode: desk, shop, else cafe (a till, an unregistered machine or none).';
revoke all on function app.main_cash_box(text) from public, anon, authenticated;
grant execute on function app.main_cash_box(text) to service_role;

-- A linked payment (wage, advance, coach pay), written by the RPC that owns
-- it, inside that RPC's transaction and after its own locks.
create or replace function app.main_cash_record_payment(
  p_venue     uuid,
  p_amount    bigint,
  p_category  text,
  p_payee     text,
  p_paid_from text,
  p_source    text,
  p_source_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $main_cash_record_payment_0343$
declare
  v_id uuid;
begin
  if p_paid_from is null or p_amount is null or p_amount <= 0 then
    return null;
  end if;
  perform app.lock_main_cash(p_venue);
  insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, paid_from, category, payee,
                                 source, source_id, occurred_on, logged_by)
  values (p_venue, 'payment', p_amount,
          case p_paid_from when 'safe' then -p_amount else 0 end,
          p_paid_from, p_category, left(p_payee, 80), p_source, p_source_id,
          app.venue_business_date(p_venue), auth.uid())
  returning id into v_id;
  return v_id;
end $main_cash_record_payment_0343$;

comment on function app.main_cash_record_payment(uuid, bigint, text, text, text, text, uuid) is
  'main cash (0343). Internal: records a linked payment (wage, wage_advance, coach_pay) from its own RPC. Nothing when p_paid_from is null (an older client that did not ask) or the amount is not above 0. Returns the row id or null.';
revoke all on function app.main_cash_record_payment(uuid, bigint, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function app.main_cash_record_payment(uuid, bigint, text, text, text, text, uuid) to service_role;

create or replace function app.main_cash_void_source(p_source text, p_source_id uuid, p_reason text)
returns void
language plpgsql security definer set search_path = public as $main_cash_void_source_0343$
declare
  v_venue uuid;
begin
  select e.venue_id into v_venue from main_cash_entries e
   where e.source = p_source and e.source_id = p_source_id and e.voided_at is null;
  if v_venue is null then
    return;
  end if;
  perform app.lock_main_cash(v_venue);
  update main_cash_entries
     set voided_at = now(), voided_by = auth.uid(), void_reason = left(coalesce(p_reason, 'Undone'), 300)
   where source = p_source and source_id = p_source_id and voided_at is null;
end $main_cash_void_source_0343$;

comment on function app.main_cash_void_source(text, uuid, text) is
  'main cash (0343). Internal: takes back the live linked payment of a wage, advance or coach pay row when that row is undone. Nothing when there is none.';
revoke all on function app.main_cash_void_source(text, uuid, text) from public, anon, authenticated;
grant execute on function app.main_cash_void_source(text, uuid, text) to service_role;

-- The branch a safe write is for: the caller must be a manager or the owner there.
create or replace function app.main_cash_venue(p_venue_id uuid)
returns uuid
language plpgsql security definer set search_path = public as $main_cash_venue_0343$
declare
  v_venue uuid;
begin
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null
     or not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  perform set_config('app.venue_id', v_venue::text, true);
  return v_venue;
end $main_cash_venue_0343$;

comment on function app.main_cash_venue(uuid) is
  'main cash (0343). Internal: the branch of a safe call (p_venue_id, else app.current_venue()), FORBIDDEN unless the caller is a manager or the owner there; asserts app.venue_id.';
revoke all on function app.main_cash_venue(uuid) from public, anon, authenticated;
grant execute on function app.main_cash_venue(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- 3. app.main_cash_overview — the Safe page.
-- ---------------------------------------------------------------------------
create or replace function app.main_cash_overview(
  p_venue_id uuid default null,
  p_month    date default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $main_cash_overview_0343$
declare
  v_venue   uuid;
  v_owner   boolean;
  v_today   date;
  v_current date;
  v_month   date;
  v_balance bigint;
  v_entries jsonb;
  v_costs   jsonb;
  v_total   bigint;
  v_today_f jsonb;
  v_count   jsonb;
  v_payees  jsonb;
  v_boxes   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := coalesce(p_venue_id, app.current_venue());
  if v_venue is null
     or not (v_venue = any(app.staff_venue_ids()) and app.is_staff_at(v_venue, 'manager', 'owner')) then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_owner   := app.is_staff('owner');
  v_today   := app.venue_business_date(v_venue);
  v_current := date_trunc('month', v_today)::date;
  v_month   := coalesce(date_trunc('month', p_month)::date, v_current);
  v_balance := app.main_cash_balance(v_venue);

  -- The month's rows, newest first, each with the balance after it (live
  -- rows only, in the order they were logged).
  with running as (
    select e.*,
           case when e.voided_at is null then
             sum(e.delta_iqd) filter (where e.voided_at is null)
               over (order by e.logged_at, e.id rows between unbounded preceding and current row)
           end as balance_after
      from main_cash_entries e
     where e.venue_id = v_venue
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id',              r.id,
           'kind',            r.kind,
           'amount_iqd',      r.amount_iqd,
           'delta_iqd',       r.delta_iqd,
           'paid_from',       r.paid_from,
           'category',        r.category,
           'payee',           case when not v_owner and r.source in ('wage','wage_advance') then null else r.payee end,
           'payee_hidden',    not v_owner and r.source in ('wage','wage_advance'),
           'note',            r.note,
           'box',             r.box,
           'source',          r.source,
           'occurred_on',     r.occurred_on,
           'logged_at',       r.logged_at,
           'logged_by_name',  (select s.display_name from staff s where s.id = r.logged_by),
           'voided_at',       r.voided_at,
           'voided_by_name',  (select s.display_name from staff s where s.id = r.voided_by),
           'void_reason',     r.void_reason,
           'balance_after_iqd', r.balance_after)
           order by r.logged_at desc, r.id desc), '[]'::jsonb)
    into v_entries
    from running r
   where r.occurred_on >= v_month and r.occurred_on < (v_month + interval '1 month')::date;

  -- Where the month's money went: live payments by category, safe and bank.
  select coalesce(jsonb_agg(jsonb_build_object('category', c.category, 'total_iqd', c.total,
                                               'count', c.n, 'from_bank_iqd', c.bank)
                            order by c.total desc, c.category), '[]'::jsonb),
         coalesce(sum(c.total), 0)
    into v_costs, v_total
    from (select e.category, sum(e.amount_iqd)::bigint as total, count(*)::int as n,
                 coalesce(sum(e.amount_iqd) filter (where e.paid_from = 'bank'), 0)::bigint as bank
            from main_cash_entries e
           where e.venue_id = v_venue and e.kind = 'payment' and e.voided_at is null
             and e.occurred_on >= v_month and e.occurred_on < (v_month + interval '1 month')::date
           group by e.category) c;

  select jsonb_build_object(
           'in_iqd',  coalesce(sum(e.delta_iqd) filter (where e.delta_iqd > 0 and e.kind <> 'count'), 0),
           'out_iqd', coalesce(-sum(e.delta_iqd) filter (where e.delta_iqd < 0 and e.kind <> 'count'), 0))
    into v_today_f
    from main_cash_entries e
   where e.venue_id = v_venue and e.voided_at is null and e.occurred_on = v_today;

  select jsonb_build_object('counted_iqd', e.amount_iqd, 'difference_iqd', e.delta_iqd,
                            'at', e.logged_at,
                            'by_name', (select s.display_name from staff s where s.id = e.logged_by))
    into v_count
    from main_cash_entries e
   where e.venue_id = v_venue and e.kind = 'count' and e.voided_at is null
   order by e.logged_at desc
   limit 1;

  -- The names typed before, per category, newest first: the Pay form offers them.
  select coalesce(jsonb_agg(jsonb_build_object('category', p.category, 'payee', p.payee)
                            order by p.last_at desc), '[]'::jsonb)
    into v_payees
    from (select e.category, e.payee, max(e.logged_at) as last_at
            from main_cash_entries e
           where e.venue_id = v_venue and e.source = 'manual' and e.kind = 'payment'
             and e.voided_at is null and e.payee is not null
             and e.logged_at > now() - interval '180 days'
           group by e.category, e.payee
           order by max(e.logged_at) desc
           limit 40) p;

  -- The boxes this branch has: the café till always, the desk and the shop
  -- when a station of that mode is registered.
  select to_jsonb(array_agg(b order by o))
    into v_boxes
    from (values ('cafe', 1), ('desk', 2), ('shop', 3)) as x(b, o)
   where b = 'cafe'
      or exists (select 1 from stations s where s.venue_id = v_venue and s.retired_at is null and s.mode = x.b);

  return jsonb_build_object(
    'month',          v_month,
    'current_month',  v_current,
    'today',          v_today,
    'balance_iqd',    v_balance,
    'today_figures',  v_today_f,
    'last_count',     v_count,
    'costs',          v_costs,
    'costs_total_iqd', v_total,
    'entries',        v_entries,
    'payees',         v_payees,
    'boxes',          v_boxes,
    'is_owner',       v_owner);
end $main_cash_overview_0343$;

comment on function app.main_cash_overview(uuid, date) is
  'main cash (0343). A manager or the owner at the branch: {month, current_month, today, balance_iqd, today_figures: {in_iqd, out_iqd} (counts left out), last_count: {counted_iqd, difference_iqd, at, by_name} | null, costs: [{category, total_iqd, count, from_bank_iqd}] (the month''s live payments, safe and bank), costs_total_iqd, entries: [{id, kind, amount_iqd, delta_iqd, paid_from, category, payee, payee_hidden, note, box, source, occurred_on, logged_at, logged_by_name, voided_at, voided_by_name, void_reason, balance_after_iqd}] (the month by business date, newest first; balance_after_iqd is null on a voided row), payees: [{category, payee}] (typed on the Safe page in the last 180 days, newest first, at most 40), boxes (cafe, and desk / shop when the branch has such a station), is_owner} for p_month (NULL: the current business month). A wage or advance row''s payee is null with payee_hidden true for a manager. FORBIDDEN for anyone else.';
revoke all on function app.main_cash_overview(uuid, date) from public, anon;
grant execute on function app.main_cash_overview(uuid, date) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. app.main_cash_pay — log a cost.
-- ---------------------------------------------------------------------------
create or replace function app.main_cash_pay(
  p_amount_iqd      bigint,
  p_category        text,
  p_payee           text,
  p_paid_from       text,
  p_note            text default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $main_cash_pay_0343$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_payee  text := nullif(btrim(coalesce(app.safe_line(p_payee), '')), '');
  v_note   text := nullif(btrim(coalesce(app.safe_line(p_note), '')), '');
  v_id     uuid;
  v_result jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.main_cash_venue(p_venue_id);

  v_replay := app.claim_replay(p_idempotency_key, 'main_cash_pay');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_amount_iqd is null or p_amount_iqd <= 0 or p_amount_iqd > 1000000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'amount';
  end if;
  -- Wages, advances and coach pay are paid from their own pages, so each is
  -- counted once and undone with what it pays.
  if p_category is null
     or p_category not in ('shopping','supplier','rent','bills','repairs','marketing','other') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'category';
  end if;
  if p_paid_from is null or p_paid_from not in ('safe','bank') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'paid_from';
  end if;
  if length(v_payee) > 80 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'payee';
  end if;
  if length(v_note) > 300 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  perform app.lock_main_cash(v_venue);
  insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, paid_from, category, payee, note,
                                 source, occurred_on, logged_by)
  values (v_venue, 'payment', p_amount_iqd,
          case p_paid_from when 'safe' then -p_amount_iqd else 0 end,
          p_paid_from, p_category, v_payee, v_note, 'manual',
          app.venue_business_date(v_venue), auth.uid())
  returning id into v_id;

  perform app.write_audit('main_cash.payment', 'main_cash_entry', v_id::text, null,
                          jsonb_build_object('category', p_category, 'paid_from', p_paid_from));

  v_result := jsonb_build_object('id', v_id, 'balance_iqd', app.main_cash_balance(v_venue));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $main_cash_pay_0343$;

comment on function app.main_cash_pay(bigint, text, text, text, text, uuid, text) is
  'main cash (0343). A manager or the owner at the branch logs a cost: p_amount_iqd (1 to 1,000,000,000), p_category (shopping, supplier, rent, bills, repairs, marketing, other; wages, advances and coach pay are paid from their own pages), p_payee (optional, at most 80), p_paid_from (safe: the balance drops; bank: listed with the costs, the safe unchanged), p_note (optional, at most 300). The balance may go below zero: the money left either way, and a count puts it right. Returns {id, balance_iqd}. Idempotent by key. FORBIDDEN, INVALID_ARGUMENT (hint amount, category, paid_from), TEXT_TOO_LONG (hint payee, note). Audit main_cash.payment {category, paid_from}.';
revoke all on function app.main_cash_pay(bigint, text, text, text, text, uuid, text) from public, anon;
grant execute on function app.main_cash_pay(bigint, text, text, text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. app.main_cash_move — cash in or out of the safe that is not a cost.
-- ---------------------------------------------------------------------------
create or replace function app.main_cash_move(
  p_kind            text,
  p_amount_iqd      bigint,
  p_box             text default null,
  p_note            text default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $main_cash_move_0343$
declare
  v_venue  uuid;
  v_replay jsonb;
  v_note   text := nullif(btrim(coalesce(app.safe_line(p_note), '')), '');
  v_box    text;
  v_delta  bigint;
  v_id     uuid;
  v_result jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.main_cash_venue(p_venue_id);

  v_replay := app.claim_replay(p_idempotency_key, 'main_cash_move');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_kind is null or p_kind not in ('hand_in','to_drawer','owner_in','owner_out','bank_in','bank_out') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'kind';
  end if;
  if p_amount_iqd is null or p_amount_iqd <= 0 or p_amount_iqd > 1000000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'amount';
  end if;
  if p_kind in ('hand_in','to_drawer') then
    if p_box is null or p_box not in ('cafe','desk','shop') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'box';
    end if;
    v_box := p_box;
  end if;
  if length(v_note) > 300 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;
  v_delta := case when p_kind in ('hand_in','owner_in','bank_in') then p_amount_iqd else -p_amount_iqd end;

  perform app.lock_main_cash(v_venue);
  insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, box, note, source, occurred_on, logged_by)
  values (v_venue, p_kind, p_amount_iqd, v_delta, v_box, v_note, 'manual',
          app.venue_business_date(v_venue), auth.uid())
  returning id into v_id;

  perform app.write_audit('main_cash.move', 'main_cash_entry', v_id::text, null,
                          jsonb_build_object('kind', p_kind, 'box', v_box));

  v_result := jsonb_build_object('id', v_id, 'balance_iqd', app.main_cash_balance(v_venue));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $main_cash_move_0343$;

comment on function app.main_cash_move(text, bigint, text, text, uuid, text) is
  'main cash (0343). A manager or the owner at the branch moves cash that is not a cost: p_kind hand_in (a drawer box''s cash into the safe) or to_drawer (a float out to one), both with p_box (cafe, desk, shop); owner_in / owner_out (the owner adds or takes cash); bank_in / bank_out (from or to the bank). p_amount_iqd 1 to 1,000,000,000, p_note optional (at most 300). Returns {id, balance_iqd}. Idempotent by key. FORBIDDEN, INVALID_ARGUMENT (hint kind, amount, box), TEXT_TOO_LONG (hint note). Audit main_cash.move {kind, box}.';
revoke all on function app.main_cash_move(text, bigint, text, text, uuid, text) from public, anon;
grant execute on function app.main_cash_move(text, bigint, text, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. app.main_cash_count — someone counted the safe.
-- ---------------------------------------------------------------------------
create or replace function app.main_cash_count(
  p_counted_iqd     bigint,
  p_expected_iqd    bigint,
  p_note            text default null,
  p_venue_id        uuid default null,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $main_cash_count_0343$
declare
  v_venue   uuid;
  v_replay  jsonb;
  v_note    text := nullif(btrim(coalesce(app.safe_line(p_note), '')), '');
  v_balance bigint;
  v_id      uuid;
  v_result  jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  v_venue := app.main_cash_venue(p_venue_id);

  v_replay := app.claim_replay(p_idempotency_key, 'main_cash_count');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_counted_iqd is null or p_counted_iqd < 0 or p_counted_iqd > 1000000000 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'counted';
  end if;
  if length(v_note) > 300 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'note';
  end if;

  perform app.lock_main_cash(v_venue);
  v_balance := app.main_cash_balance(v_venue);
  -- The difference recorded is against the balance the counter saw: a row
  -- logged while they counted sends them back to look again.
  if p_expected_iqd is null or p_expected_iqd <> v_balance then
    raise exception 'MAIN_CASH_CHANGED' using errcode = 'P0001';
  end if;

  insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, note, source, occurred_on, logged_by)
  values (v_venue, 'count', p_counted_iqd, p_counted_iqd - v_balance, v_note, 'manual',
          app.venue_business_date(v_venue), auth.uid())
  returning id into v_id;

  perform app.write_audit('main_cash.count', 'main_cash_entry', v_id::text, null,
                          jsonb_build_object('matches', p_counted_iqd = v_balance));

  v_result := jsonb_build_object('id', v_id, 'balance_iqd', p_counted_iqd,
                                 'difference_iqd', p_counted_iqd - v_balance);
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $main_cash_count_0343$;

comment on function app.main_cash_count(bigint, bigint, text, uuid, text) is
  'main cash (0343). A manager or the owner at the branch records a count of the safe: p_counted_iqd (0 to 1,000,000,000), p_expected_iqd (the balance they were shown, which must still be the balance), p_note optional. The row''s delta is the difference, so the balance after it is the count. Returns {id, balance_iqd, difference_iqd}. Idempotent by key. FORBIDDEN, INVALID_ARGUMENT (hint counted), MAIN_CASH_CHANGED, TEXT_TOO_LONG (hint note). Audit main_cash.count {matches}.';
revoke all on function app.main_cash_count(bigint, bigint, text, uuid, text) from public, anon;
grant execute on function app.main_cash_count(bigint, bigint, text, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. app.main_cash_void — take back a row logged in error.
-- ---------------------------------------------------------------------------
create or replace function app.main_cash_void(p_id uuid, p_reason text)
returns jsonb
language plpgsql security definer set search_path = public as $main_cash_void_0343$
declare
  v_row    main_cash_entries%rowtype;
  v_reason text := nullif(btrim(coalesce(app.safe_line(p_reason), '')), '');
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_row from main_cash_entries e where e.id = p_id;
  if not found or not (v_row.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'id';
  end if;
  perform app.main_cash_venue(v_row.venue_id);
  if v_row.source not in ('manual', 'day_close') then
    raise exception 'MAIN_CASH_LINKED' using errcode = 'P0001', hint = v_row.source;
  end if;
  if v_reason is null then
    raise exception 'REASON_REQUIRED' using errcode = 'P0001';
  end if;
  if length(v_reason) > 300 then
    raise exception 'TEXT_TOO_LONG' using errcode = 'P0001', hint = 'reason';
  end if;

  perform app.lock_main_cash(v_row.venue_id);
  update main_cash_entries
     set voided_at = now(), voided_by = auth.uid(), void_reason = v_reason
   where id = p_id and voided_at is null;
  if not found then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001';
  end if;

  perform app.write_audit('main_cash.void', 'main_cash_entry', p_id::text,
                          jsonb_build_object('status', 'live'), jsonb_build_object('status', 'voided'));
  return jsonb_build_object('id', p_id, 'status', 'voided',
                            'balance_iqd', app.main_cash_balance(v_row.venue_id));
end $main_cash_void_0343$;

comment on function app.main_cash_void(uuid, text) is
  'main cash (0343). A manager or the owner at the row''s branch takes back a row logged in error, with a reason (1 to 300): it stays listed, voided, and counts for nothing. A wage, advance or coach pay row is undone on its own page (MAIN_CASH_LINKED, hint the source). Returns {id, status: voided, balance_iqd}. REF_NOT_FOUND (hint id), FORBIDDEN, MAIN_CASH_LINKED, REASON_REQUIRED, TEXT_TOO_LONG (hint reason), INVALID_TRANSITION (already voided). Audit main_cash.void {status}.';
revoke all on function app.main_cash_void(uuid, text) from public, anon;
grant execute on function app.main_cash_void(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Day close: what each box took, and the hand-in.
-- ---------------------------------------------------------------------------
create or replace function app.main_cash_day_boxes(p_day_session_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $main_cash_day_boxes_0343$
declare
  v_day   day_sessions%rowtype;
  v_boxes jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_day from day_sessions d where d.id = p_day_session_id;
  if not found or not (v_day.venue_id = any(app.staff_venue_ids()))
     or not app.is_staff_at(v_day.venue_id, 'manager', 'owner') then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'day';
  end if;

  -- Cash taken by box (the station it was taken at) and cash handed back by
  -- box (the station of the refund, else of its payment), counted under the
  -- day as close_day counts them (0281).
  with takings as (
    select app.main_cash_box(p.device_id) as box, sum(p.amount_iqd)::bigint as cash_in, 0::bigint as cash_out
      from payments p
     where p.day_session_id = v_day.id and p.method = 'cash'
     group by 1
    union all
    select app.main_cash_box(coalesce(r.device_id, p.device_id)), 0, sum(r.amount_iqd)::bigint
      from refunds r join payments p on p.id = r.payment_id
     where coalesce((select ts.day_session_id from till_shifts ts where ts.id = r.till_shift_id),
                    p.day_session_id) = v_day.id
       and p.method = 'cash'
     group by 1
  ), boxes as (
    select x.b as box, x.o
      from (values ('cafe', 1), ('desk', 2), ('shop', 3)) as x(b, o)
     where x.b in ('cafe', 'desk')
        or exists (select 1 from stations s where s.venue_id = v_day.venue_id and s.retired_at is null and s.mode = x.b)
        or exists (select 1 from takings t where t.box = x.b)
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'box',             b.box,
           'cash_in_iqd',     coalesce((select sum(t.cash_in) from takings t where t.box = b.box), 0),
           'cash_out_iqd',    coalesce((select sum(t.cash_out) from takings t where t.box = b.box), 0),
           'net_iqd',         coalesce((select sum(t.cash_in) - sum(t.cash_out) from takings t where t.box = b.box), 0),
           'handed_in_iqd',   (select e.amount_iqd from main_cash_entries e
                                where e.day_session_id = v_day.id and e.box = b.box
                                  and e.source = 'day_close' and e.voided_at is null))
           order by b.o), '[]'::jsonb)
    into v_boxes
    from boxes b;

  return jsonb_build_object(
    'day_session_id', v_day.id,
    'business_date',  v_day.business_date,
    'status',         v_day.status,
    'opening_float_iqd', v_day.opening_float_iqd,
    'boxes',          v_boxes);
end $main_cash_day_boxes_0343$;

comment on function app.main_cash_day_boxes(uuid) is
  'main cash (0343). A manager or the owner at the day''s branch: {day_session_id, business_date, status, opening_float_iqd, boxes: [{box, cash_in_iqd, cash_out_iqd, net_iqd, handed_in_iqd}]}: the cash each drawer box took on the day (a payment''s box is its station''s mode, app.main_cash_box) less the cash refunds counted under the day as close_day counts them (by the refund''s station, else its payment''s), and the day-close hand-in already recorded for it (null when none). Boxes: cafe and desk always, shop when the branch has a shop station or the day took money there. REF_NOT_FOUND (hint day), FORBIDDEN.';
revoke all on function app.main_cash_day_boxes(uuid) from public, anon;
grant execute on function app.main_cash_day_boxes(uuid) to authenticated;

create or replace function app.main_cash_hand_in_day(
  p_day_session_id  uuid,
  p_boxes           jsonb,
  p_idempotency_key text default null
) returns jsonb
language plpgsql security definer set search_path = public as $main_cash_hand_in_day_0343$
declare
  v_day    day_sessions%rowtype;
  v_replay jsonb;
  v_item   jsonb;
  v_box    text;
  v_amount bigint;
  v_n      int := 0;
  v_total  bigint := 0;
  v_result jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  select * into v_day from day_sessions d where d.id = p_day_session_id;
  if not found or not (v_day.venue_id = any(app.staff_venue_ids())) then
    raise exception 'REF_NOT_FOUND' using errcode = 'P0001', hint = 'day';
  end if;
  perform app.main_cash_venue(v_day.venue_id);

  v_replay := app.claim_replay(p_idempotency_key, 'main_cash_hand_in_day');
  if v_replay is not null then
    return v_replay;
  end if;

  if p_boxes is null or jsonb_typeof(p_boxes) <> 'array' or jsonb_array_length(p_boxes) > 3 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'boxes';
  end if;

  perform app.lock_main_cash(v_day.venue_id);
  for v_item in select * from jsonb_array_elements(p_boxes) loop
    v_box := v_item ->> 'box';
    begin
      v_amount := (v_item ->> 'amount_iqd')::bigint;
    exception when others then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'amount';
    end;
    if v_box is null or v_box not in ('cafe','desk','shop') then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'box';
    end if;
    if v_amount is null or v_amount < 0 or v_amount > 1000000000 then
      raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', hint = 'amount';
    end if;
    continue when v_amount = 0;
    if exists (select 1 from main_cash_entries e
                where e.day_session_id = v_day.id and e.box = v_box
                  and e.source = 'day_close' and e.voided_at is null) then
      raise exception 'MAIN_CASH_HANDED_IN' using errcode = 'P0001', hint = v_box;
    end if;
    insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, box, day_session_id, source,
                                   occurred_on, logged_by)
    values (v_day.venue_id, 'hand_in', v_amount, v_amount, v_box, v_day.id, 'day_close',
            app.venue_business_date(v_day.venue_id), auth.uid());
    v_n := v_n + 1;
    v_total := v_total + v_amount;
  end loop;

  if v_n > 0 then
    perform app.write_audit('main_cash.hand_in', 'day_session', v_day.id::text, null,
                            jsonb_build_object('boxes', v_n));
  end if;

  v_result := jsonb_build_object('handed_in', v_n, 'total_iqd', v_total,
                                 'balance_iqd', app.main_cash_balance(v_day.venue_id));
  if p_idempotency_key is not null then
    perform app.finish_replay(p_idempotency_key, v_result);
  end if;
  return v_result;
end $main_cash_hand_in_day_0343$;

comment on function app.main_cash_hand_in_day(uuid, jsonb, text) is
  'main cash (0343). A manager or the owner at the day''s branch hands each drawer box''s cash to the safe for a day: p_boxes [{box: cafe | desk | shop, amount_iqd: 0 to 1,000,000,000}] (at most 3; 0 skips the box). One live hand-in per day and box (MAIN_CASH_HANDED_IN, hint the box; void it on the Safe page to redo it). Returns {handed_in, total_iqd, balance_iqd}. Idempotent by key. REF_NOT_FOUND (hint day), FORBIDDEN, INVALID_ARGUMENT (hint boxes, box, amount), MAIN_CASH_HANDED_IN. Audit main_cash.hand_in {boxes}.';
revoke all on function app.main_cash_hand_in_day(uuid, jsonb, text) from public, anon;
grant execute on function app.main_cash_hand_in_day(uuid, jsonb, text) to authenticated;
