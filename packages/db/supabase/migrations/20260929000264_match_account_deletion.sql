set lock_timeout = '3s';
set statement_timeout = '60s';

-- 0264 match_account_deletion — open matches, lane DB: deleting an account
-- that plays open matches (docs/design/open-matches/db.md §4.9, money.md
-- §5.11; build contracts DF-20, §1.8, rulings R13, R18, R25, R29).
--
--   1. app.delete_my_account   re-issued once, from 0077:120 (its only body),
--                              verbatim plus, before the audit row:
--        - the profile UPDATE also empties given_name, family_name, gender,
--          gender_set_at and gender_set_by (profiles_sync_names, 0256, does
--          it too; explicit here);
--        - the player's match seats lose gender (and guest_name and
--          guest_phone, which a seat with a guest_id never holds: the
--          match_seats_kind CHECK);
--        - the player's requests lose friend_genders (R29);
--        - every block the player made or received is deleted;
--        - the notification_outbox delete moves after these match writes
--          (the order a match ending takes: seats, then the reminders);
--        - the audit row's after gains match_seats_scrubbed,
--          match_requests_scrubbed and match_blocks_deleted;
--        - last, app.ticket_refund_deleted (0259, DF-20): every ticket
--          purchase of the player with nothing reserved, in use or still
--          restorable goes back to the card now, one Qi refund each.
--
-- DF-20 comes in two halves (R25, D1). This body takes no match lock, no
-- court lock and no ticket lock it could wait on (ticket_refund_deleted skips
-- a locked ticket), so a deletion never queues behind a busy branch. The
-- matches are the sweep's (0263, app.match_sweep): it leaves the player's
-- filling and waiting matches (0260's match_drop_ineligible: seats left,
-- tickets released, pending requests withdrawn, the organiser handed over or
-- the match ended empty), turns a booked seat before the start into a late
-- leave (account_deleted) whose ticket is released at the start and never
-- forfeited (R18, 0260's ticket_forfeit), and refunds each purchase once it
-- is free (its last phase calls ticket_refund_deleted(null)). Until then the
-- seats stay, and other players see "Former player": 0260's
-- match_display_name reads deleted_at, which this body stamps.
--
-- Kept on purpose, pointing at the tombstone: match_reports (until the R36
-- purge), match_events, match_tickets, match_ticket_events, match_exclusions,
-- and the business columns of the seats and requests.
--
-- Locks (db.md §2.1, §2.5): the seat and request scrubs are written outside
-- the branch mutex on purpose; no match state reads gender, friend_genders or
-- a linked seat's typed name. The lock walker prints [reservations scrub ->
-- match_venue_advisory -> match_tickets] -> match_tickets (skip locked, Money)
-- -> booking_payments (unranked); at run time the reservations trigger (0263)
-- does not fire, since the scrub touches no column of its UPDATE OF list.
--
-- Same signature and the same grant (authenticated): the rls-matrix row, the
-- allowlist entry and the assistant coverage entry stay as they are.

-- ===========================================================================
-- 1. app.delete_my_account (re-issued from 0077:120)
-- ===========================================================================
create or replace function app.delete_my_account(p_confirm text default null)
returns jsonb
language plpgsql security definer set search_path = public as $delete_my_account_0264$
declare
  v_uid          uuid := auth.uid();
  v_profile      profiles%rowtype;
  v_apple        boolean;
  v_reservations int;
  v_series       int;
  v_notes        int;
  v_flags        int;
  v_outbox       int;
  v_seats        int;
  v_requests     int;
  v_blocks       int;
