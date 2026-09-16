# Phone OTP — the activation runbook ("activate otp")

Everything needed to switch phone sign-in on is already built and tested, dormant behind three switches
(design note: `docs/design/phone-otp-2026-09-05.md`). This page is the checklist that turns it on, in order.
Nothing before §C changes what guests see.

**Status:** dormant since 2026-09-05. Not activated. **A1 amended 2026-09-16: launch on OTPIQ, WhatsApp first with
SMS fallback** (`OTPIQ_PROVIDER=whatsapp-sms`, sent from OTPIQ's own WhatsApp account, no Meta setup; a number that
cannot receive WhatsApp gets the same code as an SMS instead, so no guest is left without one — this is the
"WhatsApp → SMS" channel, and both legs are OTPIQ's, not two vendors). *(Was 2026-09-15: WhatsApp only, no fallback,
numbers without WhatsApp using email — which stopped working the same day, when email sign-in was removed from the
app.)* Move to Meta's official WhatsApp Cloud API, under Touch's own name, once Touch's Meta setup (A3) is done —
**note that adapter has no SMS leg** (see §C "Moving to WhatsApp"). The WhatsApp adapter is already built and
tested; the move is one `secrets set` (§C "Moving to WhatsApp"). This supersedes both earlier calls (2026-09-12
"OTPIQ SMS only", 2026-09-13 "Meta only"). **A4 superseded 2026-09-15: phone + password is the only guest sign-up**
(one WhatsApp code confirms the number; later sign-ins use the password; Apple / Google stay). A2 and A3 run in parallel; A5, A6 still open.

