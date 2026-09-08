-- 0080_guest_text_sanitising — SEC-27 (a hard gate). Strip control bytes and
-- Unicode bidi overrides from guest-writable text at write time.
--
-- THE ATTACK. U+202E RIGHT-TO-LEFT OVERRIDE reverses the display order of
-- everything after it while leaving the stored bytes untouched. A guest who
-- sets their profile name to "Ali<RLO>gnp.exe" is stored as exactly that and
-- RENDERED, on the desk screen and in the customer search, as "Aliexe.png".
-- What the staff member reads is not what the database holds, and no amount of
-- care at the reading end fixes it — the two disagree by design.
--
-- Verified against this database 2026-09-07: stripping the class below turns
-- that string back into "Alignp.exe", and leaves "mohammed <arabic>" untouched.
-- Arabic is NOT affected: the characters removed are invisible FORMATTING
-- controls, not letters, and Arabic renders right-to-left from its own
-- character properties without any of them.
--
-- WHY IT MATTERS BEYOND DISPLAY. The same text reaches the W3 ESC/POS ticket
-- printer. C0 control bytes in a printed field are printer COMMANDS: 0x1B 0x70
-- is the drawer kick. A name is not a place to accept arbitrary control bytes.
--
-- WHERE THE GUEST CAN ACTUALLY WRITE. Measured, not assumed — these are the ONLY
-- text columns in `public` with an UPDATE or INSERT grant to `authenticated`:
--
--   profiles.full_name, profiles.phone
--
-- Everything else a guest can influence goes through a SECURITY DEFINER RPC.
-- The booking columns (reservations.guest_name / guest_phone / notes and the
-- series equivalents) are staff-written today, but confirm_booking and
-- create_series both accept them as arguments from any caller, so they are
-- covered here too rather than left until that changes.
--
-- WHY TRIGGERS RATHER THAN RPC ARGUMENT HANDLING. `profiles` is written by the
-- client DIRECTLY through PostgREST on a column grant — there is no RPC in that
-- path to sanitise in. A BEFORE trigger is the only interception point that
-- every writer must pass through, including any future one.
--
-- NUL (U+0000) is absent from the class on purpose: PostgreSQL refuses to store
-- it in a text column at all ("null character not permitted"), so the range
-- starts at U+0001.
--
-- covered by packages/db/tests/guest-text-sanitising.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- The character class, defined once. Built with chr() so this file stays plain
-- ASCII and cannot be mangled by an editor or a terminal that renders it.
-- ---------------------------------------------------------------------------
create or replace function app.text_control_class() returns text
language sql immutable set search_path = public as $text_control_class_0080$
  select '['
      || chr(1)     || '-' || chr(31)      -- C0 controls (NUL is unstorable anyway)
      || chr(127)   || '-' || chr(159)     -- DEL + C1 controls
      || chr(8203)  || '-' || chr(8207)    -- ZWSP..RLM: zero-width + LRM/RLM marks
      || chr(8234)  || '-' || chr(8238)    -- LRE, RLE, PDF, LRO, RLO
      || chr(8288)                         -- WORD JOINER
      || chr(8294)  || '-' || chr(8297)    -- LRI, RLI, FSI, PDI (isolates)
      || chr(65279)                        -- ZERO WIDTH NO-BREAK SPACE / BOM
      || ']';
$text_control_class_0080$;

comment on function app.text_control_class() is
  '0080/SEC-27. The invisible-control character class stripped from guest text: C0/C1 controls, zero-width characters, and every Unicode bidi override and isolate. Arabic and Kurdish letters are untouched — these are formatting controls, not script.';

-- ---------------------------------------------------------------------------
-- app.safe_line — for a NAME or a PHONE. One line, no exceptions.
-- ---------------------------------------------------------------------------
create or replace function app.safe_line(p_text text) returns text
language sql immutable set search_path = public as $safe_line_0080$
  select case
    when p_text is null then null
    else btrim(regexp_replace(
           regexp_replace(p_text, app.text_control_class(), '', 'g'),
           '\s+', ' ', 'g'))
  end;
$safe_line_0080$;

comment on function app.safe_line(text) is
  '0080/SEC-27. A single-line field (name, phone): removes every control and bidi character, collapses runs of whitespace to one space, trims. NULL in, NULL out. Never returns NULL for a non-NULL input, so a NOT NULL column cannot be broken by it.';

