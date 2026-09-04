# Security Layer 1 — standing rules, decisions and residual risk

**Version** 1.0 · **Date** 2026-09-04 · **Owner** DEV
**Parent** `docs/security/security-layer-1.md`

The boxes in Layer 1 that are *rules* rather than code. A rule that lives only in
a person's head is not a control, so each one below says what it forbids, why,
and — where possible — which automated gate enforces it.

---

## 1 · Production rows are read through a masked, audited function — never the SQL Editor

**The rule.** Nobody queries the hosted database's guest or staff rows through the
Supabase dashboard SQL Editor. Inspection goes through a `security definer`
function that masks personal columns and writes an `audit_log` row naming the
caller.

**Why.** The SQL Editor runs as a superuser-equivalent role. It bypasses every RLS
policy in the project, it is not rate-limited, it leaves **no audit trail of what
was selected**, and a `select *` on `profiles` puts every guest's phone number on
a laptop screen — and in that browser's history and memory. The whole
authorization model this project spent 55 migrations building is simply not in
the path.

It is also how schema drift happens: an edit made there exists in no migration,
fails no review, and is invisible until `db diff` catches it (which the nightly
`db-drift.yml` job now does).

**What is allowed.**
- Reading through a masked definer function that audits the access.
- `supabase db diff`, `migration list`, and other read-only *schema* commands.
- Anything at all on a local stack, which holds no real data.

**What is forbidden.**
- `select` against `profiles`, `reservations`, `payments`, `guest_sessions`,
  `audit_log` or `staff` in the dashboard SQL Editor.
- Any `insert` / `update` / `delete` / DDL there, in any table, ever — that is
  what migrations are for.

**Enforcement.** Partly automatic: `db-drift.yml` fails nightly if the live schema
stops matching the migrations, which catches DDL. Reads cannot be caught after
the fact, which is exactly why access is limited instead — see §2.

---

## 2 · Who may reach the hosted project

With one Supabase project (see D1, §5), **access control is the environment
separation.** There is no staging to make mistakes in.

| Role | Supabase | SQL Editor on the hosted project |
|---|---|---|
| SEC, DEV | Owner / Admin | Emergency only, announced, with a reason recorded |
| FE1, FE2 | Developer | **No** |

**Enforcement.** Supabase dashboard — a person must set this, and it leaves no
artifact in the repository. It belongs on the freeze checklist and must be
re-verified by looking, never taken from prose.

---

## 3 · The `client-data/` intake rule

**The rule.** Intake packs in `packages/db/client-data/` are committed verbatim as
the contractual record of what the client supplied. **No pack containing guest or
staff personal data may ever be committed.**

**Why.** These files are the evidence of what was asked and answered, so they are
deliberately not edited — which means anything that lands in one is permanent, in
every clone and every fork, and cannot be redacted afterwards in any meaningful
sense.

**Enforcement.** `scripts/security/check-data-hygiene.mjs`, in CI. It fails on an
email address, a 12-digit national-ID-shaped number, or a real-format Iraqi mobile
in any committed pack, fixture or seed.

**Known and accepted (2026-09-04).** `touch-padel.hosting.email` in both packs is
the client's own hosting-account contact — a business contact, not guest or staff
data. It is already in commits `634462a` and `e4f2acc`, so redaction would remove
nothing. Grandfathered explicitly in the gate; **raise it with the client** so the
acceptance is theirs, not ours.

---

## 4 · Test phone numbers

Iraq has no ITU documentation range, so this repository defines one:

```
+964 7XX 000000N        six zeros, then one or two free digits
```

Obviously synthetic to a human, correctly shaped for anything that validates the
format, and not dialable to a stranger. Fixtures get loaded into whatever database
is to hand — and with one project, that is the venue's live one, from which a
plausible number becomes a row in `profiles`, then a backup, then an SMS.

**Enforcement.** `check-data-hygiene.mjs`.

---

## 5 · Residual risk: one Supabase project · **REQUIRES CLIENT SIGNATURE**

> The signed SOW (Module 1, INCLUDED) promises "staging and production
> environments". There is **one** Supabase project, and it is the client's live
> database. `db-migrate.yml` names its job `staging` while its own comment states
> the linked project is "the CLIENT'S long-term production database".

**The residual risk, stated plainly.** Every migration reaches real guest data with
no rehearsal. If one is wrong, the venue may be unable to trade until it is fixed,
and there is no second environment in which the mistake could have surfaced first.

**What has been done to reduce it** — none of which removes it:

| Control | What it catches | What it cannot catch |
|---|---|---|
| `check:migrations` | lock-taking and destructive DDL in changed migrations | a logically wrong but structurally safe migration |
| `lock_timeout = '3s'` preamble | a migration freezing the till behind a lock | data already written incorrectly |
| `timeout-minutes: 15` on `db-migrate` | a hung push holding the database | the same |
| Ledger snapshot artifact | gives a "before" for `audit_log` / `stock_ledger` / `payments` | it is evidence, not a restore path |
| `staging` environment required reviewers | an unreviewed push | a reviewer approving a bad migration |
| Nightly `db-drift.yml` | the hosted DB silently falling behind or being edited by hand | anything within a 24-hour window |

**The only thing that removes it is a second project.** That is D1, and it is a
contract question: either build staging as the SOW says, or obtain a signed
variation recording that the client accepts this risk.

