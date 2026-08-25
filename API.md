# API keys & credentials — what we still need

Everything the system needs from an outside account, in one place. Companions:
[`docs/client/00-input-checklist.md`](docs/client/00-input-checklist.md) (business data: menu, courts,
rates, fonts, hardware) and
[`packages/db/supabase/functions/SETUP-telegram.md`](packages/db/supabase/functions/SETUP-telegram.md)
(the full Telegram walkthrough).

**Nothing in this file blocks the app from running.** Every integration below is written to no-op
cleanly when its key is absent — the menu, ordering, KDS, till and day-close all work today without a
single one of them. What you lose is listed per service under *"What breaks without it"*.

Status as of **2026-08-25**: none of these are configured. The hosted database is fully migrated
(0027–0035), but the edge functions are **not deployed** yet, so Telegram, PostHog and Groq are all
dormant regardless.

---

## The short list

| # | What | Who gets it | Blocking? | Goes into |
|---|---|---|---|---|
| 1 | **Telegram bot token** | @BotFather (free, 2 min) | Blocks Telegram ordering | Supabase secret |
| 2 | **Telegram staff group chat id** | The group itself, via `getUpdates` | Blocks Telegram ordering | Operator UI |
| 3 | **PostHog project API key** | posthog.com, EU region | Blocks guest analytics | Vercel env |
| 4 | **PostHog personal API key + project id** | Same account | Blocks the analytics dashboard | Supabase secret |
| 5 | **Groq API key** | console.groq.com (free tier) | Blocks AI insights only | Supabase secret |
| 6 | **Supabase access token + db password** | Supabase account settings | Blocks CI auto-migrate | GitHub secrets |
| 7 | **The real domain** | Your registrar | Blocks printing QR cards | Vercel + operator env |

> ⚠️ **#5 is Groq, not Grok.** [console.groq.com](https://console.groq.com) — the inference company.
> Not xAI's "Grok" chatbot. They are different companies with near-identical names, and signing up to
> the wrong one is an easy mistake to make.

---

## How to hand these over

**Do not commit any of these values to the repo, and do not paste them into a shared document.**
`.env*` files are gitignored for exactly this reason.

The safest route is that **you** run the `supabase secrets set` / Vercel commands below — the values
never leave your machine. If you'd rather I wire them up, send them over a channel you trust and
rotate anything that ends up somewhere you don't control. Treat the bot token and the service-role
key like passwords: the bot token lets anyone post as Touch Cafe, and the service-role key bypasses
every row-level security policy in the database.

If a key does leak: regenerate it at the provider, re-run the `set` command, and redeploy. All of
them are cheap to rotate — except the table-token secret (§8), which invalidates every printed QR
card in the venue.

---

## 1–2. Telegram — order & waiter notifications

New guest orders and waiter calls post to one staff group with inline buttons
(`✅ شوهد / 🍽 تم التقديم / ❌ إلغاء`, `✅ أنا قادم / ✔️ تم`). Button taps write straight back to the
KDS ticket status.

**What we need**

