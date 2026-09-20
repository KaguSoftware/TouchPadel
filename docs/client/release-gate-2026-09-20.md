# Release gate, publish token, tag ruleset, old CI artifacts (owner runbook, 2026-09-20)

**Why this exists.** The 2026-09-13 security audit found two things the code alone
cannot close (H1 and M7; plan items S4 and S9):

| Finding | What the repo now does | What only you can do |
|---|---|---|
| **H1 / S4** — any `operator-v*` tag ships an unsigned build that auto-installs on every till within six hours, published with your personal `gh` token (`repo` + `workflow` + `admin:org`). Four releases went out this way since the finding. | The `publish` job in `operator-release.yml` is bound to a GitHub Environment named `release`. A release now waits there for an approval before the updater feed serves it. **Until the environment exists with a reviewer, the gate is a no-op** — exactly like `staging` was before its reviewers were added. | §1 create the environment, §2 swap and revoke the token, §3 add the tag ruleset |
| **M7 / S9** — every migration push uploaded a dump of the `app` schema (the table-token secret's fallback store, SMS phone numbers, PIN attempts) as a 30-day artifact any repo reader could download. Failed runs uploaded it too. | The dump is now the five public append-only ledgers only, kept 7 days, under a new artifact name. Every workflow runs a pinned Supabase CLI and a read-only `GITHUB_TOKEN`. | §4 delete the artifacts already uploaded, and decide on the table-token secret |

All four steps are GitHub settings; none leaves a trace in git. About 25 minutes.
**Do §4 before §2**, because §2 revokes the `gh` session that §4 uses (or run
`gh auth login` again in between).

## 1. The `release` environment with a required reviewer (5 min)

`KaguSoftware/TouchPadel` → Settings → Environments → **New environment** → name
exactly `release` → Configure environment:

- **Required reviewers** → tick it → add yourself (add Kemal too if he may approve
  a release on his own). Any one of the listed reviewers can approve.
- **Prevent self-review**: leave it **off** while you are the person who pushes
  the tags and the only reviewer — with it on, your own tag could never go live.
  Turn it on once a second reviewer exists.
- **Deployment branches and tags** → *Selected branches and tags* → add a **tag**
  rule `operator-v*`. The environment then refuses any run that did not start
  from such a tag.
- Leave secrets and variables empty. `RELEASES_GH_TOKEN` stays a *repository*
  secret: the `prepare` and build jobs read it before the gate, on purpose
  (the draft release and its uploads are invisible to the tills; only the
  final flip is gated).

What you will see afterwards: a tag push builds as before, then the run stops
at **publish** with a *Review deployments* button. Approve → the draft is
published and `releases/latest` moves. Until you approve, the tills keep the
previous version. Reject → the draft stays in the public repo; if the build was
bad, delete it before re-cutting:

```
gh release delete v0.2.14 --cleanup-tag -y -R KaguSoftware/touchpadel-releases
```

## 2. Swap and revoke `RELEASES_GH_TOKEN` (10 min)

Today the secret holds the `gh` CLI OAuth session token of `ParSaMnSS`
(`docs/client/operator-download-2026-09-05.md` §2, interim since 2026-09-07).
It grants write on every repo that account can reach, and **overwriting the
secret does not revoke the token**.

1. Create the replacement. GitHub → your profile → Settings → Developer
   settings → Personal access tokens → **Fine-grained tokens** → Generate:
   - Token name: `touchpadel-releases publisher`. Expiry: 1 year, with a
     calendar reminder (a release run then fails loudly at "Which credentials
     exist" when it lapses).
   - Resource owner: **`KaguSoftware`**. If the org is not offered, enable it
     first under the org's Settings → Third-party Access → Personal access
     tokens → *Allow access via fine-grained personal access tokens*.
   - Repository access: **Only select repositories** → `touchpadel-releases`.
   - Permissions → Repository → **Contents: Read and write**. Nothing else
     (Metadata: read is added automatically).
   - If the org requires approval, approve your own request under the org's
     Settings → Personal access tokens → Pending requests.
2. Store it: `gh secret set RELEASES_GH_TOKEN -R KaguSoftware/TouchPadel` and
   paste the value.
3. Revoke the old one: GitHub → your profile → Settings → Applications →
   **Authorized OAuth Apps** → *GitHub CLI* → Revoke. This logs `gh` out on
   every machine; run `gh auth login` again where you use it. The new session
   token is a new credential and lives in no secret.
4. Check: the next tag push's `prepare` job creates the draft with the new
   token (the "Create the draft release" step), and `publish` flips it.

## 3. Tag ruleset for `operator-v*` (5 min)

Without this, anyone with push access can create a release tag; the
environment gate would still stop the rollout, but the build would run and a
draft would appear in the public repo.

`KaguSoftware/TouchPadel` → Settings → Rules → **Rulesets** → New ruleset →
**New tag ruleset**:

- Name `operator release tags`. Enforcement status: **Active**.
- Bypass list: add yourself (or the *Repository admin* role). Bypass mode
  *Always*.
- Target tags → Add target → *Include by pattern* → `operator-v*`.
- Rules: tick **Restrict creations**, **Restrict updates** and
  **Restrict deletions**. With creations restricted, only the bypass list can
  push a matching tag; everyone else gets a refusal from `git push`.

Check: the ruleset page shows the pattern and *Active*. Your own
`git push origin operator-v0.2.14` still works because you are on the bypass
list.

## 4. Delete the pre-fix ledger artifacts, decide on the table-token secret (5 min)

Every **DB Migrate (staging)** run since 2026-09-04 — successful or not —
uploaded `ledger-snapshot-<sha>`: a data dump of the `app` schema. Retention
was 30 days, so runs from late August have expired on their own and runs from
September are still downloadable until October. List them:

```
gh api --paginate "repos/KaguSoftware/TouchPadel/actions/artifacts?per_page=100" \
  -q '.artifacts[] | select(.name | startswith("ledger-snapshot-")) | "\(.id) \(.name) \(.created_at) expired=\(.expired)"'
```

Delete every one that has not expired:

```
gh api --paginate "repos/KaguSoftware/TouchPadel/actions/artifacts?per_page=100" \
  -q '.artifacts[] | select((.name | startswith("ledger-snapshot-")) and (.expired | not)) | .id' \
  | while read -r id; do gh api -X DELETE "repos/KaguSoftware/TouchPadel/actions/artifacts/$id" && echo "deleted $id"; done
```

(Or per run: Actions → the run → *Artifacts* → the bin icon.) Run the list
command again; it must print nothing that is not `expired=true`.

Do **not** delete `public-ledgers-<sha>`: that is the fixed snapshot (public
ledgers only, 7 days), and it is the only "before" a migration push leaves
behind.

**The table-token secret.** `app.table_token_secret()` reads Vault first and
falls back to the `app.secrets` table. If Vault was available when migration
0014 first ran on hosted, `app.secrets` is empty and the dumps held no secret.
Verify once, from `packages/db` after `supabase login` with the Touch account:

```
npx supabase db query --linked "select name, created_at from app.secrets"
```

- No rows → nothing to rotate; note the date in this file.
- A `table_token_secret` row → the HMAC secret was in every download. Every
  reader of this repository is on the team, so this is exposure to insiders
  only, but it is still a rotate decision: a new secret invalidates **every
  printed table QR** (HANDOFF.md, table-token section). Rotate on the day the
  QR cards are reprinted, not before; until then the artifacts are gone (above)
  and the secret is not in any new one.

## 5. Verify the whole thing

1. Cut `operator-v0.2.14` (the next version after 0.2.13). The run must stop at
   **publish** waiting for review; approve it; the release goes live and a till
   picks it up within six hours.
2. The next migration push's run log, step *Ledger snapshot before the push*,
   must read `dumping: audit_log payments refunds stock_movements sync_replays
   (excluding N other public tables)` and the run's artifact must be named
   `public-ledgers-<sha>`. If the step is red with *Ledger snapshot skipped*,
   the push still went through (the snapshot is evidence, not a gate) — send
   the step log to the developer.
3. Quick read-only confirmation of §1 from a terminal:

```
gh api repos/KaguSoftware/TouchPadel/environments/release -q '.protection_rules[] | .type'
```

must print `required_reviewers`.

## What changed in the repository (2026-09-20)

- `.github/workflows/operator-release.yml`: `publish` job bound to
  `environment: release`, with the reasoning in a comment.
- `.github/workflows/{ci,db-drift,db-migrate,db-ops,functions-deploy}.yml`:
  top-level `permissions: contents: read` (the release workflow already had
  it); `supabase/setup-cli` pinned to `2.116.0` everywhere it was `latest`,
  the version `ci.yml` has run green on since 2026-09-07.
- `.github/workflows/db-migrate.yml`: the pre-push snapshot dumps the five
  public append-only ledgers (`audit_log`, `payments`, `refunds`,
  `stock_movements`, `sync_replays`) by excluding every other public table,
  read from the live catalog on each run so a new table is excluded by default;
  an unparseable listing takes no snapshot. Artifact renamed
  `public-ledgers-<sha>`, retention 30 → 7 days.
