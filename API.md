# API keys & credentials — what we still need

Everything the system needs from an outside account, in one place. Companions:
[`docs/client/00-input-checklist.md`](docs/client/00-input-checklist.md) (business data: menu, courts,
rates, fonts, hardware) and
[`packages/db/supabase/functions/SETUP-telegram.md`](packages/db/supabase/functions/SETUP-telegram.md)
(the full Telegram walkthrough).

**Nothing in this file blocks the app from running.** Every integration below is written to no-op
cleanly when its key is absent — the menu, ordering, KDS, till and day-close all work today without a
single one of them. What you lose is listed per service under *"What breaks without it"*.

Status as of **2026-08-27**: **items 1–6 are done.** The hosted database is migrated to 0043, all
five secrets are set, all four edge functions are deployed, the Telegram webhook is registered and
the PostHog key is live in the shipped Vercel bundle. Telegram, PostHog and Groq are no longer
dormant.

Two things remain. **#7, the domain**, is blocked on the client and is the only item still gating a
feature (printing QR table cards). And the `staff` table on the hosted project still holds only
`Dev` seed rows, so the Telegram allowlist points at `Dev Owner` and must be repointed once real
staff exist. Sections 1–6 below are kept as the reference for re-doing any of this on a new project.

**2026-09-01 — social sign-in (a vendor addition, outside the SOW)** adds three **public** Google
identifiers (#8–10) and up to four new accounts (§8: Apple Developer, Google Cloud, Expo/EAS, Google
Play). **None of them exists yet.** They are created in the order given in
`docs/client/social-auth-setup-2026-09-01.md`, which also holds the paste-ready Claude-in-Chrome
prompts; identifiers reported by those prompts are copied into this file, secrets never are.

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
| 8 | **Google Web OAuth client id** (also the `aud` of Android id tokens) | Google Cloud console, project `Touch Padel` (Prompt A) | Blocks Google sign-in only (vendor addition) | `apps/mobile/eas.json` (all three profiles) + `apps/mobile/.env` as `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`; Supabase dashboard → Auth → Providers → Google → Client IDs (listed first) |
| 9 | **Google iOS OAuth client id** (its reversal is the iOS URL scheme, derived in `app.config.ts`) | Same project, client type iOS, bundle `com.kagu.touchpadel` (Prompt A) | Blocks Google sign-in on iOS; an EAS build fails at config time without it | `eas.json` + `.env` as `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID`; Supabase Google Client IDs (listed second) |
| 10 | **Google Android OAuth client(s)** — one per signing SHA-1: EAS keystore now, Play App Signing key later | Same project, client type Android, package `com.kagu.touchpadel` + the SHA-1 (Prompt A, then Prompt D) | Blocks Google sign-in on Android (`DEVELOPER_ERROR` without it) | **Nowhere.** It only has to exist in the Cloud project — not in the app, not in Supabase |

> All three Google values are **public identifiers, not secrets** — they ship inside the app
> bundle by design. Apple needs no identifier beyond the bundle id: Supabase → Auth → Providers →
> Apple → Client IDs = `com.kagu.touchpadel,host.exp.Exponent` (the second is Expo Go, development
> only — **remove before the store build**, Prompt D Task 4). The native flow needs no Apple
> Services ID, key or secret.

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
| `NEXT_PUBLIC_SITE_URL` | Vercel | `https://touch-padel.com` |
| `VITE_GUEST_SITE_URL` | Each operator station's `.env` | same value |

Currently live at `touch-padel-web.vercel.app`, which is fine for testing and wrong for print.

**The client chose `touch-padel.com`** (pack 2026-08-30). RDAP shows it already registered
2025-08-03 via Hostinger with expired-parking nameservers — most likely Touch's own lapsed
registration. Recovery/setup runbook: `docs/client/domain-setup-2026-08-30.md`.

---

## 8. Which account owns what

Verified 2026-08-26. The project spans four separate identities — check this table before
concluding an account "has no access", and note that three of these are **Kagu** accounts holding
client production data, which has to be resolved at handover. **Four more are pending as of
2026-09-01** (social sign-in + store release) — placeholder rows below, identity only; fill them
from the Chrome reports (`docs/client/social-auth-setup-2026-09-01.md`, Prompts A/B) and the
`eas init` output.

