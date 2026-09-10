# Phone OTP — the activation runbook ("activate otp")

Everything needed to switch phone sign-in on is already built and tested, dormant behind three switches
(design note: `docs/design/phone-otp-2026-09-05.md`). This page is the checklist that turns it on, in order.
Nothing before §C changes what guests see.

**Status:** dormant since 2026-09-05. Not activated.

---

## A. Owner side — decide and contract (blocks everything below)

| # | Decision / item | Notes |
|---|---|---|
| A1 | **Provider and channel (D4a)** | Recommended: an Iraqi aggregator with WhatsApp-first + SMS fallback (direct Zain / Asiacell / Korek routes; e.g. OTPIQ). Alternative: Twilio. Whatever is chosen, the account is Touch's and the per-message cost is on Touch's invoice. |
| A2 | **Alphanumeric sender id** | Register "TouchPadel" (or the brand's chosen sender). Asiacell requires pre-registration; Zain and Korek drop numeric senders. Without it delivery is best-effort. |
| A3 | **WhatsApp channel** (if chosen) | Meta business verification on the vendor's platform: allow one to two weeks. |
| A4 | **Scope (D4b)** | Extra method beside email + social (recommended first), or the default button. |
| A5 | **Desk-account claim (D4c)** | Yes = run §D. No = staff correct numbers first; desk-created walk-ins keep signing in by "forgot password" (real email) only. |
| A6 | **Iraq-only (D4d)** | Keep `{964}` (recommended) or list the extra country codes. |
| A7 | **Hand over the vendor API key** | Never in chat or a shared document — see `API.md` "How to hand these over". |
| A8 | **Written record** | Decisions D4a–D4d recorded alongside D1–D3 (the social sign-in decisions); it is a vendor addition outside the SOW, like social sign-in. |

## B. Pre-activation audit (us, read-only, 10 minutes)

Run in the hosted SQL editor:

```sql
-- 1. Canonical-phone duplicates across profiles (there is no unique index).
select app.phone_canon(phone) as canon, count(*), array_agg(id)
  from profiles where phone is not null
 group by 1 having count(*) > 1;

-- 2. Profile phones that are NOT an Iraqi mobile (would fail the strict mobile gate).
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
   pnpm exec supabase secrets set SMS_PROVIDER=otpiq OTPIQ_API_KEY=… OTPIQ_PROVIDER=whatsapp-sms OTPIQ_SENDER_ID=TouchPadel
   # or: SMS_PROVIDER=twilio TWILIO_ACCOUNT_SID=… TWILIO_AUTH_TOKEN=… TWILIO_FROM=TouchPadel
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
8. **OTPIQ only — verify the request shape** once against the live account before enabling the gate: the adapter
   was written from the vendor's public client libraries (`providers/otpiq.ts` header). Send one code to a staff
   phone with `SMS_PROVIDER=otpiq` and `enabled = true` for that phone's window, read `app.sms_sends`.
9. **Open the gate:**
   ```sql
   update app.sms_limits
      set enabled = true,
          allowed_prefixes = '{964}',      -- D4d
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
