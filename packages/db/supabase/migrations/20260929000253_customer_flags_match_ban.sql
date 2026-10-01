set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0253 customer_flags_match_ban — open matches (docs/design/open-matches/db.md
-- §4.1, build contracts §1.1). CHECK widening only, alone in its file.
--
-- customer_flags.type gains 'match_ban': a manager or owner bans a customer
-- from open matches, chain-wide as customer_flags is (R40). The flag's label
-- holds the ban reason code (conduct, no_shows, reported, other; R35). Only
-- app.set_match_ban writes it and app.set_customer_flags carries it over, both
-- in 0262; until then no row can carry the type. The five existing types are
-- 0241:188-189 verbatim.

alter table customer_flags drop constraint if exists customer_flags_type_check;
alter table customer_flags add constraint customer_flags_type_check
  check (type in ('vip', 'birthday', 'payment_note', 'special_request', 'deposit_exempt',
                  'match_ban')) not valid;

do $customer_flags_validate_0253$
begin
  if exists (select 1 from pg_constraint
              where conname = 'customer_flags_type_check'
                and conrelid = 'public.customer_flags'::regclass
                and not convalidated) then
    alter table customer_flags validate constraint customer_flags_type_check;
  end if;
end $customer_flags_validate_0253$;
