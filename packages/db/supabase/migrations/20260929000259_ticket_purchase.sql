set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0259 ticket_purchase — open-match tickets: buying, the wallet, cash-out and
-- the account-deletion refunds (lane Money; docs/design/open-matches/money.md
-- §5, build contracts §1.5–§1.8, rulings R3, R7, R8, R11, R13, R25).
--
--   1. app.ticket_payment_prepare   service role (edge ticket-begin): one live
--                                   attempt per guest, 1..3 tickets, the
--                                   wallet cap, three failures a day
--   2. app.ticket_settle_success    a SUCCESS always creates the tickets, late
--                                   or not (MD-2); a payer gone at SUCCESS is
--                                   refunded (DF-20)
--   3. app.deposit_apply            re-issued from 0242: the ticket branch
--   4. app.deposit_status           re-issued from 0242: purpose-aware
--   5. app.deposit_refund_apply     re-issued from 0242: a ticket refund takes
--                                   no court lock and pushes tickets_refunded
--                                   through app.match_notify (0261, late-bound)
--   6. app.ticket_cashout_block     the one place that says whether a purchase
--                                   may be cashed out (R13)
--   7. app.tickets_cash_out         the one writer of cashed_out: all of a
--                                   purchase's unused tickets, one Qi refund
--   8. app.ticket_refund_deleted    DF-20: a deleted guest's unused tickets
--   9. app.ticket_wallet, app.my_tickets (guest), app.guest_tickets (desk)
--  10. app.ticket_cashout           manager, owner: cash-out at the desk (OM-48)
--  11. profiles_sandbox_tickets     a payment_sandbox flip is refused while the
--                                   profile holds live tickets (C20)
--
-- Lock order (money.md §8): a ticket purchase row is locked only after the
-- purchase's match_tickets rows (id order), and never with a court, a booking
-- or a branch mutex; deposit rows keep court -> reservations -> row. The lock
-- walker learns match_tickets and walks the service-role paths in 0260.
--
-- "Restorable" (R13) is app.match_marks_open (0260, lane DB). Nothing can
-- forfeit a ticket before 0260 (only its helpers do), so the one statement
-- that calls it runs only when a forfeited ticket exists, and binds at run time.

-- ===========================================================================
-- 1. Prepare a purchase (service role)
-- ===========================================================================
create or replace function app.ticket_payment_prepare(
  p_guest_id uuid,
  p_count    int,
  p_locale   text,
  p_provider text
) returns jsonb
language plpgsql security definer set search_path = public as $ticket_payment_prepare_0259$
declare
  v         booking_payments%rowtype;
  v_profile profiles%rowtype;
  v_reused  boolean := false;
  v_unit    bigint;
  v_cap     int;
  v_have    int;
  v_fails   int;
