set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0274 outbox_lesson_kinds — coaching, lane Guest (docs/design/coaching/guest.md
-- §4.4; build contracts §1.1, §1.2, §1.9, R18). CHECK widening only, alone in
-- its file.
--
-- notification_outbox.kind gains the coaching kinds of the guest family:
-- lesson_update, lesson_reminder, coach_update. Their copy is in
-- supabase/functions/send-push/guestStrings.ts, keyed by payload.title_key, and
-- _shared/guest-push.json is the one list of kinds, title keys and routes.
-- send-push MUST be deployed with them before this file reaches hosted:
-- deploy.yml deploys send-push first. Nothing queues these kinds before
-- app.lesson_notify (0283). The thirteen existing kinds are 0255:16-24 verbatim.

alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                  'booking_no_show', 'test',
                  'staff_task', 'staff_decide', 'staff_decided', 'staff_info',
                  'deposit_refunded',
                  'match_update', 'match_reminder', 'match_message',
                  'lesson_update', 'lesson_reminder', 'coach_update'))
  not valid;

do $validate_kind_check_0274$
begin
  if exists (select 1 from pg_constraint
              where conname = 'notification_outbox_kind_check'
                and conrelid = 'public.notification_outbox'::regclass
                and not convalidated) then
    alter table notification_outbox validate constraint notification_outbox_kind_check;
  end if;
end $validate_kind_check_0274$;
