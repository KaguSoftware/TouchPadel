set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0387 safe_balance_guard — a wage, an advance or a coach statement is never
-- paid from the safe with money the safe does not hold (F-12, Majed
-- 2026-11-01: "Block, Not enough money in the safe").
--
-- 0343 let a linked payment take the safe below zero silently: mark_wage_paid,
-- give_wage_advance and coach_statement_mark_paid (0344) all write their safe
-- row through app.main_cash_record_payment, which never looked at the balance.
-- That one writer now does, under the branch's safe lock it already takes
-- (app.lock_main_cash, so two payments can never both pass on the same money):
-- paid from the safe, an amount above the balance raises SAFE_NOT_ENOUGH, hint
-- the balance in IQD (never below 0), and the caller's whole transaction rolls
-- back with it (the wage stays unpaid, the advance ungiven, the statement
-- approved, the replay key unclaimed). Paid by bank transfer moves nothing in
-- the safe and is never refused. A cost logged on the Safe page itself
-- (main_cash_pay) keeps 0343's rule, which Majed did not change: it may still
-- go below zero, with the page's own warning.
--
-- Signature unchanged; the three callers are not re-issued.

create or replace function app.main_cash_record_payment(
  p_venue     uuid,
  p_amount    bigint,
  p_category  text,
  p_payee     text,
  p_paid_from text,
  p_source    text,
  p_source_id uuid
) returns uuid
language plpgsql security definer set search_path = public as $main_cash_record_payment_0387$
declare
  v_id      uuid;
  v_balance bigint;
begin
  if p_paid_from is null or p_amount is null or p_amount <= 0 then
    return null;
  end if;
  perform app.lock_main_cash(p_venue);
  if p_paid_from = 'safe' then
    v_balance := app.main_cash_balance(p_venue);
    if p_amount > v_balance then
      raise exception 'SAFE_NOT_ENOUGH' using errcode = 'P0001', hint = greatest(v_balance, 0)::text;
    end if;
  end if;
  insert into main_cash_entries (venue_id, kind, amount_iqd, delta_iqd, paid_from, category, payee,
                                 source, source_id, occurred_on, logged_by)
  values (p_venue, 'payment', p_amount,
          case p_paid_from when 'safe' then -p_amount else 0 end,
          p_paid_from, p_category, left(p_payee, 80), p_source, p_source_id,
          app.venue_business_date(p_venue), auth.uid())
  returning id into v_id;
  return v_id;
end $main_cash_record_payment_0387$;

comment on function app.main_cash_record_payment(uuid, bigint, text, text, text, text, uuid) is
  'main cash (0343, 0387). Internal: records a linked payment (wage, wage_advance, coach_pay) from its own RPC. Nothing when p_paid_from is null (an older client that did not ask) or the amount is not above 0. Paid from the safe, an amount above the safe''s balance raises SAFE_NOT_ENOUGH (hint the balance, IQD, at least 0) under the safe lock, so the caller''s whole write rolls back; a bank transfer is never refused. Returns the row id or null.';
revoke all on function app.main_cash_record_payment(uuid, bigint, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function app.main_cash_record_payment(uuid, bigint, text, text, text, text, uuid) to service_role;