**Hosted state checked 2026-09-15** (probe with the gate closed; nothing sent, no user created): Phone provider ON,
Send SMS hook ON and signature-verified, gate `enabled = false`, OTPIQ secrets set. **Found and fixed:** the hook
answered refusals with their own HTTP status, which GoTrue swallows into a generic 500 ("Unexpected status code
returned from hook: 403"); it now answers HTTP 200 with the reason in the body, the only shape GoTrue relays. **Not yet
done:** the store-review test number (§C step 7) is NOT configured on hosted, since GoTrue sent it to the hook.
Development build profile and local `.env` now have `EXPO_PUBLIC_PHONE_OTP=on`; production stays off. **Gate opened
the same day:** `enabled = true`, every country (`allowed_prefixes = '{""}'`), 5 per number and 500 per day.

---

## A. Owner side — decide and contract (blocks everything below)

| # | Decision / item | Notes |
|---|---|---|
| A1 | **Provider and channel (D4a)** | **Amended 2026-09-16. Now: OTPIQ, WhatsApp → SMS** (`SMS_PROVIDER=otpiq`, `OTPIQ_PROVIDER=whatsapp-sms`; OTPIQ tries its verified WhatsApp account first and falls back to SMS on the same send when the number cannot receive WhatsApp — one vendor, one API call, one charge per delivered message at that channel's rate). No Meta setup; Touch's OTPIQ account, cost on Touch's invoice. **A number without WhatsApp now gets a code**, which matters since email sign-in is gone (A4). **Next: Meta WhatsApp Cloud API directly** (`SMS_PROVIDER=whatsapp`; Touch's WABA, Meta bills per authentication message) once A3 is done — **Meta has no SMS leg**, so that move trades the fallback away unless a WhatsApp-then-OTPIQ chain is built in the seam first (~30 lines, not built). Twilio stays as a dormant adapter. |
| A2 | **Alphanumeric sender id (the SMS leg only — WhatsApp ignores it; it now matters again, since `whatsapp-sms` does send SMS)** | Request "TouchPadel" in the OTPIQ dashboard: needs an Iraqi company licence plus proof the brand belongs to the company. Approval 1–3 days Asiacell, 1–3 weeks Zain/Korek. **Leave `OTPIQ_SENDER_ID` unset until approved** — an unapproved id fails every send ("SenderID not found"), WhatsApp ones included; without one the fallback SMS arrives from a generic number, which is fine but unbranded. |
| A3 | **Meta setup (for the move to WhatsApp; not needed to launch)** | In Meta Business Suite / WhatsApp Manager: (1) **Business verification** of Touch's legal entity (company registration documents; one to two weeks). (2) A **phone number dedicated to WhatsApp Business** — it must not be on a personal WhatsApp; it becomes the sender. (3) The WhatsApp Business Account (WABA) with that number, display name "Touch Padel" approved. (4) An **AUTHENTICATION template** named `touch_otp`, created in **both** `en` and `ar`, copy-code button, "do not share" line on, expiry line 5 min; note the exact language codes Meta shows. (5) A **System User** with the `whatsapp_business_messaging` permission and a **permanent access token**; a payment method on the WABA. Hand over: the token, the Phone Number ID (not the number), the template name and language codes — via `secrets set` on the owner's machine. |
| A4 | **Scope (D4b)** | **Superseded 2026-09-15: phone + password is the only guest sign-up.** Create account asks for first name, surname, phone, password and language, and one WhatsApp code confirms the number. Sign in is phone + password with no code. Forgot password sends a code and then sets a new password. Email sign-up and sign-in are gone from the app; Apple / Google stay above the form. `EXPO_PUBLIC_PHONE_OTP` now gates only linking a number to a social account. *(Was 2026-09-12: a green "Continue with phone" code-only CTA above email.)* |
| A5 | **Desk-account claim (D4c)** | Yes = run §D. No = staff correct numbers first; desk-created walk-ins keep signing in by "forgot password" (real email) only. |
| A6 | **Countries (D4d)** | **Decided 2026-09-15: every country.** Hosted `allowed_prefixes = '{""}'` (an empty prefix matches every number); the app's phone field has a picker for every country with a dial code, Iraq first. The per-number (5/day) and project (500/day) caps and OTPIQ's spending threshold are what stand between a bot and the bill now. Fresh or local stacks still default to `{964}` from migration 0069. |
| A7 | **Hand over the vendor API key** | Never in chat or a shared document — see `API.md` "How to hand these over". |
| A8 | **Written record** | Decisions D4a–D4d recorded alongside D1–D3 (the social sign-in decisions); it is a vendor addition outside the SOW, like social sign-in. |

## B. Pre-activation audit (us, read-only, 10 minutes)

Run in the hosted SQL editor:

```sql
-- 1. Canonical-phone duplicates across profiles (there is no unique index).
select app.phone_canon(phone) as canon, count(*), array_agg(id)
  from profiles where phone is not null
 group by 1 having count(*) > 1;

-- 2. Profile phones that are NOT an Iraqi mobile (informational since D4d opened every country; §D still needs Iraqi mobiles).
select id, full_name, phone from profiles
 where phone is not null and app.phone_canon(phone) !~ '^7\d{9}$';

-- 3. How many desk-created walk-ins exist (candidates for §D).
select count(*) from auth.users where email like '%@guest.touch.local';
```

Duplicates are informational (two accounts may legitimately share a household phone); non-mobile numbers are
worth a desk correction before §D.

## C. Activation (us, in this order)

1. **Secrets** (hosted):
   ```bash
   pnpm exec supabase secrets set SEND_SMS_HOOK_SECRET='v1,whsec_…'   # generated in step 4, paste here
   pnpm exec supabase secrets set SMS_PROVIDER=otpiq OTPIQ_API_KEY=… OTPIQ_PROVIDER=whatsapp-sms
   # whatsapp-sms = WhatsApp first, SMS when the number cannot receive it (the launch routing, 2026-09-16).
   # alternatives: OTPIQ_PROVIDER=whatsapp (WhatsApp only, no code for numbers without it) | =sms (SMS only)
   # OTPIQ_SENDER_ID=TouchPadel only AFTER OTPIQ approves it (A2); WhatsApp secrets: see "Moving to WhatsApp" below
   ```
2. **Migration 0069** is applied by the normal CI migrate (`.github/workflows/db-migrate.yml`); confirm
   `select enabled from app.sms_limits;` returns `false`.
3. **Deploy the hook:** `pnpm exec supabase functions deploy send-sms-otp` (`verify_jwt = false` comes from
   `config.toml`). Then `pnpm --filter @touch/db db:types` once against a stack with 0069 and commit `types.gen.ts`.
4. **Dashboard → Authentication → Hooks → Send SMS:** enable, type HTTPS, URL
   `https://<project-ref>.supabase.co/functions/v1/send-sms-otp`, generate the secret, copy it into step 1.
5. **Dashboard → Authentication → Providers → Phone:** enable. Leave the built-in SMS provider fields empty (the
   hook replaces them). Confirm "Confirm phone" on.
6. **Dashboard → Authentication → Rate limits / Settings:** SMS sent per hour (start at 30–60), OTP expiry ≤ 5 min,
   OTP length 6, minimum interval between resends 60 s.
7. **Store-review number:** Dashboard → Phone provider → Test OTPs: add the reviewer's demo number and a fixed code
   (App Store / Play reviewers cannot receive Iraqi SMS). `9647700000001 = 123456` matches local dev.
8. **OTPIQ — one live send** before opening the gate. The adapter (`functions/_shared/sms/otpiq.ts`) matches the
   vendor's published API reference (read 2026-09-12) and is pinned by `packages/db/tests/sms-provider.test.ts`, but the
   account itself has not been exercised. Send one code to a staff phone with `enabled = true` for that phone's window,
   read `app.sms_sends`. In `error`: `misconfigured: missing OTPIQ_API_KEY` = the secret is not set; `otpiq 400` with
   "trial mode" = the account has no credit yet and only delivers to the owner's own number; "SenderID not found / not
   accepted" = `OTPIQ_SENDER_ID` is set before approval (unset it); `otpiq 401` = wrong key. The function log prints the
   remaining credit after every successful send. **The log's `channel` always reads `whatsapp` on `whatsapp-sms`** —
   OTPIQ picks the real channel after it answers us, and only its `trackSms` endpoint (which we do not call) knows which
   one delivered, so read per-message truth in the OTPIQ dashboard, not in `app.sms_sends`. Test once with a number that
   has WhatsApp (code arrives from OTPIQ's WhatsApp account) and once with one that does NOT — the point of the
   fallback: a code must still arrive, as an SMS, from a generic number until A2 approves the sender id. Note each
   leg's charge in the dashboard; SMS costs more than WhatsApp.
9. **Open the gate:**
   ```sql
   update app.sms_limits
      set enabled = true,
          allowed_prefixes = '{""}',       -- D4d: every country (2026-09-15); '{964}' for Iraq only
          per_phone_per_day = 5,
          daily_total = 500,               -- raise once real volume is known
          updated_at = now();
   ```
10. **Desk-claim backfill** — only if A5 = yes: §D.
11. **Mobile flag:** set `"EXPO_PUBLIC_PHONE_OTP": "on"` in the relevant `apps/mobile/eas.json` profile
    (development first, production last) and build. Nothing else in the app changes.
12. **Smoke test** on one Zain, one Asiacell and one Korek number: sign up by phone → name step → book (passes
    `PHONE_REQUIRED`); sign out and back in; an email user verifies their phone from Profile; wrong code; resend after
    the cooldown. Both languages.
13. **Watch for a day:**
    ```sql
    select status, reason, channel, count(*), sum(cost_iqd)
      from app.sms_sends where created_at > now() - interval '24 hours'
     group by 1,2,3 order by 4 desc;
    ```
    Anything `refused` with `PHONE_NOT_ALLOWED` in volume is pumping being stopped; `failed` in volume is the vendor.
14. **Paper:** update `docs/security/security-general.md` D5 (SEC-22) with the written decision; add the day to
    `HANDOFF.md`.

### Moving to WhatsApp (Meta Cloud API) — when A3 is done

No code and no deploy. OTPIQ keeps sending until the last command.

1. **Stage the WhatsApp secrets** alongside the OTPIQ ones. Nothing reads them while `SMS_PROVIDER=otpiq`:
   ```bash
   pnpm exec supabase secrets set WHATSAPP_ACCESS_TOKEN=… WHATSAPP_PHONE_NUMBER_ID=… WHATSAPP_TEMPLATE_NAME=touch_otp \
     WHATSAPP_TEMPLATE_LANG_EN=en WHATSAPP_TEMPLATE_LANG_AR=ar WHATSAPP_DEFAULT_LANG=ar
   ```
   The two language codes must equal what WhatsApp Manager shows for the approved template (`en` or `en_US`).
2. **Switch:** `pnpm exec supabase secrets set SMS_PROVIDER=whatsapp`
3. **Check the first sends** in `app.sms_sends` (provider `whatsapp`, channel `whatsapp`), in BOTH languages: switch a
   staff profile's `preferred_lang` between two sends. In `error`: `misconfigured: missing …` = a staged secret is
   absent; `(190)` = token expired or invalid; `(132001)` = template not approved in that language; `(131026)` = that
   number has no WhatsApp; `(130429)` / `(131056)` = pace.
4. **Back out** at any moment: `pnpm exec supabase secrets set SMS_PROVIDER=otpiq` (the OTPIQ secrets are still there).
5. **After a quiet week:** `pnpm exec supabase secrets unset OTPIQ_API_KEY OTPIQ_PROVIDER OTPIQ_SENDER_ID`, and rotate
   the key in the OTPIQ dashboard if the account is closed. Until then OTPIQ is the rollback.

**What changes for guests — and what this move COSTS.** The code arrives on WhatsApp from "Touch Padel" instead of
from OTPIQ, in their app language, with a copy-code button. But **the SMS fallback disappears**: Meta's adapter has no
SMS leg, so a number without WhatsApp fails with `(131026)` and — since email sign-in was removed from the app — that
guest cannot get in at all. Do not make this move blind: read the share of `whatsapp-sms` sends that fell back to SMS
in the OTPIQ dashboard first. If it is more than a rounding error, either stay on OTPIQ or have the
WhatsApp-then-OTPIQ chain built in the seam beforehand (about thirty lines, not built: Meta first, OTPIQ `sms` on a
131026), so the guest-facing behaviour stays the "WhatsApp → SMS" one.

A typo is safe: a misspelled `SMS_PROVIDER`, or a vendor named without its secrets, fails every send with the reason in
`app.sms_sends.error` and the function log. It never falls back to silently sending nothing.

### Swapping the vendor (two minutes, no code)

Every edge function texts through ONE function, `sendSms()` in `functions/_shared/sms/index.ts`; no other file knows a
vendor's hostname or secret names (a test fails if one does). So:

- **To an adapter that already exists** (`log`, `twilio`, `otpiq`, `whatsapp`): `pnpm exec supabase secrets set SMS_PROVIDER=<name>`
  plus that vendor's keys. The hook reads the secrets on every send; nothing to deploy.
- **To a new vendor:** one file `functions/_shared/sms/<vendor>.ts` implementing `SmsProvider` (`send({to, body, code})`,
  throw `SmsProviderError` on any non-2xx), one branch in `smsFromEnv` (`index.ts`), its secret names in
  `functions/.env.example`, and a block in `tests/sms-provider.test.ts` mirroring the OTPIQ one. Then
  `supabase functions deploy send-sms-otp` and the secrets command above.
- **What does not change with the vendor:** the gate, the caps, the send log, the app copy. **What does:** the message
  wording and the channel. Twilio sends our bilingual template verbatim; OTPIQ's verification type wraps the code in the
  vendor's own template; Meta sends the approved authentication template in the guest's language. The app never sees the
  difference — except for the fallback: OTPIQ `whatsapp-sms` retries a non-WhatsApp number over SMS itself, while the
  Meta adapter has no SMS leg and simply fails that number.
- **A misconfigured provider fails loudly** (`misconfigured: …` in the send log), so the swap cannot silently stop codes.

### Rollback (any time, in reverse, each step independent)

- Flag `off` in `eas.json` and rebuild (guests stop seeing the buttons; existing phone sessions keep working).
- `update app.sms_limits set enabled = false;` (no SMS is billed from this second; sign-in by code fails with
  "not available right now").
- Disable the Phone provider in the dashboard (GoTrue refuses the endpoint itself).

## D. Desk-account claim backfill (only with owner decision D4c = yes)

Sets an UNCONFIRMED `auth.users.phone` on desk-created walk-ins so their first OTP sign-in lands on the account the
desk made — the "future phone-based claim flow" promised in `desk-customer-create/index.ts`. Guarded three ways:
synthetic email only, Iraqi mobile only, canonical phone unique across profiles AND absent from `auth.users`.
Run on staging first and confirm one claimed sign-in works before running on production.

```sql
begin;
with candidates as (
  select u.id, '964' || app.phone_canon(p.phone) as gotrue_phone
    from auth.users u
    join profiles p on p.id = u.id
   where u.email like '%@guest.touch.local'
     and u.phone is null
     and app.phone_canon(p.phone) ~ '^7\d{9}$'
     and not exists (select 1 from profiles q
                      where q.id <> p.id and app.phone_canon(q.phone) = app.phone_canon(p.phone))
     and not exists (select 1 from auth.users v
                      where v.phone = '964' || app.phone_canon(p.phone))
)
update auth.users u
   set phone = c.gotrue_phone, updated_at = now()
  from candidates c
 where u.id = c.id;
-- inspect the count, then:
commit;  -- or rollback;
```

Known residual risk (accepted by D4c): a staff typo puts number B on account A; B's owner then claims A's booking
history. The uniqueness guards remove the collision cases but not the typo case.

## E. Local development (no vendor needed)

- `EXPO_PUBLIC_PHONE_OTP=on` in `apps/mobile/.env`; number `0770 000 0001`, code `123456`.
- To exercise the real hook locally: `[auth.hook.send_sms] enabled = true` in `config.toml`, `supabase stop && supabase start`,
  `supabase functions serve --env-file supabase/functions/.env` with `SMS_PROVIDER=log` and the committed local
  `SEND_SMS_HOOK_SECRET`; `update app.sms_limits set enabled = true;`; sign in with any Iraqi number — the code is
  printed in the functions log and a row lands in `app.sms_sends`.
- Tests: `pnpm --filter @touch/core test`, `pnpm --filter @touch/mobile test`, `pnpm --filter @touch/db test`
  (`tests/phone-otp.test.ts` runs its stack block only when `supabase start` is up).
