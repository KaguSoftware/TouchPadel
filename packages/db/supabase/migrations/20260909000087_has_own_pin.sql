-- 0087_has_own_pin — SEC-34, the self-unlock gap.
--
-- ---------------------------------------------------------------------------
-- THE GAP
-- ---------------------------------------------------------------------------
--
-- The idle lock (0064) locks a till after `till_idle_lock_seconds` and asks for
-- the signed-in person's OWN pin. But PINs are only ever set on manager and
-- owner accounts — a PIN here is the manager AUTHORISATION on the money paths,
-- so nobody has ever had a reason to give a cashier one. The result: the
-- cashier who actually works the till is shown a PIN box they cannot satisfy.
--
-- The screen does fall back — `verify_own_pin` raises NO_PIN_SET and the client
-- switches to the password field — but only AFTER the cashier has typed a PIN
-- and pressed Unlock. They have to guess wrong at a credential they do not have
-- before being offered the one they do. On a locked till mid-service, in front
-- of a queue, that is the moment somebody decides the lock is a nuisance and
-- learns the manager's PIN instead. The control's cost lands on the wrong
-- person and the venue routes around it, which is worse than not having it.
--
-- ---------------------------------------------------------------------------
-- THE DECISION: THE ACCOUNT PASSWORD, NOT A SECOND PIN
-- ---------------------------------------------------------------------------
--
-- The box (security-general.md §09, SEC-34) offers two routes: the account
-- password, or "a SEPARATE unlock PIN in a separate column with a verification
-- function that can never satisfy an approval RPC. Do not reuse the manager
-- PIN." This takes the first, and the second half of that sentence is exactly
-- why:
--
--   * A separate unlock PIN means a new column, a new verification function, a
--     new set-PIN flow, a new thing every staff member must remember and the
--     venue must administer — and a new way to be locked out — to buy back an
--     availability inconvenience. It also creates a second PIN-shaped secret
--     beside the manager PIN, and two similar secrets on the same keypad is how
--     people end up typing one into the other's prompt.
--
--   * The account password CANNOT satisfy an approval RPC, structurally and for
--     free. Every approval path takes `p_pin` and calls app.verify_manager_pin,
--     which compares against staff.pin_hash. A GoTrue password re-auth never
--     touches that column and returns a session, not a staff id. The separation
--     the box asks a new function to guarantee is a property this route simply
--     has.
--
-- So: the lock accepts a PIN from whoever has one, and the account password
-- from everyone. Both were already implemented. What was missing is knowing
-- WHICH to show BEFORE the person guesses — and that is all this migration adds.
--
-- ---------------------------------------------------------------------------
-- WHY AN RPC AND NOT A COLUMN
-- ---------------------------------------------------------------------------
--
-- The client cannot read staff.pin_hash, and must not: 0004 grants SELECT on
-- staff column-by-column precisely to keep the hash away from it. A boolean
-- derived server-side is the whole requirement, so that is what is returned.
--
-- It answers ONLY about the caller — the same shape as app.is_staff and
-- app.staff_role, which is why it joins them in `publicByDesign`. A caller
-- learning whether their OWN account has a PIN learns nothing they could not
-- discover by typing one, and nothing about anybody else. There is no argument
-- to pass, so there is nothing to point at another account.
--
-- covered by packages/db/tests/self-unlock.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

create or replace function app.has_own_pin()
returns boolean
language sql stable security definer set search_path = public as $has_own_pin_0087$
  -- `coalesce(..., false)` so an anonymous guest, a signed-out caller and a
  -- non-staff account all get the same plain `false` rather than a NULL the
  -- client would have to special-case. There is nothing to refuse: the answer
  -- is about the caller, and for all three of them it is "no".
  select coalesce(
    (select pin_hash is not null from staff where id = auth.uid() and is_active),
    false
  );
$has_own_pin_0087$;

comment on function app.has_own_pin() is
  '0087/SEC-34. Does the CALLER have an idle-lock PIN? Answers about auth.uid() alone and takes no argument, so it cannot be pointed at another account. Lets the lock screen show the right control up front instead of making a cashier guess at a PIN they were never given.';

revoke all on function app.has_own_pin() from public;
grant execute on function app.has_own_pin() to anon, authenticated;
