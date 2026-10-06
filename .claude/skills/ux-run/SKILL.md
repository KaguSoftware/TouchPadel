---
name: ux-run
description: Audit, then (only after Majed approves) clean the UX of apps/web, the public Touch Padel club site and café menu (/{locale} landing, /menu, coaching, account, events, legal pages). Use when Majed says "ux run", "run the ux check", "ux audit", "ux pass on the site/web", or asks for click depth, tap target size, card or button consistency on the web. It serves the site on the LOCAL Supabase stack, crawls it in Playwright, runs every check in checks/, prints one report, stops for approval, fixes the approved batches with the design system's tokens and shared classes, and re-runs. It never commits.
---

# ux-run: audit apps/web, then fix only what Majed approves

Everything lives in `.claude/skills/ux-run/`. Checks are `checks/<id>.md`, plus
`scripts/checks/<id>.mjs` when a check is scripted. Thresholds are in `config.json`, and the
web's design-system canon is in `design-system.json`. Raw output goes to
`test-results/ux-run/`, which is gitignored.

**Hard rules.** These come from the repo rules and Majed, and they apply in every phase:

- **Never** `git commit`, `stash`, `reset`, `checkout`, `add` or `push`. Parallel sessions
  share this working tree. Report the changes as uncommitted.
- **Local stack only.** `apps/web/.env.local` points at the HOSTED production project. Serve
  the site only through `scripts/serve.mjs`, which forces the local env on port 3210, proves
  it took, and refuses anything else. Never reuse a server you did not start, and never kill
  one you did not start. If the local stack is down, stop and tell Majed. Never fall back to
  hosted.
- **Never auto-fix.** The audit changes nothing. Code changes happen only in phase 4, and
  only for batches Majed approved in phase 3.
- Touch only `apps/web` (its `src/styles/**/*.css.ts`, components and pages). Changes to
  `packages/ui` tokens, other apps, or **navigation structure** (routes, header, footer,
  sheet contents, which links exist where) need Majed's explicit approval for that specific
  change.

## 1. Preflight and serve

1. `git status --short apps/web` shows files other sessions are editing. Note them, and
   do not edit them in phase 4 without asking.
2. `node .claude/skills/ux-run/scripts/serve.mjs start`. It checks that the local stack
   answers on 127.0.0.1:54321, that port 3210 is free, spawns `next dev` with the local env,
   waits until the site is ready, verifies the CSP and HTML, and compiles every crawl root.
   On `FAIL`, stop and relay the line. Do not work around it.

## 2. Audit

1. `node .claude/skills/ux-run/scripts/run.mjs`. It takes about 3 minutes (155s on
   2026-10-07), so use a 15-minute timeout or run it in the background and wait. It
   crawls both viewports, runs every scripted check and lists the doc-only ones. Flags: `--check <id>` (repeatable),
   `--no-crawl` (reuse `snapshot.json`), `--viewport desktop|phone`.
