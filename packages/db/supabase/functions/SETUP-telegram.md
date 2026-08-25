# Telegram staff-group setup (owner checklist)

New guest orders and waiter calls are posted to one Telegram group with inline
buttons (`✅ شوهد / 🍽 تم التقديم / ❌ إلغاء`, `✅ أنا قادم / ✔️ تم`). Taps write
back to the KDS through `app.telegram_apply_action`. Two edge functions are
involved: `telegram-send` (outbox sender) and `telegram-callback` (webhook).
Everything below is done once per Supabase project.

## 1. Create the bot

Open [@BotFather](https://t.me/BotFather) → `/newbot` → name **Touch Cafe Orders**,
username ending in `bot` (e.g. `touchcafe_orders_bot`) → copy the **token**
(`123456789:AA…`). Treat it like a password.

## 2. Create the staff group and read its chat id

1. Create a Telegram group for the staff, add the bot as a member. Disabling the
   bot's privacy mode is NOT required — button callbacks work regardless.
2. Send any message in the group, then:
   ```sh
   curl "https://api.telegram.org/bot<TOKEN>/getUpdates"
   ```
   Copy `message.chat.id`. For groups it is **negative** (`-1001234567890`) — keep
   the minus sign. If `result` is empty, send another message and retry (or remove
   and re-add the bot). Converting the group to a supergroup later CHANGES the id —
   re-read it.

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
pnpm exec supabase functions deploy telegram-send telegram-callback
pnpm exec supabase functions list     # telegram-callback must show verify_jwt = false
```

`verify_jwt` comes from `supabase/config.toml` (`telegram-callback` = false: Telegram
sends no Supabase JWT, the secret header is the auth; `telegram-send` = true).

## 7. Register the webhook

```sh
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://<ref>.supabase.co/functions/v1/telegram-callback \
  -d secret_token=<SECRET> \
  -d 'allowed_updates=["callback_query"]'
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

Expect `"pending_update_count": 0` and no `last_error_message`.

## 8. Switch it on in the operator app

Operator → Settings → Telegram: paste the chat id, enable, press **Send test** —
the `🔔 رسالة تجريبية` message must appear in the group within a few seconds.
Then place a fixture order from the guest menu and tap `✅ شوهد`: the toast says
`تم ✅`, the message gains a `✅ شوهد · Seen — <name> · HH:mm` footer, and the KDS
ticket flips to *preparing*.

## 9. Troubleshooting

| Symptom | Look at |
|---|---|
| No message arrives | `select id, status, attempts, last_error from telegram_outbox order by id desc limit 10;` and the `telegram-send` logs. `NOT_CONFIGURED` = token secret missing; `HTTP 400: chat not found` = wrong chat id / bot not in the group; `HTTP 403` = bot kicked. Owner re-queues a row with `app.retry_telegram_outbox(id)`. |
| Buttons do nothing | `getWebhookInfo` — a `last_error_message` with 401 means the secret differs between `setWebhook` and `TELEGRAM_WEBHOOK_SECRET`; `telegram-callback` logs show the 401s. |
| Message lands in the wrong group | Re-read the chat id (`getUpdates`) — supergroup conversion changes it. |
| Slow (> 10 s) | Only the cron sweep is running: Vault names `service_role_key` / `functions_base_url` missing or `pg_net` disabled (step 5). |
| Toast `غير ممكن الآن` on every tap | The ticket/call was already moved from the till; the tap is recorded in `telegram_actions` with `result = invalid`. |
| Toast `الطلب مدفوع — الإلغاء من الكاشير` | The tab was settled; Telegram cannot void a paid order — cancel from the till. |

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
