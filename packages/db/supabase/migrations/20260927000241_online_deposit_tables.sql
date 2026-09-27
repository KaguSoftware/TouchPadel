-- 0241 online_deposit_tables — an online deposit on a court booking, paid on
-- Qi Card's hosted page (docs/design/payments/qi-deposit-plan-2026-09-20.md,
-- contracts docs/design/payments/build-contracts-2026-09-27.md).
--
--   1. booking_payments: one row per payment attempt. Only the app.deposit_*
--      functions (0242) write it; nobody reads it directly but the service
--      role. The guest reads their own attempt through app.deposit_status.
--   2. booking_payment_events: every byte Qi sends us and every decision we
--      take about a payment, append-only, matched or not.
--   3. The deposit rules per branch on venue_settings. deposit_mode ships
--      'off': nothing changes for a guest until the owner turns it on in
--      Settings, after the Qi secrets are set (docs/client/qi-card-activation.md).
--   4. profiles.payment_sandbox: the App Review account pays on Qi's sandbox.
--   5. customer_flags type deposit_exempt: this guest never has to pay first.
--   6. notification_outbox kind deposit_refunded.
--
-- Deliberately NOT a row in payments: that ledger needs a staff recorded_by and
-- an open day, and it feeds the till's cash count. A deposit paid at 03:00 is
-- neither (plan §3.4).

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ---------------------------------------------------------------------------
-- 1. booking_payments
-- ---------------------------------------------------------------------------
create table if not exists booking_payments (
  id                  uuid primary key default gen_random_uuid(),
  venue_id            uuid not null default app.current_venue() references venues(id),
  reservation_id      uuid not null references reservations(id),
  hold_id             uuid not null references reservations(id),
  guest_id            uuid references profiles(id) on delete set null,
  purpose             text not null default 'deposit' check (purpose in ('deposit')),
  provider            text not null check (provider in ('qi', 'fake')),
  sandbox             boolean not null default false,
  request_id          uuid not null unique,
  provider_payment_id text unique check (provider_payment_id is null or char_length(provider_payment_id) between 1 and 200),
  amount_iqd          iqd not null check (amount_iqd > 0),
  quoted_price_iqd    iqd not null,
  locale              text not null default 'ar' check (locale in ('en', 'ar')),
  status              text not null default 'created'
                        check (status in ('created', 'pending', 'succeeded', 'failed', 'expired',
                                          'refund_pending', 'refunded', 'refund_failed')),
  provider_status     text check (provider_status is null or char_length(provider_status) <= 64),
  form_url            text check (form_url is null or (form_url ~ '^https?://' and char_length(form_url) <= 2048)),
  deadline_at         timestamptz not null,
  last_checked_at     timestamptz,
  succeeded_at        timestamptz,
  failed_at           timestamptz,
  expired_at          timestamptz,
  forfeited_at        timestamptz,
  failure_code        text check (failure_code is null or failure_code in ('declined', 'auth_failed', 'bank_error', 'cancelled')),
  refund_reason       text check (refund_reason is null or refund_reason in
                        ('guest_cancel', 'staff_cancel', 'no_show', 'slot_lost', 'venue_offline',
                         'amount_mismatch', 'duplicate_success', 'manual', 'staff_refund')),
  refund_amount_iqd   iqd,
  refund_request_id   uuid unique,
  refund_provider_id  text check (refund_provider_id is null or char_length(refund_provider_id) <= 200),
  refund_note         text check (refund_note is null or char_length(refund_note) <= 300),
  refund_requested_at timestamptz,
  refunded_at         timestamptz,
  refund_attempts     int not null default 0,
  cancel_attempts     int not null default 0,
  claimed_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  -- Money moved exactly when these say it did (plan §3.2, I3).
  constraint booking_payments_succeeded_stamp
    check (status not in ('succeeded', 'refund_pending', 'refunded', 'refund_failed') or succeeded_at is not null),
  constraint booking_payments_refund_reason
    check (status not in ('refund_pending', 'refunded', 'refund_failed')
           or (refund_reason is not null and refund_amount_iqd is not null)),
  constraint booking_payments_refund_amount
    check (refund_amount_iqd is null or (refund_amount_iqd > 0 and refund_amount_iqd <= amount_iqd)),
  constraint booking_payments_refunded_stamp
    check (status <> 'refunded' or refunded_at is not null)
);

comment on table booking_payments is
  '0241. One online payment attempt on a court booking (a deposit, Qi Card hosted page). Written only by the app.deposit_* functions (0242); request_id is what Qi gets, provider_payment_id what Qi answered. reservation_id is the booking the money is for (it moves when a swept hold is re-created as a booking); hold_id is where the attempt began and never changes. Not a till payment: no recorded_by, no day, not in the cash count.';

-- At most one live attempt per hold, enforced here rather than by the app
-- (plan §3.1, I1): a double tap or a second phone gets the same attempt back.
create unique index if not exists booking_payments_one_active
  on booking_payments (hold_id) where status in ('created', 'pending');
create index if not exists booking_payments_due
  on booking_payments (status, deadline_at);
create index if not exists booking_payments_reservation
  on booking_payments (reservation_id);
create index if not exists booking_payments_guest
  on booking_payments (guest_id, created_at desc);

alter table booking_payments enable row level security;
-- No policy: guests and staff read it through app.deposit_status,
-- app.booking_bill and app.deposit_attention. The service role bypasses RLS.
revoke all on booking_payments from anon, authenticated;
grant all on booking_payments to service_role;

drop trigger if exists zz_branch_guard on public.booking_payments;
create trigger zz_branch_guard before insert or update or delete on public.booking_payments
  for each row execute function app.trg_branch_guard('scoped', 'reservations', 'reservation_id', 'reservations', 'hold_id');

