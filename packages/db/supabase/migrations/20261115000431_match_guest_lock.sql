-- ===========================================================================
-- 0431 match_guest_lock (audit 2026-11-15, finding 27; Majed: fix what is left).
--
-- While open matches are paid at the desk (0370, the mode live while online
-- payments are off), app.ticket_pick returns nulls and locks nothing. The
-- cross-branch time-clash rule (R41: one guest, one live seat at a time across
-- branches) relied on ticket_pick locking every available ticket the guest
-- holds; each join, start, request and approval otherwise takes only its own
-- branch's mutex. Two joins by one guest at two branches at the same moment
-- both passed their clash checks and seated the guest in overlapping matches.
--
-- app.lock_match_guest(guest) is a transaction advisory lock per guest, taken
-- only in the pay-at-desk branches of ticket_pick, where these flows lock no
-- ticket rows at all; scripts/lib/lock-order.mjs lists it in LEAF_ADVISORY
-- with that reason. Signatures and callers are unchanged.
-- **0431 holds ticket_pick** (0370 no longer).
--
-- covered by tests/lock-order-matches.test.ts and tests/match-guest-lock-0431.test.ts
-- ===========================================================================

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.lock_match_guest(p_guest uuid) returns void
language plpgsql security definer set search_path = public as $lock_match_guest_0431$
begin
  if p_guest is not null then
    perform pg_advisory_xact_lock(hashtextextended('app.matches:guest:' || p_guest::text, 0));
  end if;
end $lock_match_guest_0431$;

comment on function app.lock_match_guest(uuid) is
  '0431. Internal. One guest''s open-match seats across every branch: pg_advisory_xact_lock on ''app.matches:guest:''||guest (0042 hashing). Taken by app.ticket_pick only while matches are paid at the desk, where no ticket rows are locked; a leaf in scripts/lib/lock-order.mjs (LEAF_ADVISORY), not ranked.';

revoke all on function app.lock_match_guest(uuid) from public, anon, authenticated;

-- ticket_pick: re-issued from 20261025000370_open_matches_pay_at_desk.sql.
create or replace function app.ticket_pick(p_guest_id uuid, p_count int, p_sandbox boolean,
                                           p_request_id uuid default null)
returns uuid[]
language plpgsql security definer set search_path = public as $ticket_pick_0431$
declare
  v_ids uuid[];
  v_k   int;
  v_n   int;
begin
  if p_guest_id is null then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_guest_id';
  end if;

  -- An approval: every ticket its own request reserved.
  if p_request_id is not null then
    select coalesce(array_agg(x.id order by x.id), '{}'::uuid[]) into v_ids
      from (select k.id from match_tickets k
             where k.request_id = p_request_id and k.status = 'reserved' and k.guest_id = p_guest_id
             order by k.id
             for update) x;
    -- 0370: pay at the desk. A request made while matches took no tickets
    -- reserved none; its seats carry no ticket either.
    if cardinality(v_ids) = 0 and app.match_pay_at_desk() then
      perform app.lock_match_guest(p_guest_id);   -- 0431, as below
      select q.seats_requested into v_n from match_requests q
       where q.id = p_request_id and q.guest_id = p_guest_id;
      if v_n is not null then
        return array_fill(null::uuid, array[v_n]);
      end if;
    end if;
    return v_ids;
  end if;

  if p_count is null or p_count < 1 then
    raise exception 'INVALID_ARGUMENT' using errcode = 'P0001', detail = 'p_count';
  end if;
  -- 0370: pay at the desk. No ticket is picked; one null per seat, so the
  -- callers' counts and match_take_seats work unchanged.
  if app.match_pay_at_desk() then
    -- 0431: no ticket rows to lock, so the guest is locked instead. The
    -- cross-branch time-clash rule (R41) relied on this call holding the
    -- guest's tickets: two joins at two branches at once each took only
    -- their own branch's mutex and both seated the guest in overlapping
    -- matches. The second now waits here until the first commits, and the
    -- caller's clash check after this call sees its seats.
    perform app.lock_match_guest(p_guest_id);
    return array_fill(null::uuid, array[p_count]);
  end if;
  -- Every available ticket of the guest in this sandbox (DF-19), locked in id
  -- order; the oldest p_count by (created_at, id) are handed back.
  select coalesce(array_agg(x.id order by x.created_at, x.id), '{}'::uuid[]) into v_ids
    from (select k.id, k.created_at from match_tickets k
           where k.guest_id = p_guest_id and k.status = 'available' and k.sandbox = coalesce(p_sandbox, false)
           order by k.id
           for update) x;
  v_k := cardinality(v_ids);
  if v_k < p_count then
    raise exception 'NEED_TICKETS' using errcode = 'P0001',
      detail = format('{"needed":%s,"available":%s,"buy":%s}', p_count, v_k, p_count - v_k);
  end if;
  return v_ids[1:p_count];
end $ticket_pick_0431$;

comment on function app.ticket_pick(uuid, int, boolean, uuid) is
  '0260, 0370, 0431. Internal. Pay at the desk (0370, match_pay_at_desk()): no ticket is picked, the guest is locked instead (app.lock_match_guest, 0431: one guest''s seats across branches) and the result is p_count nulls (for an approval, the request''s seats_requested nulls when it reserved none). Without a request: locks (one id-ordered statement) the guest''s available tickets of sandbox p_sandbox and returns the p_count oldest; fewer -> NEED_TICKETS, detail {"needed","available","buy"}. With p_request_id: that request''s reserved tickets of the guest (all), locked in id order. Moves nothing: ticket_lock does.';

revoke all on function app.ticket_pick(uuid, int, boolean, uuid) from public, anon, authenticated;