-- ---------------------------------------------------------------------------
-- app.safe_text — for a NOTE. Keeps the shape a human typed.
-- ---------------------------------------------------------------------------
-- The same class with TAB and LF carved out.
--
-- The first version of this function did not do it that way: it escaped newline
-- and tab to a chr(1)-prefixed placeholder, stripped, then unescaped — and
-- chr(1) is INSIDE the class, so the marker was stripped with everything else
-- and 'line one\nline two' came back as 'line oneNline two'. Caught by
-- guest-text-sanitising.test.ts on the first run. Two classes that must agree
-- turned out to be easier to keep correct than one clever pass.
create or replace function app.text_control_class_multiline() returns text
language sql immutable set search_path = public as $text_control_class_multiline_0080$
  select '['
      || chr(1)     || '-' || chr(8)       -- C0 below TAB
      || chr(11)    || '-' || chr(31)      -- C0 above LF (CR included: \r\n -> \n)
      || chr(127)   || '-' || chr(159)
      || chr(8203)  || '-' || chr(8207)
      || chr(8234)  || '-' || chr(8238)
      || chr(8288)
      || chr(8294)  || '-' || chr(8297)
      || chr(65279)
      || ']';
$text_control_class_multiline_0080$;

comment on function app.text_control_class_multiline() is
  '0080/SEC-27. app.text_control_class() with TAB (9) and LF (10) left in, for fields where a human typed a shape worth keeping. CR is still stripped, so a Windows line ending lands as a plain newline.';

create or replace function app.safe_text(p_text text) returns text
language sql immutable set search_path = public as $safe_text_0080$
  select case
    when p_text is null then null
    else btrim(regexp_replace(p_text, app.text_control_class_multiline(), '', 'g'))
  end;
$safe_text_0080$;

comment on function app.safe_text(text) is
  '0080/SEC-27. A multi-line field (notes): same removals as app.safe_line but newline and tab survive, because a note is meant to have shape. Bidi overrides do not survive.';

revoke all on function app.text_control_class() from public, anon, authenticated;
revoke all on function app.text_control_class_multiline() from public, anon, authenticated;
revoke all on function app.safe_line(text) from public, anon, authenticated;
revoke all on function app.safe_text(text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- The triggers. BEFORE, so the stored value is already clean and every reader
-- is safe without knowing this exists.
-- ---------------------------------------------------------------------------
create or replace function app.trg_sanitise_profile() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_profile_0080$
begin
  -- full_name is NOT NULL: safe_line never turns a non-null into a null, so a
  -- name made entirely of control characters becomes '' and is refused by the
  -- same rules that already refuse an empty name, not by a constraint violation
  -- the guest cannot interpret.
  new.full_name := coalesce(app.safe_line(new.full_name), '');
  new.phone     := app.safe_line(new.phone);
  return new;
end $trg_sanitise_profile_0080$;

revoke all on function app.trg_sanitise_profile() from public, anon, authenticated;

drop trigger if exists profiles_sanitise on profiles;
create trigger profiles_sanitise
  before insert or update of full_name, phone on profiles
  for each row execute function app.trg_sanitise_profile();

create or replace function app.trg_sanitise_reservation() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_reservation_0080$
begin
  new.guest_name  := app.safe_line(new.guest_name);
  new.guest_phone := app.safe_line(new.guest_phone);
  new.notes       := app.safe_text(new.notes);
  return new;
end $trg_sanitise_reservation_0080$;

revoke all on function app.trg_sanitise_reservation() from public, anon, authenticated;

drop trigger if exists reservations_sanitise on reservations;
create trigger reservations_sanitise
  before insert or update of guest_name, guest_phone, notes on reservations
  for each row execute function app.trg_sanitise_reservation();

create or replace function app.trg_sanitise_series() returns trigger
language plpgsql security definer set search_path = public as $trg_sanitise_series_0080$
begin
  new.guest_name  := app.safe_line(new.guest_name);
  new.guest_phone := app.safe_line(new.guest_phone);
  new.notes       := app.safe_text(new.notes);
  return new;
end $trg_sanitise_series_0080$;

revoke all on function app.trg_sanitise_series() from public, anon, authenticated;

drop trigger if exists reservation_series_sanitise on reservation_series;
create trigger reservation_series_sanitise
  before insert or update of guest_name, guest_phone, notes on reservation_series
  for each row execute function app.trg_sanitise_series();
