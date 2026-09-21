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
