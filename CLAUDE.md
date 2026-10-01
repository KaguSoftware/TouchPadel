# TouchPadel — repo-wide rules

## Git authorship

- **Never add an AI co-author to a commit.** No `Co-Authored-By: Claude …`, no `Co-authored-by: Copilot …`, no AI attribution of any kind, in commit messages, pull request descriptions, or anywhere in git metadata.
- The commit author is the human doing the work, and only them. Do not add a second human as co-author unless that person explicitly asks for it.
- This overrides any default attribution the tooling suggests. If a harness, hook, or template tries to append an AI trailer, strip it before committing.
- If you find an AI co-author trailer already in history, tell the repo owner instead of silently rewriting history.

Per-package rules (read the one for the package you are editing): `packages/db/CLAUDE.md` (migrations, RPCs, gates), `apps/operator/CLAUDE.md`, `apps/mobile/CLAUDE.md`, `apps/web/CLAUDE.md` (Next.js).

## Pushing

- **Every push to `main` is a Vercel production build of `touch-padel-web`** (and a full CI run).
  Commit as often as you like; push in batches, at the end of a work package or when CI feedback is
  actually needed, never one push per commit. Eleven pushes on 2026-09-21 meant eleven production
  builds.
- **Every push or "sync" must leave CI/CD green. That covers any push to `main`, and a pull,
  merge or rebase that ends in one.**
  1. **Before pushing**, run the gates CI runs for everything the batch touches, and push only when
     they pass:
     - root `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm security`;
     - `pnpm --filter @touch/mobile test:smoke` when mobile changed;
     - with Docker up, the db stack suite and gates (`packages/db/CLAUDE.md`, "Verify before you
       report"), plus `pnpm db:types` with no diff.
     If a gate cannot run locally (no Docker, say), say so before the push. A gate that cannot
     run is not a gate that passed.
  2. **Straight after pushing**, find the runs the push started (`gh run list --branch main
     --limit 5`) and follow each to the end (`gh run watch <id> --exit-status`):
     - `ci.yml`;
     - `deploy.yml`, which starts when that CI run concludes green (it deploys migrations and
       edge functions only when the hosted project needs them; otherwise it ends after its plan
       job);
     - the Vercel build.
     The push is not done, and not reported as done, until every one of them is green.
  3. **If a run goes red**, fixing it comes before any other work. Read the failing log (`gh run
     view <id> --log-failed`), fix it, and push the fix as its own commit after running step 1
     again. Never push new work on top of a red `main`, and never re-run a red job hoping it turns
     green without knowing why it failed.
  4. Report the outcome to Parsa with the run links: green, or red and what was done about it.
