# Telegram staff-group setup (owner checklist)

New guest orders and waiter calls are posted to one Telegram group with inline
buttons (`✅ شوهد / 🍽 تم التقديم / ❌ إلغاء`, `✅ أنا قادم / ✔️ تم`). Taps write
back to the KDS through `app.telegram_apply_action`. Three edge functions are
involved: `telegram-send` (outbox sender), `telegram-callback` (webhook) and
`telegram-diagnose` (owner health check + webhook registration, 0091).
Everything below is done once per Supabase project.

> **Something not arriving? Start at Operator → Settings → Telegram → Diagnose →
> Run diagnosis.** It asks Telegram about the token, the bot, the saved group,
> the bot's membership, the webhook, the recent outbox rows and the tap allowlist,
> and names the fix for each. The 2026-09-13 outage (nothing ever delivered) was
> the saved chat id being the placeholder `-1001234567890`, written onto hosted
> by an e2e run through a reused dev server — see `e2e/playwright.config.ts`.

## 1. Create the bot

Open [@BotFather](https://t.me/BotFather) → `/newbot` → name **Touch Cafe Orders**,
username ending in `bot` (e.g. `touchcafe_orders_bot`) → copy the **token**
(`123456789:AA…`). Treat it like a password.

## 2. Create the staff group

Create a Telegram group for the staff. **Add the bot after step 7** (the webhook
must exist first, so Telegram tells us about the group). The bot does not need
to be an admin, and disabling privacy mode is NOT required — button callbacks
work regardless. Promoting members to admin can upgrade a basic group to a
supergroup, which CHANGES its id; `telegram-send` and `telegram-callback` follow
that upgrade automatically (0091).

The group id is picked in the operator (step 8), not read by hand. Fallback only
while NO webhook is registered: send a message in the group, then
`curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and copy the negative
`message.chat.id`. Once a webhook exists `getUpdates` answers **409 Conflict**.

## 3. Generate the webhook secret

```sh
openssl rand -hex 32
```

## 4. Store both secrets in the project

```sh
cd packages/db
pnpm exec supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret>
```

## 5. Vault + extensions (lets the DB call the sender itself)

Dashboard → Database → Extensions: enable **pg_net** and **pg_cron**. Then in the
SQL editor (once):

```sql
select vault.create_secret('<service-role-key>', 'service_role_key');
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_base_url');
```

`app.telegram_nudge` reads these two names; without them only the 10-second
`tp_telegram_sweep` cron reaches the sender (messages still arrive, just slower).

## 6. Deploy the functions

```sh
pnpm exec supabase functions deploy telegram-send telegram-callback telegram-diagnose
pnpm exec supabase functions list     # telegram-callback must show verify_jwt = false
```

`verify_jwt` comes from `supabase/config.toml` (`telegram-callback` = false: Telegram
sends no Supabase JWT, the secret header is the auth; `telegram-send` = true).

## 7. Register the webhook

Operator → Settings → Telegram → Diagnose → **Run diagnosis**, then
**Re-register webhook** on the Webhook row. It registers
`https://<ref>.supabase.co/functions/v1/telegram-callback` with the project's
`TELEGRAM_WEBHOOK_SECRET` and `allowed_updates` `callback_query` +
`my_chat_member` — the second is what lets the bot report the groups it joins.

Fallback by hand:

```sh
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://<ref>.supabase.co/functions/v1/telegram-callback \
  -d secret_token=<SECRET> \
  -d 'allowed_updates=["callback_query","my_chat_member"]'
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

Expect `"pending_update_count": 0` and no `last_error_message`.

## 8. Switch it on in the operator app

Add the bot to the staff group now (or remove it and add it again). Within
seconds it appears under Operator → Settings → Telegram → **Detected groups**;
press **Use this group**, enable, press **Send test** —
the `🔔 رسالة تجريبية` message must appear in the group within a few seconds.
Then place a fixture order from the guest menu and tap `✅ شوهد`: the toast says
`تم ✅`, the message gains a `✅ شوهد · Seen — <name> · HH:mm` footer, and the KDS
ticket flips to *preparing*.

## 8b. Allowlist the people who may drive the bot (0039 — REQUIRED)

The webhook secret authenticates *Telegram*, not the person tapping. Since
migration 0039 a tap is refused unless **both** hold:

1. the message came from the chat in `cafe_settings.telegram_chat_id` (step 8), and
2. `from.id` is an active row in `telegram_staff`.

`❌ إلغاء` additionally requires that row to carry `can_void` — it is the
Telegram equivalent of the manager PIN that `void_after_send` demands
everywhere else, so grant it to managers and owners only.

**This fails closed: until the allowlist is seeded, every button is refused.**
Do it in the same maintenance window as the migration, not after.

Read each person's numeric Telegram id — have them tap any button once and read
it back from the ledger:

```sql
select tg_user_id, tg_first_name, tg_username, result, detail, at
  from telegram_actions
 order by id desc limit 20;   -- refused rows carry detail = 'not_allowlisted'
```

Then map each one to a staff row (owner only):

```sql
select app.set_telegram_staff(
  p_tg_user_id => 4242,
  p_staff_id   => '<staff.id>',
  p_label      => 'Ahmed (manager)',
  p_can_void   => true,        -- managers/owners only
  p_is_active  => true);
```

Revoke by re-running with `p_is_active => false`; the row stays for the audit
trail. Every call writes a `telegram.staff_set` audit entry.

## 9. Troubleshooting

| Symptom | Look at |
|---|---|
| Anything | **Run diagnosis** first (Settings → Telegram → Diagnose). Each failing row names its fix. |
| Group never shows under Detected groups | The webhook was registered for `callback_query` only (Diagnose shows a Webhook warning) — Re-register, then remove and re-add the bot. |
| No message arrives | `select id, chat_id, status, attempts, last_error from telegram_outbox order by id desc limit 10;` and the `telegram-send` logs. `NOT_CONFIGURED` = token secret missing; `HTTP 400: chat not found` = wrong chat id / bot not in the group / token of a different bot (compare `chat_id` with `cafe_settings.telegram_chat_id`); `HTTP 403` = bot kicked. Owner re-queues a row with Retry (`app.retry_telegram_outbox(id)`), which since 0091 sends it to the CURRENT saved group. |
| Buttons do nothing | `getWebhookInfo` — a `last_error_message` with 401 means the secret differs between `setWebhook` and `TELEGRAM_WEBHOOK_SECRET`; `telegram-callback` logs show the 401s. |
| Message lands in the wrong group | Re-read the chat id (`getUpdates`) — supergroup conversion changes it. |
| Slow (> 10 s) | Only the cron sweep is running: Vault names `service_role_key` / `functions_base_url` missing or `pg_net` disabled (step 5). |
| Toast `غير ممكن الآن` on every tap | The ticket/call was already moved from the till; the tap is recorded in `telegram_actions` with `result = invalid`. |
| Toast `الطلب مدفوع — الإلغاء من الكاشير` | The tab was settled; Telegram cannot void a paid order — cancel from the till. |
| Every tap refused, nothing changes | `select action, result, detail from telegram_actions order by id desc limit 10;` — `wrong_chat` = the message came from a chat other than `cafe_settings.telegram_chat_id` (or that setting is unset); `not_allowlisted` = the tapper is missing from `telegram_staff`; `void_not_authorized` = allowlisted but without `can_void`. See step 8b. |

## Local development

```sh
cd packages/db
cp supabase/functions/.env.example supabase/functions/.env   # gitignored; fill in the two secrets
pnpm exec supabase functions serve --env-file supabase/functions/.env
```

Point the DB at the local runtime so `telegram_nudge` reaches it:

```sql
insert into app.secrets (name, value) values ('functions_base_url', 'http://host.docker.internal:54321/functions/v1')
on conflict (name) do update set value = excluded.value;
```

(`service_role_key` comes from `supabase status`.) Manual invocations:

```sh
curl -X POST http://127.0.0.1:54321/functions/v1/telegram-send \
  -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H "Content-Type: application/json" -d '{}'
curl -X POST http://127.0.0.1:54321/functions/v1/telegram-callback \
  -H "X-Telegram-Bot-Api-Secret-Token: $TELEGRAM_WEBHOOK_SECRET" -H "Content-Type: application/json" \
  -d '{"update_id":1,"callback_query":{"id":"1","from":{"id":42,"first_name":"Ahmed"},"message":{"message_id":7,"chat":{"id":-1001}},"data":"o:seen:<order_uuid>"}}'
```

Real taps need a public URL: expose the callback with `ngrok http 54321` or
`cloudflared tunnel --url http://127.0.0.1:54321` and `setWebhook` to
`https://<tunnel>/functions/v1/telegram-callback` — only while testing, then
point the webhook back at the hosted project.
