-- 0091_telegram_diagnose — the staff group can be found, and a retry reaches it.
--
-- ---------------------------------------------------------------------------
-- THE GAP (2026-09-13)
-- ---------------------------------------------------------------------------
--
-- No Telegram notification had ever reached the staff group. Every outbox row
-- since 2026-09-05 failed with `HTTP 400: Bad Request: chat not found`. The
-- hosted cafe_settings.telegram_chat_id held `-1001234567890` — the operator's
-- placeholder — written on 2026-09-03 08:58 by an e2e run that reached the
-- hosted project through a reused dev server (audit_log settings.cafe, actor
-- Dev Owner; see e2e/playwright.config.ts). Two defects kept it unfixable
-- from the app:
--
--   1. app.retry_telegram_outbox (0032) re-queued a row with the chat_id it
--      was SNAPSHOTTED with at enqueue. Correcting the setting and pressing
--      Retry sent to the wrong chat again.
--   2. The only documented way to learn a group's id is Bot API getUpdates,
--      which answers 409 Conflict once a webhook is registered — and the
--      webhook was registered for callback_query only, so the bot never told
--      us which groups it had been added to.
--
-- ---------------------------------------------------------------------------
-- THE CHANGE
-- ---------------------------------------------------------------------------
--
--   1. app.retry_telegram_outbox re-targets the row at the CURRENT
--      telegram_chat_id (falls back to the snapshot when the setting is unset).
--   2. telegram_chats: every group the bot has been added to / removed from,
--      written by telegram-callback from `my_chat_member` updates (service
--      role) and read by the operator's "Detected groups" list. The webhook is
--      re-registered with allowed_updates [callback_query, my_chat_member] by
--      the new telegram-diagnose function.
--
-- Additive; no data rewritten. Owner RPC signature unchanged.

set lock_timeout = '3s';
set statement_timeout = '60s';

-- ═══════════════════════════════════════════════════════════════════════════
-- 1. Retry targets the current chat
-- ═══════════════════════════════════════════════════════════════════════════
create or replace function app.retry_telegram_outbox(p_id bigint) returns void
language plpgsql security definer set search_path = public as $tg_retry_0091$
begin
  if not app.is_staff('owner') then
    raise exception 'FORBIDDEN' using errcode = 'P0001';
  end if;

  update telegram_outbox
     set status        = 'queued',
         attempts      = 0,
         scheduled_for = now(),
         last_error    = null,
         chat_id       = coalesce(nullif(app.cafe_setting_text('telegram_chat_id'), ''), chat_id)
   where id = p_id;
  if not found then
    raise exception 'OUTBOX_NOT_FOUND' using errcode = 'P0001';
  end if;

  perform app.telegram_nudge();
end $tg_retry_0091$;

revoke all on function app.retry_telegram_outbox(bigint) from public, anon;
grant execute on function app.retry_telegram_outbox(bigint) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- 2. Groups the bot has seen
-- ═══════════════════════════════════════════════════════════════════════════
create table if not exists telegram_chats (
  chat_id    text primary key check (chat_id ~ '^-?[0-9]{5,20}$'),
  title      text,
  type       text not null check (type in ('group', 'supergroup')),
  bot_status text not null,                 -- Bot API ChatMember.status: member | administrator | left | kicked | ...
  updated_at timestamptz not null default now()
);

comment on table telegram_chats is
  'Telegram groups the staff bot has been added to or removed from (0091), upserted by telegram-callback from my_chat_member updates. The operator lists them so the owner picks the group instead of reading getUpdates. Clients: manager|owner SELECT only; writes are service role.';

alter table telegram_chats enable row level security;

-- Supabase's default privileges hand new public tables to anon/authenticated;
-- start from nothing, then grant the one read.
revoke all on telegram_chats from anon, authenticated;
grant select on telegram_chats to authenticated;

drop policy if exists telegram_chats_mgmt_read on telegram_chats;
create policy telegram_chats_mgmt_read on telegram_chats for select to authenticated
  using (app.is_staff('manager','owner'));

grant all on telegram_chats to service_role;
