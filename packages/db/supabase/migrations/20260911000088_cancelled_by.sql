-- 0088_cancelled_by — WHO cancelled it.
--
-- ---------------------------------------------------------------------------
-- THE GAP
-- ---------------------------------------------------------------------------
--
-- A cancelled booking looks identical whoever ended it. `reservations` stamps
-- `cancelled_at` and `cancellation_reason` (0008) and nothing else, so the row
-- the guest reads back on My reservations > Cancelled says "CANCELLED" and
-- stops there. Two very different events land on that badge:
--
--   * the guest tapped Cancel booking in the app, inside the free window;
--   * the desk cancelled it — a court closed for maintenance, a double
--     booking untangled, a weekly series called off (0066 cancels each
--     occurrence through this same RPC).
--
-- The first needs no explanation. The second is the venue taking a court back,
-- and the guest currently has no way to tell it from their own tap: they open
-- the tab, find a game they were expecting to play sitting under a grey badge,
-- and cannot say whether they cancelled it and forgot or whether the venue did
-- and never said. That is the one question the screen has to be able to answer,
-- and today it cannot — the fact simply is not stored.
--
-- `cancellation_reason` does not answer it either. It is optional, it is desk
-- free text or a reason code written for the venue's own record, and the guest
-- path passes nothing at all — so on a guest cancellation it is null, which is
-- indistinguishable from a desk cancellation entered without a reason.
--
-- ---------------------------------------------------------------------------
-- THE COLUMN
-- ---------------------------------------------------------------------------
--
-- One nullable column, `cancelled_by`, stamped by app.cancel_reservation from
-- the branch it ALREADY takes. The RPC computes `v_staff` to decide which
-- policy applies (staff always may; a guest must own the row and clear the
-- cancellation window) — so the actor is known at the moment of the write and
-- was being thrown away one line later.
--
-- Two values, and deliberately not more:
--
--   * 'guest' — the account holder cancelled their own booking;
--   * 'staff' — court_desk, manager or owner cancelled it.
--
-- There is no 'system': nothing automated reaches this function. A hold that
-- runs out of TTL is swept to 'expired' by app.expire_stale_holds, and a hold
-- handed back early goes through app.release_hold (0058) to that same
-- 'expired' — neither is a cancellation, and neither writes this column. A
-- no-show is marked through app.mark_reservation and keeps status 'no_show';
-- it stamps `cancelled_at` (0075) so the row looks ended, but it was not
-- cancelled by anybody and gets no actor.
--
-- NULL therefore means exactly one thing: a cancellation from before this
-- migration whose actor was never recorded. The app reads that as "we do not
-- know" and falls back to the old wording rather than guessing — which is why
-- the column is nullable with no default rather than backfilled to whichever
-- value looks more likely.
--
-- ---------------------------------------------------------------------------
-- THE BACKFILL: THE AUDIT LOG ALREADY KNEW
-- ---------------------------------------------------------------------------
--
-- Every cancellation has written an audit row since 0005, and that row carries
-- `actor_role` — app.write_audit stamps app.staff_role() for staff and the
-- literal 'guest' for everyone else. So the history is not lost, it is just
-- somewhere the guest cannot read (audit_log is manager/owner only, by policy).
-- The backfill below copies it onto the reservation, where the guest's own RLS
-- policy reaches it.
--
-- It is narrow on purpose: `action = 'reservation.cancel'` only, so a no-show's
-- 'reservation.mark_no_show' row can never be read as a cancellation, and the
-- reservation's own status must still be 'cancelled', so a row whose audit
-- trail says cancel but which has since moved on is left alone. `distinct on`
-- takes the most recent matching audit row per reservation. Anything with no
-- audit row at all stays null and keeps the old wording — the same answer as
-- "we do not know", which is the truth.
--
-- covered by packages/db/tests/cancelled-by.test.ts

set lock_timeout = '3s';
set statement_timeout = '60s';

create type cancellation_actor as enum ('guest', 'staff');