-- ---------------------------------------------------------------------------
-- 2. booking_payment_events — append-only
-- ---------------------------------------------------------------------------
create table if not exists booking_payment_events (
  id              bigint generated always as identity primary key,
  payment_id      uuid references booking_payments(id),
  source          text not null check (source in ('begin', 'created', 'webhook', 'poll', 'reconcile',
                                                  'refund', 'manual', 'decision')),
  provider_status text check (provider_status is null or char_length(provider_status) <= 64),
  signature_ok    boolean,
  note            text check (note is null or char_length(note) <= 300),
  raw             jsonb not null default '{}'::jsonb,
  at              timestamptz not null default now()
);

comment on table booking_payment_events is
  '0241. Append-only log of every payment message (Qi webhooks and status answers, matched or not: an unmatched webhook has payment_id null) and every decision taken about a payment. Card data never lands here: the edge functions strip maskedPan, rrn and authId first.';

create index if not exists booking_payment_events_payment
  on booking_payment_events (payment_id, at);

alter table booking_payment_events enable row level security;
revoke all on booking_payment_events from anon, authenticated;
grant all on booking_payment_events to service_role;

drop trigger if exists booking_payment_events_append_only on booking_payment_events;
create trigger booking_payment_events_append_only
  before update or delete or truncate on booking_payment_events
  for each statement execute function app.forbid_mutation();

-- ---------------------------------------------------------------------------
-- 3. The deposit rules, per branch.
-- ---------------------------------------------------------------------------
alter table venue_settings add column if not exists deposit_mode text not null default 'off';
alter table venue_settings add column if not exists deposit_percent_bp int not null default 5000;
alter table venue_settings add column if not exists deposit_min_iqd bigint not null default 10000;
alter table venue_settings add column if not exists deposit_max_iqd bigint;
alter table venue_settings add column if not exists deposit_window_seconds int not null default 900;
alter table venue_settings add column if not exists deposit_forfeit_no_show boolean not null default true;

do $deposit_settings_checks_0241$
begin
  if not exists (select 1 from pg_constraint
                  where conname = 'venue_settings_deposit_rules'
                    and conrelid = 'public.venue_settings'::regclass) then
    alter table venue_settings add constraint venue_settings_deposit_rules check (
      deposit_mode in ('off', 'optional', 'required')
      and deposit_percent_bp between 100 and 10000
      and deposit_min_iqd between 0 and 10000000
      and (deposit_max_iqd is null or (deposit_max_iqd >= deposit_min_iqd and deposit_max_iqd <= 10000000))
      and deposit_window_seconds between 120 and 1800
    ) not valid;
  end if;
end $deposit_settings_checks_0241$;

do $deposit_settings_validate_0241$
begin
  if exists (select 1 from pg_constraint
              where conname = 'venue_settings_deposit_rules'
                and conrelid = 'public.venue_settings'::regclass
                and not convalidated) then
    alter table venue_settings validate constraint venue_settings_deposit_rules;
  end if;
end $deposit_settings_validate_0241$;

comment on column venue_settings.deposit_mode is
  '0241. Online deposit on guest bookings: off (never asked), optional (Pay now or pay at the desk), required (pay first). Owner-set via app.set_deposit_settings. Ships off.';
comment on column venue_settings.deposit_percent_bp is
  '0241. Deposit as basis points of the court price (5000 = 50 %), rounded up to 250 IQD, then held between deposit_min_iqd and deposit_max_iqd and never above the price.';
comment on column venue_settings.deposit_window_seconds is
  '0241. How long a guest has on the payment page; the hold is extended to cover it.';
comment on column venue_settings.deposit_forfeit_no_show is
  '0241. A no-show keeps the deposit (true) or refunds it (false). A cancelled booking always refunds.';

-- ---------------------------------------------------------------------------
-- 4. The App Review account pays on Qi's sandbox (plan §9).
-- ---------------------------------------------------------------------------
alter table profiles add column if not exists payment_sandbox boolean not null default false;
comment on column profiles.payment_sandbox is
  '0241. Set by hand on the store review account only: its deposits go to Qi''s sandbox (test card, no money), are stamped sandbox and never count as paid or as revenue.';

-- ---------------------------------------------------------------------------
-- 5. customer_flags: deposit_exempt.
-- ---------------------------------------------------------------------------
alter table customer_flags drop constraint if exists customer_flags_type_check;
alter table customer_flags add constraint customer_flags_type_check
  check (type in ('vip', 'birthday', 'payment_note', 'special_request', 'deposit_exempt')) not valid;

do $customer_flags_validate_0241$
begin
  if exists (select 1 from pg_constraint
              where conname = 'customer_flags_type_check'
                and conrelid = 'public.customer_flags'::regclass
                and not convalidated) then
    alter table customer_flags validate constraint customer_flags_type_check;
  end if;
end $customer_flags_validate_0241$;

-- ---------------------------------------------------------------------------
-- 6. notification_outbox: deposit_refunded (send-push STRINGS carries its copy).
-- ---------------------------------------------------------------------------
alter table notification_outbox drop constraint if exists notification_outbox_kind_check;
alter table notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in ('booking_confirmed', 'booking_reminder', 'booking_cancelled',
                  'booking_no_show', 'test',
                  'staff_task', 'staff_decide', 'staff_decided', 'staff_info',
                  'deposit_refunded'))
  not valid;

do $validate_kind_check_0241$
begin
  if exists (select 1 from pg_constraint
              where conname = 'notification_outbox_kind_check'
                and conrelid = 'public.notification_outbox'::regclass
                and not convalidated) then
    alter table notification_outbox validate constraint notification_outbox_kind_check;
  end if;
end $validate_kind_check_0241$;