begin
  if v_uid is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  -- An anonymous café session has no account to delete: handle_new_user (0004)
  -- returns early for is_anonymous, so no profiles row was ever created.
  --
  -- This guard is also what keeps check-rpc-authz.mjs safe. That sweep calls
  -- EVERY RPC granted to `authenticated` with NULL arguments as a real
  -- anonymous guest. Without a refusal on its first line, the authorization
  -- gate would delete the account it probes with, on every run.
  select * into v_profile from profiles where id = v_uid;
  if not found then
    raise exception 'ACCOUNT_REQUIRED' using errcode = 'P0001';
  end if;

  -- Staff are deactivated, never deleted: staff.id -> auth.users is ON DELETE
  -- RESTRICT (0004), and audit_log.actor_id, staff.created_by and
  -- reservations.created_by_staff_id all point at them. Without this the call
  -- would reach the delete and fail there with a raw 23503.
  if exists (select 1 from staff where id = v_uid) then
    raise exception 'FORBIDDEN' using errcode = 'P0001',
      detail = 'staff accounts are deactivated, not deleted';
  end if;

  if v_profile.deleted_at is not null then
    raise exception 'ALREADY_DELETED' using errcode = 'P0001';
  end if;

  -- Irreversible, and reachable by anything holding the guest's JWT. The
  -- explicit token means a stray retry or an injected fetch cannot spend the
  -- account by calling a bare zero-argument RPC.
  if p_confirm is distinct from 'DELETE' then
    raise exception 'CONFIRMATION_REQUIRED' using errcode = 'P0001',
      hint = 'call with p_confirm => ''DELETE''';
  end if;

  -- Apple requires POST https://appleid.apple.com/auth/revoke when an account
  -- offering Sign in with Apple is deleted. The .p8 key does not exist yet
  -- (blocked on Apple Developer enrolment), so the obligation is RECORDED
  -- rather than silently skipped — the deletion itself must not be held hostage
  -- to a missing credential.
  select exists (select 1 from auth.identities
                  where user_id = v_uid and provider = 'apple')
    into v_apple;

  -- --- the anonymisation ----------------------------------------------------
  --
  -- Everything below removes a column that names or reaches a PERSON. Columns
  -- carrying business value — times, prices, courts, statuses, totals — are
  -- deliberately untouched, which is the entire point of retaining the row.

  -- The profile itself. expo_push_token is cleared here (SEC-21: cleared on
  -- deletion), which is also the only remaining way to reach the device.
  -- 0264: the two name parts and the three gender columns (0256) go too.
  -- profiles_sync_names empties them on the tombstone anyway; naming them
  -- here keeps the erasure readable in one place (the three gender columns
  -- together, as profiles_gender_stamp requires).
  update profiles
     set full_name       = 'Deleted account',
         phone           = null,
         expo_push_token = null,
         given_name      = null,
         family_name     = null,
         gender          = null,
         gender_set_at   = null,
         gender_set_by   = null,
         deleted_at      = now()
   where id = v_uid;

  -- Denormalised identity on the booking rows. THIS IS THE HALF THAT IS EASY TO
  -- MISS: reservations and reservation_series each carry their OWN guest_name
  -- and guest_phone beside guest_id, and nothing constrains the two to be
  -- mutually exclusive — app.confirm_booking writes
  -- `guest_name = coalesce(p_guest_name, guest_name)` whatever guest_id holds,
  -- and app.create_series takes p_guest_name the same way.
  --
  -- No client ships that argument TODAY: the mobile app calls confirm_booking
  -- with p_hold_id alone, so an app-made booking leaves both columns null, and
  -- only the test suite currently passes a name alongside a guest_id. The desk
  -- surface that would do it for a walk-in with an account is the obvious next
  -- feature. Scrubbing here is therefore mostly forward defence — but it is the
  -- difference between a deletion that stays complete and one that silently
  -- stops being complete the day that screen is built, which is exactly the
  -- kind of regression nobody re-audits.
  update reservations
     set guest_name = null, guest_phone = null, notes = null, device_id = null
   where guest_id = v_uid;
  get diagnostics v_reservations = row_count;

  update reservation_series
     set guest_name = null, guest_phone = null, notes = null
   where guest_id = v_uid;
  get diagnostics v_series = row_count;

  -- Records ABOUT the person, with no aggregate value: staff free text and
  -- labels, and queued notifications addressed to a device that is now
  -- unreachable. These used to CASCADE from profiles; now that the profile row
  -- survives, they have to be removed explicitly or they would outlive it.
  delete from customer_notes where customer_id = v_uid;
  get diagnostics v_notes = row_count;

  delete from customer_flags where customer_id = v_uid;
  get diagnostics v_flags = row_count;

  -- --- open matches (0264; db.md §4.9, R25, R29) ----------------------------
  --
  -- The seats and requests stay: they are the matches' history, and the sweep
  -- (0263) moves the live ones. What goes is what describes the person. Every
  -- seat that names the player (account seats, the friend seats they hold,
  -- linked desk seats) loses the gender it was taken with; a seat with a
  -- guest_id never holds a typed name or phone (match_seats_kind), and both are
  -- named anyway so the erasure reads the same as the booking rows above.
  -- Written outside the branch mutex on purpose (db.md §2.1): no match state
  -- reads these columns. Only rows that still hold something are touched, so
  -- a player's finished seats are not locked for nothing.
  update match_seats
     set guest_name = null, guest_phone = null, gender = null
   where guest_id = v_uid
     and (guest_name is not null or guest_phone is not null or gender is not null);
  get diagnostics v_seats = row_count;

  -- The genders the player declared for friends (R29).
  update match_requests
     set friend_genders = null
   where guest_id = v_uid
     and friend_genders is not null;
  get diagnostics v_requests = row_count;

  -- A block is a list of people kept by a person: both directions go (the
  -- blocker's own list, and the entries that name this account).
  delete from match_blocks where blocker_id = v_uid or blocked_id = v_uid;
  get diagnostics v_blocks = row_count;

  -- The queued notifications, after the match rows: a mutex holder ending a
  -- match writes its seats and requests first and then, through the
  -- match_events push trigger, deletes that match's queued reminders
  -- (app.match_sync_reminders). Taking the outbox rows last keeps this body in
  -- the same order, so it never holds a reminder row while it waits for a
  -- seat such a body holds (a 40P01 that would fail the deletion or swallow
  -- the reminder clean-up of a cancelled match).
  delete from notification_outbox where profile_id = v_uid;
  get diagnostics v_outbox = row_count;

  -- DF-20 (money.md §5.11, R13), the last data write: after the tombstone
  -- (ticket_refund_deleted picks deleted payers) and after every reservations
  -- write. Each purchase with nothing reserved, in use or restorable is cashed
  -- out now, one Qi refund of the price paid; a purchase whose ticket another
  -- body holds is skipped, never waited for. No match lock (R25): a purchase
  -- still tied to a match is refunded by the sweep once the match lets it go.
  -- A deletion never fails on a refund: an error is a warning, and the sweep's
  -- ticket_refund_deleted(null) retries.
  begin
    perform app.ticket_refund_deleted(v_uid);
  exception when others then
    raise warning 'delete_my_account: ticket refunds left for the sweep: % (%)', sqlerrm, sqlstate;
  end;

  -- The audit row is written BEFORE the auth user goes, while auth.uid() still
  -- resolves for write_audit's actor_id.
  --
  -- It deliberately carries NO before-image. to_jsonb(profile) would write the
  -- full_name and phone this function exists to erase into an append-only table
  -- that manager and owner can read — reintroducing the data one row further
  -- down. What is recorded is the SHAPE of the deletion: enough to prove it
  -- happened and what it touched, nothing that identifies who.
  perform app.write_audit(
    'account.delete', 'profiles', v_uid::text,
    jsonb_build_object(
      'had_phone',      v_profile.phone is not null,
      'had_push_token', v_profile.expo_push_token is not null,
      'created_at',     v_profile.created_at),
    jsonb_build_object(
      'reservations_anonymised', v_reservations,
      'series_anonymised',       v_series,
      'customer_notes_deleted',  v_notes,
      'customer_flags_deleted',  v_flags,
      'outbox_deleted',          v_outbox,
      'match_seats_scrubbed',    v_seats,
      'match_requests_scrubbed', v_requests,
      'match_blocks_deleted',    v_blocks,
      'apple_revoke_pending',    v_apple),
    'guest_request');

  -- The global sign-out, and the destruction of the identity itself.
  --
  -- auth.sessions CASCADEs from auth.users and auth.refresh_tokens CASCADEs from
  -- auth.sessions, so every token ever issued to this account dies with this one
  -- statement — a refresh token captured an hour ago can no longer mint a JWT.
  -- It also takes auth.identities (the Apple / Google link) and the email, phone
  -- and raw_user_meta_data, which is where full_name and phone were duplicated.
  --
  -- The on_auth_user_deleted trigger fires here and does nothing: deleted_at was
  -- stamped above, so the tombstone is left standing.
  delete from auth.users where id = v_uid;

  return jsonb_build_object(
    'deleted',              true,
    'profile_id',           v_uid,
    'apple_revoke_pending', v_apple);
end $delete_my_account_0264$;

comment on function app.delete_my_account(text) is
  '0264 (from 0077; db.md §4.9, DF-20, R25, R29). Store-mandated in-app account deletion. Destroys the auth user (which cascades every session, refresh token and identity — this IS the global sign-out) and leaves profiles as an anonymised tombstone (name parts and gender emptied too) so reservations.guest_id and the venue statistics keep a parent. Open matches: the player''s seats and requests lose gender and friend_genders, every block by or of the player is deleted, and every ticket purchase with nothing reserved, in use or restorable is refunded at once (app.ticket_refund_deleted, one Qi refund each). Takes no match lock (R25): the sweep (0263) leaves the player''s filling and waiting matches, turns a booked seat before the start into a late leave whose ticket is released at the start, and refunds the rest once free; meanwhile other players see "Former player". Refuses an anonymous session (ACCOUNT_REQUIRED), a staff account (FORBIDDEN — staff are deactivated), an account already deleted (ALREADY_DELETED) and any call without p_confirm => ''DELETE''. Apple''s /auth/revoke is NOT called: no .p8 key exists yet, so the audit row records apple_revoke_pending instead.';

revoke all on function app.delete_my_account(text) from public, anon, authenticated;
grant execute on function app.delete_my_account(text) to authenticated;