begin
  if p_guest_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_id';
  end if;
  if p_provider is null or p_provider not in ('qi', 'fake') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_provider';
  end if;

  select * into v_profile from profiles where id = p_guest_id;
  if not found or v_profile.deleted_at is not null then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- A live attempt: hand it back whatever p_count says (a double tap; the app
  -- shows that attempt's own count).
  select * into v from booking_payments
   where guest_id = p_guest_id and purpose = 'ticket' and status in ('created', 'pending')
   for update;
  if found then
    v_reused := true;
  else
    if p_count is null or p_count not between 1 and 3 then
      raise exception 'TICKET_COUNT_INVALID' using errcode = 'P0001', detail = 'p_count',
        hint = 'buy 1 to 3 tickets at a time';
    end if;
    -- R10: open matches switched off at every open branch stops new purchases.
    if not exists (select 1 from venue_settings vs
                    where vs.venue_id = any (app.open_venue_ids())
                      and vs.matches_enabled) then
      raise exception 'MATCHES_OFF' using errcode = 'P0001';
    end if;
    if nullif(btrim(coalesce(v_profile.phone, '')), '') is null then
      raise exception 'PHONE_REQUIRED' using errcode = 'P0001',
        hint = 'add a phone number to your profile before paying';
    end if;
    -- The terms test of app.match_eligibility (0260), for p_guest_id: auth.uid()
    -- is NULL under the service role. One definition, app.match_terms_ok (0257).
    if not app.match_terms_ok(v_profile.terms_version) then
      raise exception 'TERMS_REQUIRED' using errcode = 'P0001';
    end if;
    -- MD-5: a ticket only buys a match seat.
    if exists (select 1 from customer_flags
                where customer_id = p_guest_id and type = 'match_ban') then
      raise exception 'MATCH_BANNED' using errcode = 'P0001';
    end if;
    -- MD-6: never more unused tickets than one guest can ever lock at once
    -- (3 seats x the filling-match cap).
    select ps.match_ticket_price_iqd, 3 * ps.max_filling_matches_per_guest
      into v_unit, v_cap
      from platform_settings ps where ps.id;
    select count(*) into v_have from match_tickets
     where guest_id = p_guest_id and status = 'available';
    if v_have + p_count > v_cap then
      raise exception 'TICKET_COUNT_INVALID' using errcode = 'P0001', detail = 'wallet_limit',
        hint = format('at most %s unused tickets', v_cap);
    end if;
    -- MD-7: three failed or expired attempts in 24 hours.
    select count(*) into v_fails from booking_payments
     where guest_id = p_guest_id and purpose = 'ticket' and status in ('failed', 'expired')
       and created_at > now() - interval '24 hours';
    if v_fails >= 3 then
      raise exception 'TOO_MANY_ATTEMPTS' using errcode = 'P0001',
        hint = 'three payment attempts failed in the last 24 hours';
    end if;

    begin
      -- A chain row: venue_id is NAMED as NULL (the column default would
      -- stamp a branch, or raise VENUE_REQUIRED). quoted_price_iqd is the unit
      -- price stamped now (DF-21).
      insert into booking_payments
        (venue_id, reservation_id, hold_id, guest_id, purpose, ticket_count, provider, sandbox,
         request_id, amount_iqd, quoted_price_iqd, locale, status, deadline_at)
      values
        (null, null, null, p_guest_id, 'ticket', p_count, p_provider,
         coalesce(v_profile.payment_sandbox, false), gen_random_uuid(), v_unit * p_count, v_unit,
         case when p_locale in ('en', 'ar') then p_locale else 'ar' end,
         'created', now() + interval '900 seconds')
      returning * into v;
    exception when unique_violation then
      -- Two taps at once: booking_payments_one_active_ticket let one through.
      select * into v from booking_payments
       where guest_id = p_guest_id and purpose = 'ticket' and status in ('created', 'pending')
       for update;
      if not found then
        raise;
      end if;
      v_reused := true;
    end;

    if not v_reused then
      perform app.deposit_event(v.id, 'begin', null, null, null,
                                jsonb_build_object('amount_iqd', v.amount_iqd, 'provider', v.provider,
                                                   'sandbox', v.sandbox, 'ticket_count', v.ticket_count));
      perform app.write_audit('ticket.purchase_begin', 'booking_payments', v.id::text, null,
                              jsonb_build_object('payment_id', v.id, 'ticket_count', v.ticket_count,
                                                 'amount_iqd', v.amount_iqd, 'sandbox', v.sandbox));
    end if;
  end if;

  return jsonb_build_object(
    'id',                  v.id,
    'request_id',          v.request_id,
    'purpose',             'ticket',
    'status',              v.status,
    'provider',            v.provider,
    'sandbox',             v.sandbox,
    'amount_iqd',          v.amount_iqd,
    'ticket_count',        v.ticket_count,
    'unit_price_iqd',      v.quoted_price_iqd,
    'deadline_at',         v.deadline_at,
    'form_url',            v.form_url,
    'provider_payment_id', v.provider_payment_id,
    'locale',              v.locale,
    'reused',              v_reused,
    'guest_phone',         v_profile.phone,
    'guest_name',          v_profile.full_name);
end $ticket_payment_prepare_0259$;

comment on function app.ticket_payment_prepare(uuid, int, text, text) is
  '0259. Service role (edge ticket-begin, on behalf of the JWT user p_guest_id). Returns the guest''s live ticket attempt (reused), or records a new one (status created, a chain row: no branch, hold or booking; ticket_count x today''s ticket price; 900 s window). Refusals in order: INVALID_ARGUMENT, ACCOUNT_REQUIRED, then (new attempts only) TICKET_COUNT_INVALID p_count, MATCHES_OFF (off at every open branch), PHONE_REQUIRED, TERMS_REQUIRED, MATCH_BANNED, TICKET_COUNT_INVALID wallet_limit (more than 3 x max_filling_matches_per_guest unused), TOO_MANY_ATTEMPTS (3 failed or expired in 24 h).';

revoke all on function app.ticket_payment_prepare(uuid, int, text, text) from public, anon, authenticated;
grant execute on function app.ticket_payment_prepare(uuid, int, text, text) to service_role;

-- ===========================================================================
-- 2. Wallet reads and the cash-out rule (read by 3–10 below)
-- ===========================================================================

-- R13: a purchase may be cashed out (or refunded on deletion) only while none
-- of its tickets is in a match, held by a request, or forfeited in a match
-- whose marks are still open (a restore could give it back). NULL when it
-- may; else {reason, count, until_at}: the first reason that applies, every
-- blocking ticket, and the latest time the blockers are known to clear (NULL
-- when one waits for a day close).
create or replace function app.ticket_cashout_block(p_payment_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $ticket_cashout_block_0259$
declare
  v_in_use     int := 0;
  v_reserved   int := 0;
  v_restorable int := 0;
  v_until      timestamptz;
  v_at         timestamptz;
  v_open_ended boolean := false;
  r            record;
begin
  -- In a match: back at the latest when the booking auto-completes (R37).
  select count(*), max(m.end_at + interval '3 hours')
    into v_in_use, v_until
    from match_tickets t
    join match_seats s on s.id = t.seat_id
    join matches m on m.id = s.match_id
   where t.purchase_payment_id = p_payment_id and t.status = 'in_use';

  -- Held by a pending request: back at the fill deadline, or at the start.
  select count(*), max(case when m.status = 'filling' then m.fill_deadline_at else m.start_at end)
    into v_reserved, v_at
    from match_tickets t
    join match_requests q on q.id = t.request_id
    join matches m on m.id = q.match_id
   where t.purchase_payment_id = p_payment_id and t.status = 'reserved';
  if v_at is not null then
    v_until := greatest(v_until, v_at);
  end if;

  -- Forfeited, but the desk may still correct the mark (0260's marks window).
  if exists (select 1 from match_tickets
              where purchase_payment_id = p_payment_id and status = 'forfeited') then
    for r in
      select m.id, m.status, m.end_at
        from match_tickets t
        join match_seats s on s.id = t.forfeited_seat_id
        join matches m on m.id = s.match_id
       where t.purchase_payment_id = p_payment_id and t.status = 'forfeited'
       order by t.id
    loop
      if app.match_marks_open(r.id) then
        v_restorable := v_restorable + 1;
        if r.status = 'booked' then
          v_until := greatest(v_until, r.end_at + interval '3 hours');
        else
          v_open_ended := true;
        end if;
      end if;
    end loop;
  end if;

  if v_in_use + v_reserved + v_restorable = 0 then
    return null;
  end if;
  return jsonb_build_object(
    'reason',   case when v_in_use > 0 then 'in_use'
                     when v_reserved > 0 then 'reserved'
                     else 'restorable' end,
    'count',    v_in_use + v_reserved + v_restorable,
    'until_at', case when v_open_ended then null else v_until end);
end $ticket_cashout_block_0259$;

comment on function app.ticket_cashout_block(uuid) is
  '0259. Internal (R13). NULL when the ticket purchase p_payment_id may be cashed out, else {reason: in_use|reserved|restorable (the first that applies), count (every blocking ticket), until_at (the latest known time they clear: a match end + 3 h, a fill deadline or a start; NULL when a restorable forfeit waits for its day close)}. Restorable is app.match_marks_open (0260) of the forfeiting seat''s match.';

revoke all on function app.ticket_cashout_block(uuid) from public, anon, authenticated;

-- One builder for the phone's wallet and the desk's Tickets panel, so the two
-- cannot disagree (money.md §5.7). p_staff adds the desk's fields.
create or replace function app.ticket_wallet(p_guest_id uuid, p_staff boolean)
returns jsonb
language plpgsql stable security definer set search_path = public as $ticket_wallet_0259$
declare
  v_profile   profiles%rowtype;
  v_price     bigint;
  v_cap       int;
  v_counts    jsonb;
  v_tickets   jsonb;
  v_purchases jsonb;
  v_pending   jsonb;
  v_out       jsonb;
begin
  select * into v_profile from profiles where id = p_guest_id;
  select ps.match_ticket_price_iqd, 3 * ps.max_filling_matches_per_guest
    into v_price, v_cap
    from platform_settings ps where ps.id;

  select jsonb_build_object(
           'available',  count(*) filter (where status = 'available'),
           'reserved',   count(*) filter (where status = 'reserved'),
           'in_use',     count(*) filter (where status = 'in_use'),
           'forfeited',  count(*) filter (where status = 'forfeited'),
           'cashed_out', count(*) filter (where status = 'cashed_out'))
    into v_counts
    from match_tickets where guest_id = p_guest_id;

  -- Every live ticket (oldest first, the order they are picked in), then the
  -- last 50 ended ones. match: the request's (reserved), the seat's (in_use)
  -- or the forfeiting seat's (forfeited) match.
  select coalesce(jsonb_agg(x.j order by x.live desc, x.sort_live, x.sort_ended desc, x.id), '[]'::jsonb)
    into v_tickets
    from (
      select t.id,
             t.status in ('available', 'reserved', 'in_use') as live,
             case when t.status in ('available', 'reserved', 'in_use') then t.created_at end as sort_live,
             case when t.status not in ('available', 'reserved', 'in_use')
                  then coalesce(t.forfeited_at, t.cashed_out_at, t.updated_at) end as sort_ended,
             jsonb_build_object(
               'id',                  t.id,
               'status',              t.status,
               'price_iqd',           t.price_iqd,
               'sandbox',             t.sandbox,
               'bought_at',           t.created_at,
               'purchase_payment_id', t.purchase_payment_id,
               'match',               case when m.id is null then null else jsonb_build_object(
                                        'match_id', m.id,
                                        'start_at', m.start_at,
                                        'venue_id', m.venue_id,
                                        'status',   m.status) end,
               'forfeited_at',        t.forfeited_at,
               'cashed_out_at',       t.cashed_out_at)
             || case when p_staff then jsonb_build_object('forfeited_venue_id', t.forfeited_venue_id)
                     else '{}'::jsonb end as j
        from (
          select * from match_tickets
           where guest_id = p_guest_id and status in ('available', 'reserved', 'in_use')
          union all
          (select * from match_tickets
            where guest_id = p_guest_id and status not in ('available', 'reserved', 'in_use')
            order by coalesce(forfeited_at, cashed_out_at, updated_at) desc, id
            limit 50)
        ) t
        left join match_requests q on t.status = 'reserved' and q.id = t.request_id
        left join match_seats s on s.id = case when t.status = 'in_use' then t.seat_id
                                               when t.status = 'forfeited' then t.forfeited_seat_id end
        left join matches m on m.id = coalesce(q.match_id, s.match_id)
    ) x;

  -- The last 20 purchases that took money (an attempt that failed or expired
  -- is not a purchase; a live one is `pending` below).
  select coalesce(jsonb_agg(x.j order by x.at desc, x.id), '[]'::jsonb)
    into v_purchases
    from (
      select bp.id,
             coalesce(bp.succeeded_at, bp.created_at) as at,
             jsonb_build_object(
               'payment_id',        bp.id,
               'request_id',        bp.request_id,
               'status',            bp.status,
               'ticket_count',      bp.ticket_count,
               'unit_price_iqd',    bp.quoted_price_iqd,
               'amount_iqd',        bp.amount_iqd,
               'bought_at',         bp.succeeded_at,
               'refund_reason',     bp.refund_reason,
               'refund_amount_iqd', bp.refund_amount_iqd,
               'refunded_at',       bp.refunded_at,
               'sandbox',           bp.sandbox)
             || case when not p_staff then '{}'::jsonb else jsonb_build_object(
                  'tickets', (select jsonb_build_object(
                                'available',  count(*) filter (where t.status = 'available'),
                                'reserved',   count(*) filter (where t.status = 'reserved'),
                                'in_use',     count(*) filter (where t.status = 'in_use'),
                                'forfeited',  count(*) filter (where t.status = 'forfeited'),
                                'cashed_out', count(*) filter (where t.status = 'cashed_out'))
                                from match_tickets t where t.purchase_payment_id = bp.id),
                  'cashout', (select case
                                when bp.status in ('refund_pending', 'refund_failed', 'refunded')
                                     and bp.refund_reason in ('ticket_cashout', 'account_deleted')
                                  then jsonb_build_object('allowed', false, 'reason', 'done', 'tickets', 0,
                                                          'amount_iqd', 0, 'until_at', null)
                                when bp.status <> 'succeeded'
                                  then jsonb_build_object('allowed', false, 'reason', 'not_succeeded', 'tickets', 0,
                                                          'amount_iqd', 0, 'until_at', null)
                                when blk.b is not null
                                  then jsonb_build_object('allowed', false, 'reason', blk.b->>'reason',
                                                          'tickets', av.n, 'amount_iqd', av.amount,
                                                          'until_at', blk.b->'until_at')
                                when av.n = 0
                                  then jsonb_build_object('allowed', false, 'reason', 'none_unused', 'tickets', 0,
                                                          'amount_iqd', 0, 'until_at', null)
                                else jsonb_build_object('allowed', true, 'reason', null, 'tickets', av.n,
                                                        'amount_iqd', av.amount, 'until_at', null) end
                                from (select count(*)::int as n, coalesce(sum(t.price_iqd), 0)::bigint as amount
                                        from match_tickets t
                                       where t.purchase_payment_id = bp.id and t.status = 'available') av
                                cross join lateral (select case when bp.status = 'succeeded'
                                                                then app.ticket_cashout_block(bp.id) end as b) blk))
                end as j
        from booking_payments bp
       where bp.guest_id = p_guest_id and bp.purpose = 'ticket'
         and bp.status in ('succeeded', 'refund_pending', 'refund_failed', 'refunded')
       order by coalesce(bp.succeeded_at, bp.created_at) desc, bp.id
       limit 20
    ) x;

  select jsonb_build_object(
           'request_id',   bp.request_id,
           'status',       bp.status,
           'ticket_count', bp.ticket_count,
           'amount_iqd',   bp.amount_iqd,
           'deadline_at',  bp.deadline_at)
         || case when p_staff then '{}'::jsonb else jsonb_build_object('form_url', bp.form_url) end
    into v_pending
    from booking_payments bp
   where bp.guest_id = p_guest_id and bp.purpose = 'ticket' and bp.status in ('created', 'pending')
   limit 1;

  v_out := jsonb_build_object(
    'price_iqd',     v_price,
    'max_available', v_cap,
    'sandbox',       coalesce(v_profile.payment_sandbox, false),
    'available',     (v_counts->>'available')::int,
    'reserved',      (v_counts->>'reserved')::int,
    'in_use',        (v_counts->>'in_use')::int,
    'tickets',       v_tickets,
    'purchases',     v_purchases,
    'pending',       v_pending,
    'server_now',    now());
  if p_staff then
    v_out := v_out || jsonb_build_object(
      'customer_id', p_guest_id,
      'forfeited',   (v_counts->>'forfeited')::int,
      'cashed_out',  (v_counts->>'cashed_out')::int);
  end if;
  return v_out;
end $ticket_wallet_0259$;

comment on function app.ticket_wallet(uuid, boolean) is
  '0259. Internal: the one builder of a guest''s ticket wallet, read by my_tickets (p_staff false) and guest_tickets (p_staff true: customer_id, forfeited and cashed_out counts, forfeited_venue_id per ticket, per-purchase ticket counts and cashout {allowed, reason, tickets, amount_iqd, until_at}, pending without form_url). No names.';

revoke all on function app.ticket_wallet(uuid, boolean) from public, anon, authenticated;

create or replace function app.my_tickets()
returns jsonb
language plpgsql stable security definer set search_path = public as $my_tickets_0259$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  if not exists (select 1 from profiles where id = v_uid and deleted_at is null) then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;
  return app.ticket_wallet(v_uid, false);
end $my_tickets_0259$;

comment on function app.my_tickets() is
  '0259. The caller''s open-match tickets (money.md §5.7 + guest.md §4.3): {price_iqd (today''s ticket price), max_available, sandbox, available, reserved, in_use, tickets[] (live, then the last 50 ended; match set for reserved, in_use and forfeited), purchases[] (last 20), pending (the live attempt or null), server_now}. AUTH_REQUIRED, ACCOUNT_REQUIRED (no profile, or deleted).';

revoke all on function app.my_tickets() from public, anon;
grant execute on function app.my_tickets() to authenticated;

create or replace function app.guest_tickets(p_customer_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $guest_tickets_0259$
begin
  if not app.is_staff('court_desk', 'manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  -- Chain data, like customer_flags: any branch reads it. A tombstoned
  -- customer is shown (their refunds are still moving).
  if p_customer_id is null or not exists (select 1 from profiles where id = p_customer_id) then
    raise exception 'CUSTOMER_NOT_FOUND' using errcode = 'P0001';
  end if;
  return app.ticket_wallet(p_customer_id, true);
end $guest_tickets_0259$;

comment on function app.guest_tickets(uuid) is
  '0259. Court desk, manager, owner, at any branch (chain data): a customer''s open-match tickets for the record''s Tickets panel: my_tickets'' shape plus customer_id, forfeited and cashed_out counts, forfeited_venue_id per ticket, and per purchase its ticket counts and cashout {allowed, reason: null|in_use|reserved|restorable|none_unused|not_succeeded|done, tickets, amount_iqd, until_at}. The operator shows the Cash out button and amount from it and never computes them. FORBIDDEN, CUSTOMER_NOT_FOUND.';

revoke all on function app.guest_tickets(uuid) from public, anon;
grant execute on function app.guest_tickets(uuid) to authenticated;

-- ===========================================================================
-- 3. Cash-out: the one writer of cashed_out
-- ===========================================================================
create or replace function app.tickets_cash_out(p_payment_id uuid, p_reason text, p_staff_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $tickets_cash_out_0259$
declare
  v        booking_payments%rowtype;
  v_block  jsonb;
  v_ids    uuid[];
  v_n      int;
  v_amount bigint;
  v_venue  uuid;
begin
  if p_reason is null or p_reason not in ('ticket_cashout', 'account_deleted') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_reason';
  end if;

  -- Lock order (money.md §8): the purchase's unused tickets in id order (a
  -- caller that holds them re-takes its own locks), then the purchase row.
  perform 1 from match_tickets
   where purchase_payment_id = p_payment_id and status = 'available'
   order by id
   for update;
  select * into v from booking_payments where id = p_payment_id for update;
  if not found or v.purpose <> 'ticket' then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status <> 'succeeded' then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v.status;
  end if;
  v_block := app.ticket_cashout_block(p_payment_id);
  if v_block is not null then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v_block->>'reason';
  end if;

  -- Every unused ticket of the purchase, including one released a moment
  -- ago (this statement sees it, and takes its lock).
  with gone as (
    update match_tickets
       set status             = 'cashed_out',
           cashed_out_at      = now(),
           cashout_payment_id = p_payment_id,
           updated_at         = now()
     where purchase_payment_id = p_payment_id and status = 'available'
    returning id, price_iqd
  )
  select array_agg(id order by id), count(*)::int, coalesce(sum(price_iqd), 0)::bigint
    into v_ids, v_n, v_amount
    from gone;
  if v_n = 0 then
    raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = 'none_unused';
  end if;

  if p_staff_id is not null then
    v_venue := app.resolve_venue();
  end if;
  insert into match_ticket_events (ticket_id, guest_id, type, venue_id, payment_id, actor_staff_id, code)
  select t.id, t.guest_id, 'cashed_out', v_venue, p_payment_id, p_staff_id, p_reason
    from match_tickets t
   where t.id = any (v_ids)
   order by t.id;

  -- DF-21: the price PAID comes back, never today's price. One Qi refund per
  -- purchase (0241:56-57).
  perform app.deposit_begin_refund(p_payment_id, p_reason, v_amount,
                                   v_n || case when v_n = 1 then ' ticket' else ' tickets' end);
  perform app.deposit_nudge();
  return jsonb_build_object('tickets', v_n, 'amount_iqd', v_amount);
end $tickets_cash_out_0259$;

comment on function app.tickets_cash_out(uuid, text, uuid) is
  '0259. Internal: the one writer of cashed_out. Moves every available ticket of the succeeded ticket purchase p_payment_id to cashed_out (one cashed_out event each, code p_reason: ticket_cashout | account_deleted) and starts ONE Qi refund of the price paid for them (DF-21). PAYMENT_NOT_FOUND; PAYMENT_STATE (not succeeded, blocked by ticket_cashout_block, or nothing unused). Locks the purchase''s available tickets (id order), then the row. Returns {tickets, amount_iqd}.';

revoke all on function app.tickets_cash_out(uuid, text, uuid) from public, anon, authenticated;

create or replace function app.ticket_cashout(p_customer_id uuid, p_purchase_payment_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $ticket_cashout_0259$
declare
  v       booking_payments%rowtype;
  v_block jsonb;
  v_pass  int;
  v_res   jsonb;
begin
  if not app.is_staff('manager', 'owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;
  if p_customer_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_customer_id';
  end if;
  if p_purchase_payment_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_purchase_payment_id';
  end if;

  -- Pass 1 reads without locks (a TICKET_IN_USE answer waits on nobody, C15);
  -- then the purchase's unused tickets (id order) and the row are locked, and
  -- pass 2 checks again in new statements, so a join that committed meanwhile
  -- is seen (conc-D17).
  for v_pass in 1 .. 2 loop
    if v_pass = 2 then
      perform 1 from match_tickets
       where purchase_payment_id = p_purchase_payment_id and status = 'available'
       order by id
       for update;
      select * into v from booking_payments where id = p_purchase_payment_id for update;
    else
      select * into v from booking_payments where id = p_purchase_payment_id;
    end if;
    if v.id is null or v.purpose <> 'ticket' or v.guest_id is distinct from p_customer_id then
      raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    if v.status in ('refund_pending', 'refund_failed', 'refunded') and v.refund_reason = 'ticket_cashout' then
      return jsonb_build_object(
        'duplicate',          true,
        'payment_id',         v.id,
        'tickets_cashed_out', (select count(*) from match_tickets
                                where purchase_payment_id = v.id and status = 'cashed_out'),
        'refund_amount_iqd',  v.refund_amount_iqd,
        'status',             v.status);
    end if;
    if v.status <> 'succeeded' then
      raise exception 'PAYMENT_STATE' using errcode = 'P0001', detail = v.status;
    end if;
    v_block := app.ticket_cashout_block(v.id);
    if v_block is not null then
      raise exception 'TICKET_IN_USE' using errcode = 'P0001', detail = v_block::text,
        hint = 'a ticket of this purchase is in a match, held by a request, or can still be restored';
    end if;
    if not exists (select 1 from match_tickets
                    where purchase_payment_id = v.id and status = 'available') then
      raise exception 'NO_UNUSED_TICKETS' using errcode = 'P0001';
    end if;
  end loop;

  v_res := app.tickets_cash_out(v.id, 'ticket_cashout', auth.uid());
  perform app.write_audit('ticket.cashout', 'booking_payments', v.id::text, null,
                          jsonb_build_object('customer_id', p_customer_id, 'payment_id', v.id,
                                             'tickets', v_res->'tickets', 'amount_iqd', v_res->'amount_iqd'));
  return jsonb_build_object(
    'duplicate',          false,
    'payment_id',         v.id,
    'tickets_cashed_out', (v_res->>'tickets')::int,
    'refund_amount_iqd',  (v_res->>'amount_iqd')::bigint,
    'status',             'refund_pending');
end $ticket_cashout_0259$;

comment on function app.ticket_cashout(uuid, uuid) is
  '0259. Manager, owner, at any branch (chain money; not PIN-gated: the money goes back to the card it came from). Cash-out of one ticket purchase (OM-48): all its unused tickets leave the wallet now and ONE Qi refund of the price paid is requested. Refusals: FORBIDDEN, INVALID_ARGUMENT, PAYMENT_NOT_FOUND (not this customer''s ticket purchase), PAYMENT_STATE (detail the status: not succeeded), TICKET_IN_USE (detail the JSON text {reason: in_use|reserved|restorable, count, until_at}, R13), NO_UNUSED_TICKETS. A purchase already cashed out answers {duplicate: true, …}. State-idempotent, no key.';

revoke all on function app.ticket_cashout(uuid, uuid) from public, anon;
grant execute on function app.ticket_cashout(uuid, uuid) to authenticated;

-- DF-20 (R13, R25): a deleted guest's unused tickets go back to the card, one
-- refund per purchase, once none of the purchase's tickets is locked,
-- reserved or restorable. Only succeeded purchases enter the queue, and the
-- blocked ones are filtered in the query, so it cannot jam. Callers (lane
-- DB): delete_my_account (0264) last, and the sweep (0263) last.
create or replace function app.ticket_refund_deleted(p_guest_id uuid default null)
returns int
language plpgsql security definer set search_path = public as $ticket_refund_deleted_0259$
declare
  r       record;
  v_n     int := 0;
  v_free  int;
  v_taken int;
begin
  for r in
    select bp.id
      from booking_payments bp
      join profiles p on p.id = bp.guest_id
     where bp.purpose = 'ticket'
       and bp.status = 'succeeded'
       and p.deleted_at is not null
       and (p_guest_id is null or bp.guest_id = p_guest_id)
       and exists (select 1 from match_tickets t
                    where t.purchase_payment_id = bp.id and t.status = 'available')
       and app.ticket_cashout_block(bp.id) is null
     order by bp.succeeded_at, bp.id
     limit 50
  loop
    begin
      select count(*) into v_free from match_tickets
       where purchase_payment_id = r.id and status = 'available';
      -- Never wait on a ticket another body holds: leave it for the next call.
      select count(*) into v_taken from (
        select 1 from match_tickets
         where purchase_payment_id = r.id and status = 'available'
         order by id
         for update skip locked) x;
      if v_taken < v_free then
        continue;
      end if;
      perform app.tickets_cash_out(r.id, 'account_deleted', null);
      v_n := v_n + 1;
    exception when others then
      raise warning 'ticket_refund_deleted: purchase % left for the next run: % (%)', r.id, sqlerrm, sqlstate;
    end;
  end loop;
  return v_n;
end $ticket_refund_deleted_0259$;

comment on function app.ticket_refund_deleted(uuid) is
  '0259. Internal, service role (DF-20): refunds every succeeded ticket purchase of a deleted guest (only p_guest_id when given) that has unused tickets and nothing in use, reserved or restorable (R13): all its unused tickets to cashed_out, one Qi refund (account_deleted). At most 50 purchases a call; a purchase whose tickets another body holds is left for the next call; a failure is a warning, never an error. Returns the number of purchases refunded. Called last by delete_my_account (0264) and the match sweep (0263).';

revoke all on function app.ticket_refund_deleted(uuid) from public, anon, authenticated;
grant execute on function app.ticket_refund_deleted(uuid) to service_role;

-- ===========================================================================
-- 4. SUCCESS on a ticket purchase
-- ===========================================================================
-- The caller (deposit_apply) holds the purchase row lock. Never raises on a
-- valid row: a raise would roll back deposit_apply, the webhook would answer
-- 500 and the reconciler would loop. MD-2: a valid SUCCESS always creates the
-- tickets, however late; only a vanished or deleted payer is refunded.
create or replace function app.ticket_settle_success(p_payment_id uuid)
returns text
language plpgsql security definer set search_path = public as $ticket_settle_success_0259$
declare
  v         booking_payments%rowtype;
  v_deleted boolean;
  v_n       int;
begin
  select * into v from booking_payments where id = p_payment_id;
  if not found or v.purpose <> 'ticket' then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  -- A replay: the tickets exist already.
  if exists (select 1 from match_tickets where purchase_payment_id = v.id) then
    return v.status;
  end if;

  update booking_payments
     set status       = 'succeeded',
         succeeded_at = coalesce(succeeded_at, now()),
         failure_code = null,
         updated_at   = now()
   where id = v.id
   returning * into v;

  -- A profile hard-deleted by an admin: nobody to hold a ticket.
  if v.guest_id is null then
    perform app.deposit_begin_refund(v.id, 'account_deleted', null, 'payer gone at SUCCESS');
    perform app.deposit_nudge();
    return 'refund_pending';
  end if;

  with bought as (
    insert into match_tickets (guest_id, status, price_iqd, purchase_payment_id, sandbox)
    select v.guest_id, 'available', v.quoted_price_iqd, v.id, v.sandbox
      from generate_series(1, v.ticket_count)
    returning id, guest_id
  )
  insert into match_ticket_events (ticket_id, guest_id, type, payment_id)
  select b.id, b.guest_id, 'bought', v.id
    from bought b
   order by b.id;
  get diagnostics v_n = row_count;
  perform app.deposit_event(v.id, 'decision', null, null, format('tickets: %s', v_n), '{}'::jsonb);

  -- The payer deleted the account while paying: the tickets go straight back
  -- (DF-20, situation 4).
  select deleted_at is not null into v_deleted from profiles where id = v.guest_id;
  if coalesce(v_deleted, false) then
    perform app.tickets_cash_out(v.id, 'account_deleted', null);
    return 'refund_pending';
  end if;

  perform app.write_audit('ticket.purchase', 'booking_payments', v.id::text, null,
                          jsonb_build_object('payment_id', v.id, 'ticket_count', v.ticket_count,
                                             'amount_iqd', v.amount_iqd, 'sandbox', v.sandbox));
  -- No push: the payment screen is open.
  return 'succeeded';
end $ticket_settle_success_0259$;

comment on function app.ticket_settle_success(uuid) is
  '0259. Internal (deposit_apply, which holds the purchase row lock). SUCCESS on a ticket purchase: succeeded, then ticket_count available tickets at the unit price paid (one bought event each). A payer gone (guest_id NULL) is refunded account_deleted with no tickets; a payer deleted meanwhile gets the tickets cashed straight out (account_deleted). A replay returns the status. Never raises on a valid row.';

revoke all on function app.ticket_settle_success(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 5. deposit_apply (re-issued from 20260927000242_online_deposit_rpcs.sql:605)
--    The ticket branch: no court, booking or branch; SUCCESS creates tickets.
--    The deposit locks and the deposit_settle_success call come FIRST in the
--    text (money.md §8), so the lock walker reads the deposit path in order.
-- ===========================================================================
create or replace function app.deposit_apply(
  p_request_id          uuid,
  p_provider_payment_id text,
  p_provider_status     text,
  p_amount              numeric,
  p_currency            text,
  p_canceled            boolean,
  p_source              text,
  p_signature_ok        boolean default null,
  p_raw                 jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_apply_0259$
declare
  v        booking_payments%rowtype;
  r        reservations%rowtype;
  v_status text := upper(btrim(coalesce(p_provider_status, '')));
  v_kind   text;
  v_code   text;
  v_new    text;
begin
  if p_source is null or p_source not in ('webhook', 'poll', 'reconcile') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_source';
  end if;
  p_provider_payment_id := nullif(btrim(coalesce(p_provider_payment_id, '')), '');

  select * into v from booking_payments where request_id = p_request_id;
  if not found and p_provider_payment_id is not null then
    select * into v from booking_payments where provider_payment_id = p_provider_payment_id;
  end if;
  if v.id is null then
    perform app.deposit_event(null, p_source, p_provider_status, p_signature_ok, 'unmatched', p_raw);
    return jsonb_build_object('matched', false);
  end if;

  if v.purpose = 'deposit' then
    -- Lock order: court → reservations → booking_payments.
    select * into r from reservations where id = v.reservation_id;
    perform app.lock_court(r.court_id);
    perform 1 from reservations where id in (v.reservation_id, v.hold_id) order by id for update;
    select * into v from booking_payments where id = v.id for update;
    perform set_config('app.venue_id', v.venue_id::text, true);
  else
    -- 0259: a ticket purchase is a chain row with no court, booking or
    -- branch: only the row itself is locked.
    select * into v from booking_payments where id = v.id for update;
  end if;

  perform app.deposit_event(v.id, p_source, p_provider_status, p_signature_ok, null, p_raw);

  -- Learn Qi's id if we never heard it (create timed out after Qi made it).
  if v.provider_payment_id is null and p_provider_payment_id is not null then
    update booking_payments set provider_payment_id = p_provider_payment_id where id = v.id;
  end if;

  v_kind := case
    when v_status = 'SUCCESS' then 'success'
    when v_status in ('FAILED', 'ERROR', 'AUTHENTICATION_FAILED') then 'failed'
    when v_status in ('EXPIRED', 'NOT_FOUND', 'GIVE_UP') then 'expired'
    when coalesce(p_canceled, false) then 'expired'
    else 'open' end;
  v_code := case
    when v_status = 'AUTHENTICATION_FAILED' then 'auth_failed'
    when v_status = 'ERROR' then 'bank_error'
    when v_status = 'FAILED' then 'declined'
    when coalesce(p_canceled, false) then 'cancelled'
    else null end;

  update booking_payments
     set provider_status = coalesce(left(nullif(v_status, ''), 64), provider_status),
         last_checked_at = now(),
         claimed_at      = null,
         status          = case when status = 'created' and v_kind = 'open'
                                     and coalesce(provider_payment_id, p_provider_payment_id) is not null
                                then 'pending' else status end,
         updated_at      = now()
   where id = v.id
   returning * into v;

  v_new := v.status;

  if v_kind = 'success' then
    if v.status in ('created', 'pending', 'failed', 'expired') then
      -- Amount and currency to the dinar, or it is not our payment (plan §3.2).
      -- A ticket purchase with the wrong amount creates no ticket: the whole
      -- row is refunded (MD-2).
      if p_amount is null or upper(coalesce(p_currency, '')) <> 'IQD'
         or abs(p_amount - v.amount_iqd) >= 1 then
        update booking_payments
           set status = 'succeeded', succeeded_at = coalesce(succeeded_at, now()), updated_at = now()
         where id = v.id;
        perform app.deposit_begin_refund(v.id, 'amount_mismatch', null,
                                         format('Qi said %s %s', p_amount, p_currency));
        perform app.deposit_nudge();
        v_new := 'refund_pending';
      elsif v.purpose = 'deposit' then
        v_new := app.deposit_settle_success(v.id);
      else
        v_new := app.ticket_settle_success(v.id);
      end if;
    end if;
    -- succeeded / refund_* / refunded: a replay. Logged above, nothing moves.

  elsif v_kind = 'failed' and v.status in ('created', 'pending') then
    update booking_payments
       set status = 'failed', failed_at = now(), failure_code = v_code, updated_at = now()
     where id = v.id;
    v_new := 'failed';
    -- The hold stays until its deadline: the guest may try again or, when the
    -- deposit is optional, confirm and pay at the desk.

  elsif v_kind = 'expired' and v.status in ('created', 'pending') then
    update booking_payments
       set status = 'expired', expired_at = now(), failure_code = v_code, updated_at = now()
     where id = v.id;
    v_new := 'expired';
    -- The window is over: give the slot back unless the guest confirmed it
    -- meanwhile or started another attempt. A ticket purchase holds no slot.
    if v.purpose = 'deposit'
       and not exists (select 1 from booking_payments o
                        where o.hold_id = v.hold_id and o.id <> v.id and o.status in ('created', 'pending')) then
      update reservations
         set status = 'expired'
       where id = v.hold_id and kind = 'hold' and status = 'pending';
    end if;
  end if;

  return jsonb_build_object('matched', true, 'id', v.id, 'request_id', v.request_id,
                            'status', v_new, 'reservation_id',
                            (select reservation_id from booking_payments where id = v.id),
                            'purpose', v.purpose, 'ticket_count', v.ticket_count);
end $deposit_apply_0259$;

comment on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) is
  '0242, 0259. Service role. The ONLY writer of a payment outcome, deposits and open-match ticket purchases alike. Logs the message, then: SUCCESS for exactly amount_iqd in IQD books the slot of a deposit (confirm the hold, or re-create a swept one) or creates a ticket purchase''s tickets (app.ticket_settle_success, however late) and marks succeeded in the same transaction, or goes to refund_pending (slot_lost, venue_offline, amount_mismatch, duplicate_success; a ticket purchase only amount_mismatch or account_deleted); FAILED/ERROR/AUTHENTICATION_FAILED → failed (hold kept); EXPIRED/cancelled/NOT_FOUND/GIVE_UP → expired (a deposit''s hold released). A late SUCCESS after failed/expired is honoured. Anything else only updates provider_status. Unknown request → logged unmatched. The result carries purpose and ticket_count.';

revoke all on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_apply(uuid, text, text, numeric, text, boolean, text, boolean, jsonb) to service_role;

-- ===========================================================================
-- 6. deposit_status (re-issued from 20260927000242_online_deposit_rpcs.sql:266)
--    Purpose-aware. A deposit reads as before (plus purpose and ticket_count);
--    a ticket purchase only by its guest (its venue is NULL, so no staff
--    member is_staff_at it: the desk reads tickets through guest_tickets).
-- ===========================================================================
create or replace function app.deposit_status(p_request_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = public as $deposit_status_0259$
declare
  v_uid      uuid := auth.uid();
  v          booking_payments%rowtype;
  r          reservations%rowtype;
  h          reservations%rowtype;
  v_attempts int;
  v_mine     jsonb;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;
  select * into v from booking_payments where request_id = p_request_id;
  -- Someone else's ref and an unknown ref read the same (0038 #7).
  if not found
     or (v.guest_id is distinct from v_uid
         and not app.is_staff_at(v.venue_id, 'court_desk', 'manager', 'owner')) then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  if v.purpose = 'ticket' then
    select count(*) into v_attempts from booking_payments
     where guest_id = v.guest_id and purpose = 'ticket' and status in ('failed', 'expired')
       and created_at > now() - interval '24 hours';
    select jsonb_build_object(
             'from_this_purchase', count(*) filter (where purchase_payment_id = v.id),
             'available',          count(*) filter (where status = 'available'),
             'reserved',           count(*) filter (where status = 'reserved'),
             'in_use',             count(*) filter (where status = 'in_use'))
      into v_mine
      from match_tickets where guest_id = v.guest_id;
    return jsonb_build_object(
      'request_id',        v.request_id,
      'purpose',           'ticket',
      'status',            v.status,
      'failure_code',      v.failure_code,
      'amount_iqd',        v.amount_iqd,
      'ticket_count',      v.ticket_count,
      'unit_price_iqd',    v.quoted_price_iqd,
      'price_iqd',         v.amount_iqd,
      'rest_iqd',          0,
      'deadline_at',       v.deadline_at,
      'form_url',          case when v.status in ('created', 'pending') then v.form_url end,
      'refund_reason',     v.refund_reason,
      'refund_amount_iqd', v.refund_amount_iqd,
      'refunded_at',       v.refunded_at,
      'sandbox',           v.sandbox,
      'deposit_mode',      null,
      'attempts_left',     greatest(3 - v_attempts, 0),
      'hold_live',         false,
      'reservation',       null,
      'tickets',           v_mine,
      'server_now',        now());
  end if;

  select * into r from reservations where id = v.reservation_id;
  select * into h from reservations where id = v.hold_id;
  select count(*) into v_attempts from booking_payments where hold_id = v.hold_id;

  return jsonb_build_object(
    'request_id',        v.request_id,
    'status',            v.status,
    'failure_code',      v.failure_code,
    'amount_iqd',        v.amount_iqd,
    'price_iqd',         coalesce(r.price_iqd, v.quoted_price_iqd),
    'rest_iqd',          greatest(coalesce(r.price_iqd, v.quoted_price_iqd) - v.amount_iqd, 0),
    'deadline_at',       v.deadline_at,
    'form_url',          case when v.status in ('created', 'pending') then v.form_url end,
    'refund_reason',     v.refund_reason,
    'refund_amount_iqd', v.refund_amount_iqd,
    'refunded_at',       v.refunded_at,
    'sandbox',           v.sandbox,
    'deposit_mode',      app.deposit_mode_for(v.guest_id, v.venue_id),
    'attempts_left',     greatest(3 - v_attempts, 0),
    'hold_live',         (h.kind = 'hold' and h.status = 'pending' and h.hold_expires_at > now()),
    'reservation',       jsonb_build_object(
                           'id',       r.id,
                           'kind',     r.kind,
                           'status',   r.status,
                           'court_id', r.court_id,
                           'start_at', r.start_at,
                           'end_at',   r.end_at,
                           'venue_id', r.venue_id),
    'purpose',           'deposit',
    'ticket_count',      null,
    'server_now',        now());
end $deposit_status_0259$;

comment on function app.deposit_status(uuid) is
  '0242, 0259. One payment attempt by its request_id, as the guest''s payment screen renders it (contracts §2.2), now with purpose. A deposit: the guest reads their own, court desk, manager and owner their branch''s. A ticket purchase (money.md §5.5): only its guest; deposit_mode null, reservation null, hold_live false, unit_price_iqd, ticket_count, attempts_left from the guest''s failed or expired ticket attempts in 24 h, and tickets {from_this_purchase, available, reserved, in_use}. PAYMENT_NOT_FOUND for an unknown or foreign ref alike.';

revoke all on function app.deposit_status(uuid) from public, anon;
grant execute on function app.deposit_status(uuid) to authenticated;

-- ===========================================================================
-- 7. deposit_refund_apply (re-issued from 20260927000242_online_deposit_rpcs.sql:848)
--    A ticket purchase's refund takes no court or booking lock and sets no
--    branch; refunded, it tells the guest through Guest's app.match_notify
--    (0261; route tickets, R3). The push never fails the money write, and the
--    call binds late: a refund applied before 0261 only loses its push. A
--    refund outcome never moves a ticket (they are cashed_out already).
--    Deposit rows are verbatim.
-- ===========================================================================
create or replace function app.deposit_refund_apply(
  p_payment_id         uuid,
  p_outcome            text,
  p_provider_status    text,
  p_refund_provider_id text,
  p_raw                jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer set search_path = public as $deposit_refund_apply_0259$
declare
  v       booking_payments%rowtype;
  r       reservations%rowtype;
  v_token boolean;
begin
  if p_outcome is null or p_outcome not in ('succeeded', 'failed', 'pending', 'unknown') then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_outcome';
  end if;
  select * into v from booking_payments where id = p_payment_id;
  if not found then
    raise exception 'PAYMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.purpose = 'deposit' then
    -- Lock order court → reservations → booking_payments, as deposit_apply.
    perform app.lock_court((select court_id from reservations where id = v.reservation_id));
    perform 1 from reservations where id = v.reservation_id for update;
    select * into v from booking_payments where id = p_payment_id for update;
    perform set_config('app.venue_id', v.venue_id::text, true);
  else
    select * into v from booking_payments where id = p_payment_id for update;
  end if;

  perform app.deposit_event(v.id, 'refund', p_provider_status, null, p_outcome, p_raw);

  if v.status <> 'refund_pending' then
    return jsonb_build_object('id', v.id, 'status', v.status, 'changed', false);
  end if;

  if p_outcome = 'succeeded' then
    update booking_payments
       set status = 'refunded', refunded_at = now(),
           refund_provider_id = coalesce(left(p_refund_provider_id, 200), refund_provider_id),
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
    if v.purpose = 'deposit' then
      perform app.write_audit('deposit.refunded', 'booking_payments', v.id::text, null,
                              jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'reason', v.refund_reason,
                                                 'reservation_id', v.reservation_id));
      -- Tell the guest (their phone may have been closed for days).
      select * into r from reservations where id = v.reservation_id;
      select expo_push_token is not null into v_token from profiles where id = v.guest_id;
      if coalesce(v_token, false) and not v.sandbox then
        insert into notification_outbox (profile_id, kind, payload)
        values (v.guest_id, 'deposit_refunded', jsonb_build_object(
          'reservation_id', v.reservation_id,
          'court_id',       r.court_id,
          'start_at',       r.start_at,
          'amount_iqd',     v.refund_amount_iqd,
          'request_id',     v.request_id));
        perform app.push_nudge();
      end if;
    else
      perform app.write_audit('ticket.refunded', 'booking_payments', v.id::text, null,
                              jsonb_build_object('amount_iqd', v.refund_amount_iqd, 'reason', v.refund_reason,
                                                 'ticket_count', v.ticket_count));
      if not v.sandbox and v.guest_id is not null then
        begin
          perform app.match_notify(null, array[v.guest_id], 'tickets_refunded', '{}'::jsonb, null, null,
                                   'tickets_refunded:' || v.request_id);
        exception when others then
          raise warning 'deposit_refund_apply: tickets_refunded push for % not queued: % (%)',
            v.id, sqlerrm, sqlstate;
        end;
      end if;
    end if;
  elsif p_outcome = 'failed' then
    update booking_payments
       set status = 'refund_failed', refund_attempts = refund_attempts + 1,
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
    perform app.write_audit('deposit.refund_failed', 'booking_payments', v.id::text, null,
                            jsonb_build_object('provider_status', p_provider_status));
  else
    update booking_payments
       set refund_attempts = refund_attempts + 1,
           status = case when p_outcome = 'unknown' and refund_attempts + 1 >= 10
                         then 'refund_failed' else status end,
           claimed_at = null, updated_at = now()
     where id = v.id
     returning * into v;
  end if;

  return jsonb_build_object('id', v.id, 'status', v.status, 'changed', true);
end $deposit_refund_apply_0259$;

comment on function app.deposit_refund_apply(uuid, text, text, text, jsonb) is
  '0242, 0259. Service role (edge deposit-reconcile). refund_pending → refunded (a deposit_refunded push for a deposit; tickets_refunded through app.match_notify for a ticket purchase, never for sandbox, never failing the write) | refund_failed (a manager sees it in deposit_attention); pending/unknown count an attempt, and ten unanswered attempts give up to refund_failed. A ticket purchase takes no court or booking lock.';

revoke all on function app.deposit_refund_apply(uuid, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function app.deposit_refund_apply(uuid, text, text, text, jsonb) to service_role;

-- ===========================================================================
-- 8. The sandbox flip guard (C20, MD-15)
-- ===========================================================================
-- Tickets bought on the review account's sandbox only seat sandbox matches,
-- and are cashed out on Qi's sandbox. Flipping payment_sandbox under live
-- tickets would strand them: cash them out (or use them) first.
create or replace function app.trg_profile_sandbox_tickets() returns trigger
language plpgsql security definer set search_path = public as $trg_profile_sandbox_tickets_0259$
begin
  if exists (select 1 from match_tickets
              where guest_id = new.id and status in ('available', 'reserved', 'in_use'))
     or exists (select 1 from booking_payments
                 where guest_id = new.id and purpose = 'ticket' and status in ('created', 'pending')) then
    raise exception 'INVALID_TRANSITION' using errcode = 'P0001', detail = 'live_tickets',
      hint = 'this profile holds live open-match tickets or a ticket payment in progress';
  end if;
  return new;
end $trg_profile_sandbox_tickets_0259$;

comment on function app.trg_profile_sandbox_tickets() is
  '0259. Trigger profiles_sandbox_tickets: a payment_sandbox flip is refused INVALID_TRANSITION detail live_tickets while the profile holds a ticket available, reserved or in_use, or a ticket attempt created or pending (C20). The only such guard.';

revoke all on function app.trg_profile_sandbox_tickets() from public, anon, authenticated;

drop trigger if exists profiles_sandbox_tickets on profiles;
create trigger profiles_sandbox_tickets
  before update of payment_sandbox on profiles
  for each row
  when (old.payment_sandbox is distinct from new.payment_sandbox)
  execute function app.trg_profile_sandbox_tickets();