comment on type cancellation_actor is
  '0088. Who ended a cancelled reservation: the account holder in the app, or the desk. No ''system'' member — nothing automated calls app.cancel_reservation; lapsed and released holds go to ''expired'' instead.';

alter table reservations add column cancelled_by cancellation_actor;

comment on column reservations.cancelled_by is
  '0088. Who cancelled this booking, stamped by app.cancel_reservation. NULL = cancelled before 0088 with no audit row to recover the actor from, or never cancelled at all — read it together with status, never on its own. A no_show leaves it null: that stamps cancelled_at (0075) but was not cancelled by anybody.';

-- ---------------------------------------------------------------------------
-- Backfill from the audit trail (see above). One statement, no trigger: this
-- is a one-off recovery of facts already written, not an ongoing sync.
-- ---------------------------------------------------------------------------
update reservations r
   set cancelled_by = (case when a.actor_role = 'guest' then 'guest' else 'staff' end)::cancellation_actor
  from (
    select distinct on (entity_id) entity_id, actor_role
      from audit_log
     where entity = 'reservations'
       and action = 'reservation.cancel'
     order by entity_id, at desc
  ) a
 where a.entity_id = r.id::text
   and r.status = 'cancelled'
   and r.cancelled_by is null;

-- ---------------------------------------------------------------------------
-- app.cancel_reservation — 0008's body, unchanged except for the one column.
-- The policy, the guards, the error codes and the audit row are all as they
-- were; `v_staff` was already computed, and is now also written down.
-- ---------------------------------------------------------------------------
create or replace function app.cancel_reservation(
  p_reservation_id uuid,
  p_reason         text default null
) returns jsonb
language plpgsql security definer set search_path = public as $cancel_reservation_0088$
declare
  v        reservations%rowtype;
  v_before jsonb;
  v_staff  boolean;
  v_window int;
begin
  if auth.uid() is null then
    raise exception 'AUTH_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v from reservations where id = p_reservation_id for update;
  if not found then
    raise exception 'RESERVATION_NOT_FOUND' using errcode = 'P0001';
  end if;
  if v.status not in ('pending','confirmed','arrived') then
    raise exception 'NOT_CANCELLABLE' using errcode = 'P0001';
  end if;

  v_staff := app.is_staff('court_desk','manager','owner');
  if not v_staff then
    if v.guest_id is distinct from auth.uid() then
      raise exception 'FORBIDDEN' using errcode = 'P0001';
    end if;
    select cancellation_window_hours into v_window from venue_settings;
    if v.start_at < now() + make_interval(hours => coalesce(v_window, 12)) then
      raise exception 'CANCELLATION_WINDOW' using errcode = 'P0001',
        hint = 'inside the cancellation window — contact the venue';
    end if;
  end if;

  v_before := to_jsonb(v);

  update reservations
     set status = 'cancelled',
         cancelled_at = now(),
         cancellation_reason = p_reason,
         -- The SAME branch the policy above turned on: a staff caller reaches
         -- this line without owning the row or clearing the window, a guest
         -- only after proving both. Recording it costs nothing here and is
         -- unrecoverable afterwards from the reservation alone.
         cancelled_by = (case when v_staff then 'staff' else 'guest' end)::cancellation_actor
   where id = p_reservation_id
   returning * into v;

  perform app.write_audit('reservation.cancel', 'reservations', v.id::text,
                          v_before, to_jsonb(v), p_reason);

  return jsonb_build_object('reservation_id', v.id, 'status', v.status,
                            'cancelled_by', v.cancelled_by);
end $cancel_reservation_0088$;

comment on function app.cancel_reservation(uuid, text) is
  '0088 = 0008 + the actor. Guest cancels an OWN booking outside cancellation_window_hours; staff cancel any live booking. Stamps reservations.cancelled_by from the same staff check the policy branch already makes, so the guest can be told whether they cancelled it or the venue did.';

-- Grants are unchanged (0008): create or replace preserves them and the
-- signature has not moved. Restated so this file reads on its own.
revoke all on function app.cancel_reservation(uuid, text) from public, anon;
grant execute on function app.cancel_reservation(uuid, text) to authenticated;