| Service | Account / owner | Identifier |
|---|---|---|
| GitHub | org **KaguSoftware**, repo `TouchPadel` | admin `ParSaMnSS` (parsaxavier@gmail.com) |
| Supabase | org **touch padel** (`knajulxwjmkypzvgybpb`) | project `lczijabnorujcgmbuqlw`, `eu-central-1` — **not** visible to parsamanes@yahoo.com |
| Client hosting contact | Mustafa (owner) — `Mustafa.akeel.awad1@gmail.com` (pack 2026-08-30 `hosting.email`) | approver contact `00995419010203` — **unverified**, parses as +995 Georgia not +964 Iraq |
| Vercel | team **BAU ENG's projects**, slug `bau-engs-projects` | project `touch-padel-web`; `bauseengineers-7480` is **not** a valid slug |
| PostHog | bau.se.engineers@gmail.com | project `touch-padel` — region unverified, must be EU |
| Apple Developer | **TBD** — enrolment type undecided: Individual under a Kagu-controlled Apple ID (≈24–48 h) vs Organization (needs Kagu's D-U-N-S, weeks). Owner said 2026-08-27 "Apple account exists" — unverified | Team ID **TBD** (10 chars); App ID `com.kagu.touchpadel` (EAS creates it on the first iOS build); membership expiry TBD |
| Google Cloud | **`parsaxavier@gmail.com`** (Prompt A, 2026-09-01) — Parsa's personal Google account, NOT the dedicated Kagu account the plan asked for: same handover concern as the Kagu accounts above; no billing enabled | project **`Touch Padel`**, id `touch-padel`, number `699390054618`, no organization; consent screen External / **Testing** (publishing needs the privacy + home pages); Web client `699390054618-egm0m36515stvli0dah67htvge6j88nh.apps.googleusercontent.com` + iOS client `699390054618-hdmsl0sn76i09b9esp7tae2t8ktj77sq.apps.googleusercontent.com` created 2026-09-01 (public identifiers; live in `eas.json` / `.env` / `config.toml`); Android client pending the EAS SHA-1 |
| Expo / EAS | **`parsa-mansouri`** — Parsa's personal Expo account (`eas init` 2026-09-01; the org question was answered before `owner` was set). Handover item: transfer to a Kagu org, then update `owner` in `app.config.ts` | project **@parsa-mansouri/touchpadel**, id `d9597f8e-79bb-4bc2-882e-c44c3a013045`, https://expo.dev/accounts/parsa-mansouri/projects/touchpadel; `eas.json` profiles development / staging / production |
| Google Play | **not yet created** — personal vs organization account decides the 12-testers/14-days rule (HANDOFF gotcha) | Play App Signing SHA-1 → a second Android OAuth client (Prompt D) |

The Supabase CLI on the dev machine is already authenticated against the project
(`pnpm exec supabase projects list` shows it linked), and `packages/db/.env.remote` holds the
service-role key locally — so CLI work does not need a dashboard login. The **database password is
stored nowhere in the repo**; `supabase/.temp/pooler-url` contains the user and host only.

---

## 9. Already provisioned — for reference

Nothing needed from you here; recorded so nobody re-creates them by accident.

| Value | Where it lives | Notes |
|---|---|---|
| Supabase URL + anon/publishable key | Vercel, operator `.env`, mobile `.env` | Safe to expose; RLS is the real protection |
| **Service-role key** | Supabase Vault + edge functions only | **Never** in any client app or the repo — it bypasses all RLS |
| `table_token_secret` | Supabase Vault | HMAC secret for QR table tokens. **Rotating it kills every printed card in the venue** — it must be carried over unchanged if the project ever moves |
| `functions_base_url` | Supabase Vault | Lets the database call its own edge functions |
| **Google Web OAuth client secret** | Google Cloud console **only** | Created automatically alongside the Web client; **unused by the native id-token flow** — never in `eas.json`, `.env.example`, Supabase or the repo. The Chrome prompt reports it as `present (console only)` and nothing more |
| Google Web / iOS client ids | `eas.json` + `apps/mobile/.env` + Supabase Google provider | Public identifiers (short list #8–9), not secrets |

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
- [ ] Domain recovered/registered and DNS pointed (`touch-padel.com` — see
      `docs/client/domain-setup-2026-08-30.md`); `NEXT_PUBLIC_SITE_URL` + `VITE_GUEST_SITE_URL` set
- [x] Google Cloud project `Touch Padel` created (2026-09-01, `touch-padel`) — consent screen in **Testing**
- [ ] Test users added; Web + iOS clients created (Prompt A′); one Android client per SHA-1 (Prompt A′ / D)
- [ ] Consent screen published to **production** once the privacy + home pages exist on an authorized
      domain (Prompt D Task 2) — until then only listed test users can use Google sign-in
- [x] Supabase Apple + Google providers enabled with the exact Client-ID lists, "Skip nonce check" OFF
      (Prompt C, 2026-09-01)
- [ ] `host.exp.Exponent` removed from the Apple list, Site URL set, `localhost` + `exp://` redirect entries
      removed — release week (Prompt D Task 4)
- [ ] `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID` + `EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID` filled on all three
      `eas.json` profiles; §8 placeholder rows filled from the Chrome reports
- [ ] Edge functions deployed; Telegram webhook registered
- [ ] Engagement floor set to the go-live date
- [ ] Telegram test message received in the group
- [ ] Backups: **daily Supabase backups only — PITR declined by owner 2026-08-30** (SOW L258
      deviation; Mustafa's written acknowledgment requested in `docs/client/07-outstanding-2026-08-30.md`).
      Verify daily backups are ON for `lczijabnorujcgmbuqlw`; restore rehearsal in Week 6