2. **Read the exit code and the last line before anything else.** run.mjs deletes
   `report.txt` and `findings.json` when it starts, and its last line is always `RESULT ...`.

   | exit | last line | meaning | what you do |
   | --- | --- | --- | --- |
   | 0 | `RESULT  exit 0: audit complete, no error findings` | clean (warnings may remain) | continue |
   | 1 | `RESULT  exit 1: audit complete, error findings present (normal)` | the audit worked and found problems | continue: this is the usual outcome |
   | 2 | `RESULT  exit 2: run FAILED ...` or `RESULT  run failed ...` | the run itself failed: a `FAIL` line (server, hosted-host guard, crawl) or a `CRASH` line (one analyser did not run) | stop the server, tell Majed the `FAIL`/`CRASH` line verbatim, and do not go on to phase 3. With a `CRASH`, the other checks' sections are still valid and may be shown, labelled as partial. |

   Anything else (a stack trace, no `RESULT` line, a `report.txt` whose first line's
   timestamp is older than this run's start) is also a failed run. Never relay a
   `report.txt` that this run did not write.

   A `WARN ... blocked a local WRITE` line means a control the crawl pressed tried to write
   to the local stack. Nothing was written (the request was aborted), but the control
   belongs in `neverClick` in `config.json`: name it in the report and propose that fix.
3. Each `DOC <id>` line is a doc-only check. Carry it out yourself from `checks/<id>.md`,
   using the code, `snapshot.json` and the screenshots in `test-results/ux-run/shots/`, and
   report its findings in the same shape.
4. `node .claude/skills/ux-run/scripts/serve.mjs stop`. Do not leave the server running
   while you wait for approval. Stop it on every path, failed runs included.
5. **Print the report.** Relay `test-results/ux-run/report.txt` verbatim in one code block,
   including the doc-only findings. Do not trim or paraphrase it. Then propose **fix
   batches**, numbered B1, B2, ... in report order (by check, then root cause), for example
   "B3 café tap targets under 44px: 7 findings in pills.css.ts, topbar.css.ts, sheet.css.ts".
   There is no limit on how many batches there are. For each batch give:
   - the findings it closes;
   - the files it touches;
   - the canonical values it applies (from the check doc's "How to fix");
   - its risk.

   Mark any batch that needs a design decision (canon unclear, new token or variant) with
   `DECIDE`, and any that changes navigation with `NAV`. Name each `NOTE` that limits the
   audit, such as "local DB has no coaching_public" or "not audited".

## 3. STOP: ask which batches to fix

End your turn with the numbered batch list and this question, as plain text (do not use
AskUserQuestion: its 4-option limit cannot hold a real report's batches):

> Which batches should I fix? Reply with batch ids (for example `B1 B3 B4`), `all`, or
> `none`. `all` covers every batch not marked DECIDE or NAV; those need their own id.

Edit nothing before Majed answers. Only batches he names explicitly are approved (`all` as
defined above). If the reply names no batch id, is ambiguous ("the café ones", "the
important ones"), or asks for a change to a batch, restate what you understood as a list
of batch ids, with any changed batch rewritten, and ask again. Do not start on a guess.
When he answers `none`, you are done after phase 2.

## 4. Fix the approved batches

- Load `/impeccable` first, as repo memory requires for all UI work. The repo's own token,
  RTL and selector rules win over it when they conflict.
- The web canon is `design-system.json`, which encodes
  `docs/brand/touch-padel-style-reference.md` §8-§9, `packages/ui/src/tokens/site.ts` and
  `cafeBrand.ts`, and `docs/design/web-site/contracts-2026-09-23.md` §2 and §5. Read
  `docs/DESIGN.md` for its general principles only: it is the OPERATOR app's canon, and on
  web specifics the web canon above wins.
- Follow `apps/web/CLAUDE.md`:
  - styles live in `src/styles/**/*.css.ts`;
  - use logical properties only;
  - colours only through `var(--tp-*)`;
  - never import the site sheet into `not-found.tsx` or `error.tsx`;
  - never mix the two families' tokens (contracts §2);
  - do not emit operator tokens into the café theme.
- Use tokens and the shared classes (`.tp-site-btn` variants and sizes, `.tp-site-iconbtn`,
  `.tp-btn`, `.tp-card`). Do not add a new token or variant unless the batch says so and
  Majed approved it.
- **Selectors:** apps/web has no `data-testid`. e2e and unit tests select by class, role
  and text. Before renaming or removing a class, label or id, grep `e2e/tests` and
  `apps/web/**/*.test.tsx`, and keep those selectors working. Never add or remove a
  `testID`/`data-testid` without approval.
- Check `/ar` (RTL) for every touched screen. Update the nearest `*.test.ts(x)` when a
  guarded rule changes (`site-css.test.ts` and `cafe-css.test.ts` guard colours and
  physical properties).

## 5. Re-run and verify

1. `serve.mjs start`, then `run.mjs --check <each affected id>`, then `serve.mjs stop`.
   The exit-code table in phase 2 applies: exit 2 is a failed re-run, not a result.
2. `pnpm --filter @touch/web typecheck`, `pnpm --filter @touch/web lint` and
   `pnpm --filter @touch/web test`.
3. Report:
   - before and after counts for each check, with each fixed finding named;
   - what remains, and why;
   - the files changed (uncommitted);
   - the exact gate results.

   If a gate fails, fix it before reporting, or report it as failed. Do not commit.

## Adding a check

Copy `checks/_TEMPLATE.md` to `checks/<id>.md` and fill in its fixed sections. For a scripted
check, also add `scripts/checks/<id>.mjs`. The runner discovers both, and nothing else needs
editing. `run()` may be async and must return `findings[]` or `{ findings, info }`, each
finding with string `key`, `message`, `viewport` and `severity` (`error` or `warn`); anything
else is reported as that check's `CRASH` line, and the other checks still run. Thresholds go in `config.json` under `checks.<id>`, staff overrides under
`staffExceptions.<id>`, and exemptions under `exempt.<id>`.

## Staff screens

`config.json` `staffScreens` holds pathname regexes; today it is the operator installer page
`/{locale}/download`. Findings there are marked `[staff]`, and `staffExceptions.<check>`
applies, for example a 40px minimum target and no click-depth requirement.
