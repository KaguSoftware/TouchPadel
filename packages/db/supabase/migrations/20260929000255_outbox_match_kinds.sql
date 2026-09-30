set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0255 outbox_match_kinds — open matches, lane Guest
-- (docs/design/open-matches/guest.md §4.4, build contracts §1.1, §1.9). CHECK
-- widening only, alone in its file.
--
-- notification_outbox.kind gains the guest family: match_update,
-- match_reminder, match_message. Their copy is in
-- supabase/functions/send-push/guestStrings.ts, keyed by payload.title_key, and
-- _shared/guest-push.json is the one list of kinds, title keys and routes.
-- send-push MUST be deployed with that family before this file reaches hosted
-- (landing order push A, then push B): a kind the deployed function does not
-- know is terminal there. Nothing queues these kinds before app.match_notify
-- (0261). The ten existing kinds are 0241:204-211 verbatim.

alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                  'booking_no_show', 'test',
                  'staff_task', 'staff_decide', 'staff_decided', 'staff_info',
                  'deposit_refunded',
                  'match_update', 'match_reminder', 'match_message'))
  not valid;

do $validate_kind_check_0255$
begin
  if exists (select 1 from pg_constraint
              where conname = 'notification_outbox_kind_check'
                and conrelid = 'public.notification_outbox'::regclass
                and not convalidated) then
    alter table notification_outbox validate constraint notification_outbox_kind_check;
  end if;
end $validate_kind_check_0255$;
