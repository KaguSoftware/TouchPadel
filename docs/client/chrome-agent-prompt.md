# Claude-in-Chrome prompt — provision Touch Padel credentials

Copy everything below the line into Claude in Chrome.

---

You are provisioning third-party API credentials for a project called **Touch Padel** (a padel club
in Iraq with a cafe ordering system). Work through the tasks below in order, in the browser.

## Ground rules

- **Never invent a value.** If you cannot retrieve a real key, say so and move on.
- If a site needs a login, 2FA code, phone confirmation, payment card, or email verification —
  **stop, tell me exactly what you need, and wait**. Do not guess credentials.
- Do not paste any key into any site other than the one it belongs to.
- Keep a running log. At the very end, output ONE final report in this exact shape:

  ```
  ## COLLECTED
  NAME = value        (one per line, real values, no placeholders)

  ## BLOCKED
  - <task> — <precisely what stopped you and what you need from me>

  ## DONE IN-BROWSER
  - <settings you changed directly, e.g. "enabled pg_net">
  ```

- Choose the **EU region** anywhere a region is offered.

---

## Task 1 — Groq API key

1. Go to https://console.groq.com/keys
2. Sign in (Google sign-in is fine — if it needs my input, ask).
3. Create a new API key named `touch-padel`.
4. Copy the `gsk_...` value immediately — it is shown only once. Record it as `GROQ_API_KEY`.

⚠️ This is **Groq** (console.groq.com, the inference company). It is **NOT** xAI's "Grok".
If you land on x.ai or grok.com, you are in the wrong place — go back.

## Task 2 — PostHog (two different keys, don't mix them up)

1. Go to https://eu.posthog.com — sign up or sign in. The project **must be in the EU region**;
   if the account already exists in the US region, stop and tell me.
2. Create (or open) a project named `touch-padel`.
3. **Project API key** — Settings → Project → Project API Key. Starts with `phc_`.
   Record as `NEXT_PUBLIC_POSTHOG_KEY`.
4. **Project id** — the number in the dashboard URL (`/project/12345/...`) or Settings → Project.
   Record as `POSTHOG_PROJECT_ID`.
5. **Personal API key** — Settings → Personal → Personal API Keys → "Create personal API key".
   Name it `touch-padel-dashboard`. Scopes: read access to **Query / Insights / Events** for this
   project (if only "All access" is offered, use that and note it in the report).
   Starts with `phx_`. Record as `POSTHOG_PERSONAL_API_KEY`.

## Task 3 — Telegram bot

Use https://web.telegram.org (I may already be logged in; if not, ask me for the login code).

1. Open a chat with **@BotFather**.
2. Send `/newbot`. Name: `Touch Cafe Orders`. Username: try `TouchCafeOrdersBot`, and if taken
   append digits until one is accepted. **Report the final username you used.**
3. Copy the token (`123456789:AA...`). Record as `TELEGRAM_BOT_TOKEN`.
4. Send BotFather `/setprivacy` → select the bot → **Disable** (so it can read group messages).
5. Create a new Telegram **group** named `Touch Cafe — Orders`, and add the bot you just created
   as a member.
6. Send any message in that group (e.g. `hello`).
7. Open this URL in a new tab, substituting the real token:
   `https://api.telegram.org/bot<TOKEN>/getUpdates`
   Find `message.chat.id`. It is a **negative** number for groups — keep the minus sign.
   Record as `TELEGRAM_CHAT_ID`.
   If the JSON shows an empty `result` array, send another message in the group and reload.

## Task 4 — Supabase

Project ref is `lczijabnorujcgmbuqlw`. Go to https://supabase.com/dashboard.

1. **Access token** — Account → Access Tokens → Generate new token, named `touch-padel-ci`.
   Copy it (shown once). Record as `SUPABASE_ACCESS_TOKEN`.
2. **Service-role key** — project → Settings → API Keys → reveal the `service_role` secret key.
   Record as `SUPABASE_SERVICE_ROLE_KEY`. Treat it like a password; do not paste it anywhere
   except where step 4 below says.
3. **Extensions** — Database → Extensions → search and **enable** `pg_net` and `pg_cron`.
   Report whether each was already on.
4. **Vault secrets** — SQL Editor → new query → run exactly this, substituting the service-role
   key from step 2:
   ```sql
   select vault.create_secret('<service-role-key>', 'service_role_key');
   select vault.create_secret('https://lczijabnorujcgmbuqlw.supabase.co/functions/v1', 'functions_base_url');
   ```
   Report success or the exact error text.
5. **Database password** — Settings → Database. The existing password is **not** readable.
   Do NOT reset it. Just report that I have to supply it.

## Task 5 — GitHub

Repository: the Touch Padel repo under my account on https://github.com.

1. **FIRST, before any secrets**: Settings → Environments → `staging` → enable
   **Required reviewers** and add me as a reviewer. If the `staging` environment does not exist,
   create it, then add the reviewer. **Do not proceed to step 2 until this is saved** — that
   environment applies migrations to the client's live database.
2. Settings → Secrets and variables → Actions → New repository secret, add:
   - `PROJECT_REF` = `lczijabnorujcgmbuqlw`
   - `SUPABASE_ACCESS_TOKEN` = the token from Task 4.1
   - `SUPABASE_DB_PASSWORD` — skip, I will add this one myself.

## Task 6 — Vercel

https://vercel.com — the project serving `touch-padel-web.vercel.app`.

1. Settings → Environment Variables. Add for **all** environments:
   - `NEXT_PUBLIC_POSTHOG_KEY` = the `phc_...` from Task 2
   - `NEXT_PUBLIC_POSTHOG_HOST` = `https://eu.i.posthog.com`
2. Do **not** trigger a redeploy — tell me instead, since it must be redeployed *without build cache*.

## Task 7 — Domain (check only)

Check availability of `touchpadel.iq` and `touchpadel.com` at a registrar. **Do not purchase
anything.** Just report availability and rough price. I will buy it myself.

---

When every task is attempted, output the final report described in "Ground rules". Include every
key verbatim — I will move them into secret storage from there and then clear this chat.
