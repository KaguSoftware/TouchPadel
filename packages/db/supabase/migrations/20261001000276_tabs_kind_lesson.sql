set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0276 tabs_kind_lesson — coaching, lane Money (docs/design/coaching/money.md
-- §3.2; build contracts §1.1, §1.2). CHECK widening only, alone in its file.
--
-- tabs.kind gains 'lesson': one fresh tab per desk payment of a lesson place,
-- inserted and settled in the same call by app.lesson_settle (0281, CM-1).
-- tabs_kind_chk is named explicitly at 0144:88. Safe alone: open_tab refuses
-- every kind but cafe and shop (0244:101-103) and no writer names 'lesson'
-- before 0281. The drop and add take a brief ACCESS EXCLUSIVE on tabs (no scan,
-- NOT VALID); the validate takes SHARE UPDATE EXCLUSIVE and does not block the
-- till.

alter table tabs drop constraint if exists tabs_kind_chk;
alter table tabs add constraint tabs_kind_chk check (kind in ('cafe', 'shop', 'lesson')) not valid;

do $tabs_kind_validate_0276$
begin
  if exists (select 1 from pg_constraint
              where conname = 'tabs_kind_chk'
                and conrelid = 'public.tabs'::regclass
                and not convalidated) then
    alter table tabs validate constraint tabs_kind_chk;
  end if;
end $tabs_kind_validate_0276$;