**Sign-off**

```
I understand that with a single Supabase project, a defective database migration
reaches live guest and booking data with no rehearsal environment, and that the
venue may be unable to trade until it is corrected.

Client ______________________  Date __________
Kagu   ______________________  Date __________
```

---

## 6 · Bringing the hosted project to the migration head

**Status: NOT DONE. It needs a named person, not a script.**

The write itself is routine. The context is not: it lands on the client's live
database, over real guest data, with no staging rehearsal. This has already gone
wrong once — `db-migrate.yml` skipped silently from day one for want of secrets
and the hosted database drifted **eight migrations behind** before anyone noticed
(`HANDOFF.md:544-545`).

Before it runs, three things must be true:

1. **A named person accepts the risk** that the venue may not trade if it goes
   wrong. Not a role — a name and a date.
2. **A time outside service** is chosen.
3. **§5 is signed**, or D1 is resolved by building staging.

The procedure is now the `db-migrate.yml` job itself: it prints the pending list,
prints the schema diff into the job summary for the approving reviewer, snapshots
the ledgers as a retained artifact, and is bounded by `timeout-minutes: 15`. Every
new migration carries `lock_timeout = '3s'` and `statement_timeout = '60s'`,
enforced by `check:migrations`.

**Until it is at head, every green gate in CI is a claim about a database the
venue does not use.**

---

## 7 · Technical decisions taken 2026-09-04

| Decision | Chosen | Why |
|---|---|---|
| Table token in the URL | **Exchange for an HttpOnly cookie** | The token is the table's bearer credential. In the URL it went to every third party in `Referer`, into analytics as `$current_url`, and into browser history. Printed QR cards are unaffected. |
| PostHog on the guest app | **Keep + full mitigation**, variation still required | Removing a shipped feature is a product decision, not a security one. Tokens are now scrubbed from every captured property. **SOW Module 6 still excludes analytics — the signed variation is outstanding.** |
| `pin_cache` on the venue PC | **Encrypt the salt with `safeStorage`** | A PIN is 4–6 digits; with the salt, the whole keyspace falls in seconds. DPAPI binds it to the Windows account, so a copied `queue.db` is inert. Fails closed if encryption is unavailable. |

### Known residual — the table token in the RSC payload

The cookie removes the token from the URL. It does **not** remove it from the
page: `useTableSession` runs in the browser and needs the token to call
`app.open_table_session`, so it is serialised into the RSC payload and appears
once in the HTML. Verified, not assumed.

- **Fixed:** `Referer` leakage, analytics capture, browser history, screenshots,
  shared links.
- **Not fixed:** an XSS in the guest app could still read it.

Closing that means never sending the token to the client — a route handler would
read the cookie server-side and call the RPC as the guest, whose Supabase session
is already in cookies. That is a real refactor of the guest ordering boot and is
**not** done here.

---

## 8 · What only a human with account access can do

None of these can be written into the repository. Each needs somebody signed in.

| Item | Where | Note |
|---|---|---|
| MFA org-wide | GitHub, Supabase, Vercel, PostHog, Expo, Apple, Google, registrar | Recovery codes to the **client's** owner, never a Kagu inbox |
| Branch protection on `main` | GitHub → Rules | No direct pushes, 1 approving review, CI green |
| "Require review from Code Owners" | GitHub → Rules | **`.github/CODEOWNERS` is inert without this** |
| The `@KaguSoftware/tech-leads` team | GitHub → Teams | CODEOWNERS silently ignores an owner it cannot resolve |
| Required reviewers on `staging` | GitHub → Environments | No repo artifact; verify by looking, add to the freeze pass |
| Supabase member roles | Supabase → Organization | §2 above |
| CAPTCHA on | Supabase → Auth → Attack Protection | ⚠ Do **not** disable anonymous sign-in — it is the cafe's guest identity |
| Auth redirect allowlist | Supabase → Auth → URL Configuration | Exact production URLs. No wildcards, no `localhost`, no `exp://*` |
| Leaked-password protection; JWT 30 min + refresh rotation | Supabase → Auth | |
| `site_url` off `http://localhost:3000` | Supabase → Auth | `config.toml:53` is the local value; the hosted one is separate |
| Vercel preview protection | Vercel → Deployment Protection | Every preview points at the one live database |
| Security Advisor run + waiver | Supabase → Advisors | Expect `extension_in_public` (fixed by migration 0069) and `security_definer_view` ×4 (accepted — the four audited projections) |
| Domain + registrar lock | Registrar | Blocks HSTS preload, universal links, the privacy URL and printed QR cards |
| OV/EV code-signing certificate | A CA | Days of lead time. Key in a cloud HSM, not a laptop |
| Android signing SHA-256 | Play Console → App integrity | Fill `ANDROID_SHA256_FINGERPRINTS`; empty fails closed today |
| Apple Team ID | Apple Developer | Fill `APPLE_TEAM_ID`; `TEAMID-UNSET` fails closed today |
| PITR on the Supabase tier | Supabase → Billing | SOW promises it; if the tier lacks it that is a contract gap |
| Account ownership at handover | All of the above | Longest-lead item in the project |

---

*Kagu Web Studio · Touch Padel Phase 1 · 2026-09-04*
