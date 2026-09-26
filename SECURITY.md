# Security Policy

Touch Padel is the venue system for a padel-and-cafe site in Iraq: a guest booking app, a
public website with QR cafe ordering, and a Windows operator app, all on one Supabase
Postgres. It handles real bookings, real payments in IQD, and real guests' phone numbers.

This repository is public. The database it talks to is not, and it is **live**. Please read
the testing rules in §4 before you touch anything.

---

## 1 · Reporting a vulnerability

**Report privately, through GitHub:**

> **[Security → Advisories → Report a vulnerability](https://github.com/KaguSoftware/TouchPadel/security/advisories/new)**

That opens a private advisory visible only to you and the maintainers. Nothing is published
until there is a fix.

**Do not open a public issue for a security problem.** A public report is a disclosure: it
reaches whoever is watching this repository at the same moment it reaches us, and the venue
cannot patch a live till and a released desktop installer in the minutes that gives us.
Public issues are the right place for ordinary bugs, questions, and anything that is not a
security weakness — use them freely for that.

If GitHub is unavailable to you, open a public issue that says only *"I have a security
report, please open a private channel"* — with no details, no repro, no affected path — and
a maintainer will come to you.

A good report contains:

| Field | What to include |
|---|---|
| Where | The surface (web / mobile / operator SPA / operator shell / database) and, if you can, the file or endpoint |
| What | What an attacker gets: read another guest's data, book without paying, change a price, run code on the venue PC |
| How | Minimal steps to reproduce, ideally against a local stack (§4) |
| Version | Commit SHA, or the operator app version shown on the station setup screen |
| Impact | Your own read of severity, and whether it needs auth, staff access, or physical presence in the venue |

Reports written in Arabic or English are equally welcome.

---

## 2 · What happens next

| Stage | Target |
|---|---|
| We acknowledge your report | 3 working days |
| We tell you our severity assessment and rough plan | 10 working days |
| Critical fix shipped (guest data exposure, payment or auth bypass, RCE on the venue PC) | As fast as we can, measured in days |
| Everything else | With the normal release flow |

This is a small team on a delivery deadline, not a 24/7 security desk. If a target slips we
will tell you rather than go quiet.

---

## 3 · Disclosure

We work to coordinated disclosure. Please give us **90 days** from your report before making
it public, or until a fix ships — whichever comes first. If we need longer we will ask, with
a reason. If we go silent past 90 days, publish; that is your right and we will not treat it
as a hostile act.

When the fix ships we publish a GitHub Security Advisory and credit you by the name or handle
you choose, unless you prefer to stay anonymous. There is no bug bounty — this is a client
project, not a funded programme, so what we can offer is credit and a straight answer.

---

## 4 · Testing rules — read before you probe anything

**There is one Supabase project and it is the client's production database. There is no
staging.** Every table you might poke at holds real reservations and real guests' phone
numbers, and the venue trades on it during opening hours.

**Do not**, against any live Touch Padel deployment:

- run automated scanners, fuzzers, or dependency-confusion probes
- attempt any denial of service, load test, or rate-limit exhaustion
- create real bookings or cafe orders you do not intend to honour
- test with real people's phone numbers or email addresses
- attempt to access, download, or retain any guest or staff record
- attempt social engineering of venue staff, or any physical access to the operator PC

**Do instead** — the whole system runs locally, with fixtures and no real data:

```sh
pnpm i
pnpm db:start        # local Supabase via Docker
pnpm db:reset        # migrations + seed fixtures
pnpm dev
```

Fixtures use this repository's synthetic phone range, `+964 7XX 000000N` — please stay inside
it. `CONTRIBUTING.md` has the full setup, including Windows.

**If you incidentally reach real guest or staff data:** stop immediately, do not save or copy
it, do not share it, and say so in your report. Telling us is not an admission of anything —
it lets us assess whether the venue owes anyone a notification.

**Safe harbour.** If you follow this policy in good faith, we will treat your work as
authorised research, we will not pursue legal action, and we will not report you. If you are
unsure whether something is in bounds, ask first in a private advisory.

---

## 5 · Scope

In scope:

| Surface | Notes |
|---|---|
| `apps/web` | Public site and the QR cafe ordering flow — no login, the least-defended surface by design |
| `apps/mobile` | Guest booking app (React Native / Expo) |
| `apps/operator` | Operator SPA: till, calendar, KDS, stock, admin |
| `apps/operator-shell` | Electron shell: offline queue, LAN KDS, ESC/POS printing, auto-update |
| `packages/db` | Migrations, RLS policies, RPCs, and the authorization matrix |
| `packages/core` | Money, splits, idempotency, time — arithmetic bugs here are security bugs |
| CI and release | Workflow injection, secret exposure, unsigned or hijackable artifacts |

Weaknesses we especially want to hear about: anything that reads another guest's rows,
anything that books or pays without the money being right, anything that escalates a guest
session to staff, and anything that gets code onto the venue PC through the auto-updater.

Out of scope:

- Findings from an automated scanner with no demonstrated impact.
- Missing headers or best-practice flags on surfaces that hold nothing. Report them as issues;
  they are welcome, just not advisories.
- Vulnerabilities in Supabase, Vercel, Expo or GitHub themselves — report those to their vendors.
- Anything requiring an already-compromised operator PC, a rooted device, or a stolen staff
  credential.
- Social engineering, phishing of staff, physical attacks on the venue.
- The known, dated dependency waivers in `.security/audit-waivers.json` and the four accepted
  Supabase advisor findings in `docs/security/security-advisor-waiver-2026-09-06.md` — these are
  decisions with owners and expiry dates, not oversights. A *new* reachability argument against
  one of them is very much in scope.

---

## 6 · Supported versions

The project is pre-1.0 and under active development. Only the current line gets fixes.

| Surface | Supported |
|---|---|
| Operator desktop — latest `operator-v*` release | Yes. Fixes ship here; installed copies auto-update from the public releases repo |
| Operator desktop — any older release | No. Update to the latest |
| Web — the deployed head of `main` | Yes, continuously deployed |
| Mobile — the latest store build / EAS update | Yes |
| Forks, and any branch other than `main` | No |

---

## 7 · If you found a leaked credential

Treat it as urgent and report it privately, even if it looks expired or scoped to a test
project. Do not use it to confirm it works — tell us where you saw it (file, commit, built
artifact, log) and let us rotate it.

Every push and pull request runs `gitleaks` over the **full history**, plus a gate that fails
if a secret-bearing file was ever committed, plus a scan of the built web, desktop and mobile
artifacts. A credential that got past all of that is exactly the report we want.

---

## 8 · What is already automated

So you know what ground is covered before you spend time on it. Every one of these runs on
every pull request and every push to `main` (`.github/workflows/ci.yml`, or `pnpm security`
locally):

- `gitleaks` across full git history, plus a secret scan of the built web, desktop and mobile bundles.
- Public env-var naming — nothing secret may hide behind `NEXT_PUBLIC_`, `EXPO_PUBLIC_` or `VITE_`.
- Dependency audit, gated on new vulnerable dependencies, with dated waivers for the backlog.
- Committed-data hygiene — fails on a real email, a national-ID-shaped number, or a dialable
  Iraqi mobile in any fixture, seed or intake pack.
- Web hardening lock (CSP with a per-request nonce, HSTS, `frame-ancestors`) and an Electron
  hardening lock.
- RPC registry and authorization coverage against the RLS matrix.
- Migration safety — destructive or lock-taking DDL in changed migrations, and a mandatory
  `lock_timeout` preamble.
- A clean local Supabase run on every PR: migrations from scratch, RLS, lock-order and
  concurrency tests.
- Nightly schema-drift check against the hosted project (02:00 Asia/Baghdad).
- Weekly grouped Dependabot updates.

The reasoning behind each of these lives in `docs/security/`.

---

## 9 · For contributors

The rules you are bound by are in `CONTRIBUTING.md` and
`docs/security/layer-1-rules-and-decisions.md` (§1, §5 and §6 are binding). The short version:
schema changes are migrations only, the service-role key exists only in `packages/db/.env` and
GitHub Environment secrets, nothing is written to the hosted database through the dashboard SQL
Editor, and if you find a secret in a file you stop and flag it rather than fixing it quietly.
