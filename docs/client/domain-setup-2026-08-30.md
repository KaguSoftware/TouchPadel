# Domain — touch-padel.com: findings and setup runbook

Client decision (pack 2026-08-30, `touch-padel.domain.name`): **`touch-padel.com`**, status
"help". This document is the whole path from here to printed QR cards.

## What we found (RDAP, checked 2026-08-30)

`touch-padel.com` is **already registered**:

| Fact | Value |
|---|---|
| Registrar | Hostinger operations, UAB |
| Created | 2025-08-03 |
| Expiry on record | 2027-08-03 |
| Status | `clientTransferProhibited` |
| Nameservers | `dns-expired.com` (registrar's expired-domain parking) |

Reading: registered 2025-08-03 — **a year before this project existed** — and the parking
nameservers plus the "help" answer strongly suggest **someone at Touch registered it and it
lapsed** around 2026-08-03 (the on-record expiry extends during a registrar's renewal-grace
period). If so this is a **renewal (~$15), not a purchase**, and `clientTransferProhibited` is
irrelevant — the domain never needs to move.

## Step 1 — one question to Mustafa (asked in doc 07)

**"Did you, or anyone at Touch, register touch-padel.com through Hostinger?"**

- **Yes** → go to Path A. We need the Hostinger account email (possibly
  `Mustafa.akeel.awad1@gmail.com`, the same account that holds the hosting).
- **No** → go to Path B.

## Path A — Touch owns it (expected): recover and renew

1. Mustafa logs into https://www.hostinger.com (password reset via the account email if needed).
2. Domains → `touch-padel.com` → **Renew**. If it has entered the redemption phase the fee is
   higher (~$80–100); still far cheaper than any alternative. Turn **auto-renew ON**.
3. Do not transfer it anywhere. Hostinger stays the registrar; only the DNS records change (below).

## Path B — a third party owns it

1. Watch the drop: if truly unrenewed, it passes redemption and deletes roughly 75–80 days after
   expiry (~mid-October 2026 — after go-live). Use a backorder service, or check weekly.
2. Meanwhile pick a fallback and buy it fresh (~$15/yr): `touchpadel.club`, `touch-padel.net`,
   `touchpadeliq.com` — Mustafa's call, per the brand rule (doc 06 §4).
3. `touchpadel.com.iq` (~$330/yr) remains the priced local fallback.

## Step 2 — point it at Vercel

In the Vercel dashboard, project `touch-padel-web` (account: see `API.md` §8):

1. Project → Settings → Domains → Add → `touch-padel.com`. Also add `www.touch-padel.com`
   (redirect to apex).
2. Vercel shows the records to create. In the registrar's DNS panel (Hostinger → DNS zone):
   - `A` record, host `@`, value `76.76.21.21`
   - `CNAME`, host `www`, value `cname.vercel-dns.com`
   (Use the exact values Vercel displays — they are authoritative if they differ.)
3. Wait for the domain to show **Valid Configuration**; certificates are automatic.

## Step 3 — tell the system its own address

Order matters — the QR cards must never be printed with a temporary URL:

1. **Vercel env**: set `NEXT_PUBLIC_SITE_URL = https://touch-padel.com` for all environments,
   then redeploy **without build cache** (`NEXT_PUBLIC_*` is inlined at build).
2. **Each operator station**: set `VITE_GUEST_SITE_URL = https://touch-padel.com`. Until this is
   set the QR page refuses to print (`op.qr.noSiteUrl` — by design).
3. **Table-token Vault parity** (HANDOFF gotcha): the table-token secret must hold the same value
   on Touch's Supabase project before any card is printed, or every printed QR dies at W5.
4. Verify: open `https://touch-padel.com/ar` on a phone — Arabic menu, SSR, no redirect loops —
   then print ONE test card and scan it before printing the batch.

---

## Claude-in-Chrome prompt (copy below the line)

Follows the conventions of `chrome-agent-prompt.md`: report-only where stated, no logins, 2FA or
payments by the agent — those always come back to a human.

---

You are checking domain and DNS state for a project called **Touch Padel**. Work in the browser,
in order. **Never buy, renew, or change anything. Report only.** If any site asks for a login,
2FA, or payment — stop, say exactly what is needed, and wait.

### Task 1 — registration status

1. Go to `https://lookup.icann.org/en/lookup` and search `touch-padel.com`.
2. Record: registrar, creation date, expiry date, status codes, nameservers.
3. Expected (from our 2026-08-30 check): registrar Hostinger, created 2025-08-03, nameservers
   `dns-expired.com`. Report any difference explicitly — especially a nameserver change or a new
   expiry date, either of which means the domain's situation moved.

### Task 2 — is it parked or dropping?

1. Open `http://touch-padel.com` in a new tab. Describe what loads (parking page, error, site).
2. On `https://www.expireddomains.net` (no login) search `touch-padel.com` and report whether it
   is listed as pending-delete or in auction. If the site requires an account, skip and say so.

### Task 3 — fallback availability (check only)

At `https://www.namecheap.com/domains/registration/results/?domain=` check availability and price
for: `touch-padel.net`, `touchpadel.club`, `touchpadeliq.com`. **Do not add to cart.**

### Final report

```
## STATUS
touch-padel.com — <registrar / expiry / nameservers / what loads>

## CHANGED SINCE 2026-08-30
- <differences from the expected values, or "none">

## FALLBACKS
<domain> — <available? price/yr>

## BLOCKED
- <anything you could not check and why>
```
