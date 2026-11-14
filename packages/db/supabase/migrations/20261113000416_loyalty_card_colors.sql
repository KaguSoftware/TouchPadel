set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0416 loyalty_card_colors — the club's four cards (Majed, 2026-11-13: "the
-- cards have these colors and in the following order: lowest one, the starter
-- one, is white, then comes the Touch Padel green, then the Touch Padel blue,
-- then the black").
--
--   1. loyalty_tiers.color also takes white | green | blue (black is already
--      there). The 0376 metals (classic | bronze | silver | gold | platinum)
--      stay valid, so a tier saved in one keeps drawing; the operator now
--      offers only the four cards (CARD_LADDER, @touch/core/loyalty) and shows
--      a legacy colour only on the tier that still has it. The default stays
--      classic, so nothing written without a colour changes.
--   2. No tier is recoloured here: the colours are the owner's, set in Setup >
--      Loyalty > Tiers (a new tier starts on the first card no tier has).
--
-- No function changes: upsert_loyalty_tier (latest 0376) leaves the value to
-- the CHECK, and every answer carries the column as it is.
-- Covered by packages/db/tests/loyalty-tier-colors.test.ts.

-- The 0376 CHECK is replaced only while it still lacks the new keys, so a
-- re-run changes nothing.
do $loyalty_tiers_color_0416$
begin
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_tiers_color'
                and conrelid = 'public.loyalty_tiers'::regclass
                and pg_get_constraintdef(oid) not like '%white%') then
    alter table loyalty_tiers drop constraint loyalty_tiers_color;
  end if;
  if not exists (select 1 from pg_constraint
                  where conname = 'loyalty_tiers_color'
                    and conrelid = 'public.loyalty_tiers'::regclass) then
    alter table loyalty_tiers add constraint loyalty_tiers_color
      check (color in ('white', 'green', 'blue', 'black',
                       'classic', 'bronze', 'silver', 'gold', 'platinum')) not valid;
  end if;
end $loyalty_tiers_color_0416$;

do $loyalty_tiers_color_validate_0416$
begin
  if exists (select 1 from pg_constraint
              where conname = 'loyalty_tiers_color'
                and conrelid = 'public.loyalty_tiers'::regclass
                and not convalidated) then
    alter table loyalty_tiers validate constraint loyalty_tiers_color;
  end if;
end $loyalty_tiers_color_validate_0416$;

comment on column loyalty_tiers.color is
  '0376, 0416. The colour the owner gave the tier. The club''s four cards, from the starter card up (0416): white | green (Touch Padel green) | blue (Touch Padel blue) | black (a black card). Before 0416, still valid and drawn but no longer offered: classic (Padel Green on the brand blue card, the default) | bronze | silver | gold | platinum. The guest''s points card draws its lines, its tier word and the holder''s name in it. The same keys as TIER_COLORS in @touch/core/loyalty.';