| Value | Where it comes from |
|---|---|
| `TELEGRAM_BOT_TOKEN` | [@BotFather](https://t.me/BotFather) → `/newbot` → name it *Touch Cafe Orders* → copy the `123456789:AA…` token |
| Staff group **chat id** | Create the group, add the bot, send any message, then `curl "https://api.telegram.org/bot<TOKEN>/getUpdates"` and copy `message.chat.id` — it is **negative** for groups, keep the minus sign |
| `TELEGRAM_WEBHOOK_SECRET` | Not from anyone — generate it: `openssl rand -hex 32` |

**Where it goes**

```sh
cd packages/db
pnpm exec supabase secrets set TELEGRAM_BOT_TOKEN=<token> TELEGRAM_WEBHOOK_SECRET=<secret>
```

The **chat id is not an env var** — it is a setting you paste into the operator app
(*Admin → Telegram*), so the venue can change groups without a redeploy.

**Also required for Telegram** (one-off, dashboard): enable the `pg_net` and `pg_cron` extensions,
then in the SQL editor:

```sql
select vault.create_secret('<service-role-key>', 'service_role_key');
select vault.create_secret('https://<ref>.supabase.co/functions/v1', 'functions_base_url');
```

Without these two the messages still arrive, just via the 10-second cron sweep instead of instantly.

**Gotcha:** converting the group to a supergroup **changes the chat id**. Re-read it if messages stop.

**What breaks without it:** nothing crashes. Orders still reach the KDS and the till exactly as they
do now; the outbox simply marks rows `skipped`. Waiters just don't get phone notifications.

**Verify:** Operator → Admin → Telegram → *Send test message*. The `🔔 رسالة تجريبية` message must
appear in the group within a few seconds.

---

## 3–4. PostHog — guest analytics

Two **different** keys, doing two different jobs. This trips people up.

| Value | What it does | Where it goes |
|---|---|---|
| **Project API key** (`phc_…`) | Lets guests' browsers send events | Vercel env `NEXT_PUBLIC_POSTHOG_KEY` |
| **Personal API key** (`phx_…`) | Lets our dashboard *read* the data back | Supabase secret `POSTHOG_PERSONAL_API_KEY` |
| **Project id** (a number) | Which project to query | Supabase secret `POSTHOG_PROJECT_ID` |

Create the project in the **EU region** (data residency, and it's closer to Iraq).

```sh
# Browser side — Vercel → Settings → Environment Variables, then redeploy WITHOUT build cache
NEXT_PUBLIC_POSTHOG_KEY=phc_…
NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com

# Dashboard side
cd packages/db
pnpm exec supabase secrets set POSTHOG_PERSONAL_API_KEY=phx_… POSTHOG_PROJECT_ID=12345
```

> The two hosts are **deliberately different** and not a typo:
> `https://eu.i.posthog.com` is the browser **ingestion** endpoint, `https://eu.posthog.com` is the
> **API** endpoint the dashboard queries. Each defaults correctly, so you can leave both unset.

**On query volume:** the dashboard batches all its HogQL queries into one request per window and
caches for 30s. Auto-refresh is **off by default** and opt-in per station (1/2/5 min), and it only
polls while the analytics tab is actually open and looking at a live range.

**Optional — engagement floor.** Analytics before go-live are noise (staff testing, our own e2e
runs). Set the go-live date and everything earlier is ignored. Two places, both optional:
the owner sets it in *Operator → Admin → Settings* (`analytics_engagement_floor`), or hard-clip it
for every query with the `POSTHOG_ENGAGEMENT_FLOOR=YYYY-MM-DD` secret.

**What breaks without it:** the analytics page still works and still shows **sales, margins, best
sellers, bought-together and price bands** — all of that comes from our own till data, not PostHog.
Only the *engagement* half goes quiet (menu views, dwell time, look-but-didn't-buy, funnels), and
those cards say "Guest analytics are not configured yet" rather than showing zeros. On the guest
side, no key means the tracking SDK is never even downloaded — verified by an e2e test that fails if
the page contacts posthog.com without a key.

---

## 5. Groq — AI insights

Plain-language reading of the numbers ("Kahi sells twice as well on Fridays"), plus pattern mining.

```sh
cd packages/db
pnpm exec supabase secrets set GROQ_API_KEY=gsk_…
```

Optional overrides — the defaults are already sensible:

| Secret | Default |
|---|---|
| `GROQ_MODEL` | `openai/gpt-oss-120b` |
| `GROQ_JUDGE_MODEL` | `llama-3.1-8b-instant` |

**Cost:** Groq's free tier is rate-limited but genuinely free, and the dashboard only calls it when
the owner opens the analytics page or presses re-check — not on a schedule.

**What breaks without it:** the Insights card falls back to **deterministic templated sentences**
generated from the same numbers. Less fluent, still correct and still useful — it is a real fallback,
not an error state. The card says so.

---

## 6. Supabase — CI auto-migrate

Only needed if you want migrations to apply themselves when code merges to `main`. Today the CI job
detects the missing secrets and **skips with a notice** instead of failing.

GitHub → *Settings → Secrets and variables → Actions*:

| Secret | Value |
|---|---|
| `SUPABASE_ACCESS_TOKEN` | Supabase → Account → Access Tokens → generate |
| `PROJECT_REF` | `lczijabnorujcgmbuqlw` (bare id — not a URL, not the db host) |
| `SUPABASE_DB_PASSWORD` | The database password for that project |

> 🛑 **Before you add these**, add **required reviewers** to the `staging` environment
> (*Settings → Environments → staging*). That project is the client's live database. Without
> reviewers, any merge to `main` that touches a migration applies it with nobody approving.

---

## 7. Domain

Until the real domain exists, **QR table cards cannot be printed** — the operator refuses rather than
print a `vercel.app` or `localhost` URL onto physical cards that get glued to tables.

| Variable | Where | Example |
|---|---|---|
| `NEXT_PUBLIC_SITE_URL` | Vercel | `https://menu.touchpadel.iq` |
| `VITE_GUEST_SITE_URL` | Each operator station's `.env` | same value |

Currently live at `touch-padel-web.vercel.app`, which is fine for testing and wrong for print.

---

## 8. Already provisioned — for reference

Nothing needed from you here; recorded so nobody re-creates them by accident.

| Value | Where it lives | Notes |
|---|---|---|
| Supabase URL + anon/publishable key | Vercel, operator `.env`, mobile `.env` | Safe to expose; RLS is the real protection |
| **Service-role key** | Supabase Vault + edge functions only | **Never** in any client app or the repo — it bypasses all RLS |
| `table_token_secret` | Supabase Vault | HMAC secret for QR table tokens. **Rotating it kills every printed card in the venue** — it must be carried over unchanged if the project ever moves |
| `functions_base_url` | Supabase Vault | Lets the database call its own edge functions |

---

## Once keys are in — deploy the functions

None of the above does anything until the edge functions exist on the project:

```sh
cd packages/db
pnpm exec supabase functions deploy telegram-send telegram-callback analytics-posthog analytics-insights
pnpm exec supabase functions list   # telegram-callback MUST show verify_jwt = false
```

Then register the Telegram webhook (step 7 of `SETUP-telegram.md`):

```sh
curl "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d url=https://<ref>.supabase.co/functions/v1/telegram-callback \
  -d secret_token=<SECRET> \
  -d 'allowed_updates=["callback_query"]'
```

---

## Checklist

- [ ] Telegram bot created, token sent / set
- [ ] Staff group created, bot added, chat id read
- [ ] Webhook secret generated (`openssl rand -hex 32`)
- [ ] `pg_net` + `pg_cron` enabled, Vault secrets created
- [ ] PostHog EU project created; project API key → Vercel; personal key + project id → Supabase
- [ ] Groq key created (groq.com — **not** xAI)
- [ ] `staging` environment given required reviewers, **then** the three GitHub secrets added
- [ ] Domain registered and DNS pointed; `NEXT_PUBLIC_SITE_URL` + `VITE_GUEST_SITE_URL` set
- [ ] Edge functions deployed; Telegram webhook registered
- [ ] Engagement floor set to the go-live date
- [ ] Telegram test message received in the group
