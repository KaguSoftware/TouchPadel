-- 0056_venue_config_client_packs — Touch's CONFIRMED venue configuration, as a migration.
--
-- Why a migration for data: seed.sql carries these values for local resets, but seed.sql never
-- reaches the hosted project after its link-time baseline — and the baseline predates the client's
-- intake packs. Verified 2026-08-30: production still served the placeholder hours (09:00-23:00)
-- and no phone. Client config must ride the same guarded path as schema (CI `DB Migrate` with
-- required reviewers), so it lands here. Idempotent; safe to re-run anywhere, including locally
-- where seed.sql immediately re-applies the identical values.
--
-- Provenance — the packs in packages/db/client-data/ (the contractual record):
--   * hours 09:00 -> 02:00 x7 : pack 2026-08-29 `touch-padel.hours.*`, re-confirmed 2026-08-30
--   * cancellation 4 h        : pack `policy.cancelNote`, restated in pack-2 `notes.body`
--   * currency IQD            : pack `currency.mode = confirmed`
--   * phone                   : pack `filler.contact` = pack-2 `approver.contact`
--                               !! UNVERIFIED (+995 prefix, chased in doc 07) but it is the only
--                               number the client has given and degraded mode must show one.
--   * cash rounding OFF       : resolved override #1 (not a pack answer)
--
-- closed_dates is deliberately NOT set: the four closures are Hijri-calendar days whose 2027
-- Gregorian dates await Mustafa's confirmation (docs/client/07-outstanding-2026-08-30.md §1).
-- The overnight encoding (two windows per day, '24:00' close) is explained in seed.sql and
-- HANDOFF.md "HOURS ARE TWO WINDOWS PER DAY" — do not hand-edit these windows.

update venue_settings
   set venue_name    = 'Touch Padel',
       currency      = 'IQD',
       timezone      = 'Asia/Baghdad',
       opening_hours = '{"mon":[["00:00","02:00"],["09:00","24:00"]],
                         "tue":[["00:00","02:00"],["09:00","24:00"]],
                         "wed":[["00:00","02:00"],["09:00","24:00"]],
                         "thu":[["00:00","02:00"],["09:00","24:00"]],
                         "fri":[["00:00","02:00"],["09:00","24:00"]],
                         "sat":[["00:00","02:00"],["09:00","24:00"]],
                         "sun":[["00:00","02:00"],["09:00","24:00"]]}'::jsonb,
       cancellation_window_hours = 4,
       phone         = '00995419010203',
       cash_rounding_iqd = 1
 where id;
