set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0297 coaching_privacy_grants — the coaching post-build review, who may read
-- a coach's pay inputs (plan "Coaching: make it bulletproof" §1, items DB-45
-- and DB-46; build contracts C-28, R42, §1.15 D1; db.md §4.3.15). 0273–0289
-- are not edited. No function is re-created, no lock is taken, no error code
-- is added.
--
--   DB-45 The owner assistant could rebuild per-coach pay through table_read:
--         lessons and courses carried price_iqd, court_share_iqd and
--         coach_share_bp beside coach_id (0278:1118-1132), and venue_settings
--         carried the branch's coach_share_bp (0277:146-161). Decision D1:
--         the money and share columns leave the readable set; coach_id stays
--         (schedule questions), and so do coach_prices (a catalogue price, the
--         one a guest is quoted) and lesson_types' prices (a type's base price,
--         no coach in the row). 0278's insert is ON CONFLICT DO NOTHING, so a
--         later catch-up insert could add these rows back: the coaching-schema
--         gate test fails if any readable column looks like a coach's share,
--         or any readable table pairs a coach identifier with an _iqd or _bp
--         column (coach_prices.price_iqd is the one named exception).
--   DB-46 Every staff role read venue_settings whole (0006:64 grants SELECT on
--         the table to authenticated; the 0234:437 policy admits any active
--         staff at a visible branch), coach_share_bp and
--         coach_max_open_private included. A column-level REVOKE does nothing
--         while the table grant stands, so the table grant goes and SELECT is
--         granted again column by column, on every column but those two.
--         Managers and the owner read them through app.coaching_settings
--         (security definer, 0277); app.coaching_rules is internal (granted to
--         nobody) and runs inside definer bodies only. Every client read of
--         venue_settings names its columns (operator venueQueries.ts,
--         DayServiceTab.tsx, stockKeys.ts, useTaxContext.ts, lib/queries.ts);
--         v_expiring_soon (security_invoker) reads venue_id and
--         expiring_soon_days only. A new venue_settings column needs its own
--         column grant from now on (packages/db/CLAUDE.md).

-- ===========================================================================
-- DB-45: the owner assistant's readable set loses the coaching money columns
-- ===========================================================================

delete from app.assistant_readable_columns
 where (table_name in ('lessons', 'courses')
        and column_name in ('price_iqd', 'court_share_iqd', 'coach_share_bp'))
    or (table_name = 'venue_settings' and column_name = 'coach_share_bp');

-- ===========================================================================
-- DB-46: venue_settings is read column by column, never its two coach columns
-- ===========================================================================

revoke select on public.venue_settings from authenticated;

do $venue_settings_column_grants_0297$
declare
  v_cols text;
begin
  select string_agg(format('%I', c.column_name), ', ' order by c.ordinal_position)
    into v_cols
    from information_schema.columns c
   where c.table_schema = 'public'
     and c.table_name = 'venue_settings'
     and c.column_name not in ('coach_share_bp', 'coach_max_open_private');
  if v_cols is null then
    raise exception 'venue_settings has no columns to grant';
  end if;
  execute format('grant select (%s) on public.venue_settings to authenticated', v_cols);

  if has_column_privilege('authenticated', 'public.venue_settings', 'coach_share_bp', 'SELECT')
     or has_column_privilege('authenticated', 'public.venue_settings', 'coach_max_open_private', 'SELECT')
     or has_table_privilege('authenticated', 'public.venue_settings', 'SELECT') then
    raise exception 'venue_settings: a coach column is still readable by authenticated';
  end if;
  if not has_column_privilege('authenticated', 'public.venue_settings', 'venue_id', 'SELECT')
     or not has_column_privilege('authenticated', 'public.venue_settings', 'timezone', 'SELECT') then
    raise exception 'venue_settings: the column grant did not land';
  end if;
end $venue_settings_column_grants_0297$;

comment on column public.venue_settings.coach_share_bp is
  '0277. The coach''s share of collected lesson money less the court share, in basis points (CD-5, C-6): 0..10000, default 6000 (60 %). Snapshotted on every lesson and course at creation. Owner only; never in venue_settings_public. 0297 (DB-46): no client column grant; managers and the owner read it through app.coaching_settings, and the owner assistant never reads it (C-28, D1).';

comment on column public.venue_settings.coach_max_open_private is
  '0277. How many upcoming coach-booked private lessons one coach may hold at this branch (C-24, R56): 1..100, default 10 (COACH_ADD_LIMIT detail live). Owner-set via app.set_coaching_settings. 0297 (DB-46): no client column grant; read through app.coaching_settings.';
