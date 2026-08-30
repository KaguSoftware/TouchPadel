-- CLIENT DATA — Touch's own court list. Derived from the intake pack
-- `touch-padel-pack-2026-08-29.json`, table `touch-padel.list` / section "Courts, hours & rates".
-- Re-confirmed IDENTICALLY by `touch-padel-pack-2026-08-30.json` (same two rows, byte for byte).
--
-- Reserved client-data UUID prefix: '70c4' ("TOUCH"). Nothing outside packages/db/client-data/
-- may reference a 70c4 UUID -- that is the swap point, exactly as 'f1f7' is for the fixtures.
--
-- Apply: pnpm --filter @touch/db db:client   (NOT part of db:fixtures -- see ./README.md)
--
-- WHAT THE PACK SAID
--   | Court name (EN) | Court name (AR) | Type   | Durations (min) |
--   | Court 1         | <Arabic>        | indoor | 60              |
--   | Court 2         | <Arabic>        | indoor | 60              |
--
--   Two courts, BOTH indoor, and 60 minutes as the ONLY bookable duration -- not the {60,90,120}
--   the fixtures and the courts.duration_options default assume. app.hold_slot raises
--   INVALID_DURATION for anything not in this array, so a 90-minute booking is refused outright.
--
-- ARABIC VERIFIED 2026-08-30 against the clean original exports (now committed in this directory
-- -- the mojibake existed only in the transcoded intermediary copy, not in the Kagu OS exports).
-- The pack writes Court 1 as 'الملعب الاول' (plain alef, no hamza) -- the client's own typing.
-- We follow the pack verbatim; normalising to 'الأول' is a one-character edit if Mustafa prefers.
--
-- !! NO RATE RULES. The rates table is EMPTY in BOTH packs (2026-08-29 and 2026-08-30), so nothing
-- !! prices these courts and every slot fails with NO_RATE. This file is applied on purpose only;
-- !! the f1f7 fixtures stay the dev/test default until Touch sends rate rules.
-- !! See docs/client/07-outstanding-2026-08-30.md.
--
-- !! DURATIONS MAY NOT BE FINAL. The 2026-08-30 pack's free-text notes say "court times aren't
-- !! always the exact same, different across courts" -- ambiguous between per-court durations,
-- !! per-court prices, or per-court bookable hours. duration_options = '{60}' below is what the
-- !! courts table said, but expect it to change once the note is clarified (chased in doc 07).

begin;

-- ---------------------------------------------------------------------------
-- Refuse the swap if a live reservation still references a fixture court.
-- packages/db/README.md step 1: "refuse the swap if any live reservation
-- references a fixture court -- resolve those first". Better a loud abort than
-- a half-migrated calendar.
-- ---------------------------------------------------------------------------
do $guard$
declare
  v_live int;
begin
  select count(*) into v_live
    from reservations
   where court_id::text like 'f1f7%'
     and status in ('pending', 'confirmed', 'arrived');
  if v_live > 0 then
    raise exception
      'FIXTURE_COURTS_IN_USE: % live reservation(s) still reference a fixture court; resolve them before swapping',
      v_live;
  end if;
end $guard$;

-- ---------------------------------------------------------------------------
-- Touch's courts
-- ---------------------------------------------------------------------------
insert into courts (id, name_en, name_ar, description_en, description_ar, indoor, duration_options, sort_order, is_active) values
  ('70c40000-0000-4000-8000-00000000c001', 'Court 1', 'الملعب الاول',
   null, null, true, '{60}', 1, true),
  ('70c40000-0000-4000-8000-00000000c002', 'Court 2', 'الملعب الثاني',
   null, null, true, '{60}', 2, true)
on conflict (id) do update
  set name_en          = excluded.name_en,
      name_ar          = excluded.name_ar,
      indoor           = excluded.indoor,
      duration_options = excluded.duration_options,
      sort_order       = excluded.sort_order,
      is_active        = excluded.is_active;

-- ---------------------------------------------------------------------------
-- Retire the fixture courts.
--
-- DEACTIVATED, not deleted. A delete would cascade nothing but would strand any
-- historical reservation, and reservations carry the price provenance the SOW
-- promises ("a historical figure can always be explained"). is_active = false
-- removes them from every guest and desk surface, which is the whole point.
-- Delete them properly, children first, only once the history is worthless --
-- see packages/db/README.md.
-- ---------------------------------------------------------------------------
update courts set is_active = false where id::text like 'f1f7%';

-- Fixture rate rules would otherwise price Touch's real courts (court_id IS
-- NULL means "all courts"), quietly presenting invented money as real.
update rate_rules set is_active = false where id::text like 'f1f7%';

commit;
